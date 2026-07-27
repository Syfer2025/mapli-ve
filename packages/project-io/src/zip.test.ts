import { describe, expect, it } from "vitest";

import { decodeZip, encodeZip } from "./zip.js";
import { encodeUtf8 } from "./utf8.js";

describe("ZIP determinístico", () => {
  it("preserva ordem e bytes sem timestamps variáveis", () => {
    const entries = [
      { name: "manifest.json", bytes: encodeUtf8("{}\n") },
      { name: "project.json", bytes: encodeUtf8('{"schemaVersion":1}\n') },
    ];
    const first = encodeZip(entries);
    const second = encodeZip(entries);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toEqual(second.value);
    expect(decodeZip(first.value)).toMatchObject({
      ok: true,
      value: [{ name: "manifest.json" }, { name: "project.json" }],
    });
  });

  it("rejeita traversal, membro duplicado e CRC corrompido", () => {
    expect(encodeZip([{ name: "../escape", bytes: new Uint8Array() }])).toMatchObject({
      ok: false,
      error: { code: "invalid-container" },
    });
    expect(
      encodeZip([
        { name: "a", bytes: new Uint8Array() },
        { name: "a", bytes: new Uint8Array() },
      ]),
    ).toMatchObject({ ok: false });

    const encoded = encodeZip([{ name: "a", bytes: Uint8Array.of(7) }]);
    if (!encoded.ok) throw new Error("fixture ZIP inválida");
    const corrupt = encoded.value.slice();
    corrupt[31] = 8;
    expect(decodeZip(corrupt)).toMatchObject({
      ok: false,
      error: { code: "invalid-container", path: "a" },
    });
  });
});
