import type { BrowserRuntimeDeps } from "../session/runtime-deps.js";
import { BrowserToolError } from "../../errors.js";
import type { BrowserInspectionUsecaseDeps } from "./inspection-usecases.js";
import { readMediaStateWithRuntime } from "./inspection-usecases.js";
import { resolvePlanActionTarget } from "./plan-target-resolution.js";
import { clickResolvedTarget } from "../execution/safe-click.js";
import { observeAction } from "../observation/action-observation.js";
import type { ActionAttemptSummary } from "../execution/types.js";
import type { PlayMediaWithPlanResult } from "./types.js";

export async function playMediaWithPlanWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    pageId?: string;
    selector?: string;
    timeoutMs?: number;
    maxResults?: number;
    maxPlanSteps?: number;
  },
): Promise<PlayMediaWithPlanResult> {
  let page = await deps.resolvePage(options.pageId);
  const maxResults = options.maxResults ?? 5;
  const timeoutMs = options.timeoutMs ?? deps.config.stepTimeoutMs;
  const beforeState = await readMediaStateWithRuntime(
    createInspectionDepsFromRuntime(deps),
    {
      pageId: deps.requirePageId(page),
      selector: options.selector,
      maxResults,
    },
  );
  const playMediaPlan = beforeState.playMediaPlan.slice(
    0,
    options.maxPlanSteps ?? beforeState.playMediaPlan.length,
  );

  if (playMediaPlan.length === 0) {
    throw new BrowserToolError(
      "invalid_operation",
      "当前页面未生成可执行的播放计划。",
    );
  }

  const beforePrimary = beforeState.media[0];
  const attempts: PlayMediaWithPlanResult["attempts"] = [];

  for (const step of playMediaPlan) {
    try {
      if (step.method === "already_playing") {
        const playing = Boolean(beforePrimary && !beforePrimary.paused);
        attempts.push({
          method: step.method,
          confidence: step.confidence,
          reasons: step.reasons,
          selector: step.target?.selector ?? step.selector,
          text: step.text,
          accessibleName: step.accessibleName,
          changed: false,
          playing,
        });

        if (playing) {
          return {
            page: beforeState.page,
            total: beforeState.total,
            playMediaPlan,
            chosenMethod: step.method,
            chosenSelector: step.target?.selector ?? step.selector,
            beforePrimaryPaused: beforePrimary?.paused,
            beforePrimaryCurrentTime: beforePrimary?.currentTime,
            afterPrimaryPaused: beforePrimary?.paused,
            afterPrimaryCurrentTime: beforePrimary?.currentTime,
            playbackChanged: false,
            playing: true,
            attempts,
            note: "主媒体已在播放，无需额外点击。",
          };
        }

        continue;
      }

      let actionAttempt: ActionAttemptSummary | undefined;
      const observation = await observeAction(
        deps,
        page,
        async () => {
          const target = await resolvePlanActionTarget(deps, page, step);
          const clickResult = await clickResolvedTarget(page, {
            selector: target.selector,
            timeoutMs,
            preflight: target.preflight,
          });
          actionAttempt = clickResult.actionAttempt;
        },
        {
          timeoutMs,
          observeDom: true,
        },
      );

      page = observation.finalPage;

      const afterState = await readMediaStateWithRuntime(
        createInspectionDepsFromRuntime(deps),
        {
          pageId: deps.requirePageId(page),
          selector: options.selector,
          maxResults,
        },
      );
      const afterPrimary = afterState.media[0];
      const playing = Boolean(afterPrimary && !afterPrimary.paused);
      const playbackChanged = Boolean(
        beforePrimary &&
          afterPrimary &&
          ((beforePrimary.paused && !afterPrimary.paused) ||
            afterPrimary.currentTime > beforePrimary.currentTime),
      );

      attempts.push({
        method: step.method,
        confidence: step.confidence,
        reasons: step.reasons,
        selector: step.target?.selector ?? step.selector,
        text: step.text,
        accessibleName: step.accessibleName,
        changed: observation.changed,
        actionAttempt,
        playing,
      });

      if (playing) {
        return {
          page: afterState.page,
          total: afterState.total,
          playMediaPlan,
          chosenMethod: step.method,
          chosenSelector: step.target?.selector ?? step.selector,
          actionAttempt,
          beforePrimaryPaused: beforePrimary?.paused,
          beforePrimaryCurrentTime: beforePrimary?.currentTime,
          afterPrimaryPaused: afterPrimary?.paused,
          afterPrimaryCurrentTime: afterPrimary?.currentTime,
          playbackChanged,
          playing,
          attempts,
          note:
            attempts.length > 1
              ? `已按播放计划尝试 ${attempts.length} 步。`
              : undefined,
        };
      }
    } catch (error) {
      attempts.push({
        method: step.method,
        confidence: step.confidence,
        reasons: step.reasons,
        selector: step.target?.selector ?? step.selector,
        text: step.text,
        accessibleName: step.accessibleName,
        changed: false,
        playing: false,
        note: error instanceof Error ? error.message : String(error),
      });
      page = await deps.resolvePage(deps.getCurrentPageId());
    }
  }

  throw new BrowserToolError(
    "action_verification_failed",
    `按播放计划尝试后仍未成功：${attempts
      .map((attempt) => {
        const target = attempt.selector ? `(${attempt.selector})` : "";
        const note = attempt.note ? ` ${attempt.note}` : "";
        return `${attempt.method}${target}${note}`;
      })
      .join(" | ")}`,
    {
      attempts,
      planLength: playMediaPlan.length,
    },
  );
}

function createInspectionDepsFromRuntime(
  deps: BrowserRuntimeDeps,
): BrowserInspectionUsecaseDeps {
  return {
    defaultTimeoutMs: deps.config.defaultTimeoutMs,
    resolvePage: (pageId) => deps.resolvePage(pageId),
    requirePageId: (page) => deps.requirePageId(page),
    summarizePage: (pageId, page) => deps.summarizePage(pageId, page),
    attachElementRefs: (pageId, elements) =>
      deps.attachElementRefs(pageId, elements),
    resolveSelectorForRef: (pageId, ref) =>
      deps.resolveSelectorForRef(pageId, ref),
    getBindingRecord: (pageId, ref) => deps.getBindingRecord(pageId, ref),
  };
}
