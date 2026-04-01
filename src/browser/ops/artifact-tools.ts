import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserRuntimeDeps } from "../core/runtime-deps.js";
import type { ScreenshotResult } from "../core/types.js";

export async function screenshotWithRuntime(
  deps: BrowserRuntimeDeps,
  options: {
    pageId?: string;
    ref?: string;
    selector?: string;
    fullPage: boolean;
    format: "png" | "jpeg";
    quality?: number;
    savePath?: string;
  },
): Promise<ScreenshotResult> {
  const page = await deps.resolvePage(options.pageId);
  const resolvedPageId = deps.requirePageId(page);
  const resolvedSelector = options.ref
    ? deps.resolveSelectorForRef(resolvedPageId, options.ref)
    : options.selector;
  const baseOptions = {
    type: options.format,
    quality: options.format === "jpeg" ? options.quality : undefined,
  } as const;

  let imageBuffer: Uint8Array;
  if (resolvedSelector) {
    const handle = await page.waitForSelector(resolvedSelector, {
      visible: true,
      timeout: deps.config.defaultTimeoutMs,
    });

    if (!handle) {
      throw new Error(`未找到要截图的元素: ${resolvedSelector}`);
    }

    imageBuffer = (await handle.screenshot(baseOptions)) as Uint8Array;
    await handle.dispose();
  } else {
    imageBuffer = (await page.screenshot({
      ...baseOptions,
      fullPage: options.fullPage,
    })) as Uint8Array;
  }

  let savedPath: string | undefined;
  if (options.savePath) {
    savedPath = path.resolve(options.savePath);
    await fs.mkdir(path.dirname(savedPath), { recursive: true });
    await fs.writeFile(savedPath, imageBuffer);
  }

  return {
    page: await deps.summarizePage(resolvedPageId, page),
    mimeType: options.format === "png" ? "image/png" : "image/jpeg",
    base64Data: Buffer.from(imageBuffer).toString("base64"),
    savedPath,
  };
}

