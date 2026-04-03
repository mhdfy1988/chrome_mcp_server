import type { PageSummary } from "../state/types.js";

export interface SnapshotElementSummary {
  ref: string;
  index: number;
  tag: string;
  role?: string;
  axRole?: string;
  semanticRole?: string;
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
  runtimeNodeKey?: string;
  contextAnchor?: string;
  href?: string;
  cursorStyle?: string;
  hasJsClickListener?: boolean;
  isLabelProxy?: boolean;
  formControlRelation?: string;
  semanticSignals?: string[];
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

export interface PlanTargetRef {
  ref: string;
  selector: string;
  runtimeNodeKey?: string;
  fingerprint?: string;
  contextAnchor?: string;
  fallbackAnchors?: string[];
}

export interface OpenResultPlanStep {
  method: "title_link" | "card_primary_link" | "container_link" | "thumbnail_link";
  confidence: number;
  reasons: string[];
  target?: PlanTargetRef; 
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
  target?: PlanTargetRef;
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
  target?: PlanTargetRef;
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

export interface MediaPlayPlanStep {
  method: "already_playing" | "click_media_surface" | "click_play_button";
  confidence: number;
  reasons: string[];
  target?: PlanTargetRef;
  selector?: string;
  text?: string;
  accessibleName?: string;
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
