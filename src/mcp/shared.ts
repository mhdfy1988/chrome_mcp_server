import * as z from "zod/v4";

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
