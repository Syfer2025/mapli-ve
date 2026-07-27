import type { AnimatableProperty, Composition, Node, ProjectDocument } from "@theatrum/schema";

export interface PropertyPath {
  readonly nodeId: string;
  readonly path: string | readonly (string | number)[];
}

interface DocumentIndex {
  readonly compositions: ReadonlyMap<string, Composition>;
  readonly nodes: ReadonlyMap<string, Node>;
  readonly nodeCompositions: ReadonlyMap<string, Composition>;
  readonly children: Map<string, readonly Node[]>;
  readonly ancestors: Map<string, readonly Node[]>;
  readonly descendants: Map<string, readonly Node[]>;
}

const indexes = new WeakMap<ProjectDocument, DocumentIndex>();

export const select = Object.freeze({
  node(document: ProjectDocument, id: string): Node | undefined {
    return indexFor(document).nodes.get(id);
  },

  composition(document: ProjectDocument, id: string): Composition | undefined {
    return indexFor(document).compositions.get(id);
  },

  compositionOfNode(document: ProjectDocument, nodeId: string): Composition | undefined {
    return indexFor(document).nodeCompositions.get(nodeId);
  },

  children(document: ProjectDocument, id: string): readonly Node[] {
    const index = indexFor(document);
    const cached = index.children.get(id);
    if (cached !== undefined) return cached;
    const node = index.nodes.get(id);
    const result = Object.freeze(
      (node?.children ?? []).flatMap((childId) => {
        const child = index.nodes.get(childId);
        return child === undefined ? [] : [child];
      }),
    );
    index.children.set(id, result);
    return result;
  },

  ancestors(document: ProjectDocument, id: string): readonly Node[] {
    const index = indexFor(document);
    const cached = index.ancestors.get(id);
    if (cached !== undefined) return cached;

    const result: Node[] = [];
    const visited = new Set<string>([id]);
    let current = index.nodes.get(id);
    while (current?.parent !== null && current?.parent !== undefined) {
      if (visited.has(current.parent)) break;
      visited.add(current.parent);
      const parent = index.nodes.get(current.parent);
      if (parent === undefined) break;
      result.push(parent);
      current = parent;
    }
    const frozen = Object.freeze(result);
    index.ancestors.set(id, frozen);
    return frozen;
  },

  descendants(document: ProjectDocument, id: string): readonly Node[] {
    const index = indexFor(document);
    const cached = index.descendants.get(id);
    if (cached !== undefined) return cached;

    const result: Node[] = [];
    const visited = new Set<string>([id]);
    const pending = [...(index.nodes.get(id)?.children ?? [])].reverse();
    while (pending.length > 0) {
      const childId = pending.pop();
      if (childId === undefined || visited.has(childId)) continue;
      visited.add(childId);
      const child = index.nodes.get(childId);
      if (child === undefined) continue;
      result.push(child);
      for (let childIndex = child.children.length - 1; childIndex >= 0; childIndex -= 1) {
        const grandchildId = child.children[childIndex];
        if (grandchildId !== undefined) pending.push(grandchildId);
      }
    }
    const frozen = Object.freeze(result);
    index.descendants.set(id, frozen);
    return frozen;
  },

  property(
    document: ProjectDocument,
    propertyPath: PropertyPath,
  ): AnimatableProperty<unknown> | undefined {
    const node = indexFor(document).nodes.get(propertyPath.nodeId);
    if (node === undefined) return undefined;
    const segments = normalizePath(propertyPath.path);
    let value: unknown = node;
    for (const segment of segments) {
      if (typeof value !== "object" || value === null) return undefined;
      value = Reflect.get(value, segment);
    }
    return isAnimatable(value) ? value : undefined;
  },

  clearMemoized(document: ProjectDocument): void {
    indexes.delete(document);
  },
});

function indexFor(document: ProjectDocument): DocumentIndex {
  const cached = indexes.get(document);
  if (cached !== undefined) return cached;

  const compositions = new Map<string, Composition>();
  const nodes = new Map<string, Node>();
  const nodeCompositions = new Map<string, Composition>();
  for (const composition of document.compositions) {
    compositions.set(composition.id, composition);
    for (const node of Object.values(composition.nodes)) {
      nodes.set(node.id, node);
      nodeCompositions.set(node.id, composition);
    }
  }
  const index: DocumentIndex = {
    compositions,
    nodes,
    nodeCompositions,
    children: new Map(),
    ancestors: new Map(),
    descendants: new Map(),
  };
  indexes.set(document, index);
  return index;
}

function normalizePath(path: string | readonly (string | number)[]): readonly (string | number)[] {
  if (typeof path !== "string") return path;
  if (path === "") return [];
  if (path.startsWith("/")) {
    return path
      .slice(1)
      .split("/")
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  }
  return path.split(".");
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
