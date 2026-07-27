/**
 * `banking` — inclinação em curva, para aeronaves.
 *
 * Complementa `auto-orient` quando o movimento vem de keyframes: mede a variação
 * de direção numa janela fixa e devolve um **acréscimo** de rotação
 * (`rotationOffset`), de modo a somar com quem já define a direção de marcha em
 * vez de disputá-la.
 *
 * No `motion-path` a inclinação sai da tangente analítica do caminho e já entra
 * na rotação contribuída lá; este comportamento existe para o caso sem caminho.
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
import { shortestAngleDelta } from "./motion-path.js";

const MIN_TRAVEL = 1e-9;

export const BankingParamsSchema = z
  .object({
    /** Graus de inclinação por grau de mudança de direção na janela. */
    amount: z.number().finite(),
    /** Teto de inclinação; aeronave real não passa de ~45°. */
    maxAngle: z.number().finite().min(0).max(90),
    windowFrames: z.number().int().min(1).max(15),
  })
  .strict();

export type BankingParams = z.infer<typeof BankingParamsSchema>;

export const BANKING_DEFAULTS: BankingParams = Object.freeze({
  amount: 1.5,
  maxAngle: 45,
  windowFrames: 2,
});

export const bankingBehavior: BehaviorDefinition<BankingParams> = Object.freeze({
  type: "banking",
  label: "Inclinar em curva",
  paramSchema: BankingParamsSchema,
  defaultParams: BANKING_DEFAULTS,

  contribute(
    node: Node,
    params: BankingParams,
    frame: number,
    context: BehaviorContext,
  ): PropertyContribution {
    const window = params.windowFrames;
    const heading = (from: number, to: number): number | null => {
      const before = context.sampleNode(node.id, from);
      const after = context.sampleNode(node.id, to);
      if (before === undefined || after === undefined) return null;
      const dx = after.point[0] - before.point[0];
      const dy = after.point[1] - before.point[1];
      if (Math.hypot(dx, dy) < MIN_TRAVEL) return null;
      // Rumo geográfico de verdade; ver a nota em auto-orient.
      return after.space === "geo"
        ? initialBearing([before.point[0], before.point[1]], [after.point[0], after.point[1]])
        : (Math.atan2(dy, dx) * 180) / Math.PI;
    };

    const entering = heading(frame - window * 2, frame);
    const leaving = heading(frame, frame + window * 2);
    if (entering === null || leaving === null) return NO_CONTRIBUTION;

    const turn = shortestAngleDelta(entering, leaving);
    const bank = Math.max(-params.maxAngle, Math.min(params.maxAngle, -turn * params.amount));
    return bank === 0 ? NO_CONTRIBUTION : { rotationOffset: bank };
  },
});
