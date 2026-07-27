/**
 * Passe de comportamentos sobre uma cena avaliada.
 *
 * `animation.evaluate()` não conhece comportamentos — não pode, é L2 e este
 * pacote é L3. A composição acontece aqui: avalia a cena, aplica as contribuições
 * em ordem de desenho (que é topológica) e devolve uma cena nova. Um seguidor lê
 * o alvo **já com os comportamentos dele aplicados**, porque o alvo vem antes na
 * ordem topológica.
 *
 * O contexto de amostragem reavalia frames vizinhos sob demanda, com memoização
 * por frame. A memoização é só velocidade: o resultado de um frame nunca depende
 * de quais outros já foram pedidos.
 */

import type { Vec2 } from "@theatrum/core-math";
import { evaluate, type EvaluatedNode, type EvaluatedScene } from "@theatrum/animation";
import type { Anchor, Node, PathData, ProjectDocument } from "@theatrum/schema";
import type { BehaviorContext, NodeSample, PropertyContribution } from "./contracts.js";
import { createBuiltinBehaviorRegistry } from "./builtin.js";
import type { BehaviorRegistry } from "./registry.js";

/**
 * Profundidade máxima de amostragem aninhada — um seguidor que segue um
 * seguidor, ou auto-orientação sobre quem já é auto-orientado.
 *
 * O custo é multiplicativo: cada nível reavalia a janela inteira de frames, então
 * uma janela de 12 frames custa 12 avaliações no nível 1 e 144 no nível 2. Além
 * do limite, as amostras vêm dos keyframes sem comportamentos — o objeto ainda é
 * seguido, só não com a correção de terceira ordem. Subir esse número troca
 * precisão marginal por custo quadrático.
 */
const MAX_SAMPLE_DEPTH = 2;

export interface BehaviorPassOptions {
  readonly registry?: BehaviorRegistry;
  /** Frames vizinhos memoizados; cobre a janela padrão de `follow`. */
  readonly sampleCacheSize?: number;
}

/** Cache compartilhado entre passes aninhados. Chave: `profundidade:frame`. */
type SampleCache = Map<string, ReadonlyMap<string, EvaluatedNode>>;

export interface BehaviorDiagnostic {
  readonly nodeId: string;
  readonly behaviorId: string;
  readonly type: string;
  readonly message: string;
}

export interface BehaviorPassResult {
  readonly scene: EvaluatedScene;
  readonly diagnostics: readonly BehaviorDiagnostic[];
  /** Nós cujo transform ou âncora foi alterado por algum comportamento. */
  readonly affected: readonly string[];
}

/**
 * Aplica os comportamentos de todos os nós de uma cena já avaliada.
 *
 * `document` e `compositionId` são necessários porque os comportamentos leem os
 * nós de origem (params) e amostram frames vizinhos.
 */
export function applySceneBehaviors(
  scene: EvaluatedScene,
  document: ProjectDocument,
  compositionId: string,
  options: BehaviorPassOptions = {},
): BehaviorPassResult {
  return runPass(scene, document, compositionId, options, 0, new Map());
}

function runPass(
  scene: EvaluatedScene,
  document: ProjectDocument,
  compositionId: string,
  options: BehaviorPassOptions,
  depth: number,
  cache: SampleCache,
): BehaviorPassResult {
  const composition = document.compositions.find((entry) => entry.id === compositionId);
  if (composition === undefined) {
    return Object.freeze({ scene, diagnostics: Object.freeze([]), affected: Object.freeze([]) });
  }
  const hasAnyBehavior = Object.values(composition.nodes).some((node) => node.behaviors.length > 0);
  if (!hasAnyBehavior) {
    return Object.freeze({ scene, diagnostics: Object.freeze([]), affected: Object.freeze([]) });
  }

  const registry = options.registry ?? createBuiltinBehaviorRegistry();
  const diagnostics: BehaviorDiagnostic[] = [];
  const affected: string[] = [];
  const nodes = new Map(scene.nodes);
  const context = createContext(document, compositionId, {
    registry,
    ...(options.sampleCacheSize === undefined ? {} : { cacheSize: options.sampleCacheSize }),
    resolved: nodes,
    frame: scene.frame,
    depth,
    cache,
  });

  for (const nodeId of scene.drawOrder) {
    const source = composition.nodes[nodeId];
    const evaluated = nodes.get(nodeId);
    if (source === undefined || evaluated === undefined) continue;
    if (source.behaviors.length === 0) continue;

    let current = evaluated;
    let changed = false;
    for (const instance of source.behaviors) {
      const resolution = registry.resolve(instance, source, scene.frame, context);
      if (resolution.status === "disabled") continue;
      if (resolution.status === "unknown-type") {
        diagnostics.push({
          nodeId,
          behaviorId: instance.id,
          type: instance.type,
          message: `Comportamento não registrado: "${instance.type}".`,
        });
        continue;
      }
      if (resolution.status === "invalid-params") {
        diagnostics.push({
          nodeId,
          behaviorId: instance.id,
          type: instance.type,
          message: resolution.message,
        });
        continue;
      }
      if (resolution.contribution.diagnostic !== undefined) {
        diagnostics.push({
          nodeId,
          behaviorId: instance.id,
          type: instance.type,
          message: resolution.contribution.diagnostic,
        });
      }
      const next = withContribution(current, resolution.contribution);
      if (next !== current) {
        current = next;
        changed = true;
      }
    }

    if (changed) {
      nodes.set(nodeId, current);
      affected.push(nodeId);
    }
  }

  if (affected.length === 0) {
    return Object.freeze({
      scene,
      diagnostics: Object.freeze(diagnostics),
      affected: Object.freeze([]),
    });
  }

  return Object.freeze({
    scene: Object.freeze({ ...scene, nodes }),
    diagnostics: Object.freeze(diagnostics),
    affected: Object.freeze(affected),
  });
}

/** Aplica uma contribuição a um nó avaliado, preservando a imutabilidade. */
export function withContribution(
  node: EvaluatedNode,
  contribution: PropertyContribution,
): EvaluatedNode {
  const anchor = contribution.anchor ?? node.anchor;
  const position = contribution.position ?? node.transform.position;
  const offsetPosition: Vec2 =
    contribution.positionOffset === undefined
      ? [position[0], position[1]]
      : [
          position[0] + contribution.positionOffset[0],
          position[1] + contribution.positionOffset[1],
        ];
  const rotationBase = contribution.rotation ?? node.transform.rotation;
  const rotation = rotationBase + (contribution.rotationOffset ?? 0);
  const scale = contribution.scale ?? node.transform.scale;
  const opacity = contribution.opacity ?? node.transform.opacity;
  const rotationReference = contribution.rotationReference ?? node.transform.rotationReference;

  const unchanged =
    anchor === node.anchor &&
    offsetPosition[0] === node.transform.position[0] &&
    offsetPosition[1] === node.transform.position[1] &&
    rotation === node.transform.rotation &&
    scale === node.transform.scale &&
    opacity === node.transform.opacity &&
    rotationReference === node.transform.rotationReference;
  if (unchanged) return node;

  return Object.freeze({
    ...node,
    anchor: Object.freeze(anchor) as Anchor,
    transform: Object.freeze({
      ...node.transform,
      position: Object.freeze(offsetPosition) as Vec2,
      rotation,
      scale,
      opacity,
      rotationReference,
    }),
  });
}

interface DocumentContextOptions {
  readonly registry: BehaviorRegistry;
  readonly cacheSize?: number;
  /** Nós já resolvidos no frame corrente, para o alvo vir com comportamentos. */
  readonly resolved?: ReadonlyMap<string, EvaluatedNode>;
  readonly frame?: number;
}

/**
 * Contexto que resolve caminhos e amostras a partir do documento. Exportado
 * porque o editor e o exportador montam o mesmo contexto.
 */
export function createDocumentBehaviorContext(
  document: ProjectDocument,
  compositionId: string,
  options: DocumentContextOptions,
): BehaviorContext {
  return createContext(document, compositionId, { ...options, depth: 0, cache: new Map() });
}

function createContext(
  document: ProjectDocument,
  compositionId: string,
  options: DocumentContextOptions & { readonly depth: number; readonly cache: SampleCache },
): BehaviorContext {
  const composition = document.compositions.find((entry) => entry.id === compositionId);
  const fps = composition?.fps ?? 60;
  const cacheSize = options.cacheSize ?? 64;
  const nextDepth = options.depth + 1;
  const cache = options.cache;

  const sceneAt = (frame: number): ReadonlyMap<string, EvaluatedNode> | undefined => {
    if (composition === undefined) return undefined;
    if (options.resolved !== undefined && options.frame === frame) return options.resolved;

    // A chave inclui a profundidade: no limite as amostras vêm sem
    // comportamentos, e reaproveitar entre níveis faria o resultado depender de
    // qual nível pediu o frame primeiro.
    const key = `${nextDepth}:${frame}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    // `clampFrame: false` deixa a janela de amostragem passar das bordas da
    // composição; `evaluateProperty` já satura no primeiro/último keyframe.
    const evaluated = evaluate(document, compositionId, frame, { clampFrame: false });
    const nodes: ReadonlyMap<string, EvaluatedNode> =
      nextDepth > MAX_SAMPLE_DEPTH
        ? evaluated.nodes
        : runPass(
            evaluated,
            document,
            compositionId,
            { registry: options.registry, sampleCacheSize: cacheSize },
            nextDepth,
            cache,
          ).scene.nodes;

    if (cache.size >= cacheSize) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, nodes);
    return nodes;
  };

  return Object.freeze({
    fps,
    path: (pathId: string): PathData | undefined => document.paths[pathId],
    sampleNode: (nodeId: string, frame: number): NodeSample | undefined => {
      const node = sceneAt(frame)?.get(nodeId);
      if (node === undefined) return undefined;
      return Object.freeze({
        space: node.anchor.space,
        point: anchorPoint(node),
        rotation: node.transform.rotation,
      });
    },
  });
}

function anchorPoint(node: EvaluatedNode): Vec2 {
  if (node.anchor.space === "geo") {
    return [node.anchor.lngLat[0], node.anchor.lngLat[1]];
  }
  if (node.anchor.space === "comp") {
    return [
      node.anchor.position[0] + node.transform.position[0],
      node.anchor.position[1] + node.transform.position[1],
    ];
  }
  return [
    node.anchor.offset[0] + node.transform.position[0],
    node.anchor.offset[1] + node.transform.position[1],
  ];
}

export type { Node };
