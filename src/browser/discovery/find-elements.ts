import type { BrowserInspectionDeps } from "../session/inspection-deps.js";
import type {
  RawFindElementsResult,
} from "./types.js";
import type { WaitMatchMode } from "../observation/types.js";
import {
  discoverInteractiveCandidates,
  matchDiscoveryCandidates,
} from "./interactive-candidates.js";

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

  const candidates = await discoverInteractiveCandidates(page, {
    maxElements: options.inspectLimit,
  });
  const matches = matchDiscoveryCandidates(candidates, {
    query,
    tag: options.tag,
    role: options.role,
    matchMode: options.matchMode,
    maxResults: options.maxResults,
  });
  const totalMatches = matchDiscoveryCandidates(candidates, {
    query,
    tag: options.tag,
    role: options.role,
    matchMode: options.matchMode,
    maxResults: Number.MAX_SAFE_INTEGER,
  }).length;

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    query,
    total: totalMatches,
    elements: matches,
  };
}
