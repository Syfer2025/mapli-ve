import { createEmptyProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";

import { contentAddressAsset } from "./assets.js";
import { encodeCanonicalJson } from "./canonical-json.js";
import { parseProjectContainer, serializeProjectContainer } from "./container.js";
import { encodeUtf8 } from "./utf8.js";
import { decodeZip, encodeZip } from "./zip.js";

const document = createEmptyProjectDocument({
  id: "prj_codec",
  name: "Operação Codec",
});

describe("container .theatrum", () => {
  it("salva, abre e salva novamente com bytes idênticos", () => {
    const asset = contentAddressAsset(encodeUtf8("<svg/>"), "svg");
    if (!asset.ok) throw new Error("fixture de asset inválida");
    const input = {
      document,
      assets: [asset.value, asset.value],
      notes: "Anotações livres: ação → reação.",
      thumbnails: { "cmp_main.webp": Uint8Array.of(1, 2, 3) },
      app: { version: "0.1.0" },
    } as const;

    const first = serializeProjectContainer(input);
    const second = serializeProjectContainer(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toEqual(second.value);

    const entries = decodeZip(first.value);
    expect(entries.ok && entries.value.map((entry) => entry.name)).toEqual([
      "manifest.json",
      "project.json",
      asset.value.path,
      "thumbnails/cmp_main.webp",
      "meta/notes.md",
    ]);

    const opened = parseProjectContainer(first.value);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.document).toEqual(document);
    expect(opened.value.notes).toBe(input.notes);
    expect(opened.value.assets.get(asset.value.path)).toEqual(asset.value.bytes);

    const savedAgain = serializeProjectContainer({
      document: opened.value.document,
      assets: [...opened.value.assets].map(([path, bytes]) => ({
        path,
        bytes,
        hash: path.split("/").at(-1)?.split(".")[0] ?? "",
      })),
      notes: opened.value.notes ?? "",
      thumbnails: Object.fromEntries(opened.value.thumbnails),
      app: { version: "0.1.0" },
    });
    expect(savedAgain).toEqual(first);
  });

  it("recusa schema futuro com mensagem acionável", () => {
    const valid = serializeProjectContainer({ document });
    if (!valid.ok) throw new Error("fixture de container inválida");
    const decoded = decodeZip(valid.value);
    if (!decoded.ok) throw new Error("fixture ZIP inválida");

    const futureEntries = decoded.value.map((entry) => {
      if (entry.name !== "manifest.json" && entry.name !== "project.json") return entry;
      const parsed = JSON.parse(new TextDecoder().decode(entry.bytes)) as Record<string, unknown>;
      parsed["schemaVersion"] = 99;
      const encoded = encodeCanonicalJson(parsed);
      if (!encoded.ok) throw new Error("fixture JSON inválida");
      return { ...entry, bytes: encoded.value };
    });
    const future = encodeZip(futureEntries);
    if (!future.ok) throw new Error("fixture futura inválida");

    expect(parseProjectContainer(future.value)).toMatchObject({
      ok: false,
      error: {
        code: "future-schema",
        expected: 1,
        actual: 99,
      },
    });
    const result = parseProjectContainer(future.value);
    expect(!result.ok && result.error.message).toContain("Atualize");
  });

  it("rejeita referência a asset embutido ausente ao salvar e ao abrir", () => {
    const asset = contentAddressAsset(Uint8Array.of(4, 5, 6), "png");
    if (!asset.ok) throw new Error("fixture asset inválida");
    const withEmbeddedReference = {
      ...document,
      assets: [
        {
          id: "ast_embedded",
          kind: "raster",
          src: asset.value.path,
          meta: {},
        },
      ],
    };

    expect(serializeProjectContainer({ document: withEmbeddedReference })).toMatchObject({
      ok: false,
      error: { code: "missing-entry", path: asset.value.path },
    });

    const valid = serializeProjectContainer({
      document: withEmbeddedReference,
      assets: [asset.value],
    });
    if (!valid.ok) throw new Error("fixture de container inválida");
    const entries = decodeZip(valid.value);
    if (!entries.ok) throw new Error("fixture ZIP inválida");
    const withoutAsset = encodeZip(
      entries.value.filter((entry) => entry.name !== asset.value.path),
    );
    if (!withoutAsset.ok) throw new Error("fixture ZIP sem asset inválida");

    expect(parseProjectContainer(withoutAsset.value)).toMatchObject({
      ok: false,
      error: { code: "missing-entry", path: asset.value.path },
    });
  });

  it("rejeita manifest ausente, fora da primeira posição e assets alterados", () => {
    const projectJson = encodeCanonicalJson(document);
    if (!projectJson.ok) throw new Error("fixture JSON inválida");
    const manifestOnlyAfterProject = encodeZip([
      { name: "project.json", bytes: projectJson.value },
      { name: "manifest.json", bytes: encodeUtf8("{}") },
    ]);
    if (!manifestOnlyAfterProject.ok) throw new Error("fixture ZIP inválida");
    expect(parseProjectContainer(manifestOnlyAfterProject.value)).toMatchObject({
      ok: false,
      error: { code: "invalid-container" },
    });

    const asset = contentAddressAsset(Uint8Array.of(1, 2, 3), "png");
    if (!asset.ok) throw new Error("fixture asset inválida");
    const valid = serializeProjectContainer({ document, assets: [asset.value] });
    if (!valid.ok) throw new Error("fixture container inválida");
    const entries = decodeZip(valid.value);
    if (!entries.ok) throw new Error("fixture ZIP inválida");
    const corruptAssetZip = encodeZip(
      entries.value.map((entry) =>
        entry.name === asset.value.path ? { ...entry, bytes: Uint8Array.of(9) } : entry,
      ),
    );
    if (!corruptAssetZip.ok) throw new Error("fixture ZIP inválida");
    expect(parseProjectContainer(corruptAssetZip.value)).toMatchObject({
      ok: false,
      error: { code: "asset-corrupt", path: asset.value.path },
    });
  });
});
