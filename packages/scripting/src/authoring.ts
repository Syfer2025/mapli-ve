import { SCENE_FORMAT_ID, SCENE_SCRIPT_VERSION } from "@theatrum/schema";
import type { SceneVerbRegistry } from "./contracts.js";
import { sceneVerbRegistry } from "./registry.js";

export function generateLlmAuthoringMarkdown(
  registry: SceneVerbRegistry = sceneVerbRegistry,
): string {
  const lines: string[] = [
    "# LLM Authoring — Scene Script v1",
    "",
    "<!-- GERADO por tools/gen-scene-script-authoring.ts. NÃO EDITE À MÃO. -->",
    "",
    "Escreva somente JSON válido. O compilador rejeita campos desconhecidos e",
    "devolve todos os erros com JSON Pointer e sugestões `didYouMean`.",
    "",
    "## Envelope mínimo",
    "",
    "```json",
    JSON.stringify(
      {
        format: SCENE_FORMAT_ID,
        version: SCENE_SCRIPT_VERSION,
        meta: {
          title: "Título",
          fps: 60,
          resolution: "1920x1080",
          duration: "30s",
        },
        timeline: [],
      },
      null,
      2,
    ),
    "```",
    "",
    "Tempos aceitos: `4s`, `500ms`, `90f`, `1m30s`, `1:30`,",
    "`00:01:30:15`, `after:id`, `after:id+2s`, `with:id` e `end-4s`.",
    "Números puros significam segundos. Tempos relativos são permitidos em `at`;",
    "`duration` e `delay` devem ser absolutos.",
    "",
    'Lugares aceitam `[lng, lat]`, `{ "lng": 0, "lat": 0 }`, uma chave de',
    '`places` ou uma consulta qualificada do gazetteer, como `"Kursk, RU"`.',
    "Nunca invente coordenadas para resolver ambiguidade: qualifique cidade/estado/país.",
    "",
    "## Registry de verbos",
    "",
  ];

  const categories = [
    ["camera", "Câmera"],
    ["units", "Unidades"],
    ["combat", "Combate"],
    ["geography", "Geografia"],
    ["text", "Texto e gráficos"],
    ["control", "Controle"],
  ] as const;
  for (const [category, label] of categories) {
    lines.push(`### ${label}`, "");
    for (const verb of registry.list().filter((entry) => entry.category === category)) {
      lines.push(
        `#### \`${verb.name}\``,
        "",
        verb.description,
        "",
        `Campos obrigatórios: ${verb.required.map((field) => `\`${field}\``).join(", ")}.`,
        "",
        `Campos aceitos: ${verb.fields.map((field) => `\`${field}\``).join(", ")}.`,
        "",
        "```json",
        JSON.stringify(verb.example, null, 2),
        "```",
        "",
      );
    }
  }

  lines.push(
    "## Ciclo de correção",
    "",
    "Se a compilação falhar, corrija cada item de `diagnostics`. Use `path` para",
    "localizar o campo exato e prefira a primeira opção de `didYouMean` quando ela",
    "corresponder à intenção. Não remova entradas corretas para esconder erros.",
    "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}
