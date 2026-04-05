import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { BrowserManager } from "../browser-manager.js";
import { toolHandler, toolResultHandler } from "./shared.js";

export function registerArtifactTools(
  server: McpServer,
  browserManager: BrowserManager,
): void {
  server.registerTool(
    "screenshot",
    {
      description:
        "截图当前页面，或截图指定元素。优先传 page_snapshot / find_elements 返回的 ref；也支持 selector。返回图片内容，并可选保存到文件。",
      inputSchema: z
        .object({
          pageId: z.string().optional().describe("可选，指定页面 ID。"),
          ref: z
            .string()
            .min(1)
            .optional()
            .describe("可选，来自 page_snapshot 或 find_elements 的元素引用。"),
          selector: z
            .string()
            .optional()
            .describe("可选，只截取某个元素选择器。"),
          fullPage: z
            .boolean()
            .default(true)
            .describe("整页截图，仅在未指定 ref 或 selector 时生效。"),
          format: z.enum(["png", "jpeg"]).default("png").describe("图片格式。"),
          quality: z
            .number()
            .int()
            .min(0)
            .max(100)
            .optional()
            .describe("JPEG 质量，0 到 100。"),
          savePath: z
            .string()
            .optional()
            .describe("可选，把截图额外保存到本地文件。"),
        })
        .superRefine((value, context) => {
          if (value.ref && value.selector) {
            context.addIssue({
              code: "custom",
              message: "ref 和 selector 二选一，优先使用 ref。",
              path: ["ref"],
            });
          }
        }),
    },
    toolResultHandler(async ({ pageId, ref, selector, fullPage, format, quality, savePath }) => {
      const result = await browserManager.screenshot({
        pageId,
        ref,
        selector,
        fullPage,
        format,
        quality,
        savePath,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                page: result.page,
                mimeType: result.mimeType,
                savedPath: result.savedPath,
              },
              null,
              2,
            ),
          },
          {
            type: "image" as const,
            data: result.base64Data,
            mimeType: result.mimeType,
          },
        ],
      };
    }),
  );

  server.registerTool(
    "console_logs",
    {
      description: "查看页面最近的 console 日志。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .default(20)
          .describe("最多返回多少条日志。"),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    toolHandler(async ({ pageId, limit }) =>
      browserManager.getConsoleLogs(pageId, limit),
    ),
  );

  server.registerTool(
    "network_logs",
    {
      description: "查看页面最近的网络响应日志。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .default(20)
          .describe("最多返回多少条日志。"),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    toolHandler(async ({ pageId, limit }) =>
      browserManager.getNetworkLogs(pageId, limit),
    ),
  );
}
