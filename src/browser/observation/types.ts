export interface DomObservationSummary {
  changed: boolean;
  mutationCount: number;
  addedNodes: number;
  removedNodes: number;
  textChanges: number;
  attributeChanges: number;
  topSelectors: string[];
}

export interface ActionObservedSignals {
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

export type WaitMatchMode = "contains" | "exact";
