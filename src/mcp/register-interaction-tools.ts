import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { WaitUntilMode } from "../config.js";
import type { ToolMode } from "../config.js";
import { BrowserManager } from "../browser-manager.js";
import { textResult, waitMatchModeSchema, waitUntilSchema } from "./shared.js";

export function registerInteractionTools(
  server: McpServer,
  browserManager: BrowserManager,
  options: {
    toolMode: ToolMode;
  },
): void {
  server.registerTool(
    "click",
    {
      description:
        "模拟用户点击页面中的明确元素。优先传快照或查找结果里的 ref；也支持 locator 风格的 selector。",
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
            .min(1)
            .optional()
            .describe("可选，元素选择器。支持 Puppeteer locator 语法。"),
          timeoutMs: z
            .number()
            .int()
            .positive()
            .max(120000)
            .optional()
            .describe("可选，自定义等待超时。"),
        })
        .superRefine((value, context) => {
          if (!value.ref && !value.selector) {
            context.addIssue({
              code: "custom",
              message: "ref 和 selector 至少要提供一个。",
              path: ["ref"],
            });
          }
        }),
    },
    async ({ pageId, ref, selector, timeoutMs }) =>
      textResult(
        await browserManager.click({
          pageId,
          ref,
          selector,
          timeoutMs,
        }),
      ),
  );

  server.registerTool(
    "click_and_wait",
    {
      description:
        "模拟用户点击明确按钮、链接或标签，并在点击前注册等待条件。优先传 ref；也支持 locator 风格的 selector。",
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
            .min(1)
            .optional()
            .describe("可选，要点击的元素选择器。"),
          timeoutMs: z
            .number()
            .int()
            .positive()
            .max(120000)
            .optional()
            .describe("等待和点击共用的超时时间。"),
          waitForNavigation: z
            .boolean()
            .default(true)
            .describe("是否在点击前先注册导航等待。"),
          waitUntil: waitUntilSchema
            .default("domcontentloaded")
            .describe("导航等待条件。"),
          waitForSelector: z
            .string()
            .optional()
            .describe("可选，点击后等待某个选择器出现。"),
          waitForTitle: z
            .string()
            .optional()
            .describe("可选，点击后等待标题满足条件。"),
          waitForUrl: z
            .string()
            .optional()
            .describe("可选，点击后等待 URL 满足条件。"),
          matchMode: waitMatchModeSchema
            .default("contains")
            .describe("标题和 URL 的匹配方式，支持 contains 或 exact。"),
        })
        .superRefine((value, context) => {
          if (!value.ref && !value.selector) {
            context.addIssue({
              code: "custom",
              message: "ref 和 selector 至少要提供一个。",
              path: ["ref"],
            });
          }
        }),
    },
    async ({
      pageId,
      ref,
      selector,
      timeoutMs,
      waitForNavigation,
      waitUntil,
      waitForSelector,
      waitForTitle,
      waitForUrl,
      matchMode,
    }) =>
      textResult(
        await browserManager.clickAndWait({
          pageId,
          ref,
          selector,
          timeoutMs,
          waitForNavigation,
          waitUntil: waitUntil as WaitUntilMode,
          waitForSelector,
          waitForTitle,
          waitForUrl,
          matchMode,
        }),
      ),
  );

  server.registerTool(
    "type_text",
    {
      description:
        "模拟用户向输入框或可编辑元素输入文本。优先传 ref；也支持 locator 风格的 selector。",
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
            .min(1)
            .optional()
            .describe("可选，输入目标的元素选择器。"),
          text: z.string().describe("要输入的文本。"),
          clear: z
            .boolean()
            .default(true)
            .describe("输入前是否清空已有内容，默认 true。"),
          submit: z
            .boolean()
            .default(false)
            .describe("输入后是否自动按 Enter，默认 false。"),
          timeoutMs: z
            .number()
            .int()
            .positive()
            .max(120000)
            .optional()
            .describe("可选，自定义等待超时。"),
        })
        .superRefine((value, context) => {
          if (!value.ref && !value.selector) {
            context.addIssue({
              code: "custom",
              message: "ref 和 selector 至少要提供一个。",
              path: ["ref"],
            });
          }
        }),
    },
    async ({ pageId, ref, selector, text, clear, submit, timeoutMs }) =>
      textResult(
        await browserManager.typeText({
          pageId,
          ref,
          selector,
          text,
          clear,
          submit,
          timeoutMs,
        }),
      ),
  );

  server.registerTool(
    "press_key",
    {
      description: "向当前页面发送一个键盘按键，例如 Enter、Tab、Escape。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        key: z.string().min(1).describe("按键名称。"),
      }),
    },
    async ({ pageId, key }) =>
      textResult(await browserManager.pressKey(key, pageId)),
  );

  if (options.toolMode === "advanced") {
    server.registerTool(
      "submit_input",
      {
        description:
          "兜底工具。对指定输入框尝试提交，按 Enter、form.requestSubmit、form.submit、邻近按钮点击的顺序依次验证。只有页面没有明确提交按钮，或需要排查表单提交流程时再用。",
        inputSchema: z.object({
          pageId: z.string().optional().describe("可选，指定页面 ID。"),
          selector: z.string().min(1).describe("要提交的输入框 CSS 选择器。"),
          timeoutMs: z
            .number()
            .int()
            .positive()
            .max(120000)
            .optional()
            .describe("等待输入框可见的超时时间。"),
        }),
      },
      async ({ pageId, selector, timeoutMs }) =>
        textResult(
          await browserManager.submitInput({
            pageId,
            selector,
            timeoutMs,
          }),
        ),
    );
  }
}
