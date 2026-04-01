import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { WaitUntilMode } from "../config.js";
import { BrowserManager } from "../browser-manager.js";
import { textResult, waitMatchModeSchema, waitUntilSchema } from "./shared.js";

export function registerNavigationTools(
  server: McpServer,
  browserManager: BrowserManager,
): void {
  server.registerTool(
    "navigate",
    {
      description: "在当前页面或指定页面里导航到 URL。",
      inputSchema: z.object({
        url: z.url().describe("目标 URL。"),
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        waitUntil: waitUntilSchema
          .default("domcontentloaded")
          .describe("导航等待条件。"),
      }),
    },
    async ({ url, pageId, waitUntil }) =>
      textResult(
        await browserManager.navigate(url, pageId, waitUntil as WaitUntilMode),
      ),
  );

  server.registerTool(
    "go_back",
    {
      description: "让当前页面或指定页面后退一页。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        waitUntil: waitUntilSchema
          .default("domcontentloaded")
          .describe("导航等待条件。"),
      }),
    },
    async ({ pageId, waitUntil }) =>
      textResult(
        await browserManager.goBack(pageId, waitUntil as WaitUntilMode),
      ),
  );

  server.registerTool(
    "reload_page",
    {
      description: "刷新当前页面或指定页面。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        waitUntil: waitUntilSchema
          .default("domcontentloaded")
          .describe("导航等待条件。"),
      }),
    },
    async ({ pageId, waitUntil }) =>
      textResult(
        await browserManager.reloadPage(pageId, waitUntil as WaitUntilMode),
      ),
  );

  server.registerTool(
    "wait_for",
    {
      description:
        "辅助等待工具。等待页面元素、文本、标题或 URL 满足条件，适合在导航后或点击后等待页面进入稳定状态，不替代明确的点击和输入动作。",
      inputSchema: z
        .object({
          pageId: z.string().optional().describe("可选，指定页面 ID。"),
          selector: z
            .string()
            .optional()
            .describe("可选，要等待出现的 CSS 选择器。"),
          text: z.string().optional().describe("可选，要等待出现的文本。"),
          textSelector: z
            .string()
            .optional()
            .describe("可选，只在某个 CSS 选择器范围内等待文本出现。"),
          title: z.string().optional().describe("可选，等待页面标题匹配。"),
          url: z.string().optional().describe("可选，等待当前页面 URL 匹配。"),
          matchMode: waitMatchModeSchema
            .default("contains")
            .describe("匹配方式，支持 contains 或 exact。"),
          timeoutMs: z
            .number()
            .int()
            .positive()
            .max(120000)
            .optional()
            .describe("可选，等待超时，单位毫秒；默认跟随全局 stepTimeoutMs。"),
        })
        .superRefine((value, context) => {
          if (
            !value.selector &&
            !value.text &&
            !value.title &&
            !value.url
          ) {
            context.addIssue({
              code: "custom",
              message: "selector、text、title、url 至少要提供一个。",
              path: ["selector"],
            });
          }

          if (value.textSelector && !value.text) {
            context.addIssue({
              code: "custom",
              message: "textSelector 需要和 text 一起使用。",
              path: ["textSelector"],
            });
          }
        }),
    },
    async ({ pageId, selector, text, textSelector, title, url, matchMode, timeoutMs }) =>
      textResult(
        await browserManager.waitFor({
          pageId,
          selector,
          text,
          textSelector,
          title,
          url,
          matchMode,
          timeoutMs,
        }),
      ),
  );
}
