import type { Page } from "puppeteer-core";
import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";
import type { BindingRecord } from "../binding/binding-record.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";
import { BrowserToolError } from "../../errors.js";
import type { TargetPreflightSummary } from "./types.js";
import { resolveSelectorFromBinding } from "./rebind-target.js";

export async function resolveActionTargetWithPreflight(
  deps: BrowserRuntimeDeps,
  options: {
    selector?: string;
    ref?: string;
    pageId?: string;
  },
): Promise<{
  page: Page;
  pageId: string;
  selector: string;
  bindingRecord?: BindingRecord;
  preflight: TargetPreflightSummary;
}> {
  const page = await deps.resolvePage(options.pageId);
  const pageId = deps.requirePageId(page);

  let selector = options.selector;
  let originalSelector = options.selector;
  let bindingRecord: BindingRecord | undefined;
  let mode: "ref" | "selector" = "selector";
  let selectorResolvedBy: TargetPreflightSummary["selectorResolvedBy"] =
    "original_selector";
  let selectorRebound = false;

  if (options.ref) {
    mode = "ref";
    selector = deps.resolveSelectorForRef(pageId, options.ref);
    originalSelector = selector;
    bindingRecord = deps.getBindingRecord(pageId, options.ref);
    const rebound = await resolveSelectorFromBinding(page, selector, bindingRecord);
    selector = rebound.selector;
    selectorResolvedBy = rebound.resolvedBy;
    selectorRebound = rebound.rebound;
  }

  if (!selector) {
    throw new BrowserToolError(
      "invalid_operation",
      "selector 和 ref 至少要提供一个。",
    );
  }

  const preflight = await runTargetPreflight(page, {
    selector,
    ref: options.ref,
    mode,
    originalSelector,
    selectorResolvedBy,
    selectorRebound,
    bindingRecord,
  });

  if (!preflight.exists) {
    throw new BrowserToolError(
      "invalid_operation",
      `目标预检失败：当前页面找不到目标元素（selector: ${selector}）。请重新执行 page_snapshot 或 find_elements 获取最新目标。`,
      {
        selector,
        ref: options.ref,
      },
    );
  }

  return {
    page,
    pageId,
    selector: preflight.selector,
    bindingRecord,
    preflight,
  };
}

async function runTargetPreflight(
  page: Page,
  options: {
    selector: string;
    ref?: string;
    mode: "ref" | "selector";
    originalSelector?: string;
    selectorResolvedBy?: TargetPreflightSummary["selectorResolvedBy"];
    selectorRebound?: boolean;
    bindingRecord?: BindingRecord;
  },
): Promise<TargetPreflightSummary> {
  return evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const target = document.querySelector(args.selector);
      if (!(target instanceof HTMLElement)) {
        return {
          mode: args.mode,
          ref: args.ref,
          originalSelector: args.originalSelector,
          selector: args.selector,
          selectorResolvedBy: args.selectorResolvedBy,
          selectorRebound: args.selectorRebound,
          hasBindingRecord: Boolean(args.bindingRecord),
          runtimeNodeKey: args.bindingRecord?.runtimeNodeKey,
          contextAnchor: args.bindingRecord?.contextAnchor,
          exists: false,
          visible: false,
          inViewport: false,
          hitTarget: false,
          fallbackClickable: false,
        };
      }

      const effectiveTarget =
        helpers.resolvePrimaryActionElement(target) ?? target;
      const descendedToActionTarget = effectiveTarget !== target;
      const effectiveSelector = helpers.buildSelector(effectiveTarget, {
        preferClasses: true,
      });
      const summary = helpers.summarizeInteractiveElement(target, 1);
      const effectiveSummary = helpers.summarizeInteractiveElement(
        effectiveTarget,
        1,
      );
      const effectiveRole = String(
        effectiveSummary.role ?? effectiveSummary.semanticRole ?? "",
      )
        .trim()
        .toLowerCase();
      const effectiveTag = effectiveTarget.tagName.toLowerCase();
      const rect = effectiveTarget.getBoundingClientRect();
      const visible = helpers.isVisible(effectiveTarget);
      const inViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;

      const clampX = (value: number) =>
        Math.min(Math.max(value, 1), Math.max(window.innerWidth - 1, 1));
      const clampY = (value: number) =>
        Math.min(Math.max(value, 1), Math.max(window.innerHeight - 1, 1));
      const insetX = Math.min(Math.max(8, rect.width * 0.18), rect.width / 2);
      const insetY = Math.min(Math.max(8, rect.height * 0.18), rect.height / 2);
      const primaryPoint = {
        x: clampX(rect.left + rect.width / 2),
        y: clampY(rect.top + rect.height / 2),
      };

      const candidatePoints = [
        primaryPoint,
        { x: clampX(rect.left + insetX), y: primaryPoint.y },
        { x: clampX(rect.right - insetX), y: primaryPoint.y },
        { x: primaryPoint.x, y: clampY(rect.top + insetY) },
        { x: primaryPoint.x, y: clampY(rect.bottom - insetY) },
        { x: clampX(rect.left + insetX), y: clampY(rect.top + insetY) },
        { x: clampX(rect.right - insetX), y: clampY(rect.top + insetY) },
        { x: clampX(rect.left + insetX), y: clampY(rect.bottom - insetY) },
        { x: clampX(rect.right - insetX), y: clampY(rect.bottom - insetY) },
      ];

      const normalizeHitTestValue = (value: unknown) =>
        helpers.normalizeWhitespace(value).toLocaleLowerCase();
      const isIgnorableHitTestBlocker = (element: Element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const style = window.getComputedStyle(element);
        if (style.pointerEvents === "none") {
          return true;
        }

        const rect = element.getBoundingClientRect();
        const haystack = normalizeHitTestValue(
          [
            element.id,
            element.className,
            element.getAttribute("role"),
            element.getAttribute("aria-label"),
            element.getAttribute("data-testid"),
            element.getAttribute("aria-busy"),
          ].join(" "),
        );
        const hasLoadingSignal =
          haystack.includes("loader") ||
          haystack.includes("loading") ||
          haystack.includes("progress") ||
          haystack.includes("spinner") ||
          haystack.includes("skeleton") ||
          haystack.includes("shimmer") ||
          haystack.includes("busy") ||
          haystack.includes("pjax");
        const isThinBar =
          rect.height > 0 &&
          rect.height <= 12 &&
          rect.width >= window.innerWidth * 0.25;
        const isSmallIndicator =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.width <= 72 &&
          rect.height <= 72;
        const isFixedLike =
          style.position === "fixed" ||
          style.position === "sticky" ||
          style.position === "absolute";

        return hasLoadingSignal && (isThinBar || isSmallIndicator || isFixedLike);
      };
      const inspectPoint = (point: { x: number; y: number }) => {
        const stack = Array.from(document.elementsFromPoint(point.x, point.y));
        const firstNonIgnorable =
          stack.find((candidate) => !isIgnorableHitTestBlocker(candidate)) ?? null;
        const topElement = firstNonIgnorable ?? stack[0] ?? null;
        const stackContainsTarget = stack.some(
          (candidate) =>
            candidate === effectiveTarget || effectiveTarget.contains(candidate),
        );
        const hitTarget = Boolean(
          topElement instanceof Element &&
            (topElement === effectiveTarget ||
              effectiveTarget.contains(topElement)),
        );

        return {
          topElement,
          stackContainsTarget,
          hitTarget,
        };
      };
      const primaryHit = inspectPoint(primaryPoint);
      const topElement = primaryHit.topElement;
      const topElementSelector =
        topElement instanceof Element
          ? helpers.buildSelector(topElement, { preferClasses: true })
          : undefined;
      const hitTarget = primaryHit.hitTarget;
      const stackContainsTarget = primaryHit.stackContainsTarget;

      const safePoint = candidatePoints.find((point) => {
        const candidateHit = inspectPoint(point);
        return candidateHit.hitTarget;
      });
      const allowSemanticClickFallback = Boolean(
        !hitTarget &&
          stackContainsTarget &&
          topElement instanceof Element &&
          topElement.contains(effectiveTarget) &&
          (effectiveTag === "a" ||
            effectiveTag === "button" ||
            effectiveTag === "summary" ||
            effectiveTarget instanceof HTMLInputElement ||
            effectiveRole === "link" ||
            effectiveRole === "button"),
      );

      const runtimeNodeKey = args.bindingRecord?.runtimeNodeKey;
      const currentRuntimeNodeKey = summary.runtimeNodeKey;
      const contextAnchor = args.bindingRecord?.contextAnchor;
      const currentContextAnchor = summary.contextAnchor;

      return {
        mode: args.mode,
        ref: args.ref,
        originalSelector: args.originalSelector,
        containerSelector: descendedToActionTarget ? args.selector : undefined,
        selector: effectiveSelector,
        selectorResolvedBy: args.selectorResolvedBy,
        selectorRebound: args.selectorRebound,
        descendedToActionTarget,
        hasBindingRecord: Boolean(args.bindingRecord),
        runtimeNodeKey,
        currentRuntimeNodeKey,
        runtimeNodeKeyMatched:
          runtimeNodeKey && currentRuntimeNodeKey
            ? runtimeNodeKey === currentRuntimeNodeKey
            : undefined,
        contextAnchor,
        currentContextAnchor,
        contextAnchorMatched:
          contextAnchor && currentContextAnchor
            ? contextAnchor === currentContextAnchor
            : undefined,
        exists: true,
        visible,
        inViewport,
        hitTarget,
        stackContainsTarget,
        allowSemanticClickFallback,
        clickPoint: safePoint,
        fallbackClickable:
          visible && inViewport && !hitTarget && Boolean(safePoint),
        topElementSelector,
        blockedBySelector: hitTarget ? undefined : topElementSelector,
      };
    },
    {
      selector: options.selector,
      ref: options.ref,
      mode: options.mode,
      originalSelector: options.originalSelector,
      selectorResolvedBy: options.selectorResolvedBy,
      selectorRebound: options.selectorRebound,
      bindingRecord: options.bindingRecord
        ? {
            runtimeNodeKey: options.bindingRecord.runtimeNodeKey,
            contextAnchor: options.bindingRecord.contextAnchor,
          }
        : undefined,
    },
  );
}
