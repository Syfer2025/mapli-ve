import { NodeSchema, type Node } from "@theatrum/schema";

export interface UnresolvedNodePlaceholder {
  readonly nodeId: string;
  readonly type: string;
  readonly label: string;
  readonly rawNode: Node;
}

/**
 * Projeta um nó desconhecido para a UI sem alterar seu payload. O documento
 * continua sendo a fonte de verdade; `rawNode` é um clone validado e pode ser
 * salvo novamente mesmo quando o plugin não está instalado.
 */
export function createUnresolvedNodePlaceholder(node: Node): UnresolvedNodePlaceholder {
  const rawNode = NodeSchema.parse(node);
  return Object.freeze({
    nodeId: rawNode.id,
    type: rawNode.type,
    label: `Plugin ausente · ${rawNode.type}`,
    rawNode,
  });
}

export function restoreUnresolvedNode(placeholder: UnresolvedNodePlaceholder): Node {
  return NodeSchema.parse(placeholder.rawNode);
}
