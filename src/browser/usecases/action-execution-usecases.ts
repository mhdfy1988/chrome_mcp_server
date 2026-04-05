import type { Page } from "puppeteer-core";
import { BrowserToolError } from "../../errors.js";
import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";
import {
  observeAction,
  type ActionObservationResult,
} from "../observation/action-observation.js";
import {
  collectActionFailureReasons,
  evaluateActionVerification,
  type ActionExecutionOptions,
  type ActionExecutionResult,
  type ActionVerificationReport,
} from "../judgement/action-judgement.js";

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runActionWithVerification(
  deps: BrowserRuntimeDeps,
  page: Page,
  action: (page: Page) => Promise<void>,
  options: ActionExecutionOptions = {},
): Promise<ActionExecutionResult> {
  const maxRetries = options.maxRetries ?? deps.config.maxRetries;
  const retryBackoffMs = options.retryBackoffMs ?? deps.config.retryBackoffMs;
  const rules = options.verifications ?? [];
  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;
  const requireObservedChange = options.requireObservedChange ?? false;
  const requireStrongObservedChange =
    options.requireStrongObservedChange ?? false;

  let currentPage = page;
  let lastObservation: ActionObservationResult | undefined;
  let lastReports: ActionVerificationReport[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const observation = await observeAction(
      deps,
      currentPage,
      async () => action(currentPage),
      {
        ...options,
        timeoutMs,
      },
    );
    lastObservation = observation;

    const verification = await evaluateActionVerification(observation, {
      verifications: rules,
      requireObservedChange,
      requireStrongObservedChange,
    });
    lastReports = verification.reports;

    if (verification.passed) {
      return {
        ...observation,
        attempts: attempt + 1,
        verificationPassed: true,
        verificationReports: verification.reports,
      };
    }

    if (attempt < maxRetries) {
      currentPage = observation.finalPage;
      await deps.syncPages();
      await wait(retryBackoffMs * (attempt + 1));
    }
  }

  if (!lastObservation) {
    throw new Error("动作执行失败：没有捕获到有效结果。");
  }

  const failureReasons = await collectActionFailureReasons(
    lastObservation,
    lastReports,
    {
      requireObservedChange,
      requireStrongObservedChange,
      contentReadySelector: options.contentReadySelector,
      contentReadyText: options.contentReadyText,
    },
  );

  throw new BrowserToolError(
    "action_verification_failed",
    `动作验证失败（重试 ${maxRetries + 1} 次后仍未通过）：${failureReasons.join(" | ") || "未知原因"}`,
    {
      attempts: maxRetries + 1,
      failureReasons,
    },
  );
}
