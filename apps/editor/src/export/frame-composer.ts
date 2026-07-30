import { downsampleRgbaBox } from "@theatrum/export";

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
  // Moldura da composição no palco (ADR-022). Mesma razão dos marcadores, e em
  // superfície separada deles: o critério 5 do verify:phase7e3 mede a tinta do
  // canvas de marcadores e exige que ela suma ao desligar a marcação — a moldura
  // não some, porque o aviso de enquadramento é permanente.
  ".studio-viewport__guide",
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
  /**
   * Tamanho do frame, quando o job o conhece — o `output` de
   * `planExportResolution` ([ADR-022](../../../../docs/adr/ADR-022-export-resolution-from-composition.md)).
   *
   * Sem ele o frame herda o tamanho da primeira superfície, que é como o export
   * funcionava quando o tamanho vinha da janela. Com ele o arquivo tem
   * exatamente a resolução que o painel de fila prometeu — inclusive no caso em
   * que `output` é um pixel menor que o layout, porque a composição tem lado
   * ímpar e o H.264 exige dimensão par.
   */
  readonly size?: SurfaceSize;
  /**
   * Tamanho físico das superfícies antes de qualquer redução.
   *
   * No ADR-024 ele é `resolution.render`, enquanto `size` continua sendo a
   * resolução final. Separar os dois impede tanto o pump infinito quanto um
   * `drawImage` que reduza pelo algoritmo do Chromium.
   */
  readonly renderSize?: SurfaceSize;
  /** Fator box inteiro. 1 contorna inteiramente o redutor. */
  readonly supersampling?: number;
  /**
   * Fixa a primeira pilha montada pelo resto do job.
   *
   * Motion blur não pode aceitar mapa numa amostra e palco na seguinte.
   */
  readonly lockMode?: boolean;
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
 * Esta superfície entra num frame de export?
 *
 * A regra em uma função porque ela tem **dois** consumidores, e eles não podem
 * discordar. O segundo é a transação de tamanho do ADR-022: uma superfície que o
 * compositor ignora não pode travar o export esperando chegar ao tamanho da
 * composição — e o caso real é o palco sem nó `studio.stage`, que nunca chama
 * `setSize` e fica nos 300×150 de fábrica. Custou uma rodada inteira do
 * `verify:phase8` parada em "superfícies não chegaram ao tamanho: studio".
 */
export function isComposableSurface(surface: SurfaceSize | null | undefined): boolean {
  if (surface === null || surface === undefined) return false;
  if (surface.width <= 1 || surface.height <= 1) return false;
  return !(surface.width === UNSIZED_CANVAS.width && surface.height === UNSIZED_CANVAS.height);
}

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
    if (isComposableSurface(surface)) chosen.push(surface as T);
  }
  return chosen;
}

/**
 * Pilha atômica para uma exposição temporal.
 *
 * No caminho legado uma superfície pode ser ignorada enquanto o painel monta.
 * Depois que motion blur fixa um modo, porém, aceitar só fundo ou só overlay
 * produziria um frame plausível e incompleto. A seleção só existe quando todos
 * os seletores obrigatórios existem e são componíveis.
 */
export function selectCompleteExportSurfaces<T extends SurfaceSize>(
  surfaces: readonly (T | null | undefined)[],
): readonly T[] {
  const chosen = selectExportSurfaces(surfaces);
  return chosen.length === surfaces.length ? chosen : [];
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
  #downsampled: Uint8Array | null = null;
  #boxReducedFrames = 0;
  readonly #root: ParentNode;
  readonly #includeMap: boolean;
  readonly #size: SurfaceSize | null;
  readonly #renderSize: SurfaceSize | null;
  readonly #supersampling: number;
  readonly #lockMode: boolean;
  #lockedMode: ExportMode | null = null;

  constructor(options: FrameComposerOptions = {}) {
    this.#root = options.root ?? document;
    this.#includeMap = options.includeMap ?? true;
    this.#size = options.size ?? null;
    this.#renderSize = options.renderSize ?? options.size ?? null;
    this.#supersampling = options.supersampling ?? 1;
    this.#lockMode = options.lockMode ?? false;
    if (!Number.isInteger(this.#supersampling) || this.#supersampling <= 0) {
      throw new Error(`fator de supersampling inválido: ${String(this.#supersampling)}`);
    }
    if (
      this.#supersampling > 1 &&
      (options.size === undefined || options.renderSize === undefined)
    ) {
      throw new Error("supersampling exige size de saída e renderSize explícitos");
    }
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
    // O tamanho pedido pelo job ganha da medida da superfície. A superfície ainda
    // decide quando o job não sabe — que é o caminho antigo, e o que sobra para
    // quem chama o compositor sem plano de resolução.
    const outputWidth = this.#size?.width ?? first.width;
    const outputHeight = this.#size?.height ?? first.height;
    if (outputWidth <= 1 || outputHeight <= 1) return null;

    // Fator 1 é deliberadamente o caminho anterior: mesmo canvas final, mesmo
    // `drawImage`, mesmo readback. Não reescrever a identidade é o que preserva
    // os hashes já provados pelo verify:phase8.
    const reducing = this.#supersampling > 1;
    const renderWidth = reducing ? (this.#renderSize?.width ?? first.width) : outputWidth;
    const renderHeight = reducing ? (this.#renderSize?.height ?? first.height) : outputHeight;
    if (
      reducing &&
      surfaces.some((surface) => surface.width !== renderWidth || surface.height !== renderHeight)
    ) {
      // Depois do timeout do settle, não transforme uma superfície atrasada em
      // frame plausível. O único resultado lícito é "ainda não há frame".
      return null;
    }
    const context = this.#ensureCanvas(renderWidth, renderHeight);
    // Limpar antes: o canvas é reaproveitado, e sem isto o frame anterior
    // aparece por baixo em qualquer região que as superfícies deste não cubram.
    context.clearRect(0, 0, renderWidth, renderHeight);
    for (const surface of surfaces) {
      if (reducing) {
        // O pump só chega aqui depois de todas as superfícies confirmarem
        // `renderSize`. Desenho 1:1: qualquer largura/altura de destino delegaria
        // parte do kernel ao navegador e invalidaria o ADR-024.
        context.drawImage(surface, 0, 0);
      } else {
        // Caminho legado. Em composição ímpar, a saída par é um pixel menor; este
        // comportamento fica intacto quando SS=1 para preservar os bytes atuais.
        context.drawImage(surface, 0, 0, outputWidth, outputHeight);
      }
    }

    const data = context.getImageData(0, 0, renderWidth, renderHeight).data;
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!reducing) {
      return { width: outputWidth, height: outputHeight, rgba };
    }

    const outputBytes = outputWidth * outputHeight * 4;
    if (this.#downsampled === null || this.#downsampled.byteLength !== outputBytes) {
      this.#downsampled = new Uint8Array(outputBytes);
    }
    downsampleRgbaBox(
      {
        rgba,
        width: renderWidth,
        height: renderHeight,
        factor: this.#supersampling,
        outputWidth,
        outputHeight,
      },
      this.#downsampled,
    );
    this.#boxReducedFrames += 1;
    return { width: outputWidth, height: outputHeight, rgba: this.#downsampled };
  }

  /** Quantos frames realmente atravessaram o box em CPU nesta instância. */
  get boxReducedFrames(): number {
    return this.#boxReducedFrames;
  }

  /**
   * Alguma superfície que este compositor usaria está fora do tamanho do frame?
   *
   * É a condição que o pump espera antes de capturar. Mora aqui porque aqui está
   * a única peça que sabe as duas metades: **quais** superfícies entram (pela
   * detecção de modo, que muda com a aba) e **qual** é o tamanho do frame (pelo
   * plano do job). Qualquer outro lugar teria de reimplementar uma das duas, e a
   * cópia divergiria — foi assim que uma superfície atrasada virou frame
   * esticado.
   *
   * Sem tamanho planejado a resposta é sempre `false`: o frame herda o tamanho da
   * primeira superfície, então não existe "fora de medida".
   */
  surfacesResizing(): boolean {
    const target = this.#renderSize;
    if (target === null) return false;
    const surfaces = this.#surfaces();
    if (this.#lockMode && this.#lockedMode !== null && surfaces.length === 0) return true;
    for (const surface of surfaces) {
      if (surface.width !== target.width || surface.height !== target.height) return true;
    }
    return false;
  }

  dispose(): void {
    this.#canvas = null;
    this.#context = null;
    this.#downsampled = null;
  }

  /**
   * O modo é detectado a cada frame no caminho legado.
   *
   * Deliberado: trocar de aba no meio de um export é coisa que o usuário pode
   * fazer, e detectar por frame faz o export seguir o que está na tela em vez de
   * escrever frames vazios do painel que ele deixou. Custa um `querySelector` por
   * frame — irrelevante ao lado dos 2,3 ms da composição.
   *
   * Num job temporal, a primeira chamada fixa o modo. Trocar de aba então devolve
   * superfície ausente e falha o frame inteiro, em vez de misturar dois painéis
   * dentro da mesma exposição.
   */
  #surfaces(): readonly HTMLCanvasElement[] {
    const detected = detectExportMode(this.#root);
    if (this.#lockMode && this.#lockedMode === null && detected !== null) {
      this.#lockedMode = detected;
    }
    const mode = this.#lockMode ? this.#lockedMode : detected;
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
    return this.#lockMode
      ? selectCompleteExportSurfaces(candidates)
      : selectExportSurfaces(candidates);
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
