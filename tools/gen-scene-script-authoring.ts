import { generateLlmAuthoringMarkdown } from "@theatrum/scripting";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format, resolveConfig } from "prettier";

const destination = resolve(process.cwd(), "LLM_AUTHORING.md");
const config = await resolveConfig(destination);
const generated = await format(generateLlmAuthoringMarkdown(), {
  ...config,
  filepath: destination,
});

if (process.argv.includes("--verify")) {
  const existing = await readFile(destination, "utf8").catch(() => "");
  if (existing !== generated) {
    throw new Error("LLM_AUTHORING.md está desatualizado; execute pnpm scene:authoring.");
  }
  console.log("LLM_AUTHORING.md está sincronizado com o registry.");
} else {
  await writeFile(destination, generated, "utf8");
  console.log(`Gerado ${destination}`);
}
