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
  it("registra exatamente os treze tipos base em ordem explícita", () => {
    const registry = createBuiltinNodeTypeRegistry();
    expect(registry.size).toBe(13);
    expect(registry.list().map((item) => item.type)).toEqual(BUILTIN_NODE_TYPE_IDS);
    expect(BUILTIN_NODE_TYPES.map((item) => item.type)).toEqual(BUILTIN_NODE_TYPE_IDS);
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

  it("lista por categoria sem expor o array interno", () => {
    const registry = createBuiltinNodeTypeRegistry();
    expect(registry.list("unit").map((item) => item.type)).toEqual(["unit.armor", "unit.infantry"]);
    expect(registry.list("text").map((item) => item.type)).toEqual(["text.title", "text.label"]);
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
