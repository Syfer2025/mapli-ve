import { MAT2D_IDENTITY, mat2d, rect, vec2, type Mat2D, type Vec2 } from "@theatrum/core-math";
import type { Anchor, SizeSpec } from "@theatrum/schema";
import type {
  EvaluatedNodeLike,
  EvaluatedSceneLike,
  LayoutContext,
  NodeLayout,
  ProjectorPortLike,
  ScreenScene,
} from "./contracts.js";
import { SceneGraphInvariantError } from "./errors.js";

const DEFAULT_LAYOUT_CONTEXT: LayoutContext = Object.freeze({});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Resolve a origem base do nó. Anchors geo usam sempre a porta de projeção;
 * nenhuma aproximação Mercator é permitida nesta camada.
 */
export function resolveAnchor(
  anchor: Anchor,
  projector: ProjectorPortLike,
  context: LayoutContext = DEFAULT_LAYOUT_CONTEXT,
): Vec2 {
  switch (anchor.space) {
    case "geo": {
      const terrain = projector.elevationAt(anchor.lngLat) ?? 0;
      const altitude = terrain + (anchor.altitude ?? 0);
      return finiteVec2(
        projector.project(anchor.lngLat, altitude),
        "ProjectorPort.project devolveu um ponto inválido.",
      );
    }
    case "comp":
      return context.compToScreen === undefined
        ? finiteVec2(anchor.position, "Anchor comp inválido.")
        : finiteVec2(
            mat2d.applyPoint(context.compToScreen, anchor.position),
            "Anchor comp transformado inválido.",
          );
    case "parent":
      return finiteVec2(anchor.offset, "Offset de parent inválido.");
  }
}

/**
 * Converte tamanho para pixels. `at` é `[lng, lat]`; metersPerPixel tem unidade
 * metros/pixel, portanto a conversão correta é `metros / metrosPorPixel`.
 */
export function resolveSize(size: SizeSpec, projector: ProjectorPortLike, at: Vec2): Vec2 {
  if (size.mode === "screen") {
    return nonNegativeVec2(size.size, "Tamanho screen");
  }

  const meters = nonNegativeVec2(size.meters, "Tamanho ground");
  const metersPerPixel = projector.metersPerPixel(at[1]);
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    throw new SceneGraphInvariantError(
      `ProjectorPort.metersPerPixel devolveu ${String(metersPerPixel)} em latitude ${String(at[1])}.`,
    );
  }
  return finiteVec2(
    [meters[0] / metersPerPixel, meters[1] / metersPerPixel],
    "Tamanho ground resolvido inválido.",
  );
}

export function resolveRotation(
  rotation: number,
  reference: EvaluatedNodeLike["transform"]["rotationReference"],
  projector: ProjectorPortLike,
): number {
  const resolved =
    reference === "geo-bearing" ? projector.bearingToScreenAngle(rotation) : rotation;
  if (!Number.isFinite(resolved)) {
    throw new SceneGraphInvariantError(`Rotação resolvida inválida: ${String(resolved)}.`);
  }
  return resolved;
}

/**
 * Matriz local sem acumular o pai. Para `size:ground` em anchor não geo, o
 * chamador pode fornecer a referência geográfica no contexto.
 */
export function localMatrix(
  node: EvaluatedNodeLike,
  projector: ProjectorPortLike,
  context: LayoutContext = DEFAULT_LAYOUT_CONTEXT,
): Mat2D {
  const anchor = resolveAnchor(node.anchor, projector, context);
  const at =
    node.size.mode === "ground"
      ? groundReference(node, projector, context, anchor)
      : ([0, 0] as const);
  const size = resolveSize(node.size, projector, at);
  return composeLocalMatrix(node, projector, anchor, size);
}

/**
 * Resolve a matriz mundial sob demanda e detecta ciclos/missing parents mesmo
 * quando recebe uma cena sintética fora do documento validado.
 */
export function worldMatrix(
  scene: EvaluatedSceneLike,
  nodeId: string,
  projector: ProjectorPortLike,
  context: LayoutContext = DEFAULT_LAYOUT_CONTEXT,
): Mat2D {
  return resolveLayout(scene, nodeId, projector, context, new Map(), new Set()).matrix;
}

export function layoutNode(
  scene: EvaluatedSceneLike,
  nodeId: string,
  projector: ProjectorPortLike,
  context: LayoutContext = DEFAULT_LAYOUT_CONTEXT,
): NodeLayout {
  return resolveLayout(scene, nodeId, projector, context, new Map(), new Set());
}

export function layoutScene<S>(
  scene: EvaluatedSceneLike,
  projector: ProjectorPortLike<S>,
  context: LayoutContext = DEFAULT_LAYOUT_CONTEXT,
): ScreenScene<S> {
  validateDrawOrder(scene);
  const layouts = new Map<string, NodeLayout>();
  const visiting = new Set<string>();
  // `drawOrder` já é explícita, validada e independente da inserção do Map.
  // Reutilizá-la evita ordenar todos os ids em cada frame.
  for (const nodeId of scene.drawOrder) {
    resolveLayout(scene, nodeId, projector, context, layouts, visiting);
  }

  return Object.freeze({
    frame: scene.frame,
    projector: projector.snapshot(),
    layouts,
    drawOrder: Object.freeze([...scene.drawOrder]),
  });
}

function resolveLayout(
  scene: EvaluatedSceneLike,
  nodeId: string,
  projector: ProjectorPortLike,
  context: LayoutContext,
  cache: Map<string, NodeLayout>,
  visiting: Set<string>,
): NodeLayout {
  const cached = cache.get(nodeId);
  if (cached !== undefined) return cached;
  const node = scene.nodes.get(nodeId);
  if (node === undefined) {
    throw new SceneGraphInvariantError(`Nó avaliado não encontrado: "${nodeId}".`);
  }
  if (visiting.has(nodeId)) {
    throw new SceneGraphInvariantError(`Ciclo de parentesco avaliado em "${nodeId}".`);
  }

  visiting.add(nodeId);
  try {
    const parentLayout =
      node.parent === null
        ? undefined
        : resolveLayout(scene, node.parent, projector, context, cache, visiting);
    const parentMatrix = parentLayout?.matrix ?? MAT2D_IDENTITY;
    const anchorLocal = resolveAnchor(node.anchor, projector, context);
    const projectedAnchor = mat2d.applyPoint(parentMatrix, anchorLocal);
    const at =
      node.size.mode === "ground"
        ? groundReference(node, projector, context, projectedAnchor)
        : ([0, 0] as const);
    const sizePx = resolveSize(node.size, projector, at);
    const local = composeLocalMatrix(node, projector, anchorLocal, sizePx);
    const matrix = finiteMatrix(
      mat2d.multiply(parentMatrix, local),
      `Matriz mundial inválida para "${node.id}".`,
    );
    const pivot: Vec2 = [
      node.transform.anchorPoint[0] * sizePx[0],
      node.transform.anchorPoint[1] * sizePx[1],
    ];
    const anchorPx = finiteVec2(
      mat2d.applyPoint(matrix, pivot),
      `Anchor mundial inválido para "${node.id}".`,
    );
    const bounds = rect.fromPoints([
      mat2d.applyPoint(matrix, [0, 0]),
      mat2d.applyPoint(matrix, [sizePx[0], 0]),
      mat2d.applyPoint(matrix, [sizePx[0], sizePx[1]]),
      mat2d.applyPoint(matrix, [0, sizePx[1]]),
    ]);
    const outsideViewport =
      context.viewport !== undefined && !rect.intersects(bounds, context.viewport);
    const result: NodeLayout = Object.freeze({
      matrix,
      localMatrix: local,
      anchorPx,
      sizePx: Object.freeze(sizePx),
      bounds: Object.freeze(bounds),
      culled: !node.visible || outsideViewport,
    });
    cache.set(nodeId, result);
    return result;
  } finally {
    visiting.delete(nodeId);
  }
}

function composeLocalMatrix(
  node: EvaluatedNodeLike,
  projector: ProjectorPortLike,
  anchor: Vec2,
  sizePx: Vec2,
): Mat2D {
  const transform = node.transform;
  const position = vec2.add(anchor, finiteVec2(transform.position, "Posição inválida."));
  const scale = finiteVec2(transform.scale, "Escala inválida.");
  const skew = finiteVec2(transform.skew, "Skew inválido.");
  const anchorPoint = finiteVec2(transform.anchorPoint, "Anchor point inválido.");
  const pivot: Vec2 = [anchorPoint[0] * sizePx[0], anchorPoint[1] * sizePx[1]];
  return finiteMatrix(
    mat2d.compose({
      position,
      rotation: resolveRotation(transform.rotation, transform.rotationReference, projector),
      scale,
      skew,
      anchor: pivot,
    }),
    `Matriz local inválida para "${node.id}".`,
  );
}

function groundReference(
  node: EvaluatedNodeLike,
  projector: ProjectorPortLike,
  context: LayoutContext,
  projectedAnchor: Vec2,
): Vec2 {
  if (node.anchor.space === "geo") return node.anchor.lngLat;
  if (context.groundReference !== undefined) {
    return finiteVec2(context.groundReference, "groundReference inválido.");
  }
  return finiteVec2(
    projector.unproject(projectedAnchor),
    "ProjectorPort.unproject devolveu uma coordenada inválida.",
  );
}

function validateDrawOrder(scene: EvaluatedSceneLike): void {
  const seen = new Set<string>();
  for (const nodeId of scene.drawOrder) {
    if (seen.has(nodeId)) {
      throw new SceneGraphInvariantError(`drawOrder contém o nó duplicado "${nodeId}".`);
    }
    seen.add(nodeId);
    if (!scene.nodes.has(nodeId)) {
      throw new SceneGraphInvariantError(`drawOrder referencia o nó inexistente "${nodeId}".`);
    }
  }
  if (seen.size !== scene.nodes.size) {
    const missing = [...scene.nodes.keys()]
      .filter((nodeId) => !seen.has(nodeId))
      .sort(compareStrings);
    throw new SceneGraphInvariantError(`drawOrder não contém todos os nós: ${missing.join(", ")}.`);
  }
}

function finiteVec2(value: Vec2, message: string): Vec2 {
  if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new SceneGraphInvariantError(message);
  }
  return [value[0], value[1]];
}

function nonNegativeVec2(value: Vec2, label: string): Vec2 {
  const finite = finiteVec2(value, `${label} deve conter números finitos.`);
  if (finite[0] < 0 || finite[1] < 0) {
    throw new SceneGraphInvariantError(`${label} não pode ser negativo.`);
  }
  return finite;
}

function finiteMatrix(matrix: Mat2D, message: string): Mat2D {
  if (matrix.some((component) => !Number.isFinite(component))) {
    throw new SceneGraphInvariantError(message);
  }
  return matrix;
}
