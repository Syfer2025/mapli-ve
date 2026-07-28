/**
 * Gera os três projetos didáticos distribuídos com o Theatrum.
 *
 * Os containers são determinísticos: duas execuções produzem os mesmos bytes.
 * Não há asset externo; cada exemplo abre apenas com os dados offline do pacote.
 */

import { serializeProjectContainer, parseProjectContainer } from "@theatrum/project-io";
import {
  createEmptyProjectDocument,
  type ActionInstanceData,
  type Node,
  type PathData,
  type ProjectDocument,
} from "@theatrum/schema";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ExampleSpec {
  readonly filename: string;
  readonly projectId: string;
  readonly name: string;
  readonly subtitle: string;
  readonly camera: {
    readonly center: readonly [number, number];
    readonly zoom: number;
    readonly bearing: number;
    readonly pitch: number;
  };
  readonly duration: number;
  readonly path: PathData;
  readonly owner: {
    readonly id: string;
    readonly name: string;
    readonly anchor: readonly [number, number];
    readonly label: string;
    readonly color: string;
    readonly type: "unit.armor" | "unit.infantry" | "null";
  };
  readonly action: ActionInstanceData;
  readonly targetLabel: {
    readonly text: string;
    readonly anchor: readonly [number, number];
  };
  readonly notes: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "examples");

const EXAMPLES: readonly ExampleSpec[] = [
  {
    filename: "01-hormuz-bloqueio-naval.theatrum",
    projectId: "prj_example_hormuz_blockade",
    name: "Hormuz — bloqueio naval",
    subtitle: "Patrulha no Estreito de Hormuz",
    camera: { center: [56.35, 26.35], zoom: 7.2, bearing: -18, pitch: 28 },
    duration: 1_800,
    path: {
      id: "path_hormuz_blockade",
      name: "Linha de bloqueio",
      space: "geo",
      vertices: [
        { point: [55.35, 26.35], inHandle: null, outHandle: null },
        { point: [56.1, 26.62], inHandle: null, outHandle: null },
        { point: [56.95, 26.25], inHandle: null, outHandle: null },
        { point: [56.25, 25.78], inHandle: null, outHandle: null },
        { point: [55.35, 26.35], inHandle: null, outHandle: null },
      ],
      closed: true,
      interpolation: "catmull-rom",
      geodesic: true,
    },
    owner: {
      id: "nd_fleet",
      name: "Força naval",
      anchor: [55.35, 26.35],
      label: "FROTA",
      color: "#38bdf8ff",
      type: "unit.armor",
    },
    action: {
      id: "action_hormuz_blockade",
      type: "naval-blockade",
      enabled: true,
      mode: "live",
      startFrame: 60,
      params: {
        pathId: "path_hormuz_blockade",
        speedKmh: 150_000,
        cycles: 2,
        autoOrient: true,
        showRoute: true,
        color: "#0ea5e9ff",
      },
    },
    targetLabel: { text: "ESTREITO DE HORMUZ", anchor: [56.45, 26.55] },
    notes:
      "Selecione “Força naval” e abra o painel Ações para alterar velocidade, ciclos e cor. No viewport, escolha Satélite híbrido para combinar a cobertura local com ruas e rótulos.",
  },
  {
    filename: "02-hormuz-lancamento-missil.theatrum",
    projectId: "prj_example_hormuz_missile",
    name: "Hormuz — lançamento de míssil",
    subtitle: "Trajetória balística e impacto",
    camera: { center: [56.15, 26.2], zoom: 6.8, bearing: 12, pitch: 42 },
    duration: 720,
    path: {
      id: "path_hormuz_missile",
      name: "Bandar Abbas → Fujairah",
      space: "geo",
      vertices: [
        { point: [56.2666, 27.1832], inHandle: null, outHandle: [0.15, -0.3] },
        { point: [56.3265, 25.1288], inHandle: [-0.1, 0.35], outHandle: null },
      ],
      closed: false,
      interpolation: "bezier",
      geodesic: true,
    },
    owner: {
      id: "nd_launcher",
      name: "Lançador",
      anchor: [56.2666, 27.1832],
      label: "LÇ",
      color: "#fef08aff",
      type: "unit.armor",
    },
    action: {
      id: "action_hormuz_missile",
      type: "missile-launch",
      enabled: true,
      mode: "live",
      startFrame: 90,
      params: {
        pathId: "path_hormuz_missile",
        durationFrames: 210,
        count: 1,
        color: "#fef08aff",
        arcMeters: 180_000,
        shake: true,
      },
    },
    targetLabel: { text: "ALVO", anchor: [56.3265, 25.1288] },
    notes:
      "Reproduza a partir do frame 90. A ação cria rota 3D, impacto, fumaça e tremor de câmera. Use “Converter em keyframes” para editar cada parte individualmente.",
  },
  {
    filename: "03-ira-linha-de-frente.theatrum",
    projectId: "prj_example_iran_frontline",
    name: "Irã — linha de frente",
    subtitle: "Revelação territorial editável",
    camera: { center: [56.05, 28.35], zoom: 6.1, bearing: -8, pitch: 18 },
    duration: 720,
    path: {
      id: "path_iran_frontline",
      name: "Linha de frente",
      space: "geo",
      vertices: [
        { point: [54.4, 28.05], inHandle: null, outHandle: null },
        { point: [55.15, 28.75], inHandle: null, outHandle: null },
        { point: [56.05, 28.35], inHandle: null, outHandle: null },
        { point: [57.0, 28.8], inHandle: null, outHandle: null },
        { point: [57.75, 28.15], inHandle: null, outHandle: null },
      ],
      closed: false,
      interpolation: "catmull-rom",
      geodesic: true,
    },
    owner: {
      id: "nd_frontline_control",
      name: "Controle da linha",
      anchor: [54.4, 28.05],
      label: "",
      color: "#ef4444ff",
      type: "null",
    },
    action: {
      id: "action_iran_frontline",
      type: "frontline-shift",
      enabled: true,
      mode: "live",
      startFrame: 75,
      params: {
        pathId: "path_iran_frontline",
        durationFrames: 300,
        width: 7,
        color: "#ef4444ff",
      },
    },
    targetLabel: { text: "LINHA DE FRENTE", anchor: [56.05, 28.55] },
    notes:
      "Edite os vértices do caminho e a linha atualiza sem recriar a ação. O parâmetro Duração controla a revelação. O projeto é independente de assets 3D externos.",
  },
];

await mkdir(outputDirectory, { recursive: true });
for (const spec of EXAMPLES) {
  const document = exampleDocument(spec);
  const serialized = serializeProjectContainer({
    document,
    app: { version: "0.1.0" },
    notes: spec.notes,
  });
  if (!serialized.ok) throw new Error(serialized.error.message);
  const reopened = parseProjectContainer(serialized.value);
  if (!reopened.ok) throw new Error(reopened.error.message);
  const target = resolve(outputDirectory, spec.filename);
  await writeFile(target, serialized.value);
  const hash = createHash("sha256").update(serialized.value).digest("hex");
  console.log(`✓ ${spec.filename} · ${serialized.value.byteLength} bytes · ${hash.slice(0, 16)}…`);
}

function exampleDocument(spec: ExampleSpec): ProjectDocument {
  const document = structuredClone(
    createEmptyProjectDocument({
      id: spec.projectId,
      name: spec.name,
      compositionId: `cmp_${spec.projectId.slice(4)}`,
      compositionName: spec.subtitle,
      rootNodeId: `root_${spec.projectId.slice(4)}`,
      settings: { defaultFps: 30, defaultResolution: [1920, 1080] },
    }),
  );
  const composition = document.compositions[0];
  if (composition === undefined) throw new Error("exemplo sem composição");
  const rootNode = composition.nodes[composition.root];
  if (rootNode === undefined) throw new Error("exemplo sem raiz");

  composition.duration = spec.duration;
  composition.workArea = [0, spec.duration];
  rootNode.timeRange = { in: 0, out: spec.duration };
  composition.camera.center = animatable([...spec.camera.center]);
  composition.camera.zoom = animatable(spec.camera.zoom);
  composition.camera.bearing = animatable(spec.camera.bearing);
  composition.camera.pitch = animatable(spec.camera.pitch);
  document.paths[spec.path.id] = structuredClone(spec.path);

  const owner = exampleNode(spec, spec.owner.id, spec.owner.type, spec.owner.name, {
    anchor: { space: "geo", lngLat: [...spec.owner.anchor] },
    size: { mode: "screen", size: [68, 68] },
    label: "cyan",
    props:
      spec.owner.type === "null"
        ? {}
        : {
            assetId: animatable("lib:unit.armor.default"),
            callsign: animatable(spec.owner.label),
            affiliation: animatable("friendly"),
            tint: animatable(spec.owner.color),
            defaultSpeedKmh: animatable(45),
          },
    actions: [structuredClone(spec.action)],
  });
  const title = exampleNode(spec, "nd_example_title", "text.title", spec.subtitle, {
    anchor: { space: "comp", position: [960, 82] },
    size: { mode: "screen", size: [1_600, 112] },
    props: textProps(spec.subtitle, 52, 700, "#ffffffff", 1.1, "#071119e6", 4),
  });
  const label = exampleNode(spec, "nd_example_target", "text.label", spec.targetLabel.text, {
    anchor: { space: "geo", lngLat: [...spec.targetLabel.anchor] },
    size: { mode: "screen", size: [320, 64] },
    props: textProps(spec.targetLabel.text, 24, 700, "#fff4d6ff", 1.2, "#071119f2", 3),
  });

  composition.nodes[owner.id] = owner;
  composition.nodes[title.id] = title;
  composition.nodes[label.id] = label;
  rootNode.children.push(owner.id, title.id, label.id);
  composition.markers = [
    { frame: spec.action.startFrame, label: "Início da ação", color: "#f2a13cff" },
  ];
  return document;
}

function exampleNode(
  spec: ExampleSpec,
  id: string,
  type: string,
  name: string,
  overrides: Partial<Node>,
): Node {
  return {
    id,
    type,
    name,
    parent: `root_${spec.projectId.slice(4)}`,
    children: [],
    enabled: true,
    locked: false,
    solo: false,
    shy: false,
    label: "none",
    timeRange: { in: 0, out: spec.duration },
    timeRemap: null,
    anchor: { space: "comp", position: [0, 0] },
    size: { mode: "screen", size: [64, 64] },
    transform: {
      position: animatable([0, 0]),
      rotation: animatable(0),
      scale: animatable([1, 1]),
      opacity: animatable(1),
      anchorPoint: animatable([0.5, 0.5]),
      skew: animatable([0, 0]),
      rotationReference: "screen",
    },
    blendMode: "normal",
    trackMatte: null,
    motionBlur: false,
    props: {},
    effects: [],
    behaviors: [],
    actions: [],
    ...overrides,
  };
}

function textProps(
  text: string,
  fontSize: number,
  fontWeight: number,
  color: string,
  lineHeight: number,
  halo: string,
  haloWidth: number,
): Node["props"] {
  return {
    text: animatable(text),
    fontFamily: animatable("Open Sans"),
    fontSize: animatable(fontSize),
    fontWeight: animatable(fontWeight),
    color: animatable(color),
    align: animatable("center"),
    lineHeight: animatable(lineHeight),
    tracking: animatable(0),
    halo: animatable(halo),
    haloWidth: animatable(haloWidth),
    maxWidth: animatable(0),
  };
}

function animatable<T>(value: T) {
  return { value, keyframes: [], expression: null };
}
