import {
  apply,
  cameraKeyframe,
  createCameraTrack,
  evaluateCamera,
  settle,
  type CameraState,
  type SettleResult,
} from "@theatrum/camera";
import { frame } from "@theatrum/core-time";
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
  type MapStyleId,
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
import "maplibre-gl/dist/maplibre-gl.css";
import "./MapViewport.css";

const DEMO_FPS = 60;
const DEMO_DURATION_FRAMES = 360;
const WARSAW: CameraState = {
  center: [21.0122, 52.2297],
  zoom: 6.15,
  bearing: 350,
  pitch: 18,
};
const LENINGRAD: CameraState = {
  center: [30.3158, 59.9391],
  zoom: 7.05,
  bearing: 18,
  pitch: 56,
};

const DEMO_TRACK = createCameraTrack(WARSAW, [
  cameraKeyframe(frame(0), WARSAW),
  cameraKeyframe(frame(DEMO_DURATION_FRAMES), LENINGRAD),
]);

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
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function formatCamera(camera: CameraState): string {
  const longitude = camera.center[0].toFixed(3);
  const latitude = camera.center[1].toFixed(3);
  return `${longitude}°, ${latitude}° · z ${camera.zoom.toFixed(2)} · ${camera.bearing.toFixed(
    0,
  )}° · pitch ${camera.pitch.toFixed(0)}°`;
}

function formatTime(currentFrame: number): string {
  const seconds = currentFrame / DEMO_FPS;
  const wholeSeconds = Math.floor(seconds);
  const subframe = Math.floor((seconds - wholeSeconds) * DEMO_FPS);
  return `00:${String(wholeSeconds).padStart(2, "0")}:${String(subframe).padStart(2, "0")}`;
}

/**
 * Resolve a escolha do seletor no estilo concreto.
 *
 * Satélite cujo id sumiu — imagem removida do disco entre sessões — volta ao
 * relevo escuro em vez de deixar o mapa em branco. Perder o estilo é chato;
 * perder o mapa é pior.
 */
function styleSpecFor(choice: StyleChoice) {
  const parsed = parseStyleChoice(choice);
  if (parsed.kind === "detailed") {
    const basemap = detailedBasemapById(parsed.id);
    if (basemap !== undefined) return createDetailedMapStyle(basemap);
  }
  if (parsed.kind === "satellite") {
    const basemap = rasterBasemapById(parsed.id);
    if (basemap !== undefined) {
      const labelsBasemap = parsed.labels ? knownDetailedBasemaps()[0] : undefined;
      return createSatelliteStyle(basemap, {
        labels: parsed.labels,
        ...(labelsBasemap === undefined ? {} : { labelsBasemap }),
      });
    }
  }
  return createMapStyle((parsed.kind === "vector" ? parsed.id : "dark-relief") as MapStyleId);
}

function readyStatus(choice: StyleChoice): string {
  const parsed = parseStyleChoice(choice);
  if (parsed.kind === "detailed") {
    const basemap = detailedBasemapById(parsed.id);
    if (basemap !== undefined)
      return `offline detalhado · ruas e edifícios até z${basemap.maxZoom}`;
  }
  if (parsed.kind === "satellite") {
    const labels =
      parsed.labels && knownDetailedBasemaps().length > 0 ? " · híbrido detalhado" : "";
    return `satélite local pronto${labels}`;
  }
  return "offline pronto · mapa mundial z0–6";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const animationRef = useRef<number | null>(null);
  const playbackStartRef = useRef(0);
  const playbackFrameRef = useRef(0);
  const loopRef = useRef(false);
  const fpsRef = useRef({ startedAt: 0, frames: 0 });

  const [styleId, setStyleId] = useState<StyleChoice>("dark-relief");
  const selectedStyleRef = useRef<StyleChoice>("dark-relief");
  /** Pacotes regionais de alta resolução realmente presentes no disco. */
  const [detailedBasemaps, setDetailedBasemaps] = useState<readonly DetailedBasemap[]>([]);
  /** Imagens de satélite achadas nesta máquina; vazio esconde as opções. */
  const [rasters, setRasters] = useState<readonly RasterBasemap[]>([]);
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [cameraRevision, setCameraRevision] = useState(0);
  const [mapStatus, setMapStatus] = useState("iniciando mapa local…");
  const [camera, setCamera] = useState<CameraState>(WARSAW);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [resolution, setResolution] = useState<GazetteerResolution | null>(null);
  const gazetteerRef = useRef(new OfflineGazetteer(BUILTIN_GAZETTEER_PLACES));

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setIsPlaying(false);
    setFps(null);
  }, []);

  const applyFrame = useCallback((nextFrame: number) => {
    const map = mapRef.current;
    if (map === null) return;
    const boundedFrame = Math.max(0, Math.min(DEMO_DURATION_FRAMES, Math.round(nextFrame)));
    playbackFrameRef.current = boundedFrame;
    setCurrentFrame(boundedFrame);
    apply(createMapLibreCameraPort(map), evaluateCamera(DEMO_TRACK, frame(boundedFrame)));
  }, []);

  const animate = useCallback(
    (now: number) => {
      const elapsedFrames = ((now - playbackStartRef.current) / 1000) * DEMO_FPS;
      const nextFrame = Math.floor(elapsedFrames);

      if (fpsRef.current.startedAt === 0) fpsRef.current = { startedAt: now, frames: 0 };
      fpsRef.current.frames++;
      const fpsElapsed = now - fpsRef.current.startedAt;
      if (fpsElapsed >= 500) {
        setFps((fpsRef.current.frames * 1000) / fpsElapsed);
        fpsRef.current = { startedAt: now, frames: 0 };
      }

      if (nextFrame >= DEMO_DURATION_FRAMES) {
        applyFrame(DEMO_DURATION_FRAMES);
        if (loopRef.current) {
          playbackStartRef.current = now;
          fpsRef.current = { startedAt: now, frames: 0 };
          animationRef.current = requestAnimationFrame(animate);
        } else {
          animationRef.current = null;
          setIsPlaying(false);
        }
        return;
      }

      applyFrame(nextFrame);
      animationRef.current = requestAnimationFrame(animate);
    },
    [applyFrame],
  );

  const play = useCallback(() => {
    if (animationRef.current !== null) return;
    const initialFrame =
      playbackFrameRef.current >= DEMO_DURATION_FRAMES ? 0 : playbackFrameRef.current;
    if (initialFrame === 0) applyFrame(0);
    playbackStartRef.current = performance.now() - (initialFrame / DEMO_FPS) * 1000;
    fpsRef.current = { startedAt: 0, frames: 0 };
    setIsPlaying(true);
    animationRef.current = requestAnimationFrame(animate);
  }, [animate, applyFrame]);

  const pause = useCallback(() => {
    stopAnimation();
  }, [stopAnimation]);

  const stop = useCallback(() => {
    stopAnimation();
    applyFrame(0);
  }, [applyFrame, stopAnimation]);

  useEffect(() => {
    ensurePmtilesProtocol();
    const container = containerRef.current;
    if (container === null || mapRef.current !== null) return;

    const map = new maplibregl.Map({
      container,
      style: styleSpecFor(styleId),
      center: [WARSAW.center[0], WARSAW.center[1]],
      zoom: WARSAW.zoom,
      bearing: WARSAW.bearing,
      pitch: WARSAW.pitch,
      minZoom: 0,
      maxZoom: 18,
      maxPitch: 70,
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
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    });
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
    const onLoad = (): void => {
      updateCamera();
      const startedAt = performance.now();
      void settle(createMapLibreCameraPort(map), 2_000).then((result) => {
        if (result.settled) {
          setMapStatus(
            `${readyStatus(selectedStyleRef.current)} · settle ${(
              performance.now() - startedAt
            ).toFixed(0)} ms`,
          );
        } else {
          setMapStatus(`mapa local · settle ${result.reason}`);
        }
      });
    };
    const onStyleData = (): void => {
      if (map.isStyleLoaded()) setMapStatus(readyStatus(selectedStyleRef.current));
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
    map.on("move", updateCamera);
    map.on("styledata", onStyleData);
    map.on("style.load", onStyleLoad);
    map.on("error", onError);

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    return () => {
      stopAnimation();
      resizeObserver.disconnect();
      map.off("load", onLoad);
      map.off("move", updateCamera);
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
  }, [stopAnimation]);

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

  useEffect(() => {
    loopRef.current = isLooping;
  }, [isLooping]);

  // Pacotes regionais e imagens de satélite são opcionais e locais: a ausência
  // simplesmente não acrescenta opções ao seletor.
  useEffect(() => {
    let active = true;
    void Promise.all([loadDetailedBasemaps(), loadRasterBasemaps()]).then(
      ([foundDetailed, foundRasters]) => {
        if (!active) return;
        setDetailedBasemaps(foundDetailed);
        setRasters(foundRasters);

        // Esta instalação já traz o recorte Irã–Hormuz: abre diretamente nele,
        // sem obrigar o usuário a descobrir a opção antes de ver o ganho.
        const initial = foundDetailed[0];
        const map = mapRef.current;
        if (initial !== undefined && map !== null && selectedStyleRef.current === "dark-relief") {
          const choice = `detail:${initial.id}`;
          selectedStyleRef.current = choice;
          setStyleId(choice);
          setMapStatus("abrindo Irã e Estreito de Hormuz…");
          map.setStyle(createDetailedMapStyle(initial), { diff: false });
          focusDetailedBasemap(map, initial);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const selectStyle = (nextStyle: StyleChoice): void => {
    selectedStyleRef.current = nextStyle;
    setStyleId(nextStyle);
    setMapStatus("aplicando estilo local…");
    const map = mapRef.current;
    if (map === null) return;
    map.setStyle(styleSpecFor(nextStyle), { diff: false });

    const parsed = parseStyleChoice(nextStyle);
    if (parsed.kind === "detailed") {
      const basemap = detailedBasemapById(parsed.id);
      if (basemap !== undefined) {
        stopAnimation();
        focusDetailedBasemap(map, basemap);
      }
    } else if (parsed.kind === "satellite") {
      const basemap = rasterBasemapById(parsed.id);
      if (basemap?.bounds !== undefined) {
        const [west, south, east, north] = basemap.bounds;
        stopAnimation();
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

  const goToHit = useCallback(
    (hit: GazetteerHit) => {
      const map = mapRef.current;
      if (map === null) return;
      stopAnimation();
      map.easeTo({
        center: [hit.lngLat[0], hit.lngLat[1]],
        zoom: Math.max(map.getZoom(), 6.4),
        pitch: Math.min(map.getPitch(), 45),
        duration: 850,
        essential: true,
      });
      setResolution({ status: "resolved", query: hit.name, hit });
    },
    [stopAnimation],
  );

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
            value={styleId}
            onChange={(event) => selectStyle(event.target.value as StyleChoice)}
            aria-label="Estilo do mapa"
          >
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
        {fps !== null && (
          <>
            <span className="map-viewport__readout-divider" />
            <span>{fps.toFixed(0)} fps</span>
          </>
        )}
      </div>

      <div className="map-viewport__transport">
        <div className="map-viewport__transport-buttons">
          <Button size="sm" iconOnly aria-label="Parar" onClick={stop}>
            ■
          </Button>
          <Button
            size="sm"
            iconOnly
            variant={isPlaying ? "primary" : "default"}
            aria-label={isPlaying ? "Pausar" : "Reproduzir"}
            onClick={isPlaying ? pause : play}
          >
            {isPlaying ? "Ⅱ" : "▶"}
          </Button>
          <label className="map-viewport__loop">
            <input
              type="checkbox"
              checked={isLooping}
              onChange={(event) => setIsLooping(event.target.checked)}
            />
            Loop
          </label>
        </div>

        <span className="map-viewport__time">{formatTime(currentFrame)}</span>
        <input
          className="map-viewport__scrub"
          type="range"
          min={0}
          max={DEMO_DURATION_FRAMES}
          step={1}
          value={currentFrame}
          aria-label="Tempo da animação de câmera"
          onChange={(event) => {
            stopAnimation();
            applyFrame(Number(event.target.value));
          }}
        />
        <span className="map-viewport__route">Varsóvia → Leningrado</span>
      </div>
    </section>
  );
}
