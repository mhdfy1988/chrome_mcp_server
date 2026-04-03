import util from "node:util";
import type { ElementHandle } from "puppeteer-core";
import type { BrowserInspectionDeps } from "../session/inspection-deps.js";
import type { EvaluateResult, PageSummary } from "./types.js";

export async function extractTextWithInspection(
  deps: BrowserInspectionDeps,
  options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    mode?: "auto" | "main" | "article" | "body";
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
    rawText = await page.evaluate((mode) => {
      const pickRoot = () => {
        if (mode === "body") {
          return document.body;
        }

        if (mode === "article") {
          return (
            document.querySelector("article") ??
            document.querySelector("[itemprop='articleBody']") ??
            document.querySelector("main") ??
            document.querySelector("[role='main']") ??
            document.body
          );
        }

        if (mode === "main") {
          return (
            document.querySelector("main") ??
            document.querySelector("[role='main']") ??
            document.querySelector("#main") ??
            document.querySelector("#mainContent") ??
            document.querySelector("#content") ??
            document.body
          );
        }

        return (
          document.querySelector("article") ??
          document.querySelector("[itemprop='articleBody']") ??
          document.querySelector("main") ??
          document.querySelector("[role='main']") ??
          document.querySelector("#mainContent") ??
          document.querySelector("#content") ??
          document.body
        );
      };

      const root = pickRoot();
      return (root as HTMLElement | null)?.innerText ?? document.body?.innerText ?? "";
    }, options.mode ?? "auto");
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
): Promise<EvaluateResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const value = await page.evaluate((expression) => {
    return globalThis.eval(expression);
  }, options.expression);
  const jsonValueResult = toJsonValue(value);

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    value: formatJsonish(value),
    jsonValue: jsonValueResult.jsonValue,
    jsonValueError: jsonValueResult.jsonValueError,
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

function toJsonValue(
  value: unknown,
): { jsonValue?: unknown; jsonValueError?: string } {
  if (value === undefined) {
    return { jsonValueError: "value is undefined" };
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return { jsonValueError: "value is not JSON-serializable" };
    }

    return { jsonValue: JSON.parse(serialized) };
  } catch (error) {
    return {
      jsonValueError:
        error instanceof Error ? error.message : String(error),
    };
  }
}
