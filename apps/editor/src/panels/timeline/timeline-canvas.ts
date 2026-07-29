import {
  TIMELINE_ROW_HEIGHT,
  TIMELINE_RULER_HEIGHT,
  type TimelineKeyframe,
  type TimelineModel,
  type TimelineTrack,
} from "./timeline-model.js";

export const MIN_PIXELS_PER_FRAME = 0.05;
export const MAX_PIXELS_PER_FRAME = 80;

export interface TimelineViewport {
  readonly width: number;
  readonly height: number;
  readonly startFrame: number;
  readonly pixelsPerFrame: number;
  readonly scrollY: number;
  readonly rowHeight?: number;
  readonly rulerHeight?: number;
}

export interface TimelineTheme {
  readonly background: string;
  readonly backgroundAlternate: string;
  readonly ruler: string;
  readonly grid: string;
  readonly text: string;
  readonly bar: string;
  readonly barSelected: string;
  readonly keyframe: string;
  readonly keyframeHold: string;
  readonly playhead: string;
  readonly workArea: string;
  readonly markerFallback: string;
  readonly tourHold: string;
  readonly tourTravel: string;
  readonly disabledAlpha: number;
}

export interface TimelineCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
}

export interface TimelineRenderStats {
  readonly tracksVisited: number;
  readonly tracksDrawn: number;
  readonly keyframesVisited: number;
  readonly keyframesDrawn: number;
  readonly cuesDrawn: number;
  readonly markersDrawn: number;
}

export interface TimelineHit {
  readonly kind: "keyframe";
  readonly trackId: string;
  readonly nodeId: string;
  readonly propertyPath: string;
  readonly keyframeId: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

export interface TimelineViewState {
  readonly startFrame: number;
  readonly pixelsPerFrame: number;
}

export const DEFAULT_TIMELINE_THEME: TimelineTheme = Object.freeze({
  background: "#0e1216",
  backgroundAlternate: "#11161b",
  ruler: "#1b2027",
  grid: "#252d35",
  text: "#8d99a6",
  bar: "#426b74",
  barSelected: "#2f9e93",
  keyframe: "#dfe4ea",
  keyframeHold: "#c9963f",
  playhead: "#cf5a4f",
  workArea: "#4f9d5f",
  markerFallback: "#c9963f",
  tourHold: "#c9963f",
  tourTravel: "#6f7c88",
  disabledAlpha: 0.35,
});

/**
 * Redesenho completo, com culling nos dois eixos. Não aloca objetos por
 * keyframe e devolve contadores para benchmarks e telemetria.
 */
export function renderTimeline(
  context: TimelineCanvasContext,
  model: TimelineModel,
  viewport: TimelineViewport,
  playheadFrame: number,
  theme: TimelineTheme = DEFAULT_TIMELINE_THEME,
): TimelineRenderStats {
  const rowHeight = viewport.rowHeight ?? TIMELINE_ROW_HEIGHT;
  const rulerHeight = viewport.rulerHeight ?? TIMELINE_RULER_HEIGHT;
  const firstTrack = Math.max(0, Math.floor(viewport.scrollY / rowHeight));
  const lastTrack = Math.min(
    model.tracks.length - 1,
    Math.ceil((viewport.scrollY + viewport.height - rulerHeight) / rowHeight),
  );
  const endFrame = viewport.startFrame + viewport.width / viewport.pixelsPerFrame;

  let tracksVisited = 0;
  let tracksDrawn = 0;
  let keyframesVisited = 0;
  let keyframesDrawn = 0;
  let cuesDrawn = 0;
  let markersDrawn = 0;

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = theme.background;
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.beginPath();
  context.rect(0, 0, viewport.width, viewport.height);
  context.clip();

  context.fillStyle = theme.ruler;
  context.fillRect(0, 0, viewport.width, rulerHeight);
  drawWorkArea(context, model, viewport, rulerHeight, theme);
  drawRuler(context, model, viewport, rulerHeight, theme);

  if (lastTrack >= firstTrack) {
    for (let trackIndex = firstTrack; trackIndex <= lastTrack; trackIndex += 1) {
      tracksVisited += 1;
      const track = model.tracks[trackIndex];
      if (track === undefined) continue;
      const y = rulerHeight + trackIndex * rowHeight - viewport.scrollY;
      tracksDrawn += 1;
      drawTrackBackground(context, trackIndex, y, viewport.width, rowHeight, theme);
      cuesDrawn += drawTrack(context, track, y, rowHeight, viewport, theme);

      if (track.kind === "property") {
        const keyframes = track.keyframes;
        keyframesVisited += keyframes.length;
        for (
          let index = lowerBoundFrame(keyframes, viewport.startFrame);
          index < keyframes.length;
          index += 1
        ) {
          const keyframe = keyframes[index];
          if (keyframe === undefined || keyframe.frame > endFrame) break;
          drawKeyframe(
            context,
            frameToX(keyframe.frame, viewport),
            y + rowHeight / 2,
            keyframe.easing,
            theme,
          );
          keyframesDrawn += 1;
        }
      }
    }
  }

  for (const marker of model.markers) {
    if (marker.frame < viewport.startFrame || marker.frame > endFrame) continue;
    const x = frameToX(marker.frame, viewport);
    context.fillStyle = marker.color || theme.markerFallback;
    context.beginPath();
    context.moveTo(x - 5, 0);
    context.lineTo(x + 5, 0);
    context.lineTo(x, 8);
    context.closePath();
    context.fill();
    markersDrawn += 1;
  }

  const playheadX = frameToX(playheadFrame, viewport);
  if (playheadX >= 0 && playheadX <= viewport.width) {
    context.strokeStyle = theme.playhead;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(alignPixel(playheadX), 0);
    context.lineTo(alignPixel(playheadX), viewport.height);
    context.stroke();
    context.fillStyle = theme.playhead;
    context.beginPath();
    context.moveTo(playheadX - 6, 0);
    context.lineTo(playheadX + 6, 0);
    context.lineTo(playheadX, 9);
    context.closePath();
    context.fill();
  }

  context.restore();
  return Object.freeze({
    tracksVisited,
    tracksDrawn,
    keyframesVisited,
    keyframesDrawn,
    cuesDrawn,
    markersDrawn,
  });
}

export function frameToX(
  frame: number,
  viewport: Pick<TimelineViewport, "startFrame" | "pixelsPerFrame">,
): number {
  return (frame - viewport.startFrame) * viewport.pixelsPerFrame;
}

export function xToFrame(
  x: number,
  viewport: Pick<TimelineViewport, "startFrame" | "pixelsPerFrame">,
): number {
  return viewport.startFrame + x / viewport.pixelsPerFrame;
}

export function zoomAroundPoint(
  view: TimelineViewState,
  factor: number,
  anchorX: number,
): TimelineViewState {
  const pixelsPerFrame = clamp(
    view.pixelsPerFrame * factor,
    MIN_PIXELS_PER_FRAME,
    MAX_PIXELS_PER_FRAME,
  );
  const anchorFrame = view.startFrame + anchorX / view.pixelsPerFrame;
  return Object.freeze({
    pixelsPerFrame,
    startFrame: anchorFrame - anchorX / pixelsPerFrame,
  });
}

export function snapFrame(
  rawFrame: number,
  model: TimelineModel,
  pixelsPerFrame: number,
  tolerancePixels = 6,
  excludedKeyframeId?: string,
): number {
  const rounded = Math.round(rawFrame);
  const tolerance = tolerancePixels / Math.max(MIN_PIXELS_PER_FRAME, pixelsPerFrame);
  let best = rounded;
  let bestDistance = Math.abs(rounded - rawFrame);

  const consider = (candidate: number): void => {
    const distance = Math.abs(candidate - rawFrame);
    if (
      distance <= tolerance &&
      (distance < bestDistance || (distance === bestDistance && candidate < best))
    ) {
      best = candidate;
      bestDistance = distance;
    }
  };

  consider(model.workArea[0]);
  consider(model.workArea[1]);
  for (const marker of model.markers) consider(marker.frame);
  for (const track of model.tracks) {
    consider(track.timeRange[0]);
    consider(track.timeRange[1]);
    for (const cue of track.cues) {
      consider(cue.arrivalFrame);
      consider(cue.departureFrame);
    }
    for (const keyframe of track.keyframes) {
      if (keyframe.id !== excludedKeyframeId) consider(keyframe.frame);
    }
  }
  return clamp(Math.round(best), 0, model.duration);
}

export class TimelineHitIndex {
  readonly #buckets = new Map<string, TimelineHit[]>();
  readonly #cellSize: number;

  constructor(cellSize = 24) {
    this.#cellSize = Math.max(8, cellSize);
  }

  add(hit: TimelineHit): void {
    const key = bucketKey(hit.x, hit.y, this.#cellSize);
    const bucket = this.#buckets.get(key);
    if (bucket === undefined) this.#buckets.set(key, [hit]);
    else bucket.push(hit);
  }

  hitTest(x: number, y: number, radius = 7): TimelineHit | null {
    const minCellX = Math.floor((x - radius) / this.#cellSize);
    const maxCellX = Math.floor((x + radius) / this.#cellSize);
    const minCellY = Math.floor((y - radius) / this.#cellSize);
    const maxCellY = Math.floor((y + radius) / this.#cellSize);
    let nearest: TimelineHit | null = null;
    let nearestDistanceSquared = radius * radius;

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (const hit of this.#buckets.get(`${cellX}:${cellY}`) ?? EMPTY_HITS) {
          const dx = hit.x - x;
          const dy = hit.y - y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared <= nearestDistanceSquared) {
            nearest = hit;
            nearestDistanceSquared = distanceSquared;
          }
        }
      }
    }
    return nearest;
  }
}

export function buildTimelineHitIndex(
  model: TimelineModel,
  viewport: TimelineViewport,
): TimelineHitIndex {
  const index = new TimelineHitIndex();
  const rowHeight = viewport.rowHeight ?? TIMELINE_ROW_HEIGHT;
  const rulerHeight = viewport.rulerHeight ?? TIMELINE_RULER_HEIGHT;
  const firstTrack = Math.max(0, Math.floor(viewport.scrollY / rowHeight));
  const lastTrack = Math.min(
    model.tracks.length - 1,
    Math.ceil((viewport.scrollY + viewport.height - rulerHeight) / rowHeight),
  );
  const endFrame = viewport.startFrame + viewport.width / viewport.pixelsPerFrame;

  for (let trackIndex = firstTrack; trackIndex <= lastTrack; trackIndex += 1) {
    const track = model.tracks[trackIndex];
    if (track?.kind !== "property" || track.propertyPath === null) continue;
    const y = rulerHeight + trackIndex * rowHeight - viewport.scrollY + rowHeight / 2;
    for (
      let keyframeIndex = lowerBoundFrame(track.keyframes, viewport.startFrame);
      keyframeIndex < track.keyframes.length;
      keyframeIndex += 1
    ) {
      const keyframe = track.keyframes[keyframeIndex];
      if (keyframe === undefined || keyframe.frame > endFrame) break;
      index.add(
        Object.freeze({
          kind: "keyframe",
          trackId: track.id,
          nodeId: track.nodeId,
          propertyPath: track.propertyPath,
          keyframeId: keyframe.id,
          frame: keyframe.frame,
          x: frameToX(keyframe.frame, viewport),
          y,
        }),
      );
    }
  }
  return index;
}

function drawWorkArea(
  context: TimelineCanvasContext,
  model: TimelineModel,
  viewport: TimelineViewport,
  rulerHeight: number,
  theme: TimelineTheme,
): void {
  const startX = frameToX(model.workArea[0], viewport);
  const endX = frameToX(model.workArea[1], viewport);
  const clippedStart = clamp(startX, 0, viewport.width);
  const clippedEnd = clamp(endX, 0, viewport.width);
  if (clippedEnd <= clippedStart) return;
  context.fillStyle = theme.workArea;
  context.globalAlpha = 0.8;
  context.fillRect(clippedStart, rulerHeight - 3, clippedEnd - clippedStart, 3);
  context.globalAlpha = 1;
}

function drawRuler(
  context: TimelineCanvasContext,
  model: TimelineModel,
  viewport: TimelineViewport,
  rulerHeight: number,
  theme: TimelineTheme,
): void {
  const tickStep = chooseTickStep(viewport.pixelsPerFrame);
  const start = Math.max(0, Math.ceil(viewport.startFrame / tickStep) * tickStep);
  const end = Math.min(
    model.duration,
    Math.ceil(viewport.startFrame + viewport.width / viewport.pixelsPerFrame),
  );
  context.strokeStyle = theme.grid;
  context.fillStyle = theme.text;
  context.lineWidth = 1;
  context.font = "10px Cascadia Mono, Consolas, monospace";
  context.textBaseline = "top";
  for (let frame = start; frame <= end; frame += tickStep) {
    const x = alignPixel(frameToX(frame, viewport));
    context.beginPath();
    context.moveTo(x, rulerHeight - 7);
    context.lineTo(x, viewport.height);
    context.stroke();
    context.fillText(formatRulerLabel(frame, model.fps), x + 3, 3);
  }
}

function drawTrackBackground(
  context: TimelineCanvasContext,
  trackIndex: number,
  y: number,
  width: number,
  rowHeight: number,
  theme: TimelineTheme,
): void {
  context.globalAlpha = 1;
  context.fillStyle = trackIndex % 2 === 0 ? theme.background : theme.backgroundAlternate;
  context.fillRect(0, y, width, rowHeight);
}

function drawTrack(
  context: TimelineCanvasContext,
  track: TimelineTrack,
  y: number,
  rowHeight: number,
  viewport: TimelineViewport,
  theme: TimelineTheme,
): number {
  context.globalAlpha = track.enabled ? 1 : theme.disabledAlpha;
  if (track.kind === "node") {
    const start = clamp(frameToX(track.timeRange[0], viewport), -1, viewport.width + 1);
    const end = clamp(frameToX(track.timeRange[1], viewport), -1, viewport.width + 1);
    if (end > start) {
      context.fillStyle = track.selected ? theme.barSelected : theme.bar;
      context.fillRect(start, y + 5, Math.max(1, end - start), Math.max(3, rowHeight - 10));
    }
  } else if (track.kind === "guide") {
    const drawn = drawTourGuide(context, track, y, rowHeight, viewport, theme);
    context.globalAlpha = 1;
    return drawn;
  } else if (track.keyframes.length > 1) {
    const first = track.keyframes[0];
    const last = track.keyframes.at(-1);
    if (first !== undefined && last !== undefined) {
      const start = clamp(frameToX(first.frame, viewport), -1, viewport.width + 1);
      const end = clamp(frameToX(last.frame, viewport), -1, viewport.width + 1);
      context.strokeStyle = theme.bar;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(start, alignPixel(y + rowHeight / 2));
      context.lineTo(end, alignPixel(y + rowHeight / 2));
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  return 0;
}

function drawTourGuide(
  context: TimelineCanvasContext,
  track: TimelineTrack,
  y: number,
  rowHeight: number,
  viewport: TimelineViewport,
  theme: TimelineTheme,
): number {
  let drawn = 0;
  let previousDeparture: number | null = null;
  const centerY = alignPixel(y + rowHeight / 2);

  for (const cue of track.cues) {
    if (previousDeparture !== null && cue.arrivalFrame > previousDeparture) {
      const travelStart = clamp(frameToX(previousDeparture, viewport), -1, viewport.width + 1);
      const travelEnd = clamp(frameToX(cue.arrivalFrame, viewport), -1, viewport.width + 1);
      if (travelEnd > travelStart) {
        context.strokeStyle = theme.tourTravel;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(travelStart, centerY);
        context.lineTo(travelEnd, centerY);
        context.stroke();
      }
    }

    const rawStart = frameToX(cue.arrivalFrame, viewport);
    const rawEnd = frameToX(cue.departureFrame, viewport);
    previousDeparture = cue.departureFrame;
    if (rawEnd < 0 || rawStart > viewport.width) continue;
    const start = clamp(rawStart, -1, viewport.width + 1);
    const end = clamp(rawEnd, -1, viewport.width + 1);
    const width = Math.max(2, end - start);
    context.fillStyle = theme.tourHold;
    context.fillRect(start, y + 4, width, Math.max(4, rowHeight - 8));
    if (width >= 36) {
      context.fillStyle = theme.background;
      context.fillText(`${String(cue.ordinal)} · ${cue.label}`, start + 4, y + 5);
    }
    drawn += 1;
  }

  return drawn;
}

function drawKeyframe(
  context: TimelineCanvasContext,
  x: number,
  y: number,
  easing: TimelineKeyframe["easing"],
  theme: TimelineTheme,
): void {
  const radius = easing === "bezier" ? 5 : 4;
  context.fillStyle = easing === "hold" ? theme.keyframeHold : theme.keyframe;
  context.beginPath();
  if (easing === "hold") {
    context.rect(x - radius, y - radius, radius * 2, radius * 2);
  } else {
    context.moveTo(x, y - radius);
    context.lineTo(x + radius, y);
    context.lineTo(x, y + radius);
    context.lineTo(x - radius, y);
    context.closePath();
  }
  context.fill();
}

function chooseTickStep(pixelsPerFrame: number): number {
  for (const step of TICK_STEPS) {
    if (step * pixelsPerFrame >= 48) return step;
  }
  return TICK_STEPS.at(-1) ?? 3_600;
}

function formatRulerLabel(frame: number, fps: number): string {
  const seconds = frame / fps;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

function lowerBoundFrame(keyframes: readonly TimelineKeyframe[], frame: number): number {
  let low = 0;
  let high = keyframes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candidate = keyframes[middle];
    if (candidate !== undefined && candidate.frame < frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

function bucketKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function alignPixel(value: number): number {
  return Math.round(value) + 0.5;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const TICK_STEPS = Object.freeze([1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1_800, 3_600]);
const EMPTY_HITS: readonly TimelineHit[] = Object.freeze([]);
