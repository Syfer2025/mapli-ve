import { BUILTIN_BEHAVIORS } from "@theatrum/behaviors";
import { format, frame, timeBase } from "@theatrum/core-time";
import { createBuiltinNodeTypeRegistry, type NodeTypeRegistry } from "@theatrum/scene-graph";
import {
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { editorActions } from "../../document/editor-session.js";
import { useEditorSession } from "../../document/useEditorSession.js";
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
import {
  TIMELINE_ROW_HEIGHT,
  TIMELINE_RULER_HEIGHT,
  buildTimelineModel,
  type TimelineModel,
} from "./timeline-model.js";
import "./TimelinePanel.css";

const BUILTIN_REGISTRY = createBuiltinNodeTypeRegistry();

/** Rótulo de comportamento vem do registry; a timeline só recebe o mapa pronto. */
const BEHAVIOR_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(BUILTIN_BEHAVIORS.map((behavior) => [behavior.type, behavior.label] as const)),
);
export interface TimelinePanelProps {
  readonly registry?: NodeTypeRegistry;
}

type DragState =
  { readonly kind: "playhead" } | { readonly kind: "keyframe"; readonly hit: TimelineHit };

export function TimelinePanel({ registry = BUILTIN_REGISTRY }: TimelinePanelProps): ReactNode {
  const session = useEditorSession();
  const composition = useMemo(
    () =>
      session.document.compositions.find(
        (candidate) => candidate.id === session.selectedCompositionId,
      ) ?? session.document.compositions[0],
    [session.document, session.selectedCompositionId],
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(composition === undefined ? [] : [composition.root]),
  );
  const [view, setView] = useState<TimelineViewState>({
    startFrame: 0,
    pixelsPerFrame: 2,
  });
  const [scrollY, setScrollY] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasPaneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const frameStateRef = useRef<TimelineFrameState>(EMPTY_FRAME_STATE);

  useEffect(() => {
    if (composition === undefined) return;
    setExpandedNodeIds((current) => new Set([...current, composition.root]));
    setView((current) => ({ ...current, startFrame: 0 }));
    setScrollY(0);
  }, [composition?.id]);

  useEffect(() => {
    if (session.selectedNodeIds.length === 0) return;
    setExpandedNodeIds((current) => new Set([...current, ...session.selectedNodeIds]));
  }, [session.selectedNodeIds]);

  useEffect(() => {
    const element = canvasPaneRef.current;
    if (element === null) return;
    const resize = (): void => {
      const bounds = element.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(bounds.width)),
        height: Math.max(1, Math.floor(bounds.height)),
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const model = useMemo<TimelineModel>(
    () =>
      composition === undefined
        ? EMPTY_MODEL
        : buildTimelineModel(composition, registry, {
            expandedNodeIds,
            selectedNodeIds: new Set(session.selectedNodeIds),
            behaviorLabels: BEHAVIOR_LABELS,
          }),
    [composition, expandedNodeIds, registry, session.selectedNodeIds],
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

  frameStateRef.current = { model, viewport };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
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
      title="Timeline"
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
          {view.pixelsPerFrame.toFixed(2)} px/frame
        </span>
      }
    >
      <div className="timeline-panel" onWheel={onWheel}>
        <div className="timeline-panel__headers" aria-label="Cabeçalhos das trilhas">
          <div className="timeline-panel__corner">Camadas</div>
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
        </div>

        <div className="timeline-panel__canvas-pane" ref={canvasPaneRef}>
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
              if (event.key === " ") {
                event.preventDefault();
                editorActions.togglePlayback();
              }
            }}
          />
          <AccessibleKeyframes model={model} />
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
    </div>
  );
});

interface TimelineFrameState {
  readonly model: TimelineModel;
  readonly viewport: TimelineViewport;
}

interface TimelineSummary {
  readonly tracks: number;
  readonly keyframes: number;
  readonly duration: number;
  readonly pixelsPerFrame: number;
  readonly width: number;
  readonly height: number;
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
    tracks: state.model.tracks.length,
    keyframes: countKeyframes(state.model),
    duration: state.model.duration,
    pixelsPerFrame: state.viewport.pixelsPerFrame,
    width: state.viewport.width,
    height: state.viewport.height,
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
});
