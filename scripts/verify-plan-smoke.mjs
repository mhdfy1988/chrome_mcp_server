import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";
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

  const headerSearchPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/header-search-not-overlay-fixture.html"),
    ),
  );
  report.headerSearchNotOverlay = {
    pageState: headerSearchPage.pageState,
    title: headerSearchPage.title,
    url: headerSearchPage.url,
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

  const resultExecutionPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/result-plan-execution-fixture.html"),
    ),
  );
  const openResultExecution = await browserManager.openResultWithPlan({
    pageId: resultExecutionPage.pageId,
    query: "python",
    maxResults: 5,
    timeoutMs: 5000,
    contentReadySelector: "#target-content",
    contentReadyText: "RESULT_PLAN_TARGET",
  });
  report.openResultExecution = {
    chosenMethod: openResultExecution.chosenMethod,
    chosenSelector: openResultExecution.chosenSelector,
    page: {
      title: openResultExecution.page.title,
      url: openResultExecution.page.url,
      pageState: openResultExecution.page.pageState,
    },
    actionAttempt: openResultExecution.actionAttempt ?? null,
    pageSource: openResultExecution.pageSource,
    changeType: openResultExecution.changeType,
    successSignal: openResultExecution.successSignal,
    changed: openResultExecution.changed,
    contentReady: openResultExecution.contentReady,
    note: openResultExecution.note ?? null,
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

  const mediaExecutionPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/media-plan-execution-fixture.html"),
    ),
  );
  const mediaExecution = await browserManager.playMediaWithPlan({
    pageId: mediaExecutionPage.pageId,
    maxResults: 3,
    timeoutMs: 5000,
  });
  report.mediaExecution = {
    chosenMethod: mediaExecution.chosenMethod,
    chosenSelector: mediaExecution.chosenSelector,
    page: {
      title: mediaExecution.page.title,
      url: mediaExecution.page.url,
      pageState: mediaExecution.page.pageState,
    },
    actionAttempt: mediaExecution.actionAttempt ?? null,
    beforePrimaryPaused: mediaExecution.beforePrimaryPaused,
    beforePrimaryCurrentTime: mediaExecution.beforePrimaryCurrentTime,
    afterPrimaryPaused: mediaExecution.afterPrimaryPaused,
    afterPrimaryCurrentTime: mediaExecution.afterPrimaryCurrentTime,
    playbackChanged: mediaExecution.playbackChanged,
    playing: mediaExecution.playing,
    note: mediaExecution.note ?? null,
  };

  const clickWaitPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(
        repoRoot,
        "tests/fixtures/click-wait-statechange-home.html",
      ),
    ),
  );
  const clickWaitResult = await browserManager.clickAndWait({
    pageId: clickWaitPage.pageId,
    selector: "#go-target",
    timeoutMs: 4000,
    contentReadyText: "人工智能",
  });
  report.clickWaitStateChange = {
    title: clickWaitResult.page.title,
    url: clickWaitResult.page.url,
    pageState: clickWaitResult.page.pageState,
    pageSource: clickWaitResult.pageSource,
    changeType: clickWaitResult.changeType,
    successSignal: clickWaitResult.successSignal,
    changed: clickWaitResult.changed,
    observed: clickWaitResult.observed,
    contentReady: clickWaitResult.contentReady,
    contentReadySignal: clickWaitResult.contentReadySignal,
    note: clickWaitResult.note ?? null,
  };

  const refSelectorPage = await browserManager.openPage(
    toFileUrl(path.resolve(repoRoot, "tests/fixtures/ref-selector-fixture.html")),
  );
  const refSelectorMatch = await browserManager.findElements({
    pageId: refSelectorPage.pageId,
    query: "authors.yaml",
    matchMode: "exact",
    maxResults: 5,
    inspectLimit: 50,
  });
  const refSelectorClick = await browserManager.clickAndWait({
    pageId: refSelectorPage.pageId,
    ref: refSelectorMatch.elements[0]?.ref,
    waitForUrl: toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/ref-selector-authors-target.html"),
    ),
    matchMode: "exact",
    timeoutMs: 4000,
    contentReadyText: "authors target landing",
    contentReadyTextSelector: "p",
  });
  report.refSelector = {
    total: refSelectorMatch.total,
    match: refSelectorMatch.elements[0]
      ? {
          ref: refSelectorMatch.elements[0].ref,
          selector: refSelectorMatch.elements[0].selector,
          href: refSelectorMatch.elements[0].href,
        }
      : null,
    clickResult: {
      url: refSelectorClick.page.url,
      title: refSelectorClick.page.title,
      pageSource: refSelectorClick.pageSource,
      changeType: refSelectorClick.changeType,
      successSignal: refSelectorClick.successSignal,
      changed: refSelectorClick.changed,
      contentReady: refSelectorClick.contentReady,
      note: refSelectorClick.note ?? null,
    },
  };

  const rebindPage = await browserManager.openPage(
    toFileUrl(path.resolve(repoRoot, "tests/fixtures/rebind-target-fixture.html")),
  );
  const rebindMatch = await browserManager.findElements({
    pageId: rebindPage.pageId,
    query: "重新绑定按钮",
    matchMode: "exact",
    maxResults: 3,
    inspectLimit: 50,
  });
  await browserManager.waitFor({
    pageId: rebindPage.pageId,
    selector: "#new-bind-target",
    matchMode: "exact",
    timeoutMs: 3000,
  });
  const rebindClick = await browserManager.clickAndWait({
    pageId: rebindPage.pageId,
    ref: rebindMatch.elements[0]?.ref,
    timeoutMs: 4000,
    contentReadySelector: "#result",
    contentReadyText: "REBOUND_OK",
  });
  report.rebindTarget = {
    match: rebindMatch.elements[0]
      ? {
          ref: rebindMatch.elements[0].ref,
          selector: rebindMatch.elements[0].selector,
        }
      : null,
    clickResult: {
      changed: rebindClick.changed,
      contentReady: rebindClick.contentReady,
      preflight: rebindClick.preflight ?? null,
      actionAttempt: rebindClick.actionAttempt ?? null,
      note: rebindClick.note ?? null,
    },
  };

  const containerPrimaryPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(
        repoRoot,
        "tests/fixtures/container-primary-action-fixture.html",
      ),
    ),
  );
  const containerPrimaryClick = await browserManager.clickAndWait({
    pageId: containerPrimaryPage.pageId,
    selector: "#folder-row-authors",
    timeoutMs: 4000,
    contentReadySelector: "#result",
    contentReadyText: "FILE_TARGET_OK",
  });
  report.containerPrimaryAction = {
    clickResult: {
      url: containerPrimaryClick.page.url,
      changed: containerPrimaryClick.changed,
      contentReady: containerPrimaryClick.contentReady,
      preflight: containerPrimaryClick.preflight ?? null,
      actionAttempt: containerPrimaryClick.actionAttempt ?? null,
      note: containerPrimaryClick.note ?? null,
    },
  };

  const containerLeadingIconPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(
        repoRoot,
        "tests/fixtures/container-primary-action-leading-icon-fixture.html",
      ),
    ),
  );
  const containerLeadingIconClick = await browserManager.clickAndWait({
    pageId: containerLeadingIconPage.pageId,
    selector: "#folder-row-authors-leading-icon",
    timeoutMs: 4000,
    contentReadySelector: "#result",
    contentReadyText: "FILE_TARGET_OK",
  });
  report.containerPrimaryActionLeadingIcon = {
    clickResult: {
      url: containerLeadingIconClick.page.url,
      changed: containerLeadingIconClick.changed,
      contentReady: containerLeadingIconClick.contentReady,
      preflight: containerLeadingIconClick.preflight ?? null,
      actionAttempt: containerLeadingIconClick.actionAttempt ?? null,
      note: containerLeadingIconClick.note ?? null,
    },
  };

  const accessibilityPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/dom-accessibility-fixture.html"),
    ),
  );
  const labelMatch = await browserManager.findElements({
    pageId: accessibilityPage.pageId,
    query: "搜索关键词",
    matchMode: "exact",
    maxResults: 3,
    inspectLimit: 80,
  });
  const ariaMatch = await browserManager.findElements({
    pageId: accessibilityPage.pageId,
    query: "订阅邮件",
    matchMode: "exact",
    maxResults: 3,
    inspectLimit: 80,
  });
  const roleMatch = await browserManager.findElements({
    pageId: accessibilityPage.pageId,
    query: "自定义按钮",
    matchMode: "exact",
    maxResults: 3,
    inspectLimit: 80,
    role: "button",
  });
  report.domAccessibility = {
    labelMatch: labelMatch.elements[0]
      ? {
          selector: labelMatch.elements[0].selector,
          label: labelMatch.elements[0].label,
          accessibleName: labelMatch.elements[0].accessibleName,
          tag: labelMatch.elements[0].tag,
          role: labelMatch.elements[0].role,
          semanticRole: labelMatch.elements[0].semanticRole,
          matchReasons: labelMatch.elements[0].matchReasons,
        }
      : null,
    ariaMatch: ariaMatch.elements[0]
      ? {
          selector: ariaMatch.elements[0].selector,
          label: ariaMatch.elements[0].label,
          accessibleName: ariaMatch.elements[0].accessibleName,
          tag: ariaMatch.elements[0].tag,
          role: ariaMatch.elements[0].role,
          semanticRole: ariaMatch.elements[0].semanticRole,
          matchReasons: ariaMatch.elements[0].matchReasons,
        }
      : null,
    roleMatch: roleMatch.elements[0]
      ? {
          selector: roleMatch.elements[0].selector,
          label: roleMatch.elements[0].label,
          accessibleName: roleMatch.elements[0].accessibleName,
          tag: roleMatch.elements[0].tag,
          role: roleMatch.elements[0].role,
          semanticRole: roleMatch.elements[0].semanticRole,
          matchReasons: roleMatch.elements[0].matchReasons,
        }
      : null,
  };

  const submitPage = await browserManager.openPage(
    toFileUrl(path.resolve(repoRoot, "tests/fixtures/submit-attempt-fixture.html")),
  );
  const typeResult = await browserManager.typeText({
    pageId: submitPage.pageId,
    selector: "#query-input",
    text: "pytest",
    clear: true,
    submit: false,
  });
  const submitResult = await browserManager.submitWithPlan({
    pageId: submitPage.pageId,
    selector: "#query-input",
    timeoutMs: 5000,
    contentReadySelector: "#submit-result",
    contentReadyText: "已提交",
  });
  report.submitAttempt = {
    typeActionAttempt: typeResult.actionAttempt ?? null,
    submitStrategy: submitResult.chosenMethod ?? null,
    submitPlan: submitResult.submitPlan,
    submitActionAttempt: submitResult.actionAttempt ?? null,
    attempts: submitResult.attempts,
    pageState: submitResult.page.pageState,
  };

  const safeClickPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/safe-coordinate-click-fixture.html"),
    ),
  );
  const safeClickResult = await browserManager.clickAndWait({
    pageId: safeClickPage.pageId,
    selector: "#edge-click-target",
    timeoutMs: 5000,
    contentReadySelector: "#edge-click-result",
    contentReadyText: "SAFE_EDGE_OK",
  });
  report.safeCoordinateClick = {
    preflight: safeClickResult.preflight ?? null,
    actionAttempt: safeClickResult.actionAttempt ?? null,
    changed: safeClickResult.changed,
    contentReady: safeClickResult.contentReady,
    note: safeClickResult.note ?? null,
  };

  const blockedPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/blocked-hit-test-fixture.html"),
    ),
  );
  const blockedPreflight = await browserManager.resolveActionTargetPreflight({
    pageId: blockedPage.pageId,
    selector: "#blocked-target",
  });
  let blockedClickError = null;
  try {
    await browserManager.click({
      pageId: blockedPage.pageId,
      selector: "#blocked-target",
      timeoutMs: 4000,
    });
  } catch (error) {
    blockedClickError = error instanceof Error ? error.message : String(error);
  }
  report.blockedHitTest = {
    preflight: blockedPreflight.preflight,
    clickError: blockedClickError,
  };

  const externalBrowser = await puppeteer.launch({
    channel: "chrome",
    headless: true,
    defaultViewport: null,
    userDataDir: path.resolve(repoRoot, ".profiles/active/plan-smoke-external"),
  });
  try {
    const externalManager = new BrowserManager({
      channel: "chrome",
      browserWSEndpoint: externalBrowser.wsEndpoint(),
      headless: true,
      userDataDir: path.resolve(
        repoRoot,
        ".profiles/active/plan-smoke-external-manager",
      ),
      defaultTimeoutMs: 15000,
      navigationTimeoutMs: 30000,
      stepTimeoutMs: 6000,
      maxRetries: 0,
      retryBackoffMs: 1,
      actionSettleDelayMs: 0,
      followupWatchTimeoutMs: 800,
    });

    const externalStatusBefore = await externalManager.getStatus();
    const externalPage = await externalManager.openPage(
      toFileUrl(path.resolve(repoRoot, "tests/fixtures/dom-accessibility-fixture.html")),
    );
    let externalClosePageError = null;

    try {
      await externalManager.closePage(externalPage.pageId);
    } catch (error) {
      externalClosePageError = error instanceof Error ? error.message : String(error);
    }

    const externalCloseBrowserStatus = await externalManager.closeBrowser();
    let externalBrowserStillAlive = false;

    try {
      await externalBrowser.version();
      externalBrowserStillAlive = true;
    } catch {
      externalBrowserStillAlive = false;
    }

    report.externalBrowserSafety = {
      statusBefore: {
        browserMode: externalStatusBefore.browserMode,
        safetyPolicy: externalStatusBefore.safetyPolicy,
      },
      closePageError: externalClosePageError,
      closeBrowserStatus: {
        connected: externalCloseBrowserStatus.connected,
        note: externalCloseBrowserStatus.note ?? null,
      },
      externalBrowserStillAlive,
    };
  } finally {
    await externalBrowser.close().catch(() => {});
  }

  const typeFocusPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/type-focus-shift-fixture.html"),
    ),
  );
  const typeFocusResult = await browserManager.typeText({
    pageId: typeFocusPage.pageId,
    selector: "#primary-input",
    text: "focus-shift",
    clear: false,
    submit: false,
  });
  report.typeFocusShift = {
    actionAttempt: typeFocusResult.actionAttempt ?? null,
    pageState: typeFocusResult.pageState,
  };

  const pressKeyPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/press-key-focus-shift-fixture.html"),
    ),
  );
  const pressKeyResult = await browserManager.pressKey("Tab", pressKeyPage.pageId);
  report.pressKeyFocusShift = {
    actionAttempt: pressKeyResult.actionAttempt ?? null,
    pageState: pressKeyResult.pageState,
  };

  const rewrittenPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/type-value-rewritten-fixture.html"),
    ),
  );
  let rewrittenError = null;
  try {
    await browserManager.typeText({
      pageId: rewrittenPage.pageId,
      selector: "#rewrite-input",
      text: "rewrite",
      clear: false,
      submit: false,
    });
  } catch (error) {
    rewrittenError = error instanceof Error ? error.message : String(error);
  }
  report.typeValueRewritten = {
    error: rewrittenError,
  };

  const rejectedPage = await browserManager.openPage(
    toFileUrl(
      path.resolve(repoRoot, "tests/fixtures/type-value-rejected-fixture.html"),
    ),
  );
  let rejectedError = null;
  try {
    await browserManager.typeText({
      pageId: rejectedPage.pageId,
      selector: "#reject-input",
      text: "reject",
      clear: false,
      submit: false,
    });
  } catch (error) {
    rejectedError = error instanceof Error ? error.message : String(error);
  }
  report.typeValueRejected = {
    error: rejectedError,
  };

  const checks = {
    overlayPlanExists:
      Array.isArray(overlayResult.dismissPlan) && overlayResult.dismissPlan.length > 0,
    overlayHasTopRightHotspot: overlayResult.dismissPlan.some(
      (step) => step.method === "top_right_hotspot",
    ),
    overlayPlanHasTargetRef: overlayResult.dismissPlan.some(
      (step) =>
        (step.method === "top_right_hotspot" ||
          step.method === "close_candidate_click" ||
          step.method === "backdrop_click") &&
        typeof step.target?.ref === "string" &&
        step.target.ref.length > 0 &&
        typeof step.target?.fingerprint === "string" &&
        step.target.fingerprint.length > 0,
    ),
    overlayDismissed:
      overlayResult.dismissed && overlayResult.afterPageState === "normal",
    backdropPlanExists:
      Array.isArray(backdropResult.dismissPlan) &&
      backdropResult.dismissPlan.length > 0,
    backdropPlanHasTargetRef:
      typeof backdropResult.dismissPlan[0]?.target?.ref === "string" &&
      backdropResult.dismissPlan[0].target.ref.length > 0 &&
      typeof backdropResult.dismissPlan[0]?.target?.fingerprint === "string" &&
      backdropResult.dismissPlan[0].target.fingerprint.length > 0,
    backdropPrefersBackdrop:
      backdropResult.dismissPlan[0]?.method === "backdrop_click",
    backdropDismissed:
      backdropResult.dismissed &&
      backdropResult.chosenMethod === "backdrop_click" &&
      backdropResult.afterPageState === "normal",
    headerSearchNotOverlay:
      headerSearchPage.pageState === "normal" &&
      headerSearchPage.title === "Header Search Not Overlay Fixture",
    resultPlanExists:
      Array.isArray(primaryResults.openResultPlan) &&
      primaryResults.openResultPlan.length > 0,
    resultPrefersTitle:
      primaryResults.openResultPlan[0]?.method === "title_link",
    resultPlanHasTargetRef:
      primaryResults.openResultPlan.some(
        (step) =>
          typeof step.target?.ref === "string" &&
          step.target.ref.length > 0 &&
          typeof step.target?.fingerprint === "string" &&
          step.target.fingerprint.length > 0,
      ),
    openResultPlanExecutionPassed:
      openResultExecution.chosenMethod === "title_link" &&
      openResultExecution.changed &&
      openResultExecution.contentReady &&
      openResultExecution.page.url.includes("result-plan-target.html"),
    openResultPlanExecutionTargetFirst:
      typeof openResultExecution.actionAttempt?.selector === "string" &&
      openResultExecution.actionAttempt.selector ===
        openResultExecution.chosenSelector &&
      openResultExecution.pageSource === "current",
    mediaPlanExists:
      Array.isArray(mediaState.playMediaPlan) && mediaState.playMediaPlan.length > 0,
    mediaHasSurfaceStep: mediaState.playMediaPlan.some(
      (step) => step.method === "click_media_surface",
    ),
    mediaPlanHasTargetRef:
      mediaState.playMediaPlan.some(
        (step) =>
          (step.method === "already_playing" ||
            step.method === "click_media_surface") &&
          typeof step.target?.ref === "string" &&
          step.target.ref.length > 0 &&
          typeof step.target?.fingerprint === "string" &&
          step.target.fingerprint.length > 0,
      ),
    mediaPlayButtonHasTargetRef:
      mediaState.playMediaPlan.some(
        (step) =>
          step.method === "click_play_button" &&
          typeof step.target?.ref === "string" &&
          step.target.ref.length > 0 &&
          typeof step.target?.fingerprint === "string" &&
          step.target.fingerprint.length > 0,
      ),
    mediaHasPlayButtonStep: mediaState.playMediaPlan.some(
      (step) => step.method === "click_play_button",
    ),
    mediaPlanExecutionPassed:
      mediaExecution.chosenMethod === "click_media_surface" &&
      mediaExecution.playing === true &&
      mediaExecution.afterPrimaryPaused === false &&
      typeof mediaExecution.afterPrimaryCurrentTime === "number" &&
      mediaExecution.afterPrimaryCurrentTime > 0,
    mediaPlanExecutionTargetFirst:
      typeof mediaExecution.actionAttempt?.selector === "string" &&
      mediaExecution.actionAttempt.selector === mediaExecution.chosenSelector,
    clickWaitStateChangePassed:
      clickWaitResult.changed &&
      clickWaitResult.contentReady &&
      clickWaitResult.page.url.includes("click-wait-statechange-target.html"),
    clickWaitStateChangeNoRetry:
      clickWaitResult.note == null ||
      !clickWaitResult.note.includes("已重试"),
    refSelectorFound:
      refSelectorMatch.total >= 1 && refSelectorMatch.elements[0]?.text === "authors.yaml",
    refSelectorUsesSpecificSelector:
      typeof report.refSelector.match?.selector === "string" &&
      (report.refSelector.match.selector.includes("#folder-row-2") ||
        report.refSelector.match.selector.includes("[href=") ||
        report.refSelector.match.selector.includes("[aria-label=")),
    refSelectorClickPassed:
      refSelectorClick.changed &&
      refSelectorClick.contentReady &&
      refSelectorClick.page.url.includes("ref-selector-authors-target.html"),
    rebindRefFound: rebindMatch.total >= 1,
    rebindResolvedByRuntime:
      rebindClick.preflight?.selectorRebound === true &&
      rebindClick.preflight?.selectorResolvedBy === "runtime_node_key" &&
      rebindClick.preflight?.selector === "#new-bind-target",
    rebindClickPassed:
      rebindClick.changed &&
      rebindClick.contentReady &&
      rebindClick.actionAttempt?.selector === "#new-bind-target",
    containerPrimaryActionDescended:
      containerPrimaryClick.preflight?.descendedToActionTarget === true &&
      containerPrimaryClick.preflight?.containerSelector ===
        "#folder-row-authors" &&
      containerPrimaryClick.preflight?.selector === "#authors-link",
    containerPrimaryActionPassed:
      containerPrimaryClick.changed &&
      containerPrimaryClick.contentReady &&
      containerPrimaryClick.page.url.includes(
        "container-primary-action-file-target.html",
      ) &&
      containerPrimaryClick.actionAttempt?.selector === "#authors-link",
    containerLeadingIconDescended:
      containerLeadingIconClick.preflight?.descendedToActionTarget === true &&
      containerLeadingIconClick.preflight?.containerSelector ===
        "#folder-row-authors-leading-icon" &&
      containerLeadingIconClick.preflight?.selector ===
        "#authors-link-leading-icon",
    containerLeadingIconPassed:
      containerLeadingIconClick.changed &&
      containerLeadingIconClick.contentReady &&
      containerLeadingIconClick.page.url.includes(
        "container-primary-action-file-target.html",
      ) &&
      containerLeadingIconClick.actionAttempt?.selector ===
        "#authors-link-leading-icon",
    accessibilityLabelFound:
      labelMatch.total >= 1 &&
      (labelMatch.elements[0]?.label === "搜索关键词" ||
        labelMatch.elements[0]?.accessibleName === "搜索关键词"),
    accessibilityAriaFound:
      ariaMatch.total >= 1 &&
      (ariaMatch.elements[0]?.accessibleName === "订阅邮件" ||
        ariaMatch.elements[0]?.label === "订阅邮件"),
    accessibilityRoleFound:
      roleMatch.total >= 1 &&
      (roleMatch.elements[0]?.role === "button" ||
        roleMatch.elements[0]?.semanticRole === "button"),
    submitAttemptRecorded:
      submitResult.attempts.length > 0 &&
      Boolean(submitResult.actionAttempt?.submitTargetSelector),
    submitPlanHasTargetRef:
      submitResult.submitPlan.some(
        (step) =>
          step.method === "click" &&
          typeof step.target?.ref === "string" &&
          step.target.ref.length > 0 &&
          typeof step.target?.fingerprint === "string" &&
          step.target.fingerprint.length > 0,
      ),
    submitFormSelectorRecorded: Boolean(
      submitResult.actionAttempt?.formSelector,
    ),
    clickAttemptHasEvidence:
      Boolean(clickWaitResult.actionAttempt?.topElementAtPoint) &&
      typeof clickWaitResult.actionAttempt?.preflightHitTarget === "boolean",
    safeCoordinateFallbackUsed:
      safeClickResult.actionAttempt?.strategy === "safe_coordinate_click" &&
      safeClickResult.actionAttempt?.fallbackUsed === true &&
      Boolean(safeClickResult.actionAttempt?.clickedPoint),
    safeCoordinateContentReady:
      safeClickResult.changed && safeClickResult.contentReady,
    blockedHitTestDetected:
      blockedPreflight.preflight.hitTarget === false &&
      Boolean(blockedPreflight.preflight.blockedBySelector) &&
      blockedPreflight.preflight.fallbackClickable === false,
    blockedClickRejected:
      typeof blockedClickError === "string" &&
      blockedClickError.includes("目标点击预检失败"),
    externalBrowserOwnershipDetected:
      report.externalBrowserSafety?.statusBefore?.browserMode === "connect_ws_endpoint" &&
      report.externalBrowserSafety?.statusBefore?.safetyPolicy?.browserOwnership ===
        "external",
    externalClosePageBlocked:
      typeof report.externalBrowserSafety?.closePageError === "string" &&
      report.externalBrowserSafety.closePageError.includes(
        "close_page 已被安全策略阻止",
      ),
    externalCloseBrowserDisconnectOnly:
      report.externalBrowserSafety?.closeBrowserStatus?.connected === false &&
      report.externalBrowserSafety?.externalBrowserStillAlive === true,
    typeFocusShiftDetected:
      typeFocusResult.actionAttempt?.valueVerified === true &&
      typeFocusResult.actionAttempt?.activeElementMatched === false &&
      typeFocusResult.actionAttempt?.focusChanged === true,
    pressKeyFocusShiftDetected:
      pressKeyResult.actionAttempt?.strategy === "keyboard_press" &&
      pressKeyResult.actionAttempt?.focusChanged === true,
    rewrittenValueDetected:
      typeof rewrittenError === "string" &&
      rewrittenError.includes("actual=REWRITE") &&
      rewrittenError.includes("valueVerified=false"),
    rejectedValueDetected:
      typeof rejectedError === "string" &&
      rewrittenError !== rejectedError &&
      rejectedError.includes("actual=") &&
      rejectedError.includes("valueVerified=false"),
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
