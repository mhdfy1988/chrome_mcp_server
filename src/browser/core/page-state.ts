import type { Page } from "puppeteer-core";
import { detectBlockingOverlays } from "./blocking-overlays.js";
import type {
  AuthRequiredSummary,
  OverlayBlockingSummary,
  PageState,
  VerificationBlockSummary,
  VerificationProviderHint,
} from "./types.js";

export interface VerificationDetectionSource {
  title: string;
  url: string;
  text: string;
}

interface AuthUiHints {
  hasVisiblePasswordInput: boolean;
  hasVisibleEmailInput: boolean;
  hasAuthDialog: boolean;
}

const RECOMMENDED_ACTION: VerificationBlockSummary["recommendedAction"] =
  "manual_resume";

const AUTO_WAIT_PATTERNS = [
  "checking your browser",
  "checking your browser before you access",
  "redirect to your requested content shortly",
  "please wait",
  "one more step",
  "one moment",
];

const MANUAL_PATTERNS = [
  "captcha",
  "verify you are human",
  "are you a human",
  "press and hold",
  "client challenge",
];

const RULES: Array<{
  providerHint: VerificationProviderHint;
  patterns: string[];
}> = [
  {
    providerHint: "cloudflare",
    patterns: [
      "just a moment",
      "attention required",
      "checking your browser",
      "__cf_chl",
      "/cdn-cgi/challenge",
      "cloudflare",
    ],
  },
  {
    providerHint: "datadome",
    patterns: [
      "datadome",
      "captcha delivered by datadome",
      "please enable js and disable",
    ],
  },
  {
    providerHint: "perimeterx",
    patterns: [
      "perimeterx",
      "press and hold",
      "are you a human",
    ],
  },
  {
    providerHint: "generic",
    patterns: [
      "client challenge",
      "pardon our interruption",
      "checking your browser before you access",
      "verify you are human",
      "captcha",
      "/challenge",
      "/captcha",
      "/verify",
      "security check",
      "bot check",
      "robot check",
    ],
  },
];

const AUTH_PATTERNS = [
  "login to continue",
  "log in to continue",
  "sign in to continue",
  "sign in",
  "log in",
  "forgot password",
  "continue with google",
  "continue with apple",
  "登录以查看更多",
  "登录后查看更多",
  "登录以继续",
  "登录后继续",
  "请登录",
  "忘记密码",
  "电子邮件",
  "密码",
  "使用二维码",
];

function normalize(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function pushEvidence(
  evidence: string[],
  sourceName: string,
  sourceValue: string,
  patterns: string[],
): void {
  for (const pattern of patterns) {
    if (sourceValue.includes(pattern)) {
      evidence.push(`${sourceName}:${pattern}`);
    }
  }
}

export function detectVerificationBlock(
  source: VerificationDetectionSource,
): VerificationBlockSummary | undefined {
  const title = normalize(source.title);
  const url = normalize(source.url);
  const text = normalize(source.text);

  let providerHint: VerificationProviderHint | undefined;
  const evidence: string[] = [];

  for (const rule of RULES) {
    const beforeCount = evidence.length;
    pushEvidence(evidence, "title", title, rule.patterns);
    pushEvidence(evidence, "url", url, rule.patterns);
    pushEvidence(evidence, "text", text, rule.patterns);

    if (evidence.length > beforeCount && !providerHint) {
      providerHint = rule.providerHint;
    }
  }

  if (evidence.length === 0) {
    return undefined;
  }

  const combined = [title, url, text].join(" ");
  const recommendedAction = AUTO_WAIT_PATTERNS.some((pattern) =>
    combined.includes(pattern),
  )
    ? "wait_then_resume"
    : MANUAL_PATTERNS.some((pattern) => combined.includes(pattern))
      ? "manual_resume"
      : RECOMMENDED_ACTION;

  return {
    providerHint: providerHint ?? "unknown",
    evidence: Array.from(new Set(evidence)).slice(0, 6),
    recommendedAction,
  };
}

export function describeVerificationAction(
  action: VerificationBlockSummary["recommendedAction"],
): string {
  switch (action) {
    case "wait_then_resume":
      return "建议先等待几秒观察是否自动放行；若仍停留在验证页，再人工完成验证并继续当前会话。";
    case "manual_resume":
      return "建议先人工完成验证，再继续当前会话。";
    case "allowlist":
      return "建议对测试环境或测试账号做白名单放行。";
    case "use_existing_browser_session":
      return "建议先连接已由人工完成验证的浏览器会话。";
    default:
      return "建议先人工确认当前验证页状态，再继续当前会话。";
  }
}

export function detectAuthRequired(
  source: VerificationDetectionSource,
  ui: AuthUiHints,
): AuthRequiredSummary | undefined {
  const title = normalize(source.title);
  const url = normalize(source.url);
  const text = normalize(source.text);
  const evidence: string[] = [];

  pushEvidence(evidence, "title", title, AUTH_PATTERNS);
  pushEvidence(evidence, "url", url, AUTH_PATTERNS);
  pushEvidence(evidence, "text", text, AUTH_PATTERNS);

  if (ui.hasVisiblePasswordInput) {
    evidence.push("ui:visible_password_input");
  }

  if (ui.hasVisibleEmailInput) {
    evidence.push("ui:visible_email_input");
  }

  if (ui.hasAuthDialog) {
    evidence.push("ui:auth_dialog");
  }

  const hasStrongAuthUi =
    ui.hasVisiblePasswordInput && (ui.hasVisibleEmailInput || ui.hasAuthDialog);

  if (!hasStrongAuthUi && evidence.length < 2) {
    return undefined;
  }

  return {
    kind: ui.hasAuthDialog ? "login_gate" : "auth_page",
    evidence: Array.from(new Set(evidence)).slice(0, 6),
    recommendedAction: ui.hasAuthDialog
      ? "use_existing_browser_session"
      : "manual_login",
  };
}

export function describeAuthRequiredAction(
  action: AuthRequiredSummary["recommendedAction"],
): string {
  switch (action) {
    case "use_existing_browser_session":
      return "这不是可关闭弹窗；建议使用已登录会话继续，或先人工登录后复用当前页面。";
    case "manual_login":
      return "这不是可关闭弹窗；建议先使用测试账号登录，再继续当前会话。";
    case "change_entry":
      return "这不是可关闭弹窗；建议切换到无需登录的入口后再继续。";
    default:
      return "这不是可关闭弹窗；建议先确认当前登录门槛，再继续当前会话。";
  }
}

export async function readPageState(page: Page): Promise<{
  pageState: PageState;
  verification?: VerificationBlockSummary;
  overlay?: OverlayBlockingSummary;
  authRequired?: AuthRequiredSummary;
}> {
  const title = await page.title().catch(() => "");
  const url = page.url();
  const text = await page
    .evaluate(() =>
      (document.body?.innerText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200),
    )
    .catch(() => "");

  const authUiHints = await page
    .evaluate(() => {
      const isVisible = (element: Element | null | undefined) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const hasVisiblePasswordInput = Array.from(
        document.querySelectorAll("input[type='password']"),
      ).some((element) => isVisible(element));

      const hasVisibleEmailInput = Array.from(
        document.querySelectorAll(
          "input[type='email'], input[name*='email' i], input[autocomplete='email']",
        ),
      ).some((element) => isVisible(element));

      const hasAuthDialog = Array.from(
        document.querySelectorAll(
          "dialog, [role='dialog'], [aria-modal='true'], form, section, div",
        ),
      ).some((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) {
          return false;
        }

        const text = (element.innerText ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .toLocaleLowerCase();
        if (!element.querySelector("input[type='password']")) {
          return false;
        }

        if (
          !text.includes("login") &&
          !text.includes("sign in") &&
          !text.includes("登录") &&
          !text.includes("密码")
        ) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width >= window.innerWidth * 0.2 &&
          rect.height >= window.innerHeight * 0.2;
      });

      return {
        hasVisiblePasswordInput,
        hasVisibleEmailInput,
        hasAuthDialog,
      };
    })
    .catch<AuthUiHints>(() => ({
      hasVisiblePasswordInput: false,
      hasVisibleEmailInput: false,
      hasAuthDialog: false,
    }));

  const verification = detectVerificationBlock({
    title,
    url,
    text,
  });

  if (verification) {
    return {
      pageState: "blocked_by_verification",
      verification,
    };
  }

  const overlay = await detectBlockingOverlays(page);
  if (
    overlay.blocked &&
    overlay.summary &&
    overlay.summary.recommendedAction === "auto_close_then_resume"
  ) {
    return {
      pageState: "overlay_blocking",
      overlay: overlay.summary,
    };
  }

  const authRequired = detectAuthRequired(
    {
      title,
      url,
      text,
    },
    authUiHints,
  );

  if (authRequired) {
    return {
      pageState: "auth_required",
      authRequired,
    };
  }

  if (overlay.blocked && overlay.summary) {
    return {
      pageState: "overlay_blocking",
      overlay: overlay.summary,
    };
  }

  return {
    pageState: "normal",
  };
}
