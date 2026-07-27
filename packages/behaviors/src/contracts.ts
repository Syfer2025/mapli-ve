/**
 * Contratos de comportamento.
 *
 * Um comportamento **gera** valores de propriedade em vez de armazená-los: o
 * motion path calcula a âncora a cada frame a partir do caminho e do `progress`,
 * o `follow` calcula a partir do alvo, o `wiggle` a partir de ruído semeado.
 *
 * Regra que atravessa o pacote inteiro: `contribute` é **puro e sem estado**. Não
 * existe "posição do frame anterior" guardada em variável. Tudo que depende do
 * passado — suavização de `follow`, derivada de auto-orientação — é recalculado
 * de uma janela fixa de frames a cada chamada. É isso que faz avaliar o frame 200
 * antes do 100 dar o mesmo resultado, e sem isso o export por frames fora de
 * ordem divergiria da pré-visualização.
 */

import type { Vec2 } from "@theatrum/core-math";
import type { Anchor, Node, PathData } from "@theatrum/schema";
import type { z } from "zod";

export type RotationReference = Node["transform"]["rotationReference"];

/** Posição de um nó num frame, no espaço em que ele está ancorado. */
export interface NodeSample {
  readonly space: Anchor["space"];
  /** `[lng, lat]` em espaço geo; pixels de composição em espaço comp. */
  readonly point: Vec2;
  readonly rotation: number;
}

/**
 * O que o comportamento pode consultar. Nada aqui toca DOM, GPU, disco ou
 * relógio: o contexto é montado pelo chamador a partir do documento.
 */
export interface BehaviorContext {
  readonly fps: number;
  readonly path: (pathId: string) => PathData | undefined;
  /**
   * Amostra de um nó em qualquer frame. O chamador decide quanto da hierarquia
   * entra; `createDocumentBehaviorContext` resolve a cena inteira.
   */
  readonly sampleNode: (nodeId: string, frame: number) => NodeSample | undefined;
}

/**
 * Contribuição de um comportamento. Campos ausentes não são tocados; presentes
 * substituem o valor avaliado dos keyframes.
 *
 * `positionOffset` é somado em vez de substituir — é o que permite `wiggle`
 * conviver com uma animação de posição existente em vez de apagá-la.
 */
export interface PropertyContribution {
  readonly anchor?: Anchor;
  readonly position?: Vec2;
  readonly positionOffset?: Vec2;
  readonly rotation?: number;
  readonly rotationOffset?: number;
  readonly rotationReference?: RotationReference;
  readonly scale?: Vec2;
  readonly opacity?: number;
  /** Diagnóstico legível quando o comportamento não pôde contribuir. */
  readonly diagnostic?: string;
}

export const NO_CONTRIBUTION: PropertyContribution = Object.freeze({});

export interface BehaviorDefinition<P = Record<string, unknown>> {
  readonly type: string;
  readonly label: string;
  readonly paramSchema: z.ZodType<P>;
  readonly defaultParams: P;
  /** Puro. Mesmo `(node, params, frame, context)` → mesma contribuição. */
  contribute(node: Node, params: P, frame: number, context: BehaviorContext): PropertyContribution;
}

export type BehaviorErrorCode = "duplicate-type" | "unknown-type" | "invalid-params";

export class BehaviorError extends Error {
  // Campos declarados fora do construtor: `erasableSyntaxOnly` proíbe
  // parâmetros-propriedade, que não são apagáveis sem emitir código.
  readonly code: BehaviorErrorCode;
  readonly type: string;

  constructor(code: BehaviorErrorCode, type: string, message: string) {
    super(message);
    this.name = "BehaviorError";
    this.code = code;
    this.type = type;
  }
}
