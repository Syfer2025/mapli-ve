/**
 * Ponto do palco ↔ ponto do objeto ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
 *
 * **O problema que isto resolve.** Um ponto de interesse guardado em metros de
 * palco não pertence a nada: o modelo se move por quatro props independentes
 * (`stageX`/`altitudeMeters`/`stageZ`, `headingOffset` + `transform.rotation`,
 * `scaleMeters`) e o ponto fica onde estava. Foi como o dono descreveu o defeito —
 * _"se o avião mudar de escala os objetos ficam travados no limbo"_.
 *
 * **Por que o espaço normalizado do modelo.** O GLB é normalizado uma vez, em
 * `normalizeModel` (`three-assets.ts`): centro na origem, maior dimensão igual a 1.
 * Nesse espaço o objeto **não se move nunca** — o que se move é a matriz que o
 * palco monta por frame em `applyModelTransform`:
 *
 * ```
 * M = T(stageX, altitudeMeters − bottom·s) · S(s) · Ry(180° − rumo)
 * ```
 *
 * Guardar o ponto do outro lado dessa matriz é guardá-lo colado no objeto. Todas
 * as quatro props passam a mover o ponto de graça, porque todas as quatro estão em
 * `M`.
 *
 * A alternativa que parece igual e não é: guardar **metros** a partir da origem do
 * modelo. Segue posição e rumo, e falha exatamente no caso do pedido — dobrar
 * `scaleMeters` faz o objeto crescer e o deslocamento fixo em metros deixar o
 * ponto para trás. Registrado como alternativa D do ADR-016.
 *
 * Módulo puro, sem `three`: entra triplo e quadro de ancoragem, sai triplo.
 */

/**
 * O que basta saber do modelo para converter nos dois sentidos.
 *
 * `bottom` vem do **template** normalizado, não do documento: é a base do modelo
 * em unidades normalizadas (negativa, porque o centro está na origem). É ele que
 * faz `altitudeMeters = 0` querer dizer "apoiado no chão" em vez de "metade
 * enterrado", e por isso entra na translação.
 */
export interface AnchorFrame {
  /** Metros de palco: x leste, y altura da base, z sul. */
  readonly position: readonly [number, number, number];
  readonly headingDeg: number;
  /** Vão máximo do modelo em metros — o fator de escala do GLB normalizado. */
  readonly sizeMeters: number;
  /** Base do modelo normalizado, em unidades normalizadas. */
  readonly bottom: number;
}

/**
 * Escala mínima aceita na conversão.
 *
 * `collectStudioModels` já limita `scaleMeters` a 0,1 m no piso, mas esta função
 * também é chamada com quadro montado à mão (teste, resolvedor do roteiro), e
 * dividir por zero aqui devolveria `Infinity` que viajaria três camadas acima
 * como ponto invisível sem explicação.
 */
const MIN_SIZE_METERS = 1e-6;

function headingRadians(headingDeg: number): number {
  // A mesma convenção de `applyModelTransform`: nariz do glTF em +Z, então rumo
  // `b` pede rotação de 180° − b. Mudar um sem o outro desalinha ponto e modelo.
  return ((180 - headingDeg) * Math.PI) / 180;
}

/**
 * Ponto no espaço normalizado do modelo → metros de palco.
 *
 * É `M · p`, com o `M` de `applyModelTransform`, escrito à mão em vez de por
 * matriz: são seis multiplicações, e uma função pura sem dependência de `three`
 * pode ser testada em node junto com o compilador do roteiro.
 */
export function anchorToWorld(
  local: readonly [number, number, number],
  frame: AnchorFrame,
): readonly [number, number, number] {
  const scale = Math.max(MIN_SIZE_METERS, frame.sizeMeters);
  const theta = headingRadians(frame.headingDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    frame.position[0] + scale * (cos * local[0] + sin * local[2]),
    frame.position[1] - frame.bottom * scale + scale * local[1],
    frame.position[2] + scale * (-sin * local[0] + cos * local[2]),
  ];
}

/**
 * Metros de palco → ponto no espaço normalizado do modelo.
 *
 * `M⁻¹ · p`, e é chamada **uma vez**, no instante da marcação: o que fica guardado
 * no documento é o resultado. Se fosse chamada por frame, o ponto dependeria da
 * pose do frame em que alguém olhou — que é o acoplamento que o ADR-016 desfaz.
 */
export function worldToAnchor(
  world: readonly [number, number, number],
  frame: AnchorFrame,
): readonly [number, number, number] {
  const scale = Math.max(MIN_SIZE_METERS, frame.sizeMeters);
  const theta = headingRadians(frame.headingDeg);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ux = (world[0] - frame.position[0]) / scale;
  const uy = (world[1] - frame.position[1]) / scale + frame.bottom;
  const uz = (world[2] - frame.position[2]) / scale;
  // Ry(−θ), que é a inversa de Ry(θ) — não a transposta escrita de memória: com o
  // seno no lugar errado o ponto espelha, e espelhado ele continua na silhueta do
  // modelo, o que faz o defeito passar por "quase certo".
  return [cos * ux - sin * uz, uy, sin * ux + cos * uz];
}
