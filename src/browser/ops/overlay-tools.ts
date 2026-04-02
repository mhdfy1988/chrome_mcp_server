import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import { detectBlockingOverlays } from "../core/blocking-overlays.js";
import type { DismissBlockingOverlaysResult } from "../core/types.js";

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
  const clickTimeout = options.timeoutMs ?? deps.config.stepTimeoutMs;

  let detection = await detectBlockingOverlays(page);
  const totalCandidates = detection.candidates.length;

  if (!detection.blocked) {
    return {
      page: beforePage,
      beforePageState: beforePage.pageState,
      afterPageState: beforePage.pageState,
      dismissed: false,
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
      attempts,
      totalCandidates,
      note,
    };
  }

  for (const candidate of detection.candidates.slice(0, maxSteps)) {
    try {
      await page
        .locator(candidate.selector)
        .setTimeout(clickTimeout)
        .click();

      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(300, deps.config.actionSettleDelayMs)),
      );

      attempts.push({
        selector: candidate.selector,
        text: candidate.text,
        accessibleName: candidate.accessibleName,
        score: candidate.score,
        clicked: true,
      });

      detection = await detectBlockingOverlays(page);
      if (!detection.blocked) {
        const afterPage = await deps.summarizePage(resolvedPageId, page);
        return {
          page: afterPage,
          beforePageState: beforePage.pageState,
          afterPageState: afterPage.pageState,
          dismissed: true,
          attempts,
          totalCandidates,
        };
      }
    } catch (error) {
      attempts.push({
        selector: candidate.selector,
        text: candidate.text,
        accessibleName: candidate.accessibleName,
        score: candidate.score,
        clicked: false,
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const afterPage = await deps.summarizePage(resolvedPageId, page);
  return {
    page: afterPage,
    beforePageState: beforePage.pageState,
    afterPageState: afterPage.pageState,
    dismissed: false,
    attempts,
    totalCandidates,
    note: "已经尝试关闭可疑遮挡弹窗，但页面仍然处于遮挡状态。",
  };
}
