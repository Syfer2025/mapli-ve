import {
  createBuiltinNodeTypeRegistry,
  type NodeTypeDefinition,
  type PropertyDescriptor,
} from "@theatrum/scene-graph";
import { createEmptyProjectDocument } from "@theatrum/schema";
import { describe, expect, it } from "vitest";
import {
  buildInspectorModel,
  controlNumberToStoredValue,
  readPath,
  storedNumberToControlValue,
  unitLabel,
} from "./inspector-model.js";

describe("inspector model", () => {
  it("gera grupos e campos exclusivamente a partir de PropertyDescriptor[]", () => {
    const node = createEmptyProjectDocument().compositions[0]!.nodes["nd_root"]!;
    node.props["radius"] = {
      value: 25,
      keyframes: [
        {
          id: "kf_radius",
          frame: 10,
          value: 50,
          in: { kind: "linear" },
          out: { kind: "linear" },
        },
      ],
      expression: null,
    };
    const definition = fakeDefinition("shape.circle", [
      descriptor("transform.opacity", "Opacidade", "number", "appearance", true),
      descriptor("props.radius", "Raio", "number", "content", true),
    ]);

    const model = buildInspectorModel(node, definition);

    expect(model.typeLabel).toBe("Círculo");
    expect(model.groups.map(({ id }) => id)).toEqual(["appearance", "content"]);
    expect(model.groups[1]?.properties[0]).toMatchObject({
      value: 25,
      animated: true,
      keyframeCount: 1,
      available: true,
    });
  });

  it("mostra o tipo novo do registro real sem uma linha de UI dedicada", () => {
    const registry = createBuiltinNodeTypeRegistry();
    const definition = registry.get("shape.circle");
    const node = createEmptyProjectDocument().compositions[0]!.nodes["nd_root"]!;
    node.type = "shape.circle";
    node.props = registry.createDefaultProps("shape.circle");

    const model = buildInspectorModel(node, definition);

    expect(model.typeLabel).toBe("Círculo");
    expect(model.groups.map(({ id }) => id)).toEqual([
      "layout",
      "transform",
      "appearance",
      "content",
    ]);
    expect(
      model.groups.flatMap(({ properties }) =>
        properties.map(({ descriptor, value, available }) => [
          descriptor.path,
          descriptor.label,
          available,
          value,
        ]),
      ),
    ).toEqual([
      ["anchor", "Âncora", true, node.anchor],
      ["size", "Tamanho", true, node.size],
      ["transform.position", "Posição", true, [0, 0]],
      ["transform.rotation", "Rotação", true, 0],
      ["transform.scale", "Escala", true, [1, 1]],
      ["transform.anchorPoint", "Ponto de ancoragem", true, [0, 0]],
      ["transform.skew", "Inclinação", true, [0, 0]],
      ["transform.opacity", "Opacidade", true, 1],
      ["props.fill", "Preenchimento", true, "#3b82f680"],
      ["props.stroke", "Traço", true, "#60a5faff"],
      ["props.strokeWidth", "Espessura", true, 2],
      ["props.radius", "Raio", true, 48],
    ]);
  });

  it("um tipo novo aparece sem ramificação de UI por node.type", () => {
    const node = createEmptyProjectDocument().compositions[0]!.nodes["nd_root"]!;
    node.type = "plugin.sentinel";
    node.props["caption"] = { value: "Novo", keyframes: [], expression: null };
    const definition = fakeDefinition("plugin.sentinel", [
      descriptor("props.caption", "Legenda do plugin", "text", "content", false),
    ]);

    const model = buildInspectorModel(node, definition);
    expect(model.groups[0]?.properties[0]?.descriptor.label).toBe("Legenda do plugin");
    expect(model.groups[0]?.properties[0]?.value).toBe("Novo");
  });

  it("converte percentuais e unidades sem perder o valor persistido", () => {
    const opacity = descriptor("transform.opacity", "Opacidade", "number", "appearance", true, {
      min: 0,
      max: 1,
      unit: "percent",
    });
    expect(storedNumberToControlValue(0.375, opacity)).toBe(37.5);
    expect(controlNumberToStoredValue(37.5, opacity)).toBe(0.375);
    expect(controlNumberToStoredValue(150, opacity)).toBe(1);
    expect(unitLabel(opacity)).toBe("%");
  });

  it("lê bindings não animáveis por path pontuado", () => {
    const node = createEmptyProjectDocument().compositions[0]!.nodes["nd_root"]!;
    expect(readPath(node, "anchor.space")).toBe("comp");
    expect(readPath(node, "props.missing")).toBeUndefined();
  });
});

function descriptor(
  path: string,
  label: string,
  kind: PropertyDescriptor["kind"],
  group: PropertyDescriptor["group"],
  animatable: boolean,
  extra: Partial<PropertyDescriptor> = {},
): PropertyDescriptor {
  return {
    path,
    label,
    kind,
    group,
    binding: "animatable",
    animatable,
    ...extra,
  };
}

function fakeDefinition(
  type: string,
  properties: readonly PropertyDescriptor[],
): NodeTypeDefinition {
  return {
    type,
    category: "shape",
    label: "Círculo",
    icon: "○",
    defaultProps: {},
    propertySchema: null as never,
    properties,
    animatable: properties.filter((property) => property.animatable),
    supportsChildren: false,
    defaultAnchorSpace: "comp",
    defaultSizeMode: "screen",
  };
}
