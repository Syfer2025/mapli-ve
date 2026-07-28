/**
 * Muxer MP4 fragmentado, para os chunks que o `VideoEncoder` produz.
 *
 * **Fragmentado (fMP4) e não MP4 clássico**, por uma razão de memória: o MP4
 * clássico põe a tabela de amostras (`stbl`) no cabeçalho, e o cabeçalho vem
 * antes dos dados — então o muxer precisaria de todos os tamanhos de amostra
 * antes de escrever o primeiro byte, ou seja, do vídeo inteiro em RAM. Noventa
 * segundos de 4K a 40 Mbps são 450 MB. O fMP4 escreve `moof` + `mdat` por
 * fragmento, e cada fragmento só conhece a si mesmo.
 *
 * Determinismo: nada aqui consulta relógio, aleatoriedade nem ambiente. Os
 * `creation_time` são **zero** de propósito — um timestamp real tornaria dois
 * exports do mesmo projeto diferentes, e é justamente o critério que a
 * [Fase 8](../../../docs/08-ROADMAP.md#fase-8--exportação) exige.
 *
 * Medido no Electron desta máquina: `VideoEncoder` com `latencyMode: "quality"`
 * produz **os mesmos bytes** ao codificar os mesmos frames duas vezes, em H.264 e
 * em VP8. Sem isso, nenhum muxer salvaria o critério.
 */

import {
  UNITY_MATRIX,
  ascii,
  box,
  concat,
  fixed1616,
  fixed88,
  fullBox,
  u16,
  u32,
  u64,
  type Bytes,
} from "./mp4-boxes.js";

/** Um chunk codificado, já copiado para fora do `EncodedVideoChunk`. */
export interface EncodedSample {
  /** `true` para quadro-chave (IDR). O primeiro de um fragmento deve ser um. */
  readonly keyFrame: boolean;
  /** Apresentação, em unidades da escala de tempo da trilha. */
  readonly timestamp: number;
  readonly duration: number;
  readonly data: Bytes;
}

export interface Mp4TrackConfig {
  readonly width: number;
  readonly height: number;
  /**
   * Unidades de tempo por segundo. **90 000** é a convenção de vídeo e não é
   * arbitrária: é divisível por 24, 25, 30, 50 e 60, então nenhuma taxa comum
   * gera duração fracionária que teria de ser arredondada frame a frame.
   */
  readonly timescale: number;
  /**
   * `avcC` do `decoderConfig.description` do encoder — SPS e PPS empacotados.
   * Sem isto o arquivo abre e mostra tela verde: o decodificador não sabe o
   * perfil, o nível nem o tamanho do prefixo de comprimento das NAL.
   */
  readonly description: Bytes;
}

export const VIDEO_TIMESCALE = 90_000;

/** Id da trilha. Um vídeo só; áudio entraria como trilha 2. */
const TRACK_ID = 1;

/**
 * Cabeçalho do arquivo: `ftyp` mais `moov`.
 *
 * O `moov` de um fMP4 descreve a trilha e declara, via `mvex`, que as amostras
 * vêm em fragmentos — a tabela de amostras fica **vazia**. Um `stbl` preenchido
 * aqui e fragmentos depois é um arquivo contraditório, e os players reagem de
 * formas diferentes a isso.
 */
export function mp4Header(config: Mp4TrackConfig): Bytes {
  return concat([
    box(
      "ftyp",
      ascii("isom"),
      u32(0x200),
      // `iso6` é o que declara suporte a fragmentos; `mp41` amplia a
      // compatibilidade com players antigos que ignoram o resto.
      ascii("isom"),
      ascii("iso2"),
      ascii("avc1"),
      ascii("iso6"),
      ascii("mp41"),
    ),
    box("moov", movieHeader(config), trak(config), mvex()),
  ]);
}

function movieHeader(config: Mp4TrackConfig): Bytes {
  return fullBox(
    "mvhd",
    0,
    0,
    u32(0), // criação: zero, para o arquivo não depender do relógio
    u32(0), // modificação: idem
    u32(config.timescale),
    // Duração zero: num fMP4 a duração real vive no `mehd` ou é deduzida pelos
    // fragmentos. Declarar um número aqui e outro nos fragmentos faz o player
    // cortar o vídeo no menor dos dois.
    u32(0),
    fixed1616(1), // taxa de reprodução
    fixed88(1), // volume
    u16(0),
    u32(0),
    u32(0),
    UNITY_MATRIX,
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(TRACK_ID + 1), // próximo id de trilha livre
  );
}

function trak(config: Mp4TrackConfig): Bytes {
  return box("trak", trackHeader(config), mdia(config));
}

/**
 * Cabeçalho da trilha.
 *
 * **A ordem e a largura dos campos aqui são exatas, e errar não dá erro.** A
 * primeira versão deste arquivo omitiu `duration` e metade do `reserved`: doze
 * bytes a menos. O resultado é que a matriz, a largura e a altura passam a ser
 * lidas doze bytes adiantadas, e o Chromium recusa o arquivo sem dizer por quê —
 * a estrutura de caixas continua íntegra, todos os tamanhos batem, e um leitor de
 * caixas não vê problema nenhum. Só o decodificador vê.
 *
 * O corpo tem **80 bytes** depois de versão e flags, e existe um teste que afirma
 * exatamente esse número.
 */
function trackHeader(config: Mp4TrackConfig): Bytes {
  return fullBox(
    "tkhd",
    0,
    // 0x3 = trilha habilitada e usada na apresentação. Sem estes bits o player
    // lê a trilha e não a exibe.
    0x3,
    u32(0), // criação
    u32(0), // modificação
    u32(TRACK_ID),
    u32(0), // reservado
    // Duração zero: num fMP4 ela vem dos fragmentos. Mas o campo **tem de estar
    // aqui** — foi a ausência dele que desalinhou tudo o que vem depois.
    u32(0),
    u32(0), // reservado (2 × 32)
    u32(0),
    u16(0), // camada
    u16(0), // grupo alternativo
    u16(0), // volume (zero para vídeo)
    u16(0), // reservado
    UNITY_MATRIX,
    // Largura e altura da *apresentação*, em 16.16 — distintas das do `stsd`,
    // que são de codificação. Iguais aqui porque não há pixel não quadrado.
    fixed1616(config.width),
    fixed1616(config.height),
  );
}

function mdia(config: Mp4TrackConfig): Bytes {
  return box(
    "mdia",
    fullBox(
      "mdhd",
      0,
      0,
      u32(0),
      u32(0),
      u32(config.timescale),
      u32(0),
      // 0x55c4 = "und" (idioma indeterminado) empacotado em cinco bits por letra.
      u16(0x55c4),
      u16(0),
    ),
    fullBox(
      "hdlr",
      0,
      0,
      u32(0),
      ascii("vide"),
      u32(0),
      u32(0),
      u32(0),
      // Nome do handler, terminado em nulo. Livre, mas tem de terminar.
      ascii("Theatrum\0"),
    ),
    minf(config),
  );
}

function minf(config: Mp4TrackConfig): Bytes {
  return box(
    "minf",
    // `vmhd`: modo de composição. Flags 1 é obrigatório aqui.
    fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)),
    box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
    stbl(config),
  );
}

/**
 * Tabela de amostras **vazia**, com o `stsd` preenchido.
 *
 * Todas as contagens em zero é o que faz deste um arquivo fragmentado. O `stsd`
 * ainda precisa estar completo: é ali que vive o `avcC`, e sem ele o
 * decodificador não arranca.
 */
function stbl(config: Mp4TrackConfig): Bytes {
  return box(
    "stbl",
    fullBox("stsd", 0, 0, u32(1), avc1(config)),
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0)),
  );
}

function avc1(config: Mp4TrackConfig): Bytes {
  return box(
    "avc1",
    u32(0), // reservado
    u16(0),
    u16(1), // índice do data reference
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(0),
    u16(config.width),
    u16(config.height),
    u32(0x00480000), // 72 dpi horizontal
    u32(0x00480000), // 72 dpi vertical
    u32(0),
    u16(1), // um frame por amostra
    // Nome do compressor: 32 bytes com o comprimento no primeiro. Zeros passam.
    new Uint8Array(32),
    u16(0x18), // profundidade de cor
    u16(0xffff), // tabela de cores: nenhuma
    box("avcC", config.description),
  );
}

/**
 * `mvex` — "movie extends": avisa que existem fragmentos.
 *
 * O `trex` carrega os padrões por amostra. Deixamos duração e tamanho em zero e
 * repetimos os valores reais em cada `trun`: assim um fragmento é legível sem
 * consultar o cabeçalho, o que importa quando o arquivo é lido em streaming.
 */
function mvex(): Bytes {
  return box(
    "mvex",
    fullBox(
      "trex",
      0,
      0,
      u32(TRACK_ID),
      u32(1), // índice da descrição de amostra
      u32(0),
      u32(0),
      u32(0),
    ),
  );
}

export interface Fragment {
  readonly bytes: Bytes;
  /** Onde o próximo fragmento começa, em unidades de tempo. */
  readonly nextDecodeTime: number;
  readonly sequence: number;
}

/**
 * Um fragmento: `moof` mais `mdat`.
 *
 * O campo espinhoso é o `data_offset` do `trun` — a distância do **início do
 * moof** até o primeiro byte de amostra. Ele só pode ser calculado depois de o
 * `moof` ter tamanho conhecido, e o tamanho do `moof` depende do próprio campo.
 * A saída é a de sempre: montar com o valor zerado para medir, e remontar com o
 * número certo. Errar isso produz um arquivo que abre e não decodifica nada.
 */
export function mp4Fragment(
  samples: readonly EncodedSample[],
  sequence: number,
  decodeTime: number,
): Fragment | null {
  if (samples.length === 0) return null;

  const probe = moof(samples, sequence, decodeTime, 0);
  // +8 pelo cabeçalho do `mdat`, que fica entre o fim do `moof` e a primeira amostra.
  const dataOffset = probe.byteLength + 8;
  const header = moof(samples, sequence, decodeTime, dataOffset);
  if (header.byteLength !== probe.byteLength) {
    // Só aconteceria se a remontagem mudasse de tamanho, o que não pode: o campo
    // é de largura fixa. Falhar alto é melhor que escrever arquivo torto.
    throw new Error("moof mudou de tamanho ao fixar o data_offset");
  }

  const mdat = box("mdat", ...samples.map((sample) => sample.data));
  let duration = 0;
  for (const sample of samples) duration += sample.duration;

  return {
    bytes: concat([header, mdat]),
    nextDecodeTime: decodeTime + duration,
    sequence: sequence + 1,
  };
}

function moof(
  samples: readonly EncodedSample[],
  sequence: number,
  decodeTime: number,
  dataOffset: number,
): Bytes {
  return box(
    "moof",
    fullBox("mfhd", 0, 0, u32(sequence)),
    box(
      "traf",
      // Flags 0x020000 = default-base-is-moof: os offsets são relativos ao início
      // do `moof`, e não a uma âncora anterior. É o que torna o fragmento
      // autocontido.
      fullBox("tfhd", 0, 0x020000, u32(TRACK_ID)),
      // `tfdt` versão 1: tempo de decodificação em 64 bits. Versão 0 tem 32, e
      // estoura em 13 horas a 90 kHz — perto o bastante para não valer o risco.
      fullBox("tfdt", 1, 0, u64(decodeTime)),
      trun(samples, dataOffset),
    ),
  );
}

/**
 * `trun` — a corrida de amostras.
 *
 * Flags: 0x000001 data-offset, 0x000100 duração por amostra, 0x000200 tamanho
 * por amostra, 0x000400 flags por amostra. As três últimas é que permitem
 * duração e tamanho variáveis, o que um codificador com quadro-chave esparso
 * sempre produz.
 */
function trun(samples: readonly EncodedSample[], dataOffset: number): Bytes {
  const rows: Bytes[] = [];
  for (const sample of samples) {
    rows.push(
      u32(sample.duration),
      u32(sample.data.byteLength),
      // 0x02000000 = amostra **não** é ponto de sincronismo (depende de outras).
      // 0x01000000 = é. Marcar tudo como sincronismo faria o player procurar em
      // qualquer frame e mostrar lixo até o próximo IDR de verdade.
      u32(sample.keyFrame ? 0x02000000 : 0x01010000),
    );
  }
  return fullBox(
    "trun",
    0,
    0x000001 | 0x000100 | 0x000200 | 0x000400,
    u32(samples.length),
    u32(dataOffset),
    ...rows,
  );
}

/**
 * Converte microssegundos do WebCodecs para a escala de tempo da trilha.
 *
 * Arredondamento, não truncamento, e **sobre o valor absoluto** — nunca somando
 * durações. Truncar acumula atraso; acumular soma erro. Os dois quebram a
 * sincronia num vídeo longo, e de formas que só aparecem no fim.
 */
export function toTimescale(microseconds: number, timescale: number): number {
  return Math.round((microseconds * timescale) / 1_000_000);
}
