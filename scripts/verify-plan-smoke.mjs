import path from "node:path";
import process from "node:process";
import { BrowserManager } from "../dist/browser-manager.js";

const repoRoot = process.cwd();
const toFileUrl = (filePath) => `file:///${filePath.replace(/\\/g, "/")}`;

const browserManager = new BrowserManager({
  channel: "chrome",
  headless: true,
  userDataDir: path.resolve(repoRoot, ".profiles/active/plan-smoke"),
  defaultTimeoutMs: 15000,
  navigationTimeoutMs: 30000,
  stepTimeoutMs: 6000,
  maxRetries: 0,
  retryBackoffMs: 1,
  actionSettleDelayMs: 0,
  followupWatchTimeoutMs: 800,
});

const report = {};

try {
  const overlayPage = await browserManager.openPage(
    toFileUrl(path.resolve(repoRoot, "tests/fixtures/realistic-overlay-fixture.html")),
  );
  const overlayResult = await browserManager.dismissBlockingOverlays({
    pageId: overlayPage.pageId,
    maxSteps: 5,
    timeoutMs: 4000,
  });
  report.overlay = {
    beforePageState: overlayResult.beforePageState,
    afterPageState: overlayResult.afterPageState,
    dismissed: overlayResult.dismissed,
    dismissPlan: overlayResult.dismissPlan,
    chosenMethod: overlayResult.chosenMethod,
    chosenSelector: overlayResult.chosenSelector,
    attempts: overlayResult.attempts,
  };

  const backdropPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/backdrop-only-overlay-fixture.html"),
    ),
  );
  const backdropResult = await browserManager.dismissBlockingOverlays({
    pageId: backdropPage.pageId,
    maxSteps: 5,
    timeoutMs: 4000,
  });
  report.backdropOverlay = {
    beforePageState: backdropResult.beforePageState,
    afterPageState: backdropResult.afterPageState,
    dismissed: backdropResult.dismissed,
    dismissPlan: backdropResult.dismissPlan,
    chosenMethod: backdropResult.chosenMethod,
    chosenSelector: backdropResult.chosenSelector,
    attempts: backdropResult.attempts,
  };

  const resultPage = await browserManager.openPage(
    toFileUrl(path.resolve(repoRoot, "tests/fixtures/result-plan-fixture.html")),
  );
  const primaryResults = await browserManager.findPrimaryResults({
    pageId: resultPage.pageId,
    query: "python",
    maxResults: 5,
  });
  report.results = {
    total: primaryResults.total,
    openResultPlan: primaryResults.openResultPlan,
    topResults: primaryResults.results.slice(0, 3).map((item) => ({
      text: item.text,
      selector: item.selector,
      openIntent: item.openIntent,
      ref: item.ref,
    })),
  };

  const mediaPage = await browserManager.openPage(
    toFileUrl(path.resolve(repoRoot, "tests/fixtures/media-plan-fixture.html")),
  );
  const mediaState = await browserManager.readMediaState({
    pageId: mediaPage.pageId,
    maxResults: 3,
  });
  report.media = {
    total: mediaState.total,
    playMediaPlan: mediaState.playMediaPlan,
    topMedia: mediaState.media.slice(0, 1).map((item) => ({
      selector: item.selector,
      paused: item.paused,
      visible: item.visible,
      isPrimary: item.isPrimary,
      ref: item.ref,
    })),
  };

  const checks = {
    overlayPlanExists:
      Array.isArray(overlayResult.dismissPlan) && overlayResult.dismissPlan.length > 0,
    overlayHasTopRightHotspot: overlayResult.dismissPlan.some(
      (step) => step.method === "top_right_hotspot",
    ),
    overlayDismissed:
      overlayResult.dismissed && overlayResult.afterPageState === "normal",
    backdropPlanExists:
      Array.isArray(backdropResult.dismissPlan) &&
      backdropResult.dismissPlan.length > 0,
    backdropPrefersBackdrop:
      backdropResult.dismissPlan[0]?.method === "backdrop_click",
    backdropDismissed:
      backdropResult.dismissed &&
      backdropResult.chosenMethod === "backdrop_click" &&
      backdropResult.afterPageState === "normal",
    resultPlanExists:
      Array.isArray(primaryResults.openResultPlan) &&
      primaryResults.openResultPlan.length > 0,
    resultPrefersTitle:
      primaryResults.openResultPlan[0]?.method === "title_link",
    mediaPlanExists:
      Array.isArray(mediaState.playMediaPlan) && mediaState.playMediaPlan.length > 0,
    mediaHasSurfaceStep: mediaState.playMediaPlan.some(
      (step) => step.method === "click_media_surface",
    ),
    mediaHasPlayButtonStep: mediaState.playMediaPlan.some(
      (step) => step.method === "click_play_button",
    ),
  };

  report.checks = checks;
  report.ok = Object.values(checks).every(Boolean);

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
} finally {
  await browserManager.closeBrowser().catch(() => {});
}
