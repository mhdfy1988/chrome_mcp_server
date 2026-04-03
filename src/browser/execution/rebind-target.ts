import type { Page } from "puppeteer-core";
import type { BindingRecord } from "../binding/binding-record.js";
import { evaluateWithDomHelpers } from "../core/dom-helpers.js";

export interface ReboundTargetResult {
  selector: string;
  originalSelector: string;
  resolvedBy:
    | "original_selector"
    | "runtime_node_key"
    | "fingerprint"
    | "fallback_anchor";
  rebound: boolean;
}

export async function resolveSelectorFromBinding(
  page: Page,
  selector: string,
  bindingRecord: BindingRecord | undefined,
): Promise<ReboundTargetResult> {
  if (!bindingRecord) {
    return {
      selector,
      originalSelector: selector,
      resolvedBy: "original_selector",
      rebound: false,
    };
  }

  return evaluateWithDomHelpers(
    page,
    (helpers, args) => {
      const normalizeFingerprintPart = (value: string) =>
        value.replace(/\s+/g, " ").trim().slice(0, 120);

      const buildFingerprintFromSummary = (
        summary: ReturnType<typeof helpers.summarizeInteractiveElement>,
      ) => {
        const parts = [
          `tag=${normalizeFingerprintPart(summary.tag)}`,
          summary.role
            ? `role=${normalizeFingerprintPart(summary.role)}`
            : undefined,
          summary.type
            ? `type=${normalizeFingerprintPart(summary.type)}`
            : undefined,
          summary.accessibleName
            ? `name=${normalizeFingerprintPart(summary.accessibleName)}`
            : undefined,
          summary.label
            ? `label=${normalizeFingerprintPart(summary.label)}`
            : undefined,
          summary.title
            ? `title=${normalizeFingerprintPart(summary.title)}`
            : undefined,
          summary.placeholder
            ? `placeholder=${normalizeFingerprintPart(summary.placeholder)}`
            : undefined,
          summary.name
            ? `attrName=${normalizeFingerprintPart(summary.name)}`
            : undefined,
          summary.href
            ? `href=${normalizeFingerprintPart(summary.href)}`
            : undefined,
          summary.contextAnchor
            ? `context=${normalizeFingerprintPart(summary.contextAnchor)}`
            : undefined,
          summary.text
            ? `text=${normalizeFingerprintPart(summary.text)}`
            : undefined,
        ].filter(Boolean);

        return parts.join("|");
      };

      const summarize = (element: Element) => {
        const summary = helpers.summarizeInteractiveElement(element, 0);
        return {
          summary,
          fingerprint: buildFingerprintFromSummary(summary),
        };
      };

      const isVisibleElement = (
        element: Element | null | undefined,
      ): element is HTMLElement =>
        element instanceof HTMLElement && helpers.isVisible(element);

      const selectorLooksQueryable = (value: string) =>
        /[#.\[:> ]/.test(value) || /^[a-z]/i.test(value);

      const queryBySelector = (candidateSelector: string) => {
        try {
          return document.querySelector(candidateSelector);
        } catch {
          return null;
        }
      };

      const isSameBinding = (element: Element) => {
        const { summary, fingerprint } = summarize(element);

        if (
          args.binding.runtimeNodeKey &&
          summary.runtimeNodeKey === args.binding.runtimeNodeKey
        ) {
          return true;
        }

        if (
          args.binding.fingerprint &&
          fingerprint === args.binding.fingerprint
        ) {
          return true;
        }

        return false;
      };

      const toResult = (
        element: Element,
        resolvedBy: ReboundTargetResult["resolvedBy"],
      ): ReboundTargetResult => ({
        selector: helpers.buildSelector(element, { preferClasses: true }),
        originalSelector: args.originalSelector,
        resolvedBy,
        rebound:
          helpers.buildSelector(element, { preferClasses: true }) !==
          args.originalSelector,
      });

      const originalTarget = queryBySelector(args.originalSelector);
      if (isVisibleElement(originalTarget) && isSameBinding(originalTarget)) {
        return toResult(originalTarget, "original_selector");
      }

      const visibleElements = Array.from(document.querySelectorAll("*")).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && helpers.isVisible(element),
      );

      if (args.binding.runtimeNodeKey) {
        const runtimeMatch = visibleElements.find((element) => {
          const { summary } = summarize(element);
          return summary.runtimeNodeKey === args.binding.runtimeNodeKey;
        });
        if (runtimeMatch) {
          return toResult(runtimeMatch, "runtime_node_key");
        }
      }

      if (args.binding.fingerprint) {
        const fingerprintMatch = visibleElements.find((element) => {
          const { fingerprint } = summarize(element);
          return fingerprint === args.binding.fingerprint;
        });
        if (fingerprintMatch) {
          return toResult(fingerprintMatch, "fingerprint");
        }
      }

      for (const anchor of args.binding.fallbackAnchors ?? []) {
        if (!anchor) {
          continue;
        }

        if (selectorLooksQueryable(anchor)) {
          const selectorMatch = queryBySelector(anchor);
          if (isVisibleElement(selectorMatch)) {
            return toResult(selectorMatch, "fallback_anchor");
          }
        }

        const anchorMatch = visibleElements.find((element) => {
          const { summary } = summarize(element);
          return [
            summary.accessibleName,
            summary.label,
            summary.title,
            summary.placeholder,
            summary.name,
            summary.text,
            summary.href,
            summary.contextAnchor,
          ].some((value) => value === anchor);
        });
        if (anchorMatch) {
          return toResult(anchorMatch, "fallback_anchor");
        }
      }

      return {
        selector: args.originalSelector,
        originalSelector: args.originalSelector,
        resolvedBy: "original_selector",
        rebound: false,
      };
    },
    {
      originalSelector: selector,
      binding: {
        runtimeNodeKey: bindingRecord.runtimeNodeKey,
        fingerprint: bindingRecord.fingerprint,
        fallbackAnchors: bindingRecord.fallbackAnchors,
      },
    },
  );
}
