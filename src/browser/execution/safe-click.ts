import type { Page } from "puppeteer-core";
import type {
  ActionAttemptSummary,
  TargetPreflightSummary,
} from "./types.js";

export async function clickResolvedTarget(
  page: Page,
  options: {
    selector: string;
    timeoutMs: number;
    preflight: TargetPreflightSummary;
  },
): Promise<{
  actionAttempt: ActionAttemptSummary;
}> {
  if (!options.preflight.hitTarget) {
    if (canFallbackToCoordinateClick(options.preflight)) {
      const clickPoint = options.preflight.clickPoint;
      if (!clickPoint) {
        throw new Error("目标点击预检失败：缺少安全点击点。");
      }

      await page.mouse.click(clickPoint.x, clickPoint.y);
      return {
        actionAttempt: {
          kind: "click",
          selector: options.selector,
          strategy: "safe_coordinate_click",
          fallbackUsed: true,
          preflightHitTarget: options.preflight.hitTarget,
          topElementAtPoint: options.preflight.topElementSelector,
          blockedBy: options.preflight.blockedBySelector,
          clickedPoint: clickPoint,
        },
      };
    }

    if (options.preflight.allowSemanticClickFallback) {
      try {
        await page
          .locator(options.selector)
          .setTimeout(options.timeoutMs)
          .click();
        return {
          actionAttempt: {
            kind: "click",
            selector: options.selector,
            strategy: "semantic_click",
            fallbackUsed: true,
            preflightHitTarget: options.preflight.hitTarget,
            topElementAtPoint: options.preflight.topElementSelector,
            blockedBy: options.preflight.blockedBySelector,
          },
        };
      } catch {
        throw new Error(
          buildPreflightErrorMessage(options.preflight, {
            semanticFallbackAttempted: true,
          }),
        );
      }
    }

    throw new Error(buildPreflightErrorMessage(options.preflight));
  }

  try {
    await page
      .locator(options.selector)
      .setTimeout(options.timeoutMs)
      .click();
    return {
      actionAttempt: {
        kind: "click",
        selector: options.selector,
        strategy: "semantic_click",
        fallbackUsed: false,
        preflightHitTarget: options.preflight.hitTarget,
        topElementAtPoint: options.preflight.topElementSelector,
        blockedBy: options.preflight.blockedBySelector,
      },
    };
  } catch (error) {
    if (!canFallbackToCoordinateClick(options.preflight)) {
      throw error;
    }

    const clickPoint = options.preflight.clickPoint;
    if (!clickPoint) {
      throw error;
    }

    await page.mouse.click(clickPoint.x, clickPoint.y);
    return {
      actionAttempt: {
        kind: "click",
        selector: options.selector,
        strategy: "safe_coordinate_click",
        fallbackUsed: true,
        preflightHitTarget: options.preflight.hitTarget,
        topElementAtPoint: options.preflight.topElementSelector,
        blockedBy: options.preflight.blockedBySelector,
        clickedPoint: clickPoint,
      },
    };
  }
}

function canFallbackToCoordinateClick(
  preflight: TargetPreflightSummary,
): boolean {
  return (
    preflight.exists &&
    preflight.visible &&
    preflight.inViewport &&
    !preflight.hitTarget &&
    preflight.fallbackClickable &&
    Boolean(preflight.clickPoint)
  );
}

function buildPreflightErrorMessage(
  preflight: TargetPreflightSummary,
  options: {
    semanticFallbackAttempted?: boolean;
  } = {},
): string {
  const detailParts = [
    preflight.blockedBySelector
      ? `当前命中 ${preflight.blockedBySelector}`
      : undefined,
    preflight.stackContainsTarget === true ? "命中栈中仍包含目标" : undefined,
    options.semanticFallbackAttempted ? "已尝试语义点击仍失败" : undefined,
  ].filter(Boolean);

  return `目标点击预检失败：点击点未命中目标${detailParts.length > 0 ? `，${detailParts.join("，")}` : ""}。`;
}
