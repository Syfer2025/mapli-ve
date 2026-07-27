import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ASSET_IMPORT_ACCEPT,
  ASSET_KIND_LABELS,
  assetByteSize,
  assetDimensions,
  assetDisplayName,
  assetTags,
  formatAssetSize,
  normalizeTags,
  type AssetKind,
} from "@theatrum/assets";
import type { AssetDescriptor } from "@theatrum/schema";
import { assetThumbnailUrl } from "../../assets/asset-media.js";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { Button, Panel } from "../../ui/index.js";
import "./LibraryPanel.css";

interface EditingState {
  readonly id: string;
  readonly name: string;
  readonly tags: string;
}

/**
 * Biblioteca de ativos (bloco 7A): grid de thumbnails com import por picker ou
 * arrastar-e-soltar, busca, filtro por tag, renomear, remover com aviso de uso
 * e "Aplicar" — que cria o nó `image`/`svg` na composição selecionada.
 */
export function LibraryPanel(): ReactNode {
  const session = useEditorSession();
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [editing, setEditing] = useState<EditingState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assets = session.document.assets;
  const allTags = useMemo(
    () =>
      [...new Set(assets.flatMap((asset) => assetTags(asset)))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [assets],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (tagFilter.length > 0 && !assetTags(asset).includes(tagFilter)) return false;
      if (needle.length === 0) return true;
      return (
        assetDisplayName(asset).toLowerCase().includes(needle) ||
        asset.src.toLowerCase().includes(needle) ||
        assetTags(asset).some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [assets, query, tagFilter]);
  const totalBytes = useMemo(
    () => assets.reduce((sum, asset) => sum + (assetByteSize(asset) ?? 0), 0),
    [assets],
  );

  const commitEditing = (): void => {
    if (editing === null) return;
    const name = editing.name.trim();
    if (name.length > 0) editorActions.renameAsset(editing.id, name);
    editorActions.setAssetTags(editing.id, normalizeTags(editing.tags));
    setEditing(null);
  };

  const removeWithWarning = (asset: AssetDescriptor): void => {
    const usages = editorActions.assetUsages(asset.id);
    if (usages.length > 0) {
      const listed = usages
        .slice(0, 5)
        .map((usage) => `${usage.nodeName} (${usage.compositionName})`)
        .join(", ");
      const suffix = usages.length > 5 ? ` e mais ${usages.length - 5}` : "";
      const proceed = window.confirm(
        `"${assetDisplayName(asset)}" é usado por ${usages.length} nó(s): ${listed}${suffix}.\n\n` +
          "Remover mesmo assim? Os nós ficam sem imagem, mas não são apagados.",
      );
      if (!proceed) return;
    }
    editorActions.removeAsset(asset.id);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    if (files.length > 0) void editorActions.importAssetFiles(files);
  };

  return (
    <Panel
      title="Biblioteca"
      toolbar={
        <>
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            Importar…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ASSET_IMPORT_ACCEPT}
            className="library__file-input"
            aria-label="Importar arquivos de asset"
            tabIndex={-1}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length > 0) void editorActions.importAssetFiles(files);
            }}
          />
          <input
            className="library__search"
            type="search"
            placeholder="Buscar…"
            aria-label="Buscar asset"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="library__tag-filter"
            aria-label="Filtrar por tag"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="">Todas as tags</option>
            {allTags.map((tag) => (
              <option value={tag} key={tag}>
                {tag}
              </option>
            ))}
          </select>
        </>
      }
      footer={
        <span>
          {assets.length} asset{assets.length === 1 ? "" : "s"} · {formatAssetSize(totalBytes)}
          {filtered.length !== assets.length ? ` · ${filtered.length} visíveis` : ""}
        </span>
      }
    >
      <div
        className="library"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={onDrop}
      >
        {filtered.length === 0 ? (
          <div className="library__empty">
            {assets.length === 0
              ? "Arraste PNGs, SVGs ou modelos 3D para cá — ou clique em Importar."
              : "Nenhum asset corresponde à busca."}
          </div>
        ) : (
          <div className="library__grid" role="list" aria-label="Assets importados">
            {filtered.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                editing={editing}
                setEditing={setEditing}
                commitEditing={commitEditing}
                onRemove={() => removeWithWarning(asset)}
                onPickTag={setTagFilter}
              />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function AssetCard({
  asset,
  editing,
  setEditing,
  commitEditing,
  onRemove,
  onPickTag,
}: {
  readonly asset: AssetDescriptor;
  readonly editing: EditingState | null;
  readonly setEditing: (value: EditingState | null) => void;
  readonly commitEditing: () => void;
  readonly onRemove: () => void;
  readonly onPickTag: (tag: string) => void;
}): ReactNode {
  const name = assetDisplayName(asset);
  const dimensions = assetDimensions(asset);
  const bytes = assetByteSize(asset);
  const tags = assetTags(asset);
  const thumbnail = assetThumbnailUrl(asset.src);
  const isModel = asset.kind === "model";
  const isEditing = editing !== null && editing.id === asset.id;

  const onEditKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") commitEditing();
    if (event.key === "Escape") setEditing(null);
  };

  return (
    <div className="library-card" role="listitem" data-kind={asset.kind}>
      <div className="library-card__thumb">
        {thumbnail !== null ? (
          <img src={thumbnail} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="library-card__thumb-icon" aria-hidden>
            ◈
          </span>
        )}
      </div>
      {isEditing ? (
        <div className="library-card__edit">
          <input
            value={editing.name}
            aria-label="Nome do asset"
            autoFocus
            onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            onKeyDown={onEditKey}
          />
          <input
            value={editing.tags}
            aria-label="Tags separadas por vírgula"
            placeholder="tags, por vírgula"
            onChange={(event) => setEditing({ ...editing, tags: event.target.value })}
            onKeyDown={onEditKey}
          />
        </div>
      ) : (
        <>
          <span
            className="library-card__name"
            title={name}
            onDoubleClick={() => setEditing({ id: asset.id, name, tags: tags.join(", ") })}
          >
            {name}
          </span>
          <span className="library-card__meta">
            {ASSET_KIND_LABELS[asset.kind as AssetKind] ?? asset.kind}
            {dimensions !== null ? ` · ${dimensions.width}×${dimensions.height}` : ""}
            {bytes !== null ? ` · ${formatAssetSize(bytes)}` : ""}
          </span>
          {tags.length > 0 && (
            <span className="library-card__tags">
              {tags.map((tag) => (
                <button
                  type="button"
                  className="library-card__tag"
                  key={tag}
                  title={`Filtrar por "${tag}"`}
                  onClick={() => onPickTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </span>
          )}
        </>
      )}
      <div className="library-card__actions">
        <Button
          size="sm"
          disabled={isModel}
          title={isModel ? "Modelos 3D entram no viewport 3D (fase futura)" : "Adicionar à cena"}
          onClick={() => editorActions.applyAsset(asset.id)}
        >
          Aplicar
        </Button>
        <Button
          size="sm"
          iconOnly
          aria-label="Editar nome e tags"
          title="Editar nome e tags"
          onClick={() =>
            setEditing(isEditing ? null : { id: asset.id, name, tags: tags.join(", ") })
          }
        >
          ✎
        </Button>
        <Button
          size="sm"
          iconOnly
          variant="danger"
          aria-label="Remover asset"
          title="Remover asset"
          onClick={onRemove}
        >
          ×
        </Button>
      </div>
    </div>
  );
}
