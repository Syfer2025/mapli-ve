import type { EvaluatedScene } from "@theatrum/animation";
import type { ActionExpansion } from "@theatrum/behaviors";
import type { Vec2 } from "@theatrum/core-math";

/**
 * Centro de câmera produzido por uma Action no frame atual.
 *
 * Fora da faixa dos keyframes de câmera a navegação manual continua intocada.
 * Isso evita que a simples presença de um bombardeio leve o mapa ao alvo antes
 * do primeiro impacto ou o prenda lá depois do último tremor.
 */
export function activeActionCameraCenter(
  evaluated: EvaluatedScene,
  expansions: readonly ActionExpansion[],
): Vec2 | null {
  let first = Infinity;
  let last = -Infinity;
  for (const expansion of expansions) {
    for (const write of expansion.keyframes) {
      if (write.target.kind !== "camera" || write.path[0] !== "center") continue;
      first = Math.min(first, write.keyframe.frame);
      last = Math.max(last, write.keyframe.frame);
    }
  }
  if (evaluated.frame < first || evaluated.frame > last) return null;
  return [evaluated.camera.center[0], evaluated.camera.center[1]];
}
