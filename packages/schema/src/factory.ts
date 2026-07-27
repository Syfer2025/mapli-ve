import {
  ProjectDocumentSchema,
  type ProjectDocument,
  type ProjectSettings,
} from "./project-document.js";
import { SCHEMA_VERSION } from "./branding.js";

export interface EmptyProjectOptions {
  readonly id?: string;
  readonly name?: string;
  readonly compositionId?: string;
  readonly compositionName?: string;
  readonly rootNodeId?: string;
  readonly settings?: Partial<ProjectSettings>;
}

/**
 * Documento mínimo determinístico. Não consulta relógio, UUID ou aleatoriedade:
 * os chamadores que precisam de identidade única devem fornecê-la explicitamente.
 */
export function createEmptyProjectDocument(options: EmptyProjectOptions = {}): ProjectDocument {
  const projectId = options.id ?? "prj_untitled";
  const projectName = options.name ?? "Sem título";
  const compositionId = options.compositionId ?? "cmp_main";
  const compositionName = options.compositionName ?? "Principal";
  const rootNodeId = options.rootNodeId ?? "nd_root";
  const defaultResolution = options.settings?.defaultResolution ?? [1920, 1080];
  const defaultFps = options.settings?.defaultFps ?? 60;
  const duration = Math.round(defaultFps * 10);

  return ProjectDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: projectId,
    name: projectName,
    settings: {
      defaultFps,
      defaultResolution,
      units: options.settings?.units ?? "metric",
      dateFormat: options.settings?.dateFormat ?? "dd/MM/yyyy",
      language: options.settings?.language ?? "pt-BR",
      colorSpace: options.settings?.colorSpace ?? "srgb",
    },
    assets: [],
    geoData: [],
    paths: {},
    styles: [],
    palettes: [],
    compositions: [
      {
        id: compositionId,
        name: compositionName,
        fps: defaultFps,
        duration,
        width: defaultResolution[0],
        height: defaultResolution[1],
        pixelAspect: 1,
        workArea: [0, duration],
        background: "#0a0e14",
        map: {
          styleId: "style_minimal_political",
          projection: "mercator",
          terrain: null,
          visible: true,
          fadeDuration: 0,
        },
        camera: {
          center: animatable([0, 20]),
          zoom: animatable(2),
          bearing: animatable(0),
          pitch: animatable(0),
          roll: animatable(0),
          fov: animatable(36.87),
          follow: null,
          path: null,
        },
        root: rootNodeId,
        nodes: {
          [rootNodeId]: {
            id: rootNodeId,
            type: "group",
            name: "Cena",
            parent: null,
            children: [],
            enabled: true,
            locked: false,
            solo: false,
            shy: false,
            label: "none",
            timeRange: { in: 0, out: duration },
            timeRemap: null,
            anchor: { space: "comp", position: [0, 0] },
            size: { mode: "screen", size: defaultResolution },
            transform: {
              position: animatable([0, 0]),
              rotation: animatable(0),
              scale: animatable([1, 1]),
              opacity: animatable(1),
              anchorPoint: animatable([0, 0]),
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
          },
        },
        markers: [],
        guides: [],
        seed: 0,
      },
    ],
  });
}

function animatable<T>(value: T) {
  return { value, keyframes: [], expression: null };
}
