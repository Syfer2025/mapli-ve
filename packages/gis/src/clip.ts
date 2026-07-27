/**
 * Recorte de geometria contra a caixa visível, em graus.
 *
 * Existe por uma medição: com um país inteiro na cena e zoom de cidade, o passe
 * geográfico projetava 25 mil vértices dos quais **nenhum** aparecia na tela, e o
 * frame custava 16 ms contra um orçamento de 16,6. Descarte por caixa não resolve
 * esse caso — o anel continental da Rússia tem caixa que *contém* a vista, então
 * nem a caixa da feição nem a do anel excluem nada.
 *
 * A saída é o que sobra dentro da caixa, mais os cantos necessários para o
 * polígono continuar fechado. Isso importa: recortar jogando fora os vértices de
 * fora, sem inserir as interseções, abriria o anel e o preenchimento vazaria.
 *
 * Trabalha em **graus, antes de projetar**, porque é aí que o recorte é barato:
 * quatro comparações por vértice, contra uma projeção mercator com logaritmo. E
 * opera sobre arrays planos que o chamador reaproveita entre frames — nenhuma
 * alocação por vértice.
 *
 * A caixa vem de `map.getBounds()`, que é a caixa alinhada aos eixos da região
 * visível. Com bearing ou pitch a região é um quadrilátero e a caixa é maior que
 * ela; o recorte fica conservador, o que é o lado certo de errar.
 */

/** Caixa de recorte em graus. */
export interface ClipBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** Lados da caixa, na ordem em que Sutherland–Hodgman os aplica. */
const SIDES = Object.freeze(["west", "east", "south", "north"] as const);

type Side = (typeof SIDES)[number];

function inside(x: number, y: number, side: Side, bounds: ClipBounds): boolean {
  switch (side) {
    case "west":
      return x >= bounds.west;
    case "east":
      return x <= bounds.east;
    case "south":
      return y >= bounds.south;
    case "north":
      return y <= bounds.north;
  }
}

/** Onde o segmento cruza o lado. Chamado só quando há cruzamento. */
function crossing(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: Side,
  bounds: ClipBounds,
): readonly [number, number] {
  switch (side) {
    case "west":
    case "east": {
      const limit = side === "west" ? bounds.west : bounds.east;
      const t = (limit - x1) / (x2 - x1);
      return [limit, y1 + t * (y2 - y1)];
    }
    case "south":
    case "north": {
      const limit = side === "south" ? bounds.south : bounds.north;
      const t = (limit - y1) / (y2 - y1);
      return [x1 + t * (x2 - x1), limit];
    }
  }
}

/**
 * Quantas vezes o anel **entra** na caixa.
 *
 * É o teste que decide se Sutherland–Hodgman pode ser usado aqui. Ele tem uma
 * limitação conhecida e séria para este uso: num anel concavo que sai da vista e
 * volta a entrar, devolve **um só** anel, ligando os pedaços por uma aresta rente
 * à borda do recorte. Preenchido, isso pinta área que não existe — foi visto em
 * pixel, com a Rússia pintando Belarus e o Báltico ao longo de uma linha reta na
 * borda da vista.
 *
 * Zero ou uma entrada são seguras. Sem entrada, o anel está todo fora ou contém a
 * vista, e a saída é trivialmente certa. Com uma, a parte visível é um arco
 * contínuo e o fechamento pela borda é justamente o polígono correto.
 *
 * Conta entrada **por aresta**, não por vértice: uma aresta longa atravessa a
 * caixa inteira entre dois vértices ambos externos, e contar transições de vértice
 * perderia isso — foi o primeiro erro desta função.
 */
function visibleEntries(input: Float64Array, count: number, bounds: ClipBounds): number {
  let entries = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const ax = input[index * 2] ?? 0;
    const ay = input[index * 2 + 1] ?? 0;
    const bx = input[next * 2] ?? 0;
    const by = input[next * 2 + 1] ?? 0;
    const span = visibleSpan(ax, ay, bx, by, bounds);
    // Trecho visível que começa **no meio** da aresta é uma entrada. Aresta que já
    // começa visível continua um trecho aberto antes, e não conta de novo.
    if (span !== null && span[0] > 0) {
      entries += 1;
      // Duas entradas já bastam para recusar; anel de país tem milhares de
      // vértices que não vale percorrer para confirmar o óbvio.
      if (entries > 1) return entries;
    }
  }
  return entries;
}

/**
 * Fatia visível de um segmento, em parâmetro `[t0, t1]`, ou `null` se ele não
 * cruza a caixa. Liang–Barsky, compartilhado pelo contador e pelo recorte de
 * polilinha — ter duas cópias da mesma matemática seria pedir divergência.
 */
function visibleSpan(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bounds: ClipBounds,
): readonly [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const limits: readonly (readonly [number, number])[] = [
    [-dx, ax - bounds.west],
    [dx, bounds.east - ax],
    [-dy, ay - bounds.south],
    [dy, bounds.north - ay],
  ];
  for (const [p, q] of limits) {
    if (p === 0) {
      // Paralelo ao lado: fora dele significa segmento inteiro fora.
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [t0, t1];
}

/**
 * Recorta um anel **fechado** pelos quatro lados, em sequência.
 *
 * `input` e `output` são coordenadas intercaladas `[x, y, x, y, …]`. Devolve
 * quantos vértices ficaram em `output`; zero quer dizer que o anel está
 * inteiramente fora. `scratch` é um terceiro buffer para o pingue-pongue entre
 * lados — o chamador reaproveita os três entre frames.
 *
 * Devolve **−1** quando o resultado não cabe nos buffers. Cada lado pode dobrar a
 * contagem de vértices — um anel em estrela cruza a caixa muitas vezes, e quatro
 * lados compõem —, então nenhum dimensionamento razoável é garantia. Em vez de
 * escrever fora do buffer, recusa; o chamador projeta o anel inteiro, o que é
 * correto, só mais caro. `clipBufferSize` cobre a geometria real com folga.
 */
export function clipRing(
  input: Float64Array,
  count: number,
  bounds: ClipBounds,
  output: Float64Array,
  scratch: Float64Array,
): number {
  if (count < 3) return 0;
  // Também recusa quando o anel entra na vista mais de uma vez. Ver
  // `visibleEntries`: é o caso em que Sutherland–Hodgman devolve área que não
  // existe, e projetar o anel inteiro é a saída correta.
  if (visibleEntries(input, count, bounds) > 1) return -1;
  const capacity = Math.min(output.length, scratch.length) >> 1;

  let source = input;
  let sourceCount = count;
  let target = output;
  let spare = scratch;

  for (const side of SIDES) {
    let written = 0;
    for (let index = 0; index < sourceCount; index += 1) {
      const currentIndex = index * 2;
      const previousIndex = ((index + sourceCount - 1) % sourceCount) * 2;
      const cx = source[currentIndex] ?? 0;
      const cy = source[currentIndex + 1] ?? 0;
      const px = source[previousIndex] ?? 0;
      const py = source[previousIndex + 1] ?? 0;
      const currentInside = inside(cx, cy, side, bounds);
      const previousInside = inside(px, py, side, bounds);

      // Cada vértice de entrada gera no máximo dois de saída: a interseção e ele.
      if (written + 2 > capacity) return -1;
      if (currentInside) {
        if (!previousInside) {
          const [ix, iy] = crossing(px, py, cx, cy, side, bounds);
          target[written * 2] = ix;
          target[written * 2 + 1] = iy;
          written += 1;
        }
        target[written * 2] = cx;
        target[written * 2 + 1] = cy;
        written += 1;
      } else if (previousInside) {
        const [ix, iy] = crossing(px, py, cx, cy, side, bounds);
        target[written * 2] = ix;
        target[written * 2 + 1] = iy;
        written += 1;
      }
    }

    if (written === 0) return 0;
    // Pingue-pongue: a saída deste lado é a entrada do próximo. `input` nunca é
    // escrito, então o chamador pode reaproveitá-lo.
    const nextSource = target;
    target = source === input ? spare : source;
    spare = source === input ? source : spare;
    source = nextSource;
    sourceCount = written;
  }

  // Se a última troca deixou o resultado fora de `output`, copia de volta — o
  // chamador espera o resultado lá, sempre.
  if (source !== output) {
    output.set(source.subarray(0, sourceCount * 2));
  }
  return sourceCount;
}

/**
 * Recorta uma polilinha **aberta**, como um rio.
 *
 * Não dá para usar Sutherland–Hodgman: ele fecharia a linha, ligando a nascente à
 * foz. Aqui cada segmento é recortado por conta própria (Liang–Barsky), e o
 * resultado é uma lista de pedaços — um rio que entra e sai da vista duas vezes
 * volta como dois pedaços.
 *
 * `onPiece` recebe cada pedaço como fatia de `output`, com deslocamento e
 * contagem em vértices.
 */
export function clipPolyline(
  input: Float64Array,
  count: number,
  bounds: ClipBounds,
  output: Float64Array,
  onPiece: (offset: number, vertexCount: number) => void,
): void {
  if (count < 2) return;

  let written = 0;
  let pieceStart = 0;
  let pieceLength = 0;

  const flush = (): void => {
    if (pieceLength >= 2) onPiece(pieceStart, pieceLength);
    pieceStart = written;
    pieceLength = 0;
  };

  for (let index = 0; index + 1 < count; index += 1) {
    const ax = input[index * 2] ?? 0;
    const ay = input[index * 2 + 1] ?? 0;
    const bx = input[(index + 1) * 2] ?? 0;
    const by = input[(index + 1) * 2 + 1] ?? 0;

    const span = visibleSpan(ax, ay, bx, by, bounds);
    if (span === null) {
      flush();
      continue;
    }

    const [t0, t1] = span;
    const dx = bx - ax;
    const dy = by - ay;
    const sx = ax + t0 * dx;
    const sy = ay + t0 * dy;
    const ex = ax + t1 * dx;
    const ey = ay + t1 * dy;

    // Emenda com o pedaço em curso quando o início coincide com o fim anterior.
    const continues =
      pieceLength > 0 &&
      Math.abs((output[(written - 1) * 2] ?? 0) - sx) < 1e-12 &&
      Math.abs((output[(written - 1) * 2 + 1] ?? 0) - sy) < 1e-12;
    if (!continues) {
      flush();
      output[written * 2] = sx;
      output[written * 2 + 1] = sy;
      written += 1;
      pieceLength += 1;
    }
    output[written * 2] = ex;
    output[written * 2 + 1] = ey;
    written += 1;
    pieceLength += 1;

    // Saiu da caixa antes do fim do segmento: o pedaço termina aqui.
    if (t1 < 1) flush();
  }
  flush();
}

/**
 * Dimensionamento dos buffers de recorte para um anel de `count` vértices.
 *
 * Quatro vezes a entrada mais folga. **Não é limite teórico** — o pior caso de
 * Sutherland–Hodgman dobra a contagem por lado, o que daria dezesseis vezes. É o
 * que cobre geometria real de fronteira com margem larga; acima disso o
 * `clipRing` recusa e o chamador projeta o anel inteiro.
 */
export function clipBufferSize(count: number): number {
  return count * 8 + 32;
}
