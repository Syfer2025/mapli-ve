import { describe, expect, it } from "vitest";

import { applyJsonPatch, diffJson } from "./json-patch.js";

describe("JSON patch incremental", () => {
  it("produz patch determinístico e recompõe objetos, arrays e pointers escapados", () => {
    const before = {
      name: "antes",
      nested: { "a/b": 1, remove: true },
      items: ["a", "b", "c"],
    };
    const after = {
      name: "depois",
      nested: { "a/b": 2, added: null },
      items: ["a", "x"],
    };

    const patch = diffJson(before, after);
    expect(patch).toEqual(diffJson(before, after));
    expect(patch).toContainEqual({ op: "replace", path: "/nested/a~1b", value: 2 });
    expect(applyJsonPatch(before, patch)).toEqual({ ok: true, value: after });
    expect(before.name).toBe("antes");
  });

  it("falha claramente para caminho inexistente", () => {
    expect(applyJsonPatch({}, [{ op: "replace", path: "/missing", value: 1 }])).toMatchObject({
      ok: false,
      error: { code: "invalid-document", pointer: "/missing" },
    });
  });
});
