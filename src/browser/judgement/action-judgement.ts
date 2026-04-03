import type { Page } from "puppeteer-core";
import type {
  ClickAndWaitChangeType,
  ClickAndWaitSuccessSignal,
  WaitMatchMode,
} from "../observation/types.js";
import {
  describeAuthRequiredAction,
  describeVerificationAction,
  readPageState,
} from "../state/page-state.js";
import type {
  ActionObservationResult,
  ActionWaitOptions,
} from "../observation/action-observation.js";

export type ActionVerificationRule =
  | {
      kind: "inputValue";
      selector: string;
      expected: string;
      matchMode?: WaitMatchMode;
    }
  | {
      kind: "selectorVisible";
      selector: string;
    }
  | {
      kind: "url";
      expected: string;
      matchMode?: WaitMatchMode;
    }
  | {
      kind: "title";
      expected: string;
      matchMode?: WaitMatchMode;
    }
  | {
      kind: "contentSelectorVisible";
      selector: string;
    }
  | {
      kind: "contentText";
      text: string;
      textSelector?: string;
      matchMode?: WaitMatchMode;
    }
  | {
      kind: "pageSwitched";
    };

export interface ActionVerificationReport {
  kind: ActionVerificationRule["kind"];
  passed: boolean;
  detail: string;
}

export interface ActionExecutionOptions extends ActionWaitOptions {
  maxRetries?: number;
  retryBackoffMs?: number;
  requireObservedChange?: boolean;
  requireStrongObservedChange?: boolean;
  verifications?: ActionVerificationRule[];
}

export interface ActionExecutionResult extends ActionObservationResult {
  attempts: number;
  verificationPassed: boolean;
  verificationReports: ActionVerificationReport[];
}

function normalizeUrlWithoutHash(value: string): string {
  try {
    const url = new URL(value);
    const search = Array.from(url.searchParams.entries())
      .map(([key, currentValue]) => `${key}=${currentValue}`)
      .join("&");
    return `${url.origin}${url.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return value.split("#", 1)[0]?.replace(/\?$/, "") ?? value;
  }
}

function hasNavigationLikeUrlChange(
  before: { title: string; url: string },
  after: { title: string; url: string },
): boolean {
  return normalizeUrlWithoutHash(before.url) !== normalizeUrlWithoutHash(after.url);
}

function textMatches(
  actual: string,
  expected: string,
  mode: WaitMatchMode = "contains",
): boolean {
  if (mode === "exact") {
    return actual === expected;
  }

  return actual.includes(expected);
}

async function readElementTextForVerification(
  page: Page,
  selector: string,
): Promise<{
  ok: boolean;
  text: string;
  note?: string;
}> {
  try {
    const value = await page.$eval(selector, (element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        return String(element.value ?? "");
      }

      const asHTMLElement = element as HTMLElement;
      return String(asHTMLElement.innerText ?? element.textContent ?? "");
    });

    return {
      ok: true,
      text: value,
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readElementVisibilityForVerification(
  page: Page,
  selector: string,
): Promise<{
  ok: boolean;
  visible: boolean;
  note?: string;
}> {
  try {
    const visible = await page.$eval(selector, (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });

    return {
      ok: true,
      visible,
    };
  } catch (error) {
    return {
      ok: false,
      visible: false,
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function evaluateVerificationRules(
  observation: ActionObservationResult,
  rules: ActionVerificationRule[],
): Promise<{
  passed: boolean;
  reports: ActionVerificationReport[];
}> {
  if (rules.length === 0) {
    return { passed: true, reports: [] };
  }

  const reports: ActionVerificationReport[] = [];

  for (const rule of rules) {
    switch (rule.kind) {
      case "inputValue": {
        const result = await readElementTextForVerification(
          observation.finalPage,
          rule.selector,
        );
        const mode = rule.matchMode ?? "exact";
        const passed = result.ok && textMatches(result.text, rule.expected, mode);
        reports.push({
          kind: "inputValue",
          passed,
          detail: result.ok
            ? `expected(${mode})=${rule.expected}; actual=${result.text}`
            : `selector=${rule.selector}; error=${result.note ?? "unknown"}`,
        });
        break;
      }
      case "selectorVisible": {
        const result = await readElementVisibilityForVerification(
          observation.finalPage,
          rule.selector,
        );
        reports.push({
          kind: "selectorVisible",
          passed: result.ok && result.visible,
          detail: result.ok
            ? `selector=${rule.selector}; visible=${result.visible}`
            : `selector=${rule.selector}; error=${result.note ?? "unknown"}`,
        });
        break;
      }
      case "url": {
        const mode = rule.matchMode ?? "contains";
        const actual = observation.after.url;
        reports.push({
          kind: "url",
          passed: textMatches(actual, rule.expected, mode),
          detail: `expected(${mode})=${rule.expected}; actual=${actual}`,
        });
        break;
      }
      case "title": {
        const mode = rule.matchMode ?? "contains";
        const actual = observation.after.title;
        reports.push({
          kind: "title",
          passed: textMatches(actual, rule.expected, mode),
          detail: `expected(${mode})=${rule.expected}; actual=${actual}`,
        });
        break;
      }
      case "contentSelectorVisible": {
        const result = await readElementVisibilityForVerification(
          observation.finalPage,
          rule.selector,
        );
        reports.push({
          kind: "contentSelectorVisible",
          passed: result.ok && result.visible,
          detail: result.ok
            ? `selector=${rule.selector}; visible=${result.visible}`
            : `selector=${rule.selector}; error=${result.note ?? "unknown"}`,
        });
        break;
      }
      case "contentText": {
        try {
          const actual = await observation.finalPage.evaluate(
            ({ expectedSelector }) => {
              const root = expectedSelector
                ? document.querySelector(expectedSelector)
                : document.body;

              if (!root) {
                return "";
              }

              if (
                root instanceof HTMLInputElement ||
                root instanceof HTMLTextAreaElement ||
                root instanceof HTMLSelectElement
              ) {
                return String(root.value ?? "");
              }

              const element = root as HTMLElement;
              return String(element.innerText ?? root.textContent ?? "");
            },
            { expectedSelector: rule.textSelector },
          );
          const mode = rule.matchMode ?? "contains";
          reports.push({
            kind: "contentText",
            passed: textMatches(actual, rule.text, mode),
            detail: `expected(${mode})=${rule.text}; actual=${actual}`,
          });
        } catch (error) {
          reports.push({
            kind: "contentText",
            passed: false,
            detail: `selector=${rule.textSelector ?? "document.body"}; error=${error instanceof Error ? error.message : String(error)}`,
          });
        }
        break;
      }
      case "pageSwitched": {
        const switched =
          observation.pageSource !== "current" ||
          observation.observed.popup ||
          observation.observed.target ||
          observation.observed.pageCountChanged;
        reports.push({
          kind: "pageSwitched",
          passed: switched,
          detail: `source=${observation.pageSource}; popup=${observation.observed.popup}; target=${observation.observed.target}; pageCountChanged=${observation.observed.pageCountChanged}`,
        });
        break;
      }
      default: {
        const exhaustiveCheck: never = rule;
        void exhaustiveCheck;
      }
    }
  }

  return {
    passed: reports.every((report) => report.passed),
    reports,
  };
}

export function hasStrongObservedChange(
  observation: ActionObservationResult,
): boolean {
  return (
    observation.observed.stateChanged ||
    observation.pageSource !== "current" ||
    observation.observed.navigation ||
    observation.observed.selector ||
    observation.observed.title ||
    observation.observed.url ||
    observation.observed.dom ||
    observation.observed.popup ||
    observation.observed.target
  );
}

export async function evaluateActionVerification(
  observation: ActionObservationResult,
  options: Pick<
    ActionExecutionOptions,
    "verifications" | "requireObservedChange" | "requireStrongObservedChange"
  > = {},
): Promise<{
  passed: boolean;
  reports: ActionVerificationReport[];
}> {
  const verification = await evaluateVerificationRules(
    observation,
    options.verifications ?? [],
  );

  const passed =
    verification.passed &&
    (!options.requireObservedChange || observation.changed) &&
    (!options.requireStrongObservedChange ||
      hasStrongObservedChange(observation));

  return {
    passed,
    reports: verification.reports,
  };
}

export async function collectActionFailureReasons(
  observation: ActionObservationResult,
  reports: ActionVerificationReport[],
  options: Pick<
    ActionExecutionOptions,
    | "requireObservedChange"
    | "requireStrongObservedChange"
    | "contentReadySelector"
    | "contentReadyText"
  > = {},
): Promise<string[]> {
  const failureReasons: string[] = [];

  for (const report of reports) {
    if (!report.passed) {
      failureReasons.push(`${report.kind}: ${report.detail}`);
    }
  }

  if (options.requireObservedChange && !observation.changed) {
    failureReasons.push("未观察到页面变化。");
  }

  if (
    options.requireStrongObservedChange &&
    !hasStrongObservedChange(observation)
  ) {
    failureReasons.push(
      "只观察到弱变化（例如仅标题/URL轻微漂移或噪声状态），未命中强信号。",
    );
  }

  if (
    (options.contentReadySelector || options.contentReadyText) &&
    !observation.contentReady
  ) {
    failureReasons.push("路由可能已变化，但内容区仍未达到就绪条件。");
  }

  const pageState = await readPageState(observation.finalPage);
  if (pageState.pageState === "blocked_by_verification") {
    const providerHint = pageState.verification?.providerHint ?? "unknown";
    const evidence = pageState.verification?.evidence?.join(", ") ?? "无";
    const guidance = describeVerificationAction(
      pageState.verification?.recommendedAction ?? "manual_resume",
    );
    failureReasons.push(
      `页面当前处于验证拦截状态（blocked_by_verification，provider=${providerHint}，evidence=${evidence}）。${guidance}`,
    );
  }

  if (pageState.pageState === "auth_required") {
    const kind = pageState.authRequired?.kind ?? "unknown";
    const evidence = pageState.authRequired?.evidence?.join(", ") ?? "无";
    const guidance = describeAuthRequiredAction(
      pageState.authRequired?.recommendedAction ?? "manual_login",
    );
    failureReasons.push(
      `页面当前处于登录拦截状态（auth_required，kind=${kind}，evidence=${evidence}）。${guidance}`,
    );
  }

  if (pageState.pageState === "overlay_blocking") {
    const kind = pageState.overlay?.kind ?? "unknown";
    const evidence = pageState.overlay?.evidence?.join(", ") ?? "无";
    failureReasons.push(
      `页面当前存在可关闭的遮挡弹窗（overlay_blocking，kind=${kind}，evidence=${evidence}）。建议先调用 dismiss_blocking_overlays，再继续当前会话。`,
    );
  }

  if (observation.actionError) {
    failureReasons.push(`动作执行瞬时错误: ${observation.actionError}`);
  }

  return failureReasons;
}

export function determineActionChangeType(
  observation: ActionObservationResult,
): ClickAndWaitChangeType {
  if (observation.pageSource === "popup" || observation.observed.popup) {
    return "popup";
  }

  if (observation.pageSource === "new_target" || observation.observed.target) {
    return "new_target";
  }

  if (
    observation.observed.navigation ||
    hasNavigationLikeUrlChange(observation.before, observation.after)
  ) {
    return "navigation";
  }

  if (observation.observed.dom || observation.changed) {
    return "same_page_update";
  }

  return "none";
}

export function determineActionSuccessSignal(
  observation: ActionObservationResult,
  options: ActionWaitOptions,
): ClickAndWaitSuccessSignal {
  if (observation.pageSource === "popup" || observation.observed.popup) {
    return "popup";
  }

  if (observation.pageSource === "new_target" || observation.observed.target) {
    return "new_target";
  }

  if (options.waitForSelector && observation.observed.selector) {
    return "selector";
  }

  if (options.contentReadySelector && observation.observed.contentSelector) {
    return "content_selector";
  }

  if (options.contentReadyText && observation.observed.contentText) {
    return "content_text";
  }

  if (options.waitForUrl && observation.observed.url) {
    return "url";
  }

  if (options.waitForTitle && observation.observed.title) {
    return "title";
  }

  if (observation.observed.navigation) {
    return "navigation";
  }

  if (observation.observed.dom) {
    return "dom";
  }

  if (observation.observed.pageCountChanged) {
    return "page_count_changed";
  }

  if (observation.observed.stateChanged) {
    return "state_changed";
  }

  return "none";
}
