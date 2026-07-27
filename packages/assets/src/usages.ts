/**
 * Varredura de usos de um asset nos nós do documento. Alimenta o aviso de
 * "asset em uso" antes da remoção: o usuário vê quais nós ficam sem imagem.
 *
 * Um uso é qualquer propriedade animável cujo `value` (ou o de um keyframe) é
 * o `src` do asset — `assetId` de `image`/`svg` hoje; qualquer prop futura que
 * referencie asset entra pelo mesmo caminho.
 */
import type { ProjectDocument } from "@theatrum/schema";

export interface AssetReference {
  readonly compositionId: string;
  readonly compositionName: string;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly propertyPath: string;
}

export function findAssetReferences(
  document: ProjectDocument,
  src: string,
): readonly AssetReference[] {
  const references: AssetReference[] = [];
  if (src.length === 0) return references;

  for (const composition of document.compositions) {
    for (const node of Object.values(composition.nodes)) {
      collectFromProps(node.props, "props", src, (propertyPath) => {
        references.push({
          compositionId: composition.id,
          compositionName: composition.name,
          nodeId: node.id,
          nodeName: node.name,
          propertyPath,
        });
      });
    }
  }
  return references;
}

function collectFromProps(
  value: unknown,
  path: string,
  src: string,
  found: (path: string) => void,
): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectFromProps(entry, `${path}.${index}`, src, found));
    return;
  }
  const record = value as Record<string, unknown>;

  // Forma de propriedade animável: { value, keyframes, expression }.
  if ("value" in record && "keyframes" in record && Array.isArray(record["keyframes"])) {
    if (record["value"] === src) {
      found(path);
      return;
    }
    const keyframed = record["keyframes"].some(
      (keyframe) =>
        typeof keyframe === "object" &&
        keyframe !== null &&
        (keyframe as Record<string, unknown>)["value"] === src,
    );
    if (keyframed) found(`${path} (keyframe)`);
    return;
  }

  for (const [key, child] of Object.entries(record)) {
    collectFromProps(child, `${path}.${key}`, src, found);
  }
}
