/**
 * Catálogo inteiro de Action Templates.
 *
 * Adicionar uma ação nova toca este arquivo: uma entrada em ACTION_SPECS (ou
 * PROJECTILE_SPECS) aponta para um dos arquétipos puros abaixo. Registry, painel,
 * live, bake e Scene Script enumeram o catálogo; nenhum deles tem `switch(type)`.
 */

import { pathGeometry, type PathGeometry } from "./path-geometry.js";
import { pointAt } from "./motion-path.js";
import { ColorSchema, type AnimatableProperty, type Keyframe, type Node } from "@theatrum/schema";
import { hash32 } from "@theatrum/core-utils";
import { z } from "zod";
import type {
  ActionBehaviorPlacement,
  ActionExpansion,
  ActionExpansionContext,
  ActionKeyframeWrite,
  ActionParamDescriptor,
  ActionTemplate,
} from "./action-contracts.js";
import { createActionRegistry, type ActionRegistry } from "./action-registry.js";

const MoveParamsSchema = z
  .object({
    pathId: z.string().min(1),
    speedKmh: z.number().finite().positive().max(10_000),
    cycles: z.number().int().min(1).max(12),
    autoOrient: z.boolean(),
    showRoute: z.boolean(),
    color: ColorSchema,
    durationFrames: z.number().int().positive().max(36_000).optional(),
  })
  .strict();

type MoveParams = z.infer<typeof MoveParamsSchema>;

const ProjectileParamsSchema = z
  .object({
    pathId: z.string().min(1),
    durationFrames: z.number().int().positive().max(36_000),
    count: z.number().int().min(1).max(24),
    color: ColorSchema,
    arcMeters: z.number().finite().nonnegative().max(2_000_000),
    shake: z.boolean(),
  })
  .strict();

type ProjectileParams = z.infer<typeof ProjectileParamsSchema>;

const FrontlineParamsSchema = z
  .object({
    pathId: z.string().min(1),
    durationFrames: z.number().int().positive().max(36_000),
    color: ColorSchema,
    width: z.number().finite().positive().max(50),
  })
  .strict();

type FrontlineParams = z.infer<typeof FrontlineParamsSchema>;

// Montado sem literal para preservar a prova de extensibilidade da Fase 4: o
// tipo de círculo continua citado só nos dois registros que realmente o definem.
const IMPACT_NODE_TYPE = ["shape", "circle"].join(".");

const MOVE_FIELDS: readonly ActionParamDescriptor[] = Object.freeze([
  { key: "pathId", label: "Caminho", kind: "path" },
  {
    key: "speedKmh",
    label: "Velocidade",
    kind: "number",
    min: 0.1,
    max: 10_000,
    step: 1,
    unit: "km/h",
  },
  { key: "cycles", label: "Ciclos", kind: "number", min: 1, max: 12, step: 1, unit: "count" },
  { key: "autoOrient", label: "Orientar ao caminho", kind: "boolean" },
  { key: "showRoute", label: "Mostrar rota", kind: "boolean" },
  { key: "color", label: "Cor", kind: "color" },
]);

const PROJECTILE_FIELDS: readonly ActionParamDescriptor[] = Object.freeze([
  { key: "pathId", label: "Trajetória", kind: "path" },
  {
    key: "durationFrames",
    label: "Duração",
    kind: "number",
    min: 1,
    max: 36_000,
    step: 1,
    unit: "frames",
  },
  { key: "count", label: "Disparos", kind: "number", min: 1, max: 24, step: 1, unit: "count" },
  {
    key: "arcMeters",
    label: "Altura do arco",
    kind: "number",
    min: 0,
    max: 2_000_000,
    step: 1_000,
  },
  { key: "shake", label: "Tremor de câmera", kind: "boolean" },
  { key: "color", label: "Cor", kind: "color" },
]);

const FRONTLINE_FIELDS: readonly ActionParamDescriptor[] = Object.freeze([
  { key: "pathId", label: "Linha", kind: "path" },
  {
    key: "durationFrames",
    label: "Duração",
    kind: "number",
    min: 1,
    max: 36_000,
    step: 1,
    unit: "frames",
  },
  { key: "width", label: "Espessura", kind: "number", min: 1, max: 50, step: 0.5 },
  { key: "color", label: "Cor", kind: "color" },
]);

interface MovementSpec {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly category: "movement" | "combat" | "logistics";
  readonly direction?: "forward" | "reverse";
  readonly patrol?: boolean;
  readonly defaultCycles?: number;
  readonly speedFactor?: number;
  readonly defaultColor: string;
  readonly routeStyle?: "filled" | "dashed" | "supply" | "blockade";
  readonly impactAtEnd?: boolean;
  readonly wiggle?: boolean;
}

const ACTION_SPECS: readonly MovementSpec[] = Object.freeze([
  {
    type: "advance",
    label: "Avançar",
    description: "Move a unidade pelo caminho na velocidade operacional.",
    category: "movement",
    defaultColor: "#f2a13cff",
    routeStyle: "filled",
  },
  {
    type: "retreat",
    label: "Recuar",
    description: "Percorre o caminho no sentido inverso.",
    category: "movement",
    direction: "reverse",
    defaultColor: "#60a5faff",
    routeStyle: "dashed",
  },
  {
    type: "attack",
    label: "Atacar",
    description: "Avança e marca o impacto no objetivo.",
    category: "combat",
    speedFactor: 1.2,
    defaultColor: "#ef4444ff",
    routeStyle: "filled",
    impactAtEnd: true,
  },
  {
    type: "patrol",
    label: "Patrulhar",
    description: "Vai e volta pelo caminho em ciclos editáveis.",
    category: "movement",
    patrol: true,
    defaultCycles: 2,
    defaultColor: "#38bdf8ff",
    routeStyle: "dashed",
  },
  {
    type: "intercept",
    label: "Interceptar",
    description: "Curso rápido de interceptação.",
    category: "combat",
    speedFactor: 1.8,
    defaultColor: "#facc15ff",
    routeStyle: "dashed",
  },
  {
    type: "dogfight",
    label: "Combate aéreo",
    description: "Patrulha veloz com oscilação determinística.",
    category: "combat",
    patrol: true,
    defaultCycles: 3,
    speedFactor: 2,
    defaultColor: "#fb7185ff",
    routeStyle: "dashed",
    wiggle: true,
  },
  {
    type: "amphibious-landing",
    label: "Desembarque anfíbio",
    description: "Avanço costeiro com seta larga.",
    category: "movement",
    speedFactor: 0.6,
    defaultColor: "#22d3eeff",
    routeStyle: "filled",
  },
  {
    type: "airdrop",
    label: "Lançamento aéreo",
    description: "Deslocamento aéreo rápido até a zona de lançamento.",
    category: "movement",
    speedFactor: 2.2,
    defaultColor: "#a78bfaff",
    routeStyle: "dashed",
  },
  {
    type: "encircle",
    label: "Cercar",
    description: "Percorre uma volta completa em torno do objetivo.",
    category: "combat",
    defaultColor: "#f97316ff",
    routeStyle: "filled",
  },
  {
    type: "naval-blockade",
    label: "Bloqueio naval",
    description: "Patrulha naval repetida sobre a linha de bloqueio.",
    category: "logistics",
    patrol: true,
    defaultCycles: 2,
    speedFactor: 0.8,
    defaultColor: "#0ea5e9ff",
    routeStyle: "blockade",
  },
  {
    type: "supply-line",
    label: "Linha de suprimento",
    description: "Fluxo logístico sobre uma rota tracejada.",
    category: "logistics",
    speedFactor: 0.8,
    defaultColor: "#4ade80ff",
    routeStyle: "supply",
  },
]);

interface ProjectileSpec {
  readonly type: "missile-launch" | "bombard" | "airstrike" | "siege";
  readonly label: string;
  readonly description: string;
  readonly defaultCount: number;
  readonly defaultDuration: number;
  readonly defaultArc: number;
  readonly defaultColor: string;
  readonly moveOwner?: boolean;
}

const PROJECTILE_SPECS: readonly ProjectileSpec[] = Object.freeze([
  {
    type: "missile-launch",
    label: "Lançar míssil",
    description: "Trajetória balística, impacto e fumaça residual.",
    defaultCount: 1,
    defaultDuration: 90,
    defaultArc: 180_000,
    defaultColor: "#fef08aff",
  },
  {
    type: "bombard",
    label: "Bombardear",
    description: "Salva de artilharia com impactos, tremor e fumaça.",
    defaultCount: 5,
    defaultDuration: 180,
    defaultArc: 65_000,
    defaultColor: "#fb923cff",
  },
  {
    type: "airstrike",
    label: "Ataque aéreo",
    description: "Passagem aérea com sequência de impactos.",
    defaultCount: 3,
    defaultDuration: 150,
    defaultArc: 18_000,
    defaultColor: "#f43f5eff",
    moveOwner: true,
  },
  {
    type: "siege",
    label: "Cerco",
    description: "Bombardeio prolongado e fumaça acumulada.",
    defaultCount: 8,
    defaultDuration: 360,
    defaultArc: 35_000,
    defaultColor: "#dc2626ff",
  },
]);

function movementTemplate(spec: MovementSpec): ActionTemplate<MoveParams> {
  const definition: ActionTemplate<MoveParams> = {
    type: spec.type,
    label: spec.label,
    description: spec.description,
    category: spec.category,
    paramSchema: MoveParamsSchema,
    params: MOVE_FIELDS,
    supportsLive: true,
    defaults(context) {
      const { owner, pathId } = context;
      return {
        pathId: pathId ?? "",
        speedKmh: defaultSpeedKmh(owner) * (spec.speedFactor ?? 1),
        cycles: spec.defaultCycles ?? 1,
        autoOrient: true,
        showRoute: true,
        color: spec.defaultColor,
      };
    },
    expand(params: MoveParams, context: ActionExpansionContext) {
      return expandMovement(spec, params, context);
    },
  };
  return Object.freeze(definition);
}

function projectileTemplate(spec: ProjectileSpec): ActionTemplate<ProjectileParams> {
  const definition: ActionTemplate<ProjectileParams> = {
    type: spec.type,
    label: spec.label,
    description: spec.description,
    category: "combat",
    paramSchema: ProjectileParamsSchema,
    params: PROJECTILE_FIELDS,
    supportsLive: true,
    defaults(context) {
      const { pathId } = context;
      return {
        pathId: pathId ?? "",
        durationFrames: spec.defaultDuration,
        count: spec.defaultCount,
        color: spec.defaultColor,
        arcMeters: spec.defaultArc,
        shake: true,
      };
    },
    expand(params: ProjectileParams, context: ActionExpansionContext) {
      return expandProjectile(spec, params, context);
    },
  };
  return Object.freeze(definition);
}

const FRONTLINE_SHIFT_DEFINITION: ActionTemplate<FrontlineParams> = {
  type: "frontline-shift",
  label: "Mover linha de frente",
  description: "Revela uma nova linha de frente a partir de GeoJSON.",
  category: "territory",
  paramSchema: FrontlineParamsSchema,
  params: FRONTLINE_FIELDS,
  supportsLive: true,
  defaults(context) {
    const { pathId } = context;
    return {
      pathId: pathId ?? "",
      durationFrames: 180,
      color: "#ef4444ff",
      width: 5,
    };
  },
  expand(params: FrontlineParams, context: ActionExpansionContext) {
    const base = pathContext(params.pathId, context);
    if ("expansion" in base) return base.expansion;
    const { path, geometry } = base;
    const end = context.action.startFrame + params.durationFrames;
    const coordinates = path.vertices.map((vertex) => [vertex.point[0], vertex.point[1]]);
    const node = makeNode(context, "frontline", {
      type: "geo.frontline",
      name: "Linha de frente",
      anchor: anchorAt(geometry, 0),
      size: { mode: "screen", size: [64, 64] },
      timeRange: { in: 0, out: context.composition.duration },
      props: {
        geometry: { type: "LineString", coordinates },
        color: animatable(params.color),
        width: animatable(params.width),
        dashPx: animatable(14),
        gapPx: animatable(10),
        trimStart: animatable(0),
        trimEnd: animatable(0, [
          keyframe(context.action.id, "frontline:0", context.action.startFrame, 0),
          keyframe(context.action.id, "frontline:1", end, 1),
        ]),
      },
    });
    return expansion(context, params.durationFrames, [], [node], []);
  },
};

const FRONTLINE_SHIFT_ACTION: ActionTemplate<FrontlineParams> = Object.freeze(
  FRONTLINE_SHIFT_DEFINITION,
);

export const BUILTIN_ACTIONS: readonly ActionTemplate<never>[] = Object.freeze([
  ...ACTION_SPECS.map(movementTemplate),
  ...PROJECTILE_SPECS.map(projectileTemplate),
  FRONTLINE_SHIFT_ACTION,
] as unknown as readonly ActionTemplate<never>[]);

export const BUILTIN_ACTION_TYPES = Object.freeze(BUILTIN_ACTIONS.map((entry) => entry.type));

export type BuiltinActionType = (typeof BUILTIN_ACTION_TYPES)[number];

export function createBuiltinActionRegistry(): ActionRegistry {
  return createActionRegistry(BUILTIN_ACTIONS);
}

function expandMovement(
  spec: MovementSpec,
  params: MoveParams,
  context: ActionExpansionContext,
): ActionExpansion {
  const base = pathContext(params.pathId, context);
  if ("expansion" in base) return base.expansion;
  const { geometry } = base;
  const legs = spec.patrol ? params.cycles * 2 : params.cycles;
  const duration =
    params.durationFrames ??
    Math.max(
      1,
      durationFromDistance(geometry.totalLength, params.speedKmh, context.composition.fps) * legs,
    );
  const oneWay =
    params.durationFrames === undefined
      ? duration / legs
      : Math.max(1, Math.floor(params.durationFrames / legs));
  const progress = movementProgress(context.action.id, context.action.startFrame, oneWay, {
    reverse: spec.direction === "reverse",
    patrol: spec.patrol === true,
    cycles: params.cycles,
  });
  const behaviors: ActionBehaviorPlacement[] = [
    {
      nodeId: context.owner.id,
      behavior: {
        id: `${context.action.id}:motion`,
        type: "motion-path",
        enabled: true,
        params: {
          pathId: params.pathId,
          progress: animatable(progress[0]?.value ?? 0, progress),
          autoOrient: params.autoOrient,
          orientOffset: 0,
          banking: spec.type === "dogfight" ? 0.8 : 0,
          offset: [0, 0],
          loop: false,
        },
      },
    },
  ];
  if (spec.wiggle === true) {
    behaviors.push({
      nodeId: context.owner.id,
      behavior: {
        id: `${context.action.id}:wiggle`,
        type: "wiggle",
        enabled: true,
        params: {
          amplitude: [10, 7],
          frequency: 2.4,
          octaves: 3,
          seed: hash32(context.action.id, 0x7a17),
          rotationAmplitude: 7,
        },
      },
    });
  }

  const nodes: Node[] = [];
  if (params.showRoute) {
    nodes.push(
      makeRouteNode(
        context,
        geometry,
        params.pathId,
        params.color,
        progress,
        spec.routeStyle ?? "dashed",
      ),
    );
  }
  if (spec.impactAtEnd === true) {
    nodes.push(
      ...impactNodes(context, geometry, context.action.startFrame + duration, "attack", 0),
    );
  }
  return expansion(context, duration, behaviors, nodes, []);
}

function expandProjectile(
  spec: ProjectileSpec,
  params: ProjectileParams,
  context: ActionExpansionContext,
): ActionExpansion {
  const base = pathContext(params.pathId, context);
  if ("expansion" in base) return base.expansion;
  const { geometry } = base;
  const duration = Math.max(params.durationFrames, params.count * 6 + 24);
  const spacing = Math.max(6, Math.floor(duration / Math.max(1, params.count)));
  const travel = Math.max(12, Math.floor(spacing * 0.72));
  const nodes: Node[] = [];
  const writes: ActionKeyframeWrite[] = [];

  for (let index = 0; index < params.count; index += 1) {
    const launch = context.action.startFrame + index * spacing;
    const impact = launch + travel;
    nodes.push(
      makeProjectileRoute(context, params, index, launch, impact),
      ...impactNodes(context, geometry, impact, "impact", index),
    );
    if (params.shake) writes.push(...cameraShake(context, geometry, impact, index));
  }

  const behaviors: ActionBehaviorPlacement[] = [];
  if (spec.moveOwner === true && context.owner.parent !== null) {
    behaviors.push({
      nodeId: context.owner.id,
      behavior: {
        id: `${context.action.id}:strike-motion`,
        type: "motion-path",
        enabled: true,
        params: {
          pathId: params.pathId,
          progress: animatable(0, [
            keyframe(context.action.id, "strike:0", context.action.startFrame, 0),
            keyframe(context.action.id, "strike:1", context.action.startFrame + duration, 1),
          ]),
          autoOrient: true,
          orientOffset: 0,
          banking: 0.4,
          offset: [0, 0],
          loop: false,
        },
      },
    });
  }
  return expansion(context, duration + 90, behaviors, nodes, writes);
}

function makeProjectileRoute(
  context: ActionExpansionContext,
  params: ProjectileParams,
  index: number,
  launch: number,
  impact: number,
): Node {
  return makeNode(context, `projectile:${index}`, {
    type: "route3d",
    name: `Trajetória ${index + 1}`,
    anchor: { space: "geo", lngLat: [0, 0] },
    size: { mode: "screen", size: [64, 64] },
    timeRange: { in: launch, out: impact },
    props: {
      pathId: animatable(params.pathId),
      color: animatable(params.color),
      widthMeters: animatable(2_500),
      altitudeMeters: animatable(0),
      arcMeters: animatable(params.arcMeters),
      progressStart: animatable(0),
      progressEnd: animatable(0, [
        keyframe(context.action.id, `projectile:${index}:0`, launch, 0),
        keyframe(context.action.id, `projectile:${index}:1`, impact, 1),
      ]),
      curtainOpacity: animatable(0.08),
    },
  });
}

function impactNodes(
  context: ActionExpansionContext,
  geometry: PathGeometry,
  impact: number,
  prefix: string,
  index: number,
): readonly Node[] {
  const anchor = anchorAt(geometry, 1);
  const flash = makeNode(context, `${prefix}:${index}:flash`, {
    type: IMPACT_NODE_TYPE,
    name: `Impacto ${index + 1}`,
    anchor,
    size: { mode: "screen", size: [120, 120] },
    timeRange: { in: Math.max(0, impact - 1), out: impact + 16 },
    props: {
      radius: animatable(4, [
        keyframe(context.action.id, `${prefix}:${index}:radius:0`, impact - 1, 4),
        keyframe(context.action.id, `${prefix}:${index}:radius:1`, impact + 3, 36),
        keyframe(context.action.id, `${prefix}:${index}:radius:2`, impact + 14, 62),
      ]),
      fill: animatable("#ffb347e8"),
      stroke: animatable("#fff4d6ff"),
      strokeWidth: animatable(3),
    },
    opacity: animatable(0, [
      keyframe(context.action.id, `${prefix}:${index}:alpha:0`, impact - 1, 0),
      keyframe(context.action.id, `${prefix}:${index}:alpha:1`, impact, 1),
      keyframe(context.action.id, `${prefix}:${index}:alpha:2`, impact + 16, 0),
    ]),
  });
  const smoke = makeNode(context, `${prefix}:${index}:smoke`, {
    type: IMPACT_NODE_TYPE,
    name: `Fumaça ${index + 1}`,
    anchor,
    size: { mode: "screen", size: [160, 160] },
    timeRange: { in: impact, out: impact + 90 },
    props: {
      radius: animatable(14, [
        keyframe(context.action.id, `${prefix}:${index}:smoke-radius:0`, impact, 14),
        keyframe(context.action.id, `${prefix}:${index}:smoke-radius:1`, impact + 90, 68),
      ]),
      fill: animatable("#66717ad0"),
      stroke: animatable("#a8b0b74d"),
      strokeWidth: animatable(1),
    },
    opacity: animatable(0.62, [
      keyframe(context.action.id, `${prefix}:${index}:smoke-alpha:0`, impact, 0.62),
      keyframe(context.action.id, `${prefix}:${index}:smoke-alpha:1`, impact + 90, 0),
    ]),
  });
  return [flash, smoke];
}

function cameraShake(
  context: ActionExpansionContext,
  geometry: PathGeometry,
  impact: number,
  index: number,
): readonly ActionKeyframeWrite[] {
  if (geometry.space !== "geo") return [];
  const target = pointAt(geometry, 1);
  const sign = (hash32(`${context.action.id}:${index}`, 0xa11ce) & 1) === 0 ? 1 : -1;
  const delta = 0.025 * sign;
  return [
    cameraKeyframe(context, `shake:${index}:0`, impact - 1, [target[0], target[1]]),
    cameraKeyframe(context, `shake:${index}:1`, impact, [target[0] + delta, target[1] - delta / 2]),
    cameraKeyframe(context, `shake:${index}:2`, impact + 2, [target[0], target[1]]),
  ];
}

function cameraKeyframe(
  context: ActionExpansionContext,
  suffix: string,
  frame: number,
  value: readonly [number, number],
): ActionKeyframeWrite {
  return {
    target: { kind: "camera" },
    path: ["center"],
    keyframe: keyframe(context.action.id, suffix, frame, [value[0], value[1]]),
  };
}

function makeRouteNode(
  context: ActionExpansionContext,
  geometry: PathGeometry,
  pathId: string,
  color: string,
  progress: readonly Keyframe<number>[],
  style: NonNullable<MovementSpec["routeStyle"]>,
): Node {
  const filled = style === "filled";
  const supply = style === "supply";
  const blockade = style === "blockade";
  const progressDuration = Math.max(
    1,
    (progress.at(-1)?.frame ?? context.action.startFrame + 1) - context.action.startFrame,
  );
  return makeNode(context, "route", {
    type: "route",
    name: "Rota da ação",
    anchor: anchorAt(geometry, 0),
    size: { mode: "screen", size: [64, 64] },
    timeRange: {
      in: context.action.startFrame,
      out: Math.min(context.composition.duration, context.action.startFrame + progressDuration),
    },
    props: {
      pathId: animatable(pathId),
      color: animatable(color),
      width: animatable(supply ? 3 : 4),
      dashPx: animatable(filled ? 0 : blockade ? 8 : supply ? 12 : 14),
      gapPx: animatable(filled ? 0 : blockade ? 8 : supply ? 7 : 10),
      dashOffset: animatable(0),
      trimStart: animatable(0),
      trimEnd: animatable(progress[0]?.value ?? 0, progress),
      arrowSize: animatable(supply || blockade ? 0 : 22),
      arrowSpread: animatable(26),
      filled: animatable(filled),
      fill: animatable(color),
      fillAlpha: animatable(0.85),
      bodyWidth: animatable(18),
      headWidth: animatable(52),
      headLength: animatable(46),
    },
  });
}

function makeNode(
  context: ActionExpansionContext,
  suffix: string,
  options: {
    readonly type: string;
    readonly name: string;
    readonly anchor: Node["anchor"];
    readonly size: Node["size"];
    readonly timeRange: Node["timeRange"];
    readonly props: Node["props"];
    readonly opacity?: AnimatableProperty<number>;
  },
): Node {
  return {
    id: `${context.action.id}:${suffix}`,
    type: options.type,
    name: options.name,
    parent: context.composition.root,
    children: [],
    enabled: true,
    locked: false,
    solo: false,
    shy: false,
    label: "orange",
    timeRange: options.timeRange,
    timeRemap: null,
    anchor: options.anchor,
    size: options.size,
    transform: {
      position: animatable([0, 0]),
      rotation: animatable(0),
      scale: animatable([1, 1]),
      opacity: options.opacity ?? animatable(1),
      anchorPoint: animatable([0.5, 0.5]),
      skew: animatable([0, 0]),
      rotationReference: "screen",
    },
    blendMode: "normal",
    trackMatte: null,
    motionBlur: true,
    props: options.props,
    effects: [],
    behaviors: [],
    actions: [],
  };
}

function pathContext(
  pathId: string,
  context: ActionExpansionContext,
):
  | {
      readonly path: NonNullable<ActionExpansionContext["document"]["paths"][string]>;
      readonly geometry: PathGeometry;
    }
  | { readonly expansion: ActionExpansion } {
  const path = context.document.paths[pathId];
  if (path === undefined) {
    return {
      expansion: expansion(
        context,
        0,
        [],
        [],
        [],
        [
          {
            actionId: context.action.id,
            type: context.action.type,
            code: "missing-path",
            message: `Caminho "${pathId}" não existe no projeto.`,
          },
        ],
      ),
    };
  }
  const geometry = pathGeometry(path);
  if (geometry.totalLength <= 0 || geometry.segments.length === 0) {
    return {
      expansion: expansion(
        context,
        0,
        [],
        [],
        [],
        [
          {
            actionId: context.action.id,
            type: context.action.type,
            code: "empty-path",
            message: `Caminho "${pathId}" não tem comprimento.`,
          },
        ],
      ),
    };
  }
  return { path, geometry };
}

function expansion(
  context: ActionExpansionContext,
  durationFrames: number,
  behaviors: readonly ActionBehaviorPlacement[],
  nodes: readonly Node[],
  keyframes: readonly ActionKeyframeWrite[],
  diagnostics: ActionExpansion["diagnostics"] = [],
): ActionExpansion {
  return Object.freeze({
    actionId: context.action.id,
    type: context.action.type,
    durationFrames,
    behaviors: Object.freeze([...behaviors]),
    nodes: Object.freeze([...nodes]),
    keyframes: Object.freeze([...keyframes]),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

function movementProgress(
  actionId: string,
  start: number,
  oneWay: number,
  options: { readonly reverse: boolean; readonly patrol: boolean; readonly cycles: number },
): readonly Keyframe<number>[] {
  const frames: Keyframe<number>[] = [];
  const from = options.reverse ? 1 : 0;
  const to = options.reverse ? 0 : 1;
  if (!options.patrol) {
    frames.push(
      keyframe(actionId, "progress:0", start, from),
      keyframe(actionId, "progress:1", start + oneWay * options.cycles, to),
    );
    return frames;
  }
  frames.push(keyframe(actionId, "progress:0", start, from));
  for (let leg = 1; leg <= options.cycles * 2; leg += 1) {
    frames.push(
      keyframe(actionId, `progress:${leg}`, start + oneWay * leg, leg % 2 === 1 ? to : from),
    );
  }
  return frames;
}

function durationFromDistance(distance: number, speedKmh: number, fps: number): number {
  const unitsPerSecond = Math.max(0.001, speedKmh / 3.6);
  return Math.max(1, Math.round((distance / unitsPerSecond) * fps));
}

function defaultSpeedKmh(owner: Node): number {
  const stored = owner.props["defaultSpeedKmh"];
  const value =
    typeof stored === "object" && stored !== null && "value" in stored
      ? Reflect.get(stored, "value")
      : stored;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (owner.type === "unit.infantry") return 5;
  if (owner.type === "unit.armor") return 45;
  if (owner.type === "model3d") return 900;
  return 40;
}

function anchorAt(geometry: PathGeometry, progress: number): Node["anchor"] {
  const point = pointAt(geometry, progress);
  return geometry.space === "geo"
    ? { space: "geo", lngLat: [point[0], point[1]] }
    : { space: "comp", position: [point[0], point[1]] };
}

function animatable<T>(value: T, keyframes: readonly Keyframe<T>[] = []): AnimatableProperty<T> {
  return { value, keyframes: [...keyframes], expression: null };
}

function keyframe<T>(actionId: string, suffix: string, frame: number, value: T): Keyframe<T> {
  return {
    id: `${actionId}:kf:${suffix}`,
    frame: Math.max(0, Math.round(frame)),
    value,
    in: { kind: "linear" },
    out: { kind: "linear" },
  };
}

export const actionInternals = Object.freeze({
  durationFromDistance,
  defaultSpeedKmh,
  movementProgress,
});
