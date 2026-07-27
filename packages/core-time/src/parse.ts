/**
 * Parser de tempo tolerante.
 *
 * A entrada vem de humano digitando num campo e de LLM escrevendo Scene
 * Script. Nunca lança: devolve `Result` com erro descritivo, porque nos dois
 * casos alguém precisa ler a mensagem e corrigir.
 *
 * Formatos aceitos e regras de desambiguação estão em
 * docs/05-SCENE-SCRIPT.md § 5.
 */

import { err, ok, type Result } from "@theatrum/core-utils";
import { secondsToFrames, timecodeToFrames } from "./convert.js";
import { frame, nominalFps, seconds, type Frame, type TimeBase } from "./units.js";

export type TimeParseError =
  | { readonly kind: "empty" }
  | { readonly kind: "malformed"; readonly input: string; readonly hint: string }
  | { readonly kind: "out-of-range"; readonly input: string; readonly detail: string };

const FRAMES_RE = /^(-?)(\d+(?:\.\d+)?)f$/;
const MILLIS_RE = /^(-?)(\d+(?:\.\d+)?)ms$/;
const SECONDS_RE = /^(-?)(\d+(?:\.\d+)?)s$/;
const COMPACT_RE = /^(-?)(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/;
const PLAIN_RE = /^(-?)(\d+(?:\.\d+)?)$/;
const COLON_RE = /^(-?)([\d:;.]+)$/;

/**
 * Interpreta `input` no time base dado.
 *
 * REGRA: número puro significa **segundos**, não frames. É a interpretação que
 * um LLM assume por padrão, e contrariá-la geraria erro silencioso de fator 60.
 * Para frames, use o sufixo `f`.
 */
export function parse(input: string, base: TimeBase): Result<Frame, TimeParseError> {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, "");
  if (trimmed === "") return err({ kind: "empty" });

  const framesMatch = FRAMES_RE.exec(trimmed);
  if (framesMatch) {
    return finite(trimmed, signed(framesMatch[1], framesMatch[2]), (n) => frame(n));
  }

  const millisMatch = MILLIS_RE.exec(trimmed);
  if (millisMatch) {
    return finite(trimmed, signed(millisMatch[1], millisMatch[2]), (n) =>
      secondsToFrames(seconds(n / 1000), base),
    );
  }

  const secondsMatch = SECONDS_RE.exec(trimmed);
  if (secondsMatch) {
    return finite(trimmed, signed(secondsMatch[1], secondsMatch[2]), (n) =>
      secondsToFrames(seconds(n), base),
    );
  }

  const plainMatch = PLAIN_RE.exec(trimmed);
  if (plainMatch) {
    return finite(trimmed, signed(plainMatch[1], plainMatch[2]), (n) =>
      secondsToFrames(seconds(n), base),
    );
  }

  // "1m30s", "1m", "90s" já coberto acima — este trata a forma composta.
  const compactMatch = COMPACT_RE.exec(trimmed);
  if (compactMatch && (compactMatch[2] !== undefined || compactMatch[3] !== undefined)) {
    const sign = compactMatch[1] === "-" ? -1 : 1;
    const minutes = compactMatch[2] === undefined ? 0 : Number(compactMatch[2]);
    const secs = compactMatch[3] === undefined ? 0 : Number(compactMatch[3]);
    if (!Number.isFinite(minutes) || !Number.isFinite(secs)) {
      return err({ kind: "malformed", input, hint: "valor numérico inválido" });
    }
    return ok(secondsToFrames(seconds(sign * (minutes * 60 + secs)), base));
  }

  const colonMatch = COLON_RE.exec(trimmed);
  if (colonMatch) return parseColonForm(input, colonMatch[1] === "-", colonMatch[2] ?? "", base);

  return err({
    kind: "malformed",
    input,
    hint: 'formatos aceitos: "90f", "2.5s", "500ms", "1m30s", "1:30", "00:01:30:15"',
  });
}

/**
 * Formas com dois-pontos. Desambiguação por contagem de campos:
 *
 *   `a:b`       → minutos:segundos
 *   `a:b:c`     → horas:minutos:segundos
 *   `a:b:c:d`   → horas:minutos:segundos:frames
 *
 * O último campo pode ter decimal nas duas primeiras formas (`1:23.5`), e aí
 * é fração de segundo. Na forma de quatro campos, `;` antes do último indica
 * timecode drop-frame — é a convenção de broadcast.
 */
function parseColonForm(
  original: string,
  negative: boolean,
  body: string,
  base: TimeBase,
): Result<Frame, TimeParseError> {
  const dropFrameNotation = body.includes(";");
  const parts = body.split(/[:;]/);

  if (parts.some((p) => p === "")) {
    return err({ kind: "malformed", input: original, hint: "campo vazio entre separadores" });
  }

  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) {
    return err({ kind: "malformed", input: original, hint: "campo não numérico ou negativo" });
  }

  if (parts.length === 2 || parts.length === 3) {
    const [a, b, c] = numbers as [number, number, number?];
    const totalSeconds = parts.length === 2 ? a * 60 + b : a * 3600 + b * 60 + (c as number);
    return ok(secondsToFrames(seconds(negative ? -totalSeconds : totalSeconds), base));
  }

  if (parts.length === 4) {
    const [hours, minutes, secs, frameCount] = numbers as [number, number, number, number];
    const nominal = nominalFps(base);

    if (frameCount >= nominal) {
      return err({
        kind: "out-of-range",
        input: original,
        detail: `campo de frames ${frameCount} >= fps nominal ${nominal}`,
      });
    }
    if (minutes > 59 || secs > 59) {
      return err({
        kind: "out-of-range",
        input: original,
        detail: "minutos e segundos precisam ser <= 59",
      });
    }
    if (!Number.isInteger(frameCount)) {
      return err({
        kind: "malformed",
        input: original,
        hint: "campo de frames precisa ser inteiro",
      });
    }

    // A notação com ';' pede drop-frame mesmo que o time base não peça —
    // respeitá-la evita interpretar um timecode de broadcast como non-drop.
    const effective = dropFrameNotation ? { fps: base.fps, dropFrame: true } : base;

    return ok(
      timecodeToFrames({ negative, hours, minutes, seconds: secs, frames: frameCount }, effective),
    );
  }

  return err({
    kind: "malformed",
    input: original,
    hint: `${parts.length} campos separados por ':' — esperado 2, 3 ou 4`,
  });
}

function signed(sign: string | undefined, digits: string | undefined): number {
  return (sign === "-" ? -1 : 1) * Number(digits);
}

function finite(
  input: string,
  value: number,
  convert: (n: number) => Frame,
): Result<Frame, TimeParseError> {
  if (!Number.isFinite(value)) {
    return err({ kind: "malformed", input, hint: "valor numérico inválido" });
  }
  return ok(convert(value));
}

/**
 * Diferença entre o tempo pedido e o frame onde ele caiu, em frames.
 *
 * O compilador de Scene Script usa isto para avisar quando o arredondamento
 * desloca uma entrada em mais de meio frame.
 */
export function roundingError(input: string, base: TimeBase): number | null {
  const parsed = parse(input, base);
  if (!parsed.ok) return null;

  const exactMatch = /^(-?)(\d+(?:\.\d+)?)s$/.exec(input.trim().toLowerCase());
  if (!exactMatch) return 0;

  const exact = signed(exactMatch[1], exactMatch[2]) * base.fps;
  return Math.abs(exact - parsed.value);
}
