/**
 * `follow` — persegue outro nó com atraso suave.
 *
 * O caminho fácil seria acumular estado: `posição += (alvo - posição) * k` a cada
 * frame. Isso quebra tudo que importa aqui — o resultado passaria a depender de
 * quantos frames foram avaliados antes e em que ordem, e o export por frames
 * fora de ordem divergiria da pré-visualização.
 *
 * Em vez disso, o damping é uma **média ponderada sobre uma janela fixa de
 * frames passados**, recalculada do zero a cada chamada. Peso geométrico
 * `(1 - responsiveness)^k`: `damping = 0` devolve o alvo exato no frame; perto de
 * 1 arrasta a resposta por toda a janela. Custa W amostras por frame e é
 * idêntico em qualquer ordem de avaliação.
 */

import type { Vec2 } from "@theatrum/core-math";
import { IdentifierSchema, Vec2Schema, type Anchor, type Node } from "@theatrum/schema";
import { z } from "zod";
import {
  type BehaviorContext,
  type BehaviorDefinition,
  type PropertyContribution,
} from "./contracts.js";
import { shortestAngleDelta } from "./motion-path.js";

/** Tamanho máximo da janela. 30 frames = meio segundo a 60 fps. */
const MAX_WINDOW_FRAMES = 30;

export const FollowParamsSchema = z
  .object({
    targetId: IdentifierSchema,
    /** Somado depois da suavização, no espaço do alvo. */
    offset: Vec2Schema,
    /** 0 = cola no alvo; 1 = arrasta pela janela inteira. */
    damping: z.number().finite().min(0).max(1),
    matchRotation: z.boolean(),
    windowFrames: z.number().int().min(1).max(MAX_WINDOW_FRAMES),
  })
  .strict();

export type FollowParams = z.infer<typeof FollowParamsSchema>;

export const FOLLOW_DEFAULTS: FollowParams = Object.freeze({
  targetId: "nd_target",
  offset: [0, 0] as [number, number],
  damping: 0.5,
  matchRotation: false,
  windowFrames: 12,
});

export const followBehavior: BehaviorDefinition<FollowParams> = Object.freeze({
  type: "follow",
  label: "Seguir",
  paramSchema: FollowParamsSchema,
  defaultParams: FOLLOW_DEFAULTS,

  contribute(
    node: Node,
    params: FollowParams,
    frame: number,
    context: BehaviorContext,
  ): PropertyContribution {
    if (params.targetId === node.id) {
      return { diagnostic: "Um nó não pode seguir a si mesmo." };
    }

    const weights: number[] = [];
    const samples: { readonly point: Vec2; readonly rotation: number }[] = [];
    // `damping` **é** o decaimento: 0 mantém só o frame atual (cola no alvo) e 1
    // dá peso igual a toda a janela (atraso máximo). Usar `1 - damping` aqui
    // inverteria o sentido do parâmetro.
    const decay = params.damping;
    const window = params.damping === 0 ? 1 : params.windowFrames;

    for (let back = 0; back < window; back += 1) {
      const sample = context.sampleNode(params.targetId, frame - back);
      if (sample === undefined) continue;
      // Peso geométrico; com decay 0 só o frame atual sobrevive.
      const weight = decay === 0 ? (back === 0 ? 1 : 0) : decay ** back;
      if (weight <= 0) continue;
      weights.push(weight);
      samples.push({ point: sample.point, rotation: sample.rotation });
    }

    if (samples.length === 0) {
      return { diagnostic: `Alvo "${params.targetId}" não pôde ser amostrado.` };
    }

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let x = 0;
    let y = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const weight = (weights[index] as number) / totalWeight;
      const point = (samples[index] as { readonly point: Vec2 }).point;
      x += point[0] * weight;
      y += point[1] * weight;
    }

    const space = context.sampleNode(params.targetId, frame)?.space ?? "comp";
    const point: Vec2 = [x + params.offset[0], y + params.offset[1]];
    const anchor: Anchor =
      space === "geo"
        ? { space: "geo", lngLat: [point[0], point[1]] }
        : { space: "comp", position: [point[0], point[1]] };

    if (!params.matchRotation) return { anchor };

    // Média angular pela mesma janela, somando deltas curtos a partir da
    // primeira amostra: evita o salto de 359° → 1° de uma média ingênua.
    const base = (samples[0] as { readonly rotation: number }).rotation;
    let accumulated = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const weight = (weights[index] as number) / totalWeight;
      const rotation = (samples[index] as { readonly rotation: number }).rotation;
      accumulated += shortestAngleDelta(base, rotation) * weight;
    }

    return {
      anchor,
      rotation: base + accumulated,
      rotationReference: space === "geo" ? "geo-bearing" : "screen",
    };
  },
});
