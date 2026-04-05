import type { KeyInput, Page } from "puppeteer-core";
import type { WaitUntilMode } from "../../config.js";
import { BrowserToolError } from "../../errors.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";
import type {
  ActionAttemptSummary,
  ActionPageSummary,
} from "../execution/types.js";
import type { ClickAndWaitResult, PressKeyAndWaitResult } from "./types.js";
import type { WaitMatchMode } from "../observation/types.js";
import { clickResolvedTarget } from "../execution/safe-click.js";
import { resolveActionTargetWithPreflight } from "../execution/target-preflight.js";
import {
  determineActionChangeType,
  determineActionSuccessSignal,
  type ActionVerificationRule,
} from "../judgement/action-judgement.js";
import { runActionWithVerification } from "./action-execution-usecases.js";
export {
  submitInputWithRuntime,
  submitWithPlanWithRuntime,
} from "./submit-usecases.js";

export async function clickWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    pageId?: string;
    timeoutMs?: number;
  },
): Promise<ActionPageSummary> {
  const { page, pageId, selector, preflight } = await resolveActionTargetWithPreflight(
    deps,
    options,
  );
  let actionAttempt: ActionAttemptSummary | undefined;
  const result = await runActionWithVerification(
    deps,
    page,
    async (currentPage) => {
      const clickResult = await clickResolvedTarget(currentPage, {
        selector,
        timeoutMs: options.timeoutMs ?? deps.config.stepTimeoutMs,
        preflight,
      });
      actionAttempt = clickResult.actionAttempt;
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: 0,
      requireObservedChange: false,
    },
  );

  return deps.summarizePage(
    result.pageSource === "current" ? pageId : deps.requirePageId(result.finalPage),
    result.finalPage,
  );
}

export async function clickAndWaitWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    pageId?: string;
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
  },
): Promise<ClickAndWaitResult> {
  const { page, selector, preflight } = await resolveActionTargetWithPreflight(
    deps,
    options,
  );
  let actionAttempt: ActionAttemptSummary | undefined;
  const verifications: ActionVerificationRule[] = [];
  const shouldWaitForNavigation = options.waitForNavigation ?? false;

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

  const observation = await runActionWithVerification(
    deps,
    page,
    async (currentPage) => {
      const clickResult = await clickResolvedTarget(currentPage, {
        selector,
        timeoutMs: options.timeoutMs ?? deps.config.stepTimeoutMs,
        preflight,
      });
      actionAttempt = clickResult.actionAttempt;
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: 0,
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
      requireObservedChange: true,
      requireStrongObservedChange: true,
      verifications,
    },
  );

  return {
    page: await deps.summarizePage(
      deps.requirePageId(observation.finalPage),
      observation.finalPage,
    ),
    selector,
    preflight,
    actionAttempt,
    pageSource: observation.pageSource,
    changeType: determineActionChangeType(observation),
    successSignal: determineActionSuccessSignal(observation, {
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
      timeoutMs: options.timeoutMs,
    }),
    before: observation.before,
    after: observation.after,
    changed: observation.changed,
    observed: observation.observed,
    contentReady: observation.contentReady,
    contentReadySignal: observation.contentReadySignal,
    domObservation: observation.domObservation,
    note:
      observation.attempts > 1
        ? `已重试 ${observation.attempts} 次。`
        : observation.note,
  };
}

export async function typeTextWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    text: string;
    pageId?: string;
    clear: boolean;
    submit: boolean;
    timeoutMs?: number;
  },
): Promise<ActionPageSummary> {
  const { page, pageId, selector, preflight } = await resolveActionTargetWithPreflight(
    deps,
    options,
  );
  const beforeFocusSelector = await readActiveElementSelector(page);
  const actionAttempt: ActionAttemptSummary = {
    kind: "type_text",
    selector,
    strategy: options.clear ? "locator_fill" : "keyboard_type",
    fallbackUsed: false,
    preflightHitTarget: preflight.hitTarget,
    textLength: options.text.length,
    submitted: options.submit,
    submittedBy: options.submit ? "enter_after_type" : undefined,
    topElementAtPoint: preflight.topElementSelector,
    blockedBy: preflight.blockedBySelector,
  };
  const observation = await runActionWithVerification(
    deps,
    page,
    async (currentPage) => {
      const locator = currentPage
        .locator(selector)
        .setTimeout(options.timeoutMs ?? deps.config.stepTimeoutMs);

      await locator.click({ clickCount: 3 });
      if (options.clear) {
        await locator.fill("");
        await locator.fill(options.text);
      } else {
        await currentPage.keyboard.type(options.text);
      }
      if (options.submit) {
        await currentPage.keyboard.press("Enter");
      }

      const evidence = await readTypeTextEvidence(currentPage, {
        selector,
        expectedText: options.text,
        matchMode: options.clear ? "exact" : "contains",
        beforeFocusSelector,
      });
      actionAttempt.activeElementMatched = evidence.activeElementMatched;
      actionAttempt.valueVerified = evidence.valueVerified;
      actionAttempt.focusChanged = evidence.focusChanged;
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: 0,
      requireObservedChange: false,
      verifications: [
        {
          kind: "inputValue",
          selector,
          expected: options.text,
          matchMode: options.clear ? "exact" : "contains",
        },
      ],
    },
  ).catch((error) => {
    const evidenceParts = [
      `selector=${selector}`,
      `strategy=${actionAttempt.strategy}`,
      actionAttempt.activeElementMatched != null
        ? `activeElementMatched=${actionAttempt.activeElementMatched}`
        : undefined,
      actionAttempt.valueVerified != null
        ? `valueVerified=${actionAttempt.valueVerified}`
        : undefined,
      actionAttempt.focusChanged != null
        ? `focusChanged=${actionAttempt.focusChanged}`
        : undefined,
    ].filter(Boolean);

    const message =
      error instanceof Error ? error.message : String(error);
    const evidenceMessage = `${message} | 输入证据：${evidenceParts.join(", ")}`;

    if (error instanceof BrowserToolError) {
      throw new BrowserToolError(error.code, evidenceMessage, error.details);
    }

    throw new Error(evidenceMessage);
  });

  return {
    ...(await deps.summarizePage(
      observation.pageSource === "current"
        ? pageId
        : deps.requirePageId(observation.finalPage),
      observation.finalPage,
    )),
    actionAttempt,
  };
}

export async function pressKeyWithRuntime(
  deps: BrowserRuntimeDeps,
  key: string,
  pageId?: string,
): Promise<ActionPageSummary> {
  const page = await deps.resolvePage(pageId);
  const resolvedPageId = deps.requirePageId(page);
  const beforeFocusSelector = await readActiveElementSelector(page);
  await page.keyboard.press(key as KeyInput);
  const evidence = await readKeyboardActionEvidence(page, beforeFocusSelector);
  return {
    ...(await deps.summarizePage(resolvedPageId, page)),
    actionAttempt: {
      kind: "press_key",
      key,
      strategy: "keyboard_press",
      fallbackUsed: false,
      submittedBy: key === "Enter" ? "keyboard_enter" : undefined,
      focusChanged: evidence.focusChanged,
    },
  };
}

export async function pressKeyAndWaitWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    key: string;
    pageId?: string;
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
  },
): Promise<PressKeyAndWaitResult> {
  const page = await deps.resolvePage(options.pageId);
  const shouldWaitForNavigation = options.waitForNavigation ?? false;
  const beforeFocusSelector = await readActiveElementSelector(page);
  const actionAttempt: ActionAttemptSummary = {
    kind: "press_key",
    key: options.key,
    strategy: "keyboard_press",
    fallbackUsed: false,
    submittedBy: options.key === "Enter" ? "keyboard_enter" : undefined,
  };
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

  const observation = await runActionWithVerification(
    deps,
    page,
    async (currentPage) => {
      await currentPage.keyboard.press(options.key as KeyInput);
      const evidence = await readKeyboardActionEvidence(
        currentPage,
        beforeFocusSelector,
      );
      actionAttempt.focusChanged = evidence.focusChanged;
    },
    {
      timeoutMs: options.timeoutMs,
      maxRetries: 0,
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
      requireObservedChange: true,
      requireStrongObservedChange: true,
      verifications,
    },
  );

  return {
    page: await deps.summarizePage(
      deps.requirePageId(observation.finalPage),
      observation.finalPage,
    ),
    key: options.key,
    actionAttempt,
    pageSource: observation.pageSource,
    changeType: determineActionChangeType(observation),
    successSignal: determineActionSuccessSignal(observation, {
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
      timeoutMs: options.timeoutMs,
    }),
    before: observation.before,
    after: observation.after,
    changed: observation.changed,
    observed: observation.observed,
    contentReady: observation.contentReady,
    contentReadySignal: observation.contentReadySignal,
    domObservation: observation.domObservation,
    note:
      observation.attempts > 1
        ? `已重试 ${observation.attempts} 次。`
        : observation.note,
  };
}

async function readActiveElementSelector(page: Page): Promise<string | undefined> {
  return evaluateWithDomHelpers(
    page,
    (helpers) => {
      const active = document.activeElement;
      if (!(active instanceof Element)) {
        return undefined;
      }

      return helpers.buildSelector(active, { preferClasses: true });
    },
    undefined,
  );
}

async function readKeyboardActionEvidence(
  page: Page,
  beforeFocusSelector?: string,
): Promise<{
  focusChanged: boolean;
}> {
  const afterFocusSelector = await readActiveElementSelector(page);
  return {
    focusChanged: beforeFocusSelector !== afterFocusSelector,
  };
}

async function readTypeTextEvidence(
  page: Page,
  options: {
    selector: string;
    expectedText: string;
    matchMode: WaitMatchMode;
    beforeFocusSelector?: string;
  },
): Promise<{
  activeElementMatched?: boolean;
  valueVerified?: boolean;
  focusChanged: boolean;
}> {
  return evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const target = document.querySelector(args.selector);
      const active = document.activeElement;
      const activeSelector =
        active instanceof Element
          ? helpers.buildSelector(active, { preferClasses: true })
          : undefined;
      const focusChanged = args.beforeFocusSelector !== activeSelector;

      if (!(target instanceof HTMLElement)) {
        return {
          focusChanged,
        };
      }

      const activeElementMatched = Boolean(
        active instanceof Element &&
          (active === target || target.contains(active)),
      );

      let actualValue = "";
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        actualValue = target.value;
      } else if (target.isContentEditable) {
        actualValue = target.innerText ?? target.textContent ?? "";
      } else {
        actualValue = target.textContent ?? "";
      }

      const normalize = (value: string) =>
        value.replace(/\s+/g, " ").trim();
      const normalizedActual = normalize(actualValue);
      const normalizedExpected = normalize(args.expectedText);
      const valueVerified =
        args.matchMode === "exact"
          ? normalizedActual === normalizedExpected
          : normalizedActual.includes(normalizedExpected);

      return {
        activeElementMatched,
        valueVerified,
        focusChanged,
      };
    },
    options,
  );
}
