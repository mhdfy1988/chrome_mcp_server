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
  const timeoutMs = options.timeoutMs ?? deps.config.defaultTimeoutMs;
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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

