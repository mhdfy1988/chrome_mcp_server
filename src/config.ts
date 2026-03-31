import path from "node:path";

export type TransportMode = "stdio" | "http";
export type ChromeChannel =
  | "chrome"
  | "chrome-beta"
  | "chrome-dev"
  | "chrome-canary";
export type WaitUntilMode =
  | "load"
  | "domcontentloaded"
  | "networkidle0"
  | "networkidle2";

export interface ChromeConfig {
  browserURL?: string;
  browserWSEndpoint?: string;
  executablePath?: string;
  channel?: ChromeChannel;
  headless: boolean;
  userDataDir?: string;
  defaultTimeoutMs: number;
  navigationTimeoutMs: number;
}

export interface AppConfig {
  transport: TransportMode;
  host: string;
  port: number;
  chrome: ChromeConfig;
}

interface CliArgs {
  transport?: string;
  host?: string;
  port?: string;
  browserURL?: string;
  browserWSEndpoint?: string;
  executablePath?: string;
  channel?: string;
  headless?: string;
  userDataDir?: string;
  defaultTimeoutMs?: string;
  navigationTimeoutMs?: string;
  help: boolean;
}

const VALID_TRANSPORTS = new Set<TransportMode>(["stdio", "http"]);
const VALID_CHANNELS = new Set<ChromeChannel>([
  "chrome",
  "chrome-beta",
  "chrome-dev",
  "chrome-canary",
]);

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const args = parseArgs(argv);

  const transport = parseTransport(
    args.transport ?? env.CHROME_MCP_TRANSPORT ?? "stdio",
  );
  const host = args.host ?? env.CHROME_MCP_HOST ?? "127.0.0.1";
  const port = parseInteger(args.port ?? env.CHROME_MCP_PORT, 3000, "port");

  const userDataDirRaw =
    args.userDataDir ??
    env.CHROME_USER_DATA_DIR ??
    path.resolve(process.cwd(), ".chrome-profile");

  const config: AppConfig = {
    transport,
    host,
    port,
    chrome: {
      browserURL: args.browserURL ?? env.CHROME_BROWSER_URL,
      browserWSEndpoint: args.browserWSEndpoint ?? env.CHROME_WS_ENDPOINT,
      executablePath: args.executablePath ?? env.CHROME_EXECUTABLE_PATH,
      channel: parseChannel(args.channel ?? env.CHROME_CHANNEL ?? "chrome"),
      headless: parseBoolean(args.headless ?? env.CHROME_HEADLESS, false),
      userDataDir: userDataDirRaw ? path.resolve(userDataDirRaw) : undefined,
      defaultTimeoutMs: parseInteger(
        args.defaultTimeoutMs ?? env.CHROME_DEFAULT_TIMEOUT_MS,
        15_000,
        "defaultTimeoutMs",
      ),
      navigationTimeoutMs: parseInteger(
        args.navigationTimeoutMs ?? env.CHROME_NAVIGATION_TIMEOUT_MS,
        30_000,
        "navigationTimeoutMs",
      ),
    },
  };

  if (config.chrome.browserURL && config.chrome.browserWSEndpoint) {
    throw new Error("CHROME_BROWSER_URL 和 CHROME_WS_ENDPOINT 只能二选一。");
  }

  return config;
}

export function shouldShowHelp(
  argv: string[] = process.argv.slice(2),
): boolean {
  return parseArgs(argv).help;
}

export function getHelpText(): string {
  return `
Chrome MCP Server

用法:
  node dist/index.js --transport stdio
  node dist/index.js --transport http --host 127.0.0.1 --port 3000

CLI 参数:
  --transport <stdio|http>            传输模式，默认 stdio
  --host <host>                       HTTP 监听地址，默认 127.0.0.1
  --port <port>                       HTTP 端口，默认 3000
  --browser-url <url>                 连接已开启远程调试的 Chrome，例如 http://127.0.0.1:9222
  --ws-endpoint <url>                 连接已有 Chrome WebSocket 端点
  --executable-path <path>            Chrome 可执行文件路径
  --channel <chrome|chrome-beta|chrome-dev|chrome-canary>
                                      启动已安装的 Chrome 渠道，默认 chrome
  --headless <true|false>             是否无头模式，默认 false
  --user-data-dir <path>              Chrome 用户数据目录，默认 ./.chrome-profile
  --default-timeout-ms <ms>           元素操作超时，默认 15000
  --navigation-timeout-ms <ms>        页面导航超时，默认 30000
  --help                              显示帮助

环境变量:
  CHROME_MCP_TRANSPORT
  CHROME_MCP_HOST
  CHROME_MCP_PORT
  CHROME_BROWSER_URL
  CHROME_WS_ENDPOINT
  CHROME_EXECUTABLE_PATH
  CHROME_CHANNEL
  CHROME_HEADLESS
  CHROME_USER_DATA_DIR
  CHROME_DEFAULT_TIMEOUT_MS
  CHROME_NAVIGATION_TIMEOUT_MS
`.trim();
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];

    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }

    if (!raw.startsWith("--")) {
      throw new Error(`无法识别的参数: ${raw}`);
    }

    const [flag, inlineValue] = raw.split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];
    const consumesNext = inlineValue === undefined;

    const requireValue = (): string => {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error(`参数 ${flag} 缺少值。`);
      }
      if (consumesNext) {
        index += 1;
      }
      return nextValue;
    };

    switch (flag) {
      case "--transport":
        args.transport = requireValue();
        break;
      case "--host":
        args.host = requireValue();
        break;
      case "--port":
        args.port = requireValue();
        break;
      case "--browser-url":
        args.browserURL = requireValue();
        break;
      case "--ws-endpoint":
        args.browserWSEndpoint = requireValue();
        break;
      case "--executable-path":
        args.executablePath = requireValue();
        break;
      case "--channel":
        args.channel = requireValue();
        break;
      case "--headless":
        args.headless = requireValue();
        break;
      case "--user-data-dir":
        args.userDataDir = requireValue();
        break;
      case "--default-timeout-ms":
        args.defaultTimeoutMs = requireValue();
        break;
      case "--navigation-timeout-ms":
        args.navigationTimeoutMs = requireValue();
        break;
      default:
        throw new Error(`无法识别的参数: ${flag}`);
    }
  }

  return args;
}

function parseTransport(value: string): TransportMode {
  if (!VALID_TRANSPORTS.has(value as TransportMode)) {
    throw new Error(`不支持的 transport: ${value}`);
  }

  return value as TransportMode;
}

function parseChannel(value?: string): ChromeChannel | undefined {
  if (!value) {
    return undefined;
  }

  if (!VALID_CHANNELS.has(value as ChromeChannel)) {
    throw new Error(`不支持的 Chrome channel: ${value}`);
  }

  return value as ChromeChannel;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`无法解析布尔值: ${value}`);
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数，当前值: ${value}`);
  }

  return parsed;
}
