import * as z from "zod/v4";
import { normalizeBrowserToolError } from "../errors.js";

export const waitUntilSchema = z.enum([
  "load",
  "domcontentloaded",
  "networkidle0",
  "networkidle2",
]);

export const waitMatchModeSchema = z.enum(["contains", "exact"]);

export function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function errorResult(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(normalizeBrowserToolError(error), null, 2),
      },
    ],
    isError: true as const,
  };
}

export function toolHandler<TArgs extends Record<string, unknown>>(
  handler: (args: TArgs) => Promise<unknown>,
) {
  return async (args: TArgs) => {
    try {
      return textResult(await handler(args));
    } catch (error) {
      return errorResult(error);
    }
  };
}

export function toolResultHandler<
  TArgs extends Record<string, unknown>,
  TResult,
>(
  handler: (args: TArgs) => Promise<TResult>,
) {
  return async (args: TArgs): Promise<TResult | ReturnType<typeof errorResult>> => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}
