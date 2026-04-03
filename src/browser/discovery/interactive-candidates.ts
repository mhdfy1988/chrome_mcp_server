import type { Page } from "puppeteer-core";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { RawSnapshotElementSummary } from "./types.js";
import type { WaitMatchMode } from "../observation/types.js";

export interface DiscoveryCandidate extends RawSnapshotElementSummary {
  semanticRole?: string;
  semanticSignals?: string[];
}

export async function discoverInteractiveCandidates(
  page: Page,
  options: {
    maxElements?: number;
  },
): Promise<DiscoveryCandidate[]> {
  return evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const limit = args.maxElements ?? Number.MAX_SAFE_INTEGER;

      return Array.from(document.querySelectorAll("*"))
        .filter((element) => helpers.isProbablyInteractive(element))
        .slice(0, limit)
        .map((element, index) =>
          helpers.summarizeInteractiveElement(element, index + 1),
        );
    },
    {
      maxElements: options.maxElements,
    },
  );
}

export function matchDiscoveryCandidates(
  candidates: DiscoveryCandidate[],
  options: {
    query: string;
    matchMode: WaitMatchMode;
    tag?: string;
    role?: string;
    maxResults: number;
  },
): Array<
  DiscoveryCandidate & {
    matchReasons: string[];
    matchScore: number;
  }
> {
  const normalizedQuery = options.query.trim().toLocaleLowerCase();
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

  return candidates
    .filter((candidate) => {
      if (normalizedTag && candidate.tag.toLocaleLowerCase() !== normalizedTag) {
        return false;
      }

      if (
        normalizedRole &&
        (candidate.role?.toLocaleLowerCase() ?? "") !== normalizedRole &&
        (candidate.semanticRole?.toLocaleLowerCase() ?? "") !== normalizedRole
      ) {
        return false;
      }

      return true;
    })
    .map((candidate) => {
      const matchReasons: string[] = [];
      let matchScore = 0;

      const collectMatch = (reason: string, score: number) => {
        if (score <= 0) {
          return;
        }
        matchReasons.push(reason);
        matchScore += score;
      };

      collectMatch("accessibleName", getMatchScore(candidate.accessibleName, 12));
      collectMatch("label", getMatchScore(candidate.label, 10));
      collectMatch("text", getMatchScore(candidate.text, 8));
      collectMatch("placeholder", getMatchScore(candidate.placeholder, 7));
      collectMatch("value", getMatchScore(candidate.value, 6));
      collectMatch("title", getMatchScore(candidate.title, 6));
      collectMatch("name", getMatchScore(candidate.name, 5));
      collectMatch("className", getMatchScore(candidate.className, 5));
      collectMatch("href", getMatchScore(candidate.href, 4));
      collectMatch("selector", getMatchScore(candidate.selector, 4));

      return {
        ...candidate,
        matchReasons,
        matchScore,
      };
    })
    .filter((candidate) => candidate.matchScore > 0)
    .sort(
      (left, right) =>
        right.matchScore - left.matchScore || left.index - right.index,
    )
    .slice(0, options.maxResults);
}
