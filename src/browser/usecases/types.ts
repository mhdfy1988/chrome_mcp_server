import type {
  MediaPlayPlanStep,
  OpenResultPlanStep,
  PlanTargetRef,
  SubmitPlanStep,
} from "../discovery/types.js";
import type {
  ActionAttemptSummary,
  TargetPreflightSummary,
} from "../execution/types.js";
import type {
  ActionObservedSignals,
  ClickAndWaitChangeType,
  ClickAndWaitSuccessSignal,
  ContentReadySignal,
  DomObservationSummary,
} from "../observation/types.js";
import type { PageState, PageSummary } from "../state/types.js";

export interface SubmitInputResult {
  page: PageSummary;
  selector: string;
  before: {
    title: string;
    url: string;
  };
  changed: boolean;
  strategy?: "enter" | "form_request_submit" | "form_submit" | "nearby_click";
  actionAttempt?: ActionAttemptSummary;
  attempts: Array<{
    strategy: "enter" | "form_request_submit" | "form_submit" | "nearby_click";
    changed: boolean;
    actionAttempt?: ActionAttemptSummary;
    note?: string;
  }>;
}

export interface SubmitWithPlanAttempt {
  method: "enter" | "click";
  confidence: number;
  reasons: string[];
  selector?: string;
  changed: boolean;
  actionAttempt?: ActionAttemptSummary;
  pageSource?: "current" | "popup" | "new_target";
  changeType?: ClickAndWaitChangeType;
  successSignal?: ClickAndWaitSuccessSignal;
  note?: string;
}

export interface OpenResultWithPlanAttempt {
  method:
    | "title_link"
    | "card_primary_link"
    | "container_link"
    | "thumbnail_link";
  confidence: number;
  reasons: string[];
  selector?: string;
  href?: string;
  text?: string;
  accessibleName?: string;
  changed: boolean;
  actionAttempt?: ActionAttemptSummary;
  pageSource?: "current" | "popup" | "new_target";
  changeType?: ClickAndWaitChangeType;
  successSignal?: ClickAndWaitSuccessSignal;
  note?: string;
}

export interface OpenResultWithPlanResult {
  page: PageSummary;
  query?: string;
  total: number;
  openResultPlan: OpenResultPlanStep[];
  chosenMethod: OpenResultPlanStep["method"];
  chosenSelector?: string;
  actionAttempt?: ActionAttemptSummary;
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
  observed: ActionObservedSignals;
  contentReady: boolean;
  contentReadySignal: ContentReadySignal;
  domObservation: DomObservationSummary;
  attempts: OpenResultWithPlanAttempt[];
  note?: string;
}

export interface PlayMediaWithPlanAttempt {
  method: "already_playing" | "click_media_surface" | "click_play_button";
  confidence: number;
  reasons: string[];
  selector?: string;
  text?: string;
  accessibleName?: string;
  changed: boolean;
  actionAttempt?: ActionAttemptSummary;
  playing: boolean;
  note?: string;
}

export interface PlayMediaWithPlanResult {
  page: PageSummary;
  total: number;
  playMediaPlan: MediaPlayPlanStep[];
  chosenMethod: MediaPlayPlanStep["method"];
  chosenSelector?: string;
  actionAttempt?: ActionAttemptSummary;
  beforePrimaryPaused?: boolean;
  beforePrimaryCurrentTime?: number;
  afterPrimaryPaused?: boolean;
  afterPrimaryCurrentTime?: number;
  playbackChanged: boolean;
  playing: boolean;
  attempts: PlayMediaWithPlanAttempt[];
  note?: string;
}

export interface SubmitWithPlanResult {
  page: PageSummary;
  inputSelector: string;
  preferredSubmitMethod: "enter" | "click" | "either";
  submitPlan: SubmitPlanStep[];
  chosenMethod: "enter" | "click";
  chosenSelector?: string;
  actionAttempt?: ActionAttemptSummary;
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
  observed: ActionObservedSignals;
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
  target?: PlanTargetRef;
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

export interface ClickAndWaitResult {
  page: PageSummary;
  selector: string;
  preflight?: TargetPreflightSummary;
  actionAttempt?: ActionAttemptSummary;
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
  observed: ActionObservedSignals;
  contentReady: boolean;
  contentReadySignal: ContentReadySignal;
  domObservation: DomObservationSummary;
  note?: string;
}

export interface PressKeyAndWaitResult {
  page: PageSummary;
  key: string;
  actionAttempt?: ActionAttemptSummary;
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
  observed: ActionObservedSignals;
  contentReady: boolean;
  contentReadySignal: ContentReadySignal;
  domObservation: DomObservationSummary;
  note?: string;
}
