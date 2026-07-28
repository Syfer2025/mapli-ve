/**
 * Escrita dos frames de export em disco, no processo principal.
 *
 * Aqui e não no renderer por uma razão que é o critério da
 * [Fase 8](../../../../../docs/08-ROADMAP.md#fase-8--exportação): **byte-idêntico**.
 * `canvas.toBlob("image/png")` produz um PNG cujos bytes dependem do
 * codificador do Chromium — comprimento de bloco, nível de compressão, ordem de
 * chunks auxiliares — e nada disso é contrato. Um PNG que nós mesmos montamos com
 * o `zlib` do Node tem bytes que são função só dos pixels e dos parâmetros que
 * escolhemos.
 *
 * Ver [ADR-013](../../../../../docs/adr/ADR-013-export-frame-composition.md).
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { deflateSync, constants as zlibConstants } from "node:zlib";
import { app, dialog, type BrowserWindow } from "electron";

export interface ExportBeginRequest {
  /** Nome da pasta de saída dentro do destino escolhido. */
  readonly jobName: string;
  /** Destino já conhecido; presente, o diálogo é pulado. */
  readonly directory?: string;
  /** Cria uma pasta privada de PNGs para um encoder posterior. */
  readonly staging?: boolean;
}

export interface ExportBeginResult {
  readonly ok: boolean;
  /** Pasta onde os frames serão escritos. Vazia quando o usuário cancelou. */
  readonly directory: string;
  readonly framesDirectory?: string;
  readonly message?: string;
}

export interface ExportFrameRequest {
  readonly directory: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  /** RGBA de 8 bits, `width * height * 4` bytes, linha a linha de cima abaixo. */
  readonly rgba: Uint8Array;
}

export interface ExportFrameResult {
  readonly ok: boolean;
  readonly bytes: number;
  /** SHA-256 do arquivo escrito. É o que prova byte-idêntico entre execuções. */
  readonly sha256: string;
  readonly message?: string;
}

/**
 * Nível de compressão **fixado**.
 *
 * O padrão do zlib é `Z_DEFAULT_COMPRESSION`, que hoje é 6 e é livre de mudar
 * entre versões do Node. Fixar o número é o que garante que o mesmo pixel
 * produza o mesmo byte no ano que vem. 6 porque a diferença de tamanho para 9 é
 * de poucos por cento num frame de mapa e o custo de CPU triplica.
 */
const COMPRESSION_LEVEL = 6;

/** Pede a pasta de saída ao usuário e cria o diretório do job dentro dela. */
export async function beginExport(
  window: BrowserWindow,
  request: ExportBeginRequest,
): Promise<ExportBeginResult> {
  if (request.directory !== undefined && request.directory !== "") {
    const explicit = resolve(request.directory);
    await mkdir(explicit, { recursive: true });
    return withStaging(explicit, request.staging === true);
  }
  const chosen = await dialog.showOpenDialog(window, {
    title: "Onde salvar a sequência de frames",
    defaultPath: app.getPath("videos"),
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Exportar aqui",
  });
  if (chosen.canceled || chosen.filePaths[0] === undefined) {
    return { ok: false, directory: "", message: "cancelado" };
  }
  const directory = join(chosen.filePaths[0], safeSegment(request.jobName));
  await mkdir(directory, { recursive: true });
  return withStaging(directory, request.staging === true);
}

async function withStaging(directory: string, staging: boolean): Promise<ExportBeginResult> {
  if (!staging) return { ok: true, directory };
  const framesDirectory = join(directory, `.theatrum-frames-${randomUUID()}`);
  await mkdir(framesDirectory, { recursive: true });
  return { ok: true, directory, framesDirectory };
}

/**
 * Escreve um frame e devolve o hash dele.
 *
 * O caminho é validado contra escapar do diretório do job: `filename` vem do
 * plano de export, que vem do nome do projeto, que vem do usuário. Um nome com
 * `..` escreveria fora da pasta escolhida.
 */
export async function writeExportFrame(request: ExportFrameRequest): Promise<ExportFrameResult> {
  const expected = request.width * request.height * 4;
  if (request.rgba.byteLength !== expected) {
    return {
      ok: false,
      bytes: 0,
      sha256: "",
      message: `esperava ${expected} bytes de RGBA, recebi ${request.rgba.byteLength}`,
    };
  }
  const directory = resolve(request.directory);
  if (!isAbsolute(directory)) {
    return { ok: false, bytes: 0, sha256: "", message: "diretório de saída não é absoluto" };
  }
  const target = resolve(directory, safeSegment(request.filename));
  if (dirname(target) !== directory) {
    return { ok: false, bytes: 0, sha256: "", message: "nome de arquivo escaparia da pasta" };
  }

  const png = encodePng(request.rgba, request.width, request.height);
  await writeFile(target, png);
  return {
    ok: true,
    bytes: png.byteLength,
    sha256: createHash("sha256").update(png).digest("hex"),
  };
}

/** Um segmento de caminho, sem separadores nem travessia. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "");
  return cleaned === "" ? "export" : cleaned;
}

/**
 * PNG de 8 bits RGBA, sem filtro por linha.
 *
 * Filtro 0 (nenhum) em toda linha, de propósito. Um filtro adaptativo comprime
 * melhor, mas a escolha por linha é uma heurística — e heurística é justamente o
 * que não pode entrar num arquivo que precisa sair igual daqui a um ano. O preço
 * é uns 10–20% de tamanho num frame de mapa; o ganho é que o byte de saída é
 * função apenas do pixel.
 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  // Uma linha de filtro (um byte) antes de cada linha de pixels.
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const at = y * (stride + 1);
    raw[at] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, at + 1);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // truecolor com alfa
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro adaptativo (a linha diz qual; usamos sempre 0)
  ihdr[12] = 0; // sem entrelaçamento

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk(
      "IDAT",
      deflateSync(raw, {
        level: COMPRESSION_LEVEL,
        // Fixar também a estratégia e a janela: os três juntos é que tornam a
        // saída reproduzível, e o padrão de qualquer um deles pode mudar.
        strategy: zlibConstants.Z_DEFAULT_STRATEGY,
        windowBits: 15,
        memLevel: 8,
      }),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(data.byteLength + 12);
  out.writeUInt32BE(data.byteLength, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.byteLength; i += 1) {
    crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Anexa bytes a um arquivo dentro da pasta do job.
 *
 * Append e não escrita completa porque um MP4 fragmentado nasce em pedaços: o
 * cabeçalho, e depois um par `moof`+`mdat` por fragmento. Juntar tudo em memória
 * antes de escrever significaria 450 MB de RAM num vídeo de noventa segundos em
 * 4K — que é exatamente a razão de o muxer ser fragmentado.
 *
 * `truncate` no primeiro pedaço: sem ele, reexportar para o mesmo nome anexaria
 * ao arquivo antigo e produziria um MP4 com dois cabeçalhos.
 */
export async function appendExportBytes(request: ExportAppendRequest): Promise<ExportAppendResult> {
  const directory = resolve(request.directory);
  const target = resolve(directory, safeSegment(request.filename));
  if (dirname(target) !== directory) {
    return { ok: false, bytes: 0, message: "nome de arquivo escaparia da pasta" };
  }
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(target, request.bytes, { flag: request.truncate ? "w" : "a" });
    return { ok: true, bytes: request.bytes.byteLength };
  } catch (error: unknown) {
    return {
      ok: false,
      bytes: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ExportAppendRequest {
  readonly directory: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
  /** Verdadeiro no primeiro pedaco: zera o arquivo antes de escrever. */
  readonly truncate: boolean;
}

export interface ExportAppendResult {
  readonly ok: boolean;
  readonly bytes: number;
  readonly message?: string;
}
