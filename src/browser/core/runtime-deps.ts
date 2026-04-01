import type { Browser, Page } from "puppeteer-core";
import type { ChromeConfig } from "../../config.js";
import type { PageSummary } from "./types.js";

export interface BrowserRuntimeDeps {
  config: ChromeConfig;
  isManagedBrowser(): boolean;
  ensureBrowser(startIfNeeded?: boolean): Promise<Browser | undefined>;
  syncPages(): Promise<void>;
  trackPage(page: Page): string;
  applyTimeouts(page: Page): void;
  instrumentPage(pageId: string, page: Page): Promise<void>;
  resolvePage(pageId?: string): Promise<Page>;
  requirePageId(page: Page): string;
  summarizePage(pageId: string, page: Page): Promise<PageSummary>;
  getCurrentPageId(): string | undefined;
  setCurrentPageId(pageId?: string): void;
  getPages(): Map<string, Page>;
  resolveSelectorForRef(pageId: string, ref: string): string;
}

