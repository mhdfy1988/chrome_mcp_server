import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import { detectBlockingOverlays } from "../core/blocking-overlays.js";
import type { DismissBlockingOverlaysResult } from "../core/types.js";

function toConfidence(score: number, maxScore: number): number {
  return Number(Math.max(0.05, Math.min(0.99, score / maxScore)).toFixed(2));
}

function buildDismissOverlayPlan(
  detection: Awaited<ReturnType<typeof detectBlockingOverlays>>,
): DismissBlockingOverlaysResult["dismissPlan"] {
  const plan: DismissBlockingOverlaysResult["dismissPlan"] = [];
  const seenSteps = new Set<string>();

  for (const candidate of detection.candidates) {
    const hasStrongCloseSignal = candidate.scoreBreakdown.some(
      (item) =>
        item.reason === "close-word" ||
        item.reason === "close-class" ||
        item.reason === "top-right-icon-button" ||
        item.reason === "icon-close",
    );

    if (
      candidate.method === "close_candidate_click" &&
      hasStrongCloseSignal
    ) {
      const hotspotKey = `top_right_hotspot:${candidate.selector}`;
      if (!seenSteps.has(hotspotKey)) {
        seenSteps.add(hotspotKey);
        plan.push({
          method: "top_right_hotspot",
          confidence: toConfidence(Math.max(candidate.score, 24), 30),
          reasons: ["命中主弹窗右上角关闭位，优先按真人关闭路径尝试"],
          selector: candidate.selector,
          text: candidate.text,
          accessibleName: candidate.accessibleName,
        });
      }
    }

    const stepKey = `${candidate.method}:${candidate.selector}`;
    if (seenSteps.has(stepKey)) {
      continue;
    }
    seenSteps.add(stepKey);

    plan.push({
      method: candidate.method,
      confidence: toConfidence(candidate.score, 30),
      reasons:
        candidate.method === "top_right_hotspot"
          ? ["命中主弹窗右上角热点，优先按真人关闭路径尝试"]
          : ["命中明确关闭候选，作为右上角热点失败后的后备动作"],
      selector: candidate.selector,
      text: candidate.text,
      accessibleName: candidate.accessibleName,
    });
  }

  if (detection.primarySelector && detection.candidates.length === 0) {
    plan.push({
      method: "backdrop_click",
      confidence: 0.22,
      reasons: ["当前没有明确关闭按钮，先尝试点击弹窗外空白区域关闭提示层"],
      selector: detection.primarySelector,
    });
  }

  plan.push({
    method: "press_escape",
    confidence: 0.24,
    reasons: ["部分弹窗支持 Escape 关闭，作为通用键盘后备动作"],
    selector: "keyboard:Escape",
  });

  if (detection.primarySelector && detection.candidates.length > 0) {
    plan.push({
      method: "backdrop_click",
      confidence: 0.18,
      reasons: ["尝试点击主遮罩层空白区域，覆盖点击遮罩可关闭的场景"],
      selector: detection.primarySelector,
    });
  }

  return plan;
}

function mergeDismissPlan(
  basePlan: DismissBlockingOverlaysResult["dismissPlan"],
  nextPlan: DismissBlockingOverlaysResult["dismissPlan"],
): DismissBlockingOverlaysResult["dismissPlan"] {
  const merged = [...basePlan];
  const seen = new Set(
    merged.map((step) => `${step.method}:${step.selector ?? ""}`),
  );

  for (const step of nextPlan) {
    const key = `${step.method}:${step.selector ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(step);
  }

  return merged;
}

export async function dismissBlockingOverlaysWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    pageId?: string;
    timeoutMs?: number;
    maxSteps?: number;
  },
): Promise<DismissBlockingOverlaysResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const beforePage = await deps.summarizePage(resolvedPageId, page);
  const attempts: DismissBlockingOverlaysResult["attempts"] = [];
  const maxSteps = options.maxSteps ?? 3;
  const stepBudget = Math.max(1, maxSteps + 2);
  const clickTimeout = options.timeoutMs ?? deps.config.stepTimeoutMs;

  let detection = await detectBlockingOverlays(page);
  let totalCandidates = detection.candidates.length;
  let dismissPlan = buildDismissOverlayPlan(detection).slice(0, stepBudget);

  if (!detection.blocked) {
    return {
      page: beforePage,
      beforePageState: beforePage.pageState,
      afterPageState: beforePage.pageState,
      dismissed: false,
      dismissPlan,
      attempts,
      totalCandidates,
      note: "当前页面没有检测到可关闭的遮挡弹窗。",
    };
  }

  if (beforePage.pageState !== "overlay_blocking") {
    const note =
      beforePage.pageState === "auth_required"
        ? "当前页面是登录拦截层，不是可关闭的普通弹窗。"
        : "当前页面不是普通遮挡弹窗，而是其他阻塞状态。";
    return {
      page: beforePage,
      beforePageState: beforePage.pageState,
      afterPageState: beforePage.pageState,
      dismissed: false,
      dismissPlan,
      attempts,
      totalCandidates,
      note,
    };
  }

  let chosenMethod: DismissBlockingOverlaysResult["chosenMethod"];
  let chosenSelector: string | undefined;
  let currentPrimarySelector = detection.primarySelector;

  while (attempts.length < stepBudget) {
    const remainingBudget = stepBudget - attempts.length;
    const roundPlan = buildDismissOverlayPlan(detection).slice(0, remainingBudget);
    dismissPlan = mergeDismissPlan(dismissPlan, roundPlan);

    if (roundPlan.length === 0) {
      break;
    }

    let switchedToNextOverlay = false;

    for (const step of roundPlan) {
      try {
        if (step.method === "press_escape") {
          await page.keyboard.press("Escape");
        } else if (step.method === "backdrop_click") {
          const clickPoint = await page.$eval(
            step.selector ?? detection.primarySelector ?? "body",
            (element) => {
              const rect = (element as HTMLElement).getBoundingClientRect();
              const viewportWidth = window.innerWidth;
              const viewportHeight = window.innerHeight;
              const coversMostViewport =
                rect.width >= viewportWidth * 0.85 &&
                rect.height >= viewportHeight * 0.85;

              if (!coversMostViewport) {
                const outsideX =
                  rect.left >= 48
                    ? Math.max(8, rect.left - 24)
                    : Math.min(viewportWidth - 8, rect.right + 24);
                const outsideY =
                  rect.top >= 48
                    ? Math.max(8, rect.top - 24)
                    : Math.min(viewportHeight - 8, rect.bottom + 24);

                return {
                  x: outsideX,
                  y: outsideY,
                };
              }

              return {
                x: Math.max(rect.left + 8, 8),
                y: Math.max(rect.top + 8, 8),
              };
            },
          );
          await page.mouse.click(clickPoint.x, clickPoint.y);
        } else {
          await page
            .locator(step.selector ?? "")
            .setTimeout(clickTimeout)
            .click();
        }

        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(300, deps.config.actionSettleDelayMs)),
        );

        attempts.push({
          method: step.method,
          selector: step.selector ?? "keyboard:Escape",
          text: step.text,
          accessibleName: step.accessibleName,
          score: Math.round(step.confidence * 100),
          clicked: true,
        });

        detection = await detectBlockingOverlays(page);
        totalCandidates = Math.max(totalCandidates, detection.candidates.length);
        chosenMethod = step.method;
        chosenSelector = step.selector;

        if (!detection.blocked) {
          const afterPage = await deps.summarizePage(resolvedPageId, page);
          return {
            page: afterPage,
            beforePageState: beforePage.pageState,
            afterPageState: afterPage.pageState,
            dismissed: afterPage.pageState !== "auth_required",
            dismissPlan,
            chosenMethod,
            chosenSelector,
            attempts,
            totalCandidates,
            note:
              afterPage.pageState === "auth_required"
                ? "普通遮挡层已消失，但页面进入了登录拦截状态。"
                : undefined,
          };
        }

        if (detection.primarySelector !== currentPrimarySelector) {
          const afterPage = await deps.summarizePage(resolvedPageId, page);
          if (afterPage.pageState !== "overlay_blocking") {
            return {
              page: afterPage,
              beforePageState: beforePage.pageState,
              afterPageState: afterPage.pageState,
              dismissed: afterPage.pageState !== "auth_required",
              dismissPlan,
              chosenMethod,
              chosenSelector,
              attempts,
              totalCandidates,
              note:
                afterPage.pageState === "auth_required"
                  ? "普通遮挡层已切走，但当前页面进入了登录拦截状态。"
                  : undefined,
            };
          }

          currentPrimarySelector = detection.primarySelector;
          switchedToNextOverlay = true;
          break;
        }
      } catch (error) {
        attempts.push({
          method: step.method,
          selector: step.selector ?? "keyboard:Escape",
          text: step.text,
          accessibleName: step.accessibleName,
          score: Math.round(step.confidence * 100),
          clicked: false,
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (switchedToNextOverlay) {
      continue;
    }

    break;
  }

  const afterPage = await deps.summarizePage(resolvedPageId, page);
  return {
    page: afterPage,
    beforePageState: beforePage.pageState,
    afterPageState: afterPage.pageState,
    dismissed: false,
    dismissPlan,
    chosenMethod,
    chosenSelector,
    attempts,
    totalCandidates,
    note: "已经尝试关闭可疑遮挡弹窗，但页面仍然处于遮挡状态。",
  };
}
