import type { Page } from "puppeteer-core";
import type { PlanTargetRef } from "../discovery/types.js";
import { resolveActionTargetWithPreflight } from "../execution/target-preflight.js";
import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";

export async function resolvePlanActionTarget(
  deps: BrowserRuntimeDeps,
  page: Page,
  step: {
    target?: PlanTargetRef;
    selector?: string;
  },
) {
  return resolveActionTargetWithPreflight(deps, {
    pageId: deps.requirePageId(page),
    ref: step.target?.ref,
    selector: step.target?.selector ?? step.selector,
  });
}
