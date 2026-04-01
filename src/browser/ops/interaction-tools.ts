import type { KeyInput, Page } from "puppeteer-core";
import type { WaitUntilMode } from "../../config.js";
import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import type {
  ClickAndWaitResult,
  PageSummary,
  WaitMatchMode,
} from "../core/types.js";
import {
  runActionWithVerification,
  type ActionVerificationRule,
} from "../flow/action-observer.js";
export { submitInputWithRuntime } from "./submit-input.js";

export async function clickWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    pageId?: string;
    timeoutMs?: number;
  },
): Promise<PageSummary> {
  const { page, pageId, selector } = await resolveActionTarget(deps, options);
  const result = await runActionWithVerification(
    deps,
    page,
    async (currentPage) => {
      await currentPage
        .locator(selector)
        .setTimeout(options.timeoutMs ?? deps.config.stepTimeoutMs)
        .click();
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: 0,
      requireObservedChange: false,
    },
  );

  return deps.summarizePage(
    result.pageSource === "current" ? pageId : deps.requirePageId(result.finalPage),
    result.finalPage,
  );
}

export async function clickAndWaitWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    pageId?: string;
    timeoutMs?: number;
    waitForNavigation?: boolean;
    waitUntil?: WaitUntilMode;
    waitForSelector?: string;
    waitForTitle?: string;
    waitForUrl?: string;
    matchMode?: WaitMatchMode;
  },
): Promise<ClickAndWaitResult> {
  const { page, selector } = await resolveActionTarget(deps, options);
  const verifications: ActionVerificationRule[] = [];

  if (options.waitForUrl) {
    verifications.push({
      kind: "url",
      expected: options.waitForUrl,
      matchMode: options.matchMode,
    });
  }

  if (options.waitForTitle) {
    verifications.push({
      kind: "title",
      expected: options.waitForTitle,
      matchMode: options.matchMode,
    });
  }

  const observation = await runActionWithVerification(
    deps,
    page,
    async (currentPage) => {
      await currentPage
        .locator(selector)
        .setTimeout(options.timeoutMs ?? deps.config.stepTimeoutMs)
        .click();
    },
    {
      timeoutMs: options.timeoutMs,
      waitForNavigation: options.waitForNavigation,
      waitUntil: options.waitUntil,
      waitForSelector: options.waitForSelector,
      waitForTitle: options.waitForTitle,
      waitForUrl: options.waitForUrl,
      matchMode: options.matchMode,
      requireObservedChange: true,
      verifications,
    },
  );

  return {
    page: await deps.summarizePage(
      deps.requirePageId(observation.finalPage),
      observation.finalPage,
    ),
    selector,
    pageSource: observation.pageSource,
    before: observation.before,
    after: observation.after,
    changed: observation.changed,
    observed: observation.observed,
    note:
      observation.attempts > 1
        ? `已重试 ${observation.attempts} 次。`
        : observation.note,
  };
}

export async function typeTextWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    text: string;
    pageId?: string;
    clear: boolean;
    submit: boolean;
    timeoutMs?: number;
  },
): Promise<PageSummary> {
  const { page, pageId, selector } = await resolveActionTarget(deps, options);
  const observation = await runActionWithVerification(
    deps,
    page,
    async (currentPage) => {
      const locator = currentPage
        .locator(selector)
        .setTimeout(options.timeoutMs ?? deps.config.stepTimeoutMs);

      await locator.click({ clickCount: 3 });
      if (options.clear) {
        await locator.fill("");
        await locator.fill(options.text);
      } else {
        await currentPage.keyboard.type(options.text);
      }
      if (options.submit) {
        await currentPage.keyboard.press("Enter");
      }
    },
    {
      timeoutMs: options.timeoutMs,
      requireObservedChange: false,
      verifications: [
        {
          kind: "inputValue",
          selector,
          expected: options.text,
          matchMode: options.clear ? "exact" : "contains",
        },
      ],
    },
  );

  return deps.summarizePage(
    observation.pageSource === "current"
      ? pageId
      : deps.requirePageId(observation.finalPage),
    observation.finalPage,
  );
}

export async function pressKeyWithRuntime(
  deps: BrowserRuntimeDeps,
  key: string,
  pageId?: string,
): Promise<PageSummary> {
  const page = await deps.resolvePage(pageId);
  const resolvedPageId = deps.requirePageId(page);
  await page.keyboard.press(key as KeyInput);
  return deps.summarizePage(resolvedPageId, page);
}

async function resolveActionTarget(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    pageId?: string;
  },
): Promise<{
  page: Page;
  pageId: string;
  selector: string;
}> {
  const page = await deps.resolvePage(options.pageId);
  const pageId = deps.requirePageId(page);

  if (options.ref) {
    return {
      page,
      pageId,
      selector: deps.resolveSelectorForRef(pageId, options.ref),
    };
  }

  if (!options.selector) {
    throw new Error("selector 和 ref 至少要提供一个。");
  }

  return {
    page,
    pageId,
    selector: options.selector,
  };
}

