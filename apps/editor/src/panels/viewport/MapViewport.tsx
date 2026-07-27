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
import { createMapStyle, MAP_STYLE_OPTIONS, type MapStyleId } from "./map-styles.js";
import { attachModel3dLayer, detachModel3dLayer } from "./model3d-layer.js";
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

export function MapViewport(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const animationRef = useRef<number | null>(null);
  const playbackStartRef = useRef(0);
  const playbackFrameRef = useRef(0);
  const loopRef = useRef(false);
  const fpsRef = useRef({ startedAt: 0, frames: 0 });

  const [styleId, setStyleId] = useState<MapStyleId>("dark-relief");
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
      style: createMapStyle(styleId),
      center: [WARSAW.center[0], WARSAW.center[1]],
      zoom: WARSAW.zoom,
      bearing: WARSAW.bearing,
      pitch: WARSAW.pitch,
      minZoom: 0,
      maxZoom: 18,
      maxPitch: 70,
      attributionControl: false,
      fadeDuration: 0,
    });
    mapRef.current = map;
    setMapInstance(map);
    if (import.meta.env.DEV) {
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
    map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: "Natural Earth" }),
      "bottom-left",
    );

    const updateCamera = (): void => {
      setCamera(cameraFromMap(map));
      setCameraRevision((revision) => revision + 1);
    };
    const onLoad = (): void => {
      updateCamera();
      const startedAt = performance.now();
      void settle(createMapLibreCameraPort(map), 2_000).then((result) => {
        if (result.settled) {
          setMapStatus(`offline pronto · settle ${(performance.now() - startedAt).toFixed(0)} ms`);
        } else {
          setMapStatus(`mapa local · settle ${result.reason}`);
        }
      });
    };
    const onStyleData = (): void => {
      if (map.isStyleLoaded()) setMapStatus("offline pronto · PMTiles z0–6");
    };
    // Camada 3D volta a cada setStyle: trocar de estilo descarta custom layers.
    const onStyleLoad = (): void => {
      attachModel3dLayer(map);
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
      detachModel3dLayer(map);
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
      if (import.meta.env.DEV) {
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

  const selectStyle = (nextStyle: MapStyleId): void => {
    setStyleId(nextStyle);
    setMapStatus("aplicando estilo local…");
    mapRef.current?.setStyle(createMapStyle(nextStyle), { diff: false });
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
            onChange={(event) => selectStyle(event.target.value as MapStyleId)}
            aria-label="Estilo do mapa"
          >
            {MAP_STYLE_OPTIONS.map((option) => (
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
