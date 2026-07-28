/**
 * Provas da contabilidade de carga de modelos — o número que o settle do
 * export espera zerar antes de capturar um frame.
 *
 * A regra que este teste trava: **erro é resolução, não espera**. Um GLB que
 * falhou no parse nunca vai virar instância, e contá-lo como pendente deixaria
 * o export parado no timeout por frame — o defeito simétrico ao de capturar
 * cedo demais. Cobre a camada 3D do mapa e o palco do estúdio, que compartilham
 * esta função exatamente para não divergir na contagem.
 */

import { describe, expect, it } from "vitest";
import { countPendingModels, type ModelLoadNodeLike } from "./three-assets.js";

const node = (id: string, assetSrc = `glb-${id}`): ModelLoadNodeLike => ({ id, assetSrc });

describe("countPendingModels", () => {
  it("sem nós, zero pendente", () => {
    expect(countPendingModels([], new Set(), new Set())).toBe(0);
  });

  it("nó carregado não é pendente", () => {
    expect(countPendingModels([node("a")], new Set(["a"]), new Set())).toBe(0);
  });

  it("nó nem carregado nem falhado é pendente — o GLB ainda pode aparecer", () => {
    expect(countPendingModels([node("a"), node("b")], new Set(["a"]), new Set())).toBe(1);
  });

  it("GLB falho conta como resolvido: zero pendente e o export não trava", () => {
    const falho = node("a", "src-quebrado");
    expect(countPendingModels([falho], new Set(), new Set(["src-quebrado"]))).toBe(0);
  });

  it("a falha é por src: dois nós com o mesmo GLB quebrado resolvem juntos", () => {
    const nodes = [node("a", "src-quebrado"), node("b", "src-quebrado")];
    expect(countPendingModels(nodes, new Set(), new Set(["src-quebrado"]))).toBe(0);
  });

  it("mistura honesta: carregado + pendente + falho soma só o pendente", () => {
    const nodes = [node("ok"), node("esperando"), node("falho", "src-quebrado")];
    expect(countPendingModels(nodes, new Set(["ok"]), new Set(["src-quebrado"]))).toBe(1);
  });

  it("carregado vence falho: se a instância existe, não há o que esperar", () => {
    const nodes = [node("a", "src-quebrado")];
    expect(countPendingModels(nodes, new Set(["a"]), new Set(["src-quebrado"]))).toBe(0);
  });
});
