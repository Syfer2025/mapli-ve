import type { SceneTime, SceneTimelineEntry } from "@theatrum/schema";
import type { ResolvedTimelineEntry, SceneDiagnostic } from "./contracts.js";
import { diagnostic, pointer, suggest } from "./diagnostics.js";

export interface SceneTimeContext {
  readonly fps: number;
  readonly durationFrames: number;
}

export interface ParsedSceneTime {
  readonly kind: "absolute" | "after" | "with" | "end";
  readonly frames?: number;
  readonly reference?: string;
  readonly offsetFrames?: number;
}

const SIMPLE_TIME = /^(\d+(?:\.\d+)?)(ms|s|f)$/;
const MINUTES_TIME = /^(\d+)m(\d+(?:\.\d+)?)s$/;
const MINUTE_SECOND_TIME = /^(\d+):(\d{2})$/;
const TIMECODE = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/;
const AFTER = /^after:([^+\s]+)(?:\+(\d+(?:\.\d+)?(?:ms|s|f)))?$/;
const WITH = /^with:([^\s]+)$/;
const END = /^end-(\d+(?:\.\d+)?(?:ms|s|f))$/;

export function parseSceneTime(
  value: SceneTime,
  context: SceneTimeContext,
): ParsedSceneTime | null {
  if (typeof value === "number") {
    return { kind: "absolute", frames: Math.round(value * context.fps) };
  }

  const after = AFTER.exec(value);
  if (after !== null) {
    const reference = after[1];
    if (reference === undefined) return null;
    const offsetFrames = after[2] === undefined ? 0 : parseAbsoluteString(after[2], context.fps);
    if (offsetFrames === null) return null;
    return {
      kind: "after",
      reference,
      offsetFrames,
    };
  }
  const withReference = WITH.exec(value);
  if (withReference !== null) {
    const reference = withReference[1];
    return reference === undefined ? null : { kind: "with", reference };
  }
  const fromEnd = END.exec(value);
  if (fromEnd !== null) {
    const offset = parseAbsoluteString(fromEnd[1] ?? "", context.fps);
    return offset === null ? null : { kind: "end", frames: context.durationFrames - offset };
  }
  const absolute = parseAbsoluteString(value, context.fps);
  return absolute === null ? null : { kind: "absolute", frames: absolute };
}

export function parseAbsoluteSceneTime(value: SceneTime, context: SceneTimeContext): number | null {
  const parsed = parseSceneTime(value, context);
  return parsed?.kind === "absolute" ? (parsed.frames ?? null) : null;
}

export function resolveTimelineTimes(
  entries: readonly SceneTimelineEntry[],
  context: SceneTimeContext,
  diagnostics: SceneDiagnostic[],
): readonly ResolvedTimelineEntry[] {
  const ids = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.id === undefined) return;
    const existing = ids.get(entry.id);
    if (existing !== undefined) {
      diagnostics.push(
        diagnostic(
          "error",
          "duplicate-id",
          pointer(["timeline", index, "id"]),
          `id de timeline "${entry.id}" já foi usado em /timeline/${existing}`,
          { hint: "use IDs únicos para referências after: e with:" },
        ),
      );
      return;
    }
    ids.set(entry.id, index);
  });

  const resolved = new Map<number, ResolvedTimelineEntry>();
  const visiting = new Set<number>();

  const visit = (index: number): ResolvedTimelineEntry | null => {
    const cached = resolved.get(index);
    if (cached !== undefined) return cached;
    const entry = entries[index];
    if (entry === undefined) return null;
    if (visiting.has(index)) {
      diagnostics.push(
        diagnostic(
          "error",
          "time-cycle",
          pointer(["timeline", index, "at"]),
          "ciclo detectado entre tempos relativos",
          { hint: "faça after:/with: apontar apenas para uma cadeia sem ciclos" },
        ),
      );
      return null;
    }
    visiting.add(index);

    const at = parseSceneTime(entry.at, context);
    let start: number | null = null;
    if (at === null) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid-time",
          pointer(["timeline", index, "at"]),
          `tempo "${String(entry.at)}" inválido`,
        ),
      );
    } else if (at.kind === "absolute" || at.kind === "end") {
      start = at.frames ?? null;
    } else {
      const reference = at.reference ?? "";
      const referenceIndex = ids.get(reference);
      if (referenceIndex === undefined) {
        diagnostics.push(
          diagnostic(
            "error",
            "missing-reference",
            pointer(["timeline", index, "at"]),
            `entrada "${reference}" referenciada pelo tempo não existe`,
            { didYouMean: suggest(reference, [...ids.keys()]) },
          ),
        );
      } else {
        const target = visit(referenceIndex);
        if (target !== null) {
          start = at.kind === "with" ? target.startFrame : target.endFrame + (at.offsetFrames ?? 0);
        }
      }
    }

    const durationValue = durationOf(entry);
    const duration =
      durationValue === undefined ? 0 : parseAbsoluteSceneTime(durationValue, context);
    if (durationValue !== undefined && duration === null) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid-time",
          pointer(["timeline", index, durationField(entry)]),
          "duração deve ser absoluta; after:/with: só são aceitos em at",
        ),
      );
    }
    const delay = entry.delay === undefined ? 0 : parseAbsoluteSceneTime(entry.delay, context);
    if (entry.delay !== undefined && delay === null) {
      diagnostics.push(
        diagnostic(
          "error",
          "invalid-time",
          pointer(["timeline", index, "delay"]),
          "delay deve ser um tempo absoluto",
        ),
      );
    }

    visiting.delete(index);
    if (start === null || duration === null || delay === null) return null;
    const startFrame = start + delay;
    const result = Object.freeze({
      index,
      entry,
      startFrame,
      durationFrames: duration,
      endFrame: startFrame + duration,
    });
    resolved.set(index, result);
    return result;
  };

  for (let index = 0; index < entries.length; index += 1) visit(index);
  return Object.freeze(
    [...resolved.values()].sort(
      (left, right) => left.startFrame - right.startFrame || left.index - right.index,
    ),
  );
}

function parseAbsoluteString(value: string, fps: number): number | null {
  const simple = SIMPLE_TIME.exec(value);
  if (simple !== null) {
    const amount = Number(simple[1]);
    const unit = simple[2];
    if (unit === "f") return Math.round(amount);
    if (unit === "ms") return Math.round((amount / 1000) * fps);
    return Math.round(amount * fps);
  }
  const minutes = MINUTES_TIME.exec(value);
  if (minutes !== null) {
    return Math.round((Number(minutes[1]) * 60 + Number(minutes[2])) * fps);
  }
  const minuteSecond = MINUTE_SECOND_TIME.exec(value);
  if (minuteSecond !== null) {
    const seconds = Number(minuteSecond[2]);
    if (seconds >= 60) return null;
    return Math.round((Number(minuteSecond[1]) * 60 + seconds) * fps);
  }
  const timecode = TIMECODE.exec(value);
  if (timecode !== null) {
    const hours = Number(timecode[1]);
    const minutesPart = Number(timecode[2]);
    const secondsPart = Number(timecode[3]);
    const framePart = Number(timecode[4]);
    if (minutesPart >= 60 || secondsPart >= 60 || framePart >= Math.ceil(fps)) return null;
    return Math.round((hours * 3600 + minutesPart * 60 + secondsPart) * fps + framePart);
  }
  return null;
}

function durationOf(entry: SceneTimelineEntry): SceneTime | undefined {
  if ("duration" in entry && entry.duration !== undefined) return entry.duration;
  if (entry.do === "unit.spawn" && entry.fade !== undefined) return entry.fade;
  return undefined;
}

function durationField(entry: SceneTimelineEntry): "duration" | "fade" {
  return entry.do === "unit.spawn" && !("duration" in entry) ? "fade" : "duration";
}
