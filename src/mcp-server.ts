import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { WaitUntilMode } from "./config.js";
import { BrowserManager } from "./browser-manager.js";

const waitUntilSchema = z.enum([
  "load",
  "domcontentloaded",
  "networkidle0",
  "networkidle2",
]);

const waitMatchModeSchema = z.enum(["contains", "exact"]);

export function createMcpServer(browserManager: BrowserManager): McpServer {
  const server = new McpServer(
    {
      name: "chrome-browser-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  server.registerTool(
    "browser_status",
    {
      description: "查看当前浏览器连接状态、页面列表和运行模式。",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await browserManager.getStatus()),
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
    async () => textResult(await browserManager.listPages()),
  );

  server.registerTool(
    "open_page",
    {
      description: "打开一个新页面，可选直接导航到指定 URL。",
      inputSchema: z.object({
        url: z.url().optional().describe("可选，要直接打开的 URL。"),
      }),
    },
    async ({ url }) => textResult(await browserManager.openPage(url)),
  );

  server.registerTool(
    "select_page",
    {
      description: "切换当前活动页面。",
      inputSchema: z.object({
        pageId: z.string().min(1).describe("要切换到的页面 ID。"),
      }),
    },
    async ({ pageId }) => textResult(await browserManager.selectPage(pageId)),
  );

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
        "等待页面元素、文本、标题或 URL 满足条件。适合在导航后等待页面真正进入可操作状态。",
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
            .default(15000)
            .describe("等待超时，单位毫秒。"),
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

  server.registerTool(
    "click",
    {
      description:
        "点击页面中的一个元素。选择器支持 Puppeteer locator 语法，除了 CSS，也可用 text / aria / 穿透 shadow DOM 的选择方式。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        selector: z.string().min(1).describe("要点击的元素选择器。"),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(120000)
          .optional()
          .describe("可选，自定义等待超时。"),
      }),
    },
    async ({ pageId, selector, timeoutMs }) =>
      textResult(await browserManager.click(selector, pageId, timeoutMs)),
  );

  server.registerTool(
    "click_and_wait",
    {
      description:
        "先注册等待条件再点击元素，适合点击后可能发生同页跳转、弹出新页、标题变化、URL 变化或页面局部刷新时使用。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        selector: z.string().min(1).describe("要点击的元素选择器。"),
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
      }),
    },
    async ({
      pageId,
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
        "向输入框或可编辑元素输入文本。选择器支持 Puppeteer locator 语法，除了 CSS，也可用 text / aria / 穿透 shadow DOM 的选择方式。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        selector: z.string().min(1).describe("输入目标的元素选择器。"),
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
      }),
    },
    async ({ pageId, selector, text, clear, submit, timeoutMs }) =>
      textResult(
        await browserManager.typeText({
          pageId,
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

  server.registerTool(
    "extract_text",
    {
      description: "提取当前页面或指定元素的文本内容。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        selector: z
          .string()
          .optional()
          .describe("可选，只提取某个 CSS 选择器对应元素的文本。"),
        maxLength: z
          .number()
          .int()
          .positive()
          .max(200000)
          .default(5000)
          .describe("文本最大返回长度。"),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ pageId, selector, maxLength }) =>
      textResult(
        await browserManager.extractText({
          pageId,
          selector,
          maxLength,
        }),
      ),
  );

  server.registerTool(
    "page_snapshot",
    {
      description:
        "提取当前页面的结构化快照，返回标题、正文摘要、可见标题和可交互元素列表，并补充可访问名称、推断 role 和建议的 CSS 选择器。",
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
        "按可访问名称、标签、文本、placeholder、href 或选择器模糊查找页面中的可交互元素，优先返回更符合语义定位的结果。",
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
        role: z
          .string()
          .optional()
          .describe("可选，只保留某种 role。"),
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
    "find_primary_inputs",
    {
      description:
        "扫描整页可见输入控件，按主输入框概率排序，适合在缺少明确搜索语义时定位页面顶部或导航区的关键输入框。",
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
    "submit_input",
    {
      description:
        "对指定输入框尝试提交，按 Enter、form.requestSubmit、form.submit、邻近按钮点击的顺序依次验证。",
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

  server.registerTool(
    "screenshot",
    {
      description: "截图当前页面，或截图指定元素。返回图片内容，并可选保存到文件。",
      inputSchema: z.object({
        pageId: z.string().optional().describe("可选，指定页面 ID。"),
        selector: z
          .string()
          .optional()
          .describe("可选，只截取某个 CSS 选择器对应元素。"),
        fullPage: z
          .boolean()
          .default(true)
          .describe("整页截图，仅在未指定 selector 时生效。"),
        format: z.enum(["png", "jpeg"]).default("png").describe("图片格式。"),
        quality: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("JPEG 质量，0 到 100。"),
        savePath: z.string().optional().describe("可选，把截图额外保存到本地文件。"),
      }),
    },
    async ({ pageId, selector, fullPage, format, quality, savePath }) => {
      const result = await browserManager.screenshot({
        pageId,
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
    },
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
    async ({ pageId, limit }) =>
      textResult(await browserManager.getConsoleLogs(pageId, limit)),
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
    async ({ pageId, limit }) =>
      textResult(await browserManager.getNetworkLogs(pageId, limit)),
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
    async ({ pageId }) => textResult(await browserManager.closePage(pageId)),
  );

  server.registerTool(
    "close_browser",
    {
      description: "关闭整个浏览器进程并清空当前会话状态。",
      annotations: {
        destructiveHint: true,
      },
    },
    async () => textResult(await browserManager.closeBrowser()),
  );

  return server;
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
