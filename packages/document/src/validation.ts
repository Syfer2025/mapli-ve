import { err, ok, type Result } from "@theatrum/core-utils";
import {
  ProjectDocumentSchema,
  type AnimatableProperty,
  type Composition,
  type Node,
  type ProjectDocument,
} from "@theatrum/schema";

export type DocumentValidationCode =
  | "schema"
  | "duplicate-id"
  | "missing-root"
  | "invalid-root"
  | "missing-parent"
  | "missing-child"
  | "duplicate-child"
  | "inconsistent-parent"
  | "parent-cycle"
  | "invalid-time-range"
  | "keyframes-not-sorted"
  | "duplicate-keyframe"
  | "missing-asset"
  | "missing-path"
  | "missing-matte-source"
  | "matte-cycle";

export interface DocumentValidationIssue {
  readonly code: DocumentValidationCode;
  /** RFC 6901 JSON Pointer. */
  readonly pointer: string;
  readonly message: string;
}

export class DocumentValidationError extends Error {
  override readonly name = "DocumentValidationError";
  readonly issues: readonly DocumentValidationIssue[];

  constructor(issues: readonly DocumentValidationIssue[]) {
    super(formatValidationIssues(issues));
    this.issues = issues;
  }
}

/**
 * Valida primeiro a forma canônica Zod e depois as relações que atravessam
 * objetos (hierarquia, referências e ordenação de keyframes).
 */
export function validateDocument(
  input: unknown,
): Result<ProjectDocument, readonly DocumentValidationIssue[]> {
  const parsed = ProjectDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) => ({
        code: "schema" as const,
        pointer: toPointer(issue.path),
        message: issue.message,
      })),
    );
  }

  const issues: DocumentValidationIssue[] = [];
  validateRelations(parsed.data, issues);
  return issues.length === 0 ? ok(parsed.data) : err(issues);
}

export function assertValidDocument(input: unknown): ProjectDocument {
  const result = validateDocument(input);
  if (result.ok) return result.value;
  throw new DocumentValidationError(result.error);
}

export function formatValidationIssues(issues: readonly DocumentValidationIssue[]): string {
  const first = issues[0];
  if (first === undefined) return "Documento inválido.";
  const suffix = issues.length > 1 ? ` (+${issues.length - 1} problema(s))` : "";
  return `Documento inválido em ${first.pointer || "/"}: ${first.message}${suffix}`;
}

function validateRelations(doc: ProjectDocument, issues: DocumentValidationIssue[]): void {
  const compositionIds = new Set<string>();
  const nodeIds = new Set<string>();
  // O que os nós referenciam é o SRC do asset, não o id. Ver validateReferences.
  const assetSrcs = new Set(doc.assets.map((asset) => asset.src));
  const pathIds = new Set(Object.keys(doc.paths));

  for (
    let compositionIndex = 0;
    compositionIndex < doc.compositions.length;
    compositionIndex += 1
  ) {
    const composition = doc.compositions[compositionIndex];
    if (composition === undefined) continue;
    const compositionPointer = `/compositions/${compositionIndex}`;

    if (compositionIds.has(composition.id)) {
      addIssue(
        issues,
        "duplicate-id",
        `${compositionPointer}/id`,
        `ID de composição duplicado: ${composition.id}.`,
      );
    }
    compositionIds.add(composition.id);

    for (const [nodeKey, node] of Object.entries(composition.nodes)) {
      if (nodeKey !== node.id) {
        addIssue(
          issues,
          "duplicate-id",
          `${compositionPointer}/nodes/${escapePointer(nodeKey)}/id`,
          `A chave ${nodeKey} diverge do id ${node.id}.`,
        );
      }
      if (nodeIds.has(node.id)) {
        addIssue(
          issues,
          "duplicate-id",
          `${compositionPointer}/nodes/${escapePointer(nodeKey)}/id`,
          `ID de nó duplicado no projeto: ${node.id}.`,
        );
      }
      nodeIds.add(node.id);
    }

    validateComposition(composition, compositionPointer, issues);
    validateReferences(composition, compositionPointer, assetSrcs, pathIds, issues);
    validateAnimatableValues(composition, compositionPointer, issues, new Set<object>());
  }
}

function validateComposition(
  composition: Composition,
  pointer: string,
  issues: DocumentValidationIssue[],
): void {
  const root = composition.nodes[composition.root];
  if (root === undefined) {
    addIssue(issues, "missing-root", `${pointer}/root`, `A raiz ${composition.root} não existe.`);
  } else if (root.parent !== null) {
    addIssue(
      issues,
      "invalid-root",
      `${pointer}/nodes/${escapePointer(root.id)}/parent`,
      "A raiz deve ter parent null.",
    );
  }

  for (const [nodeKey, node] of Object.entries(composition.nodes)) {
    const nodePointer = `${pointer}/nodes/${escapePointer(nodeKey)}`;
    validateNodeRelations(node, composition, nodePointer, issues);
    validateParentCycle(node, composition, nodePointer, issues);
    validateTrackMatte(node, composition, nodePointer, issues);
  }
}

function validateNodeRelations(
  node: Node,
  composition: Composition,
  pointer: string,
  issues: DocumentValidationIssue[],
): void {
  if (node.timeRange.in > node.timeRange.out) {
    addIssue(
      issues,
      "invalid-time-range",
      `${pointer}/timeRange`,
      `O frame de entrada ${node.timeRange.in} excede o de saída ${node.timeRange.out}.`,
    );
  }

  if (node.parent !== null) {
    const parent = composition.nodes[node.parent];
    if (parent === undefined) {
      addIssue(
        issues,
        "missing-parent",
        `${pointer}/parent`,
        `O pai ${node.parent} não existe na composição.`,
      );
    } else if (!parent.children.includes(node.id)) {
      addIssue(
        issues,
        "inconsistent-parent",
        `${pointer}/parent`,
        `O pai ${node.parent} não lista ${node.id} em children.`,
      );
    }
  }

  const seenChildren = new Set<string>();
  for (let index = 0; index < node.children.length; index += 1) {
    const childId = node.children[index];
    if (childId === undefined) continue;
    const childPointer = `${pointer}/children/${index}`;
    if (seenChildren.has(childId)) {
      addIssue(issues, "duplicate-child", childPointer, `Filho duplicado: ${childId}.`);
      continue;
    }
    seenChildren.add(childId);

    const child = composition.nodes[childId];
    if (child === undefined) {
      addIssue(issues, "missing-child", childPointer, `O filho ${childId} não existe.`);
    } else if (child.parent !== node.id) {
      addIssue(
        issues,
        "inconsistent-parent",
        childPointer,
        `${childId} declara parent ${String(child.parent)}, não ${node.id}.`,
      );
    }
  }
}

/**
 * Recorte precisa de origem existente e sem ciclo.
 *
 * O ciclo é o caso perigoso: se A recorta por B e B recorta por A, o backend
 * pediria a máscara de um nó que depende da própria máscara, e o frame nunca
 * fecharia. Barrar aqui é mais barato que detectar em tempo de desenho.
 */
function validateTrackMatte(
  node: Node,
  composition: Composition,
  pointer: string,
  issues: DocumentValidationIssue[],
): void {
  if (node.trackMatte === null) return;

  const sourcePointer = `${pointer}/trackMatte/source`;
  if (node.trackMatte.source === node.id) {
    addIssue(issues, "matte-cycle", sourcePointer, `${node.id} não pode recortar por si mesmo.`);
    return;
  }
  if (composition.nodes[node.trackMatte.source] === undefined) {
    addIssue(
      issues,
      "missing-matte-source",
      sourcePointer,
      `A origem de recorte ${node.trackMatte.source} não existe na composição.`,
    );
    return;
  }

  const visited = new Set<string>([node.id]);
  let current: Node | undefined = composition.nodes[node.trackMatte.source];
  while (current?.trackMatte != null) {
    if (visited.has(current.id)) return;
    visited.add(current.id);
    const next: Node | undefined = composition.nodes[current.trackMatte.source];
    if (next === undefined) return;
    if (next.id === node.id) {
      addIssue(
        issues,
        "matte-cycle",
        sourcePointer,
        `Ciclo de recorte detectado a partir de ${node.id}.`,
      );
      return;
    }
    current = next;
  }
}

function validateParentCycle(
  node: Node,
  composition: Composition,
  pointer: string,
  issues: DocumentValidationIssue[],
): void {
  const visited = new Set<string>();
  let current: Node | undefined = node;
  while (current !== undefined && current.parent !== null) {
    if (visited.has(current.id)) {
      addIssue(
        issues,
        "parent-cycle",
        `${pointer}/parent`,
        `Ciclo de parentesco detectado a partir de ${node.id}.`,
      );
      return;
    }
    visited.add(current.id);
    current = composition.nodes[current.parent];
  }
}

function validateReferences(
  composition: Composition,
  pointer: string,
  assetSrcs: ReadonlySet<string>,
  pathIds: ReadonlySet<string>,
  issues: DocumentValidationIssue[],
): void {
  walkUnknown(
    composition,
    pointer,
    (value, valuePointer, key) => {
      if (typeof value !== "string") return;
      /**
       * `props.assetId` guarda o **`src`** do asset, não o `id` — o nome da prop é
       * enganoso e o formato de projeto o mantém por compatibilidade.
       *
       * Este validador comparava contra a lista de **ids**, então todo nó criado pelo
       * caminho canônico (`applyAsset`, que grava `src`) era acusado de referenciar
       * asset inexistente. Um validador que acusa o caso correto treina quem o lê a
       * ignorá-lo — e foi ignorado o suficiente para o defeito irmão sobreviver no
       * `select` do Inspector, que gravava `id` e deixava o palco vazio.
       */
      if (key === "assetId" && value !== "" && !assetSrcs.has(value)) {
        addIssue(issues, "missing-asset", valuePointer, `O asset ${value} não existe.`);
      }
      if (key === "pathId" && !pathIds.has(value)) {
        addIssue(issues, "missing-path", valuePointer, `O path ${value} não existe.`);
      }
    },
    new Set<object>(),
  );
}

function validateAnimatableValues(
  value: unknown,
  pointer: string,
  issues: DocumentValidationIssue[],
  visited: Set<object>,
): void {
  if (typeof value !== "object" || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);

  if (isAnimatableProperty(value)) {
    let previousFrame = -1;
    const frames = new Set<number>();
    for (let index = 0; index < value.keyframes.length; index += 1) {
      const keyframe = value.keyframes[index];
      if (keyframe === undefined) continue;
      const keyframePointer = `${pointer}/keyframes/${index}/frame`;
      if (frames.has(keyframe.frame)) {
        addIssue(
          issues,
          "duplicate-keyframe",
          keyframePointer,
          `Já existe keyframe no frame ${keyframe.frame}.`,
        );
      }
      if (keyframe.frame <= previousFrame) {
        addIssue(
          issues,
          "keyframes-not-sorted",
          keyframePointer,
          "Keyframes devem estar em ordem crescente e sem frames duplicados.",
        );
      }
      frames.add(keyframe.frame);
      previousFrame = keyframe.frame;
    }
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateAnimatableValues(value[index], `${pointer}/${index}`, issues, visited);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    validateAnimatableValues(child, `${pointer}/${escapePointer(key)}`, issues, visited);
  }
}

function isAnimatableProperty(value: object): value is AnimatableProperty<unknown> {
  return (
    "value" in value &&
    "keyframes" in value &&
    Array.isArray((value as { readonly keyframes?: unknown }).keyframes) &&
    "expression" in value
  );
}

function walkUnknown(
  value: unknown,
  pointer: string,
  visit: (value: unknown, pointer: string, key: string | null) => void,
  visited: Set<object>,
  key: string | null = null,
): void {
  visit(value, pointer, key);
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      walkUnknown(value[index], `${pointer}/${index}`, visit, visited);
    }
    return;
  }
  for (const [childKey, child] of Object.entries(value)) {
    walkUnknown(child, `${pointer}/${escapePointer(childKey)}`, visit, visited, childKey);
  }
}

function addIssue(
  issues: DocumentValidationIssue[],
  code: DocumentValidationCode,
  pointer: string,
  message: string,
): void {
  issues.push({ code, pointer, message });
}

function toPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "";
  return `/${path.map((segment) => escapePointer(String(segment))).join("/")}`;
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
