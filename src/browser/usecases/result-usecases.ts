import type { WaitUntilMode } from "../../config.js";
import { BrowserToolError } from "../../errors.js";
import { clickResolvedTarget } from "../execution/safe-click.js";
import type { ActionAttemptSummary } from "../execution/types.js";
import type { WaitMatchMode } from "../observation/types.js";
import { observeAction } from "../observation/action-observation.js";
import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";
import type { BrowserInspectionUsecaseDeps } from "./inspection-usecases.js";
import { findPrimaryResultsWithRuntime } from "./inspection-usecases.js";
import { resolvePlanActionTarget } from "./plan-target-resolution.js";
import type { OpenResultWithPlanResult } from "./types.js";
import {
  collectActionFailureReasons,
  determineActionChangeType,
  determineActionSuccessSignal,
  evaluateActionVerification,
  type ActionVerificationRule,
} from "../judgement/action-judgement.js";

export async function openResultWithPlanWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
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
  },
): Promise<OpenResultWithPlanResult> {
  let page = await deps.resolvePage(options.pageId);
  const pageId = deps.requirePageId(page);
  const primaryResults = await findPrimaryResultsWithRuntime(
    createInspectionDepsFromRuntime(deps),
    {
      pageId,
      query: options.query,
      maxResults: options.maxResults ?? Math.max(options.maxPlanSteps ?? 5, 5),
    },
  );
  const openResultPlan = primaryResults.openResultPlan.slice(
    0,
    options.maxPlanSteps ?? primaryResults.openResultPlan.length,
  );

  if (openResultPlan.length === 0) {
    throw new BrowserToolError(
      "invalid_operation",
      "当前页面未生成可执行的打开结果计划。",
    );
  }

  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;
  const shouldWaitForNavigation = options.waitForNavigation ?? false;
  const verifications = buildOpenResultVerifications(options);
  const actionWaitOptions = {
    timeoutMs: options.timeoutMs,
    waitForNavigation: shouldWaitForNavigation,
    waitUntil: options.waitUntil,
    waitForSelector: options.waitForSelector,
    waitForTitle: options.waitForTitle,
    waitForUrl: options.waitForUrl,
    contentReadySelector: options.contentReadySelector,
    contentReadyText: options.contentReadyText,
    contentReadyTextSelector: options.contentReadyTextSelector,
    contentReadyTimeoutMs: options.contentReadyTimeoutMs,
    matchMode: options.matchMode,
    observeDom: true,
  } as const;
  const attempts: OpenResultWithPlanResult["attempts"] = [];

  for (const step of openResultPlan) {
    try {
      let actionAttempt: ActionAttemptSummary | undefined;
      const observation = await observeAction(
        deps,
        page,
        async () => {
          const target = await resolvePlanActionTarget(deps, page, step);
          const clickResult = await clickResolvedTarget(page, {
            selector: target.selector,
            timeoutMs,
            preflight: target.preflight,
          });
          actionAttempt = clickResult.actionAttempt;
        },
        actionWaitOptions,
      );

      const verification = await evaluateActionVerification(observation, {
        verifications,
        requireObservedChange: true,
        requireStrongObservedChange: true,
      });
      const changeType = determineActionChangeType(observation);
      const successSignal = determineActionSuccessSignal(
        observation,
        actionWaitOptions,
      );

      attempts.push({
        method: step.method,
        confidence: step.confidence,
        reasons: step.reasons,
        selector: step.target?.selector ?? step.selector,
        href: step.href,
        text: step.text,
        accessibleName: step.accessibleName,
        changed: observation.changed,
        actionAttempt,
        pageSource: observation.pageSource,
        changeType,
        successSignal,
        note: verification.passed
          ? observation.note
          : (
              await collectActionFailureReasons(
                observation,
                verification.reports,
                {
                  requireObservedChange: true,
                  requireStrongObservedChange: true,
                  contentReadySelector: options.contentReadySelector,
                  contentReadyText: options.contentReadyText,
                },
              )
            ).join(" | "),
      });

      page = observation.finalPage;

      if (!verification.passed) {
        continue;
      }

      return {
        page: await deps.summarizePage(
          deps.requirePageId(observation.finalPage),
          observation.finalPage,
        ),
        query: primaryResults.query,
        total: primaryResults.total,
        openResultPlan,
        chosenMethod: step.method,
        chosenSelector: step.target?.selector ?? step.selector,
        actionAttempt,
        before: observation.before,
        after: observation.after,
        changed: observation.changed,
        pageSource: observation.pageSource,
        changeType,
        successSignal,
        observed: observation.observed,
        contentReady: observation.contentReady,
        contentReadySignal: observation.contentReadySignal,
        domObservation: observation.domObservation,
        attempts,
        note:
          attempts.length > 1
            ? `已按结果计划尝试 ${attempts.length} 步。`
            : observation.note,
      };
    } catch (error) {
      attempts.push({
        method: step.method,
        confidence: step.confidence,
        reasons: step.reasons,
        selector: step.target?.selector ?? step.selector,
        href: step.href,
        text: step.text,
        accessibleName: step.accessibleName,
        changed: false,
        successSignal: "none",
        note: error instanceof Error ? error.message : String(error),
      });
      page = await deps.resolvePage(deps.getCurrentPageId());
    }
  }

  throw new BrowserToolError(
    "action_verification_failed",
    `按结果计划尝试后仍未成功：${attempts
      .map((attempt) => {
        const target = attempt.selector ? `(${attempt.selector})` : "";
        const note = attempt.note ? ` ${attempt.note}` : "";
        return `${attempt.method}${target}${note}`;
      })
      .join(" | ")}`,
    {
      attempts,
      planLength: openResultPlan.length,
    },
  );
}

function buildOpenResultVerifications(options: {
  waitForSelector?: string;
  waitForTitle?: string;
  waitForUrl?: string;
  contentReadySelector?: string;
  contentReadyText?: string;
  contentReadyTextSelector?: string;
  matchMode?: WaitMatchMode;
}): ActionVerificationRule[] {
  const verifications: ActionVerificationRule[] = [];

  if (options.waitForUrl) {
    verifications.push({
      kind: "url",
      expected: options.waitForUrl,
      matchMode: options.matchMode,
    });
  }

  if (options.waitForTitle) {
    verifications.push({
      kind: "title",
      expected: options.waitForTitle,
      matchMode: options.matchMode,
    });
  }

  if (options.waitForSelector) {
    verifications.push({
      kind: "selectorVisible",
      selector: options.waitForSelector,
    });
  }

  if (options.contentReadySelector) {
    verifications.push({
      kind: "contentSelectorVisible",
      selector: options.contentReadySelector,
    });
  }

  if (options.contentReadyText) {
    verifications.push({
      kind: "contentText",
      text: options.contentReadyText,
      textSelector: options.contentReadyTextSelector,
      matchMode: options.matchMode,
    });
  }

  return verifications;
}

function createInspectionDepsFromRuntime(
  deps: BrowserRuntimeDeps,
): BrowserInspectionUsecaseDeps {
  return {
    defaultTimeoutMs: deps.config.defaultTimeoutMs,
    resolvePage: (pageId) => deps.resolvePage(pageId),
    requirePageId: (page) => deps.requirePageId(page),
    summarizePage: (pageId, page) => deps.summarizePage(pageId, page),
    attachElementRefs: (pageId, elements) =>
      deps.attachElementRefs(pageId, elements),
    resolveSelectorForRef: (pageId, ref) =>
      deps.resolveSelectorForRef(pageId, ref),
    getBindingRecord: (pageId, ref) => deps.getBindingRecord(pageId, ref),
  };
}
