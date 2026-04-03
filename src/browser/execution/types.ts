import type { PageSummary } from "../state/types.js";

export interface TargetPreflightSummary {
  mode: "ref" | "selector";
  ref?: string;
  originalSelector?: string;
  containerSelector?: string;
  selector: string;
  selectorResolvedBy?:
    | "original_selector"
    | "runtime_node_key"
    | "fingerprint"
    | "fallback_anchor";
  selectorRebound?: boolean;
  descendedToActionTarget?: boolean;
  hasBindingRecord: boolean;
  runtimeNodeKey?: string;
  currentRuntimeNodeKey?: string;
  runtimeNodeKeyMatched?: boolean;
  contextAnchor?: string;
  currentContextAnchor?: string;
  contextAnchorMatched?: boolean;
  exists: boolean;
  visible: boolean;
  inViewport: boolean;
  hitTarget: boolean;
  stackContainsTarget?: boolean;
  allowSemanticClickFallback?: boolean;
  clickPoint?: {
    x: number;
    y: number;
  };
  fallbackClickable: boolean;
  topElementSelector?: string;
  blockedBySelector?: string;
}

export interface ActionAttemptSummary {
  kind: "click" | "type_text" | "press_key" | "submit";
  selector?: string;
  key?: string;
  strategy:
    | "semantic_click"
    | "safe_coordinate_click"
    | "locator_fill"
    | "keyboard_type"
    | "keyboard_press"
    | "form_request_submit"
    | "form_submit";
  fallbackUsed: boolean;
  preflightHitTarget?: boolean;
  textLength?: number;
  submitted?: boolean;
  submittedBy?: string;
  formSelector?: string;
  submitTargetSelector?: string;
  topElementAtPoint?: string;
  blockedBy?: string;
  activeElementMatched?: boolean;
  valueVerified?: boolean;
  focusChanged?: boolean;
  clickedPoint?: {
    x: number;
    y: number;
  };
}

export interface ActionPageSummary extends PageSummary {
  actionAttempt?: ActionAttemptSummary;
}
