import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import type {
  RawFindElementsResult,
  RawSnapshotElementSummary,
  WaitMatchMode,
} from "../core/types.js";

export async function findElementsWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    query: string;
    matchMode: WaitMatchMode;
    tag?: string;
    role?: string;
    maxResults: number;
    inspectLimit: number;
  },
): Promise<RawFindElementsResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const query = options.query.trim();

  const result = await evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const normalizedQuery = args.query.toLocaleLowerCase();
      const normalizedTag = args.tag?.trim().toLocaleLowerCase();
      const normalizedRole = args.role?.trim().toLocaleLowerCase();
      let interactiveIndex = 0;

      const getMatchScore = (
        value: string | undefined,
        containsScore: number,
        exactScore = containsScore + 3,
      ) => {
        if (!value) {
          return 0;
        }

        const normalizedValue = value.toLocaleLowerCase();
        if (args.matchMode === "exact") {
          return normalizedValue === normalizedQuery ? exactScore : 0;
        }

        return normalizedValue.includes(normalizedQuery) ? containsScore : 0;
      };

      const allMatches = Array.from(document.querySelectorAll("*"))
        .filter((element) => helpers.isProbablyInteractive(element))
        .map((element) => {
          interactiveIndex += 1;
          const summary = helpers.summarizeInteractiveElement(
            element,
            interactiveIndex,
          );

          if (normalizedTag && summary.tag.toLocaleLowerCase() !== normalizedTag) {
            return null;
          }

          if (
            normalizedRole &&
            (summary.role?.toLocaleLowerCase() ?? "") !== normalizedRole
          ) {
            return null;
          }

          const matchReasons: string[] = [];
          let matchScore = 0;

          const collectMatch = (reason: string, score: number) => {
            if (score <= 0) {
              return;
            }
            matchReasons.push(reason);
            matchScore += score;
          };

          collectMatch("accessibleName", getMatchScore(summary.accessibleName, 12));
          collectMatch("label", getMatchScore(summary.label, 10));
          collectMatch("text", getMatchScore(summary.text, 8));
          collectMatch("placeholder", getMatchScore(summary.placeholder, 7));
          collectMatch("value", getMatchScore(summary.value, 6));
          collectMatch("title", getMatchScore(summary.title, 6));
          collectMatch("name", getMatchScore(summary.name, 5));
          collectMatch("className", getMatchScore(summary.className, 5));
          collectMatch("href", getMatchScore(summary.href, 4));
          collectMatch("selector", getMatchScore(summary.selector, 4));

          if (matchScore <= 0) {
            return null;
          }

          return {
            ...summary,
            matchReasons,
            matchScore,
          };
        })
        .filter(
          (
            element,
          ): element is RawSnapshotElementSummary & {
            matchReasons: string[];
            matchScore: number;
          } => Boolean(element),
        )
        .sort(
          (left, right) =>
            right.matchScore - left.matchScore || left.index - right.index,
        );

      return {
        total: allMatches.length,
        elements: allMatches.slice(0, args.maxResults),
      };
    },
    {
      query,
      tag: options.tag,
      role: options.role,
      matchMode: options.matchMode,
      maxResults: options.maxResults,
    },
  );

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    query,
    total: result.total,
    elements: result.elements,
  };
}
