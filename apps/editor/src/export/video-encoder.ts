/**
 * Codificação H.264 dos frames compostos, empacotada em MP4 fragmentado.
 *
 * Duas escolhas que decidem se o arquivo é determinístico, e as duas foram
 * medidas no Electron desta máquina:
 *
 * 1. **`latencyMode: "quality"`.** O modo `realtime` deixa o codificador
 *    descartar trabalho para acompanhar o relógio de parede — e a decisão dele
 *    depende de quanto a máquina estava ocupada. Em `quality` a saída é função só
 *    da entrada: codificar os mesmos doze frames duas vezes deu **os mesmos
 *    bytes**, em H.264 e em VP8.
 * 2. **Nenhum timestamp de relógio no contêiner.** Os `creation_time` do MP4 são
 *    zero, e o muxer não consulta `Date`.
 *
 * O `avcC` só chega no primeiro `output` do encoder, e o cabeçalho do arquivo
 * precisa dele — então o cabeçalho é escrito **depois** do primeiro chunk, não
 * antes. Escrever antes com um `avcC` inventado dá um arquivo que abre e mostra
 * tela verde.
 */

import {
  VIDEO_TIMESCALE,
  mp4Fragment,
  mp4Header,
  toTimescale,
  type EncodedSample,
} from "@theatrum/export";
import type { ComposedFrame } from "./frame-composer.js";

/** Quantos frames por fragmento do MP4. */
const SAMPLES_PER_FRAGMENT = 30;

/**
 * Intervalo entre quadros-chave, em frames.
 *
 * Sessenta é o compromisso usual: busca rápida no player sem inflar o arquivo.
 * Cada fragmento **tem de** começar num quadro-chave, e por isso o intervalo é
 * múltiplo de `SAMPLES_PER_FRAGMENT`.
 */
const KEYFRAME_INTERVAL = 60;

export interface VideoEncodeOptions {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Bits por segundo. */
  readonly bitrate: number;
  /** Recebe pedaços do arquivo na ordem; deve escrever em modo append. */
  readonly write: (bytes: Uint8Array) => Promise<void>;
}

export interface VideoEncodeSession {
  /** Empurra um frame composto. Chamar em ordem crescente de índice. */
  readonly push: (frame: ComposedFrame, index: number) => Promise<void>;
  /** Fecha o arquivo: drena o encoder e escreve o último fragmento. */
  readonly finish: () => Promise<{ readonly frames: number; readonly bytes: number }>;
  /** Cancela o codec e espera qualquer escrita temporária já enfileirada. */
  readonly abort: () => Promise<void>;
  readonly close: () => void;
}

export function isVideoEncodingSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

/**
 * H.264 só aceita dimensão **par**, nos dois eixos.
 *
 * Não é capricho do Chromium: o 4:2:0 amostra croma a cada dois pixels, e meia
 * amostra não existe. O erro que ele devolve é claro — "H264 only supports even
 * sized frames" — mas chega **depois** de o export começar, porque o encoder só
 * valida no primeiro `encode`. Um viewport de 1227×643, que é o tamanho real
 * desta janela, tem os dois lados ímpares.
 *
 * Recorte, e não preenchimento. Uma coluna de um pixel a menos é invisível; uma
 * faixa preta de um pixel na borda aparece em toda a duração do vídeo.
 */
export function evenSize(width: number, height: number): { width: number; height: number } {
  return { width: width - (width % 2), height: height - (height % 2) };
}

/**
 * Recorta o RGBA para as dimensões pedidas, quando elas diferem das do frame.
 *
 * Cópia linha a linha porque tirar uma coluna muda o passo: os pixels de uma
 * linha deixam de ser contíguos com os da seguinte. Só acontece quando a largura
 * é ímpar; com largura par e altura ímpar basta ignorar a última linha, e o
 * `subarray` sai de graça.
 */
export function cropRgba(
  rgba: Uint8Array,
  from: { readonly width: number; readonly height: number },
  to: { readonly width: number; readonly height: number },
): Uint8Array {
  if (from.width === to.width && from.height === to.height) return rgba;
  if (from.width === to.width) return rgba.subarray(0, to.width * to.height * 4);
  const out = new Uint8Array(to.width * to.height * 4);
  const sourceStride = from.width * 4;
  const targetStride = to.width * 4;
  for (let y = 0; y < to.height; y += 1) {
    out.set(rgba.subarray(y * sourceStride, y * sourceStride + targetStride), y * targetStride);
  }
  return out;
}

/**
 * Abre uma sessão de codificação.
 *
 * Os erros do `VideoEncoder` chegam por callback, fora da pilha de quem chamou.
 * Guardá-los e relançar no próximo `push` ou no `finish` é o que impede um export
 * de terminar "com sucesso" tendo perdido metade dos frames.
 */
export function createVideoEncodeSession(options: VideoEncodeOptions): VideoEncodeSession {
  // Dimensões do arquivo, fixadas pares na abertura. Um MP4 declara largura e
  // altura uma vez, no cabeçalho; mudar no meio não é representável.
  const size = evenSize(options.width, options.height);
  const samples: EncodedSample[] = [];
  const frameDuration = toTimescale(1_000_000 / options.fps, VIDEO_TIMESCALE);
  let description: Uint8Array | null = null;
  let headerWritten = false;
  let sequence = 1;
  let decodeTime = 0;
  let encodedFrames = 0;
  let writtenBytes = 0;
  let failure: string | null = null;
  /** Fila de escrita: as escritas têm de sair na ordem em que os bytes nascem. */
  let writeChain: Promise<void> = Promise.resolve();

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const config = metadata?.decoderConfig?.description;
      if (description === null && config !== undefined) {
        // O tipo declara `ArrayBuffer | SharedArrayBuffer | ArrayBufferView`, e
        // uma view precisa do trio buffer/offset/length para não copiar o buffer
        // inteiro quando ela é uma janela sobre algo maior.
        description = ArrayBuffer.isView(config)
          ? new Uint8Array(config.buffer as ArrayBuffer, config.byteOffset, config.byteLength)
          : new Uint8Array(config as ArrayBuffer);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({
        keyFrame: chunk.type === "key",
        timestamp: toTimescale(chunk.timestamp, VIDEO_TIMESCALE),
        duration: frameDuration,
        data,
      });
      encodedFrames += 1;
    },
    error: (error) => {
      failure = error.message;
    },
  });

  encoder.configure({
    codec: "avc1.640028",
    width: size.width,
    height: size.height,
    bitrate: options.bitrate,
    framerate: options.fps,
    latencyMode: "quality",
    // O encoder decide os quadros-chave por conta se `keyFrame` não for pedido;
    // pedir explicitamente é o que garante que todo fragmento comece com um.
    avc: { format: "avc" },
  });

  const enqueueWrite = (bytes: Uint8Array): void => {
    writtenBytes += bytes.byteLength;
    writeChain = writeChain.then(() => options.write(bytes));
  };

  /** Escreve o cabeçalho na primeira oportunidade em que o `avcC` existe. */
  const ensureHeader = (): void => {
    if (headerWritten || description === null) return;
    enqueueWrite(
      mp4Header({
        width: size.width,
        height: size.height,
        timescale: VIDEO_TIMESCALE,
        description,
      }),
    );
    headerWritten = true;
  };

  const flushFragment = (force: boolean): void => {
    if (samples.length === 0) return;
    if (!force && samples.length < SAMPLES_PER_FRAGMENT) return;
    ensureHeader();
    if (!headerWritten) return;
    const fragment = mp4Fragment(samples, sequence, decodeTime);
    if (fragment === null) return;
    enqueueWrite(fragment.bytes);
    sequence = fragment.sequence;
    decodeTime = fragment.nextDecodeTime;
    samples.length = 0;
  };

  const raiseIfFailed = (): void => {
    if (failure !== null) throw new Error(`codificador falhou: ${failure}`);
  };

  return {
    push: async (frame, index) => {
      raiseIfFailed();
      // `VideoFrame` de RGBA cru: sem passar por canvas, então sem depender de
      // conversão de espaço de cor do compositor do navegador.
      const cropped = cropRgba(frame.rgba, frame, size);
      const videoFrame = new VideoFrame(cropped, {
        format: "RGBA",
        codedWidth: size.width,
        codedHeight: size.height,
        timestamp: Math.round((index * 1_000_000) / options.fps),
        duration: Math.round(1_000_000 / options.fps),
      });
      try {
        encoder.encode(videoFrame, { keyFrame: index % KEYFRAME_INTERVAL === 0 });
      } finally {
        // Sempre: um `VideoFrame` não fechado retém memória de GPU, e cinco mil
        // deles derrubam o processo.
        videoFrame.close();
      }
      // Não deixar a fila do encoder crescer sem limite. Cada frame de 4K são
      // 33 MB de RGBA, e o pump é mais rápido que o codificador.
      if (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) => {
          encoder.addEventListener("dequeue", () => resolve(), { once: true });
        });
      }
      flushFragment(false);
    },

    finish: async () => {
      raiseIfFailed();
      await encoder.flush();
      raiseIfFailed();
      flushFragment(true);
      await writeChain;
      return { frames: encodedFrames, bytes: writtenBytes };
    },

    abort: async () => {
      if (encoder.state !== "closed") encoder.close();
      // A publicação/remoção do temporário só pode vir depois de toda escrita
      // que já atravessou o IPC. Sem esta barreira, um append atrasado poderia
      // recriar o arquivo parcial depois de o cancelamento dizer que o removeu.
      await writeChain;
    },

    close: () => {
      if (encoder.state !== "closed") encoder.close();
    },
  };
}
