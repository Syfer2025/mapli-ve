/**
 * Expansão live das Actions em um documento derivado.
 *
 * O avaliador continua sem conhecer Actions: ele recebe um documento onde a
 * expansão já virou nós, comportamentos e keyframes normais. O bake grava essas
 * mesmas peças pelo Command Bus, então preview e materialização não bifurcam.
 */

import type { AnimatableProperty, Keyframe, Node, ProjectDocument } from "@theatrum/schema";
import type { ActionDiagnostic, ActionExpansion, ActionKeyframeWrite } from "./action-contracts.js";
import type { ActionRegistry } from "./action-registry.js";
import { createBuiltinActionRegistry } from "./builtin-actions.js";

const BUILTIN_REGISTRY = createBuiltinActionRegistry();
const builtinCache = new WeakMap<ProjectDocument, Map<string, ActionDocumentPass>>();

export interface ActionDocumentPass {
  readonly document: ProjectDocument;
  readonly expansions: readonly ActionExpansion[];
  readonly diagnostics: readonly ActionDiagnostic[];
  readonly generatedNodes: number;
  readonly generatedKeyframes: number;
}

/**
 * Expande todas as Actions live da composição. Sem Action, devolve a mesma
 * referência de documento — o caminho comum não clona nada.
 */
export function expandLiveActions(
  document: ProjectDocument,
  compositionId: string,
  registry: ActionRegistry = BUILTIN_REGISTRY,
): ActionDocumentPass {
  if (registry === BUILTIN_REGISTRY) {
    const perComposition = builtinCache.get(document);
    const cached = perComposition?.get(compositionId);
    if (cached !== undefined) return cached;
  }

  const composition = document.compositions.find((entry) => entry.id === compositionId);
  if (composition === undefined) return emptyPass(document);
  const instances = Object.values(composition.nodes)
    .flatMap((node) => node.actions.map((action) => ({ node, action })))
    .filter(({ action }) => action.enabled && action.mode === "live")
    .sort(
      (left, right) =>
        left.action.startFrame - right.action.startFrame ||
        left.action.id.localeCompare(right.action.id) ||
        left.node.id.localeCompare(right.node.id),
    );
  if (instances.length === 0) {
    const result = emptyPass(document);
    cache(document, compositionId, registry, result);
    return result;
  }

  const expansions: ActionExpansion[] = [];
  const diagnostics: ActionDiagnostic[] = [];
  for (const { node, action } of instances) {
    const resolution = registry.resolve(action, node, composition, document);
    if (resolution.status === "expanded") {
      expansions.push(resolution.expansion);
      diagnostics.push(...resolution.expansion.diagnostics);
    } else if (resolution.status === "unknown-type") {
      diagnostics.push({
        actionId: action.id,
        type: action.type,
        code: "invalid-params",
        message: `Ação não registrada: "${action.type}".`,
      });
    } else if (resolution.status === "invalid-params") {
      diagnostics.push({
        actionId: action.id,
        type: action.type,
        code: "invalid-params",
        message: resolution.message,
      });
    }
  }

  const materialized = materializeActionExpansions(document, compositionId, expansions);
  diagnostics.push(...materialized.diagnostics);
  const result: ActionDocumentPass = Object.freeze({
    document: materialized.document,
    expansions: Object.freeze(expansions),
    diagnostics: Object.freeze(diagnostics),
    generatedNodes: expansions.reduce((sum, entry) => sum + entry.nodes.length, 0),
    generatedKeyframes: expansions.reduce(
      (sum, entry) =>
        sum +
        entry.keyframes.length +
        entry.nodes.reduce((nodeSum, node) => nodeSum + countNodeKeyframes(node), 0) +
        entry.behaviors.reduce(
          (behaviorSum, placement) => behaviorSum + countNestedKeyframes(placement.behavior.params),
          0,
        ),
      0,
    ),
  });
  cache(document, compositionId, registry, result);
  return result;
}

export interface MaterializedActions {
  readonly document: ProjectDocument;
  readonly diagnostics: readonly ActionDiagnostic[];
}

/**
 * Aplica uma expansão a uma cópia da composição.
 *
 * Exportado para a prova live/bake: o editor grava as mesmas operações via
 * comandos; os testes podem comparar a cena derivada com a cena persistida.
 */
export function materializeActionExpansions(
  document: ProjectDocument,
  compositionId: string,
  expansions: readonly ActionExpansion[],
): MaterializedActions {
  if (expansions.length === 0) return { document, diagnostics: Object.freeze([]) };
  if (
    expansions.every(
      (entry) =>
        entry.behaviors.length === 0 && entry.nodes.length === 0 && entry.keyframes.length === 0,
    )
  ) {
    return { document, diagnostics: Object.freeze([]) };
  }
  const source = document.compositions.find((entry) => entry.id === compositionId);
  if (source === undefined) return { document, diagnostics: Object.freeze([]) };
  const composition = cloneValue(source);
  const diagnostics: ActionDiagnostic[] = [];

  for (const expansion of expansions) {
    for (const placement of expansion.behaviors) {
      const node = composition.nodes[placement.nodeId];
      if (node === undefined) {
        diagnostics.push({
          actionId: expansion.actionId,
          type: expansion.type,
          code: "invalid-owner",
          message: `Nó da ação não existe: "${placement.nodeId}".`,
        });
        continue;
      }
      if (!node.behaviors.some((entry) => entry.id === placement.behavior.id)) {
        node.behaviors.push(cloneValue(placement.behavior));
      }
    }

    for (const generated of expansion.nodes) {
      if (composition.nodes[generated.id] !== undefined) {
        diagnostics.push({
          actionId: expansion.actionId,
          type: expansion.type,
          code: "node-collision",
          message: `A expansão tentou reutilizar o nó "${generated.id}".`,
        });
        continue;
      }
      const parentId = generated.parent ?? composition.root;
      const parent = composition.nodes[parentId];
      if (parent === undefined) {
        diagnostics.push({
          actionId: expansion.actionId,
          type: expansion.type,
          code: "invalid-owner",
          message: `Pai do nó gerado não existe: "${parentId}".`,
        });
        continue;
      }
      composition.nodes[generated.id] = cloneValue(generated);
      if (!parent.children.includes(generated.id)) parent.children.push(generated.id);
    }

    for (const write of expansion.keyframes) {
      const property = propertyForWrite(composition, write);
      if (property === undefined) continue;
      upsertKeyframe(property, cloneValue(write.keyframe));
    }
  }

  const next: ProjectDocument = {
    ...document,
    compositions: document.compositions.map((entry) =>
      entry.id === compositionId ? composition : entry,
    ),
  };
  return { document: next, diagnostics: Object.freeze(diagnostics) };
}

function propertyForWrite(
  composition: ProjectDocument["compositions"][number],
  write: ActionKeyframeWrite,
): AnimatableProperty<unknown> | undefined {
  let current: unknown =
    write.target.kind === "camera" ? composition.camera : composition.nodes[write.target.nodeId];
  for (const segment of write.path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, segment);
  }
  return isAnimatable(current) ? current : undefined;
}

function upsertKeyframe(property: AnimatableProperty<unknown>, keyframe: Keyframe<unknown>): void {
  property.keyframes = property.keyframes.filter(
    (candidate) => candidate.id !== keyframe.id && candidate.frame !== keyframe.frame,
  );
  property.keyframes.push(keyframe);
  property.keyframes.sort(
    (left, right) => left.frame - right.frame || left.id.localeCompare(right.id),
  );
}

function isAnimatable(value: unknown): value is AnimatableProperty<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "keyframes" in value &&
    Array.isArray(Reflect.get(value, "keyframes")) &&
    "expression" in value
  );
}

function countNodeKeyframes(node: Node): number {
  return (
    countNestedKeyframes(node.transform) +
    countNestedKeyframes(node.props) +
    countNestedKeyframes(node.effects) +
    countNestedKeyframes(node.behaviors)
  );
}

function countNestedKeyframes(value: unknown, visited = new Set<object>()): number {
  if (typeof value !== "object" || value === null || visited.has(value)) return 0;
  visited.add(value);
  if (isAnimatable(value)) return value.keyframes.length;
  if (Array.isArray(value)) {
    return value.reduce((sum, child) => sum + countNestedKeyframes(child, visited), 0);
  }
  return Object.values(value).reduce((sum, child) => sum + countNestedKeyframes(child, visited), 0);
}

function emptyPass(document: ProjectDocument): ActionDocumentPass {
  return Object.freeze({
    document,
    expansions: Object.freeze([]),
    diagnostics: Object.freeze([]),
    generatedNodes: 0,
    generatedKeyframes: 0,
  });
}

/** Documento persistido é JSON; clone recursivo mantém o pacote livre de DOM. */
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    ) as T;
  }
  return value;
}

function cache(
  document: ProjectDocument,
  compositionId: string,
  registry: ActionRegistry,
  result: ActionDocumentPass,
): void {
  if (registry !== BUILTIN_REGISTRY) return;
  let perComposition = builtinCache.get(document);
  if (perComposition === undefined) {
    perComposition = new Map();
    builtinCache.set(document, perComposition);
  }
  perComposition.set(compositionId, result);
}
