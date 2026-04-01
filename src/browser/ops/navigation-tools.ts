import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import type { NavigateResult, PageSummary, WaitMatchMode } from "../core/types.js";
import type { WaitUntilMode } from "../../config.js";

export async function openPageWithRuntime(
  deps: BrowserRuntimeDeps,
  url?: string,
): Promise<PageSummary> {
  const browser = await deps.ensureBrowser();
  if (!browser) {
    throw new Error("浏览器没有成功启动。");
  }

  const { page, pageId } = await resolveOpenPageTarget(deps, browser);

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  await page.bringToFront();
  deps.setCurrentPageId(pageId);

  return deps.summarizePage(pageId, page);
}

async function resolveOpenPageTarget(
  deps: BrowserRuntimeDeps,
  browser: NonNullable<Awaited<ReturnType<BrowserRuntimeDeps["ensureBrowser"]>>>,
): Promise<{
  page: Awaited<ReturnType<BrowserRuntimeDeps["resolvePage"]>>;
  pageId: string;
}> {
  await deps.syncPages();

  if (deps.isManagedBrowser()) {
    const trackedPages = Array.from(deps.getPages().entries());
    if (trackedPages.length === 1) {
      const [existingPageId, existingPage] = trackedPages[0];
      const existingTitle = (await existingPage.title().catch(() => "")).trim();
      if (existingPage.url() === "about:blank" && !existingTitle) {
        deps.applyTimeouts(existingPage);
        await deps.instrumentPage(existingPageId, existingPage);
        return {
          page: existingPage,
          pageId: existingPageId,
        };
      }
    }
  }

  const page = await browser.newPage();
  const pageId = deps.trackPage(page);
  deps.applyTimeouts(page);
  await deps.instrumentPage(pageId, page);
  return { page, pageId };
}

export async function selectPageWithRuntime(
  deps: BrowserRuntimeDeps,
  pageId: string,
): Promise<PageSummary> {
  await deps.syncPages();
  const page = deps.getPages().get(pageId);
  if (!page) {
    throw new Error(`找不到页面: ${pageId}`);
  }

  await page.bringToFront();
  deps.setCurrentPageId(pageId);
  return deps.summarizePage(pageId, page);
}

export async function navigateWithRuntime(
  deps: BrowserRuntimeDeps,
  url: string,
  pageId?: string,
  waitUntil: WaitUntilMode = "domcontentloaded",
): Promise<NavigateResult> {
  const page = await deps.resolvePage(pageId);
  const resolvedPageId = deps.requirePageId(page);
  const response = await page.goto(url, { waitUntil });

  await page.bringToFront();
  deps.setCurrentPageId(resolvedPageId);

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    responseStatus: response?.status(),
  };
}

export async function goBackWithRuntime(
  deps: BrowserRuntimeDeps,
  pageId?: string,
  waitUntil: WaitUntilMode = "domcontentloaded",
): Promise<NavigateResult> {
  const page = await deps.resolvePage(pageId);
  const resolvedPageId = deps.requirePageId(page);
  const response = await page.goBack({ waitUntil });

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    responseStatus: response?.status(),
  };
}

export async function reloadPageWithRuntime(
  deps: BrowserRuntimeDeps,
  pageId?: string,
  waitUntil: WaitUntilMode = "domcontentloaded",
): Promise<NavigateResult> {
  const page = await deps.resolvePage(pageId);
  const resolvedPageId = deps.requirePageId(page);
  const response = await page.reload({ waitUntil });

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    responseStatus: response?.status(),
  };
}

export async function waitForWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    pageId?: string;
    selector?: string;
    text?: string;
    textSelector?: string;
    title?: string;
    url?: string;
    matchMode: WaitMatchMode;
    timeoutMs?: number;
  },
): Promise<PageSummary> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;

  if (options.selector) {
    await page.waitForSelector(options.selector, {
      visible: true,
      timeout: timeoutMs,
    });
  }

  if (options.text) {
    await page.waitForFunction(
      ({ text, selector, matchMode }) => {
        const normalize = (value: string | null | undefined) =>
          (value ?? "").replace(/\s+/g, " ").trim();

        const matches = (actual: string) => {
          const normalizedActual = normalize(actual);
          const normalizedExpected = normalize(text);
          if (matchMode === "exact") {
            return normalizedActual === normalizedExpected;
          }

          return normalizedActual.includes(normalizedExpected);
        };

        if (selector) {
          const element = document.querySelector(selector);
          if (!element) {
            return false;
          }

          const htmlElement = element as HTMLElement;
          return matches(htmlElement.innerText ?? htmlElement.textContent ?? "");
        }

        return matches(document.body?.innerText ?? "");
      },
      { timeout: timeoutMs },
      {
        text: options.text,
        selector: options.textSelector,
        matchMode: options.matchMode,
      },
    );
  }

  if (options.title) {
    await page.waitForFunction(
      ({ title, matchMode }) => {
        const normalize = (value: string | null | undefined) =>
          (value ?? "").replace(/\s+/g, " ").trim();
        const normalizedActual = normalize(document.title);
        const normalizedExpected = normalize(title);

        if (matchMode === "exact") {
          return normalizedActual === normalizedExpected;
        }

        return normalizedActual.includes(normalizedExpected);
      },
      { timeout: timeoutMs },
      {
        title: options.title,
        matchMode: options.matchMode,
      },
    );
  }

  if (options.url) {
    await page.waitForFunction(
      ({ url, matchMode }) => {
        const actual = location.href;
        if (matchMode === "exact") {
          return actual === url;
        }

        return actual.includes(url);
      },
      { timeout: timeoutMs },
      {
        url: options.url,
        matchMode: options.matchMode,
      },
    );
  }

  return deps.summarizePage(resolvedPageId, page);
}

