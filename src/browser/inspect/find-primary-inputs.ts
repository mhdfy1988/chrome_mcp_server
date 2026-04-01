import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { FindPrimaryInputsResult } from "../core/types.js";

export async function findPrimaryInputsWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    maxResults: number;
  },
): Promise<FindPrimaryInputsResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);

  const result = await evaluateWithDomHelpers(
    page,
    (helpers, { maxResults }) => {
      const searchWords = [
        "search",
        "query",
        "keyword",
      "find",
      "搜索",
      "检索",
      "查找",
    ];
    const navWords = ["nav", "navbar", "header", "top", "menu", "导航"];

    const scoreText = (value: string | undefined, words: string[]) => {
      if (!value) {
        return 0;
      }

      const normalizedValue = value.toLocaleLowerCase();
      return words.some((word) => normalizedValue.includes(word)) ? 1 : 0;
    };

      const query =
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="color"]):not([type="date"]):not([type="datetime-local"]):not([type="month"]):not([type="time"]):not([type="week"]), textarea, [contenteditable="true"]';

      const allCandidates = Array.from(document.querySelectorAll(query)).filter(
        (element) => {
          if (!helpers.isVisible(element)) {
            return false;
          }

          if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          ) {
            return !element.disabled && !element.readOnly;
          }

          return true;
        },
      );

      const totalVisibleInputs = allCandidates.length;

      const candidates = allCandidates
        .map((element, index) => {
          const htmlElement = element as HTMLElement;
          const rect = htmlElement.getBoundingClientRect();
          const type =
            element instanceof HTMLInputElement
              ? helpers.normalizeWhitespace(element.type).toLowerCase()
              : undefined;
          const role =
            helpers.normalizeWhitespace(element.getAttribute("role")) ||
            helpers.inferImplicitRole(element);
          const accessibleName = helpers.findAccessibleName(element, {
            includeTextContent: false,
          });
          const label = helpers.findAssociatedLabel(htmlElement);
          const placeholder = helpers.normalizeWhitespace(
            element.getAttribute("placeholder"),
          );
          const title = helpers.normalizeWhitespace(element.getAttribute("title"));
          const name = helpers.normalizeWhitespace(element.getAttribute("name"));
          const className = helpers.normalizeWhitespace(htmlElement.className);
          const form = htmlElement.closest("form");
          const formId = helpers.normalizeWhitespace(form?.id);
          const formClass = helpers.normalizeWhitespace(
            (form as HTMLElement | null)?.className,
          );
          const formAction = helpers.normalizeWhitespace(
            form?.getAttribute("action"),
          );
          const formSelector = form
            ? helpers.buildSelector(form, { preferClasses: true })
            : undefined;
          const ancestorSignals = Array.from(
            new Set(
              Array.from({ length: 4 })
                .reduce<HTMLElement[]>((ancestors, _, depth) => {
                  const current =
                    depth === 0
                      ? htmlElement.parentElement
                      : ancestors[depth - 1]?.parentElement ?? null;
                  if (current) {
                    ancestors.push(current);
                  }
                  return ancestors;
                }, [])
                .flatMap((ancestor) => [
                  helpers.normalizeWhitespace(ancestor.id),
                  helpers.normalizeWhitespace(ancestor.className),
                  helpers.normalizeWhitespace(ancestor.getAttribute("role")),
                  ancestor.tagName.toLowerCase(),
                ])
                .filter(Boolean),
            ),
          );

          const scoreBreakdown: Array<{ reason: string; score: number }> = [];
          const addScore = (reason: string, score: number) => {
            if (score <= 0) {
              return;
            }
            scoreBreakdown.push({ reason, score });
          };

          if (type === "search") {
            addScore("type=search", 14);
          } else if (
            !type ||
            ["text", "email", "tel", "url", "password"].includes(type)
          ) {
            addScore("text-like-input", 8);
          } else if (element instanceof HTMLTextAreaElement) {
            addScore("textarea", 4);
          } else if (
            element instanceof HTMLElement &&
            element.contentEditable === "true"
          ) {
            addScore("contenteditable", 3);
          }

          if (role === "searchbox") {
            addScore("role=searchbox", 12);
          } else if (role === "textbox") {
            addScore("role=textbox", 4);
          }

          if (form) {
            addScore("inside-form", 8);
          }

          if (scoreText(accessibleName, searchWords)) {
            addScore("accessible-name-search-signal", 12);
          }
          if (scoreText(label, searchWords)) {
            addScore("label-search-signal", 10);
          }
          if (scoreText(placeholder, searchWords)) {
            addScore("placeholder-search-signal", 9);
          }
          if (scoreText(title, searchWords)) {
            addScore("title-search-signal", 8);
          }
          if (scoreText(name, searchWords)) {
            addScore("name-search-signal", 7);
          }
          if (scoreText(className, searchWords)) {
            addScore("class-search-signal", 11);
          }
          if (
            scoreText(formId, searchWords) ||
            scoreText(formClass, searchWords)
          ) {
            addScore("form-search-signal", 11);
          }
          if (scoreText(formAction, searchWords)) {
            addScore("form-action-search-signal", 9);
          }

          if (
            scoreText(className, navWords) ||
            ancestorSignals.some((signal) => scoreText(signal, navWords))
          ) {
            addScore("navigation-signal", 6);
          }

          if (htmlElement.closest("header, nav, [role='navigation']")) {
            addScore("inside-header-or-nav", 7);
          }

          if (rect.top <= 220) {
            addScore("near-top", 5);
          } else if (rect.top <= 420) {
            addScore("upper-page", 2);
          }

          if (rect.width >= 280) {
            addScore("wide-input", 5);
          } else if (rect.width >= 160) {
            addScore("medium-width-input", 2);
          }

          if (totalVisibleInputs === 1) {
            addScore("only-visible-input", 10);
          } else if (totalVisibleInputs <= 3) {
            addScore("few-visible-inputs", 4);
          }

          const score = scoreBreakdown.reduce(
            (sum, item) => sum + item.score,
            0,
          );

          return {
            index: index + 1,
            tag: element.tagName.toLowerCase(),
            type: type || undefined,
            role: role || undefined,
            selector: helpers.buildSelector(element, { preferClasses: true }),
            accessibleName: accessibleName || undefined,
            label: label || undefined,
            placeholder: placeholder || undefined,
            title: title || undefined,
            name: name || undefined,
            className: className || undefined,
            inForm: Boolean(form),
            formSelector,
            formAction: formAction || undefined,
            score,
            scoreBreakdown,
            top: rect.top,
          };
        })
        .sort(
          (left, right) => right.score - left.score || left.top - right.top,
        )
        .slice(0, maxResults)
        .map(({ top: _top, ...candidate }) => candidate);

      return {
        total: allCandidates.length,
        candidates,
      };
    },
    { maxResults: options.maxResults },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    total: result.total,
    candidates: result.candidates,
  };
}

