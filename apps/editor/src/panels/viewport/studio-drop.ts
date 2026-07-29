/**
 * Arrastar da biblioteca e soltar no palco.
 *
 * O pedido do dono foi direto: _"não to conseguindo jogar modelos 3D lá dentro... crie
 * um sistema de drag and drop para facilitar"_.
 *
 * Duas peças puras vivem aqui, e nenhuma toca DOM ou `three`:
 *
 * - o **transporte**: o que viaja no `DataTransfer` entre um painel e outro, com
 *   ida e volta travada por teste. Um formato solto aqui produz o pior tipo de defeito
 *   de arrastar — o que só falha com o item errado, no painel errado, e não deixa rastro;
 * - a **mira no piso**: onde, em metros de palco, o cursor tocou o chão. É o que faz o
 *   modelo nascer onde foi solto em vez de sempre na origem, que é a diferença entre
 *   compor uma cena e ficar digitando `stageX` no Inspector.
 */

import { DEG_TO_RAD, type Vec3 } from "@theatrum/core-math";

/**
 * Tipo MIME próprio, e não `text/plain`.
 *
 * Com `text/plain` qualquer texto arrastado de qualquer lugar — uma seleção do navegador,
 * um nome de arquivo — chegaria ao palco parecendo um pedido legítimo de criar modelo. O
 * tipo próprio faz o palco só aceitar o que este editor arrastou.
 */
export const STUDIO_DROP_MIME = "application/x-theatrum-model";

/**
 * O que viaja no arraste.
 *
 * `asset` é um modelo que **já está** no projeto, identificado pelo `src` — o mesmo
 * valor que `props.assetId` guarda (ver as armadilhas do 09-CONTINUIDADE: o nome da prop
 * mente). `local` é um modelo que existe no disco e ainda não foi importado; soltá-lo
 * atravessa a fronteira da biblioteca para dentro do projeto.
 */
export type StudioDropPayload =
  | { readonly kind: "asset"; readonly src: string }
  | { readonly kind: "local"; readonly file: string };

export function encodeStudioDrop(payload: StudioDropPayload): string {
  return JSON.stringify(payload);
}

/**
 * `null` para qualquer coisa que não seja exatamente o que escrevemos.
 *
 * Recusar em silêncio é o comportamento certo: o alternativo é o palco tentar
 * interpretar texto arbitrário e criar um nó com asset inexistente, que é o defeito que
 * o dono acabou de encontrar por outro caminho.
 */
export function decodeStudioDrop(raw: string): StudioDropPayload | null {
  if (raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { kind?: unknown; src?: unknown; file?: unknown };
  if (candidate.kind === "asset" && typeof candidate.src === "string" && candidate.src !== "") {
    return { kind: "asset", src: candidate.src };
  }
  if (candidate.kind === "local" && typeof candidate.file === "string" && candidate.file !== "") {
    return { kind: "local", file: candidate.file };
  }
  return null;
}

/**
 * Onde o pixel `(x, y)` toca o piso do palco, em metros.
 *
 * Raio da câmera contra o plano `y = altura`, resolvido à mão em vez de por raycast de
 * geometria: o piso do palco é **infinito** e não existe como malha finita, então não há
 * o que interceptar. O mesmo motivo pelo qual o `pick` do ADR-015 recusa o chão de
 * propósito — só que aqui o chão é justamente o alvo.
 *
 * `null` quando o raio aponta para cima ou é paralelo ao piso: com a câmera rasante, o
 * cursor acima do horizonte não toca chão nenhum, e inventar uma distância enorme poria
 * o modelo a quilômetros de distância sem explicação.
 */
export function floorPointAt(
  x: number,
  y: number,
  viewport: readonly [number, number],
  camera: {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fovDeg: number;
  },
  floorY = 0,
): Vec3 | null {
  const [width, height] = viewport;
  if (width <= 0 || height <= 0) return null;

  // Base da câmera: para onde olha, o que é direita, o que é cima.
  const forward = normalize([
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]);
  if (forward === null) return null;
  // O "para cima" do mundo, o mesmo do `PerspectiveCamera` do palco. Com a câmera
  // exatamente no zênite isto degenera — e é por isso que a elevação é limitada a 89°
  // em `orbitCameraPosition`, o que mantém este produto vetorial bem condicionado.
  const right = normalize(cross(forward, [0, 1, 0]));
  if (right === null) return null;
  const up = cross(right, forward);

  // Do pixel para a direção do raio, pela mesma geometria do frustum que o three usa.
  const halfHeight = Math.tan((camera.fovDeg * DEG_TO_RAD) / 2);
  const aspect = width / height;
  const ndcX = (x / width) * 2 - 1;
  const ndcY = 1 - (y / height) * 2;
  const direction = normalize([
    forward[0] + right[0] * ndcX * halfHeight * aspect + up[0] * ndcY * halfHeight,
    forward[1] + right[1] * ndcX * halfHeight * aspect + up[1] * ndcY * halfHeight,
    forward[2] + right[2] * ndcX * halfHeight * aspect + up[2] * ndcY * halfHeight,
  ]);
  if (direction === null) return null;

  // Interseção com o plano do piso. Denominador quase zero é raio paralelo ao chão.
  if (Math.abs(direction[1]) < 1e-6) return null;
  const distance = (floorY - camera.position[1]) / direction[1];
  if (distance <= 0) return null;
  return [
    camera.position[0] + direction[0] * distance,
    floorY,
    camera.position[2] + direction[2] * distance,
  ];
}

function normalize(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-12) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
