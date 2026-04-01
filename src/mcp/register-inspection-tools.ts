import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { BrowserManager } from "../browser-manager.js";
import type { ToolMode } from "../config.js";
import { textResult, waitMatchModeSchema } from "./shared.js";

export function registerInspectionTools(
  server: McpServer,
  browserManager: BrowserManager,
  options: {
    toolMode: ToolMode;
  },
): void {
  server.registerTool(
    "extract_text",
    {
      description:
        "提取当前页面或指定元素的文本内容。优先传 page_snapshot / find_elements 返回的 ref；也支持 selector。",
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
            .describe("可选，只提取某个元素选择器对应的文本。"),
          maxLength: z
            .number()
            .int()
            .positive()
            .max(200000)
            .default(5000)
            .describe("文本最大返回长度。"),
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
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ pageId, ref, selector, maxLength }) =>
      textResult(
        await browserManager.extractText({
          pageId,
          ref,
          selector,
          maxLength,
        }),
      ),
  );

  server.registerTool(
    "page_snapshot",
    {
      description:
        "提取当前页面的结构化快照，返回标题、正文摘要、可见标题和可交互元素列表，并补充稳定 ref、可访问名称、推断 role 和建议选择器。推荐作为页面操作前的起点。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        maxTextLength: z
          .number()
          .int()
          .positive()
          .max(20000)
          .default(3000)
          .describe("正文摘要最大返回长度。"),
        maxElements: z
          .number()
          .int()
          .positive()
          .max(200)
          .default(40)
          .describe("最多返回多少个可交互元素。"),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ pageId, maxTextLength, maxElements }) =>
      textResult(
        await browserManager.pageSnapshot({
          pageId,
          maxTextLength,
          maxElements,
        }),
      ),
  );

  server.registerTool(
    "find_elements",
    {
      description:
        "按可访问名称、标签、文本、placeholder、href 或选择器模糊查找页面中的可交互元素，优先返回更符合语义定位的结果，并返回可直接用于后续动作的 ref。推荐在 page_snapshot 之后用来锁定明确的输入框、按钮或链接。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        query: z.string().min(1).describe("要查找的关键词。"),
        matchMode: waitMatchModeSchema
          .default("contains")
          .describe("匹配方式，支持 contains 或 exact。"),
        tag: z
          .string()
          .optional()
          .describe("可选，只保留某种标签，例如 button、input、a。"),
        role: z.string().optional().describe("可选，只保留某种 role。"),
        maxResults: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(10)
          .describe("最多返回多少个结果。"),
        inspectLimit: z
          .number()
          .int()
          .positive()
          .max(300)
          .default(120)
          .describe("最多检查多少个可交互元素。"),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ pageId, query, matchMode, tag, role, maxResults, inspectLimit }) =>
      textResult(
        await browserManager.findElements({
          pageId,
          query,
          matchMode,
          tag,
          role,
          maxResults,
          inspectLimit,
        }),
      ),
  );

  server.registerTool(
    "find_submit_targets",
    {
      description:
        "围绕指定输入框扫描附近可能承担提交动作的控件，适合搜索框、筛选框或表单输入框场景。会额外返回 preferredSubmitMethod，用于判断当前更适合优先按 Enter，还是优先点击邻近提交控件。优先传 ref；也支持 selector。",
      inputSchema: z
        .object({
          pageId: z.string().optional().describe("可选，指定页面 ID。"),
          ref: z
            .string()
            .min(1)
            .optional()
            .describe("可选，来自 page_snapshot 或 find_elements 返回的输入框引用。"),
          selector: z
            .string()
            .optional()
            .describe("可选，输入框的 CSS 选择器。"),
          maxResults: z
            .number()
            .int()
            .positive()
            .max(20)
            .default(5)
            .describe("最多返回多少个候选提交控件。"),
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
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ pageId, ref, selector, maxResults }) =>
      textResult(
        await browserManager.findSubmitTargets({
          pageId,
          ref,
          selector,
          maxResults,
        }),
      ),
  );

  if (options.toolMode === "advanced") {
    server.registerTool(
      "find_primary_inputs",
      {
        description:
          "兜底工具。在 page_snapshot 和 find_elements 仍不足以定位时，扫描整页可见输入控件并按主输入框概率排序，返回页面顶部或导航区关键输入框候选。",
        inputSchema: z.object({
          pageId: z.string().optional().describe("可选，指定页面 ID。"),
          maxResults: z
            .number()
            .int()
            .positive()
            .max(50)
            .default(10)
            .describe("最多返回多少个候选输入框。"),
        }),
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ pageId, maxResults }) =>
        textResult(
          await browserManager.findPrimaryInputs({
            pageId,
            maxResults,
          }),
        ),
    );

    server.registerTool(
      "evaluate",
      {
        description: "在页面上下文里执行一段 JavaScript 表达式并返回结果。",
        inputSchema: z.object({
          pageId: z.string().optional().describe("可选，指定页面 ID。"),
          expression: z
            .string()
            .min(1)
            .describe("要在页面里执行的 JavaScript 表达式。"),
        }),
      },
      async ({ pageId, expression }) =>
        textResult(await browserManager.evaluate({ pageId, expression })),
    );
  }
}
