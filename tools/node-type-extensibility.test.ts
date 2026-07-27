/**
 * Prova estrutural do critério 5 da Fase 4: adicionar um tipo de nó toca **um**
 * arquivo de registro e **um** de renderable. `shape.circle` foi escrito do zero
 * depois de todo o resto da fase; se algum dia alguém precisar citá-lo em
 * timeline, Inspector, comandos, seleção ou backend, este teste falha e a
 * arquitetura de registry perdeu a propriedade que a justifica.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROOF_TYPE = "shape.circle";
const ALLOWED_FILES = [
  "packages/renderer/src/builtins.ts",
  "packages/scene-graph/src/builtin-node-types.ts",
] as const;
const SOURCE_ROOTS = ["packages", "apps"] as const;
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "out", "coverage"]);

async function productionSources(): Promise<readonly string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await walk(absolute);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|bench)\.tsx?$/.test(entry.name)) continue;
      files.push(path.relative(ROOT, absolute).replaceAll("\\", "/"));
    }
  }

  for (const root of SOURCE_ROOTS) {
    for (const workspace of await readdir(path.join(ROOT, root), { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue;
      const source = path.join(ROOT, root, workspace.name, "src");
      await walk(source).catch(() => undefined);
    }
  }

  return files.sort();
}

describe("extensibilidade de tipos de nó", () => {
  it("shape.circle só é citado no registro e no renderable", async () => {
    const sources = await productionSources();
    // Sanidade: a varredura precisa realmente ter lido a árvore de produção.
    expect(sources.length).toBeGreaterThan(80);
    expect(sources).toContain("apps/editor/src/panels/timeline/TimelinePanel.tsx");

    const mentions: string[] = [];
    for (const file of sources) {
      const content = await readFile(path.join(ROOT, file), "utf8");
      if (content.includes(PROOF_TYPE)) mentions.push(file);
    }

    expect(mentions).toEqual([...ALLOWED_FILES]);
  });
});
