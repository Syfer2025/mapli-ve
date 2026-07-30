import {
  SCENE_FORMAT_ID,
  SCENE_SCRIPT_VERSION,
  SceneScriptSchema,
  type Node,
  type ProjectDocument,
  type SceneScript,
} from "@theatrum/schema";
import type { ExportSceneResult, SceneDiagnostic } from "./contracts.js";
import { diagnostic, stableDiagnostics } from "./diagnostics.js";
import {
  hashSceneScriptDocument,
  SCENE_SCRIPT_DOCUMENT_HASH_PROP,
} from "./document-fingerprint.js";

/**
 * Exportação parcial Document → Scene Script.
 *
 * O compilador guarda a fonte normalizada no nó raiz. Isso preserva com
 * fidelidade tudo que ele próprio emitiu, enquanto nós manuais continuam sendo
 * conteúdo do documento e recebem aviso em vez de virar JSON inventado.
 */
export function exportDocumentToSceneScript(document: ProjectDocument): ExportSceneResult {
  const composition = document.compositions[0];
  if (composition === undefined) {
    return {
      scene: null,
      diagnostics: [
        diagnostic(
          "error",
          "unsupported-export",
          "/compositions",
          "o documento não possui composição",
        ),
      ],
    };
  }
  const root = composition?.nodes[composition.root];
  const source = root?.props["sourceSceneScript"];
  const parsed = SceneScriptSchema.safeParse(source);
  if (!parsed.success) {
    return exportGenericDocument(document);
  }

  const emittedNodeIds = new Set(
    Array.isArray(root?.props["emittedNodeIds"])
      ? root.props["emittedNodeIds"].filter((value): value is string => typeof value === "string")
      : [],
  );
  const extraNodes = Object.keys(composition.nodes).filter(
    (nodeId) => nodeId !== composition.root && !emittedNodeIds.has(nodeId),
  ).length;
  const emittedDocumentHash = root?.props[SCENE_SCRIPT_DOCUMENT_HASH_PROP];
  const documentChanged =
    typeof emittedDocumentHash === "string"
      ? emittedDocumentHash !== hashSceneScriptDocument(document)
      : extraNodes > 0;
  const diagnostics: SceneDiagnostic[] = [];
  if (documentChanged) {
    diagnostics.push(
      diagnostic(
        "warning",
        "unsupported-export",
        "/compositions/0",
        "conteúdo editado ou adicionado após a importação não entra no Scene Script parcial",
        { hint: "o projeto completo continua preservado no formato .theatrum" },
      ),
    );
  }
  return {
    scene: JSON.parse(JSON.stringify(parsed.data)) as SceneScript,
    diagnostics: stableDiagnostics(diagnostics),
  };
}

function exportGenericDocument(document: ProjectDocument): ExportSceneResult {
  const composition = document.compositions[0];
  if (composition === undefined) return { scene: null, diagnostics: [] };

  const paths = Object.fromEntries(
    Object.entries(document.paths)
      .filter(([, path]) => path.space === "geo" && path.vertices.length >= 2)
      .map(([pathId, path]) => [
        pathId,
        {
          through: path.vertices.map(
            (vertex) => [vertex.point[0], vertex.point[1]] as [number, number],
          ),
          smooth: path.interpolation !== "linear",
          geodesic: path.geodesic,
        },
      ]),
  );
  const units: Record<string, unknown>[] = [];
  const timeline: Record<string, unknown>[] = composition.markers.map((marker) => ({
    at: `${marker.frame}f`,
    do: "marker",
    label: marker.label,
    color: marker.color,
    ...(marker.comment === undefined ? {} : { comment: marker.comment }),
  }));
  let unsupported = document.compositions.length > 1;

  for (const node of Object.values(composition.nodes)) {
    if (node.id === composition.root) continue;
    const kind = sceneUnitKind(node);
    if (kind !== null && node.anchor.space === "geo") {
      const sceneUnitId =
        typeof node.props["sceneUnitId"] === "string" ? node.props["sceneUnitId"] : node.id;
      units.push({
        id: sceneUnitId,
        kind,
        at: [node.anchor.lngLat[0], node.anchor.lngLat[1]],
        label: node.name,
        ...(typeof node.transform.rotation.value === "number"
          ? { bearing: node.transform.rotation.value }
          : {}),
      });
      unsupported ||= hasUnsupportedNodeContent(node);
      continue;
    }

    const text = animatableString(node.props["text"]);
    if (text !== null && (node.type === "text.title" || node.type === "text.label")) {
      const duration = `${Math.max(0, node.timeRange.out - node.timeRange.in)}f`;
      if (node.type === "text.title") {
        timeline.push({
          at: `${node.timeRange.in}f`,
          do: "text.title",
          text,
          duration,
        });
      } else if (node.anchor.space === "geo") {
        timeline.push({
          at: `${node.timeRange.in}f`,
          do: "text.callout",
          text,
          at_place: [node.anchor.lngLat[0], node.anchor.lngLat[1]],
          duration,
        });
      } else {
        timeline.push({
          at: `${node.timeRange.in}f`,
          do: "text.caption",
          text,
          duration,
        });
      }
      unsupported ||= hasUnsupportedNodeContent(node);
      continue;
    }

    if (!isRepresentedRoute(node, paths)) unsupported = true;
  }

  // Actions sem metadados do verbo original não são convertidas por semelhança:
  // isso evitaria inventar intenção. A cena continua útil e o aviso é explícito.
  if (
    Object.values(composition.nodes).some(
      (node) => node.actions.length > 0 || node.effects.length > 0 || node.behaviors.length > 0,
    )
  ) {
    unsupported = true;
  }

  timeline.sort(
    (left, right) =>
      frameFromExportTime(left["at"]) - frameFromExportTime(right["at"]) ||
      String(left["do"]).localeCompare(String(right["do"]), "en"),
  );

  const candidate = {
    format: SCENE_FORMAT_ID,
    version: SCENE_SCRIPT_VERSION,
    meta: {
      title: composition.name.trim() === "" ? "Cena exportada" : composition.name,
      fps: composition.fps,
      resolution: `${composition.width}x${composition.height}`,
      duration: `${composition.duration}f`,
      background: composition.background,
    },
    map: {
      style: composition.map.styleId,
      projection: composition.map.projection,
      ...(composition.map.terrain === null
        ? {}
        : {
            terrain: {
              enabled: composition.map.terrain.enabled,
              exaggeration: composition.map.terrain.exaggeration,
            },
          }),
    },
    ...(Object.keys(paths).length === 0 ? {} : { paths }),
    ...(units.length === 0 ? {} : { units }),
    timeline,
  };
  const parsed = SceneScriptSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      scene: null,
      diagnostics: [
        diagnostic(
          "error",
          "unsupported-export",
          "/compositions/0",
          "a composição usa valores que Scene Script v1 não representa",
          {
            hint: parsed.error.issues[0]?.message ?? "ajuste FPS, mapa ou dimensões da composição",
          },
        ),
      ],
    };
  }

  return {
    scene: parsed.data,
    diagnostics: unsupported
      ? [
          diagnostic(
            "warning",
            "unsupported-export",
            "/compositions/0",
            "a exportação parcial omitiu conteúdo sem verbo Scene Script equivalente",
            { hint: "o projeto completo continua preservado no formato .theatrum" },
          ),
        ]
      : [],
  };
}

function sceneUnitKind(node: Node): "armor" | "infantry" | null {
  if (node.type === "unit.armor") return "armor";
  return node.type === "unit.infantry" ? "infantry" : null;
}

function animatableString(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value["value"] === "string" ? value["value"] : null;
}

function isRepresentedRoute(node: Node, paths: Readonly<Record<string, unknown>>): boolean {
  if (node.type !== "route") return false;
  const pathId = animatableString(node.props["pathId"]);
  return pathId !== null && Object.hasOwn(paths, pathId);
}

function hasUnsupportedNodeContent(node: Node): boolean {
  return (
    node.actions.length > 0 ||
    node.effects.length > 0 ||
    node.behaviors.length > 0 ||
    node.transform.position.keyframes.length > 0 ||
    node.transform.rotation.keyframes.length > 0 ||
    node.transform.scale.keyframes.length > 0 ||
    node.transform.opacity.keyframes.length > 0
  );
}

function frameFromExportTime(value: unknown): number {
  if (typeof value !== "string" || !value.endsWith("f")) return 0;
  const frame = Number(value.slice(0, -1));
  return Number.isFinite(frame) ? frame : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
