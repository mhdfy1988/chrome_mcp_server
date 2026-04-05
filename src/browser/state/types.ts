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
  safetyPolicy: {
    browserOwnership: "managed" | "external";
    closeBrowserBehavior: "close_browser_process" | "disconnect_only";
    closePageBehavior: "allow_close_page" | "block_close_page";
  };
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
  note?: string;
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

export interface EvaluateResult {
  page: PageSummary;
  value: string;
  jsonValue?: unknown;
  jsonValueError?: string;
}
