import { apply, settle, type CameraState, type SettleResult } from "@theatrum/camera";
import { DEFAULT_MAX_DIMENSION } from "@theatrum/export";
import {
  BUILTIN_GAZETTEER_PLACES,
  OfflineGazetteer,
  type GazetteerHit,
  type GazetteerResolution,
} from "@theatrum/gis";
import maplibregl, {
  type FilterSpecification,
  type Map as MapLibreMap,
} from "maplibre-gl";
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
import {
  createMapLibreCameraPort,
  isUserInitiatedMapMove,
  type MapLibreMoveEventLike,
} from "./maplibre-adapters.js";
import {
  createDetailedMapStyle,
  createMapStyle,
  createSatelliteStyle,
  DEFAULT_DETAILED_POI_MODE,
  DETAILED_POI_MODE_OPTIONS,
  MAP_STYLE_OPTIONS,
  type DetailedPoiMode,
  UKRAINE_WAR_TIMELINE_FINAL_STATE_FRAME,
  UKRAINE_WAR_TIMELINE_FRAME_STEP,
  UKRAINE_WAR_TIMELINE_LAST_FRAME,
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
import { bindMapExportReadiness } from "../../export/map-export-readiness.js";
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
  documentMapStyleExportBlockReason,
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
const DETAILED_POI_STORAGE_KEY = "theatrum.map.detailed-poi-mode.v1";

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

function isDetailedPoiMode(value: unknown): value is DetailedPoiMode {
  return value === "strategic" || value === "all" || value === "hidden";
}

function loadDetailedPoiMode(): DetailedPoiMode {
  try {
    const stored = window.localStorage.getItem(DETAILED_POI_STORAGE_KEY);
    return isDetailedPoiMode(stored) ? stored : DEFAULT_DETAILED_POI_MODE;
  } catch {
    return DEFAULT_DETAILED_POI_MODE;
  }
}

function storeDetailedPoiMode(mode: DetailedPoiMode): void {
  try {
    window.localStorage.setItem(DETAILED_POI_STORAGE_KEY, mode);
  } catch {
    // Preferência local é útil, mas nunca deve impedir o mapa de funcionar.
  }
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

function warTimelineDataFrame(playheadFrame: number): number {
  const bounded = Math.max(0, Math.min(UKRAINE_WAR_TIMELINE_LAST_FRAME, playheadFrame));
  if (bounded >= UKRAINE_WAR_TIMELINE_LAST_FRAME) return UKRAINE_WAR_TIMELINE_LAST_FRAME;
  return Math.floor(bounded / UKRAINE_WAR_TIMELINE_FRAME_STEP) * UKRAINE_WAR_TIMELINE_FRAME_STEP;
}

/**
 * O GeoJSON já contém um polígono interpolado a cada dois frames. Trocar apenas
 * o filtro evita reconstruir e triangular a geometria durante a reprodução.
 */
function applyUkraineWarTimelineFrame(map: MapLibreMap, playheadFrame: number): number {
  const dataFrame = warTimelineDataFrame(playheadFrame);
  const filter: FilterSpecification = [
    "all",
    ["==", ["get", "kind"], "occupied_timeline"],
    ["==", ["get", "frame"], dataFrame],
  ];
  if (map.getLayer("ukraine-occupied-fill") !== undefined) {
    map.setFilter("ukraine-occupied-fill", filter);
  }
  if (map.getLayer("ukraine-occupied-stripes") !== undefined) {
    map.setFilter("ukraine-occupied-stripes", filter);
  }

  const frontlineProgress = Math.max(
    0,
    Math.min(
      1,
      (playheadFrame - UKRAINE_WAR_TIMELINE_FINAL_STATE_FRAME) /
        (UKRAINE_WAR_TIMELINE_LAST_FRAME - UKRAINE_WAR_TIMELINE_FINAL_STATE_FRAME),
    ),
  );
  if (map.getLayer("ukraine-frontline-casing") !== undefined) {
    map.setPaintProperty("ukraine-frontline-casing", "line-opacity", 0.76 * frontlineProgress);
  }
  if (map.getLayer("ukraine-frontline") !== undefined) {
    map.setPaintProperty("ukraine-frontline", "line-opacity", 0.98 * frontlineProgress);
  }
  return dataFrame;
}

/**
 * Materializa a resolução já feita contra os recursos desta máquina.
 *
 * No fallback o documento continua intocado; só os pixels usam relevo escuro
 * enquanto a UI explica qual recurso está ausente (ADR-026).
 */
function styleSpecFor(resolved: ResolvedDocumentMapStyle, poiMode: DetailedPoiMode) {
  if (!resolved.available) return createMapStyle(resolved.fallbackStyleId);
  if (resolved.kind === "vector") return createMapStyle(resolved.styleId);
  if (resolved.kind === "detailed") {
    return createDetailedMapStyle(resolved.basemap, { poiMode });
  }
  const labelsBasemap = resolved.labels ? knownDetailedBasemaps()[0] : undefined;
  return createSatelliteStyle(resolved.basemap, {
    labels: resolved.labels,
    poiMode,
    ...(labelsBasemap === undefined ? {} : { labelsBasemap }),
  });
}

function readyStatus(resolved: ResolvedDocumentMapStyle, poiMode: DetailedPoiMode): string {
  if (!resolved.available) {
    return `fallback visual · ${resolved.reason} · projeto preservado`;
  }
  if (resolved.kind === "detailed") {
    const seals =
      poiMode === "strategic"
        ? "selos estratégicos"
        : poiMode === "all"
          ? "todos os selos"
          : "selos ocultos";
    const ukraineSnapshot =
      resolved.basemap.id === "ukraine"
        ? " · principais cidades · progressão territorial 2022–2026 · linha de frente 30/07/2026"
        : "";
    return `offline detalhado · ruas e edifícios até z${resolved.basemap.maxZoom} · ${seals}${ukraineSnapshot} · português`;
  }
  if (resolved.kind === "satellite") {
    const labels =
      resolved.labels && knownDetailedBasemaps().length > 0 ? " · híbrido detalhado" : "";
    return `satélite local pronto${labels}`;
  }
  return "offline pronto · mapa mundial z0–6";
}

function styleRenderKey(resolved: ResolvedDocumentMapStyle, poiMode: DetailedPoiMode): string {
  return `${resolved.available ? "available" : "fallback"}:${resolved.documentStyleId}:${poiMode}`;
}

const USER_CAMERA_EVENT_DATA = Object.freeze({
  originalEvent: Object.freeze({ type: "theatrum-user-command" }),
});

function focusDetailedBasemap(map: MapLibreMap, basemap: DetailedBasemap): void {
  const [west, south, east, north] = basemap.focusBounds;
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: 56, duration: 900, essential: true },
    USER_CAMERA_EVENT_DATA,
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
  const cameraApplyGuardRef = useRef(new DocumentCameraApplyGuard());
  const documentCameraRef = useRef(documentCamera);
  /** Pacotes regionais de alta resolução realmente presentes no disco. */
  const [detailedBasemaps, setDetailedBasemaps] = useState<readonly DetailedBasemap[]>([]);
  /** Preferência desta máquina: preserva todos os dados e troca apenas os selos visíveis. */
  const [detailedPoiMode, setDetailedPoiMode] = useState<DetailedPoiMode>(loadDetailedPoiMode);
  /** Imagens de satélite achadas nesta máquina; vazio esconde as opções. */
  const [rasters, setRasters] = useState<readonly RasterBasemap[]>([]);
  const resolvedStyle = useMemo(
    () => resolveDocumentMapStyle(documentStyleId, detailedBasemaps, rasters),
    [detailedBasemaps, documentStyleId, rasters],
  );
  const resolvedStyleRef = useRef(resolvedStyle);
  const detailedPoiModeRef = useRef(detailedPoiMode);
  const playheadFrameRef = useRef(session.playheadFrame);
  const appliedWarTimelineFrameRef = useRef<number | null>(null);
  const mapResourceErrorRef = useRef<string | null>(null);
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
  detailedPoiModeRef.current = detailedPoiMode;
  playheadFrameRef.current = session.playheadFrame;

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
      const container = containerRef.current;
      const previewPixelRatio = previewPixelRatioForSize(
        window.devicePixelRatio,
        previewSupersampling,
        container?.clientWidth ?? 0,
        container?.clientHeight ?? 0,
      );
      map.setPixelRatio(effectivePixelRatio(override, previewPixelRatio));
      map.resize();
    },
    // O canvas de verdade, não o container: é ele que o compositor lê, e é ele que
    // o `maxCanvasSize` do MapLibre encolhe em silêncio acima do teto configurado.
    (override) => surfaceMatches(override, mapRef.current?.getCanvas() ?? null),
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
      style: styleSpecFor(resolvedStyleRef.current, detailedPoiModeRef.current),
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
    appliedStyleKeyRef.current = styleRenderKey(
      resolvedStyleRef.current,
      detailedPoiModeRef.current,
    );
    mapRef.current = map;
    setMapInstance(map);
    const releaseMapExportReadiness = bindMapExportReadiness(map, () => {
      const currentStyle = resolvedStyleRef.current;
      return documentMapStyleExportBlockReason(currentStyle) ?? mapResourceErrorRef.current;
    });
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

    let userMoveInProgress = false;
    const updateCamera = (): void => {
      setCamera(cameraFromMap(map));
      setCameraRevision((revision) => revision + 1);
    };
    const onMoveStart = (event: MapLibreMoveEventLike): void => {
      userMoveInProgress = isUserInitiatedMapMove(event);
      if (!cameraApplyGuardRef.current.applying && userMoveInProgress) editorActions.pause();
    };
    const onMoveEnd = (event: MapLibreMoveEventLike): void => {
      const shouldAuthor = userMoveInProgress || isUserInitiatedMapMove(event);
      userMoveInProgress = false;
      updateCamera();
      if (cameraApplyGuardRef.current.applying || !shouldAuthor) return;
      const nextCamera = cameraFromMap(map);
      if (!sameDocumentMapCamera(nextCamera, documentCameraRef.current)) {
        editorActions.setMapCamera(nextCamera);
      }
    };
    const onLoad = (): void => {
      updateCamera();
      const startedAt = performance.now();
      void settle(createMapLibreCameraPort(map), 2_000).then((result) => {
        if (mapResourceErrorRef.current !== null) return;
        if (result.settled) {
          setMapStatus(
            `${readyStatus(resolvedStyleRef.current, detailedPoiModeRef.current)} · settle ${(
              performance.now() - startedAt
            ).toFixed(0)} ms`,
          );
        } else {
          setMapStatus(`mapa local · settle ${result.reason}`);
        }
      });
    };
    const onStyleData = (): void => {
      if (map.isStyleLoaded() && mapResourceErrorRef.current === null) {
        setMapStatus(readyStatus(resolvedStyleRef.current, detailedPoiModeRef.current));
      }
    };
    // Camada 3D volta a cada setStyle: trocar de estilo descarta custom layers.
    const onStyleLoad = (): void => {
      attachScene3dLayer(map);
      appliedWarTimelineFrameRef.current = applyUkraineWarTimelineFrame(
        map,
        playheadFrameRef.current,
      );
    };
    const onError = (event: { readonly error?: Error }): void => {
      const message = event.error?.message ?? "falha desconhecida";
      mapResourceErrorRef.current = `falha em recurso do mapa local: ${message}`;
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
      releaseMapExportReadiness();
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

  /** Playhead → snapshot territorial, sem alterar o documento nem a câmera. */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    const dataFrame = warTimelineDataFrame(session.playheadFrame);
    const frontlineIsFading =
      session.playheadFrame >= UKRAINE_WAR_TIMELINE_FINAL_STATE_FRAME;
    if (appliedWarTimelineFrameRef.current === dataFrame && !frontlineIsFading) return;
    appliedWarTimelineFrameRef.current = applyUkraineWarTimelineFrame(
      map,
      session.playheadFrame,
    );
  }, [mapInstance, session.playheadFrame]);

  /** Estilo persistido → recurso local, com fallback visual explícito. */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    const nextKey = styleRenderKey(resolvedStyle, detailedPoiMode);
    if (appliedStyleKeyRef.current === nextKey) {
      if (mapResourceErrorRef.current === null) {
        setMapStatus(readyStatus(resolvedStyle, detailedPoiMode));
      }
      return;
    }
    appliedStyleKeyRef.current = nextKey;
    mapResourceErrorRef.current = null;
    setMapStatus(
      resolvedStyle.available
        ? "aplicando estilo local…"
        : readyStatus(resolvedStyle, detailedPoiMode),
    );
    map.once("style.load", () => {
      if (appliedStyleKeyRef.current === nextKey && mapResourceErrorRef.current === null) {
        setMapStatus(readyStatus(resolvedStyle, detailedPoiMode));
      }
    });
    map.setStyle(styleSpecFor(resolvedStyle, detailedPoiMode), { diff: false });
  }, [detailedPoiMode, mapInstance, resolvedStyle]);

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
          USER_CAMERA_EVENT_DATA,
        );
      }
    }
  };

  const selectDetailedPoiMode = (nextMode: DetailedPoiMode): void => {
    setDetailedPoiMode(nextMode);
    storeDetailedPoiMode(nextMode);
    setMapStatus("aplicando selos do mapa…");
  };

  const goToHit = useCallback((hit: GazetteerHit) => {
    const map = mapRef.current;
    if (map === null) return;
    editorActions.pause();
    map.easeTo(
      {
        center: [hit.lngLat[0], hit.lngLat[1]],
        zoom: Math.max(map.getZoom(), 6.4),
        pitch: Math.min(map.getPitch(), 45),
        duration: 850,
        essential: true,
      },
      USER_CAMERA_EVENT_DATA,
    );
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
  const showUkrainePoliticalLegend =
    resolvedStyle.available &&
    resolvedStyle.kind === "detailed" &&
    resolvedStyle.basemap.id === "ukraine";
  const timelineMax = Math.max(0, (composition?.duration ?? 1) - 1);
  const timelineFps = composition?.fps ?? 60;

  return (
    <section
      className="map-viewport"
      data-map-status={!resolvedStyle.available || mapStatus.startsWith("erro") ? "error" : "ok"}
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

        <label className="map-viewport__field">
          <span>Selos</span>
          <select
            value={detailedPoiMode}
            onChange={(event) => selectDetailedPoiMode(event.target.value as DetailedPoiMode)}
            aria-label="Selos do mapa"
          >
            {DETAILED_POI_MODE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
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

      {showUkrainePoliticalLegend && (
        <aside className="map-viewport__legend" aria-label="Legenda territorial">
          <span className="map-viewport__legend-item">
            <span className="map-viewport__legend-swatch map-viewport__legend-swatch--ukraine" />
            Ucrânia
          </span>
          <span className="map-viewport__legend-item">
            <span className="map-viewport__legend-swatch map-viewport__legend-swatch--invaded" />
            Região invadida
          </span>
          <span className="map-viewport__legend-item">
            <span className="map-viewport__legend-swatch map-viewport__legend-swatch--behind-front" />
            Atrás da linha de frente
          </span>
          <span className="map-viewport__legend-item">
            <span className="map-viewport__legend-swatch map-viewport__legend-swatch--russia" />
            Rússia
          </span>
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
