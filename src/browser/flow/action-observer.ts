import type { Page } from "puppeteer-core";
import type { WaitUntilMode } from "../../config.js";
import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import type { ClickAndWaitResult, WaitMatchMode } from "../core/types.js";

export interface ActionWaitOptions {
  timeoutMs?: number;
  waitForNavigation?: boolean;
  waitUntil?: WaitUntilMode;
  waitForSelector?: string;
  waitForTitle?: string;
  waitForUrl?: string;
  matchMode?: WaitMatchMode;
}

export interface ActionObservationResult {
  finalPage: Page;
  pageSource: "current" | "popup" | "new_target";
  before: {
    title: string;
    url: string;
  };
  after: {
    title: string;
    url: string;
  };
  changed: boolean;
  observed: ClickAndWaitResult["observed"];
  note?: string;
}

export type ActionVerificationRule =
  | {
      kind: "inputValue";
      selector: string;
      expected: string;
      matchMode?: WaitMatchMode;
    }
  | {
      kind: "url";
      expected: string;
      matchMode?: WaitMatchMode;
    }
  | {
      kind: "title";
      expected: string;
      matchMode?: WaitMatchMode;
    }
  | {
      kind: "pageSwitched";
    };

export interface ActionVerificationReport {
  kind: ActionVerificationRule["kind"];
  passed: boolean;
  detail: string;
}

export interface ActionExecutionOptions extends ActionWaitOptions {
  maxRetries?: number;
  retryBackoffMs?: number;
  requireObservedChange?: boolean;
  verifications?: ActionVerificationRule[];
}

export interface ActionExecutionResult extends ActionObservationResult {
  attempts: number;
  verificationPassed: boolean;
  verificationReports: ActionVerificationReport[];
}

async function capturePageState(page: Page): Promise<{
  title: string;
  url: string;
}> {
  return {
    title: await page.title(),
    url: page.url(),
  };
}

function normalizeUrlForComparison(value: string): string {
  try {
    const url = new URL(value);
    const search = Array.from(url.searchParams.entries())
      .map(([key, currentValue]) => `${key}=${currentValue}`)
      .join("&");
    return `${url.origin}${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
  } catch {
    return value.replace(/\?$/, "");
  }
}

function hasMeaningfulPageChange(
  before: { title: string; url: string },
  after: { title: string; url: string },
): boolean {
  return (
    before.title !== after.title ||
    normalizeUrlForComparison(before.url) !== normalizeUrlForComparison(after.url)
  );
}

function textMatches(
  actual: string,
  expected: string,
  mode: WaitMatchMode = "contains",
): boolean {
  if (mode === "exact") {
    return actual === expected;
  }

  return actual.includes(expected);
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function readElementTextForVerification(
  page: Page,
  selector: string,
): Promise<{
  ok: boolean;
  text: string;
  note?: string;
}> {
  try {
    const value = await page.$eval(selector, (element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        return String(element.value ?? "");
      }

      const asHTMLElement = element as HTMLElement;
      return String(asHTMLElement.innerText ?? element.textContent ?? "");
    });

    return {
      ok: true,
      text: value,
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function evaluateVerificationRules(
  observation: ActionObservationResult,
  rules: ActionVerificationRule[],
): Promise<{
  passed: boolean;
  reports: ActionVerificationReport[];
}> {
  if (rules.length === 0) {
    return { passed: true, reports: [] };
  }

  const reports: ActionVerificationReport[] = [];

  for (const rule of rules) {
    switch (rule.kind) {
      case "inputValue": {
        const result = await readElementTextForVerification(
          observation.finalPage,
          rule.selector,
        );
        const mode = rule.matchMode ?? "exact";
        const passed = result.ok && textMatches(result.text, rule.expected, mode);
        reports.push({
          kind: "inputValue",
          passed,
          detail: result.ok
            ? `expected(${mode})=${rule.expected}; actual=${result.text}`
            : `selector=${rule.selector}; error=${result.note ?? "unknown"}`,
        });
        break;
      }
      case "url": {
        const mode = rule.matchMode ?? "contains";
        const actual = observation.after.url;
        reports.push({
          kind: "url",
          passed: textMatches(actual, rule.expected, mode),
          detail: `expected(${mode})=${rule.expected}; actual=${actual}`,
        });
        break;
      }
      case "title": {
        const mode = rule.matchMode ?? "contains";
        const actual = observation.after.title;
        reports.push({
          kind: "title",
          passed: textMatches(actual, rule.expected, mode),
          detail: `expected(${mode})=${rule.expected}; actual=${actual}`,
        });
        break;
      }
      case "pageSwitched": {
        const switched =
          observation.pageSource !== "current" ||
          observation.observed.popup ||
          observation.observed.target ||
          observation.observed.pageCountChanged;
        reports.push({
          kind: "pageSwitched",
          passed: switched,
          detail: `source=${observation.pageSource}; popup=${observation.observed.popup}; target=${observation.observed.target}; pageCountChanged=${observation.observed.pageCountChanged}`,
        });
        break;
      }
      default: {
        const _exhaustiveCheck: never = rule;
        void _exhaustiveCheck;
      }
    }
  }

  return {
    passed: reports.every((report) => report.passed),
    reports,
  };
}

async function waitForActionConditions(
  page: Page,
  options: ActionWaitOptions,
  observed: ActionObservationResult["observed"],
  timeoutMs: number,
): Promise<void> {
  const matchMode = options.matchMode ?? "contains";

  if (options.waitForSelector) {
    await page
      .locator(options.waitForSelector)
      .setTimeout(timeoutMs)
      .wait()
      .then(() => {
        observed.selector = true;
      })
      .catch(() => {
        // 继续依赖其他观察信号，不在这里直接判失败。
      });
  }

  if (options.waitForTitle) {
    await page
      .waitForFunction(
        ({ expectedTitle, currentMatchMode }) => {
          const actual = document.title;
          if (currentMatchMode === "exact") {
            return actual === expectedTitle;
          }

          return actual.includes(expectedTitle);
        },
        {
          timeout: timeoutMs,
        },
        {
          expectedTitle: options.waitForTitle,
          currentMatchMode: matchMode,
        },
      )
      .then(() => {
        observed.title = true;
      })
      .catch(() => {
        // 继续依赖其他观察信号，不在这里直接判失败。
      });
  }

  if (options.waitForUrl) {
    await page
      .waitForFunction(
        ({ expectedUrl, currentMatchMode }) => {
          const actual = location.href;
          if (currentMatchMode === "exact") {
            return actual === expectedUrl;
          }

          return actual.includes(expectedUrl);
        },
        {
          timeout: timeoutMs,
        },
        {
          expectedUrl: options.waitForUrl,
          currentMatchMode: matchMode,
        },
      )
      .then(() => {
        observed.url = true;
      })
      .catch(() => {
        // 继续依赖其他观察信号，不在这里直接判失败。
      });
  }
}

export async function observeAction(
  deps: BrowserRuntimeDeps,
  page: Page,
  action: () => Promise<void>,
  options: ActionWaitOptions = {},
): Promise<ActionObservationResult> {
  const browser = await deps.ensureBrowser();
  if (!browser) {
    throw new Error("浏览器没有成功启动。");
  }

  const before = await capturePageState(page);
  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;
  const waitUntil = options.waitUntil ?? "domcontentloaded";
  const followupTimeoutMs = Math.min(timeoutMs, 2000);
  const beforeTargets = new Set(browser.targets());
  const beforePageCount = (await browser.pages()).length;
  const sourceTarget = page.target();

  const observed: ActionObservationResult["observed"] = {
    navigation: false,
    selector: false,
    title: false,
    url: false,
    stateChanged: false,
    popup: false,
    target: false,
    pageCountChanged: false,
  };

  const waiters: Array<Promise<void>> = [];

  const trackWaiter = async (
    waiter: Promise<unknown>,
    key: keyof Omit<ActionObservationResult["observed"], "stateChanged">,
  ) => {
    try {
      await waiter;
      observed[key] = true;
    } catch {
      // 等待命中失败时继续回读真实页面状态，不在这里直接判失败。
    }
  };

  if (options.waitForNavigation) {
    waiters.push(
      trackWaiter(
        page.waitForNavigation({
          waitUntil,
          timeout: timeoutMs,
        }),
        "navigation",
      ),
    );
  }

  waiters.push(waitForActionConditions(page, options, observed, timeoutMs));

  let resolvePopup!: (value: Page | null) => void;
  const popupPromise = new Promise<Page | null>((resolve) => {
    resolvePopup = resolve;
  });
  const popupHandler = (popupPage: Page | null) => {
    resolvePopup(popupPage ?? null);
  };
  page.once("popup", popupHandler);

  const targetPromise = browser
    .waitForTarget(
      (target) =>
        !beforeTargets.has(target) &&
        target.type() === "page" &&
        target.opener() === sourceTarget,
      { timeout: timeoutMs },
    )
    .then(async (target) => {
      return (await target.page().catch(() => null)) ?? null;
    })
    .catch(() => null);

  await action();

  if (waiters.length > 0) {
    await Promise.allSettled(waiters);
    await wait(500);
  }

  const popupPage = await Promise.race([
    popupPromise,
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), followupTimeoutMs),
    ),
  ]);
  page.off("popup", popupHandler);

  const targetPage = await Promise.race([
    targetPromise,
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), followupTimeoutMs),
    ),
  ]);

  observed.popup = Boolean(popupPage);
  observed.target = Boolean(targetPage);

  let finalPage = page;
  let pageSource: ActionObservationResult["pageSource"] = "current";

  if (popupPage) {
    finalPage = popupPage;
    pageSource = "popup";
  } else if (targetPage && targetPage !== page) {
    finalPage = targetPage;
    pageSource = "new_target";
  }

  await deps.syncPages();

  const afterPageCount = deps.getPages().size;
  observed.pageCountChanged = afterPageCount !== beforePageCount;

  if (finalPage !== page) {
    const finalPageId = deps.trackPage(finalPage);
    deps.applyTimeouts(finalPage);
    await deps.instrumentPage(finalPageId, finalPage);
    await waitForActionConditions(
      finalPage,
      options,
      observed,
      Math.min(timeoutMs, 5000),
    );
    await finalPage.bringToFront().catch(() => {
      // 如果 bringToFront 失败，仍然继续读取真实页面状态。
    });
    deps.setCurrentPageId(finalPageId);
  }

  const after = await capturePageState(finalPage);
  observed.stateChanged =
    finalPage !== page || hasMeaningfulPageChange(before, after);

  const changed =
    observed.navigation ||
    observed.selector ||
    observed.title ||
    observed.url ||
    observed.stateChanged ||
    observed.popup ||
    observed.target ||
    observed.pageCountChanged;

  return {
    finalPage,
    pageSource,
    before,
    after,
    changed,
    observed,
    note: changed
      ? undefined
      : "动作已经执行，但没有观察到明确的导航、匹配条件或页面状态变化。",
  };
}

export async function runActionWithVerification(
  deps: BrowserRuntimeDeps,
  page: Page,
  action: (page: Page) => Promise<void>,
  options: ActionExecutionOptions = {},
): Promise<ActionExecutionResult> {
  const maxRetries = options.maxRetries ?? deps.config.maxRetries;
  const retryBackoffMs = options.retryBackoffMs ?? deps.config.retryBackoffMs;
  const rules = options.verifications ?? [];
  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;
  const requireObservedChange = options.requireObservedChange ?? false;

  let currentPage = page;
  let lastObservation: ActionObservationResult | undefined;
  let lastReports: ActionVerificationReport[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const observation = await observeAction(
      deps,
      currentPage,
      async () => action(currentPage),
      {
        ...options,
        timeoutMs,
      },
    );
    lastObservation = observation;

    const verification = await evaluateVerificationRules(observation, rules);
    lastReports = verification.reports;

    const passed =
      verification.passed &&
      (!requireObservedChange || observation.changed);

    if (passed) {
      return {
        ...observation,
        attempts: attempt + 1,
        verificationPassed: true,
        verificationReports: verification.reports,
      };
    }

    if (attempt < maxRetries) {
      currentPage = observation.finalPage;
      await deps.syncPages();
      await wait(retryBackoffMs * (attempt + 1));
    }
  }

  if (!lastObservation) {
    throw new Error("动作执行失败：没有捕获到有效结果。");
  }

  const failureReasons: string[] = [];
  for (const report of lastReports) {
    if (!report.passed) {
      failureReasons.push(`${report.kind}: ${report.detail}`);
    }
  }

  if (requireObservedChange && !lastObservation.changed) {
    failureReasons.push("未观察到页面变化。");
  }

  throw new Error(
    `动作验证失败（重试 ${maxRetries + 1} 次后仍未通过）：${failureReasons.join(" | ") || "未知原因"}`,
  );
}
