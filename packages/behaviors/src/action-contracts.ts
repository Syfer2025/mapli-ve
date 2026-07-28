/**
 * Contratos das Action Templates.
 *
 * Uma Action não desenha diretamente. Ela expande para as mesmas peças que o
 * editor já sabe avaliar: nós, comportamentos e keyframes. O modo live aplica
 * essa expansão numa cópia derivada do documento; o bake grava a MESMA expansão
 * pelo Command Bus. Uma implementação só é o que torna os dois modos idênticos.
 */

import type {
  ActionInstanceData,
  BehaviorInstanceData,
  Composition,
  Keyframe,
  Node,
  ProjectDocument,
} from "@theatrum/schema";
import type { z } from "zod";

export type ActionCategory = "movement" | "combat" | "territory" | "logistics";

export type ActionParamKind = "path" | "number" | "boolean" | "color";

/** Metadado de UI. A validação continua sendo responsabilidade do Zod. */
export interface ActionParamDescriptor {
  readonly key: string;
  readonly label: string;
  readonly kind: ActionParamKind;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: "km/h" | "frames" | "count" | "ratio";
}

export interface ActionExpansionContext {
  readonly document: ProjectDocument;
  readonly composition: Composition;
  readonly owner: Node;
  readonly action: ActionInstanceData;
}

/** Comportamento virtual no live e persistido no bake. */
export interface ActionBehaviorPlacement {
  readonly nodeId: string;
  readonly behavior: BehaviorInstanceData;
}

/**
 * Keyframe sobre algo que já existe no documento.
 *
 * Keyframes de nós gerados já moram nos próprios nós. Esta lista cobre câmera e
 * o nó dono sem obrigar a Action a substituir o objeto inteiro.
 */
export interface ActionKeyframeWrite {
  readonly target: { readonly kind: "node"; readonly nodeId: string } | { readonly kind: "camera" };
  readonly path: readonly (string | number)[];
  readonly keyframe: Keyframe<unknown>;
}

export interface ActionDiagnostic {
  readonly actionId: string;
  readonly type: string;
  readonly code:
    "missing-path" | "empty-path" | "invalid-owner" | "node-collision" | "invalid-params";
  readonly message: string;
}

export interface ActionExpansion {
  readonly actionId: string;
  readonly type: string;
  readonly durationFrames: number;
  readonly behaviors: readonly ActionBehaviorPlacement[];
  readonly nodes: readonly Node[];
  readonly keyframes: readonly ActionKeyframeWrite[];
  readonly diagnostics: readonly ActionDiagnostic[];
}

export interface ActionTemplate<P = Record<string, unknown>> {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly category: ActionCategory;
  readonly paramSchema: z.ZodType<P>;
  readonly params: readonly ActionParamDescriptor[];
  readonly supportsLive: boolean;
  /** Defaults contextuais: caminho atual e velocidade padrão da unidade. */
  defaults(context: Omit<ActionExpansionContext, "action"> & { readonly pathId?: string }): P;
  /** Puro: mesma entrada, mesma expansão e mesmos ids derivados da Action. */
  expand(params: P, context: ActionExpansionContext): ActionExpansion;
}

export type ActionResolution =
  | { readonly status: "expanded"; readonly expansion: ActionExpansion }
  | { readonly status: "disabled" }
  | { readonly status: "baked" }
  | { readonly status: "unknown-type"; readonly type: string }
  | {
      readonly status: "invalid-params";
      readonly type: string;
      readonly message: string;
    };
