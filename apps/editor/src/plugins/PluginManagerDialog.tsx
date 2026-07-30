import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "../ui/index.js";
import {
  getEditorPluginRuntimeSnapshot,
  initializeEditorPluginRuntime,
  loadEditorPlugin,
  refreshEditorPlugins,
  runPluginCommand,
  subscribeEditorPluginRuntime,
  unloadEditorPlugin,
} from "./editor-plugin-runtime.js";
import "./PluginManagerDialog.css";

export function PluginManagerDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const runtime = useSyncExternalStore(
    subscribeEditorPluginRuntime,
    getEditorPluginRuntimeSnapshot,
  );

  useEffect(() => {
    void initializeEditorPluginRuntime();
  }, []);

  return (
    <div className="plugin-manager__backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="plugin-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="plugin-manager-title">Plugins locais</h2>
            <p>
              Módulos ESM empacotados, executados no renderer isolado e sem acesso direto ao sistema
              operacional.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </header>

        <div className="plugin-manager__toolbar">
          <Button
            size="sm"
            variant="ghost"
            disabled={runtime.scanning}
            onClick={() => void refreshEditorPlugins(false)}
          >
            {runtime.scanning ? "Verificando…" : "Reescanear"}
          </Button>
          <code title={runtime.scan?.root}>
            {runtime.scan?.root || "A pasta de plugins será criada pelo aplicativo."}
          </code>
        </div>

        {runtime.scan?.diagnostics.map((diagnostic, index) => (
          <p
            className="plugin-manager__diagnostic"
            role="alert"
            key={`${diagnostic.directory}-${index}`}
          >
            <strong>{diagnostic.directory || "plugins"}</strong>: {diagnostic.message}
            {diagnostic.details?.[0] === undefined
              ? null
              : ` (${diagnostic.details[0].path || "/"}: ${diagnostic.details[0].message})`}
          </p>
        ))}

        <div className="plugin-manager__list">
          {!runtime.initialized ? (
            <p>Carregando manifestos…</p>
          ) : runtime.scan?.plugins.length === 0 ? (
            <p className="plugin-manager__empty">
              Nenhum plugin válido encontrado. Crie uma subpasta com <code>plugin.json</code> e uma
              entrada <code>.mjs</code> empacotada.
            </p>
          ) : (
            runtime.scan?.plugins.map((plugin) => {
              const id = plugin.manifest.id;
              const loaded = runtime.loadedIds.has(id);
              const busy = runtime.busyIds.has(id);
              const error = runtime.errors[id];
              return (
                <article key={id}>
                  <div>
                    <h3>{plugin.manifest.name}</h3>
                    <p>
                      <code>{id}</code> · v{plugin.manifest.version} · {plugin.directory}
                    </p>
                    {plugin.manifest.description === undefined ? null : (
                      <p>{plugin.manifest.description}</p>
                    )}
                    <small>
                      {Object.entries(plugin.manifest.contributes)
                        .map(([point, ids]) => `${point}: ${String(ids?.length ?? 0)}`)
                        .join(" · ") || "sem contribuições declaradas"}
                    </small>
                    {error === undefined ? null : <p role="alert">{error}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant={loaded ? "ghost" : "primary"}
                    disabled={busy}
                    onClick={() => (loaded ? unloadEditorPlugin(id) : void loadEditorPlugin(id))}
                  >
                    {busy ? "Aguarde…" : loaded ? "Descarregar" : "Ativar"}
                  </Button>
                </article>
              );
            })
          )}
        </div>

        {runtime.commands.length === 0 ? null : (
          <section className="plugin-manager__commands" aria-labelledby="plugin-command-title">
            <h3 id="plugin-command-title">Comandos fornecidos</h3>
            <div>
              {runtime.commands.map((command) => (
                <Button
                  size="sm"
                  variant="ghost"
                  title={command.description}
                  onClick={() => void runPluginCommand(command.id)}
                  key={command.id}
                >
                  {command.label}
                </Button>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
