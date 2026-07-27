import { describe, expect, it } from "vitest";

import { stringifyCanonicalJson } from "./canonical-json.js";

describe("stringifyCanonicalJson", () => {
  it("ordena identidade antes das demais chaves e usa LF", () => {
    const result = stringifyCanonicalJson({
      zebra: 1,
      name: "Nome",
      type: "group",
      id: "nd_1",
      alpha: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(
      '{\n  "id": "nd_1",\n  "type": "group",\n  "name": "Nome",\n  "alpha": true,\n  "zebra": 1\n}\n',
    );
    expect(result.value).not.toContain("\r");
  });

  it("normaliza cores e limita coordenadas geográficas a 7 casas", () => {
    const result = stringifyCanonicalJson({
      color: "#AABBCCDD",
      anchor: { space: "geo", lngLat: [-46.6333081234, -23.5505198765] },
      label: "literal #AABBCCDD não isolado",
      position: [123.123456789],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain('"color": "#aabbccdd"');
    expect(result.value).toContain("-46.6333081");
    expect(result.value).toContain("-23.5505199");
    expect(result.value).toContain("123.123456789");
    expect(result.value).toContain("literal #AABBCCDD não isolado");
  });

  it("rejeita undefined e números não finitos com JSON pointer", () => {
    const undefinedResult = stringifyCanonicalJson({ nested: { value: undefined } });
    expect(undefinedResult).toMatchObject({
      ok: false,
      error: { code: "invalid-document", pointer: "/nested/value" },
    });

    const numberResult = stringifyCanonicalJson({ value: Number.NaN });
    expect(numberResult).toMatchObject({
      ok: false,
      error: { code: "invalid-document", pointer: "/value" },
    });
  });
});
