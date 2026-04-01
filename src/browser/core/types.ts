export interface PageSummary {
  pageId: string;
  title: string;
  url: string;
  isCurrent: boolean;
}

export interface BrowserStatus {
  connected: boolean;
  browserMode: "launch" | "connect_browser_url" | "connect_ws_endpoint";
  launchedByManager: boolean;
  headless: boolean;
  defaultTimeoutMs: number;
  navigationTimeoutMs: number;
  stepTimeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  actionSettleDelayMs: number;
  followupWatchTimeoutMs: number;
  userDataDir?: string;
  pages: PageSummary[];
}

export interface ConsoleLogEntry {
  pageId: string;
  type: string;
  text: string;
  timestamp: string;
  location?: string;
}

export interface NetworkLogEntry {
  pageId: string;
  method: string;
  status: number;
  statusText: string;
  url: string;
  timestamp: string;
}

export interface NavigateResult {
  page: PageSummary;
  responseStatus?: number;
}

export interface ScreenshotResult {
  page: PageSummary;
  mimeType: string;
  base64Data: string;
  savedPath?: string;
}

export interface SnapshotElementSummary {
  ref: string;
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
  title?: string;
  name?: string;
  className?: string;
  selector: string;
  href?: string;
  disabled: boolean;
  checked?: boolean;
}

export type RawSnapshotElementSummary = Omit<SnapshotElementSummary, "ref">;

export interface PageSnapshotResult {
  page: PageSummary;
  headings: string[];
  textPreview: string;
  interactiveElements: SnapshotElementSummary[];
}

export interface RawPageSnapshotResult {
  page: PageSummary;
  headings: string[];
  textPreview: string;
  interactiveElements: RawSnapshotElementSummary[];
}

export interface FindElementsResult {
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

export interface RawFindElementsResult {
  page: PageSummary;
  query: string;
  total: number;
  elements: Array<
    RawSnapshotElementSummary & {
      matchReasons: string[];
      matchScore: number;
    }
  >;
}

export interface PrimaryInputCandidate {
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

export interface FindPrimaryInputsResult {
  page: PageSummary;
  total: number;
  candidates: PrimaryInputCandidate[];
}

export interface SubmitTargetCandidate {
  tag: string;
  role?: string;
  type?: string;
  intent: "submit" | "clear" | "auxiliary";
  selector: string;
  text?: string;
  accessibleName?: string;
  title?: string;
  className?: string;
  score: number;
  intentReasons: string[];
  scoreBreakdown: Array<{
    reason: string;
    score: number;
  }>;
}

export interface FindSubmitTargetsResult {
  page: PageSummary;
  inputSelector: string;
  preferredSubmitMethod: "enter" | "click" | "either";
  submitMethodReasons: string[];
  total: number;
  candidates: SubmitTargetCandidate[];
}

export interface SubmitInputResult {
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

export interface DomObservationSummary {
  changed: boolean;
  mutationCount: number;
  addedNodes: number;
  removedNodes: number;
  textChanges: number;
  attributeChanges: number;
  topSelectors: string[];
}

export type ClickAndWaitChangeType =
  | "same_page_update"
  | "navigation"
  | "popup"
  | "new_target"
  | "none";

export type ClickAndWaitSuccessSignal =
  | "content_selector"
  | "content_text"
  | "selector"
  | "url"
  | "title"
  | "dom"
  | "navigation"
  | "popup"
  | "new_target"
  | "page_count_changed"
  | "state_changed"
  | "none";

export type ContentReadySignal = "selector" | "text" | "none";

export interface ClickAndWaitResult {
  page: PageSummary;
  selector: string;
  pageSource: "current" | "popup" | "new_target";
  changeType: ClickAndWaitChangeType;
  successSignal: ClickAndWaitSuccessSignal;
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
    contentSelector: boolean;
    contentText: boolean;
    dom: boolean;
    stateChanged: boolean;
    popup: boolean;
    target: boolean;
    pageCountChanged: boolean;
  };
  contentReady: boolean;
  contentReadySignal: ContentReadySignal;
  domObservation: DomObservationSummary;
  note?: string;
}

export interface PressKeyAndWaitResult {
  page: PageSummary;
  key: string;
  pageSource: "current" | "popup" | "new_target";
  changeType: ClickAndWaitChangeType;
  successSignal: ClickAndWaitSuccessSignal;
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
    contentSelector: boolean;
    contentText: boolean;
    dom: boolean;
    stateChanged: boolean;
    popup: boolean;
    target: boolean;
    pageCountChanged: boolean;
  };
  contentReady: boolean;
  contentReadySignal: ContentReadySignal;
  domObservation: DomObservationSummary;
  note?: string;
}

export type WaitMatchMode = "contains" | "exact";
