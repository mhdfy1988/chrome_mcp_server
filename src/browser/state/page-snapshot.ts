import type { BrowserInspectionDeps } from "../session/inspection-deps.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { RawPageSnapshotResult } from "../discovery/types.js";
import { discoverInteractiveCandidates } from "../discovery/interactive-candidates.js";

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
  const interactiveElements = await discoverInteractiveCandidates(page, {
    maxElements: options.maxElements,
  });
  const snapshot = await evaluateWithDomHelpers(
    page,
    (helpers, { maxTextLength }) => {
      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
      )
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
      };
    },
    {
      maxTextLength: options.maxTextLength,
    },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    headings: snapshot.headings,
    textPreview: snapshot.textPreview,
    interactiveElements,
  };
}
