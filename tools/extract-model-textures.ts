/**
 * Extrai a pintura de um modelo 3D para edição externa.
 *
 *   node tools/extract-model-textures.ts <arquivo.glb> [--out <pasta>]
 *
 * **Por que uma ferramenta e não um recurso do editor.** O passo seguinte —
 * pintar por cima, apagar uma escrita, trocar uma insígnia — é trabalho de
 * editor de imagem, e não existe um nesta máquina (o mesmo bloqueio registrado
 * para o VFX volumétrico). Reimplementar Photoshop dentro do Theatrum para tapar
 * um texto na cauda seria a pior troca possível. O que falta ao dono é **ver o
 * que existe lá dentro**, e é só isso que este comando entrega.
 *
 * **Por que a organização é o produto, não o despejo.** Um GLB de Sketchfab traz
 * as imagens sem nome nenhum: o F/A-18 do repositório tem 40 imagens, 40 texturas
 * e 20 materiais, todas anônimas. Despejar `0.png … 39.png` numa pasta troca um
 * problema por outro — o dono continuaria abrindo arquivo por arquivo à procura
 * da escrita da cauda. Então cada arquivo sai nomeado pelo **material** a que
 * pertence e pelo **papel** que cumpre (cor, normal, rugosidade), e um índice em
 * Markdown lista tudo com tamanho, dimensão e quais malhas usam cada material.
 *
 * Nada é modificado: o GLB é aberto somente para leitura.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** Papéis que um material glTF dá a uma textura. O primeiro é o que se pinta. */
const TEXTURE_ROLES = [
  { key: "baseColor", label: "cor base · É AQUI QUE A PINTURA MORA" },
  { key: "metallicRoughness", label: "metal e rugosidade" },
  { key: "normal", label: "relevo (normal map)" },
  { key: "occlusion", label: "oclusão de ambiente" },
  { key: "emissive", label: "emissão (luz própria)" },
] as const;

type RoleKey = (typeof TEXTURE_ROLES)[number]["key"];

interface GltfJson {
  readonly images?: readonly { bufferView?: number; uri?: string; mimeType?: string }[];
  readonly textures?: readonly { source?: number }[];
  readonly bufferViews?: readonly { buffer: number; byteOffset?: number; byteLength: number }[];
  readonly materials?: readonly Record<string, unknown>[];
  readonly meshes?: readonly {
    name?: string;
    primitives?: readonly { material?: number }[];
  }[];
  readonly nodes?: readonly { name?: string; mesh?: number }[];
}

/** Cabeçalho de 12 bytes, depois chunks de 8. É todo o formato GLB. */
function readGlb(bytes: Buffer): { json: GltfJson; bin: Buffer<ArrayBufferLike> } {
  if (bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error("não é um arquivo GLB (assinatura 'glTF' ausente)");
  }
  let at = 12;
  let json: GltfJson | null = null;
  // `Buffer` com o buffer subjacente fixado: `subarray` devolve
  // `Buffer<ArrayBufferLike>`, que aceitaria um `SharedArrayBuffer` e não
  // encaixa em `Buffer<ArrayBuffer>`. A cópia aqui é de zero bytes até o chunk
  // binário aparecer, e depois é uma vista sobre o mesmo arquivo já em memória.
  let bin: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(at);
    const type = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8")) as GltfJson;
    else if (type === 0x004e4942) bin = body;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (json === null) throw new Error("GLB sem chunk JSON");
  return { json, bin };
}

/**
 * Dimensão da imagem lida do próprio cabeçalho dela.
 *
 * PNG diz no IHDR, nos bytes 16–24. JPEG obriga a varrer marcadores até um SOF,
 * porque o tamanho não fica em posição fixa. Vale a varredura: saber que a
 * textura da fuselagem é 4096×4096 e a de um parafuso é 64×64 é metade do
 * trabalho de achar onde está a escrita.
 */
function imageSize(bytes: Buffer): readonly [number, number] | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = bytes[at + 1] ?? 0;
      // SOF0..SOF15, pulando DHT (c4), JPG (c8) e DAC (cc), que não são frames.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
      }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

function textureIndexOf(material: Record<string, unknown>, role: RoleKey): number | null {
  const pbr = material["pbrMetallicRoughness"] as Record<string, unknown> | undefined;
  const slot =
    role === "baseColor"
      ? pbr?.["baseColorTexture"]
      : role === "metallicRoughness"
        ? pbr?.["metallicRoughnessTexture"]
        : material[`${role}Texture`];
  const index = (slot as { index?: number } | undefined)?.index;
  return typeof index === "number" ? index : null;
}

/** `Material.001` e `sem-nome` viram nomes de arquivo seguros em qualquer disco. */
function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/gu, "")
      .replace(/[^a-zA-Z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48) || "sem-nome"
  );
}

function extensionFor(mimeType: string | undefined, bytes: Buffer): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (bytes.length > 4 && bytes.readUInt32BE(0) === 0x89504e47) return "png";
  return "jpg";
}

function formatBytes(count: number): string {
  return count >= 1024 * 1024
    ? `${(count / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(count / 1024)).toString()} KB`;
}

interface Extracted {
  readonly file: string;
  readonly materialIndex: number;
  readonly materialName: string;
  readonly role: RoleKey;
  readonly roleLabel: string;
  readonly bytes: number;
  readonly size: readonly [number, number] | null;
  readonly meshes: readonly string[];
}

function main(): void {
  const args = process.argv.slice(2);
  const source = args.find((value) => !value.startsWith("--"));
  if (source === undefined) {
    console.error("uso: node tools/extract-model-textures.ts <arquivo.glb> [--out <pasta>]");
    process.exitCode = 1;
    return;
  }
  const outFlag = args.indexOf("--out");
  const modelPath = resolve(source);
  const stem = basename(modelPath).replace(/\.(glb|gltf)$/iu, "");
  const outDir =
    outFlag >= 0 && args[outFlag + 1] !== undefined
      ? resolve(args[outFlag + 1] as string)
      : resolve(`texturas-${slug(stem)}`);

  const { json, bin } = readGlb(readFileSync(modelPath));
  const images = json.images ?? [];
  const textures = json.textures ?? [];
  const materials = json.materials ?? [];
  if (images.length === 0) {
    console.error(`"${basename(modelPath)}" não tem imagem embutida — nada a extrair.`);
    process.exitCode = 1;
    return;
  }

  // Qual malha usa qual material: é o que responde "isto é a asa ou o trem de
  // pouso?" quando os materiais também vêm sem nome.
  const meshesByMaterial = new Map<number, string[]>();
  (json.meshes ?? []).forEach((mesh, meshIndex) => {
    const nodeName = (json.nodes ?? []).find((node) => node.mesh === meshIndex)?.name;
    const label = mesh.name ?? nodeName ?? `malha ${String(meshIndex)}`;
    for (const primitive of mesh.primitives ?? []) {
      if (typeof primitive.material !== "number") continue;
      const list = meshesByMaterial.get(primitive.material) ?? [];
      if (!list.includes(label)) list.push(label);
      meshesByMaterial.set(primitive.material, list);
    }
  });

  // Pasta limpa a cada extração. Sobra de uma rodada anterior, com o material
  // numerado diferente, é a forma mais rápida de editar a textura errada.
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const extracted: Extracted[] = [];
  const seen = new Set<number>();

  materials.forEach((material, materialIndex) => {
    const rawName = typeof material["name"] === "string" ? material["name"] : "";
    const materialName = rawName === "" ? `material-${String(materialIndex)}` : rawName;
    for (const { key, label } of TEXTURE_ROLES) {
      const textureIndex = textureIndexOf(material, key);
      if (textureIndex === null) continue;
      const imageIndex = textures[textureIndex]?.source;
      if (typeof imageIndex !== "number") continue;
      const image = images[imageIndex];
      const view =
        image?.bufferView === undefined ? undefined : json.bufferViews?.[image.bufferView];
      if (image === undefined || view === undefined) continue;
      const start = view.byteOffset ?? 0;
      const bytes = bin.subarray(start, start + view.byteLength);
      const extension = extensionFor(image.mimeType, bytes);
      // O número do material abre o nome para a pasta ficar ordenada por peça, e
      // o índice da imagem fecha para duas texturas iguais não se sobrescreverem.
      const file = `${String(materialIndex).padStart(2, "0")}_${slug(materialName)}__${key}__img${String(imageIndex).padStart(2, "0")}.${extension}`;
      writeFileSync(join(outDir, file), bytes);
      seen.add(imageIndex);
      extracted.push({
        file,
        materialIndex,
        materialName,
        role: key,
        roleLabel: label,
        bytes: bytes.length,
        size: imageSize(bytes),
        meshes: meshesByMaterial.get(materialIndex) ?? [],
      });
    }
  });

  // Imagem que nenhum material referencia ainda assim vai para o disco, numa
  // subpasta. Silenciar uma textura órfã seria esconder do dono justamente o
  // arquivo estranho que pode ser o que ele procura.
  const orphans: string[] = [];
  images.forEach((image, imageIndex) => {
    if (seen.has(imageIndex)) return;
    const view = image.bufferView === undefined ? undefined : json.bufferViews?.[image.bufferView];
    if (view === undefined) return;
    const start = view.byteOffset ?? 0;
    const bytes = bin.subarray(start, start + view.byteLength);
    if (bytes.length === 0) return;
    const dir = join(outDir, "sem-material");
    mkdirSync(dir, { recursive: true });
    const file = `img${String(imageIndex).padStart(2, "0")}.${extensionFor(image.mimeType, bytes)}`;
    writeFileSync(join(dir, file), bytes);
    orphans.push(`sem-material/${file}`);
  });

  const pintura = extracted.filter((entry) => entry.role === "baseColor");
  const lines: string[] = [
    `# Pintura de ${basename(modelPath)}`,
    "",
    `${String(materials.length)} materiais · ${String(images.length)} imagens · ` +
      `${String(extracted.length)} extraídas${orphans.length > 0 ? ` · ${String(orphans.length)} sem material` : ""}`,
    "",
    "## Onde editar",
    "",
    "Os arquivos `__baseColor__` são **a pintura**: escrita, numeração, insígnia e",
    "camuflagem estão neles. Os outros papéis descrevem relevo e brilho — pintar",
    "neles não muda a cor, muda como a luz responde.",
    "",
    "Ao salvar de volta, **mantenha as dimensões e o formato originais**. Um PNG que",
    "vira JPEG perde o canal alfa, e alfa perdido em textura de vidro ou decalque",
    "aparece como caixa opaca em volta da marca.",
    "",
    "## Pintura, da maior para a menor",
    "",
    "| Arquivo | Material | Dimensão | Peso | Malhas |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const entry of [...pintura].sort((left, right) => right.bytes - left.bytes)) {
    const size = entry.size === null ? "?" : `${String(entry.size[0])}×${String(entry.size[1])}`;
    const meshes = entry.meshes.length === 0 ? "—" : entry.meshes.slice(0, 3).join(", ");
    lines.push(
      `| \`${entry.file}\` | ${entry.materialName} | ${size} | ${formatBytes(entry.bytes)} | ${meshes} |`,
    );
  }
  lines.push(
    "",
    "## Todos os arquivos",
    "",
    "| Arquivo | Papel | Dimensão | Peso |",
    "| --- | --- | --- | --- |",
  );
  for (const entry of extracted) {
    const size = entry.size === null ? "?" : `${String(entry.size[0])}×${String(entry.size[1])}`;
    lines.push(
      `| \`${entry.file}\` | ${entry.roleLabel} | ${size} | ${formatBytes(entry.bytes)} |`,
    );
  }
  if (orphans.length > 0) {
    lines.push(
      "",
      "## Sem material",
      "",
      "Nenhum material aponta para estas. Costumam ser sobras do exportador — mas",
      "estão aqui porque a que você procura pode ser justamente a estranha.",
      "",
      ...orphans.map((file) => `- \`${file}\``),
    );
  }
  writeFileSync(join(outDir, "INDICE.md"), `${lines.join("\n")}\n`);

  console.log(`${basename(modelPath)} → ${outDir}`);
  console.log(
    `  ${String(extracted.length)} texturas de ${String(materials.length)} materiais` +
      `${orphans.length > 0 ? `, ${String(orphans.length)} sem material` : ""}`,
  );
  console.log(`  ${String(pintura.length)} arquivos de PINTURA (baseColor) — é neles que se edita`);
  console.log(`  índice em ${join(outDir, "INDICE.md")}`);
}

main();
