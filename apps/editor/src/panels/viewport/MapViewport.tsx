import { apply, settle, type CameraState, type SettleResult } from "@theatrum/camera";
import { DEFAULT_MAX_DIMENSION } from "@theatrum/export";
import {
  BUILTIN_GAZETTEER_PLACES,
  OfflineGazetteer,
  type GazetteerHit,
  type GazetteerResolution,
} from "@theatrum/gis";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "../../ui/index.js";
import { createMapLibreCameraPort } from "./maplibre-adapters.js";
import {
  createDetailedMapStyle,
  createMapStyle,
  createSatelliteStyle,
  MAP_STYLE_OPTIONS,
} from "./map-styles.js";
import {
  detailedBasemapById,
  knownDetailedBasemaps,
  loadDetailedBasemaps,
  type DetailedBasemap,
} from "./detailed-basemap.js";
import {
  loadRasterBasemaps,
  parseStyleChoice,
  rasterBasemapById,
  type RasterBasemap,
  type StyleChoice,
} from "./raster-basemap.js";
import { attachScene3dLayer, detachScene3dLayer } from "./scene3d-layer.js";
import { loadNaturalEarthGazetteer } from "./natural-earth-gazetteer.js";
import { SceneOverlay } from "./SceneOverlay.js";
import { applyOverrideToElement, useExportSurface } from "../../export/useExportSurface.js";
import { effectivePixelRatio, surfaceMatches } from "../../export/surface-override.js";
import {
  previewPixelRatioForSize,
  usePreviewSupersampling,
} from "../../export/preview-supersampling.js";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import {
  DocumentCameraApplyGuard,
  evaluatedDocumentMapCamera,
  resolveDocumentMapStyle,
  sameDocumentMapCamera,
  type ResolvedDocumentMapStyle,
} from "./map-document-state.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "./MapViewport.css";

const DEFAULT_CAMERA: CameraState = {
  center: [0, 20],
  zoom: 2,
  bearing: 0,
  pitch: 0,
};

const protocol = new Protocol();
let isPmtilesProtocolRegistered = false;

interface Phase2DebugSurface {
  readonly map: MapLibreMap;
  readonly cameraPort: ReturnType<typeof createMapLibreCameraPort>;
  readonly settle: (timeoutMs: number) => Promise<SettleResult>;
}

type Phase2DebugWindow = Window & {
  __theatrumPhase2?: Phase2DebugSurface;
};

function ensurePmtilesProtocol(): void {
  if (isPmtilesProtocolRegistered) return;
  maplibregl.addProtocol("pmtiles", protocol.tile);
  isPmtilesProtocolRegistered = true;
}

function cameraFromMap(map: MapLibreMap): CameraState {
  return createMapLibreCameraPort(map).current();
}

function formatCamera(camera: CameraState): string {
  const longitude = camera.center[0].toFixed(3);
  const latitude = camera.center[1].toFixed(3);
  return `${longitude}°, ${latitude}° · z ${camera.zoom.toFixed(2)} · ${camera.bearing.toFixed(
    0,
  )}° · pitch ${camera.pitch.toFixed(0)}°`;
}

function formatTime(currentFrame: number, fps: number): string {
  const seconds = currentFrame / fps;
  const wholeSeconds = Math.floor(seconds);
  const subframe = Math.floor((seconds - wholeSeconds) * fps);
  return `00:${String(wholeSeconds).padStart(2, "0")}:${String(subframe).padStart(2, "0")}`;
}

/**
 * Materializa a resolução já feita contra os recursos desta máquina.
 *
 * No fallback o documento continua intocado; só os pixels usam relevo escuro
 * enquanto a UI explica qual recurso está ausente (ADR-026).
 */
function styleSpecFor(resolved: ResolvedDocumentMapStyle) {
  if (!resolved.available) return createMapStyle(resolved.fallbackStyleId);
  if (resolved.kind === "vector") return createMapStyle(resolved.styleId);
  if (resolved.kind === "detailed") return createDetailedMapStyle(resolved.basemap);
  const labelsBasemap = resolved.labels ? knownDetailedBasemaps()[0] : undefined;
  return createSatelliteStyle(resolved.basemap, {
    labels: resolved.labels,
    ...(labelsBasemap === undefined ? {} : { labelsBasemap }),
  });
}

function readyStatus(resolved: ResolvedDocumentMapStyle): string {
  if (!resolved.available) {
    return `fallback visual · ${resolved.reason} · projeto preservado`;
  }
  if (resolved.kind === "detailed") {
    return `offline detalhado · ruas e edifícios até z${resolved.basemap.maxZoom}`;
  }
  if (resolved.kind === "satellite") {
    const labels =
      resolved.labels && knownDetailedBasemaps().length > 0 ? " · híbrido detalhado" : "";
    return `satélite local pronto${labels}`;
  }
  return "offline pronto · mapa mundial z0–6";
}

function styleRenderKey(resolved: ResolvedDocumentMapStyle): string {
  return `${resolved.available ? "available" : "fallback"}:${resolved.documentStyleId}`;
}

function focusDetailedBasemap(map: MapLibreMap, basemap: DetailedBasemap): void {
  const [west, south, east, north] = basemap.focusBounds;
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: 56, duration: 900, essential: true },
  );
}

export function MapViewport(): ReactNode {
  const session = useEditorSession();
  const composition =
    session.document.compositions.find(
      (candidate) => candidate.id === session.selectedCompositionId,
    ) ?? session.document.compositions[0];
  const documentStyleId = composition?.map.styleId ?? "dark-relief";
  const documentCamera = useMemo(
    () =>
      composition === undefined
        ? DEFAULT_CAMERA
        : evaluatedDocumentMapCamera(composition, session.playheadFrame),
    [
      composition?.camera.bearing,
      composition?.camera.center,
      composition?.camera.pitch,
      composition?.camera.zoom,
      session.playheadFrame,
    ],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const exportRenderReadyRef = useRef(true);
  const cameraApplyGuardRef = useRef(new DocumentCameraApplyGuard());
  const documentCameraRef = useRef(documentCamera);
  /** Pacotes regionais de alta resolução realmente presentes no disco. */
  const [detailedBasemaps, setDetailedBasemaps] = useState<readonly DetailedBasemap[]>([]);
  /** Imagens de satélite achadas nesta máquina; vazio esconde as opções. */
  const [rasters, setRasters] = useState<readonly RasterBasemap[]>([]);
  const resolvedStyle = useMemo(
    () => resolveDocumentMapStyle(documentStyleId, detailedBasemaps, rasters),
    [detailedBasemaps, documentStyleId, rasters],
  );
  const resolvedStyleRef = useRef(resolvedStyle);
  const appliedStyleKeyRef = useRef<string | null>(null);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [cameraRevision, setCameraRevision] = useState(0);
  const [mapStatus, setMapStatus] = useState("iniciando mapa local…");
  const [camera, setCamera] = useState<CameraState>(documentCamera);
  const [query, setQuery] = useState("");
  const [resolution, setResolution] = useState<GazetteerResolution | null>(null);
  const gazetteerRef = useRef(new OfflineGazetteer(BUILTIN_GAZETTEER_PLACES));
  const previewSupersampling = usePreviewSupersampling();

  documentCameraRef.current = documentCamera;
  resolvedStyleRef.current = resolvedStyle;

  /**
   * Durante um export o mapa vai ao tamanho da composição ([ADR-022](../../../../../docs/adr/ADR-022-export-resolution-from-composition.md)).
   *
   * Container em pixels de CSS e `setPixelRatio` para o backing store — os dois
   * juntos, porque é o produto deles que dá o tamanho do frame. O `resize()` é
   * síncrono no MapLibre, então quando este efeito termina o canvas já tem o
   * tamanho novo e a confirmação da transação não mente.
   *
   * Na volta, `devicePixelRatio`, e não o valor que estava antes: o mapa nasce
   * assim, e guardar o anterior seria uma segunda verdade sobre o mesmo número.
   */
  const exportOverride = useExportSurface(
    "map",
    (override) => {
      applyOverrideToElement(containerRef.current, override);
      const map = mapRef.current;
      if (map === null) return;
      if (override === null) {
        exportRenderReadyRef.current = true;
      } else {
        exportRenderReadyRef.current = false;
        map.once("render", () => {
          exportRenderReadyRef.current = true;
        });
      }
      const container = containerRef.current;
      const previewPixelRatio = previewPixelRatioForSize(
        window.devicePixelRatio,
        previewSupersampling,
        container?.clientWidth ?? 0,
        container?.clientHeight ?? 0,
      );
      map.setPixelRatio(effectivePixelRatio(override, previewPixelRatio));
      map.resize();
      if (override !== null) map.triggerRepaint();
    },
    // O canvas de verdade, não o container: é ele que o compositor lê, e é ele que
    // o `maxCanvasSize` do MapLibre encolhe em silêncio acima do teto configurado.
    (override) =>
      surfaceMatches(override, mapRef.current?.getCanvas() ?? null) &&
      (override === null ||
        (exportRenderReadyRef.current &&
          mapRef.current?.isStyleLoaded() === true &&
          mapRef.current.areTilesLoaded() &&
          mapRef.current.loaded())),
  );

  /** Preferência local: o job vence enquanto houver override; fora dele, repinta. */
  useEffect(() => {
    if (exportOverride !== null) return;
    const map = mapRef.current;
    if (map === null) return;
    const container = containerRef.current;
    map.setPixelRatio(
      previewPixelRatioForSize(
        window.devicePixelRatio,
        previewSupersampling,
        container?.clientWidth ?? 0,
        container?.clientHeight ?? 0,
      ),
    );
    map.resize();
  }, [exportOverride, mapInstance, previewSupersampling]);

  useEffect(() => {
    ensurePmtilesProtocol();
    const container = containerRef.current;
    if (container === null || mapRef.current !== null) return;

    const map = new maplibregl.Map({
      container,
      style: styleSpecFor(resolvedStyleRef.current),
      center: [documentCameraRef.current.center[0], documentCameraRef.current.center[1]],
      zoom: documentCameraRef.current.zoom,
      bearing: documentCameraRef.current.bearing,
      pitch: documentCameraRef.current.pitch,
      minZoom: 0,
      // Mesmos limites do motor @theatrum/camera: documento e runtime não
      // podem discordar silenciosamente depois de aplicar um frame.
      maxZoom: 24,
      maxPitch: 85,
      // O plano de export usa este mesmo número. Fixá-lo aqui impede uma
      // atualização do MapLibre de mudar o teto físico sem mudar a recusa do job.
      maxCanvasSize: [DEFAULT_MAX_DIMENSION, DEFAULT_MAX_DIMENSION],
      attributionControl: false,
      fadeDuration: 0,
      /**
       * Sem isto o export não tem terreno.
       *
       * O `captureExport()` compõe o mapa, o palco 3D e o overlay Pixi numa
       * imagem só, e compor exige **ler** cada superfície. Medido no aplicativo
       * em execução: um canvas comum ocioso continua legível, mas o do MapLibre
       * devolve zero em todos os canais — é o caso que a documentação dele
       * resolve com esta flag, e a única alternativa seria ler dentro do rAF
       * dele, o que amarraria o export ao relógio do mapa.
       *
       * O custo não apareceu na medição: 40 mil triângulos em 1280×720 deram
       * mediana de 13,40 ms com a flag e 13,40 ms sem — as duas presas ao vsync.
       * Ver [ADR-013](../../../../../docs/adr/ADR-013-export-frame-composition.md).
       *
       * **Vai aqui dentro, não no topo das opções.** O MapLibre 5 mudou de
       * `MapOptions.preserveDrawingBuffer` para `canvasContextAttributes`, e a
       * chave antiga é ignorada **em silêncio**: o mapa sobe normal, o contexto
       * continua sem preservar, e só `getContextAttributes()` conta a verdade.
       */
      /**
       * `antialias: false` é decisão, não omissão — [ADR-023](../../../../../docs/adr/ADR-023-no-msaa-on-composed-surfaces.md).
       *
       * Medido: com MSAA (`SAMPLES = 4`) repintar o **mesmo estado** deixa de
       * devolver os mesmos bytes acima de ~2 MP. Idêntico em 1248×566 e
       * 1920×1080; divergente em 2560×1440, 3072×1728 e 3840×2160. Com
       * `antialias: false` repete bit a bit em todos eles. A assinatura era de
       * resolve: 42 px de 8.294.400, delta máximo 6, sobre preenchimento.
       *
       * Isso ataca o critério 2 da Fase 8 direto, e passou anos invisível porque
       * o frame de export saía do tamanho do painel — abaixo do limiar. O
       * ADR-022 tira o tamanho da janela, então o limiar passa a ser atingido
       * sempre.
       *
       * O custo está medido e é pequeno: 1% mais degraus duros e 19% menos
       * valores intermediários. O MapLibre já suaviza preenchimento e traço no
       * shader dele; o MSAA só somava nas arestas de geometria. E `false` é o
       * padrão do próprio MapLibre — o `true` daqui entrou de carona no
       * `b12765d`, sem justificativa registrada.
       */
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false },
    });
    appliedStyleKeyRef.current = styleRenderKey(resolvedStyleRef.current);
    mapRef.current = map;
    setMapInstance(map);
    if (import.meta.env.DEV || import.meta.env.VITE_THEATRUM_VERIFY === "1") {
      const debugCameraPort = createMapLibreCameraPort(map);
      Object.defineProperty(window, "__theatrumPhase2", {
        value: Object.freeze({
          map,
          cameraPort: debugCameraPort,
          settle: (timeoutMs: number) => settle(debugCameraPort, timeoutMs),
        } satisfies Phase2DebugSurface),
        configurable: true,
      });
    }
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }),
      "bottom-right",
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    const updateCamera = (): void => {
      setCamera(cameraFromMap(map));
      setCameraRevision((revision) => revision + 1);
    };
    const onMoveStart = (): void => {
      if (!cameraApplyGuardRef.current.applying) editorActions.pause();
    };
    const onMoveEnd = (): void => {
      updateCamera();
      if (cameraApplyGuardRef.current.applying) return;
      const nextCamera = cameraFromMap(map);
      if (!sameDocumentMapCamera(nextCamera, documentCameraRef.current)) {
        editorActions.setMapCamera(nextCamera);
      }
    };
    const onLoad = (): void => {
      updateCamera();
      const startedAt = performance.now();
      void settle(createMapLibreCameraPort(map), 2_000).then((result) => {
        if (result.settled) {
          setMapStatus(
            `${readyStatus(resolvedStyleRef.current)} · settle ${(
              performance.now() - startedAt
            ).toFixed(0)} ms`,
          );
        } else {
          setMapStatus(`mapa local · settle ${result.reason}`);
        }
      });
    };
    const onStyleData = (): void => {
      if (map.isStyleLoaded()) setMapStatus(readyStatus(resolvedStyleRef.current));
    };
    // Camada 3D volta a cada setStyle: trocar de estilo descarta custom layers.
    const onStyleLoad = (): void => {
      attachScene3dLayer(map);
    };
    const onError = (event: { readonly error?: Error }): void => {
      const message = event.error?.message ?? "falha desconhecida";
      setMapStatus(`erro local · ${message}`);
    };

    map.on("load", onLoad);
    map.on("movestart", onMoveStart);
    map.on("move", updateCamera);
    map.on("moveend", onMoveEnd);
    map.on("styledata", onStyleData);
    map.on("style.load", onStyleLoad);
    map.on("error", onError);

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.off("load", onLoad);
      map.off("movestart", onMoveStart);
      map.off("move", updateCamera);
      map.off("moveend", onMoveEnd);
      map.off("styledata", onStyleData);
      map.off("style.load", onStyleLoad);
      map.off("error", onError);
      detachScene3dLayer(map);
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
      if (import.meta.env.DEV || import.meta.env.VITE_THEATRUM_VERIFY === "1") {
        Reflect.deleteProperty(window as Phase2DebugWindow, "__theatrumPhase2");
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadNaturalEarthGazetteer(controller.signal)
      .then((gazetteer) => {
        gazetteerRef.current = gazetteer;
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMapStatus("mapa local · gazetteer essencial");
        }
      });
    return () => controller.abort();
  }, []);

  // Pacotes regionais e imagens de satélite são opcionais e locais: a ausência
  // não acrescenta opções, mas o id persistido continua visível como indisponível.
  useEffect(() => {
    let active = true;
    void Promise.all([loadDetailedBasemaps(), loadRasterBasemaps()]).then(
      ([foundDetailed, foundRasters]) => {
        if (!active) return;
        setDetailedBasemaps(foundDetailed);
        setRasters(foundRasters);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  /** Documento → MapLibre. Aplicações programáticas não voltam como comando. */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || sameDocumentMapCamera(cameraFromMap(map), documentCamera)) return;
    const release = cameraApplyGuardRef.current.begin();
    try {
      apply(createMapLibreCameraPort(map), documentCamera);
    } finally {
      queueMicrotask(release);
    }
  }, [documentCamera, mapInstance]);

  /** Estilo persistido → recurso local, com fallback visual explícito. */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    const nextKey = styleRenderKey(resolvedStyle);
    if (appliedStyleKeyRef.current === nextKey) {
      setMapStatus(readyStatus(resolvedStyle));
      return;
    }
    appliedStyleKeyRef.current = nextKey;
    setMapStatus(resolvedStyle.available ? "aplicando estilo local…" : readyStatus(resolvedStyle));
    map.setStyle(styleSpecFor(resolvedStyle), { diff: false });
  }, [mapInstance, resolvedStyle]);

  const selectStyle = (nextStyle: StyleChoice): void => {
    if (!editorActions.setMapStyle(nextStyle)) return;
    setMapStatus("aplicando estilo local…");
    const map = mapRef.current;
    if (map === null) return;

    const parsed = parseStyleChoice(nextStyle);
    if (parsed.kind === "detailed") {
      const basemap = detailedBasemapById(parsed.id);
      if (basemap !== undefined) {
        editorActions.pause();
        focusDetailedBasemap(map, basemap);
      }
    } else if (parsed.kind === "satellite") {
      const basemap = rasterBasemapById(parsed.id);
      if (basemap?.bounds !== undefined) {
        const [west, south, east, north] = basemap.bounds;
        editorActions.pause();
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 56, duration: 900, essential: true },
        );
      }
    }
  };

  const goToHit = useCallback((hit: GazetteerHit) => {
    const map = mapRef.current;
    if (map === null) return;
    editorActions.pause();
    map.easeTo({
      center: [hit.lngLat[0], hit.lngLat[1]],
      zoom: Math.max(map.getZoom(), 6.4),
      pitch: Math.min(map.getPitch(), 45),
      duration: 850,
      essential: true,
    });
    setResolution({ status: "resolved", query: hit.name, hit });
  }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const result = gazetteerRef.current.resolveResult(query);
    setResolution(result);
    if (result.status === "resolved") goToHit(result.hit);
  };

  const searchMessage = useMemo(() => {
    if (resolution === null) return null;
    if (resolution.status === "not-found") return `Nenhum lugar local para “${resolution.query}”.`;
    if (resolution.status === "ambiguous") {
      return `${resolution.hits.length} lugares chamados “${resolution.query}”.`;
    }
    const admin = resolution.hit.admin1 === undefined ? "" : ` · ${resolution.hit.admin1}`;
    return `${resolution.hit.name}${admin} · ${resolution.hit.country}`;
  }, [resolution]);
  const styleSelectValue =
    resolvedStyle.available && resolvedStyle.kind === "vector"
      ? resolvedStyle.styleId
      : documentStyleId;
  const timelineMax = Math.max(0, (composition?.duration ?? 1) - 1);
  const timelineFps = composition?.fps ?? 60;

  return (
    <section
      className="map-viewport"
      data-map-status={mapStatus.startsWith("erro") ? "error" : "ok"}
    >
      <div className="map-viewport__stage">
        <div
          className="map-viewport__map"
          ref={containerRef}
          aria-label="Mapa geopolítico interativo"
        />
        <SceneOverlay map={mapInstance} cameraRevision={cameraRevision} />
      </div>

      <div className="map-viewport__toolbar">
        <label className="map-viewport__field">
          <span>Estilo</span>
          <select
            value={styleSelectValue}
            onChange={(event) => selectStyle(event.target.value as StyleChoice)}
            aria-label="Estilo do mapa"
          >
            {!resolvedStyle.available && (
              <option value={documentStyleId}>Indisponível: {documentStyleId}</option>
            )}
            {MAP_STYLE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            {detailedBasemaps.length > 0 && (
              <optgroup label="Mapas detalhados">
                {detailedBasemaps.map((basemap) => (
                  <option key={basemap.id} value={`detail:${basemap.id}`}>
                    {basemap.label}
                  </option>
                ))}
              </optgroup>
            )}
            {rasters.map((basemap) => (
              <optgroup key={basemap.id} label={basemap.label}>
                <option value={`sat:${basemap.id}`}>{basemap.label}</option>
                <option value={`sat+:${basemap.id}`}>{basemap.label} com rótulos</option>
              </optgroup>
            ))}
          </select>
        </label>

        <form className="map-viewport__search" onSubmit={submitSearch}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cidade…"
            aria-label="Buscar lugar no gazetteer offline"
          />
          <Button size="sm" type="submit">
            Ir
          </Button>
        </form>
      </div>

      {resolution !== null && (
        <aside className="map-viewport__search-result" aria-live="polite">
          <div className="map-viewport__search-result-head">
            <span>{searchMessage}</span>
            <button type="button" onClick={() => setResolution(null)} aria-label="Fechar resultado">
              ×
            </button>
          </div>
          {resolution.status === "ambiguous" && (
            <div className="map-viewport__hits">
              {resolution.hits.slice(0, 8).map((hit) => (
                <button key={hit.id} type="button" onClick={() => goToHit(hit)}>
                  <strong>{hit.name}</strong>
                  <span>
                    {hit.admin1 ?? "—"} · {hit.country}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>
      )}

      <div className="map-viewport__readout">
        <span className="map-viewport__online-indicator" />
        <span>{mapStatus}</span>
        <span className="map-viewport__readout-divider" />
        <span>{formatCamera(camera)}</span>
      </div>

      <div className="map-viewport__transport">
        <div className="map-viewport__transport-buttons">
          <Button size="sm" iconOnly aria-label="Parar" onClick={() => editorActions.stop()}>
            ■
          </Button>
          <Button
            size="sm"
            iconOnly
            variant={session.isPlaying ? "primary" : "default"}
            aria-label={session.isPlaying ? "Pausar" : "Reproduzir"}
            onClick={() => (session.isPlaying ? editorActions.pause() : editorActions.play())}
          >
            {session.isPlaying ? "Ⅱ" : "▶"}
          </Button>
          <label className="map-viewport__loop">
            <input
              type="checkbox"
              checked={session.loopPlayback}
              onChange={(event) => editorActions.setLoop(event.target.checked)}
            />
            Loop
          </label>
        </div>

        <span className="map-viewport__time">{formatTime(session.playheadFrame, timelineFps)}</span>
        <input
          className="map-viewport__scrub"
          type="range"
          min={0}
          max={timelineMax}
          step={1}
          value={session.playheadFrame}
          aria-label="Tempo da composição"
          onChange={(event) => {
            editorActions.pause();
            editorActions.setPlayhead(Number(event.target.value));
          }}
        />
        <span className="map-viewport__route">
          {composition?.name ?? "Composição"} · câmera do projeto
        </span>
      </div>
    </section>
  );
}
