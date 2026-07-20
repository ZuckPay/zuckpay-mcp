/**
 * Tool de leitura: GET /v3/courses.
 *
 * Somente-leitura. Lista só os cursos dos quais o seller é dono/produtor —
 * nenhum dado de aluno matriculado é exposto, só contagens agregadas.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { pickNumber, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

export const listCoursesShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .describe("Quantidade de cursos por página (1 a 100; padrão 50)")
    .optional(),
};

export const listCoursesSchema = z.object(listCoursesShape).strict();

function pickObjectArray(obj: unknown, key: string): Record<string, unknown>[] {
  if (typeof obj !== "object" || obj === null) {
    return [];
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo passado pelo nosso código
  const value = (obj as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function describeCourse(row: Record<string, unknown>): string {
  const title = pickString(row, "title") ?? "(sem título)";
  const status = pickString(row, "status") ?? "?";
  const id = pickString(row, "id") ?? "(sem id)";
  const modules = pickNumber(row, "module_count");
  const lessons = pickNumber(row, "lesson_count");
  const students = pickNumber(row, "student_count");

  const parts = [title, status, `id ${id}`];
  if (modules !== undefined) parts.push(`${modules} módulo(s)`);
  if (lessons !== undefined) parts.push(`${lessons} aula(s)`);
  if (students !== undefined) parts.push(`${students} aluno(s)`);
  return `• ${parts.join(" · ")}`;
}

async function handleListCourses(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = listCoursesSchema.parse(args);

    const query: Record<string, string> = {};
    if (input.limit !== undefined) query.limit = String(input.limit);

    const response = await client.get("/v3/courses", query);
    const rows = pickObjectArray(response, "courses");

    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push("Nenhum curso encontrado nesta conta.");
    } else {
      lines.push(`Cursos (${rows.length}) 🎓`, "");
      for (const row of rows) {
        lines.push(describeCourse(row));
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerCourseTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listCourses",
    {
      title: "Listar cursos",
      description:
        "Lista os cursos (Meus Cursos / área de membros) dos quais o seller é dono na conta ZuckPay autenticada, " +
        "com contagem de módulos/aulas/alunos. Somente leitura — não retorna dados de alunos matriculados.",
      inputSchema: listCoursesShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListCourses(client, args),
  );
}
