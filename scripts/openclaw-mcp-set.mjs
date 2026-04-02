import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function resolveOpenClawCli() {
  const overridePath = process.env.OPENCLAW_CLI_MJS;
  if (overridePath) {
    const resolved = path.resolve(overridePath);
    if (!existsSync(resolved)) {
      throw new Error(`OPENCLAW_CLI_MJS 指向的文件不存在: ${resolved}`);
    }
    return resolved;
  }

  const whereResult = spawnSync("where.exe", ["openclaw.cmd"], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (whereResult.status !== 0) {
    throw new Error("未找到 openclaw.cmd，请先确认 OpenClaw CLI 已安装并已加入 PATH。");
  }

  const cmdPath = whereResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!cmdPath) {
    throw new Error("找到了 where.exe，但没有解析出 openclaw.cmd 的实际路径。");
  }

  const cliPath = path.resolve(path.dirname(cmdPath), "node_modules", "openclaw", "openclaw.mjs");
  if (!existsSync(cliPath)) {
    throw new Error(`未找到官方 OpenClaw CLI 入口: ${cliPath}`);
  }

  return cliPath;
}

function main() {
  const [, , serverName, jsonFilePath] = process.argv;
  if (!serverName || !jsonFilePath) {
    fail("用法: node scripts/openclaw-mcp-set.mjs <server-name> <json-file>");
    return;
  }

  const resolvedJsonFile = path.resolve(jsonFilePath);
  if (!existsSync(resolvedJsonFile)) {
    fail(`找不到 JSON 文件: ${resolvedJsonFile}`);
    return;
  }

  let normalizedJson = "";
  try {
    const rawJson = readFileSync(resolvedJsonFile, "utf8");
    const parsed = JSON.parse(rawJson);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("JSON 顶层必须是对象。");
    }
    normalizedJson = JSON.stringify(parsed);
  } catch (error) {
    fail(`读取或解析 JSON 失败: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let cliPath = "";
  try {
    cliPath = resolveOpenClawCli();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const result = spawnSync(
    process.execPath,
    [cliPath, "mcp", "set", serverName, normalizedJson],
    {
      stdio: "inherit",
      windowsHide: true,
    },
  );

  if (typeof result.status === "number") {
    process.exitCode = result.status;
    return;
  }

  if (result.error) {
    fail(`调用官方 OpenClaw CLI 失败: ${result.error.message}`);
    return;
  }

  fail("调用官方 OpenClaw CLI 失败，但没有拿到明确的退出码。");
}

main();
