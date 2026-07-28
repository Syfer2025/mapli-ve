/**
 * Compõe o frame de export a partir das três superfícies do viewport.
 *
 * A ordem é contrato, não detalhe ([ADR-013](../../../../docs/adr/ADR-013-export-frame-composition.md)):
 *
 * 1. **mapa** — MapLibre, com a camada Three.js do terreno dentro dele
 * 2. **palco 3D** — opaco quando ativo; nesse modo o mapa está escondido
 * 3. **overlay Pixi** — nós, rótulos, rotas, efeitos e filtros
 *
 * O canvas de gizmos (`.scene-overlay__ui`) **não entra**, e é assim que o
 * critério 8 da Fase 8 — nenhum elemento de UI em nenhum frame — é atendido por
 * construção em vez de por disciplina.
 *
 * Custo medido: 2,3 ms por frame a 1887×965, incluindo a leitura de volta.
 */

/** Classes das superfícies, na ordem de composição. */
export const EXPORT_SURFACE_SELECTORS: readonly string[] = Object.freeze([
  ".maplibregl-canvas",
  ".scene-overlay__studio",
  ".scene-overlay__pixi",
]);

/** Nunca compostas. Listadas para o teste poder afirmar a exclusão. */
export const EXCLUDED_SURFACE_SELECTORS: readonly string[] = Object.freeze([
  ".scene-overlay__ui",
  ".timeline-panel__canvas",
]);

export interface ComposedFrame {
  readonly width: number;
  readonly height: number;
  /** RGBA de 8 bits, linha a linha de cima abaixo. */
  readonly rgba: Uint8Array;
}

export interface FrameComposerOptions {
  /** De onde procurar as superfícies. `document` no uso normal. */
  readonly root?: ParentNode;
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

  constructor(options: FrameComposerOptions = {}) {
    this.#root = options.root ?? document;
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

  #surfaces(): readonly HTMLCanvasElement[] {
    const candidates = EXPORT_SURFACE_SELECTORS.map((selector) => {
      const element = this.#root.querySelector(selector);
      return element instanceof HTMLCanvasElement ? element : null;
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
