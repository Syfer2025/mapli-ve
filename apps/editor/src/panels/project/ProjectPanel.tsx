import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { NodeCategory, NodeTypeDefinition } from "@theatrum/scene-graph";
import type { Composition } from "@theatrum/schema";
import { createUnresolvedNodePlaceholder } from "@theatrum/plugin-host";
import { editorActions, nodeTypeRegistry } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Panel } from "../../ui/index.js";
import "./ProjectPanel.css";

const CATEGORY_LABELS: Readonly<Record<NodeCategory, string>> = Object.freeze({
  structure: "Estrutura",
  text: "Texto",
  media: "Mídia",
  shape: "Formas",
  geo: "Geografia",
  unit: "Unidades",
  symbol: "Símbolos",
  "effect-emitter": "Efeitos",
});

export function ProjectPanel(): ReactNode {
  const session = useEditorSession();
  const composition = useMemo(
    () =>
      session.document.compositions.find((item) => item.id === session.selectedCompositionId) ??
      session.document.compositions[0],
    [session.document, session.selectedCompositionId],
  );
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly value: string } | null>(
    null,
  );
  const addMenuRef = useRef<HTMLDetailsElement>(null);

  const selected =
    composition === undefined || session.selectedNodeId === null
      ? undefined
      : composition.nodes[session.selectedNodeId];

  const commitRename = (): void => {
    if (renaming === null) return;
    const name = renaming.value.trim();
    if (name.length > 0) editorActions.renameNode(renaming.id, name);
    setRenaming(null);
  };

  return (
    <Panel
      title="Documento"
      toolbar={
        <>
          <details className="project-tree__add" ref={addMenuRef}>
            <summary aria-label="Adicionar objeto" title="Adicionar objeto">
              +
            </summary>
            <NodeTypeMenu
              onPick={(type) => {
                editorActions.addNodeOfType(type);
                if (addMenuRef.current !== null) addMenuRef.current.open = false;
              }}
            />
          </details>
          <Button
            size="sm"
            iconOnly
            aria-label="Renomear item"
            title="Renomear item"
            disabled={selected === undefined}
            onClick={() => {
              if (selected !== undefined) setRenaming({ id: selected.id, value: selected.name });
            }}
          >
            ✎
          </Button>
          <Button
            size="sm"
            iconOnly
            variant="danger"
            aria-label="Excluir item"
            title="Excluir item"
            disabled={selected === undefined || selected.id === composition?.root}
            onClick={() => {
              if (selected !== undefined) editorActions.deleteNode(selected.id);
            }}
          >
            ×
          </Button>
        </>
      }
      footer={
        <span>
          {session.document.compositions.length} comp ·{" "}
          {composition === undefined ? 0 : Object.keys(composition.nodes).length} nós ·{" "}
          {session.document.assets.length} assets
        </span>
      }
    >
      <div className="project-tree" role="tree" aria-label="Estrutura do projeto">
        <TreeSection label="Composições" count={session.document.compositions.length}>
          {session.document.compositions.map((item) => (
            <button
              type="button"
              className="project-tree__composition"
              data-selected={item.id === session.selectedCompositionId || undefined}
              key={item.id}
              onClick={() => editorActions.selectComposition(item.id)}
            >
              <span className="project-tree__disclosure">▾</span>
              <span className="project-tree__icon">◆</span>
              <span className="project-tree__name">{item.name}</span>
              <span className="project-tree__meta">
                {item.width}×{item.height}
              </span>
            </button>
          ))}
          {composition !== undefined && (
            <NodeBranch
              composition={composition}
              nodeId={composition.root}
              depth={1}
              selectedIds={session.selectedNodeIds}
              renaming={renaming}
              setRenaming={setRenaming}
              commitRename={commitRename}
            />
          )}
        </TreeSection>

        <TreeSection label="Assets" count={session.document.assets.length}>
          {session.document.assets.length === 0 ? (
            <div className="project-tree__empty">Nenhum asset incorporado</div>
          ) : (
            session.document.assets.map((asset) => (
              <div className="project-tree__asset" key={asset.id}>
                <span className="project-tree__icon">▧</span>
                <span className="project-tree__name">{asset.id}</span>
                <span className="project-tree__meta">{asset.kind}</span>
              </div>
            ))
          )}
        </TreeSection>
      </div>
    </Panel>
  );
}

/**
 * Gerado inteiramente do registry de tipos: um tipo novo aparece aqui sem
 * nenhuma linha nova de UI. Ver critério 5 da Fase 4 em docs/08-ROADMAP.md.
 */
function NodeTypeMenu({ onPick }: { readonly onPick: (type: string) => void }): ReactNode {
  const categories = useMemo(() => {
    const grouped = new Map<NodeCategory, NodeTypeDefinition[]>();
    for (const definition of nodeTypeRegistry.list()) {
      const bucket = grouped.get(definition.category);
      if (bucket === undefined) grouped.set(definition.category, [definition]);
      else bucket.push(definition);
    }
    return [...grouped];
  }, []);

  return (
    <div className="project-tree__add-menu" role="menu" aria-label="Tipos de objeto">
      {categories.map(([category, definitions]) => (
        <div className="project-tree__add-group" key={category}>
          <span className="project-tree__add-category">{CATEGORY_LABELS[category]}</span>
          {definitions.map((definition) => (
            <button
              type="button"
              role="menuitem"
              className="project-tree__add-item"
              data-node-type={definition.type}
              key={definition.type}
              onClick={() => onPick(definition.type)}
            >
              <span className="project-tree__name">{definition.label}</span>
              <span className="project-tree__meta">{definition.type}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function TreeSection({
  label,
  count,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="project-tree__section">
      <header className="project-tree__section-header">
        <span>{label}</span>
        <span>{count}</span>
      </header>
      {children}
    </section>
  );
}

function NodeBranch({
  composition,
  nodeId,
  depth,
  selectedIds,
  renaming,
  setRenaming,
  commitRename,
}: {
  readonly composition: Composition;
  readonly nodeId: string;
  readonly depth: number;
  readonly selectedIds: readonly string[];
  readonly renaming: { readonly id: string; readonly value: string } | null;
  readonly setRenaming: (value: { readonly id: string; readonly value: string } | null) => void;
  readonly commitRename: () => void;
}): ReactNode {
  const node = composition.nodes[nodeId];
  if (node === undefined) return null;
  const unresolved =
    nodeTypeRegistry.get(node.type) === undefined ? createUnresolvedNodePlaceholder(node) : null;

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("application/x-theatrum-node");
    if (draggedId.length > 0 && draggedId !== node.id) {
      editorActions.reparentNode(draggedId, node.id);
    }
  };

  return (
    <>
      <div
        className="project-tree__node"
        role="treeitem"
        aria-selected={selectedIds.includes(node.id)}
        data-selected={selectedIds.includes(node.id) || undefined}
        data-unresolved={unresolved === null ? undefined : true}
        title={unresolved?.label}
        draggable={node.id !== composition.root}
        style={{ "--tree-depth": depth } as React.CSSProperties}
        onClick={(event) =>
          editorActions.selectNode(
            composition.id,
            node.id,
            event.shiftKey || event.ctrlKey || event.metaKey,
          )
        }
        onDoubleClick={() => setRenaming({ id: node.id, value: node.name })}
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-theatrum-node", node.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={onDrop}
      >
        <span className="project-tree__disclosure">{node.children.length > 0 ? "▾" : ""}</span>
        {unresolved === null ? (
          <span className="project-tree__label" data-label={node.label} />
        ) : (
          <span className="project-tree__unresolved-icon" aria-label="Plugin ausente">
            !
          </span>
        )}
        {renaming?.id === node.id ? (
          <input
            className="project-tree__rename"
            value={renaming.value}
            autoFocus
            aria-label="Nome do nó"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setRenaming({ id: node.id, value: event.target.value })}
            onBlur={commitRename}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <span className="project-tree__name">{node.name}</span>
        )}
        <span className="project-tree__meta">
          {unresolved === null ? node.type : "plugin ausente"}
        </span>
      </div>
      {node.children.map((childId) => (
        <NodeBranch
          key={childId}
          composition={composition}
          nodeId={childId}
          depth={depth + 1}
          selectedIds={selectedIds}
          renaming={renaming}
          setRenaming={setRenaming}
          commitRename={commitRename}
        />
      ))}
    </>
  );
}
