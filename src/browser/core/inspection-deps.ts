import type { Page } from "puppeteer-core";
import type { PageSummary } from "./types.js";

export interface BrowserInspectionDeps {
  defaultTimeoutMs: number;
  resolvePage(pageId?: string): Promise<Page>;
  requirePageId(page: Page): string;
  summarizePage(pageId: string, page: Page): Promise<PageSummary>;
  resolveSelectorForRef(pageId: string, ref: string): string;
}
