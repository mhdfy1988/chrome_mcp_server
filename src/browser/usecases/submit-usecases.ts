import type { WaitUntilMode } from "../../config.js";
import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";
import type { BrowserInspectionUsecaseDeps } from "./inspection-usecases.js";
import { findSubmitTargetsWithRuntime } from "./inspection-usecases.js";
import type {
  ActionAttemptSummary,
} from "../execution/types.js";
import type { ClickAndWaitSuccessSignal, WaitMatchMode } from "../observation/types.js";
import type { SubmitInputResult, SubmitWithPlanResult } from "./types.js";
import { clickResolvedTarget } from "../execution/safe-click.js";
import { resolveActionTargetWithPreflight } from "../execution/target-preflight.js";
import { resolvePlanActionTarget } from "./plan-target-resolution.js";
import {
  collectActionFailureReasons,
  determineActionChangeType,
  determineActionSuccessSignal,
  evaluateActionVerification,
  type ActionVerificationRule,
} from "../judgement/action-judgement.js";
import { observeAction } from "../observation/action-observation.js";

export async function submitInputWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector: string;
    pageId?: string;
    timeoutMs?: number;
  },
): Promise<SubmitInputResult> {
  let page = await deps.resolvePage(options.pageId);
  const timeoutMs = options.timeoutMs ?? deps.config.defaultTimeoutMs;
  const locator = page.locator(options.selector).setTimeout(timeoutMs);

  await locator.wait();

  const before = {
    title: await page.title(),
    url: page.url(),
  };
  const inputFormContext = await readSubmitFormContext(page, options.selector);

  const attempts: SubmitInputResult["attempts"] = [];
  let changed = false;

  const runAttempt = async (
    strategy: SubmitInputResult["attempts"][number]["strategy"],
    action: () => Promise<ActionAttemptSummary | undefined>,
  ) => {
    let actionAttempt: ActionAttemptSummary | undefined;
    const result = await observeAction(
      deps,
      page,
      async () => {
        actionAttempt = await action();
      },
      {
        timeoutMs: Math.min(timeoutMs, 5000),
        waitForNavigation: true,
      },
    );

    attempts.push({
      strategy,
      changed: result.changed,
      actionAttempt,
      note: result.note,
    });

    page = result.finalPage;

    return {
      changed: result.changed,
      actionAttempt,
    };
  };

  const enterAttempt = await runAttempt("enter", async () => {
    await locator.click();
    await page.keyboard.press("Enter");
    return {
      kind: "press_key",
      key: "Enter",
      strategy: "keyboard_press",
      fallbackUsed: false,
      submittedBy: "keyboard_enter",
      formSelector: inputFormContext.formSelector,
      submitTargetSelector: options.selector,
    };
  });
  changed = enterAttempt.changed;

  if (!changed) {
    const requestSubmitResult = inputFormContext.exists
      ? inputFormContext.supportsRequestSubmit
        ? { ok: true, formSelector: inputFormContext.formSelector }
        : {
            ok: false,
            formSelector: inputFormContext.formSelector,
            note: "当前 form 不支持 requestSubmit。",
          }
      : {
          ok: false,
          formSelector: undefined,
          note: "未找到 form 容器。",
        };

    if (requestSubmitResult.ok) {
      const requestSubmitAttempt = await runAttempt("form_request_submit", async () => {
        await page.$eval(options.selector, (element) => {
          const htmlElement = element as HTMLElement;
          const form = htmlElement.closest("form");
          if (form && typeof form.requestSubmit === "function") {
            form.requestSubmit();
          }
        });
        return {
          kind: "submit",
          selector: options.selector,
          strategy: "form_request_submit",
          fallbackUsed: false,
          submitted: true,
          submittedBy: "form_request_submit",
          formSelector: requestSubmitResult.formSelector,
          submitTargetSelector: options.selector,
        };
      });
      changed = requestSubmitAttempt.changed;
    } else {
      attempts.push({
        strategy: "form_request_submit",
        changed: false,
        note: requestSubmitResult.note,
      });
    }
  }

  if (!changed) {
    const submitResult = inputFormContext.exists
      ? { ok: true, formSelector: inputFormContext.formSelector }
      : {
          ok: false,
          formSelector: undefined,
          note: "未找到 form 容器。",
        };

    if (submitResult.ok) {
      const formSubmitAttempt = await runAttempt("form_submit", async () => {
        await page.$eval(options.selector, (element) => {
          const htmlElement = element as HTMLElement;
          const form = htmlElement.closest("form");
          if (form) {
            form.submit();
          }
        });
        return {
          kind: "submit",
          selector: options.selector,
          strategy: "form_submit",
          fallbackUsed: false,
          submitted: true,
          submittedBy: "form_submit",
          formSelector: submitResult.formSelector,
          submitTargetSelector: options.selector,
        };
      });
      changed = formSubmitAttempt.changed;
    } else {
      attempts.push({
        strategy: "form_submit",
        changed: false,
        note: submitResult.note,
      });
    }
  }

  if (!changed) {
    const nearbySelector = await page.$eval(options.selector, (element) => {
      const normalizeWhitespace = (value: unknown) =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim();

      const escapeSelector = (value: string) => {
        if (
          typeof (
            window as Window & { CSS?: { escape?: (value: string) => string } }
          ).CSS?.escape === "function"
        ) {
          return (
            window as Window & { CSS: { escape: (value: string) => string } }
          ).CSS.escape(value);
        }

        return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
      };

      const buildSelector = (target: Element) => {
        const htmlTarget = target as HTMLElement;
        const id = normalizeWhitespace(htmlTarget.id);
        if (id) {
          return `#${escapeSelector(id)}`;
        }

        const tag = target.tagName.toLowerCase();
        const classNames = Array.from(htmlTarget.classList)
          .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
          .slice(0, 3);
        if (classNames.length > 0) {
          return `${tag}.${classNames
            .map((className) => escapeSelector(className))
            .join(".")}`;
        }

        return undefined;
      };

      const containsSubmitSignal = (target: Element) => {
        const htmlTarget = target as HTMLElement;
        const haystack = [
          normalizeWhitespace(htmlTarget.innerText ?? htmlTarget.textContent),
          normalizeWhitespace(target.getAttribute("aria-label")),
          normalizeWhitespace(target.getAttribute("title")),
          normalizeWhitespace(htmlTarget.className),
          normalizeWhitespace(target.getAttribute("role")),
        ]
          .join(" ")
          .toLocaleLowerCase();

        return ["search", "submit", "query", "搜索", "查找", "检索"].some(
          (keyword) => haystack.includes(keyword),
        );
      };

      const htmlElement = element as HTMLElement;
      const scope =
        htmlElement.closest("form") ??
        htmlElement.parentElement ??
        htmlElement.closest("header, nav, [role='navigation']") ??
        document.body;

      const clickableCandidates = Array.from(scope.querySelectorAll("*"))
        .filter((candidate) => candidate !== element)
        .filter((candidate) => {
          if (!(candidate instanceof HTMLElement)) {
            return false;
          }

          const rect = candidate.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return false;
          }

          const style = getComputedStyle(candidate);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return false;
          }

          const tag = candidate.tagName.toLowerCase();
          const role = normalizeWhitespace(candidate.getAttribute("role"));
          const type =
            candidate instanceof HTMLInputElement ||
            candidate instanceof HTMLButtonElement
              ? normalizeWhitespace(candidate.type).toLowerCase()
              : "";

          return (
            tag === "button" ||
            tag === "a" ||
            role === "button" ||
            type === "submit" ||
            type === "button" ||
            style.cursor === "pointer" ||
            containsSubmitSignal(candidate)
          );
        }) as Element[];

      const preferred =
        clickableCandidates.find((candidate) => containsSubmitSignal(candidate)) ??
        clickableCandidates[0];

      return preferred ? buildSelector(preferred) : undefined;
    });

    if (nearbySelector) {
      const nearbyClickAttempt = await runAttempt("nearby_click", async () => {
        const { selector, preflight } = await resolveActionTargetWithPreflight(deps, {
          pageId: deps.requirePageId(page),
          selector: nearbySelector,
        });
        const targetFormContext = await readSubmitFormContext(page, selector);
        const clickResult = await clickResolvedTarget(page, {
          selector,
          timeoutMs: 3000,
          preflight,
        });
        clickResult.actionAttempt.formSelector =
          targetFormContext.formSelector ?? inputFormContext.formSelector;
        clickResult.actionAttempt.submittedBy = "nearby_click";
        clickResult.actionAttempt.submitTargetSelector = selector;
        return clickResult.actionAttempt;
      });
      changed = nearbyClickAttempt.changed;
    } else {
      attempts.push({
        strategy: "nearby_click",
        changed: false,
        note: "没有找到邻近提交控件。",
      });
    }
  }

  return {
    page: await deps.summarizePage(deps.requirePageId(page), page),
    selector: options.selector,
    before,
    changed,
    strategy: attempts.find((attempt) => attempt.changed)?.strategy,
    actionAttempt: attempts.find((attempt) => attempt.changed)?.actionAttempt,
    attempts,
  };
}

export async function submitWithPlanWithRuntime(
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
    maxPlanSteps?: number;
  },
): Promise<SubmitWithPlanResult> {
  let page = await deps.resolvePage(options.pageId);
  const pageId = deps.requirePageId(page);
  const selector = options.ref
    ? deps.resolveSelectorForRef(pageId, options.ref)
    : options.selector;

  if (!selector) {
    throw new Error("selector 和 ref 至少要提供一个。");
  }

  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;
  const inputLocator = page.locator(selector).setTimeout(timeoutMs);

  await inputLocator.wait();
  const inputFormContext = await readSubmitFormContext(page, selector);

  const submitTargets = await findSubmitTargetsWithRuntime(
    createInspectionDepsFromRuntime(deps),
    {
      pageId,
      selector,
      maxResults: Math.max(options.maxPlanSteps ?? 5, 5),
    },
  );
  const submitPlan = submitTargets.submitPlan.slice(
    0,
    options.maxPlanSteps ?? submitTargets.submitPlan.length,
  );

  if (submitPlan.length === 0) {
    throw new Error("当前输入框未生成可执行的提交计划。");
  }

  const verifications = buildSubmitPlanVerifications(options);
  const shouldWaitForNavigation = options.waitForNavigation ?? false;
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
  const attempts: SubmitWithPlanResult["attempts"] = [];

  for (const step of submitPlan) {
    try {
      let actionAttempt: ActionAttemptSummary | undefined;
      const observation = await observeAction(
        deps,
        page,
        async () => {
          if (step.method === "enter") {
            const currentInput = page.locator(selector).setTimeout(timeoutMs);
            await currentInput.wait();
            await currentInput.click();
            await page.keyboard.press("Enter");
            actionAttempt = {
              kind: "press_key",
              key: "Enter",
              strategy: "keyboard_press",
              fallbackUsed: false,
              submittedBy: "keyboard_enter",
              formSelector: inputFormContext.formSelector,
              submitTargetSelector: selector,
            };
            return;
          }

          if (!step.selector) {
            throw new Error("点击方案缺少 selector。");
          }

          const target = await resolvePlanActionTarget(deps, page, step);
          const targetFormContext = await readSubmitFormContext(
            page,
            target.selector,
          );
          const clickResult = await clickResolvedTarget(page, {
            selector: target.selector,
            timeoutMs,
            preflight: target.preflight,
          });
          clickResult.actionAttempt.formSelector =
            targetFormContext.formSelector ?? inputFormContext.formSelector;
          clickResult.actionAttempt.submittedBy = "plan_click";
          clickResult.actionAttempt.submitTargetSelector = target.selector;
          actionAttempt = clickResult.actionAttempt;
        },
        actionWaitOptions,
      );

      const verification = await evaluateActionVerification(observation, {
        verifications,
        requireObservedChange: true,
        requireStrongObservedChange: true,
      });
      const successSignal = determineActionSuccessSignal(
        observation,
        actionWaitOptions,
      );

      attempts.push({
        method: step.method,
        confidence: step.confidence,
        reasons: step.reasons,
        selector: step.selector,
        changed: observation.changed,
        actionAttempt,
        pageSource: observation.pageSource,
        changeType: determineActionChangeType(observation),
        successSignal,
        note: verification.passed
          ? observation.note
          : (await collectActionFailureReasons(observation, verification.reports, {
              requireObservedChange: true,
              requireStrongObservedChange: true,
              contentReadySelector: options.contentReadySelector,
              contentReadyText: options.contentReadyText,
            })).join(" | "),
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
        inputSelector: selector,
        preferredSubmitMethod: submitTargets.preferredSubmitMethod,
        submitPlan,
        chosenMethod: step.method,
        chosenSelector: step.target?.selector ?? step.selector,
        actionAttempt,
        before: observation.before,
        after: observation.after,
        changed: observation.changed,
        pageSource: observation.pageSource,
        changeType: determineActionChangeType(observation),
        successSignal,
        observed: observation.observed,
        contentReady: observation.contentReady,
        contentReadySignal: observation.contentReadySignal,
        domObservation: observation.domObservation,
        attempts,
        note:
          attempts.length > 1
            ? `已按提交计划尝试 ${attempts.length} 步。`
            : observation.note,
      };
    } catch (error) {
      attempts.push({
        method: step.method,
        confidence: step.confidence,
        reasons: step.reasons,
        selector: step.selector,
        changed: false,
        successSignal: "none" as ClickAndWaitSuccessSignal,
        note: error instanceof Error ? error.message : String(error),
      });
      page = await deps.resolvePage(deps.getCurrentPageId());
    }
  }

  throw new Error(
    `按提交计划尝试后仍未成功：${attempts
      .map((attempt) => {
        const target = attempt.selector ? `(${attempt.selector})` : "";
        const note = attempt.note ? ` ${attempt.note}` : "";
        return `${attempt.method}${target}${note}`;
      })
      .join(" | ")}`,
  );
}

function buildSubmitPlanVerifications(options: {
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

async function readSubmitFormContext(
  page: Awaited<ReturnType<BrowserRuntimeDeps["resolvePage"]>>,
  selector: string,
): Promise<{
  exists: boolean;
  formSelector?: string;
  supportsRequestSubmit: boolean;
}> {
  return page.$eval(selector, (element) => {
    const normalizeWhitespace = (value: unknown) =>
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

    const escapeSelector = (value: string) => {
      if (
        typeof (
          window as Window & { CSS?: { escape?: (value: string) => string } }
        ).CSS?.escape === "function"
      ) {
        return (
          window as Window & { CSS: { escape: (value: string) => string } }
        ).CSS.escape(value);
      }

      return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    };

    const buildSelector = (target: Element) => {
      const htmlTarget = target as HTMLElement;
      const id = normalizeWhitespace(htmlTarget.id);
      if (id) {
        return `#${escapeSelector(id)}`;
      }

      const tag = target.tagName.toLowerCase();
      const classNames = Array.from(htmlTarget.classList)
        .filter((className) => /^[A-Za-z0-9_-]+$/.test(className))
        .slice(0, 3);

      if (classNames.length > 0) {
        return `${tag}.${classNames
          .map((className) => escapeSelector(className))
          .join(".")}`;
      }

      const name = normalizeWhitespace(target.getAttribute("name"));
      if (name) {
        return `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
      }

      return tag;
    };

    const htmlElement = element as HTMLElement;
    const form = htmlElement.closest("form");
    if (!form) {
      return {
        exists: false,
        supportsRequestSubmit: false,
      };
    }

    return {
      exists: true,
      formSelector: buildSelector(form),
      supportsRequestSubmit: typeof form.requestSubmit === "function",
    };
  });
}
