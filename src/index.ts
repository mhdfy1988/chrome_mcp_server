import type { Server as HttpServer } from "node:http";
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
  let httpServerHandle: HttpServerHandle | undefined;

  if (config.transport === "stdio") {
    await runStdioServer(config, browserManager);
  } else {
    httpServerHandle = await runHttpServer(config, browserManager);
  }

  setupShutdownHooks(browserManager, httpServerHandle);
}

interface HttpQueueSnapshot {
  mode: "single_session_serialized";
  totalRequests: number;
  queuedRequests: number;
  activeRequests: number;
  activeLabel?: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
}

interface HttpServerHandle {
  close(): Promise<void>;
  snapshot(): HttpQueueSnapshot;
}

function createHttpRequestGate(): {
  runExclusive<T>(label: string, task: () => Promise<T>): Promise<T>;
  snapshot(): HttpQueueSnapshot;
} {
  let requestChain: Promise<void> = Promise.resolve();
  let totalRequests = 0;
  let queuedRequests = 0;
  let activeRequests = 0;
  let activeLabel: string | undefined;
  let lastStartedAt: string | undefined;
  let lastCompletedAt: string | undefined;

  return {
    async runExclusive<T>(label: string, task: () => Promise<T>): Promise<T> {
      totalRequests += 1;
      queuedRequests += 1;

      const run = requestChain.catch(() => undefined).then(async () => {
        queuedRequests = Math.max(0, queuedRequests - 1);
        activeRequests += 1;
        activeLabel = label;
        lastStartedAt = new Date().toISOString();

        try {
          return await task();
        } finally {
          activeRequests = Math.max(0, activeRequests - 1);
          activeLabel = activeRequests > 0 ? activeLabel : undefined;
          lastCompletedAt = new Date().toISOString();
        }
      });

      requestChain = run.then(
        () => undefined,
        () => undefined,
      );

      return run;
    },
    snapshot(): HttpQueueSnapshot {
      return {
        mode: "single_session_serialized",
        totalRequests,
        queuedRequests,
        activeRequests,
        activeLabel,
        lastStartedAt,
        lastCompletedAt,
      };
    },
  };
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
): Promise<HttpServerHandle> {
  const app = createMcpExpressApp({ host: config.host });
  const requestGate = createHttpRequestGate();

  app.get("/health", async (_req: Request, res: Response) => {
    const status = await browserManager.getStatus();
    res.json({
      ok: true,
      transport: config.transport,
      toolMode: config.toolMode,
      host: config.host,
      port: config.port,
      browser: status,
      httpQueue: requestGate.snapshot(),
      uptimeSec: Math.round(process.uptime()),
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    await requestGate.runExclusive("mcp_request", async () => {
      const server = createMcpServer(browserManager, {
        toolMode: config.toolMode,
      });

      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        res.on("close", () => {
          void transport.close();
          void server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
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

  const instance = await new Promise<HttpServer>((resolve, reject) => {
    const listeningInstance = app.listen(
      config.port,
      config.host,
      (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        console.error(
          `[chrome-mcp] HTTP server started at http://${config.host}:${config.port}/mcp`,
        );
        resolve(listeningInstance);
      },
    );

    listeningInstance.on("error", reject);
  });

  return {
    close: async () =>
      new Promise<void>((resolve, reject) => {
        if (!instance.listening) {
          resolve();
          return;
        }

        instance.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
    snapshot: () => requestGate.snapshot(),
  };
}

function setupShutdownHooks(
  browserManager: BrowserManager,
  httpServerHandle?: HttpServerHandle,
): void {
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = async (signal: string) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      console.error(`[chrome-mcp] received ${signal}, closing resources...`);

      try {
        if (httpServerHandle) {
          await httpServerHandle.close();
        }

        await browserManager.shutdown();
      } catch (error) {
        console.error("[chrome-mcp] shutdown failed:", error);
        process.exitCode = 1;
      }
    })();

    return shutdownPromise;
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
