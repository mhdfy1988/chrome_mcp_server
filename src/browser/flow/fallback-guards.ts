import type { Page } from "puppeteer-core";
import { pageSnapshotWithInspection } from "../inspect/page-snapshot.js";
import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import type { RawSnapshotElementSummary } from "../core/types.js";

const NON_TEXT_INPUT_TYPES = new Set([
  "hidden",
  "checkbox",
  "radio",
  "file",
  "color",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
  "range",
]);

export async function assertFindPrimaryInputsAllowed(
  deps: BrowserInspectionDeps,
  pageId?: string,
): Promise<void> {
  const snapshot = await pageSnapshotWithInspection(deps, {
    pageId,
    maxTextLength: 300,
    maxElements: 80,
  });

  const explicitInputs = snapshot.interactiveElements.filter(isTextLikeInput);

  if (explicitInputs.length === 1) {
    throw new Error(
      `当前页面已存在明确输入框 ${explicitInputs[0].selector}，请优先使用 page_snapshot / find_elements 后直接 click + type_text。`,
    );
  }
}

export async function assertSubmitInputAllowed(
  deps: BrowserRuntimeDeps,
  options: {
    selector: string;
    pageId?: string;
  },
): Promise<void> {
  const page = await deps.resolvePage(options.pageId);
  const explicitSubmitTarget = await findExplicitSubmitTarget(
    page,
    options.selector,
  );

  if (explicitSubmitTarget) {
    throw new Error(
      `当前页面已存在明确提交控件 ${explicitSubmitTarget}，请优先使用 click 或 click_and_wait。`,
    );
  }
}

function isTextLikeInput(element: RawSnapshotElementSummary): boolean {
  const tag = element.tag.toLocaleLowerCase();

  if (tag !== "input" && tag !== "textarea") {
    return false;
  }

  const type = (element.type ?? "").trim().toLocaleLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

async function findExplicitSubmitTarget(
  page: Page,
  selector: string,
): Promise<string | undefined> {
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

    const containsSubmitSignal = (target: Element) => {
      const htmlTarget = target as HTMLElement;
      const haystack = [
        normalizeWhitespace(htmlTarget.innerText ?? htmlTarget.textContent),
        normalizeWhitespace(target.getAttribute("aria-label")),
        normalizeWhitespace(target.getAttribute("title")),
        normalizeWhitespace(target.getAttribute("placeholder")),
        normalizeWhitespace(target.getAttribute("role")),
        normalizeWhitespace(htmlTarget.className),
        normalizeWhitespace(htmlTarget.id),
      ]
        .join(" ")
        .toLocaleLowerCase();

      return ["search", "submit", "query", "搜索", "查找", "检索"].some(
        (keyword) => haystack.includes(keyword),
      );
    };

    const htmlElement = element as HTMLElement;
    const inputRect = htmlElement.getBoundingClientRect();
    const scope =
      htmlElement.closest("form") ??
      htmlElement.parentElement ??
      htmlElement.closest("header, nav, [role='navigation']") ??
      document.body;

    const candidates = Array.from(scope.querySelectorAll("*"))
      .filter((candidate) => candidate !== element)
      .filter((candidate) => candidate instanceof HTMLElement)
      .map((candidate) => {
        const htmlCandidate = candidate as HTMLElement;
        const rect = htmlCandidate.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
          return null;
        }

        const style = getComputedStyle(htmlCandidate);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return null;
        }

        const tag = candidate.tagName.toLowerCase();
        const role = normalizeWhitespace(candidate.getAttribute("role"));
        const type =
          candidate instanceof HTMLInputElement ||
          candidate instanceof HTMLButtonElement
            ? normalizeWhitespace(candidate.type).toLowerCase()
            : "";

        const hasButtonSemantics =
          tag === "button" ||
          role === "button" ||
          tag === "a" ||
          type === "submit" ||
          type === "button" ||
          type === "image";

        if (!hasButtonSemantics) {
          return null;
        }

        const horizontalDistance = Math.abs(rect.left - inputRect.right);
        const verticalDistance = Math.abs(rect.top - inputRect.top);
        let score = 0;

        if (containsSubmitSignal(candidate)) {
          score += 12;
        }

        if (tag === "button" || type === "submit") {
          score += 8;
        }

        if (candidate.closest("form") === htmlElement.closest("form")) {
          score += 6;
        }

        if (horizontalDistance <= 220) {
          score += 5;
        }

        if (verticalDistance <= 120) {
          score += 4;
        }

        return {
          selector: buildSelector(candidate),
          score,
        };
      })
      .filter(
        (
          candidate,
        ): candidate is {
          selector: string;
          score: number;
        } => Boolean(candidate),
      )
      .sort((left, right) => right.score - left.score);

    const bestCandidate = candidates[0];

    if (!bestCandidate || bestCandidate.score < 10) {
      return undefined;
    }

    return bestCandidate.selector;
  });
}

