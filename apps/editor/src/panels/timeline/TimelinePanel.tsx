import { BUILTIN_BEHAVIORS } from "@theatrum/behaviors";
import { hashObject } from "@theatrum/core-utils";
import { format, frame, timeBase } from "@theatrum/core-time";
import type { ReferenceAudioAnalysis } from "@theatrum/engine";
import type { NodeTypeRegistry } from "@theatrum/scene-graph";
import { assetDisplayName } from "@theatrum/assets";
import {
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
  type WheelEvent,
} from "react";
import { useWorkspaceContentMode } from "../../app/workspace-content-mode.js";
import {
  clearReferenceAudioAnalysisCache,
  loadReferenceAudioAnalysis,
} from "../../audio/reference-audio-analysis.js";
import { editorActions, nodeTypeRegistry } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
import { cachedPreviewFrames, subscribePreviewCache } from "../../preview/preview-cache-session.js";
import { Button, Panel } from "../../ui/index.js";
import {
  DEFAULT_TIMELINE_THEME,
  buildTimelineHitIndex,
  renderTimeline,
  snapFrame,
  xToFrame,
  zoomAroundPoint,
  type TimelineHit,
  type TimelineRenderStats,
  type TimelineTheme,
  type TimelineViewState,
  type TimelineViewport,
} from "./timeline-canvas.js";
import { buildStudioTimelineProjection, findStudioStageNodeId } from "./studio-timeline-model.js";
import {
  TIMELINE_ROW_HEIGHT,
  TIMELINE_RULER_HEIGHT,
  buildTimelineModel,
  type TimelineModel,
} from "./timeline-model.js";
import {
  enterTimelineComposition,
  updateTimelineSessionState,
  useTimelineSessionState,
} from "./timeline-session-state.js";
import { visibleWaveformBars } from "./reference-audio-waveform.js";
import { previewFrameRanges } from "./preview-cache-ranges.js";
import "./TimelinePanel.css";

const AUDIO_WAVEFORM_HEIGHT = 44;

/** Rótulo de comportamento vem do registry; a timeline só recebe o mapa pronto. */
const BEHAVIOR_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(BUILTIN_BEHAVIORS.map((behavior) => [behavior.type, behavior.label] as const)),
);
export interface TimelinePanelProps {
  readonly registry?: NodeTypeRegistry;
}

type DragState =
  { readonly kind: "playhead" } | { readonly kind: "keyframe"; readonly hit: TimelineHit };

type AudioAnalysisStatus =
  | { readonly kind: "idle"; readonly message: "" }
  | { readonly kind: "loading" | "ready" | "error"; readonly message: string };

const IDLE_AUDIO_STATUS: AudioAnalysisStatus = Object.freeze({ kind: "idle", message: "" });

export function TimelinePanel({ registry = nodeTypeRegistry }: TimelinePanelProps): ReactNode {
  const session = useEditorSession();
  const contentMode = useWorkspaceContentMode();
  const composition = useMemo(
    () =>
      session.document.compositions.find(
        (candidate) => candidate.id === session.selectedCompositionId,
      ) ?? session.document.compositions[0],
    [session.document, session.selectedCompositionId],
  );
  const stageNodeId = useMemo(
    () => (composition === undefined ? null : findStudioStageNodeId(composition)),
    [composition],
  );
  const timelineState = useTimelineSessionState(contentMode);
  const { expandedNodeIds, scrollY, view } = timelineState;
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [audioAnalysis, setAudioAnalysis] = useState<ReferenceAudioAnalysis | null>(null);
  const [audioStatus, setAudioStatus] = useState<AudioAnalysisStatus>(IDLE_AUDIO_STATUS);
  const [previewCacheVersion, setPreviewCacheVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const canvasPaneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameStateRef = useRef<TimelineFrameState>(EMPTY_FRAME_STATE);
  const audioAssets = useMemo(
    () => session.document.assets.filter((asset) => asset.kind === "audio"),
    [session.document.assets],
  );
  const referenceAudioAsset = useMemo(
    () =>
      composition?.referenceAudio === undefined || composition.referenceAudio === null
        ? undefined
        : session.document.assets.find(
            (asset) => asset.src === composition.referenceAudio?.assetSrc,
          ),
    [composition?.referenceAudio, session.document.assets],
  );
  const hasReferenceAudio = composition?.referenceAudio != null;
  const documentFingerprint = useMemo(() => hashObject(session.document), [session.document]);
  const cachedRanges = useMemo(
    () =>
      previewFrameRanges(
        composition === undefined ? [] : cachedPreviewFrames(composition.id, documentFingerprint),
      ),
    [composition?.id, documentFingerprint, previewCacheVersion],
  );

  useEffect(
    () => subscribePreviewCache(() => setPreviewCacheVersion((version) => version + 1)),
    [],
  );

  useEffect(() => {
    enterTimelineComposition(
      contentMode,
      composition?.id ?? null,
      composition === undefined
        ? []
        : contentMode === "studio"
          ? stageNodeId === null
            ? []
            : [stageNodeId]
          : [composition.root],
    );
  }, [composition?.id, composition?.root, contentMode, stageNodeId]);

  useEffect(() => {
    if (session.selectedNodeIds.length === 0) return;
    setExpandedNodeIds((current) => new Set([...current, ...session.selectedNodeIds]));
  }, [contentMode, session.selectedNodeIds]);

  useEffect(() => {
    const element = canvasPaneRef.current;
    if (element === null) return;
    const resize = (): void => {
      const bounds = element.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(bounds.width)),
        height: Math.max(
          1,
          Math.floor(bounds.height) - (hasReferenceAudio ? AUDIO_WAVEFORM_HEIGHT : 0),
        ),
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasReferenceAudio]);

  useEffect(() => {
    const reference = composition?.referenceAudio;
    if (composition === undefined || reference === undefined || reference === null) {
      setAudioAnalysis(null);
      setAudioStatus(IDLE_AUDIO_STATUS);
      return;
    }
    if (referenceAudioAsset === undefined) {
      setAudioAnalysis(null);
      setAudioStatus({
        kind: "error",
        message: "O áudio de referência não está disponível na Biblioteca.",
      });
      return;
    }
    let cancelled = false;
    setAudioAnalysis(null);
    setAudioStatus({ kind: "loading", message: "Analisando áudio de referência…" });
    void loadReferenceAudioAnalysis({
      assetSrc: reference.assetSrc,
      name: assetDisplayName(referenceAudioAsset),
      fps: composition.fps,
      startFrame: reference.startFrame,
    }).then(
      (analysis) => {
        if (cancelled) return;
        setAudioAnalysis(analysis);
        setAudioStatus({
          kind: "ready",
          message: `Waveform pronta: ${analysis.track.durationFrames} frames, sem reprodução.`,
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        setAudioStatus({
          kind: "error",
          message:
            error instanceof Error ? `Áudio indisponível: ${error.message}` : "Áudio indisponível.",
        });
      },
    );
    return () => {
      cancelled = true;
      clearReferenceAudioAnalysisCache(reference.assetSrc);
    };
  }, [composition?.fps, composition?.referenceAudio, referenceAudioAsset]);

  const projection = useMemo<TimelineProjection>(() => {
    if (composition === undefined) return EMPTY_PROJECTION;
    const options = {
      expandedNodeIds,
      selectedNodeIds: new Set(session.selectedNodeIds),
      behaviorLabels: BEHAVIOR_LABELS,
    };
    if (contentMode === "studio") {
      return buildStudioTimelineProjection(composition, registry, options);
    }
    return {
      model: buildTimelineModel(composition, registry, options),
      diagnostic: null,
    };
  }, [composition, contentMode, expandedNodeIds, registry, session.selectedNodeIds]);
  const model = projection.model;
  const diagnostic = projection.diagnostic;
  const setExpandedNodeIds = (update: SetStateAction<ReadonlySet<string>>): void => {
    updateTimelineSessionState(contentMode, (current) => ({
      ...current,
      expandedNodeIds: resolveStateAction(update, current.expandedNodeIds),
    }));
  };
  const setView = (update: SetStateAction<TimelineViewState>): void => {
    updateTimelineSessionState(contentMode, (current) => ({
      ...current,
      view: resolveStateAction(update, current.view),
    }));
  };
  const setScrollY = (update: SetStateAction<number>): void => {
    updateTimelineSessionState(contentMode, (current) => ({
      ...current,
      scrollY: resolveStateAction(update, current.scrollY),
    }));
  };
  const cueCount = useMemo(
    () => model.tracks.reduce((total, track) => total + track.cues.length, 0),
    [model],
  );
  const viewport = useMemo<TimelineViewport>(
    () => ({
      width: size.width,
      height: size.height,
      startFrame: view.startFrame,
      pixelsPerFrame: view.pixelsPerFrame,
      scrollY,
    }),
    [scrollY, size.height, size.width, view.pixelsPerFrame, view.startFrame],
  );
  const hitIndex = useMemo(() => buildTimelineHitIndex(model, viewport), [model, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const deviceScale = Math.max(1, window.devicePixelRatio);
    canvas.width = Math.round(size.width * deviceScale);
    canvas.height = Math.round(size.height * deviceScale);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    renderTimeline(context, model, viewport, session.playheadFrame, readTheme());
  }, [model, session.playheadFrame, size.height, size.width, viewport]);

  useEffect(() => {
    const canvas = audioCanvasRef.current;
    if (canvas === null) return;
    const height = AUDIO_WAVEFORM_HEIGHT;
    const deviceScale = Math.max(1, window.devicePixelRatio);
    canvas.width = Math.round(size.width * deviceScale);
    canvas.height = Math.round(height * deviceScale);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    context.clearRect(0, 0, size.width, height);
    if (audioAnalysis === null) return;
    context.fillStyle = "rgba(8, 18, 28, 0.82)";
    context.fillRect(0, 0, size.width, height);
    context.strokeStyle = "rgba(107, 211, 255, 0.25)";
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(size.width, height / 2);
    context.stroke();
    context.fillStyle = "rgba(91, 205, 255, 0.72)";
    for (const bar of visibleWaveformBars(audioAnalysis, view, size.width, height)) {
      context.fillRect(
        bar.x,
        bar.minY,
        Math.max(1, Math.min(bar.width, 3)),
        Math.max(1, bar.maxY - bar.minY),
      );
    }
  }, [audioAnalysis, size.width, view]);

  frameStateRef.current = { model, viewport, contentMode, diagnostic };

  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_THEATRUM_VERIFY === "1")) return;
    const debug: TimelineDebugSurface = Object.freeze({
      summary: () => describeTimeline(frameStateRef.current),
      measureRedraw: (samples = 120, options: TimelineRedrawOptions = {}) => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d") ?? null;
        const state = frameStateRef.current;
        if (canvas === null || context === null) {
          throw new Error("Canvas da timeline indisponível.");
        }
        const theme = readTheme();
        // `height` simula um painel maior; `fitDuration` põe a duração inteira
        // na faixa horizontal, de modo que nenhum keyframe seja descartado por
        // estar fora do tempo visível; `scrollY` escolhe a região medida.
        const resized = options.height !== undefined || options.fitDuration === true;
        const viewport: TimelineViewport = {
          ...state.viewport,
          ...(options.height === undefined ? {} : { height: options.height }),
          ...(options.fitDuration === true
            ? {
                startFrame: 0,
                pixelsPerFrame: state.viewport.width / Math.max(1, state.model.duration),
              }
            : {}),
          ...(options.scrollY === undefined ? {} : { scrollY: options.scrollY }),
        };
        const restore = { width: canvas.width, height: canvas.height };
        if (resized) {
          // Escala 1 de propósito: em HiDPI um backing store dessa altura
          // passaria de 30 M de pixels sem mudar o que está sendo medido.
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          context.setTransform(1, 0, 0, 1, 0, 0);
        }
        const durations: number[] = [];
        let stats: TimelineRenderStats | null = null;
        for (let index = 0; index < samples; index += 1) {
          // Scrub real: o playhead atravessa a duração inteira, então cada
          // amostra redesenha réguas, barras, keyframes e marcadores.
          const playhead = Math.round((index / Math.max(1, samples - 1)) * state.model.duration);
          const startedAt = performance.now();
          stats = renderTimeline(context, state.model, viewport, playhead, theme);
          durations.push(performance.now() - startedAt);
        }
        if (resized) {
          canvas.width = restore.width;
          canvas.height = restore.height;
          const deviceScale = Math.max(1, window.devicePixelRatio);
          context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
          renderTimeline(context, state.model, state.viewport, 0, theme);
        }
        durations.sort((left, right) => left - right);
        const at = (ratio: number): number =>
          durations[Math.min(durations.length - 1, Math.floor(ratio * durations.length))] ?? 0;
        return {
          ...describeTimeline(state),
          samples,
          measuredHeight: viewport.height,
          measuredPixelsPerFrame: viewport.pixelsPerFrame,
          measuredScrollY: viewport.scrollY,
          p50Ms: at(0.5),
          p95Ms: at(0.95),
          maxMs: durations.at(-1) ?? 0,
          drawn: {
            tracks: stats?.tracksDrawn ?? 0,
            keyframes: stats?.keyframesDrawn ?? 0,
            keyframesVisited: stats?.keyframesVisited ?? 0,
          },
        };
      },
    });
    Object.defineProperty(window, "__theatrumPhase4Timeline", {
      value: debug,
      configurable: true,
    });
    return () => {
      if (window.__theatrumPhase4Timeline === debug) {
        Reflect.deleteProperty(window, "__theatrumPhase4Timeline");
      }
    };
  }, []);

  const maxScroll = Math.max(
    0,
    model.tracks.length * TIMELINE_ROW_HEIGHT - (size.height - TIMELINE_RULER_HEIGHT),
  );
  useEffect(() => {
    if (scrollY > maxScroll) setScrollY(maxScroll);
  }, [contentMode, maxScroll, scrollY]);
  const firstVisibleTrack = Math.max(0, Math.floor(scrollY / TIMELINE_ROW_HEIGHT));
  const lastVisibleTrack = Math.min(
    model.tracks.length,
    Math.ceil((scrollY + size.height) / TIMELINE_ROW_HEIGHT) + 1,
  );
  const visibleTracks = model.tracks.slice(firstVisibleTrack, lastVisibleTrack);

  const setPointerFrame = (x: number, excludedKeyframeId?: string): number => {
    const raw = xToFrame(x, viewport);
    const value = snapEnabled
      ? snapFrame(raw, model, view.pixelsPerFrame, 6, excludedKeyframeId)
      : Math.max(0, Math.min(model.duration, Math.round(raw)));
    editorActions.setPlayhead(value);
    return value;
  };

  const pointerPosition = (event: PointerEvent<HTMLCanvasElement>): readonly [number, number] => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top];
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = pointerPosition(event);
    const hit = hitIndex.hitTest(x, y);
    if (hit !== null) {
      const track = model.tracks.find((candidate) => candidate.id === hit.trackId);
      editorActions.selectNode(session.selectedCompositionId, hit.nodeId, event.shiftKey);
      if (track?.locked !== true) {
        dragRef.current = { kind: "keyframe", hit };
        setPointerFrame(x, hit.keyframeId);
        return;
      }
    }
    dragRef.current = { kind: "playhead" };
    setPointerFrame(x);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    const [x] = pointerPosition(event);
    setPointerFrame(x, drag.kind === "keyframe" ? drag.hit.keyframeId : undefined);
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind !== "keyframe") return;
    const [x] = pointerPosition(event);
    const nextFrame = setPointerFrame(x, drag.hit.keyframeId);
    if (nextFrame === drag.hit.frame) return;
    editorActions.movePropertyKeyframe(
      drag.hit.nodeId,
      drag.hit.propertyPath,
      drag.hit.keyframeId,
      nextFrame,
    );
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const canvasX = Math.max(
      0,
      event.clientX - (canvasPaneRef.current?.getBoundingClientRect().left ?? 0),
    );
    if (event.ctrlKey) {
      const next = zoomAroundPoint(view, Math.exp(-event.deltaY * 0.002), canvasX);
      setView(clampView(next, model.duration, size.width));
      return;
    }
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const delta = event.deltaX === 0 ? event.deltaY : event.deltaX;
      setView((current) =>
        clampView(
          {
            ...current,
            startFrame: current.startFrame + delta / current.pixelsPerFrame,
          },
          model.duration,
          size.width,
        ),
      );
      return;
    }
    setScrollY((current) => Math.max(0, Math.min(maxScroll, current + event.deltaY)));
  };

  const toggleExpanded = (nodeId: string): void => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <Panel
      title={contentMode === "studio" ? "Timeline · Palco" : "Timeline · Mapa"}
      scroll={false}
      toolbar={
        <>
          <Button
            size="sm"
            iconOnly
            aria-label={session.isPlaying ? "Pausar" : "Reproduzir"}
            title={session.isPlaying ? "Pausar" : "Reproduzir"}
            onClick={() => editorActions.togglePlayback()}
          >
            {session.isPlaying ? "Ⅱ" : "▶"}
          </Button>
          <Button
            size="sm"
            iconOnly
            aria-label="Parar"
            title="Parar"
            onClick={() => editorActions.stop()}
          >
            ■
          </Button>
          <label className="timeline-panel__toggle">
            <input
              type="checkbox"
              checked={session.loopPlayback}
              onChange={(event) => editorActions.setLoop(event.target.checked)}
            />
            Loop
          </label>
          <label className="timeline-panel__toggle">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(event) => setSnapEnabled(event.target.checked)}
            />
            Snap
          </label>
          <select
            className="timeline-panel__audio-select"
            aria-label="Áudio de referência"
            value={composition?.referenceAudio?.assetSrc ?? ""}
            onChange={(event) =>
              editorActions.setReferenceAudio(
                event.target.value === "" ? null : event.target.value,
                session.playheadFrame,
              )
            }
          >
            <option value="">Sem áudio</option>
            {audioAssets.map((asset) => (
              <option value={asset.src} key={asset.id}>
                {assetDisplayName(asset)}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => audioInputRef.current?.click()}>
            Áudio…
          </Button>
          <input
            ref={audioInputRef}
            className="timeline-panel__audio-input"
            type="file"
            accept=".wav,.mp3,.ogg,.m4a,audio/wav,audio/mpeg,audio/ogg,audio/mp4"
            aria-label="Importar áudio de referência"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file === undefined) return;
              void editorActions.importAssetFiles([file]).then((sources) => {
                const source = sources.at(-1);
                if (source !== undefined) {
                  editorActions.setReferenceAudio(source, session.playheadFrame);
                }
              });
            }}
          />
          <output className="timeline-panel__timecode" aria-label="Tempo atual">
            {format(frame(session.playheadFrame), timeBase(model.fps), "timecode")}
          </output>
          <input
            className="timeline-panel__frame"
            type="number"
            min={0}
            max={model.duration}
            value={session.playheadFrame}
            aria-label="Frame atual"
            onChange={(event) => editorActions.setPlayhead(event.target.valueAsNumber)}
          />
          <input
            className="timeline-panel__zoom"
            type="range"
            min={-3}
            max={4.38}
            step={0.02}
            value={Math.log(view.pixelsPerFrame)}
            aria-label="Zoom da timeline"
            onChange={(event) => {
              setView((current) =>
                clampView(
                  zoomAroundPoint(
                    current,
                    Math.exp(event.target.valueAsNumber) / current.pixelsPerFrame,
                    size.width / 2,
                  ),
                  model.duration,
                  size.width,
                ),
              );
            }}
          />
        </>
      }
      footer={
        <span>
          {model.tracks.length} trilhas · {countKeyframes(model)} keyframes ·{" "}
          {cueCount > 0 ? `${String(cueCount)} paradas · ` : ""}
          {view.pixelsPerFrame.toFixed(2)} px/frame
        </span>
      }
    >
      <div className="timeline-panel" data-mode={contentMode} onWheel={onWheel}>
        <div className="timeline-panel__headers" aria-label="Cabeçalhos das trilhas">
          <div className="timeline-panel__corner">
            {contentMode === "studio" ? "Palco" : "Camadas"}
          </div>
          <div
            className="timeline-panel__header-list"
            style={{ height: model.tracks.length * TIMELINE_ROW_HEIGHT }}
          >
            {visibleTracks.map((track, visibleIndex) => {
              const trackIndex = firstVisibleTrack + visibleIndex;
              return (
                <div
                  className="timeline-panel__track-header"
                  data-kind={track.kind}
                  data-selected={track.selected || undefined}
                  key={track.id}
                  style={{
                    top: trackIndex * TIMELINE_ROW_HEIGHT - scrollY,
                    paddingInlineStart: 4 + Math.min(track.depth, 8) * 11,
                  }}
                >
                  {track.kind === "node" ? (
                    <>
                      <button
                        type="button"
                        className="timeline-panel__disclosure"
                        aria-label={
                          expandedNodeIds.has(track.nodeId)
                            ? "Recolher propriedades"
                            : "Expandir propriedades"
                        }
                        aria-expanded={expandedNodeIds.has(track.nodeId)}
                        onClick={() => toggleExpanded(track.nodeId)}
                      >
                        {expandedNodeIds.has(track.nodeId) ? "▾" : "▸"}
                      </button>
                      <button
                        type="button"
                        className="timeline-panel__flag"
                        aria-label={track.enabled ? "Ocultar camada" : "Mostrar camada"}
                        data-active={track.enabled || undefined}
                        onClick={() =>
                          editorActions.dispatch({
                            type: "node.set-flags",
                            source: "user",
                            payload: {
                              compositionId: session.selectedCompositionId,
                              nodeId: track.nodeId,
                              flags: { enabled: !track.enabled },
                            },
                          })
                        }
                      >
                        ◉
                      </button>
                      <button
                        type="button"
                        className="timeline-panel__flag"
                        aria-label={track.locked ? "Desbloquear camada" : "Bloquear camada"}
                        data-active={track.locked || undefined}
                        onClick={() =>
                          editorActions.dispatch({
                            type: "node.set-flags",
                            source: "user",
                            payload: {
                              compositionId: session.selectedCompositionId,
                              nodeId: track.nodeId,
                              flags: { locked: !track.locked },
                            },
                          })
                        }
                      >
                        ◆
                      </button>
                    </>
                  ) : track.kind === "guide" ? (
                    <span className="timeline-panel__guide-dot" aria-hidden="true">
                      ◎
                    </span>
                  ) : (
                    <span className="timeline-panel__property-dot" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className="timeline-panel__track-name"
                    title={track.label}
                    onClick={(event) =>
                      editorActions.selectNode(
                        session.selectedCompositionId,
                        track.nodeId,
                        event.shiftKey,
                      )
                    }
                  >
                    {track.label}
                  </button>
                </div>
              );
            })}
          </div>
          {hasReferenceAudio && (
            <div
              className="timeline-panel__audio-header"
              data-status={audioStatus.kind}
              title={audioStatus.message}
              role={audioStatus.kind === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              ♫{" "}
              {audioStatus.kind === "loading" || audioStatus.kind === "error"
                ? audioStatus.message
                : referenceAudioAsset === undefined
                  ? "Áudio ausente"
                  : assetDisplayName(referenceAudioAsset)}
            </div>
          )}
        </div>

        <div className="timeline-panel__canvas-pane" ref={canvasPaneRef}>
          <div
            className="timeline-panel__preview-cache"
            aria-label={`${cachedRanges.reduce(
              (total, range) => total + range.endFrameExclusive - range.startFrame,
              0,
            )} frames com preview em memória`}
          >
            {cachedRanges.map((range) => {
              const left = Math.max(0, (range.startFrame - view.startFrame) * view.pixelsPerFrame);
              const right = Math.min(
                size.width,
                (range.endFrameExclusive - view.startFrame) * view.pixelsPerFrame,
              );
              if (right <= left) return null;
              return (
                <span
                  key={`${range.startFrame}:${range.endFrameExclusive}`}
                  style={{ left, width: Math.max(1, right - left) }}
                />
              );
            })}
          </div>
          <canvas
            ref={canvasRef}
            className="timeline-panel__canvas"
            aria-label={`Timeline com ${model.tracks.length} trilhas e ${countKeyframes(model)} keyframes`}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                editorActions.setPlayhead(
                  session.playheadFrame + (event.key === "ArrowLeft" ? -1 : 1),
                );
              }
            }}
          />
          {hasReferenceAudio && (
            <canvas
              ref={audioCanvasRef}
              className="timeline-panel__audio-waveform"
              aria-label="Forma de onda do áudio de referência sincronizada por frame"
            />
          )}
          <output className="timeline-panel__accessible" aria-live="polite">
            {audioStatus.message}
          </output>
          <AccessibleKeyframes model={model} />
          {diagnostic !== null && (
            <p className="timeline-panel__empty" role="status">
              {diagnostic}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

const AccessibleKeyframes = memo(function AccessibleKeyframes({
  model,
}: {
  readonly model: TimelineModel;
}): ReactNode {
  const keyframes = model.tracks.flatMap((track) =>
    track.keyframes.map((keyframe) => ({ track, keyframe })),
  );
  const shown = keyframes.slice(0, 200);
  const cues = model.tracks.flatMap((track) => track.cues);
  return (
    <div className="timeline-panel__accessible" aria-label="Keyframes acessíveis">
      {shown.map(({ track, keyframe }) => (
        <button
          type="button"
          key={`${track.id}:${keyframe.id}`}
          onClick={() => editorActions.setPlayhead(keyframe.frame)}
        >
          {track.label}, frame {keyframe.frame}, easing {keyframe.easing}
        </button>
      ))}
      {keyframes.length > shown.length && (
        <span>{keyframes.length - shown.length} keyframes adicionais; use a busca e o zoom.</span>
      )}
      {cues.map((cue) => (
        <button
          type="button"
          key={cue.id}
          onClick={() => editorActions.setPlayhead(cue.arrivalFrame)}
        >
          Parada {cue.ordinal}, {cue.label}, frame {cue.arrivalFrame}
        </button>
      ))}
    </div>
  );
});

interface TimelineFrameState {
  readonly model: TimelineModel;
  readonly viewport: TimelineViewport;
  readonly contentMode: "map" | "studio";
  readonly diagnostic: string | null;
}

interface TimelineSummary {
  readonly mode: "map" | "studio";
  readonly tracks: number;
  readonly keyframes: number;
  readonly cues: number;
  readonly duration: number;
  readonly pixelsPerFrame: number;
  readonly width: number;
  readonly height: number;
  readonly diagnostic: string | null;
  readonly rows: readonly {
    readonly id: string;
    readonly kind: "node" | "property" | "guide";
    readonly nodeId: string;
    readonly propertyPath: string | null;
    readonly label: string;
    readonly cues: number;
  }[];
}

interface TimelineRedrawReport extends TimelineSummary {
  readonly samples: number;
  readonly measuredHeight: number;
  readonly measuredPixelsPerFrame: number;
  readonly measuredScrollY: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  /** Contadores reais do último redraw: culling aparece no relatório. */
  readonly drawn: {
    readonly tracks: number;
    readonly keyframes: number;
    readonly keyframesVisited: number;
  };
}

interface TimelineRedrawOptions {
  /** Altura de painel a simular; o canvas é redimensionado para ela. */
  readonly height?: number;
  /** Põe a duração inteira na largura visível: nada sai por culling temporal. */
  readonly fitDuration?: boolean;
  readonly scrollY?: number;
}

interface TimelineDebugSurface {
  readonly summary: () => TimelineSummary;
  readonly measureRedraw: (
    samples?: number,
    options?: TimelineRedrawOptions,
  ) => TimelineRedrawReport;
}

declare global {
  interface Window {
    __theatrumPhase4Timeline?: TimelineDebugSurface;
  }
}

function describeTimeline(state: TimelineFrameState): TimelineSummary {
  return {
    mode: state.contentMode,
    tracks: state.model.tracks.length,
    keyframes: countKeyframes(state.model),
    cues: state.model.tracks.reduce((total, track) => total + track.cues.length, 0),
    duration: state.model.duration,
    pixelsPerFrame: state.viewport.pixelsPerFrame,
    width: state.viewport.width,
    height: state.viewport.height,
    diagnostic: state.diagnostic,
    rows: state.model.tracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      nodeId: track.nodeId,
      propertyPath: track.propertyPath,
      label: track.label,
      cues: track.cues.length,
    })),
  };
}

function countKeyframes(model: TimelineModel): number {
  let total = 0;
  for (const track of model.tracks) total += track.keyframes.length;
  return total;
}

function clampView(
  view: TimelineViewState,
  duration: number,
  viewportWidth: number,
): TimelineViewState {
  const visibleDuration = viewportWidth / view.pixelsPerFrame;
  return {
    ...view,
    startFrame: Math.max(0, Math.min(Math.max(0, duration - visibleDuration), view.startFrame)),
  };
}

function readTheme(): TimelineTheme {
  if (cachedTheme !== null) return cachedTheme;
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  cachedTheme = {
    ...DEFAULT_TIMELINE_THEME,
    background: token("--bg-input", DEFAULT_TIMELINE_THEME.background),
    backgroundAlternate: token("--bg-panel", DEFAULT_TIMELINE_THEME.backgroundAlternate),
    ruler: token("--bg-panel-raised", DEFAULT_TIMELINE_THEME.ruler),
    grid: token("--border-subtle", DEFAULT_TIMELINE_THEME.grid),
    text: token("--fg-muted", DEFAULT_TIMELINE_THEME.text),
    bar: token("--info", DEFAULT_TIMELINE_THEME.bar),
    barSelected: token("--accent", DEFAULT_TIMELINE_THEME.barSelected),
    keyframe: token("--fg", DEFAULT_TIMELINE_THEME.keyframe),
    keyframeHold: token("--warning", DEFAULT_TIMELINE_THEME.keyframeHold),
    playhead: token("--danger", DEFAULT_TIMELINE_THEME.playhead),
    workArea: token("--success", DEFAULT_TIMELINE_THEME.workArea),
  };
  return cachedTheme;
}

let cachedTheme: TimelineTheme | null = null;

const EMPTY_MODEL: TimelineModel = Object.freeze({
  duration: 0,
  fps: 60,
  workArea: Object.freeze([0, 0] as [number, number]),
  tracks: Object.freeze([]),
  markers: Object.freeze([]),
});

const EMPTY_FRAME_STATE: TimelineFrameState = Object.freeze({
  model: EMPTY_MODEL,
  viewport: Object.freeze({
    width: 1,
    height: 1,
    startFrame: 0,
    pixelsPerFrame: 2,
    scrollY: 0,
  }),
  contentMode: "map",
  diagnostic: null,
});

interface TimelineProjection {
  readonly model: TimelineModel;
  readonly diagnostic: string | null;
}

const EMPTY_PROJECTION: TimelineProjection = Object.freeze({
  model: EMPTY_MODEL,
  diagnostic: null,
});

function resolveStateAction<T>(update: SetStateAction<T>, current: T): T {
  return typeof update === "function" ? (update as (value: T) => T)(current) : update;
}
