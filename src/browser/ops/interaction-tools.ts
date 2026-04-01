import type { KeyInput, Page } from "puppeteer-core";
import type { WaitUntilMode } from "../../config.js";
import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import type {
  ClickAndWaitResult,
  PageSummary,
  WaitMatchMode,
} from "../core/types.js";
import { observeAction } from "../flow/action-observer.js";
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
  await page
    .locator(selector)
    .setTimeout(options.timeoutMs ?? deps.config.defaultTimeoutMs)
    .click();

  return deps.summarizePage(pageId, page);
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

  const observation = await observeAction(
    deps,
    page,
    async () => {
      await page
        .locator(selector)
        .setTimeout(options.timeoutMs ?? deps.config.defaultTimeoutMs)
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
    note: observation.note,
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
  const locator = page
    .locator(selector)
    .setTimeout(options.timeoutMs ?? deps.config.defaultTimeoutMs);

  await locator.click({ clickCount: 3 });
  if (options.clear) {
    await locator.fill("");
  }
  if (options.clear) {
    await locator.fill(options.text);
  } else {
    await page.keyboard.type(options.text);
  }
  if (options.submit) {
    await page.keyboard.press("Enter");
  }
  return deps.summarizePage(pageId, page);
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

