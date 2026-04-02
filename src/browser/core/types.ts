export type PageState =
  | "normal"
  | "overlay_blocking"
  | "blocked_by_verification"
  | "auth_required";

export type VerificationProviderHint =
  | "cloudflare"
  | "datadome"
  | "perimeterx"
  | "generic"
  | "unknown";

export interface VerificationBlockSummary {
  providerHint: VerificationProviderHint;
  evidence: string[];
  recommendedAction:
    | "wait_then_resume"
    | "manual_resume"
    | "allowlist"
    | "use_existing_browser_session";
}

export interface OverlayBlockingSummary {
  kind: "modal" | "banner" | "drawer" | "cookie_banner" | "unknown";
  evidence: string[];
  closeHints: string[];
  recommendedAction: "auto_close_then_resume" | "manual_resume";
}

export interface AuthRequiredSummary {
  kind: "login_gate" | "auth_page" | "unknown";
  evidence: string[];
  recommendedAction:
    | "manual_login"
    | "use_existing_browser_session"
    | "change_entry";
}

export interface PageSummary {
  pageId: string;
  title: string;
  url: string;
  isCurrent: boolean;
  pageState: PageState;
  verification?: VerificationBlockSummary;
  overlay?: OverlayBlockingSummary;
  authRequired?: AuthRequiredSummary;
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

export interface EvaluateResult {
  page: PageSummary;
  value: string;
  jsonValue?: unknown;
  jsonValueError?: string;
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

export interface PrimaryResultCandidate {
  tag: string;
  role?: string;
  selector: string;
  href?: string;
  text?: string;
  accessibleName?: string;
  title?: string;
  className?: string;
  containerSelector?: string;
  containerTextPreview?: string;
  openIntent:
    | "title_link"
    | "card_primary_link"
    | "container_link"
    | "thumbnail_link"
    | "unknown";
  score: number;
  scoreBreakdown: Array<{
    reason: string;
    score: number;
  }>;
}

export interface OpenResultPlanStep {
  method: "title_link" | "card_primary_link" | "container_link" | "thumbnail_link";
  confidence: number;
  reasons: string[];
  selector: string;
  href?: string;
  text?: string;
  accessibleName?: string;
}

export interface FindPrimaryResultsResult {
  page: PageSummary;
  query?: string;
  total: number;
  openResultPlan: OpenResultPlanStep[];
  results: Array<PrimaryResultCandidate & { ref: string }>;
}

export interface RawFindPrimaryResultsResult {
  page: PageSummary;
  query?: string;
  total: number;
  openResultPlan: OpenResultPlanStep[];
  results: PrimaryResultCandidate[];
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

export interface SubmitPlanStep {
  method: "enter" | "click";
  confidence: number;
  reasons: string[];
  selector?: string;
  tag?: string;
  role?: string;
  type?: string;
  intent?: SubmitTargetCandidate["intent"];
  text?: string;
  accessibleName?: string;
}

export interface FindSubmitTargetsResult {
  page: PageSummary;
  inputSelector: string;
  preferredSubmitMethod: "enter" | "click" | "either";
  submitMethodReasons: string[];
  submitPlan: SubmitPlanStep[];
  total: number;
  candidates: SubmitTargetCandidate[];
}

export interface MediaStateSummary {
  tag: "video" | "audio";
  selector: string;
  currentSrc?: string;
  src?: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  readyState: number;
  networkState: number;
  visible: boolean;
  width: number;
  height: number;
  isPrimary: boolean;
  score: number;
  scoreBreakdown: Array<{
    reason: string;
    score: number;
  }>;
  errorCode?: number;
}

export interface ReadMediaStateResult {
  page: PageSummary;
  total: number;
  playMediaPlan: MediaPlayPlanStep[];
  media: Array<MediaStateSummary & { ref: string }>;
}

export interface RawReadMediaStateResult {
  page: PageSummary;
  total: number;
  playMediaPlan: MediaPlayPlanStep[];
  media: MediaStateSummary[];
}

export interface MediaPlayPlanStep {
  method: "already_playing" | "click_media_surface" | "click_play_button";
  confidence: number;
  reasons: string[];
  selector?: string;
  text?: string;
  accessibleName?: string;
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

export interface SubmitWithPlanAttempt {
  method: "enter" | "click";
  confidence: number;
  reasons: string[];
  selector?: string;
  changed: boolean;
  pageSource?: "current" | "popup" | "new_target";
  changeType?: ClickAndWaitChangeType;
  successSignal?: ClickAndWaitSuccessSignal;
  note?: string;
}

export interface SubmitWithPlanResult {
  page: PageSummary;
  inputSelector: string;
  preferredSubmitMethod: "enter" | "click" | "either";
  submitPlan: SubmitPlanStep[];
  chosenMethod: "enter" | "click";
  chosenSelector?: string;
  before: {
    title: string;
    url: string;
  };
  after: {
    title: string;
    url: string;
  };
  changed: boolean;
  pageSource: "current" | "popup" | "new_target";
  changeType: ClickAndWaitChangeType;
  successSignal: ClickAndWaitSuccessSignal;
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
  attempts: SubmitWithPlanAttempt[];
  note?: string;
}

export interface DismissBlockingOverlayAttempt {
  method:
    | "top_right_hotspot"
    | "close_candidate_click"
    | "press_escape"
    | "backdrop_click";
  selector: string;
  text?: string;
  accessibleName?: string;
  score: number;
  clicked: boolean;
  note?: string;
}

export interface OverlayDismissPlanStep {
  method:
    | "top_right_hotspot"
    | "close_candidate_click"
    | "press_escape"
    | "backdrop_click";
  confidence: number;
  reasons: string[];
  selector?: string;
  text?: string;
  accessibleName?: string;
}

export interface DismissBlockingOverlaysResult {
  page: PageSummary;
  beforePageState: PageState;
  afterPageState: PageState;
  dismissed: boolean;
  dismissPlan: OverlayDismissPlanStep[];
  chosenMethod?: OverlayDismissPlanStep["method"];
  chosenSelector?: string;
  attempts: DismissBlockingOverlayAttempt[];
  totalCandidates: number;
  note?: string;
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
