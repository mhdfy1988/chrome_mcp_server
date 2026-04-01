import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import {
  getHelpText,
  loadConfig,
  shouldShowHelp,
  type AppConfig,
} from "./config.js";
import { BrowserManager } from "./browser-manager.js";
import { createMcpServer } from "./mcp-server.js";

async function main(): Promise<void> {
  if (shouldShowHelp()) {
    console.error(getHelpText());
    return;
  }

  const config = loadConfig();
  const browserManager = new BrowserManager(config.chrome);

  if (config.transport === "stdio") {
    await runStdioServer(config, browserManager);
  } else {
    await runHttpServer(config, browserManager);
  }

  setupShutdownHooks(browserManager);
}

async function runStdioServer(
  config: AppConfig,
  browserManager: BrowserManager,
): Promise<void> {
  const server = createMcpServer(browserManager, {
    toolMode: config.toolMode,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[chrome-mcp] STDIO server started.");
}

async function runHttpServer(
  config: AppConfig,
  browserManager: BrowserManager,
): Promise<void> {
  const app = createMcpExpressApp({ host: config.host });

  app.get("/health", async (_req: Request, res: Response) => {
    const status = await browserManager.getStatus();
    res.json({
      ok: true,
      transport: config.transport,
      toolMode: config.toolMode,
      host: config.host,
      port: config.port,
      browser: status,
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createMcpServer(browserManager, {
      toolMode: config.toolMode,
    });

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("[chrome-mcp] HTTP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
  });

  await new Promise<void>((resolve, reject) => {
    const instance = app.listen(config.port, config.host, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      console.error(
        `[chrome-mcp] HTTP server started at http://${config.host}:${config.port}/mcp`,
      );
      resolve();
    });

    instance.on("error", reject);
  });
}

function setupShutdownHooks(browserManager: BrowserManager): void {
  const shutdown = async (signal: string) => {
    console.error(`[chrome-mcp] received ${signal}, closing browser...`);
    try {
      await browserManager.shutdown();
    } catch (error) {
      console.error("[chrome-mcp] shutdown failed:", error);
      process.exitCode = 1;
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  console.error("[chrome-mcp] fatal error:", error);
  process.exitCode = 1;
});
