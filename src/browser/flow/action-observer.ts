import type { Page } from "puppeteer-core";
import type { WaitUntilMode } from "../../config.js";
import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import type {
  ClickAndWaitChangeType,
  ClickAndWaitResult,
  ContentReadySignal,
  DomObservationSummary,
  ClickAndWaitSuccessSignal,
  WaitMatchMode,
} from "../core/types.js";
import {
  describeAuthRequiredAction,
  describeVerificationAction,
  readPageState,
} from "../core/page-state.js";

export interface ActionWaitOptions {
  timeoutMs?: number;
  waitForNavigation?: boolean;
  waitUntil?: WaitUntilMode;
  waitForSelector?: string;
  waitForTitle?: string;
  waitForUrl?: string;
  contentReadySelector?: string;
  contentReadyText?: string;
  contentReadyTextSelector?: string;
  contentReadyTimeoutMs?: number;
  matchMode?: WaitMatchMode;
  observeDom?: boolean;
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
  contentReady: boolean;
  contentReadySignal: ContentReadySignal;
  domObservation: DomObservationSummary;
  actionError?: string;
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
      kind: "selectorVisible";
      selector: string;
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
      kind: "contentSelectorVisible";
      selector: string;
    }
  | {
      kind: "contentText";
      text: string;
      textSelector?: string;
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
  requireStrongObservedChange?: boolean;
  verifications?: ActionVerificationRule[];
}

export interface ActionExecutionResult extends ActionObservationResult {
  attempts: number;
  verificationPassed: boolean;
  verificationReports: ActionVerificationReport[];
}

const DOM_OBSERVER_KEY = "__chromeMcpDomObserver";

function createEmptyDomObservation(): DomObservationSummary {
  return {
    changed: false,
    mutationCount: 0,
    addedNodes: 0,
    removedNodes: 0,
    textChanges: 0,
    attributeChanges: 0,
    topSelectors: [],
  };
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

function formatActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecoverableActionError(error: unknown): boolean {
  const message = formatActionError(error).toLocaleLowerCase();
  return [
    "detached frame",
    "frame detached",
    "execution context was destroyed",
    "cannot find context with specified id",
  ].some((needle) => message.includes(needle));
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

function normalizeUrlWithoutHash(value: string): string {
  try {
    const url = new URL(value);
    const search = Array.from(url.searchParams.entries())
      .map(([key, currentValue]) => `${key}=${currentValue}`)
      .join("&");
    return `${url.origin}${url.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return value.split("#", 1)[0]?.replace(/\?$/, "") ?? value;
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

function hasNavigationLikeUrlChange(
  before: { title: string; url: string },
  after: { title: string; url: string },
): boolean {
  return normalizeUrlWithoutHash(before.url) !== normalizeUrlWithoutHash(after.url);
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

async function readElementVisibilityForVerification(
  page: Page,
  selector: string,
): Promise<{
  ok: boolean;
  visible: boolean;
  note?: string;
}> {
  try {
    const visible = await page.$eval(selector, (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

    return {
      ok: true,
      visible,
    };
  } catch (error) {
    return {
      ok: false,
      visible: false,
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

export function hasStrongObservedChange(
  observation: ActionObservationResult,
): boolean {
  return (
    observation.pageSource !== "current" ||
    observation.observed.navigation ||
    observation.observed.selector ||
    observation.observed.title ||
    observation.observed.url ||
    observation.observed.dom ||
    observation.observed.popup ||
    observation.observed.target
  );
}

export async function evaluateActionVerification(
  observation: ActionObservationResult,
  options: Pick<
    ActionExecutionOptions,
    "verifications" | "requireObservedChange" | "requireStrongObservedChange"
  > = {},
): Promise<{
  passed: boolean;
  reports: ActionVerificationReport[];
}> {
  const verification = await evaluateVerificationRules(
    observation,
    options.verifications ?? [],
  );

  const passed =
    verification.passed &&
    (!options.requireObservedChange || observation.changed) &&
    (!options.requireStrongObservedChange ||
      hasStrongObservedChange(observation));

  return {
    passed,
    reports: verification.reports,
  };
}

export async function collectActionFailureReasons(
  observation: ActionObservationResult,
  reports: ActionVerificationReport[],
  options: Pick<
    ActionExecutionOptions,
    | "requireObservedChange"
    | "requireStrongObservedChange"
    | "contentReadySelector"
    | "contentReadyText"
  > = {},
): Promise<string[]> {
  const failureReasons: string[] = [];

  for (const report of reports) {
    if (!report.passed) {
      failureReasons.push(`${report.kind}: ${report.detail}`);
    }
  }

  if (options.requireObservedChange && !observation.changed) {
    failureReasons.push("未观察到页面变化。");
  }

  if (
    options.requireStrongObservedChange &&
    !hasStrongObservedChange(observation)
  ) {
    failureReasons.push(
      "只观察到弱变化（例如仅标题/URL轻微漂移或噪声状态），未命中强信号。",
    );
  }

  if (
    (options.contentReadySelector || options.contentReadyText) &&
    !observation.contentReady
  ) {
    failureReasons.push("路由可能已变化，但内容区仍未达到就绪条件。");
  }

  const pageState = await readPageState(observation.finalPage);
  if (pageState.pageState === "blocked_by_verification") {
    const providerHint = pageState.verification?.providerHint ?? "unknown";
    const evidence = pageState.verification?.evidence?.join(", ") ?? "无";
    const guidance = describeVerificationAction(
      pageState.verification?.recommendedAction ?? "manual_resume",
    );
    failureReasons.push(
      `页面当前处于验证拦截状态（blocked_by_verification，provider=${providerHint}，evidence=${evidence}）。${guidance}`,
    );
  }

  if (pageState.pageState === "auth_required") {
    const kind = pageState.authRequired?.kind ?? "unknown";
    const evidence = pageState.authRequired?.evidence?.join(", ") ?? "无";
    const guidance = describeAuthRequiredAction(
      pageState.authRequired?.recommendedAction ?? "manual_login",
    );
    failureReasons.push(
      `页面当前处于登录拦截状态（auth_required，kind=${kind}，evidence=${evidence}）。${guidance}`,
    );
  }

  if (pageState.pageState === "overlay_blocking") {
    const kind = pageState.overlay?.kind ?? "unknown";
    const evidence = pageState.overlay?.evidence?.join(", ") ?? "无";
    failureReasons.push(
      `页面当前存在可关闭的遮挡弹窗（overlay_blocking，kind=${kind}，evidence=${evidence}）。建议先调用 dismiss_blocking_overlays，再继续当前会话。`,
    );
  }

  if (observation.actionError) {
    failureReasons.push(`动作执行瞬时错误: ${observation.actionError}`);
  }

  return failureReasons;
}

export function determineActionChangeType(
  observation: ActionObservationResult,
): ClickAndWaitChangeType {
  if (observation.pageSource === "popup" || observation.observed.popup) {
    return "popup";
  }

  if (observation.pageSource === "new_target" || observation.observed.target) {
    return "new_target";
  }

  if (
    observation.observed.navigation ||
    hasNavigationLikeUrlChange(observation.before, observation.after)
  ) {
    return "navigation";
  }

  if (observation.observed.dom || observation.changed) {
    return "same_page_update";
  }

  return "none";
}

export function determineActionSuccessSignal(
  observation: ActionObservationResult,
  options: ActionWaitOptions,
): ClickAndWaitSuccessSignal {
  if (observation.pageSource === "popup" || observation.observed.popup) {
    return "popup";
  }

  if (observation.pageSource === "new_target" || observation.observed.target) {
    return "new_target";
  }

  if (options.waitForSelector && observation.observed.selector) {
    return "selector";
  }

  if (options.contentReadySelector && observation.observed.contentSelector) {
    return "content_selector";
  }

  if (options.contentReadyText && observation.observed.contentText) {
    return "content_text";
  }

  if (options.waitForUrl && observation.observed.url) {
    return "url";
  }

  if (options.waitForTitle && observation.observed.title) {
    return "title";
  }

  if (observation.observed.navigation) {
    return "navigation";
  }

  if (observation.observed.dom) {
    return "dom";
  }

  if (observation.observed.pageCountChanged) {
    return "page_count_changed";
  }

  if (observation.observed.stateChanged) {
    return "state_changed";
  }

  return "none";
}

async function startDomObservation(page: Page): Promise<boolean> {
  try {
    await page.evaluate((observerKey) => {
      const globalWindow = window as typeof window & Record<string, unknown>;
      const existing = globalWindow[observerKey] as
        | {
            observer?: MutationObserver;
          }
        | undefined;

      existing?.observer?.disconnect();

      const selectorCounts: Record<string, number> = {};

      const pickSelector = (element: Element | null): string => {
        if (!element) {
          return "unknown";
        }

        if (element.id) {
          return `#${element.id.slice(0, 40)}`;
        }

        const testId =
          element.getAttribute("data-testid") ?? element.getAttribute("data-test");
        if (testId) {
          return `[data-testid="${testId.slice(0, 40)}"]`;
        }

        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) {
          return `${element.tagName.toLowerCase()}[aria-label="${ariaLabel.slice(0, 30)}"]`;
        }

        const className =
          typeof element.className === "string"
            ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")
            : "";

        if (className) {
          return `${element.tagName.toLowerCase()}.${className}`;
        }

        return element.tagName.toLowerCase();
      };

      const bumpSelector = (element: Element | null) => {
        const selector = pickSelector(element);
        selectorCounts[selector] = (selectorCounts[selector] ?? 0) + 1;
      };

      const summary: DomObservationSummary = {
        changed: false,
        mutationCount: 0,
        addedNodes: 0,
        removedNodes: 0,
        textChanges: 0,
        attributeChanges: 0,
        topSelectors: [],
      };

      const observer = new MutationObserver((mutations) => {
        summary.changed = true;

        for (const mutation of mutations) {
          summary.mutationCount += 1;

          if (mutation.type === "childList") {
            summary.addedNodes += mutation.addedNodes.length;
            summary.removedNodes += mutation.removedNodes.length;
            bumpSelector(mutation.target instanceof Element ? mutation.target : null);

            mutation.addedNodes.forEach((node) => {
              if (node instanceof Element) {
                bumpSelector(node);
                return;
              }

              if (node.parentElement) {
                bumpSelector(node.parentElement);
              }
            });
            continue;
          }

          if (mutation.type === "characterData") {
            summary.textChanges += 1;
            const parent =
              mutation.target.parentElement ??
              (mutation.target.parentNode instanceof Element
                ? mutation.target.parentNode
                : null);
            bumpSelector(parent);
            continue;
          }

          if (mutation.type === "attributes") {
            summary.attributeChanges += 1;
            bumpSelector(mutation.target instanceof Element ? mutation.target : null);
          }
        }
      });

      observer.observe(document.body ?? document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });

      globalWindow[observerKey] = {
        observer,
        stop: () => {
          observer.disconnect();
          summary.topSelectors = Object.entries(selectorCounts)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 5)
            .map(([selector]) => selector);
          return summary;
        },
      };
    }, DOM_OBSERVER_KEY);
    return true;
  } catch {
    return false;
  }
}

async function stopDomObservation(page: Page): Promise<DomObservationSummary> {
  try {
    return await page.evaluate((observerKey) => {
      const globalWindow = window as typeof window & Record<string, unknown>;
      const holder = globalWindow[observerKey] as
        | {
            stop?: () => DomObservationSummary;
          }
        | undefined;

      if (!holder?.stop) {
        return {
          changed: false,
          mutationCount: 0,
          addedNodes: 0,
          removedNodes: 0,
          textChanges: 0,
          attributeChanges: 0,
          topSelectors: [],
        };
      }

      const summary = holder.stop();
      delete globalWindow[observerKey];
      return summary;
    }, DOM_OBSERVER_KEY);
  } catch {
    return createEmptyDomObservation();
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
      case "selectorVisible": {
        const result = await readElementVisibilityForVerification(
          observation.finalPage,
          rule.selector,
        );
        reports.push({
          kind: "selectorVisible",
          passed: result.ok && result.visible,
          detail: result.ok
            ? `selector=${rule.selector}; visible=${result.visible}`
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
      case "contentSelectorVisible": {
        const result = await readElementVisibilityForVerification(
          observation.finalPage,
          rule.selector,
        );
        reports.push({
          kind: "contentSelectorVisible",
          passed: result.ok && result.visible,
          detail: result.ok
            ? `selector=${rule.selector}; visible=${result.visible}`
            : `selector=${rule.selector}; error=${result.note ?? "unknown"}`,
        });
        break;
      }
      case "contentText": {
        try {
          const actual = await observation.finalPage.evaluate(
            ({ expectedSelector }) => {
              const root = expectedSelector
                ? document.querySelector(expectedSelector)
                : document.body;

              if (!root) {
                return "";
              }

              if (
                root instanceof HTMLInputElement ||
                root instanceof HTMLTextAreaElement ||
                root instanceof HTMLSelectElement
              ) {
                return String(root.value ?? "");
              }

              const element = root as HTMLElement;
              return String(element.innerText ?? root.textContent ?? "");
            },
            { expectedSelector: rule.textSelector },
          );
          const mode = rule.matchMode ?? "contains";
          reports.push({
            kind: "contentText",
            passed: textMatches(actual, rule.text, mode),
            detail: `expected(${mode})=${rule.text}; actual=${actual}`,
          });
        } catch (error) {
          reports.push({
            kind: "contentText",
            passed: false,
            detail: `selector=${rule.textSelector ?? "document.body"}; error=${error instanceof Error ? error.message : String(error)}`,
          });
        }
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
  baseline?: {
    title: string;
    url: string;
    selectorVisible: boolean;
  },
): Promise<void> {
  const matchMode = options.matchMode ?? "contains";

  if (options.waitForSelector) {
    if (!baseline?.selectorVisible) {
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
  }

  if (options.waitForTitle) {
    const baselineTitleMatched =
      baseline !== undefined &&
      textMatches(baseline.title, options.waitForTitle, matchMode);

    await page
      .waitForFunction(
        ({ expectedTitle, currentMatchMode, previousTitle, requireChange }) => {
          const actual = document.title;
          const matched =
            currentMatchMode === "exact"
              ? actual === expectedTitle
              : actual.includes(expectedTitle);

          if (!matched) {
            return false;
          }

          if (requireChange) {
            return actual !== previousTitle;
          }

          return true;
        },
        {
          timeout: timeoutMs,
        },
        {
          expectedTitle: options.waitForTitle,
          currentMatchMode: matchMode,
          previousTitle: baseline?.title ?? "",
          requireChange: baselineTitleMatched,
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
    const baselineUrlMatched =
      baseline !== undefined &&
      textMatches(baseline.url, options.waitForUrl, matchMode);

    await page
      .waitForFunction(
        ({ expectedUrl, currentMatchMode, previousUrl, requireChange }) => {
          const actual = location.href;

          const matched =
            currentMatchMode === "exact"
              ? actual === expectedUrl
              : actual.includes(expectedUrl);

          if (!matched) {
            return false;
          }

          if (requireChange) {
            return actual !== previousUrl;
          }

          return true;
        },
        {
          timeout: timeoutMs,
        },
        {
          expectedUrl: options.waitForUrl,
          currentMatchMode: matchMode,
          previousUrl: baseline?.url ?? "",
          requireChange: baselineUrlMatched,
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

async function waitForContentReadyConditions(
  page: Page,
  options: ActionWaitOptions,
  observed: ActionObservationResult["observed"],
  timeoutMs: number,
): Promise<void> {
  const matchMode = options.matchMode ?? "contains";

  if (options.contentReadySelector) {
    await page
      .locator(options.contentReadySelector)
      .setTimeout(timeoutMs)
      .wait()
      .then(() => {
        observed.contentSelector = true;
      })
      .catch(() => {
        // 继续依赖最终校验给出失败原因。
      });
  }

  if (options.contentReadyText) {
    await page
      .waitForFunction(
        ({
          expectedText,
          expectedSelector,
          currentMatchMode,
        }) => {
          const root = expectedSelector
            ? document.querySelector(expectedSelector)
            : document.body;

          if (!root) {
            return false;
          }

          const actual =
            root instanceof HTMLInputElement ||
            root instanceof HTMLTextAreaElement ||
            root instanceof HTMLSelectElement
              ? String(root.value ?? "")
              : String((root as HTMLElement).innerText ?? root.textContent ?? "");

          if (currentMatchMode === "exact") {
            return actual === expectedText;
          }

          return actual.includes(expectedText);
        },
        {
          timeout: timeoutMs,
        },
        {
          expectedText: options.contentReadyText,
          expectedSelector: options.contentReadyTextSelector,
          currentMatchMode: matchMode,
        },
      )
      .then(() => {
        observed.contentText = true;
      })
      .catch(() => {
        // 继续依赖最终校验给出失败原因。
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
  const contentReadyTimeoutMs = options.contentReadyTimeoutMs ?? timeoutMs;
  const waitUntil = options.waitUntil ?? "domcontentloaded";
  const domObserverStarted = options.observeDom
    ? await startDomObservation(page)
    : false;
  const selectorBaseline = options.waitForSelector
    ? await readElementVisibilityForVerification(page, options.waitForSelector)
    : undefined;
  const followupTimeoutMs = Math.min(
    timeoutMs,
    deps.config.followupWatchTimeoutMs,
  );
  const beforeTargets = new Set(browser.targets());
  const beforePageCount = (await browser.pages()).length;
  const sourceTarget = page.target();

  const observed: ActionObservationResult["observed"] = {
    navigation: false,
    selector: false,
    title: false,
    url: false,
    contentSelector: false,
    contentText: false,
    dom: false,
    stateChanged: false,
    popup: false,
    target: false,
    pageCountChanged: false,
  };
  let domObservation = createEmptyDomObservation();

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

  waiters.push(
    waitForActionConditions(page, options, observed, timeoutMs, {
      title: before.title,
      url: before.url,
      selectorVisible: selectorBaseline?.ok ? selectorBaseline.visible : false,
    }),
  );

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

  let popupPage: Page | null = null;
  let targetPage: Page | null = null;
  let actionError: string | undefined;

  try {
    try {
      await action();
    } catch (error) {
      if (!isRecoverableActionError(error)) {
        throw error;
      }
      actionError = formatActionError(error);
    }

    if (waiters.length > 0) {
      await Promise.allSettled(waiters);
      await wait(deps.config.actionSettleDelayMs);
    }

    popupPage = await Promise.race([
      popupPromise,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), followupTimeoutMs),
      ),
    ]);

    targetPage = await Promise.race([
      targetPromise,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), followupTimeoutMs),
      ),
    ]);
  } finally {
    page.off("popup", popupHandler);
    if (domObserverStarted) {
      domObservation = await stopDomObservation(page);
      observed.dom = domObservation.changed;
    }
  }

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
      {
        title: before.title,
        url: before.url,
        selectorVisible: false,
      },
    );
    await finalPage.bringToFront().catch(() => {
      // 如果 bringToFront 失败，仍然继续读取真实页面状态。
    });
    deps.setCurrentPageId(finalPageId);
  }

  await waitForContentReadyConditions(
    finalPage,
    options,
    observed,
    contentReadyTimeoutMs,
  );

  const after = await capturePageState(finalPage);
  observed.stateChanged =
    finalPage !== page || hasMeaningfulPageChange(before, after);

  const changed =
    observed.navigation ||
    observed.selector ||
    observed.title ||
    observed.url ||
    observed.dom ||
    observed.stateChanged ||
    observed.popup ||
    observed.target ||
    observed.pageCountChanged;

  const contentReady =
    (!options.contentReadySelector || observed.contentSelector) &&
    (!options.contentReadyText || observed.contentText);
  const contentReadySignal: ContentReadySignal =
    options.contentReadySelector && observed.contentSelector
      ? "selector"
      : options.contentReadyText && observed.contentText
        ? "text"
        : "none";

  return {
    finalPage,
    pageSource,
    before,
    after,
    changed,
    observed,
    contentReady,
    contentReadySignal,
    domObservation,
    actionError,
    note: changed
      ? actionError
        ? `动作后出现瞬时句柄错误，但页面变化已被成功跟踪：${actionError}`
        : undefined
      : actionError
        ? `动作执行后出现瞬时句柄错误，且未观察到足够页面变化：${actionError}`
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
  const requireStrongObservedChange =
    options.requireStrongObservedChange ?? false;

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

    const verification = await evaluateActionVerification(observation, {
      verifications: rules,
      requireObservedChange,
      requireStrongObservedChange,
    });
    lastReports = verification.reports;

    if (verification.passed) {
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

  const failureReasons = await collectActionFailureReasons(
    lastObservation,
    lastReports,
    {
      requireObservedChange,
      requireStrongObservedChange,
      contentReadySelector: options.contentReadySelector,
      contentReadyText: options.contentReadyText,
    },
  );

  throw new Error(
    `动作验证失败（重试 ${maxRetries + 1} 次后仍未通过）：${failureReasons.join(" | ") || "未知原因"}`,
  );
}
