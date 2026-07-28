import type { Composition, Node } from "@theatrum/schema";
import { SceneGraphInvariantError, type HierarchyIssue } from "./errors.js";

function sortedNodeIds(composition: Composition): readonly string[] {
  return Object.keys(composition.nodes).sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Documentos em produção são profundamente congelados pelo DocumentStore.
 * Nesse caso a ordem de uma composição não pode mudar entre frames, então
 * validar e reconstruir a mesma travessia centenas de vezes por segundo seria
 * trabalho puro desperdiçado. Fixtures mutáveis nunca entram no cache.
 */
const TOPOLOGICAL_ORDER_CACHE = new WeakMap<Composition, readonly string[]>();

/**
 * Verifica a redundância deliberada `parent` + `children`, ciclos e alcance da
 * raiz. A ordem dos diagnósticos é estável e independe da ordem das chaves JSON.
 */
export function validateHierarchy(composition: Composition): readonly HierarchyIssue[] {
  const issues: HierarchyIssue[] = [];
  const ids = sortedNodeIds(composition);
  const nodes = composition.nodes;
  const root = nodes[composition.root];

  if (root === undefined) {
    issues.push({
      code: "root-missing",
      nodeId: composition.root,
      message: `A raiz "${composition.root}" não existe na composição.`,
    });
  } else if (root.parent !== null) {
    issues.push({
      code: "root-parent",
      nodeId: root.id,
      relatedId: root.parent,
      message: `A raiz "${root.id}" deve ter parent null.`,
    });
  }

  for (const mapId of ids) {
    const node = nodes[mapId];
    if (node === undefined) continue;

    if (node.id !== mapId) {
      issues.push({
        code: "node-key-mismatch",
        nodeId: node.id,
        relatedId: mapId,
        message: `O nó "${node.id}" está armazenado sob a chave "${mapId}".`,
      });
    }

    if (node.parent !== null && nodes[node.parent] === undefined) {
      issues.push({
        code: "missing-parent",
        nodeId: node.id,
        relatedId: node.parent,
        message: `O pai "${node.parent}" do nó "${node.id}" não existe.`,
      });
    }

    const seenChildren = new Set<string>();
    for (const childId of node.children) {
      if (seenChildren.has(childId)) {
        issues.push({
          code: "duplicate-child",
          nodeId: node.id,
          relatedId: childId,
          message: `O filho "${childId}" aparece mais de uma vez em "${node.id}".`,
        });
        continue;
      }
      seenChildren.add(childId);

      const child = nodes[childId];
      if (child === undefined) {
        issues.push({
          code: "missing-child",
          nodeId: node.id,
          relatedId: childId,
          message: `O filho "${childId}" de "${node.id}" não existe.`,
        });
      } else if (child.parent !== node.id) {
        issues.push({
          code: "child-parent-mismatch",
          nodeId: node.id,
          relatedId: childId,
          message: `O filho "${childId}" declara parent "${String(child.parent)}", não "${node.id}".`,
        });
      }
    }

    if (node.parent !== null) {
      const parent = nodes[node.parent];
      if (parent !== undefined) {
        const occurrences = parent.children.reduce(
          (count, childId) => count + (childId === node.id ? 1 : 0),
          0,
        );
        if (occurrences === 0) {
          issues.push({
            code: "child-not-listed",
            nodeId: node.id,
            relatedId: parent.id,
            message: `O pai "${parent.id}" não lista o filho "${node.id}".`,
          });
        }
      }
    }
  }

  issues.push(...findCycleIssues(composition, ids));

  if (root !== undefined) {
    const reachable = collectReachable(composition, composition.root);
    for (const id of ids) {
      if (!reachable.has(id)) {
        issues.push({
          code: "unreachable",
          nodeId: id,
          relatedId: composition.root,
          message: `O nó "${id}" não é alcançável a partir da raiz "${composition.root}".`,
        });
      }
    }
  }

  return Object.freeze(issues);
}

function findCycleIssues(
  composition: Composition,
  ids: readonly string[],
): readonly HierarchyIssue[] {
  const issues: HierarchyIssue[] = [];
  const reported = new Set<string>();

  for (const startId of ids) {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let currentId: string | null = startId;

    while (currentId !== null) {
      const cycleStart = pathIndex.get(currentId);
      if (cycleStart !== undefined) {
        const members = path.slice(cycleStart);
        const signature = [...members].sort(compareStrings).join("\u0000");
        if (!reported.has(signature)) {
          reported.add(signature);
          const nodeId = [...members].sort(compareStrings)[0];
          if (nodeId !== undefined) {
            issues.push({
              code: "cycle",
              nodeId,
              relatedId: currentId,
              message: `Ciclo de parentesco detectado: ${members.join(" → ")} → ${currentId}.`,
            });
          }
        }
        break;
      }

      const node: Node | undefined = composition.nodes[currentId];
      if (node === undefined) break;
      pathIndex.set(currentId, path.length);
      path.push(currentId);
      currentId = node.parent;
    }
  }

  return issues.sort((left, right) => compareStrings(left.nodeId, right.nodeId));
}

function collectReachable(composition: Composition, rootId: string): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || visited.has(id)) continue;
    const node = composition.nodes[id];
    if (node === undefined) continue;
    visited.add(id);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const childId = node.children[index];
      if (childId !== undefined) pending.push(childId);
    }
  }
  return visited;
}

export function assertValidHierarchy(composition: Composition): void {
  const issues = validateHierarchy(composition);
  if (issues.length === 0) return;
  throw new SceneGraphInvariantError(
    `Hierarquia inválida em "${composition.id}": ${issues[0]?.message ?? "erro desconhecido"}`,
    issues,
  );
}

/**
 * Pré-ordem estável: pai antes dos filhos; irmãos seguem literalmente
 * `children[]`, cujo índice zero desenha primeiro.
 */
export function topologicalOrder(composition: Composition): readonly string[] {
  const cacheable = Object.isFrozen(composition);
  if (cacheable) {
    const cached = TOPOLOGICAL_ORDER_CACHE.get(composition);
    if (cached !== undefined) return cached;
  }
  assertValidHierarchy(composition);
  const ordered: string[] = [];
  const pending = [composition.root];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) continue;
    const node = composition.nodes[id];
    if (node === undefined) continue;
    ordered.push(id);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const childId = node.children[index];
      if (childId !== undefined) pending.push(childId);
    }
  }
  const result = Object.freeze(ordered);
  if (cacheable) TOPOLOGICAL_ORDER_CACHE.set(composition, result);
  return result;
}

export function orderedChildren(composition: Composition, nodeId: string): readonly Node[] {
  const node = composition.nodes[nodeId];
  if (node === undefined) {
    throw new SceneGraphInvariantError(`Nó não encontrado: "${nodeId}".`);
  }
  return Object.freeze(
    node.children.map((childId) => {
      const child = composition.nodes[childId];
      if (child === undefined) {
        throw new SceneGraphInvariantError(
          `O nó "${nodeId}" referencia o filho inexistente "${childId}".`,
        );
      }
      return child;
    }),
  );
}

export function ancestorIds(composition: Composition, nodeId: string): readonly string[] {
  const node = composition.nodes[nodeId];
  if (node === undefined) {
    throw new SceneGraphInvariantError(`Nó não encontrado: "${nodeId}".`);
  }

  const result: string[] = [];
  const visited = new Set<string>([nodeId]);
  let parentId = node.parent;
  while (parentId !== null) {
    if (visited.has(parentId)) {
      throw new SceneGraphInvariantError(`Ciclo de parentesco encontrado a partir de "${nodeId}".`);
    }
    visited.add(parentId);
    const parent = composition.nodes[parentId];
    if (parent === undefined) {
      throw new SceneGraphInvariantError(`Pai não encontrado: "${parentId}".`);
    }
    result.push(parentId);
    parentId = parent.parent;
  }
  return Object.freeze(result);
}

export function descendantIds(composition: Composition, nodeId: string): readonly string[] {
  const root = composition.nodes[nodeId];
  if (root === undefined) {
    throw new SceneGraphInvariantError(`Nó não encontrado: "${nodeId}".`);
  }

  const result: string[] = [];
  const visited = new Set<string>([nodeId]);
  const pending = [...root.children].reverse();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) continue;
    if (visited.has(id)) {
      throw new SceneGraphInvariantError(`Ciclo ou filho duplicado encontrado em "${id}".`);
    }
    visited.add(id);
    const node = composition.nodes[id];
    if (node === undefined) {
      throw new SceneGraphInvariantError(`Nó não encontrado: "${id}".`);
    }
    result.push(id);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const childId = node.children[index];
      if (childId !== undefined) pending.push(childId);
    }
  }
  return Object.freeze(result);
}

export function isAncestor(
  composition: Composition,
  candidateAncestorId: string,
  nodeId: string,
): boolean {
  return ancestorIds(composition, nodeId).includes(candidateAncestorId);
}
