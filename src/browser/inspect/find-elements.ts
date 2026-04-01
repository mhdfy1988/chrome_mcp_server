import { pageSnapshotWithInspection } from "./page-snapshot.js";
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
  const snapshot = await pageSnapshotWithInspection(deps, {
    pageId: options.pageId,
    maxTextLength: 1000,
    maxElements: options.inspectLimit,
  });

  const query = options.query.trim();
  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedTag = options.tag?.trim().toLocaleLowerCase();
  const normalizedRole = options.role?.trim().toLocaleLowerCase();

  const getMatchScore = (
    value: string | undefined,
    containsScore: number,
    exactScore = containsScore + 3,
  ) => {
    if (!value) {
      return 0;
    }

    const normalizedValue = value.toLocaleLowerCase();
    if (options.matchMode === "exact") {
      return normalizedValue === normalizedQuery ? exactScore : 0;
    }

    return normalizedValue.includes(normalizedQuery) ? containsScore : 0;
  };

  const allMatches = snapshot.interactiveElements
    .map((element) => {
      if (normalizedTag && element.tag.toLocaleLowerCase() !== normalizedTag) {
        return null;
      }

      if (
        normalizedRole &&
        (element.role?.toLocaleLowerCase() ?? "") !== normalizedRole
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

      collectMatch("accessibleName", getMatchScore(element.accessibleName, 12));
      collectMatch("label", getMatchScore(element.label, 10));
      collectMatch("text", getMatchScore(element.text, 8));
      collectMatch("placeholder", getMatchScore(element.placeholder, 7));
      collectMatch("value", getMatchScore(element.value, 6));
      collectMatch("href", getMatchScore(element.href, 4));
      collectMatch("selector", getMatchScore(element.selector, 3));

      if (matchScore <= 0) {
        return null;
      }

      return {
        ...element,
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
      (left, right) => right.matchScore - left.matchScore || left.index - right.index,
    );

  return {
    page: snapshot.page,
    query,
    total: allMatches.length,
    elements: allMatches.slice(0, options.maxResults),
  };
}

