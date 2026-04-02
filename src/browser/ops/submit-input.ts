import type { WaitUntilMode } from "../../config.js";
import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import { findSubmitTargetsWithInspection } from "../inspect/find-submit-targets.js";
import type {
  ClickAndWaitSuccessSignal,
  SubmitInputResult,
  SubmitWithPlanResult,
  WaitMatchMode,
} from "../core/types.js";
import {
  collectActionFailureReasons,
  determineActionChangeType,
  determineActionSuccessSignal,
  evaluateActionVerification,
  observeAction,
  type ActionVerificationRule,
} from "../flow/action-observer.js";

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

  const attempts: SubmitInputResult["attempts"] = [];
  let changed = false;

  const runAttempt = async (
    strategy: SubmitInputResult["attempts"][number]["strategy"],
    action: () => Promise<void>,
  ) => {
    const result = await observeAction(deps, page, action, {
      timeoutMs: Math.min(timeoutMs, 5000),
      waitForNavigation: true,
    });

    attempts.push({
      strategy,
      changed: result.changed,
      note: result.note,
    });

    page = result.finalPage;

    return result.changed;
  };

  changed = await runAttempt("enter", async () => {
    await locator.click();
    await page.keyboard.press("Enter");
  });

  if (!changed) {
    const requestSubmitResult = await page.$eval(options.selector, (element) => {
      const htmlElement = element as HTMLElement;
      const form = htmlElement.closest("form");
      if (!form) {
        return { ok: false, note: "未找到 form 容器。" };
      }

      if (typeof form.requestSubmit === "function") {
        return { ok: true };
      }

      return { ok: false, note: "当前 form 不支持 requestSubmit。" };
    });

    if (requestSubmitResult.ok) {
      changed = await runAttempt("form_request_submit", async () => {
        await page.$eval(options.selector, (element) => {
          const htmlElement = element as HTMLElement;
          const form = htmlElement.closest("form");
          if (form && typeof form.requestSubmit === "function") {
            form.requestSubmit();
          }
        });
      });
    } else {
      attempts.push({
        strategy: "form_request_submit",
        changed: false,
        note: requestSubmitResult.note,
      });
    }
  }

  if (!changed) {
    const submitResult = await page.$eval(options.selector, (element) => {
      const htmlElement = element as HTMLElement;
      const form = htmlElement.closest("form");
      if (!form) {
        return { ok: false, note: "未找到 form 容器。" };
      }

      return { ok: true };
    });

    if (submitResult.ok) {
      changed = await runAttempt("form_submit", async () => {
        await page.$eval(options.selector, (element) => {
          const htmlElement = element as HTMLElement;
          const form = htmlElement.closest("form");
          if (form) {
            form.submit();
          }
        });
      });
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
      changed = await runAttempt("nearby_click", async () => {
        await page.locator(nearbySelector).setTimeout(3000).click();
      });
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
    attempts,
  };
}

export async function submitWithPlanWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    selector: string;
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
  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;
  const inputLocator = page.locator(options.selector).setTimeout(timeoutMs);

  await inputLocator.wait();

  const submitTargets = await findSubmitTargetsWithInspection(
    createInspectionDepsFromRuntime(deps),
    {
      pageId: deps.requirePageId(page),
      selector: options.selector,
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
      const observation = await observeAction(
        deps,
        page,
        async () => {
          if (step.method === "enter") {
            const currentInput = page.locator(options.selector).setTimeout(timeoutMs);
            await currentInput.wait();
            await currentInput.click();
            await page.keyboard.press("Enter");
            return;
          }

          if (!step.selector) {
            throw new Error("点击方案缺少 selector。");
          }

          await page.locator(step.selector).setTimeout(timeoutMs).click();
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
        inputSelector: options.selector,
        preferredSubmitMethod: submitTargets.preferredSubmitMethod,
        submitPlan,
        chosenMethod: step.method,
        chosenSelector: step.selector,
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
): BrowserInspectionDeps {
  return {
    defaultTimeoutMs: deps.config.defaultTimeoutMs,
    resolvePage: (pageId) => deps.resolvePage(pageId),
    requirePageId: (page) => deps.requirePageId(page),
    summarizePage: (pageId, page) => deps.summarizePage(pageId, page),
    resolveSelectorForRef: (pageId, ref) =>
      deps.resolveSelectorForRef(pageId, ref),
  };
}
