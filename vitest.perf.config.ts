import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = import.meta.dirname;

/**
 * Os orçamentos rodam isolados. Misturá-los aos workers da suíte funcional
 * faria o resultado medir a contenção do runner, não o custo do motor.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@theatrum/animation": resolve(root, "packages/animation/src/index.ts"),
      "@theatrum/document": resolve(root, "packages/document/src/index.ts"),
      "@theatrum/scene-graph": resolve(root, "packages/scene-graph/src/index.ts"),
      "@theatrum/schema": resolve(root, "packages/schema/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/perf/**/*.test.ts", "apps/editor/src/panels/timeline/timeline-canvas.test.ts"],
  },
});
