import { evaluate } from "@theatrum/animation";
import {
  createEmptyProjectDocument,
  type ActionInstanceData,
  type ProjectDocument,
} from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import { applySceneBehaviors } from "./apply.js";
import { BUILTIN_ACTION_TYPES, createBuiltinActionRegistry } from "./builtin-actions.js";
import { expandLiveActions, materializeActionExpansions } from "./apply-actions.js";

function documentWithAction(
  type: string,
  params: Record<string, unknown>,
): { document: ProjectDocument; compositionId: string; ownerId: string; actionId: string } {
  const document = structuredClone(createEmptyProjectDocument());
  const composition = document.compositions[0];
  if (composition === undefined) throw new Error("fixture sem composição");
  const owner = composition.nodes[composition.root];
  if (owner === undefined) throw new Error("fixture sem raiz");
  const actionId = `action:${type}`;
  owner.actions.push({
    id: actionId,
    type,
    enabled: true,
    mode: "live",
    startFrame: 30,
    params,
  } satisfies ActionInstanceData);
  document.paths["path:test"] = {
    id: "path:test",
    name: "Rota de teste",
    space: "comp",
    vertices: [
      { point: [0, 0], inHandle: null, outHandle: null },
      { point: [100, 0], inHandle: null, outHandle: null },
    ],
    closed: false,
    interpolation: "linear",
    geodesic: false,
  };
  return { document, compositionId: composition.id, ownerId: owner.id, actionId };
}

describe("Action Templates", () => {
  it("registra as dezesseis ações do roteiro sem switch no consumidor", () => {
    expect(BUILTIN_ACTION_TYPES).toEqual([
      "advance",
      "retreat",
      "attack",
      "patrol",
      "intercept",
      "dogfight",
      "amphibious-landing",
      "airdrop",
      "encircle",
      "naval-blockade",
      "supply-line",
      "missile-launch",
      "bombard",
      "airstrike",
      "siege",
      "frontline-shift",
    ]);
    const registry = createBuiltinActionRegistry();
    expect(registry.size).toBe(16);
    expect(registry.list()).toEqual(BUILTIN_ACTION_TYPES);
  });

  it("calcula duração pela distância e velocidade da unidade", () => {
    const fixture = documentWithAction("advance", {
      pathId: "path:test",
      speedKmh: 36,
      cycles: 1,
      autoOrient: true,
      showRoute: true,
      color: "#f2a13cff",
    });
    const pass = expandLiveActions(fixture.document, fixture.compositionId);
    expect(pass.diagnostics).toEqual([]);
    // 100 unidades / (36 km/h = 10 unidades/s) * 60 fps.
    expect(pass.expansions[0]?.durationFrames).toBe(600);
    expect(pass.generatedNodes).toBe(1);
    const owner = pass.document.compositions[0]?.nodes[fixture.ownerId];
    expect(owner?.behaviors[0]?.type).toBe("motion-path");
  });

  it("bombardear gera mais de quarenta keyframes editáveis em um clique", () => {
    const fixture = documentWithAction("bombard", {
      pathId: "path:test",
      durationFrames: 180,
      count: 5,
      color: "#fb923cff",
      arcMeters: 65_000,
      shake: true,
    });
    const pass = expandLiveActions(fixture.document, fixture.compositionId);
    expect(pass.diagnostics).toEqual([]);
    expect(pass.generatedNodes).toBe(15);
    expect(pass.generatedKeyframes).toBeGreaterThanOrEqual(50);
    expect(pass.expansions[0]?.nodes.filter((node) => node.type === "route3d")).toHaveLength(5);
    expect(
      pass.expansions[0]?.nodes.filter((node) => node.name.startsWith("Impacto")),
    ).toHaveLength(5);
    expect(pass.expansions[0]?.nodes.filter((node) => node.name.startsWith("Fumaça"))).toHaveLength(
      5,
    );
  });

  it("live e materializado avaliam a mesma cena em qualquer frame", () => {
    const fixture = documentWithAction("advance", {
      pathId: "path:test",
      speedKmh: 72,
      cycles: 1,
      autoOrient: true,
      showRoute: true,
      color: "#f2a13cff",
    });
    const live = expandLiveActions(fixture.document, fixture.compositionId);
    const baked = materializeActionExpansions(
      fixture.document,
      fixture.compositionId,
      live.expansions,
    ).document;
    const bakedOwner = baked.compositions[0]?.nodes[fixture.ownerId];
    if (bakedOwner === undefined) throw new Error("owner ausente");
    bakedOwner.actions = [];

    for (const frame of [0, 30, 180, 330, 700]) {
      const liveScene = applySceneBehaviors(
        evaluate(live.document, fixture.compositionId, frame),
        live.document,
        fixture.compositionId,
      ).scene;
      const bakedScene = applySceneBehaviors(
        evaluate(baked, fixture.compositionId, frame),
        baked,
        fixture.compositionId,
      ).scene;
      expect(bakedScene).toEqual(liveScene);
    }
  });

  it("caminho ausente vira diagnóstico e não derruba a cena", () => {
    const fixture = documentWithAction("advance", {
      pathId: "path:missing",
      speedKmh: 40,
      cycles: 1,
      autoOrient: true,
      showRoute: true,
      color: "#f2a13cff",
    });
    const pass = expandLiveActions(fixture.document, fixture.compositionId);
    expect(pass.document).toBe(fixture.document);
    expect(pass.diagnostics).toEqual([
      expect.objectContaining({ code: "missing-path", actionId: fixture.actionId }),
    ]);
  });
});
