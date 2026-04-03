import type { BrowserInspectionUsecaseDeps } from "../usecases/inspection-usecases.js";
import type { BrowserSession } from "./browser-session.js";
import type { BrowserInspectionDeps } from "./inspection-deps.js";
import type { BrowserRuntimeDeps } from "./runtime-deps.js";

export function createBrowserInspectionDeps(
  session: BrowserSession,
): BrowserInspectionDeps {
  return {
    defaultTimeoutMs: session.config.defaultTimeoutMs,
    resolvePage: (pageId) => session.resolvePage(pageId),
    requirePageId: (page) => session.requirePageId(page),
    summarizePage: (pageId, page) => session.summarizePage(pageId, page),
    resolveSelectorForRef: (pageId, ref) =>
      session.resolveSelectorForRef(pageId, ref),
    getBindingRecord: (pageId, ref) => session.getBindingRecord(pageId, ref),
  };
}

export function createBrowserInspectionUsecaseDeps(
  session: BrowserSession,
): BrowserInspectionUsecaseDeps {
  return {
    ...createBrowserInspectionDeps(session),
    attachElementRefs: (pageId, elements) =>
      session.attachElementRefs(pageId, elements),
  };
}

export function createBrowserRuntimeDeps(
  session: BrowserSession,
): BrowserRuntimeDeps {
  return {
    config: session.config,
    isManagedBrowser: () => session.isManagedBrowser(),
    ensureBrowser: (startIfNeeded) => session.ensureBrowser(startIfNeeded),
    syncPages: () => session.syncPages(),
    trackPage: (page) => session.trackPage(page),
    applyTimeouts: (page) => session.applyTimeouts(page),
    instrumentPage: (pageId, page) => session.instrumentPage(pageId, page),
    resolvePage: (pageId) => session.resolvePage(pageId),
    requirePageId: (page) => session.requirePageId(page),
    summarizePage: (pageId, page) => session.summarizePage(pageId, page),
    getCurrentPageId: () => session.getCurrentPageId(),
    setCurrentPageId: (pageId) => session.setCurrentPageId(pageId),
    getPages: () => session.getPages(),
    attachElementRefs: (pageId, elements) =>
      session.attachElementRefs(pageId, elements),
    resolveSelectorForRef: (pageId, ref) =>
      session.resolveSelectorForRef(pageId, ref),
    getBindingRecord: (pageId, ref) => session.getBindingRecord(pageId, ref),
  };
}
