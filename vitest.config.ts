import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@theatrum/animation": resolve(root, "packages/animation/src/index.ts"),
      "@theatrum/document": resolve(root, "packages/document/src/index.ts"),
      "@theatrum/engine": resolve(root, "packages/engine/src/index.ts"),
      "@theatrum/scene-graph": resolve(root, "packages/scene-graph/src/index.ts"),
      "@theatrum/schema": resolve(root, "packages/schema/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/editor/src/**/*.test.ts",
      "apps/shell/src/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
    environment: "node",
    // Falha em vez de passar silenciosamente quando um filtro não casa nada.
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      include: [
        "packages/*/src/**/*.ts",
        "apps/editor/src/panels/viewport/maplibre-adapters.ts",
        "apps/editor/src/panels/viewport/map-styles.ts",
        "apps/editor/src/panels/viewport/natural-earth-gazetteer.ts",
      ],
      exclude: ["**/*.test.ts", "**/index.ts"],
      reporter: ["text", "html"],
      // Orçamento dos pacotes L0, que são pequenos, puros e não mudam depois.
      // Ver docs/08-ROADMAP.md § Fase 1, critério de saída 4.
      thresholds: {
        "packages/core-math/src/**": { lines: 90, functions: 90, branches: 85 },
        "packages/core-time/src/**": { lines: 90, functions: 90, branches: 85 },
        "packages/core-utils/src/**": { lines: 90, functions: 90, branches: 85 },
        "packages/gis/src/**": { lines: 90, functions: 90, branches: 85 },
        "packages/camera/src/**": { lines: 90, functions: 90, branches: 85 },
        "apps/editor/src/panels/viewport/**": {
          lines: 90,
          functions: 90,
          branches: 80,
        },
      },
    },
  },
});
