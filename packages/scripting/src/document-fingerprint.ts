import { hashObject } from "@theatrum/core-utils";
import type { ProjectDocument } from "@theatrum/schema";

export const SCENE_SCRIPT_DOCUMENT_HASH_PROP = "sceneScriptDocumentHash";

/**
 * Assinatura do documento emitido, sem incluir a própria assinatura.
 *
 * A cópia JSON é deliberada: ProjectDocument é um formato serializável e a
 * exportação parcial precisa comparar o conteúdo, não identidades de objetos.
 */
export function hashSceneScriptDocument(document: ProjectDocument): string {
  const snapshot = JSON.parse(JSON.stringify(document)) as ProjectDocument;
  const composition = snapshot.compositions[0];
  const root = composition?.nodes[composition.root];
  if (root !== undefined) {
    Reflect.deleteProperty(root.props, SCENE_SCRIPT_DOCUMENT_HASH_PROP);
  }
  return hashObject(snapshot);
}
