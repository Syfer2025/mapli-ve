/**
 * @theatrum/core-time — L0 · núcleo
 *
 * Tempo como frame inteiro, com conversão, formatação e parsing.
 *
 * Ver docs/02-MODULES.md § core-time e docs/adr/ADR-004-time-in-frames.md.
 */

export {
  type Frame,
  type Seconds,
  type TimeBase,
  FPS_PRESETS,
  timeBase,
  frame,
  subframe,
  seconds,
  frames,
  nominalFps,
  isDropFrameValid,
} from "./units.js";

export {
  type TimecodeParts,
  framesToSeconds,
  secondsToFrames,
  exactFrames,
  framesToTimecode,
  timecodeToFrames,
  remapFrame,
} from "./convert.js";

export { type TimecodeStyle, format, formatDuration } from "./format.js";

export { type TimeParseError, parse, roundingError } from "./parse.js";
