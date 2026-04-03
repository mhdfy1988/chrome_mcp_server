import type { Page } from "puppeteer-core";
import type { WaitUntilMode } from "../../config.js";
import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";
import type {
  ActionObservedSignals,
  ContentReadySignal,
  DomObservationSummary,
  WaitMatchMode,
} from "./types.js";

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
  observed: ActionObservedSignals;
  contentReady: boolean;
  contentReadySignal: ContentReadySignal;
  domObservation: DomObservationSummary;
  actionError?: string;
  note?: string;
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
