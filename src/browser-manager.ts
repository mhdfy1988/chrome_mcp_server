import fs from "node:fs/promises";
import path from "node:path";
import util from "node:util";
import puppeteer, {
  type Browser,
  type ElementHandle,
  type KeyInput,
  type Page,
} from "puppeteer-core";
import type { ChromeConfig, WaitUntilMode } from "./config.js";

interface PageSummary {
  pageId: string;
  title: string;
  url: string;
  isCurrent: boolean;
}

interface BrowserStatus {
  connected: boolean;
  browserMode: "launch" | "connect_browser_url" | "connect_ws_endpoint";
  launchedByManager: boolean;
  headless: boolean;
  defaultTimeoutMs: number;
  navigationTimeoutMs: number;
  userDataDir?: string;
  pages: PageSummary[];
}

interface ConsoleLogEntry {
  pageId: string;
  type: string;
  text: string;
  timestamp: string;
  location?: string;
}

interface NetworkLogEntry {
  pageId: string;
  method: string;
  status: number;
  statusText: string;
  url: string;
  timestamp: string;
}

interface NavigateResult {
  page: PageSummary;
  responseStatus?: number;
}

interface ScreenshotResult {
  page: PageSummary;
  mimeType: string;
  base64Data: string;
  savedPath?: string;
}

interface SnapshotElementSummary {
  index: number;
  tag: string;
  role?: string;
  explicitRole?: string;
  type?: string;
  text?: string;
  value?: string;
  accessibleName?: string;
  label?: string;
  placeholder?: string;
  selector: string;
  href?: string;
  disabled: boolean;
  checked?: boolean;
}

interface PageSnapshotResult {
  page: PageSummary;
  headings: string[];
  textPreview: string;
  interactiveElements: SnapshotElementSummary[];
}

interface FindElementsResult {
  page: PageSummary;
  query: string;
  total: number;
  elements: Array<
    SnapshotElementSummary & {
      matchReasons: string[];
      matchScore: number;
    }
  >;
}

interface PrimaryInputCandidate {
  index: number;
  tag: string;
  type?: string;
  role?: string;
  selector: string;
  accessibleName?: string;
  label?: string;
  placeholder?: string;
  title?: string;
  name?: string;
  className?: string;
  inForm: boolean;
  formSelector?: string;
  formAction?: string;
  score: number;
  scoreBreakdown: Array<{
    reason: string;
    score: number;
  }>;
}

interface FindPrimaryInputsResult {
  page: PageSummary;
  total: number;
  candidates: PrimaryInputCandidate[];
}

interface SubmitInputResult {
  page: PageSummary;
  selector: string;
  before: {
    title: string;
    url: string;
  };
  changed: boolean;
  strategy?: "enter" | "form_request_submit" | "form_submit" | "nearby_click";
  attempts: Array<{
    strategy: "enter" | "form_request_submit" | "form_submit" | "nearby_click";
    changed: boolean;
    note?: string;
  }>;
}

interface ActionWaitOptions {
  timeoutMs?: number;
  waitForNavigation?: boolean;
  waitUntil?: WaitUntilMode;
  waitForSelector?: string;
  waitForTitle?: string;
  waitForUrl?: string;
  matchMode?: WaitMatchMode;
}

interface ActionObservationResult {
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
  observed: {
    navigation: boolean;
    selector: boolean;
    title: boolean;
    url: boolean;
    stateChanged: boolean;
    popup: boolean;
    target: boolean;
    pageCountChanged: boolean;
  };
  note?: string;
}

interface ClickAndWaitResult {
  page: PageSummary;
  selector: string;
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
  observed: {
    navigation: boolean;
    selector: boolean;
    title: boolean;
    url: boolean;
    stateChanged: boolean;
    popup: boolean;
    target: boolean;
    pageCountChanged: boolean;
  };
  note?: string;
}

type WaitMatchMode = "contains" | "exact";

const MAX_LOG_ENTRIES = 200;

export class BrowserManager {
  private browser?: Browser;
  private launchedByManager = false;
  private readonly pageIds = new WeakMap<Page, string>();
  private readonly pages = new Map<string, Page>();
  private readonly instrumentedPageIds = new Set<string>();
  private readonly consoleLogs = new Map<string, ConsoleLogEntry[]>();
  private readonly networkLogs = new Map<string, NetworkLogEntry[]>();
  private currentPageId?: string;
  private pageCounter = 1;

  public constructor(private readonly config: ChromeConfig) {}

  public async getStatus(): Promise<BrowserStatus> {
    const pages = await this.listPages(false);

    return {
      connected: Boolean(this.browser?.connected),
      browserMode: this.getBrowserMode(),
      launchedByManager: this.launchedByManager,
      headless: this.config.headless,
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      navigationTimeoutMs: this.config.navigationTimeoutMs,
      userDataDir: this.config.userDataDir,
      pages,
    };
  }

  public async listPages(startBrowserIfNeeded = true): Promise<PageSummary[]> {
    const browser = await this.ensureBrowser(startBrowserIfNeeded);
    if (!browser) {
      return [];
    }

    await this.syncPages();

    const summaries: PageSummary[] = [];
    for (const [pageId, page] of this.pages.entries()) {
      summaries.push(await this.summarizePage(pageId, page));
    }

    return summaries;
  }

  public async openPage(url?: string): Promise<PageSummary> {
    const browser = await this.ensureBrowser();
    if (!browser) {
      throw new Error("浏览器没有成功启动。");
    }

    const page = await browser.newPage();
    const pageId = this.trackPage(page);

    this.applyTimeouts(page);
    await this.instrumentPage(pageId, page);

    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    await page.bringToFront();
    this.currentPageId = pageId;

    return this.summarizePage(pageId, page);
  }

  public async selectPage(pageId: string): Promise<PageSummary> {
    const page = await this.getPageById(pageId);
    await page.bringToFront();
    this.currentPageId = pageId;
    return this.summarizePage(pageId, page);
  }

  public async navigate(
    url: string,
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    const response = await page.goto(url, { waitUntil });

    await page.bringToFront();
    this.currentPageId = resolvedPageId;

    return {
      page: await this.summarizePage(resolvedPageId, page),
      responseStatus: response?.status(),
    };
  }

  public async goBack(
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    const response = await page.goBack({ waitUntil });

    return {
      page: await this.summarizePage(resolvedPageId, page),
      responseStatus: response?.status(),
    };
  }

  public async reloadPage(
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    const response = await page.reload({ waitUntil });

    return {
      page: await this.summarizePage(resolvedPageId, page),
      responseStatus: response?.status(),
    };
  }

  public async waitFor(options: {
    pageId?: string;
    selector?: string;
    text?: string;
    textSelector?: string;
    title?: string;
    url?: string;
    matchMode: WaitMatchMode;
    timeoutMs: number;
  }): Promise<PageSummary> {
    const page = await this.resolvePage(options.pageId);
    const resolvedPageId = this.requirePageId(page);

    if (options.selector) {
      await page.waitForSelector(options.selector, {
        visible: true,
        timeout: options.timeoutMs,
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
        { timeout: options.timeoutMs },
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
        { timeout: options.timeoutMs },
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
        { timeout: options.timeoutMs },
        {
          url: options.url,
          matchMode: options.matchMode,
        },
      );
    }

    return this.summarizePage(resolvedPageId, page);
  }

  private async capturePageState(page: Page): Promise<{
    title: string;
    url: string;
  }> {
    return {
      title: await page.title(),
      url: page.url(),
    };
  }

  private normalizeUrlForComparison(value: string): string {
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

  private hasMeaningfulPageChange(
    before: { title: string; url: string },
    after: { title: string; url: string },
  ): boolean {
    return (
      before.title !== after.title ||
      this.normalizeUrlForComparison(before.url) !==
        this.normalizeUrlForComparison(after.url)
    );
  }

  private async waitForActionConditions(
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

  private async observeAction(
    page: Page,
    action: () => Promise<void>,
    options: ActionWaitOptions = {},
  ): Promise<ActionObservationResult> {
    const browser = await this.ensureBrowser();
    if (!browser) {
      throw new Error("浏览器没有成功启动。");
    }

    const before = await this.capturePageState(page);
    const timeoutMs = options.timeoutMs ?? this.config.defaultTimeoutMs;
    const waitUntil = options.waitUntil ?? "domcontentloaded";
    const followupTimeoutMs = Math.min(timeoutMs, 2000);
    const beforeTargets = new Set(browser.targets());
    const beforePageCount = (await browser.pages()).length;
    const sourceTarget = page.target();

    const observed = {
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
      key: keyof Omit<typeof observed, "stateChanged">,
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
      this.waitForActionConditions(page, options, observed, timeoutMs),
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

    await action();

    if (waiters.length > 0) {
      await Promise.allSettled(waiters);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const popupPage = await Promise.race([
      popupPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), followupTimeoutMs)),
    ]);
    page.off("popup", popupHandler);

    const targetPage = await Promise.race([
      targetPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), followupTimeoutMs)),
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

    await this.syncPages();

    const afterPageCount = this.pages.size;
    observed.pageCountChanged = afterPageCount !== beforePageCount;

    if (finalPage !== page) {
      const finalPageId = this.trackPage(finalPage);
      this.applyTimeouts(finalPage);
      await this.instrumentPage(finalPageId, finalPage);
      await this.waitForActionConditions(
        finalPage,
        options,
        observed,
        Math.min(timeoutMs, 5000),
      );
      await finalPage.bringToFront().catch(() => {
        // 如果 bringToFront 失败，仍然继续读取真实页面状态。
      });
      this.currentPageId = finalPageId;
    }

    const after = await this.capturePageState(finalPage);
    observed.stateChanged =
      finalPage !== page || this.hasMeaningfulPageChange(before, after);

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

  public async click(
    selector: string,
    pageId?: string,
    timeoutMs?: number,
  ): Promise<PageSummary> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    await page
      .locator(selector)
      .setTimeout(timeoutMs ?? this.config.defaultTimeoutMs)
      .click();

    return this.summarizePage(resolvedPageId, page);
  }

  public async clickAndWait(options: {
    selector: string;
    pageId?: string;
    timeoutMs?: number;
    waitForNavigation?: boolean;
    waitUntil?: WaitUntilMode;
    waitForSelector?: string;
    waitForTitle?: string;
    waitForUrl?: string;
    matchMode?: WaitMatchMode;
  }): Promise<ClickAndWaitResult> {
    const page = await this.resolvePage(options.pageId);

    const observation = await this.observeAction(
      page,
      async () => {
        await page
          .locator(options.selector)
          .setTimeout(options.timeoutMs ?? this.config.defaultTimeoutMs)
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
      page: await this.summarizePage(
        this.requirePageId(observation.finalPage),
        observation.finalPage,
      ),
      selector: options.selector,
      pageSource: observation.pageSource,
      before: observation.before,
      after: observation.after,
      changed: observation.changed,
      observed: observation.observed,
      note: observation.note,
    };
  }

  public async typeText(options: {
    selector: string;
    text: string;
    pageId?: string;
    clear: boolean;
    submit: boolean;
    timeoutMs?: number;
  }): Promise<PageSummary> {
    const page = await this.resolvePage(options.pageId);
    const resolvedPageId = this.requirePageId(page);
    const locator = page
      .locator(options.selector)
      .setTimeout(options.timeoutMs ?? this.config.defaultTimeoutMs);

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
    return this.summarizePage(resolvedPageId, page);
  }

  public async pressKey(key: string, pageId?: string): Promise<PageSummary> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    await page.keyboard.press(key as KeyInput);
    return this.summarizePage(resolvedPageId, page);
  }

  public async extractText(options: {
    pageId?: string;
    selector?: string;
    maxLength: number;
  }): Promise<{ page: PageSummary; text: string }> {
    const page = await this.resolvePage(options.pageId);
    const resolvedPageId = this.requirePageId(page);

    let rawText = "";
    if (options.selector) {
      const handle = await page.waitForSelector(options.selector, {
        visible: true,
        timeout: this.config.defaultTimeoutMs,
      });

      if (!handle) {
        throw new Error(`未找到元素: ${options.selector}`);
      }

      rawText = await this.readTextFromHandle(handle);
      await handle.dispose();
    } else {
      rawText = await page.evaluate(() => document.body?.innerText ?? "");
    }

    return {
      page: await this.summarizePage(resolvedPageId, page),
      text: rawText.slice(0, options.maxLength),
    };
  }

  public async pageSnapshot(options: {
    pageId?: string;
    maxTextLength: number;
    maxElements: number;
  }): Promise<PageSnapshotResult> {
    const page = await this.resolvePage(options.pageId);
    const resolvedPageId = this.requirePageId(page);
    const snapshot = await page.evaluate(
      ({ maxTextLength, maxElements }) => {
        const normalizeWhitespace = (value: string | null | undefined) =>
          (value ?? "").replace(/\s+/g, " ").trim();

        const clipText = (value: string, maxLength: number) => {
          if (value.length <= maxLength) {
            return value;
          }

          return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
        };

        const escapeSelector = (value: string) => {
          if (globalThis.CSS?.escape) {
            return globalThis.CSS.escape(value);
          }

          return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
        };

        const quoteAttribute = (value: string) =>
          `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

        const isVisible = (element: Element) => {
          const htmlElement = element as HTMLElement;
          const style = window.getComputedStyle(htmlElement);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return false;
          }

          const rect = htmlElement.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const isUniqueSelector = (selector: string) => {
          try {
            return document.querySelectorAll(selector).length === 1;
          } catch {
            return false;
          }
        };

        const buildPathSelector = (element: Element) => {
          const segments: string[] = [];
          let current: Element | null = element;

          while (current && current !== document.body && segments.length < 5) {
            const htmlElement = current as HTMLElement;
            const tag = current.tagName.toLowerCase();
            const id = normalizeWhitespace(htmlElement.id);

            if (id) {
              segments.unshift(`#${escapeSelector(id)}`);
              break;
            }

            let segment = tag;
            const classNames = Array.from(current.classList)
              .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
              .slice(0, 2);
            if (classNames.length > 0) {
              segment += classNames
                .map((className) => `.${escapeSelector(className)}`)
                .join("");
            }

            const parent = current.parentElement;
            if (parent) {
              const sameTagSiblings = Array.from(parent.children).filter(
                (child) => child.tagName === current?.tagName,
              );
              if (sameTagSiblings.length > 1) {
                const index = sameTagSiblings.indexOf(current) + 1;
                segment += `:nth-of-type(${index})`;
              }
            }

            segments.unshift(segment);
            current = current.parentElement;
          }

          return segments.join(" > ");
        };

        const buildSelector = (element: Element) => {
          const htmlElement = element as HTMLElement;
          const tag = element.tagName.toLowerCase();
          const id = normalizeWhitespace(htmlElement.id);
          if (id) {
            const selector = `#${escapeSelector(id)}`;
            if (isUniqueSelector(selector)) {
              return selector;
            }
          }

          const role = normalizeWhitespace(element.getAttribute("role"));
          if (role) {
            const selector = `${tag}[role=${quoteAttribute(role)}]`;
            if (isUniqueSelector(selector)) {
              return selector;
            }
          }

          const name = normalizeWhitespace(element.getAttribute("name"));
          if (name) {
            const selector = `${tag}[name=${quoteAttribute(name)}]`;
            if (isUniqueSelector(selector)) {
              return selector;
            }
          }

          const ariaLabel = normalizeWhitespace(
            element.getAttribute("aria-label"),
          );
          if (ariaLabel) {
            const selector = `${tag}[aria-label=${quoteAttribute(ariaLabel)}]`;
            if (isUniqueSelector(selector)) {
              return selector;
            }
          }

          const placeholder = normalizeWhitespace(
            element.getAttribute("placeholder"),
          );
          if (placeholder) {
            const selector = `${tag}[placeholder=${quoteAttribute(placeholder)}]`;
            if (isUniqueSelector(selector)) {
              return selector;
            }
          }

          if (element instanceof HTMLInputElement) {
            const type = normalizeWhitespace(element.getAttribute("type"));
            if (type) {
              const selector = `${tag}[type=${quoteAttribute(type)}]`;
              if (isUniqueSelector(selector)) {
                return selector;
              }
            }
            if (type && name) {
              const selector = `${tag}[type=${quoteAttribute(type)}][name=${quoteAttribute(name)}]`;
              if (isUniqueSelector(selector)) {
                return selector;
              }
            }
          }

          if (element instanceof HTMLAnchorElement) {
            const href = normalizeWhitespace(element.getAttribute("href"));
            if (href) {
              const selector = `a[href=${quoteAttribute(href)}]`;
              if (isUniqueSelector(selector)) {
                return selector;
              }
            }
          }

          return buildPathSelector(element);
        };

        const findAssociatedLabel = (element: HTMLElement) => {
          const id = normalizeWhitespace(element.id);
          if (id) {
            const label = document.querySelector(
              `label[for=${quoteAttribute(id)}]`,
            );
            const labelText = normalizeWhitespace(label?.textContent);
            if (labelText) {
              return labelText;
            }
          }

          const wrappingLabel = element.closest("label");
          const wrappingLabelText = normalizeWhitespace(
            wrappingLabel?.textContent,
          );
          if (wrappingLabelText) {
            return wrappingLabelText;
          }

          return undefined;
        };

        const findAriaLabelledByText = (element: Element) => {
          const ariaLabelledBy = normalizeWhitespace(
            element.getAttribute("aria-labelledby"),
          );
          if (!ariaLabelledBy) {
            return undefined;
          }

          const labelText = ariaLabelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .map((labelElement) =>
              normalizeWhitespace(
                (labelElement as HTMLElement | null)?.innerText ??
                  labelElement?.textContent,
              ),
            )
            .filter(Boolean)
            .join(" ");

          return labelText || undefined;
        };

        const inferImplicitRole = (element: Element) => {
          if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) {
            return "link";
          }

          if (element instanceof HTMLButtonElement) {
            return "button";
          }

          if (element instanceof HTMLInputElement) {
            const type = normalizeWhitespace(element.type).toLowerCase();
            switch (type) {
              case "button":
              case "submit":
              case "reset":
              case "image":
                return "button";
              case "checkbox":
                return "checkbox";
              case "radio":
                return "radio";
              case "range":
                return "slider";
              case "number":
                return "spinbutton";
              case "search":
                return "searchbox";
              case "email":
              case "tel":
              case "text":
              case "url":
              case "password":
                return "textbox";
              default:
                return undefined;
            }
          }

          if (element instanceof HTMLTextAreaElement) {
            return "textbox";
          }

          if (element instanceof HTMLSelectElement) {
            return element.multiple || element.size > 1 ? "listbox" : "combobox";
          }

          if (element instanceof HTMLElement && element.tagName.toLowerCase() === "summary") {
            return "button";
          }

          if (element instanceof HTMLElement && element.contentEditable === "true") {
            return "textbox";
          }

          return undefined;
        };

        const findAccessibleName = (element: Element) => {
          const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
          if (ariaLabel) {
            return ariaLabel;
          }

          const ariaLabelledByText = findAriaLabelledByText(element);
          if (ariaLabelledByText) {
            return ariaLabelledByText;
          }

          const associatedLabel = findAssociatedLabel(element as HTMLElement);
          if (associatedLabel) {
            return associatedLabel;
          }

          if (element instanceof HTMLInputElement) {
            const type = normalizeWhitespace(element.type).toLowerCase();
            if (type === "submit" || type === "button" || type === "reset") {
              const value = normalizeWhitespace(element.value);
              if (value) {
                return value;
              }
            }
          }

          const text = clipText(
            normalizeWhitespace(
              (element as HTMLElement).innerText ?? element.textContent,
            ),
            120,
          );
          if (text) {
            return text;
          }

          const title = normalizeWhitespace(element.getAttribute("title"));
          if (title) {
            return title;
          }

          const placeholder = normalizeWhitespace(
            element.getAttribute("placeholder"),
          );
          if (placeholder) {
            return placeholder;
          }

          const name = normalizeWhitespace(element.getAttribute("name"));
          if (name) {
            return name;
          }

          return undefined;
        };

        const query =
          'a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [contenteditable="true"]';

        const interactiveElements = Array.from(
          new Set(
            Array.from(document.querySelectorAll(query)).filter((element) =>
              isVisible(element),
            ),
          ),
        )
          .slice(0, maxElements)
          .map((element, index) => {
            const htmlElement = element as HTMLElement;
            const explicitRole = normalizeWhitespace(element.getAttribute("role"));
            const role = explicitRole || inferImplicitRole(element);
            const text = clipText(
              normalizeWhitespace(htmlElement.innerText ?? htmlElement.textContent),
              120,
            );
            const label = findAssociatedLabel(htmlElement);
            const accessibleName = findAccessibleName(element);
            const placeholder = normalizeWhitespace(
              element.getAttribute("placeholder"),
            );

            let value: string | undefined;
            let type: string | undefined;
            let checked: boolean | undefined;
            let href: string | undefined;
            let disabled = htmlElement.getAttribute("aria-disabled") === "true";

            if (element instanceof HTMLInputElement) {
              value = clipText(normalizeWhitespace(element.value), 120);
              type = normalizeWhitespace(element.type);
              checked = element.checked;
              disabled = disabled || element.disabled;
            } else if (element instanceof HTMLTextAreaElement) {
              value = clipText(normalizeWhitespace(element.value), 120);
              disabled = disabled || element.disabled;
            } else if (element instanceof HTMLSelectElement) {
              value = clipText(normalizeWhitespace(element.value), 120);
              disabled = disabled || element.disabled;
            } else if (element instanceof HTMLButtonElement) {
              disabled = disabled || element.disabled;
            } else if (element instanceof HTMLAnchorElement) {
              href = element.href;
            }

            return {
              index: index + 1,
              tag: element.tagName.toLowerCase(),
              role: role || undefined,
              explicitRole: explicitRole || undefined,
              type: type || undefined,
              text: text || undefined,
              value: value || undefined,
              accessibleName,
              label,
              placeholder: placeholder || undefined,
              selector: buildSelector(element),
              href,
              disabled,
              checked,
            };
          });

        const headings = Array.from(
          document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
        )
          .filter((element) => isVisible(element))
          .map((element) => clipText(normalizeWhitespace(element.textContent), 120))
          .filter(Boolean)
          .slice(0, 20);

        const textPreview = clipText(
          normalizeWhitespace(document.body?.innerText ?? ""),
          maxTextLength,
        );

        return {
          headings,
          textPreview,
          interactiveElements,
        };
      },
      {
        maxTextLength: options.maxTextLength,
        maxElements: options.maxElements,
      },
    );

    return {
      page: await this.summarizePage(resolvedPageId, page),
      headings: snapshot.headings,
      textPreview: snapshot.textPreview,
      interactiveElements: snapshot.interactiveElements,
    };
  }

  public async findElements(options: {
    pageId?: string;
    query: string;
    matchMode: WaitMatchMode;
    tag?: string;
    role?: string;
    maxResults: number;
    inspectLimit: number;
  }): Promise<FindElementsResult> {
    const snapshot = await this.pageSnapshot({
      pageId: options.pageId,
      maxTextLength: 1000,
      maxElements: options.inspectLimit,
    });

    const query = options.query.trim();
    const normalizedQuery = query.toLocaleLowerCase();
    const normalizedTag = options.tag?.trim().toLocaleLowerCase();
    const normalizedRole = options.role?.trim().toLocaleLowerCase();

    const getMatchScore = (
      value: string | undefined,
      containsScore: number,
      exactScore = containsScore + 3,
    ) => {
      if (!value) {
        return 0;
      }

      const normalizedValue = value.toLocaleLowerCase();
      if (options.matchMode === "exact") {
        return normalizedValue === normalizedQuery ? exactScore : 0;
      }

      return normalizedValue.includes(normalizedQuery) ? containsScore : 0;
    };

    const allMatches = snapshot.interactiveElements
      .map((element) => {
        if (normalizedTag && element.tag.toLocaleLowerCase() !== normalizedTag) {
          return null;
        }

        if (
          normalizedRole &&
          (element.role?.toLocaleLowerCase() ?? "") !== normalizedRole
        ) {
          return null;
        }

        const matchReasons: string[] = [];
        let matchScore = 0;

        const collectMatch = (
          reason: string,
          score: number,
        ) => {
          if (score <= 0) {
            return;
          }
          matchReasons.push(reason);
          matchScore += score;
        };

        collectMatch(
          "accessibleName",
          getMatchScore(element.accessibleName, 12),
        );
        collectMatch("label", getMatchScore(element.label, 10));
        collectMatch("text", getMatchScore(element.text, 8));
        collectMatch("placeholder", getMatchScore(element.placeholder, 7));
        collectMatch("value", getMatchScore(element.value, 6));
        collectMatch("href", getMatchScore(element.href, 4));
        collectMatch("selector", getMatchScore(element.selector, 3));

        if (matchScore <= 0) {
          return null;
        }

        return {
          ...element,
          matchReasons,
          matchScore,
        };
      })
      .filter(
        (
          element,
        ): element is SnapshotElementSummary & {
          matchReasons: string[];
          matchScore: number;
        } => Boolean(element),
      )
      .sort((left, right) => right.matchScore - left.matchScore || left.index - right.index);

    const matchedElements = allMatches.slice(0, options.maxResults);

    return {
      page: snapshot.page,
      query,
      total: allMatches.length,
      elements: matchedElements,
    };
  }

  public async findPrimaryInputs(options: {
    pageId?: string;
    maxResults: number;
  }): Promise<FindPrimaryInputsResult> {
    const page = await this.resolvePage(options.pageId);
    const resolvedPageId = this.requirePageId(page);

    const result = await page.evaluate((maxResults) => {
      const normalizeWhitespace = (value: unknown) =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim();

      const clipText = (value: string, maxLength: number) =>
        value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;

      const escapeSelector = (value: string) => {
        if (
          typeof (window as Window & { CSS?: { escape?: (value: string) => string } })
            .CSS?.escape === "function"
        ) {
          return (
            window as Window & { CSS: { escape: (value: string) => string } }
          ).CSS.escape(value);
        }

        return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
      };

      const quoteAttribute = (value: string) =>
        `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

      const isVisible = (element: Element) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return false;
        }

        const rect = htmlElement.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const isUniqueSelector = (selector: string) => {
        try {
          return document.querySelectorAll(selector).length === 1;
        } catch {
          return false;
        }
      };

      const buildPathSelector = (element: Element) => {
        const segments: string[] = [];
        let current: Element | null = element;

        while (current && current !== document.body && segments.length < 5) {
          const htmlElement = current as HTMLElement;
          const tag = current.tagName.toLowerCase();
          const id = normalizeWhitespace(htmlElement.id);

          if (id) {
            segments.unshift(`#${escapeSelector(id)}`);
            break;
          }

          let segment = tag;
          const classNames = Array.from(current.classList)
            .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
            .slice(0, 2);
          if (classNames.length > 0) {
            segment += classNames
              .map((className) => `.${escapeSelector(className)}`)
              .join("");
          }

          const parent = current.parentElement;
          if (parent) {
            const sameTagSiblings = Array.from(parent.children).filter(
              (child) => child.tagName === current?.tagName,
            );
            if (sameTagSiblings.length > 1) {
              const index = sameTagSiblings.indexOf(current) + 1;
              segment += `:nth-of-type(${index})`;
            }
          }

          segments.unshift(segment);
          current = current.parentElement;
        }

        return segments.join(" > ");
      };

      const buildSelector = (element: Element) => {
        const htmlElement = element as HTMLElement;
        const tag = element.tagName.toLowerCase();
        const id = normalizeWhitespace(htmlElement.id);
        if (id) {
          const selector = `#${escapeSelector(id)}`;
          if (isUniqueSelector(selector)) {
            return selector;
          }
        }

        const classNames = Array.from(htmlElement.classList)
          .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
          .slice(0, 3);
        if (classNames.length > 0) {
          const selector = `${tag}.${classNames
            .map((className) => escapeSelector(className))
            .join(".")}`;
          if (isUniqueSelector(selector)) {
            return selector;
          }
        }

        const name = normalizeWhitespace(element.getAttribute("name"));
        if (name) {
          const selector = `${tag}[name=${quoteAttribute(name)}]`;
          if (isUniqueSelector(selector)) {
            return selector;
          }
        }

        const placeholder = normalizeWhitespace(
          element.getAttribute("placeholder"),
        );
        if (placeholder) {
          const selector = `${tag}[placeholder=${quoteAttribute(placeholder)}]`;
          if (isUniqueSelector(selector)) {
            return selector;
          }
        }

        if (element instanceof HTMLInputElement) {
          const type = normalizeWhitespace(element.type);
          if (type) {
            const selector = `${tag}[type=${quoteAttribute(type)}]`;
            if (isUniqueSelector(selector)) {
              return selector;
            }
          }
        }

        return buildPathSelector(element);
      };

      const findAssociatedLabel = (element: HTMLElement) => {
        const id = normalizeWhitespace(element.id);
        if (id) {
          const label = document.querySelector(
            `label[for=${quoteAttribute(id)}]`,
          );
          const labelText = normalizeWhitespace(label?.textContent);
          if (labelText) {
            return labelText;
          }
        }

        const wrappingLabel = element.closest("label");
        const wrappingLabelText = normalizeWhitespace(
          wrappingLabel?.textContent,
        );
        if (wrappingLabelText) {
          return wrappingLabelText;
        }

        return undefined;
      };

      const findAriaLabelledByText = (element: Element) => {
        const ariaLabelledBy = normalizeWhitespace(
          element.getAttribute("aria-labelledby"),
        );
        if (!ariaLabelledBy) {
          return undefined;
        }

        const labelText = ariaLabelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .map((labelElement) =>
            normalizeWhitespace(
              (labelElement as HTMLElement | null)?.innerText ??
                labelElement?.textContent,
            ),
          )
          .filter(Boolean)
          .join(" ");

        return labelText || undefined;
      };

      const inferImplicitRole = (element: Element) => {
        if (element instanceof HTMLInputElement) {
          const type = normalizeWhitespace(element.type).toLowerCase();
          switch (type) {
            case "search":
              return "searchbox";
            case "email":
            case "tel":
            case "text":
            case "url":
            case "password":
            case "":
              return "textbox";
            default:
              return undefined;
          }
        }

        if (element instanceof HTMLTextAreaElement) {
          return "textbox";
        }

        if (element instanceof HTMLElement && element.contentEditable === "true") {
          return "textbox";
        }

        return undefined;
      };

      const findAccessibleName = (element: Element) => {
        const ariaLabel = normalizeWhitespace(element.getAttribute("aria-label"));
        if (ariaLabel) {
          return ariaLabel;
        }

        const ariaLabelledByText = findAriaLabelledByText(element);
        if (ariaLabelledByText) {
          return ariaLabelledByText;
        }

        const associatedLabel = findAssociatedLabel(element as HTMLElement);
        if (associatedLabel) {
          return associatedLabel;
        }

        const title = normalizeWhitespace(element.getAttribute("title"));
        if (title) {
          return title;
        }

        const placeholder = normalizeWhitespace(
          element.getAttribute("placeholder"),
        );
        if (placeholder) {
          return placeholder;
        }

        const name = normalizeWhitespace(element.getAttribute("name"));
        if (name) {
          return name;
        }

        return undefined;
      };

      const searchWords = [
        "search",
        "query",
        "keyword",
        "find",
        "搜索",
        "检索",
        "查找",
      ];
      const navWords = ["nav", "navbar", "header", "top", "menu", "导航"];

      const scoreText = (value: string | undefined, words: string[]) => {
        if (!value) {
          return 0;
        }

        const normalizedValue = value.toLocaleLowerCase();
        return words.some((word) => normalizedValue.includes(word)) ? 1 : 0;
      };

      const query =
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]):not([type="date"]):not([type="datetime-local"]):not([type="month"]):not([type="time"]):not([type="week"]), textarea, [contenteditable="true"]';

      const allCandidates = Array.from(document.querySelectorAll(query)).filter(
        (element) => {
          if (!isVisible(element)) {
            return false;
          }

          if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          ) {
            return !element.disabled && !element.readOnly;
          }

          return true;
        },
      );

      const totalVisibleInputs = allCandidates.length;

      const candidates = allCandidates
        .map((element, index) => {
          const htmlElement = element as HTMLElement;
          const rect = htmlElement.getBoundingClientRect();
          const type =
            element instanceof HTMLInputElement
              ? normalizeWhitespace(element.type).toLowerCase()
              : undefined;
          const role = normalizeWhitespace(element.getAttribute("role")) ||
            inferImplicitRole(element);
          const accessibleName = findAccessibleName(element);
          const label = findAssociatedLabel(htmlElement);
          const placeholder = normalizeWhitespace(
            element.getAttribute("placeholder"),
          );
          const title = normalizeWhitespace(element.getAttribute("title"));
          const name = normalizeWhitespace(element.getAttribute("name"));
          const className = normalizeWhitespace(htmlElement.className);
          const form = htmlElement.closest("form");
          const formId = normalizeWhitespace(form?.id);
          const formClass = normalizeWhitespace((form as HTMLElement | null)?.className);
          const formAction = normalizeWhitespace(form?.getAttribute("action"));
          const formSelector = form
            ? buildSelector(form)
            : undefined;
          const ancestorSignals = Array.from(
            new Set(
              Array.from({ length: 4 })
                .reduce<HTMLElement[]>((ancestors, _, depth) => {
                  const current =
                    depth === 0
                      ? htmlElement.parentElement
                      : ancestors[depth - 1]?.parentElement ?? null;
                  if (current) {
                    ancestors.push(current);
                  }
                  return ancestors;
                }, [])
                .flatMap((ancestor) => [
                  normalizeWhitespace(ancestor.id),
                  normalizeWhitespace(ancestor.className),
                  normalizeWhitespace(ancestor.getAttribute("role")),
                  ancestor.tagName.toLowerCase(),
                ])
                .filter(Boolean),
            ),
          );

          const scoreBreakdown: Array<{ reason: string; score: number }> = [];
          const addScore = (reason: string, score: number) => {
            if (score <= 0) {
              return;
            }
            scoreBreakdown.push({ reason, score });
          };

          if (type === "search") {
            addScore("type=search", 14);
          } else if (
            !type ||
            ["text", "email", "tel", "url", "password"].includes(type)
          ) {
            addScore("text-like-input", 8);
          } else if (element instanceof HTMLTextAreaElement) {
            addScore("textarea", 4);
          } else if (
            element instanceof HTMLElement &&
            element.contentEditable === "true"
          ) {
            addScore("contenteditable", 3);
          }

          if (role === "searchbox") {
            addScore("role=searchbox", 12);
          } else if (role === "textbox") {
            addScore("role=textbox", 4);
          }

          if (form) {
            addScore("inside-form", 8);
          }

          if (scoreText(accessibleName, searchWords)) {
            addScore("accessible-name-search-signal", 12);
          }
          if (scoreText(label, searchWords)) {
            addScore("label-search-signal", 10);
          }
          if (scoreText(placeholder, searchWords)) {
            addScore("placeholder-search-signal", 9);
          }
          if (scoreText(title, searchWords)) {
            addScore("title-search-signal", 8);
          }
          if (scoreText(name, searchWords)) {
            addScore("name-search-signal", 7);
          }
          if (scoreText(className, searchWords)) {
            addScore("class-search-signal", 11);
          }
          if (scoreText(formId, searchWords) || scoreText(formClass, searchWords)) {
            addScore("form-search-signal", 11);
          }
          if (scoreText(formAction, searchWords)) {
            addScore("form-action-search-signal", 9);
          }

          if (
            scoreText(className, navWords) ||
            ancestorSignals.some((signal) => scoreText(signal, navWords))
          ) {
            addScore("navigation-signal", 6);
          }

          if (htmlElement.closest("header, nav, [role='navigation']")) {
            addScore("inside-header-or-nav", 7);
          }

          if (rect.top <= 220) {
            addScore("near-top", 5);
          } else if (rect.top <= 420) {
            addScore("upper-page", 2);
          }

          if (rect.width >= 280) {
            addScore("wide-input", 5);
          } else if (rect.width >= 160) {
            addScore("medium-width-input", 2);
          }

          if (totalVisibleInputs === 1) {
            addScore("only-visible-input", 10);
          } else if (totalVisibleInputs <= 3) {
            addScore("few-visible-inputs", 4);
          }

          const score = scoreBreakdown.reduce(
            (sum, item) => sum + item.score,
            0,
          );

          return {
            index: index + 1,
            tag: element.tagName.toLowerCase(),
            type: type || undefined,
            role: role || undefined,
            selector: buildSelector(element),
            accessibleName: accessibleName || undefined,
            label: label || undefined,
            placeholder: placeholder || undefined,
            title: title || undefined,
            name: name || undefined,
            className: className || undefined,
            inForm: Boolean(form),
            formSelector,
            formAction: formAction || undefined,
            score,
            scoreBreakdown,
            top: rect.top,
          };
        })
        .sort((left, right) => right.score - left.score || left.top - right.top)
        .slice(0, maxResults)
        .map(({ top: _top, ...candidate }) => candidate);

      return {
        total: allCandidates.length,
        candidates,
      };
    }, options.maxResults);

    return {
      page: await this.summarizePage(resolvedPageId, page),
      total: result.total,
      candidates: result.candidates,
    };
  }

  public async submitInput(options: {
    selector: string;
    pageId?: string;
    timeoutMs?: number;
  }): Promise<SubmitInputResult> {
    let page = await this.resolvePage(options.pageId);
    const timeoutMs = options.timeoutMs ?? this.config.defaultTimeoutMs;
    const locator = page.locator(options.selector).setTimeout(timeoutMs);

    await locator.wait();

    const before = await this.capturePageState(page);

    const attempts: SubmitInputResult["attempts"] = [];
    let changed = false;

    const runAttempt = async (
      strategy: SubmitInputResult["attempts"][number]["strategy"],
      action: () => Promise<void>,
    ) => {
      const result = await this.observeAction(page, action, {
        timeoutMs: Math.min(timeoutMs, 5000),
        waitForNavigation: true,
      });

      attempts.push({
        strategy,
        changed: result.changed,
        note: result.note,
      });

      page = result.finalPage;

      return result.changed;
    };

    changed = await runAttempt("enter", async () => {
      await locator.click();
      await page.keyboard.press("Enter");
    });

    if (!changed) {
      const requestSubmitResult = await page.$eval(
        options.selector,
        (element) => {
          const htmlElement = element as HTMLElement;
          const form = htmlElement.closest("form");
          if (!form) {
            return { ok: false, note: "未找到 form 容器。" };
          }

          if (typeof form.requestSubmit === "function") {
            return { ok: true };
          }

          return { ok: false, note: "当前 form 不支持 requestSubmit。" };
        },
      );

      if (requestSubmitResult.ok) {
        changed = await runAttempt("form_request_submit", async () => {
          await page.$eval(options.selector, (element) => {
            const htmlElement = element as HTMLElement;
            const form = htmlElement.closest("form");
            if (form && typeof form.requestSubmit === "function") {
              form.requestSubmit();
            }
          });
        });
      } else {
        attempts.push({
          strategy: "form_request_submit",
          changed: false,
          note: requestSubmitResult.note,
        });
      }
    }

    if (!changed) {
      const submitResult = await page.$eval(
        options.selector,
        (element) => {
          const htmlElement = element as HTMLElement;
          const form = htmlElement.closest("form");
          if (!form) {
            return { ok: false, note: "未找到 form 容器。" };
          }

          return { ok: true };
        },
      );

      if (submitResult.ok) {
        changed = await runAttempt("form_submit", async () => {
          await page.$eval(options.selector, (element) => {
            const htmlElement = element as HTMLElement;
            const form = htmlElement.closest("form");
            if (form) {
              form.submit();
            }
          });
        });
      } else {
        attempts.push({
          strategy: "form_submit",
          changed: false,
          note: submitResult.note,
        });
      }
    }

    if (!changed) {
      const nearbySelector = await page.$eval(
        options.selector,
        (element) => {
          const normalizeWhitespace = (value: unknown) =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim();

          const escapeSelector = (value: string) => {
            if (
              typeof (
                window as Window & { CSS?: { escape?: (value: string) => string } }
              ).CSS?.escape === "function"
            ) {
              return (
                window as Window & { CSS: { escape: (value: string) => string } }
              ).CSS.escape(value);
            }

            return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
          };

          const buildSelector = (target: Element) => {
            const htmlTarget = target as HTMLElement;
            const id = normalizeWhitespace(htmlTarget.id);
            if (id) {
              return `#${escapeSelector(id)}`;
            }

            const tag = target.tagName.toLowerCase();
            const classNames = Array.from(htmlTarget.classList)
              .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
              .slice(0, 3);
            if (classNames.length > 0) {
              return `${tag}.${classNames
                .map((className) => escapeSelector(className))
                .join(".")}`;
            }

            return undefined;
          };

          const containsSubmitSignal = (target: Element) => {
            const htmlTarget = target as HTMLElement;
            const haystack = [
              normalizeWhitespace(htmlTarget.innerText ?? htmlTarget.textContent),
              normalizeWhitespace(target.getAttribute("aria-label")),
              normalizeWhitespace(target.getAttribute("title")),
              normalizeWhitespace(htmlTarget.className),
              normalizeWhitespace(target.getAttribute("role")),
            ]
              .join(" ")
              .toLocaleLowerCase();

            return [
              "search",
              "submit",
              "query",
              "搜索",
              "查找",
              "检索",
            ].some((keyword) => haystack.includes(keyword));
          };

          const htmlElement = element as HTMLElement;
          const scope =
            htmlElement.closest("form") ??
            htmlElement.parentElement ??
            htmlElement.closest("header, nav, [role='navigation']") ??
            document.body;

          const clickableCandidates = Array.from(scope.querySelectorAll("*"))
            .filter((candidate) => candidate !== element)
            .filter((candidate) => {
              if (!(candidate instanceof HTMLElement)) {
                return false;
              }

              const rect = candidate.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) {
                return false;
              }

              const style = getComputedStyle(candidate);
              if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.opacity === "0"
              ) {
                return false;
              }

              const tag = candidate.tagName.toLowerCase();
              const role = normalizeWhitespace(candidate.getAttribute("role"));
              const type =
                candidate instanceof HTMLInputElement ||
                candidate instanceof HTMLButtonElement
                  ? normalizeWhitespace(candidate.type).toLowerCase()
                  : "";

              return (
                tag === "button" ||
                tag === "a" ||
                role === "button" ||
                type === "submit" ||
                type === "button" ||
                style.cursor === "pointer" ||
                containsSubmitSignal(candidate)
              );
            }) as Element[];

          const preferred =
            clickableCandidates.find((candidate) => containsSubmitSignal(candidate)) ??
            clickableCandidates[0];

          return preferred ? buildSelector(preferred) : undefined;
        },
      );

      if (nearbySelector) {
        changed = await runAttempt("nearby_click", async () => {
          await page.locator(nearbySelector).setTimeout(3000).click();
        });
      } else {
        attempts.push({
          strategy: "nearby_click",
          changed: false,
          note: "没有找到邻近提交控件。",
        });
      }
    }

    return {
      page: await this.summarizePage(this.requirePageId(page), page),
      selector: options.selector,
      before,
      changed,
      strategy: attempts.find((attempt) => attempt.changed)?.strategy,
      attempts,
    };
  }

  public async evaluate(options: {
    pageId?: string;
    expression: string;
  }): Promise<{ page: PageSummary; value: string }> {
    const page = await this.resolvePage(options.pageId);
    const resolvedPageId = this.requirePageId(page);
    const value = await page.evaluate((expression) => {
      return globalThis.eval(expression);
    }, options.expression);

    return {
      page: await this.summarizePage(resolvedPageId, page),
      value: formatJsonish(value),
    };
  }

  public async screenshot(options: {
    pageId?: string;
    selector?: string;
    fullPage: boolean;
    format: "png" | "jpeg";
    quality?: number;
    savePath?: string;
  }): Promise<ScreenshotResult> {
    const page = await this.resolvePage(options.pageId);
    const resolvedPageId = this.requirePageId(page);
    const baseOptions = {
      type: options.format,
      quality: options.format === "jpeg" ? options.quality : undefined,
    } as const;

    let imageBuffer: Uint8Array;
    if (options.selector) {
      const handle = await page.waitForSelector(options.selector, {
        visible: true,
        timeout: this.config.defaultTimeoutMs,
      });

      if (!handle) {
        throw new Error(`未找到要截图的元素: ${options.selector}`);
      }

      imageBuffer = (await handle.screenshot(baseOptions)) as Uint8Array;
      await handle.dispose();
    } else {
      imageBuffer = (await page.screenshot({
        ...baseOptions,
        fullPage: options.fullPage,
      })) as Uint8Array;
    }

    let savedPath: string | undefined;
    if (options.savePath) {
      savedPath = path.resolve(options.savePath);
      await fs.mkdir(path.dirname(savedPath), { recursive: true });
      await fs.writeFile(savedPath, imageBuffer);
    }

    return {
      page: await this.summarizePage(resolvedPageId, page),
      mimeType: options.format === "png" ? "image/png" : "image/jpeg",
      base64Data: Buffer.from(imageBuffer).toString("base64"),
      savedPath,
    };
  }

  public async getConsoleLogs(
    pageId?: string,
    limit = 20,
  ): Promise<ConsoleLogEntry[]> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    return (this.consoleLogs.get(resolvedPageId) ?? []).slice(-limit);
  }

  public async getNetworkLogs(
    pageId?: string,
    limit = 20,
  ): Promise<NetworkLogEntry[]> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    return (this.networkLogs.get(resolvedPageId) ?? []).slice(-limit);
  }

  public async closePage(pageId?: string): Promise<BrowserStatus> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    await page.close();

    this.pages.delete(resolvedPageId);
    this.consoleLogs.delete(resolvedPageId);
    this.networkLogs.delete(resolvedPageId);
    this.instrumentedPageIds.delete(resolvedPageId);

    if (this.currentPageId === resolvedPageId) {
      this.currentPageId = undefined;
    }

    await this.syncPages();
    return this.getStatus();
  }

  public async closeBrowser(): Promise<BrowserStatus> {
    if (this.browser?.connected) {
      await this.browser.close();
    }

    this.browser = undefined;
    this.launchedByManager = false;
    this.pages.clear();
    this.consoleLogs.clear();
    this.networkLogs.clear();
    this.instrumentedPageIds.clear();
    this.currentPageId = undefined;

    return this.getStatus();
  }

  public async shutdown(): Promise<void> {
    if (this.browser?.connected) {
      await this.browser.close();
    }

    this.browser = undefined;
  }

  private async ensureBrowser(startIfNeeded = true): Promise<Browser | undefined> {
    if (this.browser?.connected) {
      await this.syncPages();
      return this.browser;
    }

    if (!startIfNeeded) {
      return undefined;
    }

    let browser: Browser;
    if (this.config.browserWSEndpoint) {
      browser = await puppeteer.connect({
        browserWSEndpoint: this.config.browserWSEndpoint,
        defaultViewport: null,
      });
      this.launchedByManager = false;
    } else if (this.config.browserURL) {
      browser = await puppeteer.connect({
        browserURL: this.config.browserURL,
        defaultViewport: null,
      });
      this.launchedByManager = false;
    } else {
      if (this.config.userDataDir) {
        await fs.mkdir(this.config.userDataDir, { recursive: true });
      }

      browser = await puppeteer.launch({
        headless: this.config.headless,
        defaultViewport: null,
        executablePath: this.config.executablePath,
        channel: this.config.executablePath ? undefined : this.config.channel,
        userDataDir: this.config.userDataDir,
      });
      this.launchedByManager = true;
    }

    browser.on("disconnected", () => {
      this.browser = undefined;
      this.pages.clear();
      this.currentPageId = undefined;
      this.instrumentedPageIds.clear();
    });

    this.browser = browser;
    await this.syncPages();
    return browser;
  }

  private async syncPages(): Promise<void> {
    if (!this.browser?.connected) {
      this.pages.clear();
      this.currentPageId = undefined;
      return;
    }

    const openPages = await this.browser.pages();
    const openPageIds = new Set<string>();

    for (const page of openPages) {
      const pageId = this.trackPage(page);
      openPageIds.add(pageId);
      this.applyTimeouts(page);
      await this.instrumentPage(pageId, page);
    }

    for (const [pageId] of this.pages.entries()) {
      if (!openPageIds.has(pageId)) {
        this.pages.delete(pageId);
        this.consoleLogs.delete(pageId);
        this.networkLogs.delete(pageId);
        this.instrumentedPageIds.delete(pageId);
      }
    }

    if (!this.currentPageId || !this.pages.has(this.currentPageId)) {
      this.currentPageId = this.pages.keys().next().value;
    }
  }

  private trackPage(page: Page): string {
    let pageId = this.pageIds.get(page);
    if (!pageId) {
      pageId = `page-${this.pageCounter}`;
      this.pageCounter += 1;
      this.pageIds.set(page, pageId);
    }

    this.pages.set(pageId, page);
    this.consoleLogs.set(pageId, this.consoleLogs.get(pageId) ?? []);
    this.networkLogs.set(pageId, this.networkLogs.get(pageId) ?? []);

    return pageId;
  }

  private async instrumentPage(pageId: string, page: Page): Promise<void> {
    if (this.instrumentedPageIds.has(pageId)) {
      return;
    }

    this.instrumentedPageIds.add(pageId);

    page.on("console", (message) => {
      const location = message.location();
      const locationText =
        location.url || location.lineNumber !== undefined
          ? `${location.url ?? "unknown"}:${location.lineNumber ?? 0}`
          : undefined;

      this.pushConsoleLog(pageId, {
        pageId,
        type: message.type(),
        text: message.text(),
        timestamp: new Date().toISOString(),
        location: locationText,
      });
    });

    page.on("response", (response) => {
      this.pushNetworkLog(pageId, {
        pageId,
        method: response.request().method(),
        status: response.status(),
        statusText: response.statusText(),
        url: response.url(),
        timestamp: new Date().toISOString(),
      });
    });

    page.on("close", () => {
      this.pages.delete(pageId);
      if (this.currentPageId === pageId) {
        this.currentPageId = undefined;
      }
    });
  }

  private async resolvePage(pageId?: string): Promise<Page> {
    await this.ensureBrowser();
    await this.syncPages();

    if (pageId) {
      return this.getPageById(pageId);
    }

    if (this.currentPageId) {
      const currentPage = this.pages.get(this.currentPageId);
      if (currentPage) {
        return currentPage;
      }
    }

    const firstPage = this.pages.values().next().value;
    if (firstPage) {
      const firstPageId = this.requirePageId(firstPage);
      this.currentPageId = firstPageId;
      return firstPage;
    }

    const pageSummary = await this.openPage();
    return this.getPageById(pageSummary.pageId);
  }

  private async getPageById(pageId: string): Promise<Page> {
    await this.syncPages();
    const page = this.pages.get(pageId);
    if (!page) {
      throw new Error(`找不到页面: ${pageId}`);
    }

    return page;
  }

  private requirePageId(page: Page): string {
    const pageId = this.pageIds.get(page);
    if (!pageId) {
      throw new Error("页面还没有被注册，请重试。");
    }

    return pageId;
  }

  private applyTimeouts(page: Page): void {
    page.setDefaultTimeout(this.config.defaultTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
  }

  private async summarizePage(pageId: string, page: Page): Promise<PageSummary> {
    const title = await page.title().catch(() => "");
    return {
      pageId,
      title,
      url: page.url(),
      isCurrent: this.currentPageId === pageId,
    };
  }

  private pushConsoleLog(pageId: string, entry: ConsoleLogEntry): void {
    const current = this.consoleLogs.get(pageId) ?? [];
    current.push(entry);
    if (current.length > MAX_LOG_ENTRIES) {
      current.splice(0, current.length - MAX_LOG_ENTRIES);
    }
    this.consoleLogs.set(pageId, current);
  }

  private pushNetworkLog(pageId: string, entry: NetworkLogEntry): void {
    const current = this.networkLogs.get(pageId) ?? [];
    current.push(entry);
    if (current.length > MAX_LOG_ENTRIES) {
      current.splice(0, current.length - MAX_LOG_ENTRIES);
    }
    this.networkLogs.set(pageId, current);
  }

  private getBrowserMode():
    | "launch"
    | "connect_browser_url"
    | "connect_ws_endpoint" {
    if (this.config.browserWSEndpoint) {
      return "connect_ws_endpoint";
    }

    if (this.config.browserURL) {
      return "connect_browser_url";
    }

    return "launch";
  }

  private async readTextFromHandle(
    handle: ElementHandle<Element>,
  ): Promise<string> {
    return handle.evaluate((node) => {
      const element = node as HTMLElement;
      if ("value" in element) {
        return String((element as HTMLInputElement | HTMLTextAreaElement).value);
      }
      return element.innerText ?? element.textContent ?? "";
    });
  }
}

function formatJsonish(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return util.inspect(value, {
      depth: 4,
      breakLength: 100,
      maxArrayLength: 50,
    });
  }
}
