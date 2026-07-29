import { createEmptyProjectDocument, type Node } from "@theatrum/schema";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_NODE_TYPES,
  BUILTIN_NODE_TYPE_IDS,
  createBuiltinNodeTypeRegistry,
} from "./builtin-node-types.js";
import type { NodeTypeDefinition, PropertyDescriptor } from "./contracts.js";
import { NodeTypeRegistrationError } from "./errors.js";
import { createNodeTypeRegistry } from "./registry.js";

const EMPTY_PROPERTIES: readonly PropertyDescriptor[] = Object.freeze([]);

function definition(
  type: string,
  overrides: Partial<NodeTypeDefinition<{ radius: number }>> = {},
): NodeTypeDefinition<{ radius: number }> {
  return {
    type,
    category: "shape",
    label: "Círculo",
    icon: "circle",
    defaultProps: { radius: 10 },
    propertySchema: z.object({ radius: z.number().positive() }),
    properties: EMPTY_PROPERTIES,
    animatable: EMPTY_PROPERTIES,
    supportsChildren: false,
    defaultAnchorSpace: "comp",
    defaultSizeMode: "screen",
    ...overrides,
  };
}

function rootNode(): Node {
  const document = createEmptyProjectDocument();
  const composition = document.compositions[0];
  if (composition === undefined) throw new Error("fixture sem composição");
  const node = composition.nodes[composition.root];
  if (node === undefined) throw new Error("fixture sem raiz");
  return structuredClone(node);
}

describe("builtin node type registry", () => {
  it("registra exatamente os vinte e três tipos base em ordem explícita", () => {
    const registry = createBuiltinNodeTypeRegistry();
    expect(registry.size).toBe(23);
    expect(registry.list().map((item) => item.type)).toEqual(BUILTIN_NODE_TYPE_IDS);
    expect(BUILTIN_NODE_TYPES.map((item) => item.type)).toEqual(BUILTIN_NODE_TYPE_IDS);
  });

  it("território, rio e estradas têm preenchimento e contorno independentes", () => {
    const registry = createBuiltinNodeTypeRegistry();
    for (const type of ["geo.region", "geo.rivers", "geo.roads"] as const) {
      const definition = registry.get(type);
      expect(definition?.category, type).toBe("geo");
      // Âncora geográfica: os anéis chegam relativos ao centro do território.
      expect(definition?.defaultAnchorSpace, type).toBe("geo");
      const paths = definition?.properties.map((descriptor) => descriptor.path) ?? [];
      // Cor e opacidade separadas nos dois lados é o que permite "só contorno"
      // e "só preenchimento" sem trocar de tipo de nó.
      for (const path of [
        "props.geoId",
        "props.fill",
        "props.fillAlpha",
        "props.stroke",
        "props.strokeWidth",
        "props.strokeAlpha",
      ]) {
        expect(paths, `${type} · ${path}`).toContain(path);
      }
      // Tudo menos a identidade do território é animável por keyframe.
      const animatable = definition?.animatable.map((descriptor) => descriptor.path) ?? [];
      expect(animatable, type).toContain("props.fillAlpha");
      expect(animatable, type).toContain("props.strokeAlpha");
      expect(animatable, type).not.toContain("props.geoId");
    }
  });

  it("o rio e as estradas nascem sem preenchimento; o território nasce com", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const river = registry.createDefaultProps("geo.rivers") as Record<
      string,
      { readonly value: unknown }
    >;
    const roads = registry.createDefaultProps("geo.roads") as Record<
      string,
      { readonly value: unknown }
    >;
    const region = registry.createDefaultProps("geo.region") as Record<
      string,
      { readonly value: unknown }
    >;
    expect(river["fillAlpha"]?.value).toBe(0);
    expect(roads["fillAlpha"]?.value).toBe(0);
    expect(region["fillAlpha"]?.value).toBeGreaterThan(0);
    // Os três nascem com contorno visível: um nó invisível ao ser criado parece
    // que o comando falhou.
    expect(river["strokeAlpha"]?.value).toBeGreaterThan(0);
    expect(roads["strokeAlpha"]?.value).toBeGreaterThan(0);
    expect(region["strokeAlpha"]?.value).toBeGreaterThan(0);
  });

  it("expõe shape.circle com descriptors próprios e defaults animáveis", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const definition = registry.get("shape.circle");
    expect(definition?.label).toBe("Círculo");
    expect(definition?.category).toBe("shape");
    expect(definition?.defaultAnchorSpace).toBe("geo");
    expect(definition?.properties.map((descriptor) => descriptor.path)).toEqual([
      "anchor",
      "size",
      "transform.position",
      "transform.rotation",
      "transform.scale",
      "transform.opacity",
      "transform.anchorPoint",
      "transform.skew",
      "props.radius",
      "props.fill",
      "props.stroke",
      "props.strokeWidth",
    ]);
    expect(registry.createDefaultProps("shape.circle")).toEqual({
      radius: { value: 48, keyframes: [], expression: null },
      fill: { value: "#3b82f680", keyframes: [], expression: null },
      stroke: { value: "#60a5faff", keyframes: [], expression: null },
      strokeWidth: { value: 2, keyframes: [], expression: null },
    });
  });

  /**
   * Os caminhos deste tipo são contrato com a camada 3D do viewport
   * (`scene3d-layer.ts` lê `props.pathId`, `props.arcMeters` e companhia por
   * nome). Renomear uma prop aqui e esquecer lá não quebra tipagem — a rota só
   * some da tela. Este teste é o que transforma isso em falha de build.
   */
  it("expõe route3d com as props que a camada 3D lê por nome", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const definition = registry.get("route3d");
    expect(definition?.label).toBe("Rota 3D");
    expect(definition?.category).toBe("geo");
    expect(definition?.defaultAnchorSpace).toBe("geo");
    expect(
      definition?.properties
        .map((descriptor) => descriptor.path)
        .filter((path) => path.startsWith("props.")),
    ).toEqual([
      "props.pathId",
      "props.color",
      "props.widthMeters",
      "props.altitudeMeters",
      "props.arcMeters",
      "props.progressStart",
      "props.progressEnd",
      "props.curtainOpacity",
    ]);
    expect(registry.createDefaultProps("route3d")).toEqual({
      pathId: { value: "", keyframes: [], expression: null },
      color: { value: "#f2a13cff", keyframes: [], expression: null },
      widthMeters: { value: 6_000, keyframes: [], expression: null },
      altitudeMeters: { value: 0, keyframes: [], expression: null },
      arcMeters: { value: 0, keyframes: [], expression: null },
      progressStart: { value: 0, keyframes: [], expression: null },
      progressEnd: { value: 1, keyframes: [], expression: null },
      curtainOpacity: { value: 0.22, keyframes: [], expression: null },
    });
    // `pathId` referencia um caminho do projeto: animar isso não significa nada
    // e viraria trilha morta na Timeline.
    expect(
      definition?.properties.find((descriptor) => descriptor.path === "props.pathId")?.animatable,
    ).toBe(false);
  });

  /**
   * O look do palco é decisão visual do dono, e este teste é o que a protege.
   *
   * Os nove valores abaixo foram compostos por ele no Inspector, com o palco na tela, e
   * promovidos a padrão a pedido dele em 2026-07-28. Eles não têm defesa em tipo nem em
   * schema: qualquer um passa por "número plausível", e trocar `environmentIntensity` de
   * 0,2 para 0,75 "porque parece pouco" desfaz uma decisão tomada olhando o resultado —
   * sem quebrar nada e sem deixar rastro.
   *
   * Se este teste ficar vermelho, a pergunta certa não é "qual número atualizo": é
   * **quem mudou o look do palco, e mediu?**
   */
  it("o palco nasce com o look que o dono compôs", () => {
    const props = createBuiltinNodeTypeRegistry().createDefaultProps("studio.stage") as Record<
      string,
      { value: unknown }
    >;
    const valores = Object.fromEntries(
      Object.entries(props).map(([key, property]) => [key, property.value]),
    );
    expect(valores).toMatchObject({
      // Aparência composta pelo dono.
      gridSpacingMeters: 0.05,
      gridOpacity: 0.55,
      keyIntensity: 2.8,
      rimIntensity: 1.1,
      environmentIntensity: 0.2,
      floorTexture: 1,
      reflectionStrength: 0.3,
      shadowStrength: 1,
      vignette: 0.7,
      horizonHaze: 1,
      hazeColor: "#3c4654ff",
      // E o que ele **não** mudou, para a diferença ficar visível no diff.
      background: "#0d1218ff",
      floor: "#39424fff",
      gridColor: "#5d6f84ff",
      distanceMeters: 40,
      azimuthDeg: 35,
      elevationDeg: 14,
      fovDeg: 38,
    });
  });

  it("aceita palco anterior ao ADR-018 sem criar reflexo implícito", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const props = registry.createDefaultProps("studio.stage");
    delete props["reflectionStrength"];
    const resolved = registry.resolve({
      id: "stage_antigo",
      type: "studio.stage",
      name: "Palco antigo",
      children: [],
      props,
    } as never);
    expect(resolved).toMatchObject({
      status: "resolved",
      props: { reflectionStrength: { value: 0, keyframes: [], expression: null } },
    });
  });

  /**
   * O ponto de interesse do palco (ADR-015) carrega metros e graus, e o roteiro
   * os copia para as props de câmera do `studio.stage`. Os nomes são contrato
   * entre os dois: renomear aqui e esquecer lá não quebra tipagem — a visita
   * simplesmente enquadra o lugar errado, que é o defeito silencioso que este
   * teste existe para transformar em vermelho.
   */
  it("expõe studio.poi com dono, ponto e enquadramento absoluto", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const definition = registry.get("studio.poi");
    expect(definition?.label).toBe("Ponto do palco");
    expect(definition?.properties.map((descriptor) => descriptor.path)).toEqual([
      "props.ownerId",
      "props.pointX",
      "props.pointY",
      "props.pointZ",
      "props.distanceMeters",
      "props.azimuthDeg",
      "props.elevationDeg",
      "props.fovDeg",
      "props.driftDeg",
      "props.holdFrames",
    ]);
    // A pausa própria é entrada do compilador do roteiro, como os tempos do
    // palco: uma trilha de "duração da pausa" variando no tempo não significaria
    // nada, porque a pausa que ela descreve já virou keyframes.
    expect(
      definition?.properties.find((descriptor) => descriptor.path === "props.holdFrames")
        ?.animatable,
    ).toBe(false);
    /**
     * A unidade de `pointX/Y/Z` **depende** de `ownerId` (ADR-016): metros de palco
     * sem dono, fração do vão do modelo com dono. Declarar `unit: "meters"` faria o
     * Inspector afirmar metros na metade dos casos em que não são — e rótulo de
     * unidade errado é como se marca um ponto no lugar errado com total confiança.
     */
    for (const path of ["props.pointX", "props.pointY", "props.pointZ"]) {
      expect(definition?.properties.find((descriptor) => descriptor.path === path)?.unit).toBe(
        undefined,
      );
    }
    // O dono é referência a outro nó, e não se anima: um ponto que troca de objeto
    // no meio do vídeo teria o mesmo triplo lido em dois espaços diferentes.
    expect(
      definition?.properties.find((descriptor) => descriptor.path === "props.ownerId")?.animatable,
    ).toBe(false);
    // O nome do ponto é o nome do NÓ. Uma `props.name` aqui seria um segundo
    // campo "nome" para a mesma coisa, e os dois divergiriam no primeiro rename.
    expect(definition?.properties.some((descriptor) => descriptor.path === "props.name")).toBe(
      false,
    );
    expect(registry.createDefaultProps("studio.poi")).toEqual({
      // Nasce solto: um nó criado pelo menu não veio de clique em superfície
      // nenhuma, então não há objeto a que ancorá-lo.
      ownerId: { value: "", keyframes: [], expression: null },
      pointX: { value: 0, keyframes: [], expression: null },
      pointY: { value: 0, keyframes: [], expression: null },
      pointZ: { value: 0, keyframes: [], expression: null },
      distanceMeters: { value: 12, keyframes: [], expression: null },
      azimuthDeg: { value: 35, keyframes: [], expression: null },
      elevationDeg: { value: 18, keyframes: [], expression: null },
      // Nasce com a lente do palco: uma lente diferente faria toda visita dar um
      // salto óptico que ninguém pediu.
      fovDeg: { value: 38, keyframes: [], expression: null },
      driftDeg: { value: 4, keyframes: [], expression: null },
      holdFrames: { value: 0, keyframes: [], expression: null },
    });
  });

  /**
   * A armadilha que o ADR-014 pagou no palco, travada agora para os dois nós de
   * estúdio: o avaliador deriva `visible` de `opacity > 0`, então oferecer
   * opacidade num nó que não desenha dá ao usuário um controle cujo único efeito
   * possível é fazer a coisa sumir sem explicação. O dono encontrou isso no
   * Inspector, com o mapa reacendendo por baixo do palco.
   */
  it("nem palco nem ponto de interesse oferecem transform no Inspector", () => {
    const registry = createBuiltinNodeTypeRegistry();
    for (const type of ["studio.stage", "studio.poi"]) {
      const paths = registry.get(type)?.properties.map((descriptor) => descriptor.path) ?? [];
      expect(paths, type).not.toHaveLength(0);
      expect(
        paths.every((path) => path.startsWith("props.")),
        type,
      ).toBe(true);
    }
  });

  it("lista por categoria sem expor o array interno", () => {
    const registry = createBuiltinNodeTypeRegistry();
    expect(registry.list("unit").map((item) => item.type)).toEqual(["unit.armor", "unit.infantry"]);
    expect(registry.list("text").map((item) => item.type)).toEqual([
      "text.title",
      "text.label",
      "label.callout",
    ]);
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  it("todos os defaults passam no próprio schema e descriptors são únicos", () => {
    for (const item of BUILTIN_NODE_TYPES) {
      expect(item.propertySchema.safeParse(item.defaultProps).success, item.type).toBe(true);
      expect(new Set(item.properties.map((descriptor) => descriptor.path)).size).toBe(
        item.properties.length,
      );
      expect(item.animatable.map((descriptor) => descriptor.path)).toEqual(
        item.properties
          .filter((descriptor) => descriptor.animatable)
          .map((descriptor) => descriptor.path),
      );
    }
  });

  it("todo descriptor animatable aponta para wrapper no default do nó", () => {
    for (const item of BUILTIN_NODE_TYPES) {
      for (const descriptor of item.properties) {
        if (descriptor.binding !== "animatable" || !descriptor.path.startsWith("props.")) {
          continue;
        }
        let value: unknown = item.defaultProps;
        for (const segment of descriptor.path.split(".").slice(1)) {
          if (typeof value !== "object" || value === null) break;
          value = Reflect.get(value, segment);
        }
        expect(value, `${item.type}:${descriptor.path}`).toEqual(
          expect.objectContaining({
            keyframes: expect.any(Array),
            expression: null,
          }),
        );
        expect(value).toHaveProperty("value");
      }
    }
  });

  it("defaults criados são clones independentes dos defaults congelados", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const first = registry.createDefaultProps("text.title");
    const second = registry.createDefaultProps("text.title");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    const text = first["text"];
    if (typeof text !== "object" || text === null) throw new Error("default inválido");
    Reflect.set(text, "value", "Alterado");
    expect(second).not.toEqual(first);
    expect(registry.get("text.title")?.defaultProps).not.toEqual(first);
    expect(Object.isFrozen(registry.get("text.title")?.defaultProps)).toBe(true);
  });
});

describe("extensible registry", () => {
  it("registra e descarrega um tipo novo sem switch central", () => {
    const registry = createNodeTypeRegistry();
    const disposable = registry.register(definition("shape.circle"));
    expect(registry.get("shape.circle")?.label).toBe("Círculo");
    expect(registry.has("shape.circle")).toBe(true);
    disposable.dispose();
    disposable.dispose();
    expect(registry.has("shape.circle")).toBe(false);
  });

  it("rejeita tipo duplicado e nomes inválidos", () => {
    const registry = createNodeTypeRegistry([definition("shape.circle")]);
    expect(() => registry.register(definition("shape.circle"))).toThrowError(
      expect.objectContaining({ code: "duplicate-type" }),
    );
    expect(() => registry.register(definition("Shape Circle"))).toThrowError(
      expect.objectContaining({ code: "invalid-type" }),
    );
  });

  it("rejeita property path perigoso ou duplicado", () => {
    const registry = createNodeTypeRegistry();
    const descriptor: PropertyDescriptor = {
      path: "props.radius",
      label: "Raio",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: false,
    };
    expect(() =>
      registry.register(
        definition("shape.circle", {
          properties: [descriptor, descriptor],
          animatable: [],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "duplicate-property" }));

    expect(() =>
      registry.register(
        definition("shape.unsafe", {
          properties: [{ ...descriptor, path: "props.__proto__.x" }],
          animatable: [],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-property-path" }));
  });

  it("rejeita lista animatable divergente e defaultProps inválido", () => {
    const registry = createNodeTypeRegistry();
    const descriptor: PropertyDescriptor = {
      path: "props.radius",
      label: "Raio",
      kind: "number",
      group: "content",
      binding: "animatable",
      animatable: true,
    };
    expect(() =>
      registry.register(
        definition("shape.circle", {
          properties: [descriptor],
          animatable: [],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-animatable-list" }));

    expect(() =>
      registry.register(
        definition("shape.invalid", {
          defaultProps: { radius: -1 },
        }),
      ),
    ).toThrow(NodeTypeRegistrationError);
  });

  it("resolve tipo conhecido, props inválidos e tipo de plugin ausente sem perder dados", () => {
    const registry = createNodeTypeRegistry([definition("shape.circle")]);
    const base = rootNode();
    const valid: Node = { ...base, type: "shape.circle", props: { radius: 20 } };
    expect(registry.resolve(valid)).toMatchObject({
      status: "resolved",
      props: { radius: 20 },
    });

    const invalid: Node = { ...valid, props: { radius: -4 } };
    expect(registry.resolve(invalid).status).toBe("invalid-props");

    const opaqueProps = { pluginPayload: { future: true } };
    const unresolved: Node = { ...base, type: "plugin.future", props: opaqueProps };
    expect(registry.resolve(unresolved)).toMatchObject({
      status: "unresolved",
      type: "plugin.future",
      props: opaqueProps,
    });
  });

  it("rejeita children em tipo folha e aceita em estrutura", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const base = rootNode();
    const leaf: Node = {
      ...base,
      id: "nd_leaf",
      type: "text.title",
      props: registry.createDefaultProps("text.title"),
      children: ["nd_illegal"],
    };
    expect(registry.resolve(leaf)).toMatchObject({
      status: "children-not-supported",
      nodeId: "nd_leaf",
    });
    expect(registry.resolve(base).status).toBe("resolved");
  });

  it("explica tentativa de criar defaults de tipo ausente", () => {
    const registry = createNodeTypeRegistry();
    expect(() => registry.createDefaultProps("plugin.absent")).toThrowError(
      expect.objectContaining({ code: "invalid-type" }),
    );
  });
});
