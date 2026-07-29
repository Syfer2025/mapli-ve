/**
 * Roteiro de visitas: uma sequência de pontos de interesse vira **keyframes** nas
 * props de câmera do `studio.stage` ([ADR-015](../../../../../docs/adr/ADR-015-studio-points-of-interest.md)).
 *
 * **Por que compilar e não tocar.** Um player paralelo — um objeto que move a
 * câmera pelo roteiro enquanto o playhead anda — seria mais curto de escrever e
 * destruiria a propriedade central do projeto: a câmera deixaria de ser função
 * pura de `(documento, frame)`. Sem isso não há export byte-idêntico, que é o
 * critério que o roteiro chama de mais importante de todos, provado hoje em
 * `verify:phase8` 7/7. Compilando, a câmera continua sendo os mesmos keyframes de
 * sempre: a timeline os mostra, o editor de curvas os ajusta, o `Ctrl+Z` os
 * desfaz e o export os reproduz sem saber que um roteiro existiu.
 *
 * É o precedente da Fase 7 (ações live → keyframes) aplicado à câmera, com uma
 * diferença declarada: aquilo é um `ActionTemplate` em `packages/behaviors`, e
 * isto mora no editor. O motivo é a ordem das visitas — ela é a ordem das camadas,
 * e quem sabe calculá-la é `topologicalOrder`, de `@theatrum/scene-graph`, que
 * `behaviors` não tem entre as dependências. Duplicar a travessia lá deixaria a
 * numeração do marcador e a ordem da visita livres para divergir em silêncio, que
 * é pior do que a assimetria de pacote.
 *
 * Este módulo é puro: entra lista de paradas e tempos, sai lista de keyframes.
 * Quem grava é o painel, pelo Command Bus, como qualquer outra mutação.
 */

import { shortestAngleDelta } from "@theatrum/core-math";
import { topologicalOrder } from "@theatrum/scene-graph";
import type { AnimatableProperty, Composition, Keyframe, Node } from "@theatrum/schema";

/** Uma parada do roteiro. É um `studio.poi` lido do documento. */
export interface TourStop {
  readonly id: string;
  readonly name: string;
  /**
   * O ponto **como está no documento**, que não é necessariamente mundo.
   *
   * Com `ownerId` vazio são metros de palco; com dono é o espaço normalizado do
   * modelo ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
   * Quem transforma é o resolvedor, porque converter exige a caixa do GLB — dado
   * que não está no documento e que este módulo, sendo puro, não tem como buscar.
   */
  readonly point: readonly [number, number, number];
  /** `model3d` a que o ponto pertence, ou `""` para ponto solto do palco. */
  readonly ownerId: string;
  readonly distanceMeters: number;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  /** Lente da parada. É o zoom, que a distância sozinha não produz. */
  readonly fovDeg: number;
  /** Graus de azimute que a câmera percorre DURANTE a pausa. 0 = parada morta. */
  readonly driftDeg: number;
  /** Pausa própria em frames. 0 herda a global do palco. */
  readonly holdFrames: number;
}

/**
 * Onde a parada está, em metros de palco, no frame em que a câmera chega nela.
 *
 * **Por que recebe o frame.** Um ponto ancorado num objeto animado se move: o
 * míssil no frame 300 não está onde estava no frame 0. Resolver no frame de
 * chegada mantém a compilação função pura de `(documento, tempos)` — o que o
 * `baseValue` protegia era a dependência de onde o **playhead** estava, e o frame
 * de chegada não é isso: ele sai da própria aritmética do roteiro.
 *
 * `null` significa que o dono não respondeu, e a parada sai do roteiro com
 * diagnóstico em vez de virar um ponto perto da origem do palco.
 */
export type StopPointResolver = (
  stop: TourStop,
  frame: number,
) => readonly [number, number, number] | null;

export interface TourTiming {
  /** Frame em que a câmera já está na primeira parada. */
  readonly startFrame: number;
  /** Frames voando de uma parada à seguinte. */
  readonly travelFrames: number;
  /** Frames parado em cada ponto, para o narrador falar. */
  readonly holdFrames: number;
}

export interface NormalizedTourTiming {
  readonly startFrame: number;
  readonly travelFrames: number;
  readonly holdFrames: number;
}

export interface TourScheduleEntry<T> {
  readonly item: T;
  readonly index: number;
  readonly arrivalFrame: number;
  readonly departureFrame: number;
}

export interface TourSchedule<T> {
  readonly timing: NormalizedTourTiming;
  readonly entries: readonly TourScheduleEntry<T>[];
  readonly endFrame: number;
}

export interface TourPropertyWrite {
  /** Caminho na prop do `studio.stage`, ex.: `props.azimuthDeg`. */
  readonly path: string;
  readonly keyframes: readonly Keyframe<number>[];
}

export interface CompiledTour {
  readonly writes: readonly TourPropertyWrite[];
  /** Frame do fim da última pausa. */
  readonly endFrame: number;
  /** Paradas que entraram no roteiro. */
  readonly stops: number;
  /** Paradas descartadas por dono ausente ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)). */
  readonly skipped: number;
  readonly diagnostics: readonly string[];
}

/**
 * As seis props de câmera que uma visita escreve — as mesmas que o `studio.stage`
 * já anima. Nenhuma prop nova: é isso que faz o roteiro caber no que já existe.
 */
export const STUDIO_CAMERA_PROPERTY_PATHS = Object.freeze([
  "props.targetX",
  "props.targetY",
  "props.targetZ",
  "props.distanceMeters",
  "props.azimuthDeg",
  "props.elevationDeg",
  // A lente entra na sétima posição, e é o que faltava para existir zoom.
  // Distância aproxima e muda a perspectiva; lente comprime o fundo e isola a
  // peça sem se mover. São efeitos diferentes, e o roteiro só sabia o primeiro.
  "props.fovDeg",
] as const);

/**
 * Aceleração e desaceleração do voo.
 *
 * Câmera que parte e chega em velocidade constante parece trilho de câmera de segurança,
 * não apresentação. As alças foram abertas de `0,42/0,58` para `0,25/0,75` a pedido do
 * dono — _"passagens mais suaves"_: quanto mais perto de 0 e 1, mais longa a rampa de
 * aceleração e mais curto o trecho em velocidade plena, e é isso que tira o "arranque" da
 * partida e da chegada.
 */
const EASE_OUT_HANDLE: readonly [number, number] = [0.25, 0];
const EASE_IN_HANDLE: readonly [number, number] = [0.75, 1];

export const MIN_TRAVEL_FRAMES = 1;
export const MIN_HOLD_FRAMES = 0;

/**
 * A única aritmética de agenda do roteiro.
 *
 * O compilador a usa depois de descartar paradas que não resolvem; a Timeline
 * do Palco a usa sobre as paradas previstas pelo documento. Compartilhar esta
 * função impede que chegada e partida ganhem duas fórmulas quase iguais
 * ([ADR-019](../../../../../docs/adr/ADR-019-studio-aware-timeline.md)).
 */
export function buildStudioTourSchedule<T>(
  items: readonly T[],
  timing: TourTiming,
  /**
   * Pausa desta parada, em frames, quando ela tem uma própria.
   *
   * Opcional para não quebrar quem já chama — sem ela toda parada usa a pausa
   * global, que é o comportamento de antes, frame a frame. Existe porque o texto
   * de cada parada tem tamanho diferente: falar do radar leva menos tempo que
   * falar da cabine, e um número único obriga a escolher entre pressa numa e
   * silêncio na outra.
   */
  holdOf?: (item: T, index: number) => number,
): TourSchedule<T> {
  const normalized = normalizeStudioTourTiming(timing);
  // Acumulado, não `index × passo`: com pausas diferentes por parada o passo
  // deixa de ser constante, e a fórmula antiga passaria a mentir na terceira.
  let cursor = normalized.startFrame;
  const entries = items.map((item, index) => {
    const own = holdOf === undefined ? 0 : Math.max(0, Math.round(holdOf(item, index)));
    const hold = own > 0 ? own : normalized.holdFrames;
    const arrivalFrame = cursor;
    const departureFrame = arrivalFrame + hold;
    cursor = departureFrame + normalized.travelFrames;
    return Object.freeze({
      item,
      index,
      arrivalFrame,
      departureFrame,
    });
  });
  return Object.freeze({
    timing: normalized,
    entries: Object.freeze(entries),
    endFrame: entries.at(-1)?.departureFrame ?? normalized.startFrame,
  });
}

export function normalizeStudioTourTiming(timing: TourTiming): NormalizedTourTiming {
  return Object.freeze({
    startFrame: Math.max(0, Math.round(timing.startFrame)),
    travelFrames: Math.max(MIN_TRAVEL_FRAMES, Math.round(timing.travelFrames)),
    holdFrames: Math.max(MIN_HOLD_FRAMES, Math.round(timing.holdFrames)),
  });
}

/**
 * Passo de amostragem do alvo, em frames, quando o objeto se mexe.
 *
 * Seis frames é um quinto de segundo a 30 fps. Não é o intervalo entre keyframes — é o
 * intervalo em que a **necessidade** de um keyframe é checada. Objeto parado não gera
 * nenhum; objeto em movimento gera só onde a reta entre os vizinhos já não descreve o
 * caminho.
 */
const TRACK_SAMPLE_FRAMES = 6;

/**
 * Desvio tolerado entre o alvo real e a reta que liga dois keyframes, em metros.
 *
 * Vinte centímetros é menos que a espessura de um míssil, então o espectador não vê a
 * diferença — e é grande o bastante para um objeto praticamente parado não encher a
 * trilha de keyframes. Este número é o que troca tamanho de documento por precisão de
 * enquadramento, e por isso está aqui e não espalhado.
 */
const TRACK_TOLERANCE_METERS = 0.2;

function baseValue(props: Node["props"], key: string, fallback: number): number {
  const property = props[key] as AnimatableProperty<unknown> | undefined;
  const value = property?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function baseString(props: Node["props"], key: string): string {
  const property = props[key] as AnimatableProperty<unknown> | undefined;
  const value = property?.value;
  return typeof value === "string" ? value : "";
}

/**
 * As paradas do roteiro, lidas do **documento** e na ordem das camadas.
 *
 * Duas escolhas que valem explicação.
 *
 * **Do documento, não de um frame avaliado.** Compilar a partir da cena de um
 * frame faria a câmera do vídeo inteiro depender de quais pontos estavam visíveis
 * no instante em que alguém clicou "compilar" — um roteiro que muda conforme o
 * playhead onde você estava parado. O valor lido é o `value` base da prop; um
 * ponto que alguém animou entra pela posição de repouso, que é a única resposta
 * estável.
 *
 * **A ordem é `topologicalOrder`, a mesma que o avaliador usa.** Assim o número
 * que aparece no marcador é o número da visita, e arrastar um ponto na lista de
 * camadas reordena o roteiro — um mecanismo que o usuário já conhece, em vez de
 * uma segunda lista para manter em sincronia.
 *
 * Ponto **desligado** fica de fora: é como se exclui uma parada sem perder o
 * ponto marcado.
 */
export function documentStudioPois(composition: Composition): readonly TourStop[] {
  const stops: TourStop[] = [];
  for (const id of topologicalOrder(composition)) {
    const node = composition.nodes[id];
    if (node === undefined || node.type !== "studio.poi" || node.enabled === false) continue;
    stops.push({
      id,
      name: node.name,
      point: [
        baseValue(node.props, "pointX", 0),
        baseValue(node.props, "pointY", 0),
        baseValue(node.props, "pointZ", 0),
      ],
      ownerId: baseString(node.props, "ownerId"),
      distanceMeters: Math.max(0.01, baseValue(node.props, "distanceMeters", 12)),
      azimuthDeg: baseValue(node.props, "azimuthDeg", 35),
      elevationDeg: Math.max(-89, Math.min(89, baseValue(node.props, "elevationDeg", 18))),
      // Recuo para os padrões do tipo: um POI salvo antes destas props existirem
      // compila com a lente do palco, sem deriva e herdando a pausa global — que
      // é exatamente o comportamento que ele tinha.
      fovDeg: Math.max(5, Math.min(120, baseValue(node.props, "fovDeg", 38))),
      driftDeg: baseValue(node.props, "driftDeg", 0),
      holdFrames: Math.max(0, baseValue(node.props, "holdFrames", 0)),
    });
  }
  return stops;
}

/**
 * Azimutes contínuos, sem atravessar a costura 0/360.
 *
 * Duas paradas em 350° e 10° estão a **vinte graus** uma da outra, e a
 * interpolação linear dos keyframes não sabe disso: ela vai de 350 até 10 pelo
 * caminho longo e a câmera dá uma volta de 340° em torno do objeto. É a mesma
 * família de defeito que derrubou a propriedade de `shortestAngleDelta`
 * (09-CONTINUIDADE § 4.17): régua linear sobre grandeza modular.
 *
 * A correção é desenrolar a sequência antes de escrever — cada azimute vira o
 * representante mais próximo do anterior, e aí a régua linear já está certa. Os
 * valores podem sair fora de [0, 360), e isso não é problema: `orbitCameraPosition`
 * usa seno e cosseno, que são periódicos.
 */
export function unwrapAzimuths(degrees: readonly number[]): readonly number[] {
  const result: number[] = [];
  let previous: number | null = null;
  for (const value of degrees) {
    if (previous === null) {
      previous = value;
    } else {
      previous = previous + shortestAngleDelta(previous, value);
    }
    result.push(previous);
  }
  return result;
}

/**
 * Os tempos do roteiro, lidos das props do nó do palco.
 *
 * Do documento pela mesma razão das paradas, e com os padrões do tipo de nó como
 * recuo: um palco criado antes destas props existirem não tem as três, e o
 * roteiro dele deve compilar assim mesmo em vez de emitir frames `NaN`.
 */
export function documentStudioTourTiming(
  composition: Composition,
  stageNodeId: string,
): TourTiming {
  const props = composition.nodes[stageNodeId]?.props ?? {};
  return {
    startFrame: baseValue(props, "tourStartFrame", 0),
    travelFrames: baseValue(props, "tourTravelFrames", 30),
    holdFrames: baseValue(props, "tourHoldFrames", 60),
  };
}

/** De caminho de prop para índice do eixo, para os três que acompanham o objeto. */
const TARGET_AXIS: Readonly<Record<string, number | undefined>> = Object.freeze({
  "props.targetX": 0,
  "props.targetY": 1,
  "props.targetZ": 2,
});

interface TrackSample {
  readonly frame: number;
  readonly point: readonly [number, number, number];
}

/**
 * Os frames **intermediários** que a pausa precisa para o alvo acompanhar o objeto.
 *
 * Amostra a pausa de `TRACK_SAMPLE_FRAMES` em `TRACK_SAMPLE_FRAMES` e devolve só os
 * frames onde a interpolação entre os vizinhos **já guardados** erra por mais de
 * `TRACK_TOLERANCE_METERS`. É Douglas–Peucker sobre uma série temporal de pontos: a
 * amostra de maior desvio entra, e a checagem recomeça, até nenhuma passar da tolerância.
 *
 * Duas propriedades que valem por si:
 *
 * - **objeto parado devolve lista vazia.** Todos os desvios são zero, e o roteiro sai
 *   idêntico ao de antes deste recurso — nenhum documento estático cresce;
 * - **o resultado não depende da ordem em que as amostras foram vistas**, porque quem
 *   decide é sempre o maior desvio restante. Um laço incremental "guarda quando desviar"
 *   daria listas diferentes para o mesmo movimento conforme o passo, e ninguém entenderia
 *   por que a mesma cena gera keyframes diferentes.
 */
function trackedTargetFrames(
  stop: TourStop,
  arrival: number,
  departure: number,
  resolve: StopPointResolver,
): readonly TrackSample[] {
  const samples: TrackSample[] = [];
  for (let frame = arrival; frame <= departure; frame += TRACK_SAMPLE_FRAMES) {
    const point = resolve(stop, frame);
    if (point !== null) samples.push({ frame, point: [point[0], point[1], point[2]] });
  }
  // Os extremos já são keyframes por construção; menos de três amostras não tem meio.
  if (samples.length < 3) return [];
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) return [];

  const kept = new Set<number>([0, samples.length - 1]);
  for (;;) {
    const order = [...kept].sort((a, b) => a - b);
    let worstIndex = -1;
    let worstDeviation = TRACK_TOLERANCE_METERS;
    for (let segment = 0; segment + 1 < order.length; segment += 1) {
      const startIndex = order[segment];
      const endIndex = order[segment + 1];
      if (startIndex === undefined || endIndex === undefined) continue;
      const a = samples[startIndex];
      const b = samples[endIndex];
      if (a === undefined || b === undefined) continue;
      const span = b.frame - a.frame;
      for (let i = startIndex + 1; i < endIndex; i += 1) {
        const sample = samples[i];
        if (sample === undefined) continue;
        const t = span === 0 ? 0 : (sample.frame - a.frame) / span;
        const deviation = Math.hypot(
          a.point[0] + (b.point[0] - a.point[0]) * t - sample.point[0],
          a.point[1] + (b.point[1] - a.point[1]) * t - sample.point[1],
          a.point[2] + (b.point[2] - a.point[2]) * t - sample.point[2],
        );
        if (deviation > worstDeviation) {
          worstDeviation = deviation;
          worstIndex = i;
        }
      }
    }
    if (worstIndex < 0) break;
    kept.add(worstIndex);
  }

  // Só o meio: chegada e partida são emitidas pelo chamador, com as curvas delas.
  return [...kept]
    .sort((a, b) => a - b)
    .slice(1, -1)
    .map((index) => samples[index])
    .filter((sample): sample is TrackSample => sample !== undefined);
}

/**
 * Resolvedor padrão, para quem compila sem passar um.
 *
 * Ponto solto já está em metros de palco e resolve para si mesmo. Ponto com dono
 * **não** resolve: sem a caixa do GLB não há como convertê-lo, e devolver o valor
 * cru poria a câmera perto da origem do palco olhando o vazio — plausível, errado
 * e silencioso. Devolver `null` faz a parada sair com diagnóstico.
 */
const IDENTITY_RESOLVER: StopPointResolver = (stop) => (stop.ownerId === "" ? stop.point : null);

/**
 * Compila o roteiro.
 *
 * Cada parada recebe **dois** keyframes por prop: um na chegada e um na partida,
 * com o mesmo valor. É o par que produz a pausa — com um keyframe só, a câmera
 * chegaria e já começaria a sair, e não haveria tempo de falar do míssil.
 *
 * **Duas passagens sobre as paradas, e a razão é circular por natureza.** O frame
 * de chegada de uma parada depende de quantas paradas vêm antes dela; quais vêm
 * antes depende de quais resolvem. A primeira passagem pergunta apenas "este dono
 * existe?", que não depende de frame, e com isso fixa a lista e os tempos; a
 * segunda resolve cada ponto no frame de chegada dele, que é onde a pose do objeto
 * animado importa.
 */
export function compileStudioTour(
  stops: readonly TourStop[],
  timing: TourTiming,
  resolve: StopPointResolver = IDENTITY_RESOLVER,
): CompiledTour {
  const diagnostics: string[] = [];
  const normalizedTiming = normalizeStudioTourTiming(timing);
  const start = normalizedTiming.startFrame;
  // A pausa global não é mais lida aqui: com pausa por parada ela deixou de ser
  // um número só, e cada parada recebe a sua da agenda (`departure - arrival`).

  if (stops.length === 0) {
    return Object.freeze({
      writes: Object.freeze([]),
      endFrame: start,
      stops: 0,
      skipped: 0,
      diagnostics: Object.freeze(["Nenhum ponto de interesse na composição."]),
    });
  }

  // Passagem 1: quem tem dono que responde. O frame de sondagem é o início do
  // roteiro, e serve só para separar "dono existe" de "dono não existe" — a pose
  // que vale é a da passagem 2.
  const visited: { readonly stop: TourStop; readonly probe: readonly [number, number, number] }[] =
    [];
  let skipped = 0;
  for (const stop of stops) {
    const probe = resolve(stop, start);
    if (probe === null) {
      skipped += 1;
      diagnostics.push(
        `"${stop.name}" ficou de fora: o objeto a que ele está ancorado não foi encontrado.`,
      );
      continue;
    }
    visited.push({ stop, probe: [probe[0], probe[1], probe[2]] });
  }

  if (visited.length === 0) {
    return Object.freeze({
      writes: Object.freeze([]),
      endFrame: start,
      stops: 0,
      skipped,
      diagnostics: Object.freeze([
        ...diagnostics,
        "Nenhuma parada pôde ser localizada: o roteiro não foi compilado.",
      ]),
    });
  }
  if (visited.length === 1) {
    diagnostics.push("Um ponto só: a câmera fica parada nele, sem voo.");
  }

  const azimuths = unwrapAzimuths(visited.map((entry) => entry.stop.azimuthDeg));

  const columns = new Map<string, Keyframe<number>[]>(
    STUDIO_CAMERA_PROPERTY_PATHS.map((path) => [path, []]),
  );

  const schedule = buildStudioTourSchedule(
    visited,
    normalizedTiming,
    (entry) => entry.stop.holdFrames,
  );
  schedule.entries.forEach(({ item: entry, index, arrivalFrame, departureFrame }) => {
    const { stop } = entry;
    const arrival = arrivalFrame;
    // A pausa é DESTA parada, não a global: com pausa própria os dois números
    // divergem, e usar a global aqui poria a partida no lugar errado.
    const departure = departureFrame;
    const hold = departureFrame - arrivalFrame;
    // Passagem 2. O recuo para a sondagem cobre o resolvedor que responde num
    // frame e não noutro; hoje não acontece, porque a existência do dono não
    // depende do tempo, e é recuo em vez de erro para não transformar uma
    // mudança futura do resolvedor em keyframe `NaN`.
    const point = resolve(stop, arrival) ?? entry.probe;
    const departurePoint = hold === 0 ? point : (resolve(stop, departure) ?? point);
    const values: Readonly<Record<(typeof STUDIO_CAMERA_PROPERTY_PATHS)[number], number>> = {
      "props.targetX": point[0],
      "props.targetY": point[1],
      "props.targetZ": point[2],
      "props.distanceMeters": stop.distanceMeters,
      "props.azimuthDeg": azimuths[index] ?? stop.azimuthDeg,
      "props.elevationDeg": stop.elevationDeg,
      "props.fovDeg": stop.fovDeg,
    };
    /**
     * O alvo acompanha objeto que se mexe durante a pausa.
     *
     * Era o limite declarado do [ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md):
     * com o dono animado, o ponto se move e o alvo da câmera era um par de keyframes
     * parado, então a câmera escorregava do míssil justamente enquanto o narrador falava
     * dele. Agora a pausa é amostrada e os frames onde a reta já não descreve o caminho
     * ganham keyframe.
     *
     * **Objeto parado não paga nada.** Todos os desvios dão zero, nada é inserido, e a
     * saída é keyframe por keyframe igual à de antes — o que mantém o roteiro de uma cena
     * estática byte a byte onde estava.
     *
     * O acompanhamento cobre a **pausa**, não o voo entre paradas. No voo a câmera está
     * em movimento e os extremos já são corretos; amostrar ali brigaria com a curva de
     * aceleração e trocaria suavidade por uma precisão que ninguém vê.
     */
    const tracked = hold === 0 ? [] : trackedTargetFrames(stop, arrival, departure, resolve);

    for (const path of STUDIO_CAMERA_PROPERTY_PATHS) {
      const column = columns.get(path);
      if (column === undefined) continue;
      column.push({
        id: `tour:${String(index)}:${path}:in`,
        frame: arrival,
        value: values[path],
        // Chegada desacelera; a saída deste keyframe abre a pausa, onde o valor
        // é constante e a curva não importa.
        in: { kind: "bezier", handle: [...EASE_IN_HANDLE] },
        out: { kind: "linear" },
      });
      // Sem pausa, chegada e partida cairiam no mesmo frame e o segundo keyframe
      // sobrescreveria o primeiro — dois ids no mesmo frame é documento inválido.
      if (hold === 0) continue;

      const axis = TARGET_AXIS[path];
      if (axis !== undefined) {
        for (const sample of tracked) {
          // O eixo vem de uma tabela fechada de três, e a amostra é uma tupla de três —
          // mas o compilador não sabe disso, e escrever `!` aqui esconderia um `NaN`
          // no keyframe se a tabela algum dia crescer.
          const coordinate = sample.point[axis];
          if (coordinate === undefined) continue;
          column.push({
            id: `tour:${String(index)}:${path}:track:${String(sample.frame)}`,
            frame: sample.frame,
            value: coordinate,
            /**
             * **Linear nos dois lados, e isto não é economia.** Bézier passando por
             * pontos amostrados de um objeto em movimento ultrapassa entre amostras: a
             * câmera oscilaria em torno do alvo em vez de acompanhá-lo, e o defeito
             * apareceria como um tremor sutil que ninguém liga à curva.
             */
            in: { kind: "linear" },
            out: { kind: "linear" },
          });
        }
      }

      // Na partida o alvo é onde o objeto está **naquele** frame, não onde estava na
      // chegada: senão a câmera daria um pulo para trás no instante de sair.
      let departureValue = values[path];
      if (axis !== undefined) {
        const coordinate = departurePoint[axis];
        if (coordinate !== undefined) departureValue = coordinate;
      }
      /**
       * **Deriva na pausa.** Chegada e partida com o mesmo azimute fazem a
       * velocidade da câmera cair a zero exato e ficar lá durante toda a pausa —
       * tecnicamente é o que "pausa" quer dizer, e visualmente é o que faz a
       * apresentação parecer máquina. O dono relatou assim: _"movimentação muito
       * seca, travadona"_.
       *
       * Somar a deriva só na partida faz a câmera continuar girando devagar
       * enquanto o narrador fala, e a chegada da próxima parada parte de um
       * movimento já em curso em vez de um arranque parado. `driftDeg: 0`
       * devolve a parada morta, então projeto salvo antes disto não muda.
       *
       * Só o azimute: derivar a distância entraria em conflito com a lente, e
       * derivar a elevação sobe o horizonte de um jeito que se nota.
       */
      if (path === "props.azimuthDeg" && stop.driftDeg !== 0) {
        departureValue += stop.driftDeg;
      }
      column.push({
        id: `tour:${String(index)}:${path}:out`,
        frame: departure,
        value: departureValue,
        in: { kind: "linear" },
        out: { kind: "bezier", handle: [...EASE_OUT_HANDLE] },
      });
    }
  });

  const writes = STUDIO_CAMERA_PROPERTY_PATHS.map((path) => ({
    path,
    keyframes: Object.freeze(columns.get(path) ?? []),
  }));

  return Object.freeze({
    writes: Object.freeze(writes),
    // Sobre as paradas que entraram, não sobre as que existiam: um ponto órfão não
    // reserva tempo de vídeo para uma visita que a câmera não faz.
    endFrame: schedule.endFrame,
    stops: visited.length,
    skipped,
    diagnostics: Object.freeze(diagnostics),
  });
}
