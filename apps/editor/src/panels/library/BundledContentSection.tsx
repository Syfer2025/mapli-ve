import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createBuiltinEffectRegistry } from "@theatrum/effects";
import type {
  EffectPresetDefinition,
  FlagDefinition,
  PaletteDefinition,
  ScenePresetDefinition,
} from "@theatrum/plugin-host";
import {
  bundledFlagSvgUrl,
  effectPresetTargetIssue,
  loadBundledContent,
  loadStandaloneFlagSvg,
  materializeEffectPresetParams,
  paletteToProjectPalette,
  type BundledContentCatalog,
  type BundledContentLoadResult,
} from "../../assets/bundled-content.js";
import { editorActions, nodeTypeRegistry } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";

const EFFECTS = createBuiltinEffectRegistry();

export function BundledContentSection({ query }: { readonly query: string }): ReactNode {
  const session = useEditorSession();
  const [loaded, setLoaded] = useState<BundledContentLoadResult | undefined>(undefined);
  const [open, setOpen] = useState(true);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadBundledContent().then((result) => {
      if (active) setLoaded(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const composition =
    session.document.compositions.find(({ id }) => id === session.selectedCompositionId) ??
    session.document.compositions[0];
  const selected =
    composition === undefined || session.selectedNodeId === null
      ? undefined
      : composition.nodes[session.selectedNodeId];
  const selectedDefinition =
    selected === undefined ? undefined : nodeTypeRegistry.get(selected.type);
  const targetIssue = effectPresetTargetIssue({
    selected: selected !== undefined,
    isRoot: selected !== undefined && selected.id === composition?.root,
    nodeTypeRegistered: selectedDefinition !== undefined,
    ...(selectedDefinition === undefined ? {} : { nodeCategory: selectedDefinition.category }),
  });
  const expanded = open || query.trim().length > 0;

  return (
    <section className="library__local library__bundled-content">
      <button
        type="button"
        className="library__local-toggle"
        aria-expanded={expanded}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{expanded ? "▾" : "▸"} Bandeiras, paletas e presets</span>
        <small>{summaryOf(loaded)}</small>
      </button>
      {status === null ? null : (
        <p className="library__local-status" role="status">
          {status}
        </p>
      )}
      {!expanded ? null : loaded === undefined ? (
        <p className="library__local-status">Carregando conteúdo local…</p>
      ) : !loaded.ok ? (
        <p className="library__local-status library__local-status--error">{loaded.message}</p>
      ) : (
        <BundledContentGroups
          catalog={loaded.value}
          query={query}
          paletteIds={session.document.palettes.map(({ id }) => id)}
          selectedNodeId={selected?.id ?? null}
          selectedNodeName={selected?.name ?? null}
          targetIssue={targetIssue}
          busyFlag={busyFlag}
          setBusyFlag={setBusyFlag}
          setStatus={setStatus}
        />
      )}
    </section>
  );
}

function BundledContentGroups({
  catalog,
  query,
  paletteIds,
  selectedNodeId,
  selectedNodeName,
  targetIssue,
  busyFlag,
  setBusyFlag,
  setStatus,
}: {
  readonly catalog: BundledContentCatalog;
  readonly query: string;
  readonly paletteIds: readonly string[];
  readonly selectedNodeId: string | null;
  readonly selectedNodeName: string | null;
  readonly targetIssue: string | null;
  readonly busyFlag: string | null;
  readonly setBusyFlag: (id: string | null) => void;
  readonly setStatus: (message: string | null) => void;
}): ReactNode {
  const visible = useMemo(() => {
    const matches = matcher(query);
    return {
      flags: catalog.flags.filter((flag) =>
        matches(flag.id, flag.name, flag.era, flag.nation, ...flag.tags),
      ),
      palettes: catalog.palettes.filter((palette) =>
        matches(palette.id, palette.name, ...palette.colors),
      ),
      effects: catalog.presets.effects.filter((preset) =>
        matches(preset.id, preset.name, preset.effect),
      ),
      scenes: catalog.presets.scenes.filter((preset) =>
        matches(preset.id, preset.name, preset.mapStyle, preset.palette),
      ),
    };
  }, [catalog, query]);
  const projectPalettes = new Set(paletteIds);

  const addFlag = async (flag: FlagDefinition): Promise<void> => {
    setBusyFlag(flag.id);
    setStatus(`Preparando ${flag.name}…`);
    const svg = await loadStandaloneFlagSvg(flag);
    if (svg === null) {
      setBusyFlag(null);
      setStatus(`Não foi possível ler o símbolo local de ${flag.name}.`);
      return;
    }
    const nodeId = await editorActions.addBundledSvgAsset({
      name: flag.name,
      svg,
      tags: ["bandeira", flag.era, flag.nation],
    });
    setBusyFlag(null);
    setStatus(
      nodeId === null
        ? `Não foi possível adicionar ${flag.name} à composição atual.`
        : `${flag.name} foi incorporada ao projeto e adicionada à cena.`,
    );
  };

  const addPalette = (palette: PaletteDefinition): void => {
    if (projectPalettes.has(palette.id)) {
      setStatus(`${palette.name} já está disponível no projeto.`);
      return;
    }
    setStatus(
      editorActions.addPalette(paletteToProjectPalette(palette))
        ? `${palette.name} foi adicionada ao projeto.`
        : `Não foi possível adicionar ${palette.name}.`,
    );
  };

  const applyEffect = (preset: EffectPresetDefinition): void => {
    if (targetIssue !== null || selectedNodeId === null) {
      setStatus(targetIssue ?? "Selecione um objeto visual.");
      return;
    }
    const definition = EFFECTS.get(preset.effect);
    if (definition === undefined) {
      setStatus(`O efeito "${preset.effect}" não está registrado nesta instalação.`);
      return;
    }
    const params = materializeEffectPresetParams(definition.defaultParams, preset);
    const parsed = params === null ? null : definition.paramSchema.safeParse(params);
    if (parsed === null || !parsed.success) {
      setStatus(`O preset ${preset.name} não é compatível com o efeito instalado.`);
      return;
    }
    const effectId = editorActions.addEffect(
      selectedNodeId,
      preset.effect,
      parsed.data as unknown as Record<string, unknown>,
    );
    setStatus(
      effectId === null
        ? `Não foi possível aplicar ${preset.name}.`
        : `${preset.name} aplicado a ${selectedNodeName ?? "objeto selecionado"}.`,
    );
  };

  if (
    visible.flags.length === 0 &&
    visible.palettes.length === 0 &&
    visible.effects.length === 0 &&
    visible.scenes.length === 0
  ) {
    return <p className="library__local-status">Nenhum conteúdo corresponde à busca.</p>;
  }

  return (
    <>
      {visible.flags.length === 0 ? null : (
        <ContentGroup title="Bandeiras" count={visible.flags.length}>
          <ul className="library__flag-grid" role="list">
            {visible.flags.map((flag) => (
              <li key={flag.id}>
                <button
                  type="button"
                  disabled={busyFlag !== null}
                  title={`Incorporar ${flag.name} e adicionar à cena`}
                  onClick={() => void addFlag(flag)}
                >
                  <svg viewBox="0 0 72 48" aria-hidden>
                    <use href={bundledFlagSvgUrl(flag)} />
                  </svg>
                  <span>{busyFlag === flag.id ? "adicionando…" : flag.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </ContentGroup>
      )}

      {visible.palettes.length === 0 ? null : (
        <ContentGroup title="Paletas" count={visible.palettes.length}>
          <ul className="library__palette-grid" role="list">
            {visible.palettes.map((palette) => {
              const alreadyAdded = projectPalettes.has(palette.id);
              return (
                <li key={palette.id}>
                  <button
                    type="button"
                    disabled={alreadyAdded}
                    title={
                      alreadyAdded
                        ? `${palette.name} já está no projeto`
                        : `Adicionar ${palette.name} ao projeto`
                    }
                    onClick={() => addPalette(palette)}
                  >
                    <span className="library__palette-swatches" aria-hidden>
                      {palette.colors.map((color, index) => (
                        <i style={{ background: color }} key={`${palette.id}-${index}`} />
                      ))}
                    </span>
                    <span>
                      <strong>{palette.name}</strong>
                      <small>{alreadyAdded ? "No projeto" : "Adicionar ao projeto"}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ContentGroup>
      )}

      {visible.effects.length === 0 ? null : (
        <ContentGroup title="Presets de efeito" count={visible.effects.length}>
          <p className="library__content-hint">{targetIssue ?? `Destino: ${selectedNodeName}`}</p>
          <ul className="library__preset-grid" role="list">
            {visible.effects.map((preset) => {
              const missingEffect = !EFFECTS.has(preset.effect);
              const disabled = targetIssue !== null || missingEffect;
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    title={
                      targetIssue ??
                      (missingEffect
                        ? `Efeito não registrado: ${preset.effect}`
                        : `Aplicar a ${selectedNodeName ?? "seleção"}`)
                    }
                    onClick={() => applyEffect(preset)}
                  >
                    <strong>{preset.name}</strong>
                    <small>
                      {preset.effect} · {Math.round(preset.intensity * 100)}%
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        </ContentGroup>
      )}

      {visible.scenes.length === 0 ? null : (
        <ContentGroup title="Presets de cena" count={visible.scenes.length}>
          <p className="library__content-hint">
            Metadados disponíveis; aplicação integral aguarda um comando transacional de cena.
          </p>
          <ul className="library__scene-presets" role="list">
            {visible.scenes.map((preset) => (
              <ScenePresetCard preset={preset} key={preset.id} />
            ))}
          </ul>
        </ContentGroup>
      )}
    </>
  );
}

function ContentGroup({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="library__content-group">
      <h4>
        {title} <small>{count}</small>
      </h4>
      {children}
    </div>
  );
}

function ScenePresetCard({ preset }: { readonly preset: ScenePresetDefinition }): ReactNode {
  const [longitude, latitude] = preset.camera.center;
  return (
    <li>
      <article>
        <span>
          <strong>{preset.name}</strong>
          <small>Somente leitura</small>
        </span>
        <dl>
          <div>
            <dt>Mapa</dt>
            <dd>{preset.mapStyle}</dd>
          </div>
          <div>
            <dt>Paleta</dt>
            <dd>{preset.palette}</dd>
          </div>
          <div>
            <dt>Câmera</dt>
            <dd>
              {latitude.toFixed(2)}, {longitude.toFixed(2)} · z{preset.camera.zoom.toFixed(1)} ·{" "}
              {preset.camera.pitch}°
            </dd>
          </div>
        </dl>
      </article>
    </li>
  );
}

function matcher(query: string): (...values: readonly string[]) => boolean {
  const needle = normalize(query);
  if (needle.length === 0) return () => true;
  return (...values) => normalize(values.join(" ")).includes(needle);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function summaryOf(loaded: BundledContentLoadResult | undefined): string {
  if (loaded === undefined) return "carregando…";
  if (!loaded.ok) return "indisponível";
  return `${loaded.value.flags.length} bandeiras · ${loaded.value.palettes.length} paletas · ${
    loaded.value.presets.effects.length + loaded.value.presets.scenes.length
  } presets`;
}
