/**
 * Estado fail-closed do MapLibre compartilhado sem acoplar o controlador de
 * export ao ciclo de vida React do viewport.
 *
 * `areTilesLoaded()` considera tiles em estado `errored` como concluídos. Por
 * isso o export precisa de uma segunda fonte, persistente durante o estilo
 * atual, que distinga "terminou de carregar" de "falhou e não vai carregar".
 */

export type MapExportBlockProbe = () => string | null;

export interface ExportMapReadinessSource {
  isMoving(): boolean;
  areTilesLoaded(): boolean;
}

interface ReadinessBinding {
  readonly token: symbol;
  readonly probe: MapExportBlockProbe;
}

const bindings = new WeakMap<object, ReadinessBinding>();

/**
 * Publica a razão que impede capturar o mapa. O lease evita que um cleanup
 * atrasado apague um binding mais novo para a mesma instância.
 */
export function bindMapExportReadiness(map: object, probe: MapExportBlockProbe): () => void {
  const binding: ReadinessBinding = {
    token: Symbol("map-export-readiness"),
    probe,
  };
  bindings.set(map, binding);
  return () => {
    if (bindings.get(map)?.token === binding.token) bindings.delete(map);
  };
}

/** `null` significa que não existe bloqueio conhecido para esta instância. */
export function mapExportBlockReason(map: object | null | undefined): string | null {
  if (map === null || map === undefined) return null;
  const binding = bindings.get(map);
  if (binding === undefined) return null;
  try {
    const reason = binding.probe();
    if (reason === null) return null;
    const normalized = reason.trim();
    return normalized.length === 0 ? "o mapa local está indisponível" : normalized;
  } catch (error: unknown) {
    return `não foi possível confirmar os recursos do mapa: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * `areTilesLoaded()` sozinho não basta: MapLibre devolve `true` quando todos os
 * tiles terminaram em `loaded` **ou** `errored`.
 */
export function mapBusyForExport(map: ExportMapReadinessSource | null | undefined): boolean {
  return (
    map !== null &&
    map !== undefined &&
    (mapExportBlockReason(map) !== null || map.isMoving() || !map.areTilesLoaded())
  );
}
