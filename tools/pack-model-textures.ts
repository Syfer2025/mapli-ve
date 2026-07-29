/**
 * Devolve para dentro do GLB as texturas editadas fora.
 *
 *   node tools/pack-model-textures.ts <original.glb> <pasta-de-texturas> [--out <novo.glb>]
 *
 * É o caminho de volta de `extract-model-textures.ts`, e o par só faz sentido
 * completo: extrair sem reempacotar deixa o trabalho do editor de imagem preso
 * numa pasta.
 *
 * **Nunca sobrescreve o original.** Sai um arquivo novo, `<nome>-editado.glb` por
 * padrão. O GLB de origem costuma ter dezenas de MB baixados uma vez; perdê-lo por
 * um empacotamento errado custa o download inteiro, e o erro só apareceria ao
 * abrir o modelo e ver a fuselagem branca.
 *
 * **A parte que engana é o realinhamento.** Uma imagem editada quase nunca tem o
 * mesmo número de bytes da original — o Photoshop recomprime. Trocar os bytes no
 * lugar quebraria todos os `bufferView` seguintes, e não só os de imagem: os
 * mesmos deslocamentos indexam vértices, normais e índices de triângulo. Então o
 * chunk binário é **reconstruído inteiro**, view por view, com os deslocamentos
 * recalculados. É por isso que este arquivo existe em vez de um `Buffer.copy`.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

interface BufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

interface GltfJson {
  images?: { bufferView?: number; uri?: string; mimeType?: string }[];
  bufferViews?: BufferView[];
  buffers?: { byteLength: number; uri?: string }[];
  [key: string]: unknown;
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function readGlb(bytes: Buffer): { json: GltfJson; bin: Buffer<ArrayBufferLike> } {
  if (bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error("não é um arquivo GLB (assinatura 'glTF' ausente)");
  }
  let at = 12;
  let json: GltfJson | null = null;
  let bin: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(at);
    const type = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString("utf8")) as GltfJson;
    else if (type === BIN_CHUNK) bin = body;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (json === null) throw new Error("GLB sem chunk JSON");
  return { json, bin };
}

/** Alinhamento de 4 bytes: exigência do formato, e o que mantém os accessors legíveis. */
function padded(length: number): number {
  return length + ((4 - (length % 4)) % 4);
}

function mimeOf(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return null;
}

/**
 * O índice da imagem sai do próprio nome do arquivo.
 *
 * `extract-model-textures.ts` grava `12_<material>__baseColor__img24.jpg`, e o
 * sufixo `img24` é o contrato entre as duas ferramentas. Casar por ordem
 * alfabética ou por material seria adivinhação: material sem nome e textura
 * repetida entre materiais fariam a imagem certa entrar no lugar errado, e o
 * resultado apareceria como um pedaço do avião com a pintura de outro.
 */
function imageIndexOf(file: string): number | null {
  const match = /img(\d+)\.(?:png|jpg|jpeg)$/iu.exec(file);
  const value = match?.[1];
  return value === undefined ? null : Number.parseInt(value, 10);
}

function collectEdits(dir: string): Map<number, { file: string; bytes: Buffer }> {
  const edits = new Map<number, { file: string; bytes: Buffer }>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const index = imageIndexOf(entry);
      if (index === null) continue;
      const bytes = readFileSync(full);
      const previous = edits.get(index);
      if (previous === undefined) {
        edits.set(index, { file: entry, bytes });
        continue;
      }
      /**
       * A mesma imagem sob dois nomes é **normal**: uma textura pode servir a dois
       * papéis do mesmo material — no F/A-18, `img00` é cor base e emissão — e o
       * extrator grava uma cópia para cada papel. Idênticas, tanto faz qual entra.
       *
       * Diferentes é que é ambiguidade de verdade: o dono editou uma das cópias e
       * esqueceu a outra, e escolher em silêncio faria a edição sumir sem
       * explicação. Aí sim recusa.
       */
      if (previous.bytes.equals(bytes)) continue;
      throw new Error(
        `a imagem ${String(index)} tem duas versões DIFERENTES: "${previous.file}" e "${entry}". ` +
          "Elas são a mesma textura em dois papéis — deixe as duas iguais, ou apague a que não vale.",
      );
    }
  };
  walk(dir);
  return edits;
}

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((value) => !value.startsWith("--"));
  const [source, texturesDir] = positional;
  if (source === undefined || texturesDir === undefined) {
    console.error(
      "uso: node tools/pack-model-textures.ts <original.glb> <pasta-de-texturas> [--out <novo.glb>]",
    );
    process.exitCode = 1;
    return;
  }
  const modelPath = resolve(source);
  const dir = resolve(texturesDir);
  if (!existsSync(dir)) {
    console.error(`pasta de texturas não encontrada: ${dir}`);
    process.exitCode = 1;
    return;
  }
  const outFlag = args.indexOf("--out");
  const outPath =
    outFlag >= 0 && args[outFlag + 1] !== undefined
      ? resolve(args[outFlag + 1] as string)
      : join(dirname(modelPath), `${basename(modelPath).replace(/\.glb$/iu, "")}-editado.glb`);
  if (resolve(outPath) === modelPath) {
    console.error("recusado: a saída é o próprio original. Use --out com outro nome.");
    process.exitCode = 1;
    return;
  }

  const original = readFileSync(modelPath);
  const { json, bin } = readGlb(original);
  const images = json.images ?? [];
  const views = json.bufferViews ?? [];
  const edits = collectEdits(dir);
  if (edits.size === 0) {
    console.error(`nenhuma imagem com sufixo "imgNN" em ${dir} — nada a empacotar.`);
    process.exitCode = 1;
    return;
  }

  // Só entram as que existem no modelo, e a troca de formato é barrada: PNG que
  // virou JPEG perde o canal alfa, e alfa perdido em vidro ou marcação aparece
  // como caixa opaca. Melhor recusar aqui que descobrir no palco.
  const applied: { index: number; file: string; from: number; to: number }[] = [];
  const replacement = new Map<number, Buffer>();
  for (const [index, edit] of [...edits].sort((a, b) => a[0] - b[0])) {
    const image = images[index];
    if (image === undefined) {
      console.warn(
        `  ignorada: "${edit.file}" aponta para a imagem ${String(index)}, que não existe`,
      );
      continue;
    }
    const mime = mimeOf(edit.bytes);
    if (mime === null) {
      console.warn(`  ignorada: "${edit.file}" não é PNG nem JPEG`);
      continue;
    }
    if (image.mimeType !== undefined && image.mimeType !== mime) {
      console.warn(
        `  ignorada: "${edit.file}" é ${mime} e a original é ${image.mimeType}. ` +
          "Salve no formato de origem — trocar perde o canal alfa.",
      );
      continue;
    }
    const viewIndex = image.bufferView;
    if (viewIndex === undefined || views[viewIndex] === undefined) {
      console.warn(`  ignorada: imagem ${String(index)} não está embutida no GLB`);
      continue;
    }
    replacement.set(viewIndex, edit.bytes);
    applied.push({
      index,
      file: edit.file,
      from: views[viewIndex].byteLength,
      to: edit.bytes.length,
    });
  }
  if (applied.length === 0) {
    console.error("nenhuma imagem pôde ser aplicada.");
    process.exitCode = 1;
    return;
  }

  // Chunk binário reconstruído inteiro. Os mesmos bufferViews indexam vértices e
  // índices de triângulo, então recalcular o deslocamento de TODOS é o que impede
  // a malha de virar lixo quando uma imagem muda de tamanho.
  const pieces: Buffer[] = [];
  let cursor = 0;
  const rebuilt: BufferView[] = views.map((view, viewIndex) => {
    // Pelo índice do `map`, não por `indexOf`: dois bufferViews podem ser objetos
    // iguais, e `indexOf` devolveria o primeiro nos dois casos — a segunda imagem
    // receberia os bytes da primeira, e o erro apareceria como uma peça do avião
    // com a pintura de outra.
    const bytes = replacement.get(viewIndex) ?? null;
    const body =
      bytes ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const offset = cursor;
    pieces.push(Buffer.from(body));
    const pad = padded(body.length) - body.length;
    if (pad > 0) pieces.push(Buffer.alloc(pad));
    cursor += padded(body.length);
    return { ...view, byteOffset: offset, byteLength: body.length };
  });

  json.bufferViews = rebuilt;
  if (json.buffers?.[0] !== undefined) json.buffers[0].byteLength = cursor;
  for (const { index } of applied) {
    const image = images[index];
    const bytes = replacement.get(image?.bufferView ?? -1);
    if (image === undefined || bytes === undefined) continue;
    const mime = mimeOf(bytes);
    if (mime !== null) image.mimeType = mime;
  }

  const newBin = Buffer.concat(pieces);
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  // Espaço no fim do JSON e zeros no fim do binário: é o enchimento que o formato
  // manda, e escrever outro byte faz parsers rigorosos recusarem o arquivo.
  const jsonPadded = Buffer.concat([
    jsonBytes,
    Buffer.alloc(padded(jsonBytes.length) - jsonBytes.length, 0x20),
  ]);
  const total = 12 + 8 + jsonPadded.length + 8 + newBin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12);
  out.writeUInt32LE(JSON_CHUNK, 16);
  jsonPadded.copy(out, 20);
  const binAt = 20 + jsonPadded.length;
  out.writeUInt32LE(newBin.length, binAt);
  out.writeUInt32LE(BIN_CHUNK, binAt + 4);
  newBin.copy(out, binAt + 8);
  writeFileSync(outPath, out);

  // Releitura como prova: se o arquivo que acabou de sair não abre, o dono tem de
  // saber agora, e não ao arrastar o modelo para o palco.
  const check = readGlb(readFileSync(outPath));
  const checkImages = (check.json.images ?? []).length;

  console.log(`${basename(modelPath)} → ${outPath}`);
  for (const entry of applied) {
    console.log(
      `  img${String(entry.index).padStart(2, "0")}  ${entry.file}  ` +
        `${String(Math.round(entry.from / 1024))} KB → ${String(Math.round(entry.to / 1024))} KB`,
    );
  }
  console.log(
    `  ${String(applied.length)} de ${String(images.length)} imagens trocadas · ` +
      `${String(Math.round(original.length / 1024 / 1024))} MB → ${String(Math.round(total / 1024 / 1024))} MB`,
  );
  console.log(
    `  releitura ok: ${String(checkImages)} imagens, ${String(rebuilt.length)} bufferViews`,
  );
}

main();
