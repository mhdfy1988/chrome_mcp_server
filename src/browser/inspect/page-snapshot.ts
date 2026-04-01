import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { RawPageSnapshotResult } from "../core/types.js";

export async function pageSnapshotWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    maxTextLength: number;
    maxElements: number;
  },
): Promise<RawPageSnapshotResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const snapshot = await evaluateWithDomHelpers(
    page,
    (helpers, { maxTextLength, maxElements }) => {
      const query =
        "*";

      const interactiveElements = Array.from(
        new Set(
          Array.from(document.querySelectorAll(query)).filter((element) =>
            helpers.isProbablyInteractive(element),
          ),
        ),
      )
        .slice(0, maxElements)
        .map((element, index) =>
          helpers.summarizeInteractiveElement(element, index + 1),
        );

      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
        .filter((element) => helpers.isVisible(element))
        .map((element) =>
          helpers.clipText(
            helpers.normalizeWhitespace(element.textContent),
            120,
          ),
        )
        .filter(Boolean)
        .slice(0, 20);

      const textPreview = helpers.clipText(
        helpers.normalizeWhitespace(document.body?.innerText ?? ""),
        maxTextLength,
      );

      return {
        headings,
        textPreview,
        interactiveElements,
      };
    },
    {
      maxTextLength: options.maxTextLength,
      maxElements: options.maxElements,
    },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    headings: snapshot.headings,
    textPreview: snapshot.textPreview,
    interactiveElements: snapshot.interactiveElements,
  };
}

