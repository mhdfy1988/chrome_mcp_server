import util from "node:util";
import type { ElementHandle } from "puppeteer-core";
import type { BrowserInspectionDeps } from "../core/inspection-deps.js";
import type { PageSummary } from "../core/types.js";

export async function extractTextWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    maxLength: number;
  },
): Promise<{ page: PageSummary; text: string }> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const resolvedSelector = options.ref
    ? deps.resolveSelectorForRef(resolvedPageId, options.ref)
    : options.selector;

  let rawText = "";
  if (resolvedSelector) {
    const handle = await page.waitForSelector(resolvedSelector, {
      visible: true,
      timeout: deps.defaultTimeoutMs,
    });

    if (!handle) {
      throw new Error(`未找到元素: ${resolvedSelector}`);
    }

    rawText = await readTextFromHandle(handle);
    await handle.dispose();
  } else {
    rawText = await page.evaluate(() => document.body?.innerText ?? "");
  }

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    text: rawText.slice(0, options.maxLength),
  };
}

export async function evaluateWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    expression: string;
  },
): Promise<{ page: PageSummary; value: string }> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const value = await page.evaluate((expression) => {
    return globalThis.eval(expression);
  }, options.expression);

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    value: formatJsonish(value),
  };
}

async function readTextFromHandle(
  handle: ElementHandle<Element>,
): Promise<string> {
  return handle.evaluate((node) => {
    const element = node as HTMLElement;
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return String(element.value);
    }
    return element.innerText ?? element.textContent ?? "";
  });
}

function formatJsonish(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return util.inspect(value, {
      depth: 4,
      breakLength: 100,
      maxArrayLength: 50,
    });
  }
}

