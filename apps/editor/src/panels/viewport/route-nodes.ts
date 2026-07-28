/**
 * Passe de rotas 2D (7C): caminho do projeto → geometria de seta em pixels.
 *
 * Mora aqui e não no avaliador pelo mesmo motivo do passe geográfico: a projeção
 * depende da câmera do mapa **deste frame**, e L2 não conhece MapLibre. O nó já
 * existe no documento com todas as props animadas resolvidas; o que falta é
 * `props.strokes` e `props.fills`, e é isso que este passe acrescenta.
 *
 * Toda a geometria vem de funções puras de `@theatrum/core-math`, testadas sem
 * GPU. Aqui só há projeção, ordem de operações e a decisão de o que desenhar.
 */

import type { EvaluatedScene } from "@theatrum/animation";
import { pathGeometry, pointAt } from "@theatrum/behaviors";
import {
  arrowHead,
  dashPolyline,
  fatArrow,
  trimPolyline,
  type Rect,
  type Vec2,
} from "@theatrum/core-math";
import type { ScreenNode, ScreenScene } from "@theatrum/renderer";
import type { ScreenScene as LayoutScreenScene } from "@theatrum/scene-graph";
import type { PathData } from "@theatrum/schema";

/**
 * Amostragem adaptativa: um vértice a cada `PIXELS_PER_SAMPLE`, entre um mínimo
 * e um máximo.
 *
 * A primeira versão amostrava 128 pontos sempre, e **isso não passou no
 * orçamento**: com 50 rotas na tela, 6400 chamadas de `map.project()` custaram
 * 8,9 ms de um teto de 8 ms — só a projeção, antes de qualquer desenho.
 *
 * O número certo não é uma constante, é uma função do tamanho na tela. Uma rota
 * de 200 px não fica mais lisa com 128 vértices: eles caem a menos de dois
 * pixels um do outro e o traçador nem os distingue. Uma travessia continental
 * precisa deles todos, porque o caminho é cúbico e a projeção não é linear —
 * uma geodésica Kursk→Berlim é reta no globo e curva na tela.
 *
 * Doze pixels entre vértices mantém o desvio da corda abaixo de meio pixel em
 * qualquer curvatura que apareça num mapa; e um passe grosseiro de oito amostras
 * mede o tamanho antes, o que custa 6% do que custava amostrar tudo.
 */
const PIXELS_PER_SAMPLE = 12;
const MIN_SAMPLES = 12;
const MAX_SAMPLES = 128;
const PROBE_SAMPLES = 8;

export interface RouteDiagnostic {
  readonly nodeId: string;
  readonly message: string;
}

export interface RouteExpansion {
  readonly scene: ScreenScene;
  readonly diagnostics: readonly RouteDiagnostic[];
  /** Rotas que desenharam alguma coisa. */
  readonly drawn: number;
  /** Caminhos que estas rotas consomem — o overlay não os desenha de novo. */
  readonly pathIds: ReadonlySet<string>;
  /**
   * Caixa real de cada rota desenhada, em pixels absolutos. O layout genérico
   * mede o tamanho padrão do nó (64 px) na âncora; a extensão de verdade só é
   * conhecida depois de projetar o caminho. Sem isto, clique e gizmo apontam
   * para um quadradinho em vez da seta.
   */
  readonly bounds: ReadonlyMap<string, Rect>;
}

/**
 * Preenche `strokes` e `fills` de cada nó `route` visível.
 *
 * Devolve uma cena nova; os nós que não são rota passam intactos.
 */
export function expandRouteNodes(
  screen: ScreenScene,
  evaluated: EvaluatedScene,
  layout: LayoutScreenScene,
  paths: Readonly<Record<string, PathData>>,
  project: (lngLat: Vec2) => Vec2,
): RouteExpansion {
  const diagnostics: RouteDiagnostic[] = [];
  const pathIds = new Set<string>();
  const bounds = new Map<string, Rect>();
  /**
   * Caminho projetado por `pathId`, válido só dentro deste frame.
   *
   * Várias rotas sobre o mesmo caminho é o caso normal, não exceção — é assim
   * que se desenha um eixo de ataque com contorno escuro por baixo, ou o mesmo
   * avanço em duas cores ao longo do tempo. Sem o memo, cada uma reprojetava as
   * mesmas ~60 amostras: com 50 rotas medi 3300 chamadas de `map.project()` por
   * frame, contra 66 com ele.
   */
  const projectedPaths = new Map<string, readonly Vec2[]>();
  let drawn = 0;
  let nodes: Map<string, ScreenNode> | null = null;

  for (const [id, node] of evaluated.nodes) {
    if ((node.type !== "route" && node.type !== "geo.frontline") || node.visible === false) {
      continue;
    }
    const own = layout.layouts.get(id);
    const target = screen.nodes.get(id);
    if (own === undefined || target === undefined) continue;

    const props = node.props as Readonly<Record<string, unknown>>;
    const frontline = node.type === "geo.frontline";
    const pathId = frontline ? `frontline:${id}` : str(props, "pathId", "");
    const path = frontline ? frontlinePath(id, props) : paths[pathId];
    if (path === undefined) {
      diagnostics.push({
        nodeId: id,
        message: frontline
          ? "GeoJSON da linha de frente é inválido"
          : `caminho ausente: ${pathId || "(vazio)"}`,
      });
      continue;
    }
    if (!frontline) pathIds.add(pathId);

    let absolute = projectedPaths.get(pathId);
    if (absolute === undefined) {
      absolute = projectPath(path, project);
      projectedPaths.set(pathId, absolute);
    }
    if (absolute.length < 2) {
      diagnostics.push({ nodeId: id, message: "caminho sem geometria" });
      continue;
    }
    // O contêiner do nó já está na âncora; devolver absoluto somaria a posição
    // duas vezes. O memo guarda o absoluto (que é o mesmo para todas as rotas do
    // caminho) e cada nó desconta a própria âncora aqui.
    const projected = absolute.map((point): Vec2 => [
      point[0] - own.anchorPx[0],
      point[1] - own.anchorPx[1],
    ]);

    // Ordem que importa: recortar PRIMEIRO, e só depois medir a ponta e o
    // tracejado. A ponta tem de nascer no fim do trecho **revelado**, não no fim
    // do caminho — senão a seta fica parada no destino enquanto a linha cresce
    // por baixo dela, que é exatamente o defeito que a revelação existe para
    // evitar.
    const visible = trimPolyline(
      projected,
      clamp01(num(props, "trimStart", 0)),
      clamp01(num(props, "trimEnd", 1)),
    );
    if (visible.length < 2) {
      // Revelação em zero não é erro: é o frame antes de a seta começar.
      nodes = nodes ?? new Map(screen.nodes);
      nodes.set(id, withGeometry(target, [], []));
      continue;
    }

    const strokes: (readonly Vec2[])[] = [];
    const fills: (readonly Vec2[])[] = [];

    if (bool(props, "filled", false)) {
      fills.push(
        fatArrow(visible, {
          bodyWidth: Math.max(0, num(props, "bodyWidth", 18)),
          headWidth: Math.max(0, num(props, "headWidth", 52)),
          headLength: Math.max(0, num(props, "headLength", 46)),
        }),
      );
    } else {
      const dash = Math.max(0, num(props, "dashPx", 0));
      const gap = Math.max(0, num(props, "gapPx", 0));
      if (dash > 0 && gap > 0) {
        strokes.push(...dashPolyline(visible, dash, gap, num(props, "dashOffset", 0)));
      } else {
        strokes.push(visible);
      }
      const arrowSize = Math.max(0, num(props, "arrowSize", 0));
      // A ponta é preenchida mesmo numa rota tracejada: um triângulo tracejado
      // não lê como seta. E ela usa `visible` inteiro, não o último traço — a
      // direção tem de vir do caminho, não de onde o padrão calhou de cortar.
      if (arrowSize > 0) fills.push(arrowHead(visible, arrowSize, num(props, "arrowSpread", 26)));
    }

    nodes = nodes ?? new Map(screen.nodes);
    nodes.set(id, withGeometry(target, strokes, fills));
    if (strokes.length > 0 || fills.length > 0) {
      drawn += 1;
      const box = boundsOf([...strokes, ...fills], own.anchorPx);
      if (box !== null) bounds.set(id, box);
    }
  }

  return {
    scene: nodes === null ? screen : { ...screen, nodes },
    diagnostics: Object.freeze(diagnostics),
    drawn,
    pathIds,
    bounds,
  };
}

function frontlinePath(
  nodeId: string,
  props: Readonly<Record<string, unknown>>,
): PathData | undefined {
  const geometry = props["geometry"];
  if (
    typeof geometry !== "object" ||
    geometry === null ||
    Reflect.get(geometry, "type") !== "LineString"
  ) {
    return undefined;
  }
  const coordinates = Reflect.get(geometry, "coordinates");
  if (!Array.isArray(coordinates) || coordinates.length < 2) return undefined;
  const points: Vec2[] = [];
  for (const coordinate of coordinates) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length !== 2 ||
      typeof coordinate[0] !== "number" ||
      typeof coordinate[1] !== "number" ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1])
    ) {
      return undefined;
    }
    points.push([coordinate[0], coordinate[1]]);
  }
  return {
    id: `frontline:${nodeId}`,
    name: "Linha de frente",
    space: "geo",
    vertices: points.map((point) => ({
      point: [point[0], point[1]],
      inHandle: null,
      outHandle: null,
    })),
    closed: false,
    interpolation: "linear",
    geodesic: true,
  };
}

/**
 * Marca o nó como visível quando há o que desenhar.
 *
 * Isto não é otimismo, é correção de um descarte errado. O layout genérico
 * decide visibilidade pela caixa **padrão do nó** — 64 px na âncora — e a âncora
 * de uma rota não diz nada sobre onde ela passa: uma rota nasce com âncora em
 * (0°, 20°), no golfo da Guiné, e desenha Kursk→Belgorod. Sem esta linha o nó é
 * cortado com a geometria inteira dentro da tela, e o passe relata `drawn: 1`
 * sobre uma imagem vazia — foi exatamente esse o engano na primeira medição.
 */
function withGeometry(
  node: ScreenNode,
  strokes: readonly (readonly Vec2[])[],
  fills: readonly (readonly Vec2[])[],
): ScreenNode {
  const hasGeometry = strokes.length > 0 || fills.length > 0;
  return {
    ...node,
    props: { ...node.props, strokes, fills },
    layout: { ...node.layout, visible: node.layout.visible || hasGeometry },
  };
}

/** Caixa envolvente de tudo que foi desenhado, em pixels absolutos. */
function boundsOf(groups: readonly (readonly Vec2[])[], anchorPx: Vec2): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const group of groups) {
    for (const point of group) {
      if (point[0] < minX) minX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] > maxY) maxY = point[1];
    }
  }
  if (minX > maxX) return null;
  return {
    x: minX + anchorPx[0],
    y: minY + anchorPx[1],
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Caminho do projeto → polilinha em pixels **absolutos** de tela.
 *
 * Absoluto, e não relativo à âncora, para poder ser memoizado por caminho: o
 * resultado depende só do caminho e da câmera, então serve a todas as rotas que
 * apontam para ele. Quem desconta a âncora é o chamador — o layout já posicionou
 * o contêiner ali, e não descontar somaria a posição duas vezes (o mesmo
 * deslocamento silencioso que já apareceu no passe geográfico).
 *
 * Um caminho em espaço `comp` já está em pixels de composição; um `geo` passa
 * pelo projetor do mapa. Amostrar por `progress` é o que faz a rota desenhada
 * coincidir com a trajetória que o `motion-path` percorre — a mesma métrica de
 * comprimento de arco, não uma poligonal parecida.
 */
function projectPath(path: PathData, project: (lngLat: Vec2) => Vec2): readonly Vec2[] {
  const geometry = pathGeometry(path);
  if (geometry.segments.length === 0 || geometry.totalLength <= 0) return [];
  const toScreen = (progress: number): Vec2 => {
    const point = pointAt(geometry, progress);
    return path.space === "geo" ? project([point[0], point[1]]) : [point[0], point[1]];
  };

  // Passe grosseiro: quanto esta rota ocupa na tela **agora**. O comprimento em
  // metros não serve — o mesmo caminho tem 30 px afastado e 3000 px de perto.
  let probeLength = 0;
  let previous = toScreen(0);
  for (let step = 1; step <= PROBE_SAMPLES; step += 1) {
    const here = toScreen(step / PROBE_SAMPLES);
    probeLength += Math.hypot(here[0] - previous[0], here[1] - previous[1]);
    previous = here;
  }
  const samples = Math.max(
    MIN_SAMPLES,
    Math.min(MAX_SAMPLES, Math.ceil(probeLength / PIXELS_PER_SAMPLE)),
  );

  const points: Vec2[] = [];
  for (let step = 0; step <= samples; step += 1) points.push(toScreen(step / samples));
  return points;
}

function num(props: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(props: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = props[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function bool(props: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const value = props[key];
  return typeof value === "boolean" ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
