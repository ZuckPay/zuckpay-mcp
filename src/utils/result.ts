/**
 * Helpers de resultado de tool: todo texto e todo structuredContent
 * passam pelo redactor antes de sair do processo.
 */

import { toUserMessage } from "./errors.js";
import type { Redactor } from "./redact.js";

export interface ToolTextContent {
  [key: string]: unknown;
  type: "text";
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: ToolTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Passa um valor JSON inteiro pelo redactor (via stringify/parse). */
export function redactDeep(redact: Redactor, value: unknown): unknown {
  try {
    return JSON.parse(redact(JSON.stringify(value)));
  } catch {
    return undefined;
  }
}

export function okResult(redact: Redactor, text: string, structured?: unknown): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text: redact(text) }] };
  if (structured !== undefined) {
    const clean = redactDeep(redact, structured);
    if (clean !== null && typeof clean === "object" && !Array.isArray(clean)) {
      result.structuredContent = clean as Record<string, unknown>;
    }
  }
  return result;
}

export function errorResult(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Envolve o handler: qualquer exceção vira mensagem amigável e mascarada. */
export async function safeRun(
  redact: Redactor,
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(toUserMessage(err, redact));
  }
}
