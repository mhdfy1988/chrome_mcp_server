import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserManager } from "./browser-manager.js";
import type { ToolMode } from "./config.js";
import { registerArtifactTools } from "./mcp/register-artifact-tools.js";
import { registerBrowserTools } from "./mcp/register-browser-tools.js";
import { registerInspectionTools } from "./mcp/register-inspection-tools.js";
import { registerInteractionTools } from "./mcp/register-interaction-tools.js";
import { registerNavigationTools } from "./mcp/register-navigation-tools.js";

export function createMcpServer(
  browserManager: BrowserManager,
  options: {
    toolMode: ToolMode;
  },
): McpServer {
  const server = new McpServer(
    {
      name: "chrome-browser-mcp-server",
        version: "1.1.1",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerBrowserTools(server, browserManager);
  registerNavigationTools(server, browserManager);
  registerInteractionTools(server, browserManager, options);
  registerInspectionTools(server, browserManager, options);
  registerArtifactTools(server, browserManager);

  return server;
}
