/**
 * Painel de Actions — um gesto de alto nível vira animação editável.
 *
 * O painel só enumera o registry e seus descriptors. Adicionar uma Action nova
 * ao catálogo não exige JSX: ela aparece no seletor, ganha campos, preview,
 * live/bake e undo pelo mesmo caminho das demais.
 */

import type { ActionExpansion, ActionParamDescriptor, ActionRegistry } from "@theatrum/behaviors";
import type { ActionInstanceData, Node } from "@theatrum/schema";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { actionTemplateRegistry, editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Panel } from "../../ui/index.js";
import "./ActionsPanel.css";

export interface ActionsPanelProps {
  readonly registry?: ActionRegistry;
}

export function ActionsPanel({ registry = actionTemplateRegistry }: ActionsPanelProps): ReactNode {
  const session = useEditorSession();
  const composition =
    session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    ) ?? session.document.compositions[0];
  const node =
    composition === undefined || session.selectedNodeId === null
      ? undefined
      : composition.nodes[session.selectedNodeId];
  const types = registry.list();
  const paths = Object.values(session.document.paths);
  const [pendingType, setPendingType] = useState(types[0] ?? "");
  const [pendingPath, setPendingPath] = useState(paths[0]?.id ?? "");

  useEffect(() => {
    if (pendingPath === "" && paths[0] !== undefined) setPendingPath(paths[0].id);
  }, [paths, pendingPath]);

  if (composition === undefined || node === undefined) {
    return (
      <Panel title="Ações">
        <div className="actions-panel__empty">
          <span>Nenhuma unidade selecionada</span>
          <small>Selecione uma unidade, modelo ou alvo no mapa.</small>
        </div>
      </Panel>
    );
  }

  const selectedType = types.includes(pendingType) ? pendingType : (types[0] ?? "");
  const selectedDefinition = registry.get(selectedType);
  const add = (): void => {
    if (selectedDefinition === undefined || pendingPath === "") return;
    const params = selectedDefinition.defaults({
      document: session.document,
      composition,
      owner: node,
      pathId: pendingPath,
    });
    editorActions.addAction(
      node.id,
      selectedType,
      structuredClone(params) as Record<string, unknown>,
    );
  };

  return (
    <Panel
      title="Ações"
      footer={
        <span>
          {node.name} · {node.actions.length} {node.actions.length === 1 ? "ação" : "ações"}
        </span>
      }
    >
      <div className="actions-panel">
        <div className="actions-panel__create">
          <label>
            <span>Ação</span>
            <select
              value={selectedType}
              aria-label="Tipo de ação"
              onChange={(event) => setPendingType(event.target.value)}
            >
              {types.map((type) => (
                <option key={type} value={type}>
                  {registry.get(type)?.label ?? type}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Caminho</span>
            <select
              value={pendingPath}
              aria-label="Caminho da ação"
              onChange={(event) => setPendingPath(event.target.value)}
            >
              {paths.length === 0 && <option value="">Trace um caminho primeiro</option>}
              {paths.map((path) => (
                <option key={path.id} value={path.id}>
                  {path.name}
                </option>
              ))}
            </select>
          </label>
          {selectedDefinition !== undefined && (
            <p className="actions-panel__description">{selectedDefinition.description}</p>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={add}
            disabled={selectedDefinition === undefined || pendingPath === ""}
          >
            Criar ação live
          </Button>
        </div>

        {node.actions.length === 0 && (
          <div className="actions-panel__empty-inline">
            <small>
              Uma ação live continua ajustável. “Converter em keyframes” materializa o resultado
              inteiro em uma única operação de histórico.
            </small>
          </div>
        )}

        {node.actions.map((action) => (
          <ActionCard
            key={action.id}
            action={action}
            node={node}
            registry={registry}
            paths={paths}
            composition={composition}
            document={session.document}
          />
        ))}
      </div>
    </Panel>
  );
}

function ActionCard({
  action,
  node,
  registry,
  paths,
  composition,
  document,
}: {
  readonly action: ActionInstanceData;
  readonly node: Node;
  readonly registry: ActionRegistry;
  readonly paths: readonly { readonly id: string; readonly name: string }[];
  readonly composition: Parameters<ActionRegistry["resolve"]>[2];
  readonly document: Parameters<ActionRegistry["resolve"]>[3];
}): ReactNode {
  const definition = registry.get(action.type);
  const resolution = useMemo(
    () => registry.resolve(action, node, composition, document),
    [action, composition, document, node, registry],
  );
  const expansion = resolution.status === "expanded" ? resolution.expansion : undefined;
  const warning =
    resolution.status === "invalid-params"
      ? resolution.message
      : resolution.status === "unknown-type"
        ? `Ação não registrada: ${resolution.type}`
        : expansion?.diagnostics[0]?.message;

  const updateParam = (key: string, value: unknown): void => {
    editorActions.setActionParams(node.id, action.id, { ...action.params, [key]: value });
  };

  return (
    <section className="actions-panel__card" data-disabled={action.enabled ? undefined : true}>
      <header className="actions-panel__card-header">
        <input
          type="checkbox"
          checked={action.enabled}
          aria-label={`Ativar ${definition?.label ?? action.type}`}
          onChange={(event) =>
            editorActions.setActionEnabled(node.id, action.id, event.target.checked)
          }
        />
        <div>
          <strong>{definition?.label ?? action.type}</strong>
          <small>frame {action.startFrame} · live</small>
        </div>
        <Button
          size="sm"
          iconOnly
          aria-label={`Remover ${definition?.label ?? action.type}`}
          onClick={() => editorActions.removeAction(node.id, action.id)}
        >
          ×
        </Button>
      </header>

      {definition?.params.map((descriptor) => (
        <ActionField
          key={descriptor.key}
          descriptor={descriptor}
          value={action.params[descriptor.key]}
          paths={paths}
          onCommit={(value) => updateParam(descriptor.key, value)}
        />
      ))}

      {warning !== undefined && <div className="actions-panel__warning">{warning}</div>}
      {expansion !== undefined && expansion.diagnostics.length === 0 && (
        <ActionPreview expansion={expansion} fps={composition.fps} />
      )}

      <Button
        size="sm"
        variant="primary"
        disabled={definition === undefined || warning !== undefined}
        onClick={() => editorActions.bakeAction(node.id, action.id)}
      >
        Converter em keyframes
      </Button>
    </section>
  );
}

function ActionPreview({
  expansion,
  fps,
}: {
  readonly expansion: ActionExpansion;
  readonly fps: number;
}): ReactNode {
  const keyframes =
    expansion.keyframes.length +
    expansion.nodes.reduce((sum, node) => sum + countKeyframes(node), 0) +
    expansion.behaviors.reduce(
      (sum, placement) => sum + countKeyframes(placement.behavior.params),
      0,
    );
  const seconds = expansion.durationFrames / fps;
  return (
    <dl className="actions-panel__preview">
      <div>
        <dt>Duração</dt>
        <dd>
          {expansion.durationFrames} f · {seconds.toFixed(seconds < 10 ? 1 : 0)} s
        </dd>
      </div>
      <div>
        <dt>Expansão</dt>
        <dd>
          {expansion.nodes.length} nós · {keyframes} keyframes
        </dd>
      </div>
    </dl>
  );
}

function ActionField({
  descriptor,
  value,
  paths,
  onCommit,
}: {
  readonly descriptor: ActionParamDescriptor;
  readonly value: unknown;
  readonly paths: readonly { readonly id: string; readonly name: string }[];
  readonly onCommit: (value: unknown) => void;
}): ReactNode {
  if (descriptor.kind === "path") {
    return (
      <label className="actions-panel__field">
        <span>{descriptor.label}</span>
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onCommit(event.target.value)}
        >
          {paths.map((path) => (
            <option key={path.id} value={path.id}>
              {path.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (descriptor.kind === "boolean") {
    return (
      <label className="actions-panel__field actions-panel__field--check">
        <span>{descriptor.label}</span>
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onCommit(event.target.checked)}
        />
      </label>
    );
  }
  if (descriptor.kind === "color") {
    const stored = typeof value === "string" && /^#[\da-f]{8}$/i.test(value) ? value : "#ffffffff";
    return (
      <label className="actions-panel__field">
        <span>{descriptor.label}</span>
        <span className="actions-panel__color">
          <input
            type="color"
            value={stored.slice(0, 7)}
            onChange={(event) => onCommit(`${event.target.value.toLowerCase()}ff`)}
          />
          <code>{stored}</code>
        </span>
      </label>
    );
  }
  return (
    <NumberField
      descriptor={descriptor}
      value={typeof value === "number" ? value : 0}
      onCommit={onCommit}
    />
  );
}

function NumberField({
  descriptor,
  value,
  onCommit,
}: {
  readonly descriptor: ActionParamDescriptor;
  readonly value: number;
  readonly onCommit: (value: number) => void;
}): ReactNode {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const rounded =
      descriptor.unit === "frames" || descriptor.unit === "count" ? Math.round(parsed) : parsed;
    onCommit(
      Math.max(
        descriptor.min ?? Number.NEGATIVE_INFINITY,
        Math.min(descriptor.max ?? Number.POSITIVE_INFINITY, rounded),
      ),
    );
  };
  return (
    <label className="actions-panel__field">
      <span>{descriptor.label}</span>
      <span className="actions-panel__number">
        <input
          type="number"
          value={draft}
          min={descriptor.min}
          max={descriptor.max}
          step={descriptor.step ?? 1}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {descriptor.unit !== undefined && <small>{descriptor.unit}</small>}
      </span>
    </label>
  );
}

function countKeyframes(value: unknown, visited = new Set<object>()): number {
  if (typeof value !== "object" || value === null || visited.has(value)) return 0;
  visited.add(value);
  if ("keyframes" in value && Array.isArray(Reflect.get(value, "keyframes"))) {
    return (Reflect.get(value, "keyframes") as unknown[]).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, child) => sum + countKeyframes(child, visited), 0);
  }
  return Object.values(value).reduce((sum, child) => sum + countKeyframes(child, visited), 0);
}
