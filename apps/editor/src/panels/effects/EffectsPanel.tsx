/**
 * Painel de efeitos — a pilha do nó selecionado.
 *
 * Efeito vive no nó, então o painel é uma lista ordenada de instâncias com
 * parâmetros gerados dos `PropertyDescriptor[]` da definição — o mesmo contrato
 * do Inspector, sem código de UI por tipo de efeito. Um efeito novo no registry
 * aparece aqui sozinho: no menu de adicionar, com seus parâmetros e seus
 * presets.
 *
 * Parâmetro de efeito é propriedade animável comum: o caminho
 * `effects.<índice>.params.<nome>` atravessa o mesmo `property.set` e os mesmos
 * keyframes de qualquer outra propriedade do nó.
 */

import { presetsFor, type EffectPreset, type EffectRegistry } from "@theatrum/effects";
import type { PropertyDescriptor } from "@theatrum/scene-graph";
import type { EffectInstanceData, Node } from "@theatrum/schema";
import { useEffect, useState, type ReactNode } from "react";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { editorEffectRegistry } from "../../plugins/editor-plugin-runtime.js";
import { Button, Field, NumberDrag, Panel } from "../../ui/index.js";
import {
  controlNumberToStoredValue,
  storedNumberToControlValue,
  unitLabel,
} from "../inspector/inspector-model.js";
import { readAnimatableProperty } from "../timeline/timeline-model.js";
import "./EffectsPanel.css";

export interface EffectsPanelProps {
  readonly registry?: EffectRegistry;
}

export function EffectsPanel({ registry = editorEffectRegistry }: EffectsPanelProps): ReactNode {
  const session = useEditorSession();
  const composition =
    session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    ) ?? session.document.compositions[0];
  const node =
    composition === undefined || session.selectedNodeId === null
      ? undefined
      : composition.nodes[session.selectedNodeId];
  const [pendingType, setPendingType] = useState(registry.list()[0] ?? "");

  if (composition === undefined || node === undefined) {
    return (
      <Panel title="Efeitos">
        <div className="effects-panel__empty">
          <span>Nenhum objeto selecionado</span>
          <small>Selecione uma camada no mapa, projeto ou timeline.</small>
        </div>
      </Panel>
    );
  }

  const types = registry.list();
  const selectedType = types.includes(pendingType) ? pendingType : (types[0] ?? "");

  const addEffect = (): void => {
    const definition = registry.get(selectedType);
    if (definition === undefined) return;
    editorActions.addEffect(node.id, selectedType, structuredClone(definition.defaultParams));
  };

  return (
    <Panel
      title="Efeitos"
      footer={
        <span>
          {node.effects.length === 0
            ? node.name
            : `${node.name} · ${node.effects.length} ${node.effects.length === 1 ? "efeito" : "efeitos"}`}
        </span>
      }
    >
      <div className="effects-panel">
        <div className="effects-panel__add">
          <select
            className="effects-panel__select"
            value={selectedType}
            aria-label="Tipo de efeito"
            onChange={(event) => setPendingType(event.target.value)}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {registry.get(type)?.label ?? type}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" onClick={addEffect} disabled={selectedType === ""}>
            Adicionar
          </Button>
        </div>

        {node.effects.length === 0 && (
          <div className="effects-panel__empty-inline">
            <small>
              Nenhum efeito na pilha. Emissores desenham partículas; filtros processam a imagem do
              próprio objeto, na ordem da pilha.
            </small>
          </div>
        )}

        {node.effects.map((effect, index) => (
          <EffectCard
            key={effect.id}
            node={node}
            effect={effect}
            index={index}
            registry={registry}
            playheadFrame={session.playheadFrame}
          />
        ))}
      </div>
    </Panel>
  );
}

function EffectCard({
  node,
  effect,
  index,
  registry,
  playheadFrame,
}: {
  readonly node: Node;
  readonly effect: EffectInstanceData;
  readonly index: number;
  readonly registry: EffectRegistry;
  readonly playheadFrame: number;
}): ReactNode {
  const definition = registry.get(effect.type);
  const presets = presetsFor(effect.type);

  const applyPreset = (preset: EffectPreset): void => {
    // Preset troca só o `value`: keyframes de outros parâmetros sobrevivem, e a
    // substituição inteira de params faz do preset um único comando — um Ctrl+Z.
    const params: Record<string, unknown> = { ...effect.params };
    for (const [key, value] of Object.entries(preset.values)) {
      params[key] = { value, keyframes: [], expression: null };
    }
    editorActions.setEffectParams(node.id, effect.id, params);
  };

  return (
    <section className="effects-panel__card" data-disabled={effect.enabled ? undefined : true}>
      <header className="effects-panel__card-header">
        <input
          type="checkbox"
          checked={effect.enabled}
          aria-label={`Ativar ${definition?.label ?? effect.type}`}
          title={effect.enabled ? "Desativar" : "Ativar"}
          onChange={(event) =>
            editorActions.setEffectEnabled(node.id, effect.id, event.target.checked)
          }
        />
        <strong>{definition?.label ?? effect.type}</strong>
        {presets.length > 0 && (
          <select
            className="effects-panel__select effects-panel__select--preset"
            value=""
            aria-label="Aplicar preset"
            onChange={(event) => {
              const preset = presets.find((candidate) => candidate.id === event.target.value);
              if (preset !== undefined) applyPreset(preset);
            }}
          >
            <option value="">Preset…</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          iconOnly
          aria-label={`Remover ${definition?.label ?? effect.type}`}
          onClick={() => editorActions.removeEffect(node.id, effect.id)}
        >
          ×
        </Button>
      </header>

      {definition === undefined && (
        <div className="effects-panel__warning">
          Efeito não registrado: <code>{effect.type}</code>. Os dados foram preservados.
        </div>
      )}

      {definition?.properties.map((descriptor) => (
        <EffectParamField
          key={descriptor.path}
          node={node}
          index={index}
          descriptor={descriptor}
          playheadFrame={playheadFrame}
        />
      ))}
    </section>
  );
}

function EffectParamField({
  node,
  index,
  descriptor,
  playheadFrame,
}: {
  readonly node: Node;
  readonly index: number;
  readonly descriptor: PropertyDescriptor;
  readonly playheadFrame: number;
}): ReactNode {
  // O descriptor diz `params.count`; o caminho real atravessa a pilha do nó.
  const path = `effects.${index}.${descriptor.path}`;
  const property =
    descriptor.binding === "animatable" ? readAnimatableProperty(node, path) : undefined;
  const unit = unitLabel(descriptor);
  const keyframed =
    property?.keyframes.some((keyframe) => keyframe.frame === playheadFrame) ?? false;

  const commit = (value: unknown): void => {
    editorActions.setPropertyValue(node.id, path, value);
  };

  return (
    <Field
      label={descriptor.label}
      animated={(property?.keyframes.length ?? 0) > 0}
      {...(unit === undefined ? {} : { unit })}
    >
      {() => (
        <>
          {descriptor.kind === "color" ? (
            <ColorParam value={property?.value} label={descriptor.label} onCommit={commit} />
          ) : (
            <NumberParam value={property?.value} descriptor={descriptor} onCommit={commit} />
          )}
          {descriptor.binding === "animatable" && descriptor.animatable && (
            <Button
              size="sm"
              iconOnly
              aria-label={
                keyframed ? "Remover keyframe neste frame" : "Adicionar keyframe neste frame"
              }
              title={`${property?.keyframes.length ?? 0} keyframes`}
              data-keyframed={keyframed || undefined}
              onClick={() => editorActions.togglePropertyKeyframe(node.id, path)}
            >
              ◆
            </Button>
          )}
        </>
      )}
    </Field>
  );
}

function NumberParam({
  value,
  descriptor,
  onCommit,
}: {
  readonly value: unknown;
  readonly descriptor: PropertyDescriptor;
  readonly onCommit: (value: number) => void;
}): ReactNode {
  const source = typeof value === "number" ? value : 0;
  const control = storedNumberToControlValue(source, descriptor);
  const [draft, setDraft] = useState(control);
  useEffect(() => setDraft(control), [control]);
  const step = descriptor.step ?? 1;
  return (
    <NumberDrag
      value={draft}
      onChange={setDraft}
      onCommit={(next) => onCommit(controlNumberToStoredValue(next, descriptor))}
      step={step}
      precision={step < 0.1 ? 3 : step < 1 ? 2 : 1}
      {...(descriptor.min === undefined ? {} : { min: descriptor.min })}
      {...(descriptor.max === undefined ? {} : { max: descriptor.max })}
      ariaLabel={descriptor.label}
    />
  );
}

function ColorParam({
  value,
  label,
  onCommit,
}: {
  readonly value: unknown;
  readonly label: string;
  readonly onCommit: (value: string) => void;
}): ReactNode {
  // O documento guarda `#rrggbbaa`; o controle nativo só entende `#rrggbb`.
  const stored = typeof value === "string" ? value : "#ffffffff";
  const shown = stored.startsWith("#") ? stored.slice(0, 7) : "#ffffff";
  return (
    <span className="effects-panel__color">
      <input
        type="color"
        value={/^#[\da-f]{6}$/i.test(shown) ? shown : "#ffffff"}
        aria-label={label}
        onChange={(event) => onCommit(`${event.target.value.toLowerCase()}ff`)}
      />
      <code>{stored}</code>
    </span>
  );
}
