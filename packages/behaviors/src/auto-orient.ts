/**
 * `auto-orient` — aponta o objeto para a direção em que ele está andando,
 * mesmo quando o movimento vem de keyframes e não de um caminho.
 *
 * A direção sai de uma diferença central sobre uma **janela fixa** de frames
 * (padrão ±1). Janela fixa, e não "posição do frame anterior", é o que mantém o
 * resultado igual avaliando fora de ordem.
 *
 * Quando o objeto está parado, a direção é indefinida: em vez de saltar para
 * leste, o comportamento não contribui nada e a rotação dos keyframes prevalece.
 */

import { initialBearing } from "@theatrum/gis";
import { type Node } from "@theatrum/schema";
import { z } from "zod";
import {
  NO_CONTRIBUTION,
  type BehaviorContext,
  type BehaviorDefinition,
  type PropertyContribution,
} from "./contracts.js";

/** Abaixo disso o deslocamento é ruído numérico, não marcha. */
const MIN_TRAVEL = 1e-9;

export const AutoOrientParamsSchema = z
  .object({
    orientOffset: z.number().finite(),
    /** Meia-janela em frames da diferença central. */
    windowFrames: z.number().int().min(1).max(15),
  })
  .strict();

export type AutoOrientParams = z.infer<typeof AutoOrientParamsSchema>;

export const AUTO_ORIENT_DEFAULTS: AutoOrientParams = Object.freeze({
  orientOffset: 0,
  windowFrames: 1,
});

export const autoOrientBehavior: BehaviorDefinition<AutoOrientParams> = Object.freeze({
  type: "auto-orient",
  label: "Auto-orientar",
  paramSchema: AutoOrientParamsSchema,
  defaultParams: AUTO_ORIENT_DEFAULTS,

  contribute(
    node: Node,
    params: AutoOrientParams,
    frame: number,
    context: BehaviorContext,
  ): PropertyContribution {
    const before = context.sampleNode(node.id, frame - params.windowFrames);
    const after = context.sampleNode(node.id, frame + params.windowFrames);
    if (before === undefined || after === undefined) return NO_CONTRIBUTION;

    const dx = after.point[0] - before.point[0];
    const dy = after.point[1] - before.point[1];
    if (Math.hypot(dx, dy) < MIN_TRAVEL) return NO_CONTRIBUTION;

    // Em geo o rumo vem de `initialBearing`: a diferença em graus não é rumo,
    // porque um grau de longitude encurta com o cosseno da latitude.
    const heading =
      after.space === "geo"
        ? initialBearing([before.point[0], before.point[1]], [after.point[0], after.point[1]])
        : (Math.atan2(dy, dx) * 180) / Math.PI;

    return {
      rotation: heading + params.orientOffset,
      rotationReference: after.space === "geo" ? "geo-bearing" : "screen",
    };
  },
});
