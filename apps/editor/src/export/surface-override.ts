/**
 * O tamanho que as superfícies assumem **durante** um export, e a transação que
 * o devolve.
 *
 * É a ligação que faltava do
 * [ADR-022](../../../../docs/adr/ADR-022-export-resolution-from-composition.md):
 * a conta pura já existe em `@theatrum/export` (`planExportResolution`), o
 * mecanismo já foi provado byte-idêntico pelo pump real em 1920×1080 e em
 * 3840×2160, e o que faltava era conduzir mapa, palco e overlays até lá.
 *
 * **Por que um store e não props.** As superfícies moram em painéis diferentes do
 * dockview e não têm parentesco em React — o mapa no Viewport, o palco na aba
 * irmã, e quem dispara o export é o painel de fila, um terceiro. É o mesmo
 * problema que o `export-controller.ts` resolveu, e com a mesma resposta: um
 * `useSyncExternalStore` de poucas linhas, para só quem assina re-renderizar.
 *
 * **Por que transação, e não um `setSize` solto.** O tamanho medido tem de voltar
 * em `finally`, como os passes offscreen do
 * [ADR-018](../../../../docs/adr/ADR-018-studio-planar-floor-reflection.md) já
 * fazem com target, viewport e máscaras. Export que estoura no meio não pode
 * deixar o painel do usuário em 4K.
 *
 * **Por que predicado de estado, e não confirmação de evento.** A primeira versão
 * fazia cada superfície confirmar a geração que tinha aplicado, e isso custou uma
 * regressão medida: o mapa redimensiona de forma **síncrona** em `map.resize()`,
 * mas o overlay Pixi só chega ao tamanho novo depois de `ResizeObserver` →
 * `setState` → efeito de render. A confirmação chegava antes, o pump começava, e o
 * `frame-composer` — que agora compõe no tamanho **planejado** — desenhava um
 * overlay de 2360×800 esticado dentro de 1920×1080. O frame saía plausível e
 * diferente entre execuções, e o critério 6 do `verify:phase8` passou a oscilar.
 *
 * Um evento diz "eu recebi"; um predicado diz "eu estou". Só o segundo é
 * verificável, e é o que impede a transação de soltar o corpo cedo demais.
 *
 * **Por que não uma espera de N ms.** Espera fixa mede o frame velho — a armadilha
 * que já custou uma conclusão errada sobre 4K (`tools/probes/README.md`, lição 2).
 *
 * Superfície de aba inativa **não existe no DOM** e por isso não se registra —
 * então ela não trava o export, que é o comportamento certo: o `frame-composer`
 * exporta o modo montado.
 */

import { isComposableSurface } from "./frame-composer.js";

/** Tamanho de CSS e multiplicador do backing store, durante o export. */
export interface SurfaceOverride {
  /** Largura em pixels de CSS. É `composition.width`. */
  readonly width: number;
  /** Altura em pixels de CSS. É `composition.height`. */
  readonly height: number;
  /**
   * Multiplicador do backing store: `map.setPixelRatio`, a `pixelRatio` da
   * `ScreenScene` do Pixi e o `setPixelRatio` do renderer do palco.
   */
  readonly pixelRatio: number;
}

export interface SurfaceOverrideState {
  /** `null` significa "cada superfície usa o tamanho que mediu", o normal. */
  readonly override: SurfaceOverride | null;
  /**
   * Sobe a cada mudança, inclusive na volta ao normal.
   *
   * É o que uma superfície confirma. Comparar o próprio override por igualdade
   * de valor não serviria: entrar em 1920×1080 e sair para 1920×1080 são estados
   * diferentes para quem espera, e o segundo nunca seria notado.
   */
  readonly generation: number;
}

/**
 * "Estou no tamanho que este estado pede?"
 *
 * Recebe `null` quando não há export em curso, e aí a resposta é sempre sim: fora
 * do export nenhum tamanho é errado. Devolver o tamanho real em vez de um booleano
 * seria melhor para a mensagem de erro, mas exigiria que toda superfície soubesse
 * formatá-lo; o nome da superfície já basta para saber onde olhar.
 */
export type SurfaceConformance = (override: SurfaceOverride | null) => boolean;

const IDLE: SurfaceOverrideState = Object.freeze({ override: null, generation: 0 });

let state: SurfaceOverrideState = IDLE;
const listeners = new Set<() => void>();
/** Superfícies montadas agora, e como cada uma responde se já chegou lá. */
const registered = new Map<string, SurfaceConformance>();

function emit(next: SurfaceOverrideState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeSurfaceOverride(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSurfaceOverrideSnapshot(): SurfaceOverrideState {
  return state;
}

/** Uma superfície se anuncia ao montar e se retira ao desmontar. */
export function registerExportSurface(id: string, conforms: SurfaceConformance): () => void {
  registered.set(id, conforms);
  return () => {
    registered.delete(id);
  };
}

/** Só para teste: devolve o módulo ao estado de fábrica. */
export function resetSurfaceOverrideForTest(): void {
  state = IDLE;
  listeners.clear();
  registered.clear();
}

function pending(override: SurfaceOverride | null): readonly string[] {
  const faltando: string[] = [];
  for (const [id, conforms] of registered) {
    // Superfície que estoura ao se medir conta como não conforme. Deixar a
    // exceção subir mataria o export por um `null` numa ref durante uma troca de
    // aba, que é justamente o caso em que ela não precisa mais ser esperada.
    let ok: boolean;
    try {
      ok = conforms(override);
    } catch {
      ok = false;
    }
    if (!ok) faltando.push(id);
  }
  return faltando;
}

/**
 * Espera as superfícies montadas **estarem** no tamanho pedido.
 *
 * O teto existe porque a alternativa é um export que nunca começa. Um caso real
 * cai aqui: se o teto concreto da GPU ficar abaixo do `maxCanvasSize` configurado,
 * o canvas nunca alcança o tamanho pedido. Estourar
 * nomeando a superfície é o comportamento que o ADR-022 escolheu — recusar em vez
 * de cortar calado.
 */
async function waitForConformance(
  override: SurfaceOverride | null,
  timeoutMs: number,
  shouldAbort?: () => boolean,
): Promise<void> {
  if (shouldAbort?.() === true) return;
  if (pending(override).length === 0) return;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 16));
    if (shouldAbort?.() === true) return;
    const faltando = pending(override);
    if (faltando.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `superfícies não chegaram ao tamanho de export em ${String(timeoutMs)} ms: ` +
          `${faltando.join(", ")}. Teto da GPU/MapLibre (8192 px por eixo) é o suspeito ` +
          `quando a escala é alta.`,
      );
    }
  }
}

export const SURFACE_OVERRIDE_TIMEOUT_MS = 10_000;

/**
 * Conduz as superfícies ao tamanho pedido, roda o corpo, e devolve o tamanho
 * medido em `finally`.
 *
 * Recusa aninhamento de propósito. Dois exports simultâneos sobre uma superfície
 * só não é um caso a suportar — é o gatilho de revisão 1 do ADR-022, que manda a
 * segunda instância de motor voltar à mesa quando ele acontecer. Aceitar aqui
 * produziria o pior dos mundos: o segundo job redimensionaria por baixo do
 * primeiro e os dois arquivos sairiam plausíveis.
 */
export async function runWithSurfaceOverride<T>(
  override: SurfaceOverride,
  body: () => Promise<T>,
  options: { readonly timeoutMs?: number; readonly shouldAbort?: () => boolean } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? SURFACE_OVERRIDE_TIMEOUT_MS;
  if (state.override !== null) {
    throw new Error("já há um export conduzindo as superfícies; espere ele terminar");
  }
  emit({ override, generation: state.generation + 1 });
  try {
    await waitForConformance(override, timeoutMs, options.shouldAbort);
    return await body();
  } finally {
    emit({ override: null, generation: state.generation + 1 });
    // A volta é esperada, mas sem propagar: se uma superfície morreu no meio do
    // export, o erro que interessa é o do export, não o da restauração dela.
    await waitForConformance(null, timeoutMs).catch(() => undefined);
  }
}

/**
 * O tamanho físico que uma superfície deve ter sob este estado.
 *
 * Um lugar só, e por isso as três superfícies não podem discordar sobre o que
 * "estar no tamanho" quer dizer. `Math.round` porque é o que o MapLibre e o Three
 * fazem ao multiplicar CSS por `pixelRatio`.
 */
export function expectedSurfacePixels(
  override: SurfaceOverride | null,
): { readonly width: number; readonly height: number } | null {
  if (override === null) return null;
  return {
    width: Math.round(override.width * override.pixelRatio),
    height: Math.round(override.height * override.pixelRatio),
  };
}

/** O mínimo que este módulo precisa de um canvas para decidir. */
export interface MeasuredSurface {
  readonly width: number;
  readonly height: number;
  /** `false` quando o elemento saiu do documento. Ausente, presume-se conectado. */
  readonly isConnected?: boolean;
}

/**
 * Capacidades do contexto que sustenta uma superfície composta.
 *
 * `probed: false` existe para os doubles puros dos testes e para consumidores
 * sem DOM. Um canvas real possui `getContext`; nesse caso a ausência de WebGL
 * deixa de ser "não sei" e passa a ser falha. Tamanho de backing store sozinho
 * não prova que o framebuffer sobreviveu à alocação.
 */
export interface SurfaceGpuCapabilities {
  readonly probed: boolean;
  readonly available: boolean;
  readonly contextLost: boolean;
  readonly preserveDrawingBuffer: boolean | null;
  /** Alocação real do contexto, não apenas os atributos do elemento canvas. */
  readonly drawingBuffer: readonly [number, number] | null;
  readonly maxTextureSize: number | null;
  readonly maxRenderbufferSize: number | null;
  readonly maxViewport: readonly [number, number] | null;
}

interface WebGlProbe {
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  readonly MAX_TEXTURE_SIZE: number;
  readonly MAX_RENDERBUFFER_SIZE: number;
  readonly MAX_VIEWPORT_DIMS: number;
  readonly getParameter: (parameter: number) => unknown;
  readonly getContextAttributes: () => { readonly preserveDrawingBuffer?: boolean } | null;
  readonly isContextLost: () => boolean;
}

function isWebGlProbe(value: unknown): value is WebGlProbe {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "getParameter") === "function" &&
    typeof Reflect.get(value, "getContextAttributes") === "function" &&
    typeof Reflect.get(value, "isContextLost") === "function" &&
    typeof Reflect.get(value, "drawingBufferWidth") === "number" &&
    typeof Reflect.get(value, "drawingBufferHeight") === "number" &&
    typeof Reflect.get(value, "MAX_TEXTURE_SIZE") === "number" &&
    typeof Reflect.get(value, "MAX_RENDERBUFFER_SIZE") === "number" &&
    typeof Reflect.get(value, "MAX_VIEWPORT_DIMS") === "number"
  );
}

function finiteLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function viewportLimit(value: unknown): readonly [number, number] | null {
  if (
    (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    finiteLimit(Reflect.get(value, "0")) !== null &&
    finiteLimit(Reflect.get(value, "1")) !== null
  ) {
    return Object.freeze([
      finiteLimit(Reflect.get(value, "0")) as number,
      finiteLimit(Reflect.get(value, "1")) as number,
    ]);
  }
  return null;
}

/**
 * Lê o contexto que já pertence ao canvas e as três cotas que limitam uma
 * superfície direta. O verificador 8K relata os mesmos números.
 */
export function inspectSurfaceGpu(canvas: MeasuredSurface): SurfaceGpuCapabilities {
  const getContext = Reflect.get(canvas, "getContext");
  if (typeof getContext !== "function") {
    return Object.freeze({
      probed: false,
      available: false,
      contextLost: false,
      preserveDrawingBuffer: null,
      drawingBuffer: null,
      maxTextureSize: null,
      maxRenderbufferSize: null,
      maxViewport: null,
    });
  }

  let candidate: unknown = null;
  try {
    candidate =
      Reflect.apply(getContext, canvas, ["webgl2"]) ?? Reflect.apply(getContext, canvas, ["webgl"]);
  } catch {
    // Context creation can throw on unavailable or lost GPU devices.
  }
  if (!isWebGlProbe(candidate)) {
    return Object.freeze({
      probed: true,
      available: false,
      contextLost: false,
      preserveDrawingBuffer: null,
      drawingBuffer: null,
      maxTextureSize: null,
      maxRenderbufferSize: null,
      maxViewport: null,
    });
  }

  const contextLost = candidate.isContextLost();
  const attributes = candidate.getContextAttributes();
  return Object.freeze({
    probed: true,
    available: true,
    contextLost,
    preserveDrawingBuffer: attributes?.preserveDrawingBuffer ?? null,
    drawingBuffer:
      finiteLimit(candidate.drawingBufferWidth) === null ||
      finiteLimit(candidate.drawingBufferHeight) === null
        ? null
        : Object.freeze([candidate.drawingBufferWidth, candidate.drawingBufferHeight] as [
            number,
            number,
          ]),
    maxTextureSize: finiteLimit(candidate.getParameter(candidate.MAX_TEXTURE_SIZE)),
    maxRenderbufferSize: finiteLimit(candidate.getParameter(candidate.MAX_RENDERBUFFER_SIZE)),
    maxViewport: viewportLimit(candidate.getParameter(candidate.MAX_VIEWPORT_DIMS)),
  });
}

function gpuSupportsSurface(
  capabilities: SurfaceGpuCapabilities,
  expected: { readonly width: number; readonly height: number },
): boolean {
  if (!capabilities.probed) return true;
  const longest = Math.max(expected.width, expected.height);
  return (
    capabilities.available &&
    !capabilities.contextLost &&
    capabilities.preserveDrawingBuffer === true &&
    capabilities.drawingBuffer !== null &&
    capabilities.drawingBuffer[0] === expected.width &&
    capabilities.drawingBuffer[1] === expected.height &&
    (capabilities.maxTextureSize ?? 0) >= longest &&
    (capabilities.maxRenderbufferSize ?? 0) >= longest &&
    (capabilities.maxViewport?.[0] ?? 0) >= expected.width &&
    (capabilities.maxViewport?.[1] ?? 0) >= expected.height
  );
}

/**
 * A superfície está no tamanho pedido?
 *
 * Quatro respostas, e três delas são "não se aplica". Cada uma custou uma rodada:
 *
 * - **fora do export**, sempre sim: nenhum tamanho de painel é errado;
 * - **superfície fora do documento**, sempre sim. O dockview desmonta o painel
 *   inativo, e o canvas dele **guarda o último tamanho** — 2032×828 no caso
 *   medido. Ele não recebe `ResizeObserver`, então nunca chegaria ao tamanho da
 *   composição, e esperar por ele travou o export por 10 s e devolveu zero frame.
 *   O `frame-composer` já não o compõe: ele procura por `querySelector` no
 *   documento, e o que não está lá não entra no frame;
 * - **superfície que o compositor ignora**, sempre sim. É o palco sem nó
 *   `studio.stage`, que nunca chama `setSize` e fica nos 300×150 de fábrica. A
 *   regra de "entra no frame?" é a do `frame-composer`, importada em vez de
 *   repetida, porque duas cópias dela divergiriam e a divergência sairia como
 *   frame esticado;
 * - **caso contrário**, igualdade exata. Um pixel de diferença faz o compositor
 *   **escalar** a superfície dentro do frame planejado, que é como a primeira
 *   versão desta peça produziu frames plausíveis e diferentes entre execuções.
 */
export function surfaceMatches(
  override: SurfaceOverride | null,
  canvas: MeasuredSurface | null | undefined,
): boolean {
  const expected = expectedSurfacePixels(override);
  if (expected === null) return true;
  if (canvas === null || canvas === undefined) return true;
  if (canvas.isConnected === false) return true;
  if (!isComposableSurface(canvas)) return true;
  return (
    canvas.width === expected.width &&
    canvas.height === expected.height &&
    gpuSupportsSurface(inspectSurfaceGpu(canvas), expected)
  );
}

/**
 * A `pixelRatio` que uma superfície deve usar agora.
 *
 * Um lugar só, pelo mesmo motivo que `effectiveStageCamera` existe: se cada
 * superfície decidisse por conta, bastaria uma esquecer o override para o frame
 * sair com o mapa em 4K e o overlay em 1×, e a composição escalaria um sobre o
 * outro sem erro nenhum.
 */
export function effectivePixelRatio(
  override: SurfaceOverride | null,
  fallback: number,
  max = Number.POSITIVE_INFINITY,
): number {
  if (override !== null) return override.pixelRatio;
  return Math.max(1, Math.min(fallback, max));
}
