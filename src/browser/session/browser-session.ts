import fs from "node:fs/promises";
import puppeteer, {
  type Browser,
  type Page,
} from "puppeteer-core";
import type { ChromeConfig } from "../../config.js";
import type {
  BrowserStatus,
  ConsoleLogEntry,
  NetworkLogEntry,
  PageSummary,
} from "../state/types.js";
import type { SnapshotElementSummary } from "../discovery/types.js";
import type {
  BindingAttachableElement,
  BindingRecord,
} from "../binding/binding-record.js";
import { BindingRegistry } from "../binding/binding-registry.js";
import { summarizePageState } from "../state/page-summary.js";

const MAX_LOG_ENTRIES = 200;

export class BrowserSession {
  private browser?: Browser;
  private launchedByManager = false;
  private readonly pageIds = new WeakMap<Page, string>();
  private readonly pages = new Map<string, Page>();
  private readonly instrumentedPageIds = new Set<string>();
  private readonly consoleLogs = new Map<string, ConsoleLogEntry[]>();
  private readonly networkLogs = new Map<string, NetworkLogEntry[]>();
  private readonly bindingRegistry = new BindingRegistry();
  private currentPageId?: string;
  private pageCounter = 1;
  private snapshotCounter = 1;

  public constructor(public readonly config: ChromeConfig) {}

  public isManagedBrowser(): boolean {
    return this.launchedByManager;
  }

  public async getStatus(): Promise<BrowserStatus> {
    const pages = await this.listPages(false);

    return {
      connected: Boolean(this.browser?.connected),
      browserMode: this.getBrowserMode(),
      launchedByManager: this.launchedByManager,
      headless: this.config.headless,
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      navigationTimeoutMs: this.config.navigationTimeoutMs,
      stepTimeoutMs: this.config.stepTimeoutMs,
      maxRetries: this.config.maxRetries,
      retryBackoffMs: this.config.retryBackoffMs,
      actionSettleDelayMs: this.config.actionSettleDelayMs,
      followupWatchTimeoutMs: this.config.followupWatchTimeoutMs,
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

  public async getConsoleLogs(
    pageId?: string,
    limit = 20,
  ): Promise<ConsoleLogEntry[]> {
    const resolvedPageId = await this.resolveTrackedPageId(pageId);
    if (!resolvedPageId) {
      return [];
    }

    return (this.consoleLogs.get(resolvedPageId) ?? []).slice(-limit);
  }

  public async getNetworkLogs(
    pageId?: string,
    limit = 20,
  ): Promise<NetworkLogEntry[]> {
    const resolvedPageId = await this.resolveTrackedPageId(pageId);
    if (!resolvedPageId) {
      return [];
    }

    return (this.networkLogs.get(resolvedPageId) ?? []).slice(-limit);
  }

  public async closePage(pageId?: string): Promise<BrowserStatus> {
    const page = await this.resolvePage(pageId);
    const resolvedPageId = this.requirePageId(page);
    await page.close();

    this.pages.delete(resolvedPageId);
    this.consoleLogs.delete(resolvedPageId);
    this.networkLogs.delete(resolvedPageId);
    this.bindingRegistry.removePage(resolvedPageId);
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
    this.bindingRegistry.clear();
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

  public async ensureBrowser(
    startIfNeeded = true,
  ): Promise<Browser | undefined> {
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
      this.consoleLogs.clear();
      this.networkLogs.clear();
      this.bindingRegistry.clear();
      this.currentPageId = undefined;
      this.instrumentedPageIds.clear();
    });

    this.browser = browser;
    await this.syncPages();
    return browser;
  }

  public async syncPages(): Promise<void> {
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
        this.bindingRegistry.removePage(pageId);
        this.instrumentedPageIds.delete(pageId);
      }
    }

    if (!this.currentPageId || !this.pages.has(this.currentPageId)) {
      this.currentPageId = this.pages.keys().next().value;
    }
  }

  public trackPage(page: Page): string {
    let pageId = this.pageIds.get(page);
    if (!pageId) {
      pageId = `page-${this.pageCounter}`;
      this.pageCounter += 1;
      this.pageIds.set(page, pageId);
    }

    this.pages.set(pageId, page);
    this.consoleLogs.set(pageId, this.consoleLogs.get(pageId) ?? []);
    this.networkLogs.set(pageId, this.networkLogs.get(pageId) ?? []);
    this.bindingRegistry.ensurePage(pageId);

    return pageId;
  }

  public attachElementRefs<T extends BindingAttachableElement>(
    pageId: string,
    elements: T[],
  ): Array<T & { ref: string }> {
    const result = this.bindingRegistry.attachElementRefs(
      pageId,
      elements,
      this.snapshotCounter,
    );
    this.snapshotCounter = result.nextSnapshotCounter;
    return result.elementsWithRefs;
  }

  public resolveSelectorForRef(pageId: string, ref: string): string {
    return this.bindingRegistry.resolveSelectorForRef(pageId, ref);
  }

  public getBindingRecord(pageId: string, ref: string): BindingRecord | undefined {
    return this.bindingRegistry.getBindingRecord(pageId, ref);
  }

  public async instrumentPage(pageId: string, page: Page): Promise<void> {
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
      this.bindingRegistry.removePage(pageId);
      if (this.currentPageId === pageId) {
        this.currentPageId = undefined;
      }
    });

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.bindingRegistry.removePage(pageId);
      }
    });
  }

  public async resolvePage(pageId?: string): Promise<Page> {
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

    const browser = await this.ensureBrowser();
    if (!browser) {
      throw new Error("浏览器没有成功启动。");
    }

    const page = await browser.newPage();
    const pageIdForNewPage = this.trackPage(page);
    this.applyTimeouts(page);
    await this.instrumentPage(pageIdForNewPage, page);
    await page.bringToFront();
    this.currentPageId = pageIdForNewPage;
    return page;
  }

  public async getPageById(pageId: string): Promise<Page> {
    await this.syncPages();
    const page = this.pages.get(pageId);
    if (!page) {
      throw new Error(`找不到页面: ${pageId}`);
    }

    return page;
  }

  public requirePageId(page: Page): string {
    const pageId = this.pageIds.get(page);
    if (!pageId) {
      throw new Error("页面还没有被注册，请重试。");
    }

    return pageId;
  }

  public applyTimeouts(page: Page): void {
    page.setDefaultTimeout(this.config.defaultTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
  }

  public async summarizePage(pageId: string, page: Page): Promise<PageSummary> {
    return summarizePageState({
      pageId,
      page,
      isCurrent: this.currentPageId === pageId,
    });
  }

  public getCurrentPageId(): string | undefined {
    return this.currentPageId;
  }

  public setCurrentPageId(pageId?: string): void {
    this.currentPageId = pageId;
  }

  public getPages(): Map<string, Page> {
    return this.pages;
  }

  private async resolveTrackedPageId(pageId?: string): Promise<string | undefined> {
    const browser = await this.ensureBrowser(false);
    if (!browser) {
      return undefined;
    }

    await this.syncPages();

    if (pageId) {
      if (!this.pages.has(pageId)) {
        throw new Error(`找不到页面: ${pageId}`);
      }
      return pageId;
    }

    if (this.currentPageId && this.pages.has(this.currentPageId)) {
      return this.currentPageId;
    }

    return this.pages.keys().next().value;
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
}


