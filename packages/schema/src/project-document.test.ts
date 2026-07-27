import { describe, expect, it } from "vitest";
import {
  CompositionSchema,
  FutureSchemaVersionError,
  ProjectDocumentSchema,
  ProjectManifestSchema,
  createEmptyProjectDocument,
  parseProjectDocument,
  safeParseProjectDocument,
} from "./index.js";

describe("ProjectDocument v1", () => {
  it("cria e valida um documento mínimo determinístico", () => {
    const first = createEmptyProjectDocument({
      id: "prj_test",
      name: "Teste",
      compositionId: "cmp_test",
      rootNodeId: "nd_test_root",
    });
    const second = createEmptyProjectDocument({
      id: "prj_test",
      name: "Teste",
      compositionId: "cmp_test",
      rootNodeId: "nd_test_root",
    });

    expect(ProjectDocumentSchema.parse(first)).toEqual(first);
    expect(first).toEqual(second);
    expect(first.compositions[0]?.root).toBe("nd_test_root");
    expect(first.compositions[0]?.nodes["nd_test_root"]?.parent).toBeNull();
  });

  it("preserva campos desconhecidos no projeto e em nós", () => {
    const input = createEmptyProjectDocument();
    const root = input.compositions[0]?.nodes["nd_root"];
    if (root === undefined) throw new Error("fixture inválido");

    const parsed = parseProjectDocument({
      ...input,
      $note: "anotação humana",
      pluginState: { enabled: true },
      compositions: [
        {
          ...input.compositions[0],
          nodes: {
            nd_root: {
              ...root,
              $editor: { collapsed: true },
              pluginPayload: { opaque: [1, 2, 3] },
            },
          },
        },
      ],
    });

    expect(parsed["$note"]).toBe("anotação humana");
    expect(parsed["pluginState"]).toEqual({ enabled: true });
    expect(parsed.compositions[0]?.nodes["nd_root"]?.["pluginPayload"]).toEqual({
      opaque: [1, 2, 3],
    });
  });

  it("rejeita keyframes fora de ordem e duplicados", () => {
    const input = createEmptyProjectDocument();
    const root = input.compositions[0]?.nodes["nd_root"];
    if (root === undefined) throw new Error("fixture inválido");
    const keyframe = (id: string, frame: number) => ({
      id,
      frame,
      value: 1,
      out: { kind: "linear" as const },
      in: { kind: "linear" as const },
    });

    const result = ProjectDocumentSchema.safeParse({
      ...input,
      compositions: [
        {
          ...input.compositions[0],
          nodes: {
            nd_root: {
              ...root,
              transform: {
                ...root.transform,
                opacity: {
                  value: 1,
                  keyframes: [
                    keyframe("kf_late", 20),
                    keyframe("kf_early", 10),
                    keyframe("kf_duplicate", 10),
                  ],
                  expression: null,
                },
              },
            },
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          "keyframes devem estar em ordem crescente de frame",
          "frame duplicado: 10",
        ]),
      );
    }
  });

  it("rejeita raiz inexistente, work area invertida e time range invertido", () => {
    const input = createEmptyProjectDocument();
    const composition = input.compositions[0];
    if (composition === undefined) throw new Error("fixture inválido");
    const root = composition.nodes["nd_root"];
    if (root === undefined) throw new Error("fixture inválido");

    const result = CompositionSchema.safeParse({
      ...composition,
      root: "nd_missing",
      workArea: [30, 10],
      nodes: {
        nd_root: { ...root, timeRange: { in: 20, out: 10 } },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'nó raiz "nd_missing" não existe',
          "workArea inicial deve ser menor ou igual ao final",
          "timeRange.in deve ser menor ou igual a timeRange.out",
        ]),
      );
    }
  });
});

describe("fronteira de versão", () => {
  it("falha cedo e com orientação acionável para schema futuro", () => {
    const future = { ...createEmptyProjectDocument(), schemaVersion: 99 };

    expect(() => parseProjectDocument(future)).toThrow(FutureSchemaVersionError);
    expect(() => parseProjectDocument(future)).toThrow(
      "schemaVersion 99, mas esta versão do Theatrum suporta até 1. Atualize o Theatrum",
    );

    const result = safeParseProjectDocument(future);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(FutureSchemaVersionError);
    }
  });

  it("mantém erros Zod na variante safe", () => {
    const result = safeParseProjectDocument({ schemaVersion: 1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.name).toBe("ZodError");
  });
});

describe("manifest v1", () => {
  it("valida o contrato do container e rejeita timestamps inválidos", () => {
    const manifest = {
      format: "theatrum-project",
      container: 1,
      schemaVersion: 1,
      app: { name: "Theatrum", version: "0.1.0" },
      project: { id: "prj_1", name: "Projeto" },
      created: "2026-07-26T12:04:11.000Z",
      modified: "2026-07-26T15:41:52.000Z",
      stats: { compositions: 1, nodes: 1, assets: 0, durationFrames: 600 },
    };

    expect(ProjectManifestSchema.parse(manifest)).toEqual(manifest);
    expect(ProjectManifestSchema.safeParse({ ...manifest, modified: "ontem" }).success).toBe(false);
  });
});
