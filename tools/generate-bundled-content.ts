import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type EraId = "wwi" | "wwii" | "modern";
type Category = "armor" | "infantry" | "artillery" | "air" | "naval" | "support";

interface NationSeed {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly color: string;
}

interface EraSeed {
  readonly id: EraId;
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly nations: readonly NationSeed[];
}

interface ArchetypeSeed {
  readonly id: string;
  readonly category: Category;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly app6: string;
  readonly tags: readonly string[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "data", "plugin-content");

const eras: readonly EraSeed[] = [
  {
    id: "wwi",
    label: "Primeira Guerra Mundial",
    from: 1914,
    to: 1918,
    nations: [
      {
        id: "britain",
        name: "Reino Unido",
        aliases: ["Britain", "British", "Inglaterra"],
        color: "#b83b43",
      },
      {
        id: "france",
        name: "França",
        aliases: ["France", "French", "Francesa"],
        color: "#3f68ad",
      },
      {
        id: "germany",
        name: "Império Alemão",
        aliases: ["Germany", "German", "Alemanha", "Alemão"],
        color: "#3d4149",
      },
      {
        id: "russia",
        name: "Império Russo",
        aliases: ["Russia", "Russian", "Rússia", "Russo"],
        color: "#4478a8",
      },
      {
        id: "ottoman",
        name: "Império Otomano",
        aliases: ["Ottoman", "Turquia", "Turkish"],
        color: "#a93636",
      },
    ],
  },
  {
    id: "wwii",
    label: "Segunda Guerra Mundial",
    from: 1939,
    to: 1945,
    nations: [
      {
        id: "usa",
        name: "Estados Unidos",
        aliases: ["USA", "United States", "American", "Americano"],
        color: "#496b91",
      },
      {
        id: "britain",
        name: "Reino Unido",
        aliases: ["Britain", "British", "Inglaterra"],
        color: "#8e414a",
      },
      {
        id: "germany",
        name: "Alemanha",
        aliases: ["Germany", "German", "Alemão", "Alemã"],
        color: "#4b4b48",
      },
      {
        id: "ussr",
        name: "União Soviética",
        aliases: ["USSR", "URSS", "Soviet", "Soviético", "Soviética"],
        color: "#a63a31",
      },
      {
        id: "japan",
        name: "Japão",
        aliases: ["Japan", "Japanese", "Japonês"],
        color: "#b84b4b",
      },
    ],
  },
  {
    id: "modern",
    label: "Era Moderna",
    from: 1991,
    to: 2035,
    nations: [
      {
        id: "usa",
        name: "Estados Unidos",
        aliases: ["USA", "United States", "American", "Americano"],
        color: "#486d95",
      },
      {
        id: "britain",
        name: "Reino Unido",
        aliases: ["Britain", "British", "Inglaterra"],
        color: "#8f414c",
      },
      {
        id: "russia",
        name: "Rússia",
        aliases: ["Russia", "Russian", "Russo"],
        color: "#456f98",
      },
      {
        id: "china",
        name: "China",
        aliases: ["Chinese", "Chinês", "PLA"],
        color: "#a94138",
      },
      {
        id: "iran",
        name: "Irã",
        aliases: ["Iran", "Iranian", "Iraniano"],
        color: "#4c8a5e",
      },
    ],
  },
];

const archetypes: readonly ArchetypeSeed[] = [
  {
    id: "armor-light",
    category: "armor",
    name: "Carro de combate leve",
    aliases: ["light tank", "tanque leve"],
    app6: "SFGPUCAL--",
    tags: ["tank", "armor", "blindado", "light"],
  },
  {
    id: "armor-medium",
    category: "armor",
    name: "Carro de combate médio",
    aliases: ["medium tank", "tanque médio"],
    app6: "SFGPUCAM--",
    tags: ["tank", "armor", "blindado", "medium"],
  },
  {
    id: "armor-heavy",
    category: "armor",
    name: "Carro de combate pesado",
    aliases: ["heavy tank", "tanque pesado"],
    app6: "SFGPUCAH--",
    tags: ["tank", "armor", "blindado", "heavy"],
  },
  {
    id: "infantry",
    category: "infantry",
    name: "Infantaria",
    aliases: ["infantry", "fuzileiros"],
    app6: "SFGPUCI---",
    tags: ["infantry", "soldiers", "ground"],
  },
  {
    id: "artillery",
    category: "artillery",
    name: "Artilharia de campanha",
    aliases: ["field artillery", "canhão"],
    app6: "SFGPUCF---",
    tags: ["artillery", "gun", "indirect-fire"],
  },
  {
    id: "fighter",
    category: "air",
    name: "Aeronave de caça",
    aliases: ["fighter aircraft", "avião de caça"],
    app6: "SFAPMF----",
    tags: ["air", "aircraft", "fighter"],
  },
  {
    id: "bomber",
    category: "air",
    name: "Bombardeiro",
    aliases: ["bomber aircraft", "avião bombardeiro"],
    app6: "SFAPMB----",
    tags: ["air", "aircraft", "bomber"],
  },
  {
    id: "destroyer",
    category: "naval",
    name: "Escolta de superfície",
    aliases: ["destroyer", "navio de guerra"],
    app6: "SFSPCLDD--",
    tags: ["naval", "ship", "destroyer", "escort"],
  },
  {
    id: "logistics",
    category: "support",
    name: "Logística",
    aliases: ["logistics", "suprimento"],
    app6: "SFGPUSS---",
    tags: ["support", "supply", "logistics"],
  },
  {
    id: "medical",
    category: "support",
    name: "Apoio médico",
    aliases: ["medical support", "hospital de campanha"],
    app6: "SFGPUSM---",
    tags: ["support", "medical", "hospital"],
  },
];

const iconicNames: Readonly<Record<string, { readonly name: string; readonly aliases: string[] }>> =
  {
    "wwi.britain.armor-heavy": {
      name: "Mark IV",
      aliases: ["British heavy tank", "tanque britânico Mark IV"],
    },
    "wwi.france.armor-light": {
      name: "Renault FT",
      aliases: ["FT-17", "char léger Renault"],
    },
    "wwi.germany.fighter": {
      name: "Fokker D.VII",
      aliases: ["Fokker fighter"],
    },
    "wwii.usa.armor-medium": {
      name: "M4 Sherman",
      aliases: ["Sherman tank", "tanque americano Sherman"],
    },
    "wwii.britain.armor-heavy": {
      name: "Churchill Mk VII",
      aliases: ["Churchill infantry tank"],
    },
    "wwii.germany.armor-heavy": {
      name: "Tiger I",
      aliases: ["Panzer VI", "tanque alemão Tiger"],
    },
    "wwii.germany.armor-medium": {
      name: "Panther Ausf. G",
      aliases: ["Panzer V", "Panther tank"],
    },
    "wwii.ussr.armor-medium": {
      name: "T-34/76",
      aliases: ["T34", "tanque soviético 1943", "Soviet medium tank"],
    },
    "wwii.ussr.armor-heavy": {
      name: "IS-2",
      aliases: ["Iosif Stalin tank", "tanque pesado soviético"],
    },
    "wwii.japan.fighter": {
      name: "Mitsubishi A6M Zero",
      aliases: ["Zero fighter", "A6M"],
    },
    "modern.usa.armor-heavy": {
      name: "M1A2 Abrams",
      aliases: ["Abrams main battle tank", "MBT americano"],
    },
    "modern.britain.armor-heavy": {
      name: "Challenger 2",
      aliases: ["British main battle tank"],
    },
    "modern.russia.armor-heavy": {
      name: "T-90M",
      aliases: ["Russian main battle tank", "tanque russo"],
    },
    "modern.china.armor-heavy": {
      name: "Type 99A",
      aliases: ["ZTZ-99A", "Chinese main battle tank"],
    },
    "modern.iran.armor-heavy": {
      name: "Karrar",
      aliases: ["Iranian main battle tank", "tanque iraniano"],
    },
    "modern.iran.destroyer": {
      name: "Classe Moudge",
      aliases: ["Moudge frigate", "navio iraniano"],
    },
  };

interface GeneratedUnit {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly era: EraId;
  readonly nation: string;
  readonly nationAliases: readonly string[];
  readonly category: Category;
  readonly serviceFrom: number;
  readonly serviceTo: number;
  readonly svg: string;
  readonly app6: string;
  readonly tags: readonly string[];
  readonly color: string;
}

const units: readonly GeneratedUnit[] = eras.flatMap((era) =>
  era.nations.flatMap((nation) =>
    archetypes.map((archetype) => {
      const id = `${era.id}.${nation.id}.${archetype.id}`;
      const iconic = iconicNames[id];
      return {
        id,
        name: iconic?.name ?? `${archetype.name} — ${nation.name}`,
        aliases: [
          ...archetype.aliases,
          ...(iconic?.aliases ?? []),
          `${archetype.name} ${nation.name}`,
        ],
        era: era.id,
        nation: nation.name,
        nationAliases: nation.aliases,
        category: archetype.category,
        serviceFrom: era.from,
        serviceTo: era.to,
        svg: `plugin-content/unit-sprites.svg#${id}`,
        app6: archetype.app6,
        tags: [...archetype.tags, era.id, era.label, nation.id],
        color: nation.color,
      };
    }),
  ),
);

if (units.length !== 150) {
  throw new Error(`A biblioteca deveria conter 150 unidades; contém ${units.length}.`);
}

const unitJson = `${JSON.stringify(
  units.map(({ color: _color, ...unit }) => unit),
  null,
  2,
)}\n`;
const spriteSvg = renderUnitSprites(units);
const flagSvg = renderFlags(eras);
const flagsJson = `${JSON.stringify(
  eras.flatMap((era) =>
    era.nations.map((nation) => ({
      id: `${era.id}.${nation.id}`,
      name: `${nation.name} · ${era.label}`,
      era: era.id,
      nation: nation.name,
      svg: `plugin-content/flags.svg#${era.id}.${nation.id}`,
      tags: [era.id, era.label, nation.id, nation.name, ...nation.aliases],
    })),
  ),
  null,
  2,
)}\n`;
const palettesJson = `${JSON.stringify(
  [
    {
      id: "wwi-western-front",
      name: "Frente Ocidental 1914–18",
      colors: ["#5c6652", "#9c8b66", "#494b48", "#b8aa87", "#7b5546"],
    },
    {
      id: "wwii-europe",
      name: "Europa 1939–45",
      colors: ["#4d5842", "#82775a", "#303842", "#b0a47f", "#7e3e35"],
    },
    {
      id: "wwii-pacific",
      name: "Pacífico 1941–45",
      colors: ["#37505a", "#6e7950", "#b3a777", "#5d493b", "#a34b43"],
    },
    {
      id: "cold-war",
      name: "Guerra Fria",
      colors: ["#3e5b78", "#a23f3a", "#6f7764", "#d0c19b", "#2f353d"],
    },
    {
      id: "modern-desert",
      name: "Deserto moderno",
      colors: ["#b79d6b", "#70654e", "#55626a", "#d0bd92", "#72463c"],
    },
    {
      id: "hormuz",
      name: "Estreito de Hormuz",
      colors: ["#1f5268", "#5f8b89", "#b99c68", "#d3c39e", "#8c493f"],
    },
  ],
  null,
  2,
)}\n`;
const presetsJson = `${JSON.stringify(
  {
    scenes: [
      {
        id: "hormuz-blockade",
        name: "Bloqueio no Estreito de Hormuz",
        mapStyle: "satellite-offline",
        palette: "hormuz",
        camera: { center: [56.3, 26.5], zoom: 7.2, pitch: 42, bearing: -18 },
      },
      {
        id: "wwii-eastern-front",
        name: "Frente Oriental 1943",
        mapStyle: "minimal-political",
        palette: "wwii-europe",
        camera: { center: [35.2, 49.9], zoom: 4.8, pitch: 22, bearing: 0 },
      },
      {
        id: "wwi-western-front",
        name: "Frente Ocidental 1916",
        mapStyle: "minimal-political",
        palette: "wwi-western-front",
        camera: { center: [2.8, 49.8], zoom: 6, pitch: 18, bearing: 0 },
      },
    ],
    effects: [
      {
        id: "battle-smoke",
        name: "Fumaça de batalha",
        effect: "smoke",
        intensity: 0.72,
        params: { intensity: 0.72 },
      },
      {
        id: "artillery-impact",
        name: "Impacto de artilharia",
        effect: "explosion",
        intensity: 0.86,
        params: { intensity: 0.86 },
      },
      {
        id: "naval-wake",
        name: "Esteira naval",
        effect: "water",
        intensity: 0.58,
        params: { intensity: 0.58 },
      },
      {
        id: "night-vision",
        name: "Visão noturna",
        effect: "color-grade",
        intensity: 1,
        params: { exposure: 0.08, contrast: 0.4, saturation: -0.9, temperature: -0.25 },
      },
      {
        id: "archival-film",
        name: "Filme de arquivo",
        effect: "color-grade",
        intensity: 0.66,
        params: { exposure: -0.08, contrast: 0.22, saturation: -0.55, temperature: 0.18 },
      },
    ],
  },
  null,
  2,
)}\n`;

const outputs = new Map<string, string>([
  [resolve(outputDirectory, "unit-library.json"), unitJson],
  [resolve(outputDirectory, "unit-sprites.svg"), spriteSvg],
  [resolve(outputDirectory, "flags.svg"), flagSvg],
  [resolve(outputDirectory, "flags.json"), flagsJson],
  [resolve(outputDirectory, "palettes.json"), palettesJson],
  [resolve(outputDirectory, "presets.json"), presetsJson],
]);

const verifyOnly = process.argv.includes("--verify");
if (verifyOnly) {
  let failed = false;
  for (const [path, expected] of outputs) {
    const actual = await readFile(path, "utf8").catch(() => "");
    if (actual !== expected) {
      failed = true;
      process.stderr.write(`Conteúdo desatualizado: ${path}\n`);
    }
  }
  if (failed) process.exitCode = 1;
} else {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...outputs].map(([path, contents]) => writeFile(path, contents, "utf8")));
  process.stdout.write(`Conteúdo gerado: ${units.length} unidades em ${outputDirectory}\n`);
}

function renderUnitSprites(entries: readonly GeneratedUnit[]): string {
  const symbols = entries
    .map(
      (unit) => `  <symbol id="${unit.id}" viewBox="0 0 96 64">
    <title>${escapeXml(unit.name)}</title>
    <rect x="4" y="8" width="88" height="48" rx="5" fill="#f7f3e8" stroke="${unit.color}" stroke-width="4"/>
    ${categoryGlyph(unit.category)}
  </symbol>`,
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <metadata>150 símbolos de unidades compatíveis com a taxonomia NATO APP-6.</metadata>
${symbols}
</svg>\n`;
}

function categoryGlyph(category: Category): string {
  switch (category) {
    case "armor":
      return '<ellipse cx="48" cy="32" rx="21" ry="11" fill="none" stroke="#17212b" stroke-width="4"/>';
    case "infantry":
      return '<path d="M28 16 68 48M68 16 28 48" fill="none" stroke="#17212b" stroke-width="4"/>';
    case "artillery":
      return '<circle cx="48" cy="32" r="14" fill="none" stroke="#17212b" stroke-width="4"/><circle cx="48" cy="32" r="4" fill="#17212b"/>';
    case "air":
      return '<path d="m22 39 26-23 26 23-26-9z" fill="#17212b"/>';
    case "naval":
      return '<path d="M20 25h56L66 44H30zM38 16h20v9H38z" fill="#17212b"/>';
    case "support":
      return '<path d="M42 17h12v10h10v12H54v10H42V39H32V27h10z" fill="#17212b"/>';
  }
}

function renderFlags(eraSeeds: readonly EraSeed[]): string {
  const flags = eraSeeds
    .flatMap((era) =>
      era.nations.map(
        (nation) => `  <symbol id="${era.id}.${nation.id}" viewBox="0 0 72 48">
    <title>${escapeXml(nation.name)} · ${escapeXml(era.label)}</title>
    <rect width="72" height="48" rx="2" fill="${nation.color}"/>
    <path d="M0 32h72v16H0z" fill="#f2eee2" opacity=".72"/>
    <circle cx="36" cy="24" r="9" fill="#f2eee2" opacity=".88"/>
  </symbol>`,
      ),
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <metadata>Bandeiras estilizadas atuais e históricas, indexadas por era e nação.</metadata>
${flags}
</svg>\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
