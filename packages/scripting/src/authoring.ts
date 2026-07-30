import { SCENE_FORMAT_ID, SCENE_SCRIPT_VERSION } from "@theatrum/schema";
import type { SceneVerbDefinition, SceneVerbRegistry } from "./contracts.js";
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
    "## Declarações e referências",
    "",
    "Os exemplos de verbos abaixo assumem este contexto. Declare referências antes",
    "de usá-las; `unit`, `target`, `along`, `faction`, `from` e `to` não criam",
    "unidades, paths ou facções implicitamente.",
    "",
    "```json",
    JSON.stringify(authoringDeclarations(), null, 2),
    "```",
    "",
    "A projeção executável nesta versão é `mercator`; omita `terrain` ou use",
    '`{ "enabled": false }`. Regiões usam geoIds empacotados como `c:IRN`,',
    "`s:...`, `r:...` ou `roads:...`.",
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
        `Campos obrigatórios: ${requiredFields(verb)}.`,
        "",
        `Campos aceitos: ${verb.fields.map((field) => `\`${field}\``).join(", ")}.`,
        "",
        ...(verb.implementationNote === undefined
          ? []
          : [`Estado de execução: ${verb.implementationNote}`, ""]),
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

/**
 * Monta o contexto usado para validar cada exemplo publicado no guia. O helper
 * fica exportado para o verificador de fase e impede exemplos que só parecem
 * corretos quando lidos isoladamente.
 */
export function createLlmAuthoringExampleInput(
  verb: SceneVerbDefinition,
): Readonly<Record<string, unknown>> {
  const example = { ...verb.example };
  let timeline: readonly Readonly<Record<string, unknown>>[] = [example];
  if (verb.name === "group.begin") {
    timeline = [example, { at: "1f", do: "group.end", label: example["label"] }];
  } else if (verb.name === "group.end") {
    timeline = [
      { at: "0s", do: "group.begin", label: example["label"] },
      { ...example, at: "1f" },
    ];
  }

  return Object.freeze({
    format: SCENE_FORMAT_ID,
    version: SCENE_SCRIPT_VERSION,
    meta: {
      title: `Exemplo ${verb.name}`,
      fps: 60,
      resolution: "1920x1080",
      duration: "10s",
    },
    ...authoringDeclarations(),
    timeline,
  });
}

function authoringDeclarations(): Readonly<Record<string, unknown>> {
  return {
    map: { projection: "mercator", terrain: { enabled: false } },
    defaults: { unitSize: 56, textFont: "Inter", ease: "cinematic" },
    places: {
      origin: [0, 0],
      destination: [10, 10],
    },
    paths: {
      "path-1": {
        through: [
          [0, 0],
          [10, 10],
        ],
      },
    },
    factions: {
      "faction-a": { color: "#3b82f6", label: "Facção A" },
      "faction-b": { color: "#ef4444", label: "Facção B" },
    },
    units: [
      { id: "unit-1", kind: "armor", faction: "faction-a", at: [0, 0] },
      { id: "unit-2", kind: "infantry", faction: "faction-b", at: [10, 10] },
    ],
  };
}

function requiredFields(verb: SceneVerbDefinition): string {
  const base = verb.required.map((field) => `\`${field}\``).join(", ");
  if (verb.name === "unit.advance" || verb.name === "unit.retreat") {
    return `${base}; exatamente um de \`along\` ou \`to\``;
  }
  if (verb.name === "encircle") {
    return `${base}; exatamente um de \`region\` ou \`at_place\``;
  }
  if (verb.name === "arrow.draw") {
    return `${base}; \`along\` ou o par \`from\` + \`to\``;
  }
  return base;
}
