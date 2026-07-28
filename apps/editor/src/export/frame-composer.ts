/**
 * Compõe o frame de export a partir das superfícies do **modo ativo**.
 *
 * A ordem é contrato, não detalhe. O [ADR-013](../../../../docs/adr/ADR-013-export-frame-composition.md)
 * declarou uma lista fixa de três superfícies, e o
 * [ADR-014](../../../../docs/adr/ADR-014-studio-own-panel.md) a substituiu por
 * **dois contratos, um por modo** — porque o palco saiu do painel do Viewport e
 * virou aba irmã.
 *
 * E aqui vem a consequência que só apareceu ao rodar o verificador: com duas abas
 * num grupo, **as superfícies da aba inativa não existem no DOM**. Não é questão
 * de `visibility`, é de montagem — o dockview só monta o painel ativo. Antes as
 * duas estavam sempre presentes, porque o palco era um canvas dentro do Viewport.
 *
 * Então o modo não é escolhido por configuração: é **detectado** por qual pilha
 * está montada. Isso tem a propriedade certa para uma ferramenta de animação —
 * você exporta o que está vendo — e falha com mensagem clara quando não há
 * nenhuma, em vez de escrever frames vazios.
 *
 * O canvas de gizmos (`.scene-overlay__ui`) **não entra** em nenhum dos modos, e é
 * assim que o critério 8 da Fase 8 — nenhum elemento de UI em nenhum frame — é
 * atendido por construção em vez de por disciplina.
 *
 * Custo medido: 2,3 ms por frame a 1887×965, incluindo a leitura de volta.
 */

/** Um modo de export: a superfície de fundo e o overlay que vai por cima. */
export interface ExportMode {
  readonly id: "map" | "studio";
  /** Fundo opaco. É a presença DELE no DOM que identifica o modo montado. */
  readonly background: string;
  /** Overlay Pixi do mesmo painel. */
  readonly overlay: string;
}

/**
 * Ordem de tentativa: mapa primeiro porque é o modo padrão do editor. Quem estiver
 * montado ganha; se o usuário está no palco, é o palco que exporta.
 */
export const EXPORT_MODES: readonly ExportMode[] = Object.freeze([
  Object.freeze({ id: "map", background: ".maplibregl-canvas", overlay: ".scene-overlay__pixi" }),
  Object.freeze({
    id: "studio",
    background: ".studio-viewport__stage",
    overlay: ".studio-viewport__pixi",
  }),
]);

/** Nunca compostas. Listadas para o teste poder afirmar a exclusão. */
export const EXCLUDED_SURFACE_SELECTORS: readonly string[] = Object.freeze([
  ".scene-overlay__ui",
  ".timeline-panel__canvas",
  // Marcadores de ponto de interesse do palco (ADR-015). O ADR sugeria desenhá-los
  // no overlay Pixi do palco, que já existe — mas aquele overlay É composto, e o
  // marcador é chrome de autoria. Numa superfície própria, "não sai no vídeo" é
  // propriedade desta lista, não consequência de o usuário lembrar de desligar o
  // modo de marcação antes de exportar.
  ".studio-viewport__markers",
]);

/**
 * Superfícies do modo, na ordem. Sem o fundo quando o export é matte com alfa: o
 * terreno opaco apagaria a transparência que o matte existe para produzir.
 */
export function exportSurfaceSelectors(
  mode: ExportMode,
  includeBackground: boolean,
): readonly string[] {
  return includeBackground ? [mode.background, mode.overlay] : [mode.overlay];
}

/**
 * O modo montado, ou `null` quando nenhuma pilha está.
 *
 * Um canvas com `visibility: hidden` não conta: aba inativa que ainda tenha DOM
 * (o React pode mantê-lo por um frame na troca) não deve roubar o export do modo
 * que o usuário está olhando.
 */
export function detectExportMode(root: ParentNode): ExportMode | null {
  for (const mode of EXPORT_MODES) {
    const element = root.querySelector(mode.background);
    if (!(element instanceof HTMLCanvasElement)) continue;
    if (element.width <= 1 || element.height <= 1) continue;
    const view = element.ownerDocument.defaultView;
    if (view?.getComputedStyle(element).visibility === "hidden") continue;
    return mode;
  }
  return null;
}

export interface ComposedFrame {
  readonly width: number;
  readonly height: number;
  /** RGBA de 8 bits, linha a linha de cima abaixo. */
  readonly rgba: Uint8Array;
}

export interface FrameComposerOptions {
  /** De onde procurar as superfícies. `document` no uso normal. */
  readonly root?: ParentNode;
  /** `false` produz matte RGBA: palco/overlay sobre fundo transparente. */
  readonly includeMap?: boolean;
}

/** O mínimo que a regra de seleção precisa saber de uma superfície. */
export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Tamanho padrão de um canvas nunca dimensionado. O palco fora do modo estúdio
 * tem exatamente isto, e compô-lo esticaria 300 px sobre o frame inteiro.
 */
const UNSIZED_CANVAS: SurfaceSize = { width: 300, height: 150 };

/**
 * Quais superfícies entram na composição — a regra, separada do DOM.
 *
 * Vive aparte porque é a parte que **decide** e a parte que pode dar errado em
 * silêncio; `drawImage` e `getImageData` são encanamento, provado ao vivo. Aqui
 * dá para afirmar em teste que um canvas de 300×150 é recusado e que o de gizmos
 * nunca aparece.
 */
export function selectExportSurfaces<T extends SurfaceSize>(
  surfaces: readonly (T | null | undefined)[],
): readonly T[] {
  const chosen: T[] = [];
  for (const surface of surfaces) {
    if (surface === null || surface === undefined) continue;
    if (surface.width <= 1 || surface.height <= 1) continue;
    if (surface.width === UNSIZED_CANVAS.width && surface.height === UNSIZED_CANVAS.height) {
      continue;
    }
    chosen.push(surface);
  }
  return chosen;
}

/**
 * Compositor com canvas reaproveitado entre frames.
 *
 * Um canvas novo por frame significa um contexto 2D novo por frame — e o
 * [ADR-012](../../../../docs/adr/ADR-012-studio-own-canvas.md) mediu que o teto
 * de contextos do Chromium é dezesseis. Cinco mil frames criando e descartando
 * contexto é a receita para o navegador começar a descartar os que ainda estão em
 * uso.
 */
export class FrameComposer {
  #canvas: HTMLCanvasElement | null = null;
  #context: CanvasRenderingContext2D | null = null;
  readonly #root: ParentNode;
  readonly #includeMap: boolean;

  constructor(options: FrameComposerOptions = {}) {
    this.#root = options.root ?? document;
    this.#includeMap = options.includeMap ?? true;
  }

  /**
   * Lê as três superfícies e devolve os pixels compostos.
   *
   * Superfície ausente é ignorada — o palco só existe no modo estúdio, e o
   * viewport pode estar sem mapa durante a inicialização. Superfície de tamanho
   * zero também: um canvas WebGL que ainda não foi dimensionado tem 300×150 de
   * padrão, e desenhá-lo esticaria 300 px sobre o frame inteiro.
   */
  compose(): ComposedFrame | null {
    const surfaces = this.#surfaces();
    if (surfaces.length === 0) return null;
    const first = surfaces[0] as HTMLCanvasElement;
    const width = first.width;
    const height = first.height;
    if (width <= 1 || height <= 1) return null;

    const context = this.#ensureCanvas(width, height);
    // Limpar antes: o canvas é reaproveitado, e sem isto o frame anterior
    // aparece por baixo em qualquer região que as superfícies deste não cubram.
    context.clearRect(0, 0, width, height);
    for (const surface of surfaces) {
      // Desenha no tamanho do frame, não no do canvas de origem: o palco e o
      // mapa podem estar em resoluções diferentes por um frame durante um
      // redimensionamento, e esticar é melhor que deslocar.
      context.drawImage(surface, 0, 0, width, height);
    }

    const data = context.getImageData(0, 0, width, height).data;
    return { width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  }

  dispose(): void {
    this.#canvas = null;
    this.#context = null;
  }

  /**
   * O modo é detectado a cada frame, não fixado no construtor.
   *
   * Deliberado: trocar de aba no meio de um export é coisa que o usuário pode
   * fazer, e detectar por frame faz o export seguir o que está na tela em vez de
   * escrever frames vazios do painel que ele deixou. Custa um `querySelector` por
   * frame — irrelevante ao lado dos 2,3 ms da composição.
   */
  #surfaces(): readonly HTMLCanvasElement[] {
    const mode = detectExportMode(this.#root);
    if (mode === null) return [];
    const selectors = exportSurfaceSelectors(mode, this.#includeMap);
    const candidates = selectors.map((selector) => {
      const element = this.#root.querySelector(selector);
      if (!(element instanceof HTMLCanvasElement)) return null;
      // Canvas invisível não entra: numa troca de aba o DOM antigo pode
      // sobreviver um frame, e o último quadro do painel que saiu cobriria o que
      // entrou.
      const view = element.ownerDocument.defaultView;
      if (view?.getComputedStyle(element).visibility === "hidden") return null;
      return element;
    });
    return selectExportSurfaces(candidates);
  }

  #ensureCanvas(width: number, height: number): CanvasRenderingContext2D {
    if (this.#canvas === null) {
      this.#canvas = document.createElement("canvas");
      this.#context = null;
    }
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
      // Redimensionar já limpa o canvas, mas invalida nada do contexto — ele
      // continua válido, então não vale recriar.
    }
    if (this.#context === null) {
      const context = this.#canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("contexto 2D indisponível para compor o frame");
      this.#context = context;
    }
    return this.#context;
  }
}
