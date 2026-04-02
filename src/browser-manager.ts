import type { Page } from "puppeteer-core";
import { screenshotWithRuntime } from "./browser/ops/artifact-tools.js";
import {
  assertSubmitInputAllowed,
} from "./browser/flow/fallback-guards.js";
import type { BrowserInspectionDeps } from "./browser/core/inspection-deps.js";
import { findElementsWithInspection } from "./browser/inspect/find-elements.js";
import { findPrimaryInputsWithInspection } from "./browser/inspect/find-primary-inputs.js";
import { findPrimaryResultsWithInspection } from "./browser/inspect/find-primary-results.js";
import { findSubmitTargetsWithInspection } from "./browser/inspect/find-submit-targets.js";
import { extractTextWithInspection, evaluateWithInspection } from "./browser/inspect/inspection-text.js";
import { readMediaStateWithInspection } from "./browser/inspect/media-state.js";
import {
  clickAndWaitWithRuntime,
  clickWithRuntime,
  pressKeyWithRuntime,
  pressKeyAndWaitWithRuntime,
  submitInputWithRuntime,
  submitWithPlanWithRuntime,
  typeTextWithRuntime,
} from "./browser/ops/interaction-tools.js";
import { dismissBlockingOverlaysWithRuntime } from "./browser/ops/overlay-tools.js";
import {
  goBackWithRuntime,
  navigateWithRuntime,
  openPageWithRuntime,
  reloadPageWithRuntime,
  selectPageWithRuntime,
  waitForWithRuntime,
} from "./browser/ops/navigation-tools.js";
import { pageSnapshotWithInspection } from "./browser/inspect/page-snapshot.js";
import type { BrowserRuntimeDeps } from "./browser/core/runtime-deps.js";
import { BrowserSession } from "./browser/core/session.js";
import type {
  BrowserStatus,
  ClickAndWaitResult,
  ConsoleLogEntry,
  DismissBlockingOverlaysResult,
  EvaluateResult,
  FindElementsResult,
  FindPrimaryInputsResult,
  FindPrimaryResultsResult,
  FindSubmitTargetsResult,
  NavigateResult,
  NetworkLogEntry,
  PageSnapshotResult,
  PageSummary,
  PressKeyAndWaitResult,
  ReadMediaStateResult,
  ScreenshotResult,
  SubmitInputResult,
  SubmitWithPlanResult,
  WaitMatchMode,
} from "./browser/core/types.js";
import type { ChromeConfig, WaitUntilMode } from "./config.js";

export class BrowserManager {
  private readonly session: BrowserSession;

  public constructor(config: ChromeConfig) {
    this.session = new BrowserSession(config);
  }

  public async getStatus(): Promise<BrowserStatus> {
    return this.session.getStatus();
  }

  public async listPages(startBrowserIfNeeded = true): Promise<PageSummary[]> {
    return this.session.listPages(startBrowserIfNeeded);
  }

  public async openPage(url?: string): Promise<PageSummary> {
    return openPageWithRuntime(this.getRuntimeDeps(), url);
  }

  public async selectPage(pageId: string): Promise<PageSummary> {
    return selectPageWithRuntime(this.getRuntimeDeps(), pageId);
  }

  public async navigate(
    url: string,
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    return navigateWithRuntime(this.getRuntimeDeps(), url, pageId, waitUntil);
  }

  public async goBack(
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    return goBackWithRuntime(this.getRuntimeDeps(), pageId, waitUntil);
  }

  public async reloadPage(
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    return reloadPageWithRuntime(this.getRuntimeDeps(), pageId, waitUntil);
  }

  public async waitFor(options: {
    pageId?: string;
    selector?: string;
    text?: string;
    textSelector?: string;
    title?: string;
    url?: string;
    matchMode: WaitMatchMode;
    timeoutMs?: number;
  }): Promise<PageSummary> {
    return waitForWithRuntime(this.getRuntimeDeps(), options);
  }

  public async click(
    options: {
      selector?: string;
      ref?: string;
      pageId?: string;
      timeoutMs?: number;
    },
  ): Promise<PageSummary> {
    return clickWithRuntime(this.getRuntimeDeps(), options);
  }

  public async clickAndWait(options: {
    selector?: string;
    ref?: string;
    pageId?: string;
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
  }): Promise<ClickAndWaitResult> {
    return clickAndWaitWithRuntime(this.getRuntimeDeps(), options);
  }

  public async typeText(options: {
    selector?: string;
    ref?: string;
    text: string;
    pageId?: string;
    clear: boolean;
    submit: boolean;
    timeoutMs?: number;
  }): Promise<PageSummary> {
    return typeTextWithRuntime(this.getRuntimeDeps(), options);
  }

  public async pressKey(key: string, pageId?: string): Promise<PageSummary> {
    return pressKeyWithRuntime(this.getRuntimeDeps(), key, pageId);
  }

  public async pressKeyAndWait(options: {
    key: string;
    pageId?: string;
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
  }): Promise<PressKeyAndWaitResult> {
    return pressKeyAndWaitWithRuntime(this.getRuntimeDeps(), options);
  }

  public async extractText(options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    mode?: "auto" | "main" | "article" | "body";
    maxLength: number;
  }): Promise<{ page: PageSummary; text: string }> {
    return extractTextWithInspection(this.getInspectionDeps(), options);
  }

  public async pageSnapshot(options: {
    pageId?: string;
    maxTextLength: number;
    maxElements: number;
  }): Promise<PageSnapshotResult> {
    const snapshot = await pageSnapshotWithInspection(
      this.getInspectionDeps(),
      options,
    );

    return {
      ...snapshot,
      interactiveElements: this.session.attachElementRefs(
        snapshot.page.pageId,
        snapshot.interactiveElements,
      ),
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
    const result = await findElementsWithInspection(this.getInspectionDeps(), options);

    return {
      ...result,
      elements: this.session.attachElementRefs(result.page.pageId, result.elements),
    };
  }

  public async findPrimaryInputs(options: {
    pageId?: string;
    maxResults: number;
  }): Promise<FindPrimaryInputsResult> {
    return findPrimaryInputsWithInspection(this.getInspectionDeps(), options);
  }

  public async findPrimaryResults(options: {
    pageId?: string;
    query?: string;
    maxResults: number;
  }): Promise<FindPrimaryResultsResult> {
    const result = await findPrimaryResultsWithInspection(
      this.getInspectionDeps(),
      options,
    );

    return {
      ...result,
      results: this.session.attachElementRefs(result.page.pageId, result.results),
    };
  }

  public async findSubmitTargets(options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    maxResults: number;
  }): Promise<FindSubmitTargetsResult> {
    const page = await this.session.resolvePage(options.pageId);
    const pageId = this.session.requirePageId(page);
    const selector =
      options.ref
        ? this.session.resolveSelectorForRef(pageId, options.ref)
        : options.selector;

    if (!selector) {
      throw new Error("selector 和 ref 至少要提供一个。");
    }

    return findSubmitTargetsWithInspection(this.getInspectionDeps(), {
      pageId,
      selector,
      maxResults: options.maxResults,
    });
  }

  public async readMediaState(options: {
    pageId?: string;
    selector?: string;
    maxResults: number;
  }): Promise<ReadMediaStateResult> {
    const result = await readMediaStateWithInspection(this.getInspectionDeps(), options);

    return {
      ...result,
      media: this.session.attachElementRefs(result.page.pageId, result.media),
    };
  }

  public async dismissBlockingOverlays(options: {
    pageId?: string;
    timeoutMs?: number;
    maxSteps?: number;
  }): Promise<DismissBlockingOverlaysResult> {
    return dismissBlockingOverlaysWithRuntime(this.getRuntimeDeps(), options);
  }

  public async submitInput(options: {
    selector: string;
    pageId?: string;
    timeoutMs?: number;
  }): Promise<SubmitInputResult> {
    await assertSubmitInputAllowed(this.getRuntimeDeps(), options);
    return submitInputWithRuntime(this.getRuntimeDeps(), options);
  }

  public async submitWithPlan(options: {
    selector?: string;
    ref?: string;
    pageId?: string;
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
    maxPlanSteps?: number;
  }): Promise<SubmitWithPlanResult> {
    const page = await this.session.resolvePage(options.pageId);
    const pageId = this.session.requirePageId(page);
    const selector =
      options.ref
        ? this.session.resolveSelectorForRef(pageId, options.ref)
        : options.selector;

    if (!selector) {
      throw new Error("selector 和 ref 至少要提供一个。");
    }

    return submitWithPlanWithRuntime(this.getRuntimeDeps(), {
      ...options,
      pageId,
      selector,
    });
  }

  public async evaluate(options: {
    pageId?: string;
    expression: string;
  }): Promise<EvaluateResult> {
    return evaluateWithInspection(this.getInspectionDeps(), options);
  }

  public async screenshot(options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    fullPage: boolean;
    format: "png" | "jpeg";
    quality?: number;
    savePath?: string;
  }): Promise<ScreenshotResult> {
    return screenshotWithRuntime(this.getRuntimeDeps(), options);
  }

  public async getConsoleLogs(
    pageId?: string,
    limit = 20,
  ): Promise<ConsoleLogEntry[]> {
    return this.session.getConsoleLogs(pageId, limit);
  }

  public async getNetworkLogs(
    pageId?: string,
    limit = 20,
  ): Promise<NetworkLogEntry[]> {
    return this.session.getNetworkLogs(pageId, limit);
  }

  public async closePage(pageId?: string): Promise<BrowserStatus> {
    return this.session.closePage(pageId);
  }

  public async closeBrowser(): Promise<BrowserStatus> {
    return this.session.closeBrowser();
  }

  public async shutdown(): Promise<void> {
    await this.session.shutdown();
  }

  private getInspectionDeps(): BrowserInspectionDeps {
    return {
      defaultTimeoutMs: this.session.config.defaultTimeoutMs,
      resolvePage: (pageId) => this.session.resolvePage(pageId),
      requirePageId: (page) => this.session.requirePageId(page),
      summarizePage: (pageId, page) => this.session.summarizePage(pageId, page),
      resolveSelectorForRef: (pageId, ref) =>
        this.session.resolveSelectorForRef(pageId, ref),
    };
  }

  private getRuntimeDeps(): BrowserRuntimeDeps {
    return {
      config: this.session.config,
      isManagedBrowser: () => this.session.isManagedBrowser(),
      ensureBrowser: (startIfNeeded) => this.session.ensureBrowser(startIfNeeded),
      syncPages: () => this.session.syncPages(),
      trackPage: (page) => this.session.trackPage(page),
      applyTimeouts: (page) => this.session.applyTimeouts(page),
      instrumentPage: (pageId, page) => this.session.instrumentPage(pageId, page),
      resolvePage: (pageId) => this.session.resolvePage(pageId),
      requirePageId: (page) => this.session.requirePageId(page),
      summarizePage: (pageId, page) => this.session.summarizePage(pageId, page),
      getCurrentPageId: () => this.session.getCurrentPageId(),
      setCurrentPageId: (pageId) => this.session.setCurrentPageId(pageId),
      getPages: () => this.session.getPages(),
      resolveSelectorForRef: (pageId, ref) =>
        this.session.resolveSelectorForRef(pageId, ref),
    };
  }
}

