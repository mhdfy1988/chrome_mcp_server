import type { BindingAttachableElement } from "../binding/binding-record.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import type { BrowserInspectionDeps } from "../session/inspection-deps.js";
import { findElementsWithInspection } from "../discovery/find-elements.js";
import { findPrimaryInputsWithInspection } from "../discovery/find-primary-inputs.js";
import { findPrimaryResultsWithInspection } from "../discovery/find-primary-results.js";
import { findSubmitTargetsWithInspection } from "../discovery/find-submit-targets.js";
import { readMediaStateWithInspection } from "../discovery/media-state.js";
import { extractTextWithInspection, evaluateWithInspection } from "../state/inspection-text.js";
import { pageSnapshotWithInspection } from "../state/page-snapshot.js";
import { buildPlanTargetRef } from "./plan-target-ref.js";
import type {
  FindElementsResult,
  FindPrimaryInputsResult,
  FindPrimaryResultsResult,
  FindSubmitTargetsResult,
  PageSnapshotResult,
  PlanTargetRef,
  ReadMediaStateResult,
} from "../discovery/types.js";
import type { EvaluateResult, PageSummary } from "../state/types.js";
import type { WaitMatchMode } from "../observation/types.js";

export type BrowserInspectionUsecaseDeps = BrowserInspectionDeps & {
  attachElementRefs<T extends BindingAttachableElement>(
    pageId: string,
    elements: T[],
  ): Array<T & { ref: string }>;
};

async function buildPlanTargetMapBySelectors(
  deps: BrowserInspectionUsecaseDeps,
  pageId: string,
  selectors: string[],
): Promise<Map<string, PlanTargetRef>> {
  const uniqueSelectors = Array.from(new Set(selectors.filter(Boolean)));
  if (uniqueSelectors.length === 0) {
    return new Map();
  }

  const page = await deps.resolvePage(pageId);
  const attachables = await evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      return args.selectors
        .map((selector) => {
          let element: Element | null = null;
          try {
            element = document.querySelector(selector);
          } catch {
            element = null;
          }

          if (!(element instanceof Element)) {
            return null;
          }

          const summary = helpers.summarizeInteractiveElement(element, 0);
          return {
            tag: summary.tag,
            role: summary.role,
            type: summary.type,
            text: summary.text,
            accessibleName: summary.accessibleName,
            label: summary.label,
            placeholder: summary.placeholder,
            title: summary.title,
            name: summary.name,
            selector: summary.selector,
            href: summary.href,
            runtimeNodeKey: summary.runtimeNodeKey,
            contextAnchor: summary.contextAnchor,
            semanticRole: summary.semanticRole,
            axRole: summary.axRole,
          };
        })
        .filter(Boolean);
    },
    {
      selectors: uniqueSelectors,
    },
  );

  const attached = deps.attachElementRefs(
    pageId,
    attachables as BindingAttachableElement[],
  );

  return new Map(
    attached.map((candidate) => [
      candidate.selector,
      buildPlanTargetRef(deps, pageId, candidate),
    ]),
  );
}

export async function extractTextWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    mode?: "auto" | "main" | "article" | "body";
    maxLength: number;
  },
): Promise<{ page: PageSummary; text: string }> {
  return extractTextWithInspection(deps, options);
}

export async function pageSnapshotWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    maxTextLength: number;
    maxElements: number;
  },
): Promise<PageSnapshotResult> {
  const snapshot = await pageSnapshotWithInspection(deps, options);

  return {
    ...snapshot,
    interactiveElements: deps.attachElementRefs(
      snapshot.page.pageId,
      snapshot.interactiveElements,
    ),
  };
}

export async function findElementsWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    query: string;
    matchMode: WaitMatchMode;
    tag?: string;
    role?: string;
    maxResults: number;
    inspectLimit: number;
  },
): Promise<FindElementsResult> {
  const result = await findElementsWithInspection(deps, options);

  return {
    ...result,
    elements: deps.attachElementRefs(result.page.pageId, result.elements),
  };
}

export async function findPrimaryInputsWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    maxResults: number;
  },
): Promise<FindPrimaryInputsResult> {
  return findPrimaryInputsWithInspection(deps, options);
}

export async function findPrimaryResultsWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    query?: string;
    maxResults: number;
  },
): Promise<FindPrimaryResultsResult> {
  const result = await findPrimaryResultsWithInspection(deps, options);
  const resultsWithRefs = deps.attachElementRefs(result.page.pageId, result.results);
  const resultTargetMap = new Map(
    resultsWithRefs.map((candidate) => [
      candidate.selector,
      buildPlanTargetRef(deps, result.page.pageId, candidate),
    ]),
  );

  return {
    ...result,
    results: resultsWithRefs,
    openResultPlan: result.openResultPlan.map((step) => ({
      ...step,
      target: resultTargetMap.get(step.selector),
    })),
  };
}

export async function findSubmitTargetsWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    maxResults: number;
  },
): Promise<FindSubmitTargetsResult> {
  const page = await deps.resolvePage(options.pageId);
  const pageId = deps.requirePageId(page);
  const selector = options.ref
    ? deps.resolveSelectorForRef(pageId, options.ref)
    : options.selector;

  if (!selector) {
    throw new Error("selector 和 ref 至少要提供一个。");
  }

  const result = await findSubmitTargetsWithInspection(deps, {
    pageId,
    selector,
    maxResults: options.maxResults,
  });

  const candidatesWithRefs = deps.attachElementRefs(result.page.pageId, result.candidates);
  const candidateTargetMap = new Map(
    candidatesWithRefs.map((candidate) => [
      candidate.selector,
      buildPlanTargetRef(deps, result.page.pageId, candidate),
    ]),
  );

  return {
    ...result,
    candidates: candidatesWithRefs.map((candidate) => ({
      ...candidate,
      target: candidateTargetMap.get(candidate.selector),
    })),
    submitPlan: result.submitPlan.map((step) => ({
      ...step,
      target: step.selector ? candidateTargetMap.get(step.selector) : undefined,
    })),
  };
}

export async function readMediaStateWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    selector?: string;
    maxResults: number;
  },
): Promise<ReadMediaStateResult> {
  const result = await readMediaStateWithInspection(deps, options);
  const mediaWithRefs = deps.attachElementRefs(result.page.pageId, result.media);
  const mediaTargetMap = new Map(
    mediaWithRefs.map((candidate) => [
      candidate.selector,
      buildPlanTargetRef(deps, result.page.pageId, candidate),
    ]),
  );
  const supplementalTargetMap = await buildPlanTargetMapBySelectors(
    deps,
    result.page.pageId,
    result.playMediaPlan
      .map((step) => step.selector)
      .filter((selector): selector is string => Boolean(selector))
      .filter((selector) => !mediaTargetMap.has(selector)),
  );

  return {
    ...result,
    media: mediaWithRefs,
    playMediaPlan: result.playMediaPlan.map((step) => ({
      ...step,
      target: step.selector
        ? mediaTargetMap.get(step.selector) ??
          supplementalTargetMap.get(step.selector)
        : undefined,
    })),
  };
}

export async function evaluateWithRuntime(
  deps: BrowserInspectionUsecaseDeps,
  options: {
    pageId?: string;
    expression: string;
  },
): Promise<EvaluateResult> {
  return evaluateWithInspection(deps, options);
}
