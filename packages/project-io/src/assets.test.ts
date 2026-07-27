import { describe, expect, it } from "vitest";

import { contentAddressAsset, verifyContentAddressedAsset } from "./assets.js";
import { sha256 } from "./sha256.js";
import { encodeUtf8 } from "./utf8.js";

describe("assets por conteúdo", () => {
  it("implementa SHA-256 e caminho canônico", () => {
    expect(sha256(encodeUtf8("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const asset = contentAddressAsset(encodeUtf8("abc"), ".PNG");
    expect(asset.ok).toBe(true);
    if (!asset.ok) return;
    expect(asset.value.path).toBe(
      "assets/ba/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.png",
    );
    expect(verifyContentAddressedAsset(asset.value.path, asset.value.bytes)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("detecta conteúdo corrompido e extensão insegura", () => {
    const asset = contentAddressAsset(encodeUtf8("abc"), "png");
    if (!asset.ok) throw new Error("fixture inválida");
    expect(verifyContentAddressedAsset(asset.value.path, encodeUtf8("abd"))).toMatchObject({
      ok: false,
      error: { code: "asset-corrupt" },
    });
    expect(contentAddressAsset(new Uint8Array(), "../exe")).toMatchObject({
      ok: false,
      error: { code: "invalid-document" },
    });
  });
});
