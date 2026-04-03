import type { Page } from "puppeteer-core";
import type { PageSummary } from "./types.js";
import { readPageState } from "./page-state.js";

export async function summarizePageState(options: {
  pageId: string;
  page: Page;
  isCurrent: boolean;
}): Promise<PageSummary> {
  const { pageId, page, isCurrent } = options;
  const title = await page.title().catch(() => "");
  const pageState = await readPageState(page);

  return {
    pageId,
    title,
    url: page.url(),
    isCurrent,
    pageState: pageState.pageState,
    verification: pageState.verification,
    overlay: pageState.overlay,
    authRequired: pageState.authRequired,
  };
}
