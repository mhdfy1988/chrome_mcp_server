import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import type { FindSubmitTargetsResult } from "../core/types.js";

export async function findSubmitTargetsWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    selector: string;
    maxResults: number;
  },
): Promise<FindSubmitTargetsResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);

  const result = await evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const input = document.querySelector(args.selector);
      if (!(input instanceof HTMLElement) || !helpers.isVisible(input)) {
        return {
          preferredSubmitMethod: "either" as const,
          submitMethodReasons: [],
          submitPlan: [],
          total: 0,
          candidates: [],
        };
      }

      const normalizeWhitespace = (value: unknown) =>
        helpers.normalizeWhitespace(value).toLocaleLowerCase();

      const collectHaystack = (element: Element) => {
        const htmlElement = element as HTMLElement;
        return [
          helpers.normalizeWhitespace(htmlElement.innerText ?? htmlElement.textContent),
          helpers.normalizeWhitespace(element.getAttribute("aria-label")),
          helpers.normalizeWhitespace(element.getAttribute("title")),
          helpers.normalizeWhitespace(element.getAttribute("placeholder")),
          helpers.normalizeWhitespace(element.getAttribute("role")),
          helpers.normalizeWhitespace(element.getAttribute("name")),
          helpers.normalizeWhitespace(htmlElement.className),
          helpers.normalizeWhitespace(htmlElement.id),
          helpers.normalizeWhitespace(element.getAttribute("data-testid")),
          helpers.normalizeWhitespace(element.getAttribute("data-test")),
        ]
          .join(" ")
          .toLocaleLowerCase();
      };

      const collectIntentHaystack = (element: Element) => {
        const htmlElement = element as HTMLElement;
        return [
          helpers.normalizeWhitespace(htmlElement.innerText ?? htmlElement.textContent),
          helpers.normalizeWhitespace(element.getAttribute("aria-label")),
          helpers.normalizeWhitespace(element.getAttribute("title")),
          helpers.normalizeWhitespace(element.getAttribute("placeholder")),
          helpers.normalizeWhitespace(element.getAttribute("name")),
          helpers.normalizeWhitespace(element.getAttribute("data-testid")),
          helpers.normalizeWhitespace(element.getAttribute("data-test")),
        ]
          .join(" ")
          .toLocaleLowerCase();
      };

      const hasAnyKeyword = (haystack: string, keywords: string[]) =>
        keywords.some((keyword) => haystack.includes(keyword));

      const classifyIntent = (element: Element) => {
        const haystack = collectIntentHaystack(element);
        const reasons: string[] = [];

        if (
          hasAnyKeyword(haystack, [
            "clear",
            "reset",
            "close",
            "cancel",
            "清除",
            "重置",
            "关闭",
            "取消",
          ])
        ) {
          reasons.push("clear-signal");
          return {
            intent: "clear" as const,
            reasons,
          };
        }

        if (
          hasAnyKeyword(haystack, [
            "visual",
            "voice",
            "camera",
            "scan",
            "image search",
            "图片",
            "图像",
            "相机",
            "扫码",
            "语音",
          ])
        ) {
          reasons.push("auxiliary-signal");
          return {
            intent: "auxiliary" as const,
            reasons,
          };
        }

        if (
          hasAnyKeyword(haystack, [
          "search",
          "submit",
          "query",
          "go",
          "apply",
          "filter",
          "搜索",
          "查找",
          "检索",
          "提交",
          "筛选",
          ])
        ) {
          reasons.push("submit-signal");
          return {
            intent: "submit" as const,
            reasons,
          };
        }

        return {
          intent: "auxiliary" as const,
          reasons,
        };
      };

      const inputRect = input.getBoundingClientRect();
      const scope =
        input.closest("form") ??
        input.closest("[role='search'], [role='navigation'], header, nav") ??
        input.parentElement ??
        document.body;

      const inputTag = input.tagName.toLowerCase();
      const inputRole =
        normalizeWhitespace(input.getAttribute("role")) ||
        helpers.normalizeWhitespace(helpers.inferImplicitRole(input));
      const inputType =
        input instanceof HTMLInputElement
          ? normalizeWhitespace(input.type)
          : "";
      const inputHaystack = collectHaystack(input);
      const enterReasons: string[] = [];
      const clickReasons: string[] = [];
      let enterScore = 0;
      let clickScore = 0;

      const addEnterReason = (reason: string, score: number) => {
        enterReasons.push(reason);
        enterScore += score;
      };

      const addClickReason = (reason: string, score: number) => {
        clickReasons.push(reason);
        clickScore += score;
      };

      if (inputType === "search") {
        addEnterReason("type=search", 4);
      }
      if (inputRole === "searchbox") {
        addEnterReason("role=searchbox", 4);
      }
      if (input.closest("form")) {
        addEnterReason("inside-form", 2);
      }
      if (
        hasAnyKeyword(inputHaystack, [
          "search",
          "query",
          "keyword",
          "find",
          "搜索",
          "查找",
          "检索",
        ])
      ) {
        addEnterReason("search-signal", 3);
      }
      if (input.closest("header, nav, [role='search'], [role='navigation']")) {
        addEnterReason("search-region", 2);
      }
      if (inputTag === "textarea" || (input as HTMLElement).isContentEditable) {
        addClickReason("multiline-input", 6);
      }

      type CandidateSummary = FindSubmitTargetsResult["candidates"][number];
      type SubmitPlanStep = FindSubmitTargetsResult["submitPlan"][number];
      type CandidateAnalysis = {
        summary: CandidateSummary;
        clickEligible: boolean;
      };

      const toConfidence = (score: number, scale: number) => {
        if (score <= 0) {
          return 0;
        }

        const normalized = Math.max(0.05, Math.min(0.99, score / scale));
        return Math.round(normalized * 100) / 100;
      };

      const candidateAnalyses = Array.from(scope.querySelectorAll("*"))
        .filter((candidate) => candidate !== input)
        .filter((candidate) => candidate instanceof HTMLElement)
        .filter((candidate) => helpers.isVisible(candidate))
        .map((candidate) => {
          const htmlCandidate = candidate as HTMLElement;
          const rect = htmlCandidate.getBoundingClientRect();
          const explicitRole = normalizeWhitespace(candidate.getAttribute("role"));
          const implicitRole = helpers.inferImplicitRole(candidate) ?? "";
          const type =
            candidate instanceof HTMLInputElement ||
            candidate instanceof HTMLButtonElement
              ? normalizeWhitespace(candidate.type)
              : "";
          const style = window.getComputedStyle(htmlCandidate);
          const hasButtonSemantics =
            candidate.tagName.toLowerCase() === "button" ||
            candidate.tagName.toLowerCase() === "a" ||
            explicitRole === "button" ||
            implicitRole === "button" ||
            type === "submit" ||
            type === "button" ||
            type === "image";
          const hasClickSignal =
            candidate.hasAttribute("onclick") ||
            typeof htmlCandidate.onclick === "function" ||
            style.cursor === "pointer" ||
            htmlCandidate.tabIndex >= 0 ||
            htmlCandidate.querySelector("svg") !== null;
          const intent = classifyIntent(candidate);

          if (!hasButtonSemantics && !hasClickSignal && intent.intent !== "submit") {
            return null;
          }

          const horizontalDistance = Math.abs(rect.left - inputRect.right);
          const verticalDistance = Math.abs(rect.top - inputRect.top);
          const overlapY =
            Math.min(rect.bottom, inputRect.bottom) -
            Math.max(rect.top, inputRect.top);

          const scoreBreakdown: Array<{ reason: string; score: number }> = [];
          const addScore = (reason: string, score: number) => {
            if (score === 0) {
              return;
            }
            scoreBreakdown.push({ reason, score });
          };

          if (intent.intent === "submit") {
            addScore("intent=submit", 18);
          }
          if (intent.intent === "clear") {
            addScore("intent=clear-penalty", -20);
          }
          if (intent.intent === "auxiliary") {
            addScore("intent=auxiliary-penalty", -8);
          }
          if (candidate.tagName.toLowerCase() === "button" || type === "submit") {
            addScore("native-button", 10);
          }
          if (explicitRole === "button" || implicitRole === "button") {
            addScore("button-role", 8);
          }
          if (candidate.closest("form") === input.closest("form")) {
            addScore("same-form", 8);
          }
          if (style.cursor === "pointer") {
            addScore("cursor-pointer", 4);
          }
          if (candidate.hasAttribute("onclick") || typeof htmlCandidate.onclick === "function") {
            addScore("click-handler", 5);
          }
          if (htmlCandidate.tabIndex >= 0) {
            addScore("tabbable", 3);
          }
          if (htmlCandidate.querySelector("svg")) {
            addScore("contains-svg-icon", 4);
          }
          if (rect.left >= inputRect.left && rect.left <= inputRect.right + 260) {
            addScore("near-input-right-side", 6);
          }
          if (verticalDistance <= 120 || overlapY > 0) {
            addScore("aligned-vertically", 5);
          }
          if (horizontalDistance <= 260) {
            addScore("close-horizontally", 4);
          }

          const summary = helpers.summarizeInteractiveElement(
            candidate,
            1,
          );

          const candidateSummary: CandidateSummary = {
            tag: summary.tag,
            role: summary.role,
            type: summary.type,
            intent: intent.intent,
            selector: summary.selector,
            text: summary.text,
            accessibleName: summary.accessibleName,
            title: summary.title,
            className: summary.className,
            score: scoreBreakdown.reduce((sum, item) => sum + item.score, 0),
            intentReasons: intent.reasons,
            scoreBreakdown,
          };
          return {
            summary: candidateSummary,
            clickEligible: hasButtonSemantics,
          };
        })
        .filter((candidate): candidate is CandidateAnalysis => candidate !== null)
        .sort((left, right) => right.summary.score - left.summary.score)
        .slice(0, args.maxResults);

      const candidates = candidateAnalyses.map((candidate) => candidate.summary);

      const topClickCandidate =
        candidateAnalyses.find(
          (candidate) =>
            candidate.clickEligible && candidate.summary.intent === "submit",
        ) ?? null;

      if (topClickCandidate) {
        addClickReason("explicit-submit-candidate", 4);

        if (
          topClickCandidate.summary.tag === "button" ||
          topClickCandidate.summary.type === "submit" ||
          topClickCandidate.summary.type === "button" ||
          topClickCandidate.summary.type === "image"
        ) {
          addClickReason("native-submit-control", 4);
        }

        if (topClickCandidate.summary.role === "button") {
          addClickReason("button-role", 2);
        }

        const topCandidateHaystack = [
          topClickCandidate.summary.text,
          topClickCandidate.summary.accessibleName,
          topClickCandidate.summary.title,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();

        if (
          hasAnyKeyword(topCandidateHaystack, [
            "search",
            "submit",
            "query",
            "go",
            "apply",
            "filter",
            "搜索",
            "查找",
            "检索",
            "提交",
            "筛选",
          ])
        ) {
          addClickReason("explicit-submit-label", 4);
        }

        if (topClickCandidate.summary.score >= 45) {
          addClickReason("high-confidence-candidate", 4);
        }
      }

      const submitPlan: SubmitPlanStep[] = [];
      if (enterScore > 0) {
        submitPlan.push({
          method: "enter",
          confidence: toConfidence(enterScore, 16),
          reasons: enterReasons,
        });
      }

      if (topClickCandidate && clickScore > 0) {
        submitPlan.push({
          method: "click",
          confidence: toConfidence(clickScore, 18),
          reasons: clickReasons,
          selector: topClickCandidate.summary.selector,
          tag: topClickCandidate.summary.tag,
          role: topClickCandidate.summary.role,
          type: topClickCandidate.summary.type,
          intent: topClickCandidate.summary.intent,
          text: topClickCandidate.summary.text,
          accessibleName: topClickCandidate.summary.accessibleName,
        });
      }

      submitPlan.sort((left, right) => right.confidence - left.confidence);

      const preferredSubmitMethod =
        submitPlan.length === 0
          ? "either"
          : submitPlan.length === 1
            ? submitPlan[0]!.method
            : submitPlan[0]!.confidence >= submitPlan[1]!.confidence + 0.08
              ? submitPlan[0]!.method
              : "either";

      const submitMethodReasons = submitPlan.flatMap((step) =>
        step.reasons.map((reason) => `${step.method}:${reason}`),
      );

      return {
        preferredSubmitMethod,
        submitMethodReasons,
        submitPlan,
        total: candidates.length,
        candidates,
      };
    },
    {
      selector: options.selector,
      maxResults: options.maxResults,
    },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    inputSelector: options.selector,
    preferredSubmitMethod:
      (result.preferredSubmitMethod ?? "either") as FindSubmitTargetsResult["preferredSubmitMethod"],
    submitMethodReasons: result.submitMethodReasons ?? [],
    submitPlan: result.submitPlan ?? [],
    total: result.total,
    candidates: result.candidates,
  };
}
