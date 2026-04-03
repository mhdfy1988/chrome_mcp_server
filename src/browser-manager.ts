import type { Page } from "puppeteer-core";
import type { BrowserRuntimeDeps } from "./browser/session/runtime-deps.js";
import { BrowserSession } from "./browser/session/browser-session.js";
import {
  createBrowserInspectionUsecaseDeps,
  createBrowserRuntimeDeps,
} from "./browser/session/deps-factory.js";
import {
  evaluateWithRuntime,
  extractTextWithRuntime,
  findElementsWithRuntime,
  findPrimaryInputsWithRuntime,
  findPrimaryResultsWithRuntime,
  findSubmitTargetsWithRuntime,
  pageSnapshotWithRuntime,
  readMediaStateWithRuntime,
  type BrowserInspectionUsecaseDeps,
} from "./browser/usecases/inspection-usecases.js";
import { openResultWithPlanWithRuntime } from "./browser/usecases/result-usecases.js";
import { playMediaWithPlanWithRuntime } from "./browser/usecases/media-usecases.js";
import { screenshotWithRuntime } from "./browser/usecases/artifact-usecases.js";
import { assertSubmitInputAllowed } from "./browser/usecases/usecase-guards.js";
import {
  clickAndWaitWithRuntime,
  clickWithRuntime,
  pressKeyWithRuntime,
  pressKeyAndWaitWithRuntime,
  submitInputWithRuntime,
  submitWithPlanWithRuntime,
  typeTextWithRuntime,
} from "./browser/usecases/interaction-usecases.js";
import { dismissBlockingOverlaysWithRuntime } from "./browser/usecases/overlay-usecases.js";
import {
  goBackWithRuntime,
  navigateWithRuntime,
  openPageWithRuntime,
  reloadPageWithRuntime,
  selectPageWithRuntime,
  waitForWithRuntime,
} from "./browser/usecases/navigation-usecases.js";
import type {
  BrowserStatus,
  ConsoleLogEntry,
  NavigateResult,
  NetworkLogEntry,
  PageSummary,
  ScreenshotResult,
  EvaluateResult,
} from "./browser/state/types.js";
import type {
  FindElementsResult,
  FindPrimaryInputsResult,
  FindPrimaryResultsResult,
  FindSubmitTargetsResult,
  PageSnapshotResult,
  ReadMediaStateResult,
} from "./browser/discovery/types.js";
import type { ActionPageSummary } from "./browser/execution/types.js";
import type { WaitMatchMode } from "./browser/observation/types.js";
import type {
  ClickAndWaitResult,
  DismissBlockingOverlaysResult,
  PressKeyAndWaitResult,
  OpenResultWithPlanResult,
  PlayMediaWithPlanResult,
  SubmitInputResult,
  SubmitWithPlanResult,
} from "./browser/usecases/types.js";
import type { ChromeConfig, WaitUntilMode } from "./config.js";

export class BrowserManager {
  private readonly session: BrowserSession;
  private readonly runtimeDeps: BrowserRuntimeDeps;
  private readonly inspectionUsecaseDeps: BrowserInspectionUsecaseDeps;

  public constructor(config: ChromeConfig) {
    this.session = new BrowserSession(config);
    this.runtimeDeps = createBrowserRuntimeDeps(this.session);
    this.inspectionUsecaseDeps = createBrowserInspectionUsecaseDeps(this.session);
  }

  public async getStatus(): Promise<BrowserStatus> {
    return this.session.getStatus();
  }

  public async listPages(startBrowserIfNeeded = true): Promise<PageSummary[]> {
    return this.session.listPages(startBrowserIfNeeded);
  }

  public async openPage(url?: string): Promise<PageSummary> {
    return openPageWithRuntime(this.runtimeDeps, url);
  }

  public async selectPage(pageId: string): Promise<PageSummary> {
    return selectPageWithRuntime(this.runtimeDeps, pageId);
  }

  public async navigate(
    url: string,
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    return navigateWithRuntime(this.runtimeDeps, url, pageId, waitUntil);
  }

  public async goBack(
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    return goBackWithRuntime(this.runtimeDeps, pageId, waitUntil);
  }

  public async reloadPage(
    pageId?: string,
    waitUntil: WaitUntilMode = "domcontentloaded",
  ): Promise<NavigateResult> {
    return reloadPageWithRuntime(this.runtimeDeps, pageId, waitUntil);
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
    return waitForWithRuntime(this.runtimeDeps, options);
  }

  public async click(
    options: {
      selector?: string;
      ref?: string;
      pageId?: string;
      timeoutMs?: number;
    },
  ): Promise<ActionPageSummary> {
    return clickWithRuntime(this.runtimeDeps, options);
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
    return clickAndWaitWithRuntime(this.runtimeDeps, options);
  }

  public async typeText(options: {
    selector?: string;
    ref?: string;
    text: string;
    pageId?: string;
    clear: boolean;
    submit: boolean;
    timeoutMs?: number;
  }): Promise<ActionPageSummary> {
    return typeTextWithRuntime(this.runtimeDeps, options);
  }

  public async pressKey(key: string, pageId?: string): Promise<ActionPageSummary> {
    return pressKeyWithRuntime(this.runtimeDeps, key, pageId);
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
    return pressKeyAndWaitWithRuntime(this.runtimeDeps, options);
  }

  public async extractText(options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    mode?: "auto" | "main" | "article" | "body";
    maxLength: number;
  }): Promise<{ page: PageSummary; text: string }> {
    return extractTextWithRuntime(this.inspectionUsecaseDeps, options);
  }

  public async pageSnapshot(options: {
    pageId?: string;
    maxTextLength: number;
    maxElements: number;
  }): Promise<PageSnapshotResult> {
    return pageSnapshotWithRuntime(this.inspectionUsecaseDeps, options);
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
    return findElementsWithRuntime(this.inspectionUsecaseDeps, options);
  }

  public async findPrimaryInputs(options: {
    pageId?: string;
    maxResults: number;
  }): Promise<FindPrimaryInputsResult> {
    return findPrimaryInputsWithRuntime(this.inspectionUsecaseDeps, options);
  }

  public async findPrimaryResults(options: {
    pageId?: string;
    query?: string;
    maxResults: number;
  }): Promise<FindPrimaryResultsResult> {
    return findPrimaryResultsWithRuntime(this.inspectionUsecaseDeps, options);
  }

  public async openResultWithPlan(options: {
    pageId?: string;
    query?: string;
    maxResults?: number;
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
  }): Promise<OpenResultWithPlanResult> {
    return openResultWithPlanWithRuntime(this.runtimeDeps, options);
  }

  public async findSubmitTargets(options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    maxResults: number;
  }): Promise<FindSubmitTargetsResult> {
    return findSubmitTargetsWithRuntime(this.inspectionUsecaseDeps, options);
  }

  public async readMediaState(options: {
    pageId?: string;
    selector?: string;
    maxResults: number;
  }): Promise<ReadMediaStateResult> {
    return readMediaStateWithRuntime(this.inspectionUsecaseDeps, options);
  }

  public async playMediaWithPlan(options: {
    pageId?: string;
    selector?: string;
    timeoutMs?: number;
    maxResults?: number;
    maxPlanSteps?: number;
  }): Promise<PlayMediaWithPlanResult> {
    return playMediaWithPlanWithRuntime(this.runtimeDeps, options);
  }

  public async dismissBlockingOverlays(options: {
    pageId?: string;
    timeoutMs?: number;
    maxSteps?: number;
  }): Promise<DismissBlockingOverlaysResult> {
    return dismissBlockingOverlaysWithRuntime(this.runtimeDeps, options);
  }

  public async submitInput(options: {
    selector: string;
    pageId?: string;
    timeoutMs?: number;
  }): Promise<SubmitInputResult> {
    await assertSubmitInputAllowed(this.runtimeDeps, options);
    return submitInputWithRuntime(this.runtimeDeps, options);
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
    return submitWithPlanWithRuntime(this.runtimeDeps, options);
  }

  public async evaluate(options: {
    pageId?: string;
    expression: string;
  }): Promise<EvaluateResult> {
    return evaluateWithRuntime(this.inspectionUsecaseDeps, options);
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
    return screenshotWithRuntime(this.runtimeDeps, options);
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

}

