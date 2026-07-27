/**
 * Domínio da Biblioteca (bloco 7A): classificação de arquivos, convenção de
 * `meta` e varredura de usos — puros, sem DOM e sem GPU.
 */

import { createEmptyProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import {
  assetDimensions,
  assetDisplayName,
  assetKindForFile,
  assetTags,
  baseNameFromFileName,
  buildAssetDescriptor,
  extensionForFileName,
  findAssetReferences,
  formatAssetSize,
  normalizeTags,
} from "./index.js";

describe("classificação de arquivos", () => {
  it("reconhece imagens, svg e modelos pela extensão", () => {
    expect(assetKindForFile("T-34.png", "image/png")).toBe("image");
    expect(assetKindForFile("foto.JPEG", "")).toBe("image");
    expect(assetKindForFile("bandeira.svg", "image/svg+xml")).toBe("svg");
    expect(assetKindForFile("tanque.glb", "model/gltf-binary")).toBe("model");
    expect(assetKindForFile("cena.GLTF", "")).toBe("model");
  });

  it("usa o mime quando a extensão é desconhecida e rejeita o resto", () => {
    expect(assetKindForFile("sem-extensao", "image/webp")).toBe("image");
    expect(assetKindForFile("notas.txt", "text/plain")).toBeNull();
    expect(assetKindForFile("video.mp4", "video/mp4")).toBeNull();
  });

  it("extrai extensão e nome base", () => {
    expect(extensionForFileName("T-34 soviético.PNG")).toBe("png");
    expect(extensionForFileName("semextensao")).toBeNull();
    expect(baseNameFromFileName("T-34 soviético.png")).toBe("T-34 soviético");
    expect(baseNameFromFileName(".png")).toBe("asset");
  });
});

describe("descriptor e meta", () => {
  const descriptor = buildAssetDescriptor({
    id: "as_t34",
    kind: "image",
    src: "assets/ab/abcdef.png",
    name: "T-34",
    mime: "image/png",
    byteSize: 2048,
    width: 512,
    height: 256,
    tags: ["ww2", "tanque"],
  });

  it("monta o descriptor com a convenção de meta", () => {
    expect(descriptor).toMatchObject({ id: "as_t34", kind: "image", src: "assets/ab/abcdef.png" });
    expect(assetDisplayName(descriptor)).toBe("T-34");
    expect(assetDimensions(descriptor)).toEqual({ width: 512, height: 256 });
    expect(assetTags(descriptor)).toEqual(["ww2", "tanque"]);
  });

  it("cai para o id quando o nome está vazio e ignora meta malformada", () => {
    const semNome = { ...descriptor, meta: { name: "  ", tags: "não-é-lista", width: -3 } };
    expect(assetDisplayName(semNome)).toBe("as_t34");
    expect(assetTags(semNome)).toEqual([]);
    expect(assetDimensions(semNome)).toBeNull();
  });

  it("normaliza tags separadas por vírgula ou ponto e vírgula", () => {
    expect(normalizeTags(" ww2, tanque;, ww2 ;infantaria")).toEqual([
      "ww2",
      "tanque",
      "infantaria",
    ]);
    expect(normalizeTags("")).toEqual([]);
  });

  it("formata tamanho em B, KB e MB", () => {
    expect(formatAssetSize(512)).toBe("512 B");
    expect(formatAssetSize(2048)).toBe("2,0 KB");
    expect(formatAssetSize(3 * 1024 * 1024)).toBe("3,0 MB");
  });
});

describe("varredura de usos", () => {
  it("encontra nós que referenciam o src, inclusive em keyframe", () => {
    const document = createEmptyProjectDocument();
    const composition = document.compositions[0]!;
    const root = composition.nodes[composition.root]!;
    const src = "assets/ab/hash.png";

    const tank = structuredClone(root);
    tank.id = "nd_tank";
    tank.name = "Tanque";
    tank.props = {
      assetId: { value: src, keyframes: [], expression: null },
      tint: { value: "#ffffffff", keyframes: [], expression: null },
    };
    composition.nodes[tank.id] = tank;

    const flag = structuredClone(root);
    flag.id = "nd_flag";
    flag.name = "Bandeira";
    flag.props = {
      assetId: {
        value: "assets/ab/outro.png",
        keyframes: [{ id: "kf_1", frame: 10, value: src, in: null, out: null }],
        expression: null,
      },
    };
    composition.nodes[flag.id] = flag;

    const references = findAssetReferences(document, src);
    expect(references).toHaveLength(2);
    expect(references[0]).toMatchObject({
      compositionId: composition.id,
      nodeId: "nd_tank",
      nodeName: "Tanque",
      propertyPath: "props.assetId",
    });
    expect(references[1]).toMatchObject({
      nodeId: "nd_flag",
      propertyPath: "props.assetId (keyframe)",
    });

    expect(findAssetReferences(document, "assets/ab/inexistente.png")).toEqual([]);
  });
});
