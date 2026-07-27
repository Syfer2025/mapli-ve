import {
  createBuiltinNodeTypeRegistry,
  type NodeTypeRegistry,
  type PropertyDescriptor,
  type PropertyKind,
} from "@theatrum/scene-graph";
import type { Anchor, AssetDescriptor, Node, SizeSpec } from "@theatrum/schema";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Field, FieldGroup, NumberDrag, Panel } from "../../ui/index.js";
import { readAnimatableProperty } from "../timeline/timeline-model.js";
import {
  buildInspectorModel,
  controlNumberToStoredValue,
  storedNumberToControlValue,
  unitLabel,
  type InspectorProperty,
} from "./inspector-model.js";
import "./InspectorPanel.css";

const BUILTIN_REGISTRY = createBuiltinNodeTypeRegistry();

export interface InspectorPanelProps {
  readonly registry?: NodeTypeRegistry;
}

interface PropertyControlProps {
  readonly property: InspectorProperty;
  readonly assets: readonly AssetDescriptor[];
  readonly onCommit: (value: unknown) => void;
}

type PropertyControl = (props: PropertyControlProps) => ReactNode;

export function InspectorPanel({ registry = BUILTIN_REGISTRY }: InspectorPanelProps): ReactNode {
  const session = useEditorSession();
  const composition =
    session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    ) ?? session.document.compositions[0];
  const node =
    composition === undefined || session.selectedNodeId === null
      ? undefined
      : composition.nodes[session.selectedNodeId];
  const definition = node === undefined ? undefined : registry.get(node.type);
  const model = useMemo(
    () => (node === undefined ? null : buildInspectorModel(node, definition)),
    [definition, node],
  );

  if (composition === undefined || node === undefined || model === null) {
    return (
      <Panel title="Inspector">
        <div className="inspector-panel__empty">
          <span>Nenhum objeto selecionado</span>
          <small>Selecione uma camada no mapa, projeto ou timeline.</small>
        </div>
      </Panel>
    );
  }

  const commitProperty = (property: InspectorProperty, value: unknown): void => {
    const descriptor = property.descriptor;
    if (descriptor.binding === "animatable") {
      editorActions.setPropertyValue(node.id, descriptor.path, value);
      return;
    }
    if (descriptor.binding === "anchor" && isAnchor(value)) {
      editorActions.setNodeAnchor(node.id, value);
      return;
    }
    if (descriptor.binding === "size" && isSizeSpec(value)) {
      editorActions.setNodeSize(node.id, value);
    }
  };

  const toggleKeyframe = (property: InspectorProperty): void => {
    const descriptor = property.descriptor;
    if (descriptor.binding !== "animatable" || !descriptor.animatable) return;
    editorActions.togglePropertyKeyframe(node.id, descriptor.path);
  };

  return (
    <Panel
      title="Inspector"
      footer={
        <span>
          {session.selectedNodeIds.length > 1
            ? `${session.selectedNodeIds.length} objetos · editando ${node.name}`
            : `${model.typeLabel} · ${node.id}`}
        </span>
      }
    >
      <div className="inspector-panel">
        <header className="inspector-panel__identity">
          <span className="inspector-panel__icon" aria-hidden="true">
            {definition?.icon ?? "?"}
          </span>
          <span>
            <strong>{node.name}</strong>
            <small>{model.typeLabel}</small>
          </span>
        </header>

        <NodeFlags node={node} compositionId={composition.id} />

        {definition === undefined && (
          <div className="inspector-panel__warning">
            Tipo não registrado: <code>{node.type}</code>. Os dados foram preservados.
          </div>
        )}

        {model.groups.map((group) => (
          <FieldGroup key={group.id} title={group.label}>
            {group.properties.map((property) => {
              const Control = PROPERTY_CONTROLS[property.descriptor.kind];
              const unit = unitLabel(property.descriptor);
              return (
                <Field
                  key={property.descriptor.path}
                  label={property.descriptor.label}
                  animated={property.animated}
                  disabled={!property.available}
                  {...(unit === undefined ? {} : { unit })}
                >
                  {() => (
                    <>
                      <Control
                        property={property}
                        assets={session.document.assets}
                        onCommit={(value) => commitProperty(property, value)}
                      />
                      {property.descriptor.binding === "animatable" &&
                        property.descriptor.animatable && (
                          <Button
                            size="sm"
                            iconOnly
                            aria-label={
                              hasKeyframeAt(node, property.descriptor, session.playheadFrame)
                                ? "Remover keyframe neste frame"
                                : "Adicionar keyframe neste frame"
                            }
                            title={`${property.keyframeCount} keyframes`}
                            data-keyframed={
                              hasKeyframeAt(node, property.descriptor, session.playheadFrame) ||
                              undefined
                            }
                            onClick={() => toggleKeyframe(property)}
                          >
                            ◆
                          </Button>
                        )}
                    </>
                  )}
                </Field>
              );
            })}
          </FieldGroup>
        ))}
      </div>
    </Panel>
  );
}

function NodeFlags({
  node,
  compositionId,
}: {
  readonly node: Node;
  readonly compositionId: string;
}): ReactNode {
  const flag = (name: "enabled" | "locked" | "solo", value: boolean, label: string): ReactNode => (
    <label className="inspector-panel__flag">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) =>
          editorActions.dispatch({
            type: "node.set-flags",
            source: "user",
            payload: {
              compositionId,
              nodeId: node.id,
              flags: { [name]: event.target.checked },
            },
          })
        }
      />
      {label}
    </label>
  );
  return (
    <div className="inspector-panel__flags">
      {flag("enabled", node.enabled, "Visível")}
      {flag("locked", node.locked, "Bloqueado")}
      {flag("solo", node.solo, "Solo")}
    </div>
  );
}

const PROPERTY_CONTROLS: Readonly<Record<PropertyKind, PropertyControl>> = Object.freeze({
  number: NumberPropertyControl,
  vec2: Vec2PropertyControl,
  text: TextPropertyControl,
  "multiline-text": MultilineTextPropertyControl,
  color: ColorPropertyControl,
  boolean: BooleanPropertyControl,
  enum: EnumPropertyControl,
  asset: AssetPropertyControl,
  anchor: AnchorPropertyControl,
  size: SizePropertyControl,
  points: PointsPropertyControl,
});

function NumberPropertyControl({ property, onCommit }: PropertyControlProps): ReactNode {
  const descriptor = property.descriptor;
  const source = typeof property.value === "number" ? property.value : 0;
  const value = storedNumberToControlValue(source, descriptor);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const minimum = scaledBound(descriptor.min, descriptor);
  const maximum = scaledBound(descriptor.max, descriptor);
  const step = scaledBound(descriptor.step, descriptor) ?? 1;
  return (
    <NumberDrag
      value={draft}
      onChange={setDraft}
      onCommit={(next) => onCommit(controlNumberToStoredValue(next, descriptor))}
      step={step}
      precision={step < 0.1 ? 3 : step < 1 ? 2 : 1}
      {...(minimum === undefined ? {} : { min: minimum })}
      {...(maximum === undefined ? {} : { max: maximum })}
      disabled={!property.available}
      ariaLabel={descriptor.label}
    />
  );
}

function Vec2PropertyControl({ property, onCommit }: PropertyControlProps): ReactNode {
  const descriptor = property.descriptor;
  const source: readonly [number, number] = isVec2(property.value) ? property.value : [0, 0];
  const [draft, setDraft] = useState<readonly [number, number]>(source);
  useEffect(() => setDraft(source), [source[0], source[1]]);
  const commitAxis = (axis: 0 | 1, value: number): void => {
    const next: readonly [number, number] = axis === 0 ? [value, draft[1]] : [draft[0], value];
    setDraft(next);
    onCommit(next);
  };
  return (
    <span className="inspector-panel__vec2">
      <span>X</span>
      <NumberDrag
        value={draft[0]}
        onChange={(value) => setDraft([value, draft[1]])}
        onCommit={(value) => commitAxis(0, value)}
        step={descriptor.step ?? 0.1}
        {...(descriptor.min === undefined ? {} : { min: descriptor.min })}
        {...(descriptor.max === undefined ? {} : { max: descriptor.max })}
        ariaLabel={`${descriptor.label} X`}
      />
      <span>Y</span>
      <NumberDrag
        value={draft[1]}
        onChange={(value) => setDraft([draft[0], value])}
        onCommit={(value) => commitAxis(1, value)}
        step={descriptor.step ?? 0.1}
        {...(descriptor.min === undefined ? {} : { min: descriptor.min })}
        {...(descriptor.max === undefined ? {} : { max: descriptor.max })}
        ariaLabel={`${descriptor.label} Y`}
      />
    </span>
  );
}

function TextPropertyControl(props: PropertyControlProps): ReactNode {
  return <TextControl {...props} multiline={false} />;
}

function MultilineTextPropertyControl(props: PropertyControlProps): ReactNode {
  return <TextControl {...props} multiline />;
}

function TextControl({
  property,
  onCommit,
  multiline,
}: PropertyControlProps & { readonly multiline: boolean }): ReactNode {
  const source = typeof property.value === "string" ? property.value : "";
  const [draft, setDraft] = useState(source);
  useEffect(() => setDraft(source), [source]);
  const common = {
    value: draft,
    disabled: !property.available,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(event.target.value),
    onBlur: () => onCommit(draft),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!multiline && event.key === "Enter") onCommit(draft);
    },
  };
  return multiline ? (
    <textarea className="inspector-panel__textarea" rows={3} {...common} />
  ) : (
    <input className="inspector-panel__input" type="text" {...common} />
  );
}

function ColorPropertyControl({ property, onCommit }: PropertyControlProps): ReactNode {
  const value = typeof property.value === "string" ? property.value : "#000000";
  return (
    <span className="inspector-panel__color">
      <input
        type="color"
        value={normalizeColorInput(value)}
        disabled={!property.available}
        aria-label={property.descriptor.label}
        onChange={(event) => onCommit(event.target.value.toLowerCase())}
      />
      <code>{value}</code>
    </span>
  );
}

function BooleanPropertyControl({ property, onCommit }: PropertyControlProps): ReactNode {
  return (
    <input
      type="checkbox"
      checked={property.value === true}
      disabled={!property.available}
      aria-label={property.descriptor.label}
      onChange={(event) => onCommit(event.target.checked)}
    />
  );
}

function EnumPropertyControl({ property, onCommit }: PropertyControlProps): ReactNode {
  return (
    <select
      className="inspector-panel__select"
      value={typeof property.value === "string" ? property.value : ""}
      disabled={!property.available}
      aria-label={property.descriptor.label}
      onChange={(event) => onCommit(event.target.value)}
    >
      {(property.descriptor.options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function AssetPropertyControl({ property, assets, onCommit }: PropertyControlProps): ReactNode {
  return (
    <select
      className="inspector-panel__select"
      value={typeof property.value === "string" ? property.value : ""}
      disabled={!property.available}
      aria-label={property.descriptor.label}
      onChange={(event) => onCommit(event.target.value)}
    >
      <option value="">Nenhum</option>
      {assets.map((asset) => (
        <option key={asset.id} value={asset.id}>
          {asset.id} · {asset.kind}
        </option>
      ))}
    </select>
  );
}

function AnchorPropertyControl({ property, onCommit }: PropertyControlProps): ReactNode {
  const anchor = isAnchor(property.value)
    ? property.value
    : ({ space: "comp", position: [0, 0] } satisfies Anchor);
  const setSpace = (space: Anchor["space"]): void => {
    if (space === "geo") onCommit({ space, lngLat: [0, 0] });
    else if (space === "parent") onCommit({ space, offset: [0, 0] });
    else onCommit({ space, position: [0, 0] });
  };
  const points =
    anchor.space === "geo"
      ? anchor.lngLat
      : anchor.space === "parent"
        ? anchor.offset
        : anchor.position;
  return (
    <span className="inspector-panel__compound">
      <select
        className="inspector-panel__select"
        value={anchor.space}
        onChange={(event) => setSpace(event.target.value as Anchor["space"])}
      >
        <option value="geo">Geo</option>
        <option value="comp">Composição</option>
        <option value="parent">Pai</option>
      </select>
      <CompactNumber
        label={anchor.space === "geo" ? "Longitude" : "X"}
        value={points[0]}
        onCommit={(value) => onCommit(updateAnchorPoint(anchor, 0, value))}
      />
      <CompactNumber
        label={anchor.space === "geo" ? "Latitude" : "Y"}
        value={points[1]}
        onCommit={(value) => onCommit(updateAnchorPoint(anchor, 1, value))}
      />
    </span>
  );
}

function SizePropertyControl({ property, onCommit }: PropertyControlProps): ReactNode {
  const size = isSizeSpec(property.value)
    ? property.value
    : ({ mode: "screen", size: [100, 100] } satisfies SizeSpec);
  const values = size.mode === "screen" ? size.size : size.meters;
  return (
    <span className="inspector-panel__compound">
      <select
        className="inspector-panel__select"
        value={size.mode}
        onChange={(event) =>
          onCommit(
            event.target.value === "ground"
              ? { mode: "ground", meters: values }
              : { mode: "screen", size: values },
          )
        }
      >
        <option value="screen">Tela</option>
        <option value="ground">Terreno</option>
      </select>
      <CompactNumber
        label="Largura"
        value={values[0]}
        min={0}
        onCommit={(value) =>
          onCommit(
            size.mode === "screen"
              ? { ...size, size: [value, values[1]] }
              : { ...size, meters: [value, values[1]] },
          )
        }
      />
      <CompactNumber
        label="Altura"
        value={values[1]}
        min={0}
        onCommit={(value) =>
          onCommit(
            size.mode === "screen"
              ? { ...size, size: [values[0], value] }
              : { ...size, meters: [values[0], value] },
          )
        }
      />
    </span>
  );
}

function PointsPropertyControl({ property }: PropertyControlProps): ReactNode {
  const count = Array.isArray(property.value) ? property.value.length : 0;
  return <span className="inspector-panel__readonly">{count} pontos · edite no viewport</span>;
}

function CompactNumber({
  label,
  value,
  min,
  onCommit,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly onCommit: (value: number) => void;
}): ReactNode {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <NumberDrag
      value={draft}
      onChange={setDraft}
      onCommit={onCommit}
      step={0.1}
      {...(min === undefined ? {} : { min })}
      ariaLabel={label}
    />
  );
}

function hasKeyframeAt(node: Node, descriptor: PropertyDescriptor, at: number): boolean {
  return (
    readAnimatableProperty(node, descriptor.path)?.keyframes.some(
      (keyframe) => keyframe.frame === at,
    ) ?? false
  );
}

function scaledBound(
  value: number | undefined,
  descriptor: PropertyDescriptor,
): number | undefined {
  if (value === undefined) return undefined;
  return descriptor.unit === "percent" ? value * 100 : value;
}

function normalizeColorInput(value: string): string {
  return /^#[\da-f]{6}$/i.test(value) ? value : "#000000";
}

function isVec2(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== "object" || value === null || !("space" in value)) return false;
  const space = Reflect.get(value, "space");
  return space === "geo" || space === "comp" || space === "parent";
}

function isSizeSpec(value: unknown): value is SizeSpec {
  if (typeof value !== "object" || value === null || !("mode" in value)) return false;
  const mode = Reflect.get(value, "mode");
  return mode === "screen" || mode === "ground";
}

function updateAnchorPoint(anchor: Anchor, axis: 0 | 1, value: number): Anchor {
  if (anchor.space === "geo") {
    const lngLat: [number, number] = [...anchor.lngLat];
    lngLat[axis] = value;
    return { ...anchor, lngLat };
  }
  if (anchor.space === "parent") {
    const offset: [number, number] = [...anchor.offset];
    offset[axis] = value;
    return { ...anchor, offset };
  }
  const position: [number, number] = [...anchor.position];
  position[axis] = value;
  return { ...anchor, position };
}
