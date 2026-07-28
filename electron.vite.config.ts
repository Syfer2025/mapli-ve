import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { builtinModules } from "node:module";
import { resolve } from "node:path";

const root = import.meta.dirname;

/**
 * Nunca empacotar: `electron` e os built-ins do Node.
 *
 * `externalizeDepsPlugin()` externaliza o que está em `dependencies`, e
 * `electron` vive em `devDependencies` — então ele NÃO é coberto. Sem esta
 * lista explícita, o Rollup empacota o `index.js` do pacote electron (que é só
 * um lançador Node) dentro do bundle do main, e o app morre no boot com
 * "Electron failed to install correctly", apontando para o nosso próprio
 * bundle. Custou um diagnóstico; fica registrado.
 */
const NODE_EXTERNAL = ["electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@theatrum/core-utils": resolve(root, "packages/core-utils/src/index.ts"),
        "@theatrum/schema": resolve(root, "packages/schema/src/index.ts"),
        "@theatrum/project-io": resolve(root, "packages/project-io/src/index.ts"),
        "@theatrum/export": resolve(root, "packages/export/src/index.ts"),
      },
    },
    build: {
      outDir: "out/main",
      lib: { entry: resolve(root, "apps/shell/src/main/index.ts") },
      rollupOptions: {
        external: NODE_EXTERNAL,
        output: { format: "es", entryFileNames: "index.mjs" },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      lib: { entry: resolve(root, "apps/shell/src/preload/index.ts") },
      rollupOptions: {
        external: NODE_EXTERNAL,
        // CommonJS de propósito: preload em ESM é incompatível com
        // `sandbox: true`, e o sandbox é a postura de segurança que queremos
        // manter nas duas janelas. Ver apps/shell/src/main/windows/editor.ts.
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },

  renderer: {
    root: resolve(root, "apps/editor"),
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(root, "apps/editor/src"),
        // Pacotes são consumidos como fonte TS — sem passo de build entre eles
        // durante o desenvolvimento. Ver docs/07-CONVENTIONS.md § 1.
        "@theatrum/core-math": resolve(root, "packages/core-math/src/index.ts"),
        "@theatrum/core-time": resolve(root, "packages/core-time/src/index.ts"),
        "@theatrum/core-utils": resolve(root, "packages/core-utils/src/index.ts"),
        "@theatrum/schema": resolve(root, "packages/schema/src/index.ts"),
        "@theatrum/document": resolve(root, "packages/document/src/index.ts"),
        "@theatrum/scene-graph": resolve(root, "packages/scene-graph/src/index.ts"),
        "@theatrum/animation": resolve(root, "packages/animation/src/index.ts"),
        "@theatrum/behaviors": resolve(root, "packages/behaviors/src/index.ts"),
        "@theatrum/effects": resolve(root, "packages/effects/src/index.ts"),
        "@theatrum/renderer": resolve(root, "packages/renderer/src/index.ts"),
        "@theatrum/commands": resolve(root, "packages/commands/src/index.ts"),
        "@theatrum/project-io": resolve(root, "packages/project-io/src/index.ts"),
        "@theatrum/shell": resolve(root, "apps/shell/src/index.ts"),
      },
    },
    build: {
      outDir: resolve(root, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, "apps/editor/index.html") },
    },
    server: { port: 5273, strictPort: true },
  },
});
