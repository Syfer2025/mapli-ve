/**
 * Testes das regras de lint do projeto.
 *
 * Estas regras são a única coisa que impede a arquitetura de virar sopa em
 * algumas semanas. Se elas silenciarem, tudo o resto continua "passando" —
 * então elas próprias precisam de teste.
 *
 * Critério de saída 3 da Fase 1: um import proibido REPROVA no lint.
 */

import { describe, expect, it } from "vitest";
import { ESLint, RuleTester } from "eslint";
import path from "node:path";
import noCrossLayerImport from "./no-cross-layer-import.mjs";
import noNondeterminism from "./no-nondeterminism.mjs";
import enforceBarrelImports from "./enforce-barrel-imports.mjs";
import noDirectDocumentMutation from "./no-direct-document-mutation.mjs";
import { isImportAllowed, packageFromFilename, packageFromSpecifier } from "./layers.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const inPackage = (pkg: string, file = "src/thing.ts"): string =>
  path.join(ROOT, "packages", pkg, file);
const inApp = (app: string, file = "src/thing.ts"): string => path.join(ROOT, "apps", app, file);

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: "module" },
});

describe("no-cross-layer-import", () => {
  it("aceita descer camada e rejeita subir ou empatar", () => {
    tester.run("no-cross-layer-import", noCrossLayerImport as never, {
      valid: [
        // L1 → L0: desce, permitido.
        {
          code: 'import { hash32 } from "@theatrum/core-utils";',
          filename: inPackage("document"),
        },
        // L5 → L4: desce.
        {
          code: 'import { CommandBus } from "@theatrum/commands";',
          filename: inPackage("engine"),
        },
        // Exceção documentada dentro do L0.
        {
          code: 'import { ok } from "@theatrum/core-utils";',
          filename: inPackage("core-time"),
        },
        // DAG dirigido dentro das camadas conceituais.
        {
          code: 'import { SceneNode } from "@theatrum/scene-graph";',
          filename: inPackage("animation"),
        },
        {
          code: 'import { Renderer } from "@theatrum/renderer";',
          filename: inPackage("effects"),
        },
        // Exceção de fronteira: editor consome o barrel público do host.
        {
          code: 'import { TheatrumBridge } from "@theatrum/shell";',
          filename: inApp("editor"),
        },
        // Import relativo interno: não é assunto desta regra.
        { code: 'import { x } from "./local.js";', filename: inPackage("animation") },
        // npm externo: idem.
        { code: 'import { z } from "zod";', filename: inPackage("schema") },
      ],
      invalid: [
        // L1 → L3: sobe. É o caso do critério de saída.
        {
          code: 'import { Renderer } from "@theatrum/renderer";',
          filename: inPackage("document"),
          errors: [{ messageId: "crossLayer" }],
        },
        // L0 → L1: o núcleo não pode conhecer o documento.
        {
          code: 'import { NodeSchema } from "@theatrum/schema";',
          filename: inPackage("core-math"),
          errors: [{ messageId: "crossLayer" }],
        },
        // A direção inversa de uma aresta lateral continua proibida.
        {
          code: 'import { Effects } from "@theatrum/effects";',
          filename: inPackage("renderer"),
          errors: [{ messageId: "crossLayer" }],
        },
        // Qualquer coisa → engine (L5) de baixo.
        {
          code: 'import { createEngine } from "@theatrum/engine";',
          filename: inPackage("export"),
          errors: [{ messageId: "crossLayer" }],
        },
        // re-export também conta
        {
          code: 'export { Renderer } from "@theatrum/renderer";',
          filename: inPackage("document"),
          errors: [{ messageId: "crossLayer" }],
        },
        // import dinâmico também
        {
          code: 'const m = await import("@theatrum/renderer");',
          filename: inPackage("document"),
          errors: [{ messageId: "crossLayer" }],
        },
        // A exceção editor → shell é de mão única.
        {
          code: 'import { App } from "@theatrum/editor";',
          filename: inApp("shell"),
          errors: [{ messageId: "crossLayer" }],
        },
        // Pacote não registrado na tabela de camadas.
        {
          code: 'import { x } from "@theatrum/inventado";',
          filename: inPackage("document"),
          errors: [{ messageId: "unknownPackage" }],
        },
      ],
    });
  });
});

describe("enforce-barrel-imports", () => {
  it("aceita o barrel e rejeita alcançar o interior", () => {
    tester.run("enforce-barrel-imports", enforceBarrelImports as never, {
      valid: [
        {
          code: 'import { evaluate } from "@theatrum/animation";',
          filename: inPackage("commands"),
        },
        // Relativo dentro do próprio pacote é normal.
        { code: 'import { x } from "./sub/thing.js";', filename: inPackage("animation") },
        { code: 'import { x } from "../local.js";', filename: inPackage("animation") },
      ],
      invalid: [
        {
          code: 'import { evaluate } from "@theatrum/animation/src/evaluator";',
          filename: inPackage("commands"),
          errors: [{ messageId: "internal" }],
        },
        {
          code: 'export { x } from "@theatrum/gis/src/projector";',
          filename: inPackage("camera"),
          errors: [{ messageId: "internal" }],
        },
        {
          code: 'import { x } from "../../animation/src/evaluator.js";',
          filename: inPackage("commands"),
          errors: [{ messageId: "relativeCrossPackage" }],
        },
      ],
    });
  });
});

describe("no-nondeterminism", () => {
  it("rejeita tempo real e aleatoriedade não semeada nos pacotes", () => {
    tester.run("no-nondeterminism", noNondeterminism as never, {
      valid: [
        // A implementação do PRNG é o único lugar autorizado.
        {
          code: "const x = Math.random();",
          filename: inPackage("core-utils", "src/prng.ts"),
        },
        // Testes podem.
        {
          code: "const x = Date.now();",
          filename: inPackage("animation", "src/evaluator.test.ts"),
        },
        // A UI pode medir FPS e mostrar hora.
        {
          code: "const x = performance.now();",
          filename: path.join(ROOT, "apps", "editor", "src", "app", "boot.ts"),
        },
        // Data com argumentos é determinística.
        {
          code: "const d = new Date(2026, 0, 1);",
          filename: inPackage("scripting"),
        },
        // Uso do PRNG semeado é o caminho correto.
        {
          code: 'import { createRng } from "@theatrum/core-utils"; const r = createRng(7).next();',
          filename: inPackage("effects"),
        },
      ],
      invalid: [
        {
          code: "const x = Math.random();",
          filename: inPackage("effects", "src/particles.ts"),
          errors: [{ messageId: "banned" }],
        },
        {
          code: "const t = Date.now();",
          filename: inPackage("animation", "src/evaluator.ts"),
          errors: [{ messageId: "banned" }],
        },
        {
          code: "const t = performance.now();",
          filename: inPackage("export", "src/frame-pump.ts"),
          errors: [{ messageId: "banned" }],
        },
        {
          code: "const d = new Date();",
          filename: inPackage("project-io", "src/save.ts"),
          errors: [{ messageId: "bannedNew" }],
        },
      ],
    });
  });
});

describe("no-direct-document-mutation", () => {
  it("permite mutação só onde o caminho de escrita é implementado", () => {
    tester.run("no-direct-document-mutation", noDirectDocumentMutation as never, {
      valid: [
        // commands implementa o bus.
        {
          code: "document.mutate((d) => { d.name = 'x'; });",
          filename: inPackage("commands", "src/bus.ts"),
        },
        // document implementa o store.
        {
          code: "store.mutate((d) => { d.name = 'x'; });",
          filename: inPackage("document", "src/store.ts"),
        },
        // Um `mutate` que não é do documento não é assunto da regra.
        {
          code: "pixiGeometry.mutate();",
          filename: inPackage("renderer", "src/mesh.ts"),
        },
      ],
      invalid: [
        {
          code: "document.mutate((d) => { d.name = 'x'; });",
          filename: inPackage("behaviors", "src/motion-path.ts"),
          errors: [{ messageId: "direct" }],
        },
        {
          code: "engine.document.mutate((d) => { d.name = 'x'; });",
          filename: path.join(ROOT, "apps", "editor", "src", "panels", "inspector", "Field.tsx"),
          errors: [{ messageId: "direct" }],
        },
      ],
    });
  });
});

describe("tabela de camadas", () => {
  it("extrai o pacote do especificador", () => {
    expect(packageFromSpecifier("@theatrum/core-math")).toBe("core-math");
    expect(packageFromSpecifier("@theatrum/core-math/src/vec")).toBe("core-math");
    expect(packageFromSpecifier("zod")).toBeNull();
    expect(packageFromSpecifier("./local.js")).toBeNull();
  });

  it("extrai o pacote do caminho em disco, em Windows e POSIX", () => {
    expect(packageFromFilename("C:\\repo\\packages\\animation\\src\\x.ts")).toBe("animation");
    expect(packageFromFilename("/repo/packages/animation/src/x.ts")).toBe("animation");
    expect(packageFromFilename("/repo/apps/editor/src/x.ts")).toBe("editor");
    expect(packageFromFilename("/repo/tools/scaffold.mjs")).toBeNull();
  });

  it("a relação de permissão é irreflexiva entre pacotes distintos e antissimétrica", () => {
    // Se A pode importar B, B não pode importar A. Sem isso, ciclo é possível.
    const pkgs = [
      "core-math",
      "core-utils",
      "core-time",
      "schema",
      "document",
      "scene-graph",
      "animation",
      "renderer",
      "effects",
      "camera",
      "behaviors",
      "commands",
      "scripting",
      "plugin-host",
      "engine",
      "editor",
      "shell",
    ];
    for (const a of pkgs) {
      for (const b of pkgs) {
        if (a === b) continue;
        if (isImportAllowed(a, b)) {
          expect(isImportAllowed(b, a), `${a}→${b} e ${b}→${a} não podem ser ambos`).toBe(false);
        }
      }
    }
  });
});

/**
 * O teste que realmente prova o critério de saída: roda a configuração REAL do
 * ESLint. Os RuleTester acima provam que as regras funcionam; este prova que
 * elas estão de fato ligadas na config — desligar uma delas faz este falhar.
 */
describe("integração com a config real do ESLint", () => {
  const lint = async (code: string, filename: string) => {
    const eslint = new ESLint({ cwd: ROOT });
    const [result] = await eslint.lintText(code, { filePath: filename });
    return result?.messages ?? [];
  };

  it("import de camada superior REPROVA no lint de verdade", async () => {
    const messages = await lint(
      'import { Renderer } from "@theatrum/renderer";\nexport const x: unknown = Renderer;\n',
      inPackage("document", "src/forbidden-probe.ts"),
    );
    const ruleIds = messages.map((m) => m.ruleId);
    expect(ruleIds).toContain("theatrum/no-cross-layer-import");
  });

  it("Math.random em pacote de motor REPROVA no lint de verdade", async () => {
    const messages = await lint(
      "export const x = Math.random();\n",
      inPackage("effects", "src/nondeterminism-probe.ts"),
    );
    expect(messages.map((m) => m.ruleId)).toContain("theatrum/no-nondeterminism");
  });

  it("alcançar o interior de outro pacote REPROVA no lint de verdade", async () => {
    const messages = await lint(
      'import { evaluate } from "@theatrum/animation/src/evaluator";\nexport const x: unknown = evaluate;\n',
      inPackage("commands", "src/barrel-probe.ts"),
    );
    expect(messages.map((m) => m.ruleId)).toContain("theatrum/enforce-barrel-imports");
  });

  it("mutação direta do documento REPROVA no lint de verdade", async () => {
    const messages = await lint(
      "declare const document: { mutate: (f: () => void) => void };\ndocument.mutate(() => {});\n",
      inPackage("behaviors", "src/mutation-probe.ts"),
    );
    expect(messages.map((m) => m.ruleId)).toContain("theatrum/no-direct-document-mutation");
  });

  it("código legítimo PASSA — a regra não é um portão que barra tudo", async () => {
    const messages = await lint(
      'import { hash32 } from "@theatrum/core-utils";\nexport const x = hash32("ok");\n',
      inPackage("document", "src/allowed-probe.ts"),
    );
    expect(messages.filter((m) => m.ruleId?.startsWith("theatrum/"))).toEqual([]);
  });
});
