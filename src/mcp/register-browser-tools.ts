import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { BrowserManager } from "../browser-manager.js";
import { toolHandler } from "./shared.js";

export function registerBrowserTools(
  server: McpServer,
  browserManager: BrowserManager,
): void {
  server.registerTool(
    "browser_status",
    {
      description: "查看当前浏览器连接状态、页面列表和运行模式。",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    toolHandler(async () => browserManager.getStatus()),
  );

  server.registerTool(
    "list_pages",
    {
      description: "列出当前浏览器里已打开的页面。",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    toolHandler(async () => browserManager.listPages()),
  );

  server.registerTool(
    "open_page",
    {
      description: "打开一个新页面，可选直接导航到指定 URL。",
      inputSchema: z.object({
        url: z.url().optional().describe("可选，要直接打开的 URL。"),
      }),
    },
    toolHandler(async ({ url }) => browserManager.openPage(url)),
  );

  server.registerTool(
    "select_page",
    {
      description: "切换当前活动页面。",
      inputSchema: z.object({
        pageId: z.string().min(1).describe("要切换到的页面 ID。"),
      }),
    },
    toolHandler(async ({ pageId }) => browserManager.selectPage(pageId)),
  );

  server.registerTool(
    "close_page",
    {
      description: "关闭当前页面或指定页面。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    toolHandler(async ({ pageId }) => browserManager.closePage(pageId)),
  );

  server.registerTool(
    "close_browser",
    {
      description: "关闭整个浏览器进程并清空当前会话状态。",
      annotations: {
        destructiveHint: true,
      },
    },
    toolHandler(async () => browserManager.closeBrowser()),
  );
}
