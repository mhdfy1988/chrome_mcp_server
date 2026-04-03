import type { BindingAttachableElement } from "../binding/binding-record.js";
import type { PlanTargetRef } from "../discovery/types.js";

export function buildPlanTargetRef(
  deps: {
    getBindingRecord(pageId: string, ref: string): {
      runtimeNodeKey?: string;
      fingerprint: string;
      contextAnchor?: string;
      fallbackAnchors: string[];
    } | undefined;
  },
  pageId: string,
  element: BindingAttachableElement & { ref: string },
): PlanTargetRef {
  const bindingRecord = deps.getBindingRecord(pageId, element.ref);

  return {
    ref: element.ref,
    selector: element.selector,
    runtimeNodeKey: bindingRecord?.runtimeNodeKey ?? element.runtimeNodeKey,
    fingerprint: bindingRecord?.fingerprint,
    contextAnchor: bindingRecord?.contextAnchor ?? element.contextAnchor,
    fallbackAnchors: bindingRecord?.fallbackAnchors,
  };
}
