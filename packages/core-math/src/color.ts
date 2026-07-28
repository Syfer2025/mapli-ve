/**
 * Cor: parsing hex e interpolação perceptual em OkLab.
 *
 * O documento guarda cor como string hex (`#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa`). Interpolar os canais sRGB direto atravessa tons mortos no
 * meio do caminho — vermelho→azul passa por um roxo sujo, amarelo→azul
 * passa por cinza. OkLab (Ottosson, 2020) é o espaço perceptual pensado
 * para gradientes curtos e custa pouco: uma linearização, duas mudanças de
 * base e uma raiz cúbica por canal.
 *
 * O alfa não entra no OkLab: ele interpola linearmente em separado, porque
 * opacidade não tem dimensão perceptual de matiz.
 *
 * Determinismo: `Math.cbrt` e `**` são aproximações de implementação, não
 * valores corretamente arredondados — mas são estáveis dentro do mesmo
 * motor. O Theatrum executa tudo em V8 (testes em Node, app em Electron),
 * então a mesma avaliação produz o mesmo bits em qualquer frame, em
 * qualquer ordem de scrub. É essa a garantia que o hash de frame prova.
 */

import { clamp, lerp } from "./scalar.js";

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Lê `#rgb`, `#rgba`, `#rrggbb` ou `#rrggbbaa` em canais 0–255.
 * Devolve `null` para qualquer outra string — é o que distingue cor de
 * string discreta na interpolação.
 */
export function parseHexColor(value: string): readonly [number, number, number, number] | null {
  const match = HEX_PATTERN.exec(value);
  if (match === null) return null;
  const digits = match[1] ?? "";
  const expanded = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255;
  return [red, green, blue, alpha];
}

/**
 * Formata canais 0–255 em hex minúsculo. Seis dígitos quando o alfa é
 * opaco; oito quando há transparência — o formato do documento
 * (docs/03-DATA-MODEL.md).
 */
export function formatHexColor(red: number, green: number, blue: number, alpha = 255): string {
  const channels = [red, green, blue, alpha].map((channel) => Math.round(clamp(channel, 0, 255)));
  const [r, g, b, a] = channels as [number, number, number, number];
  const rgb = [r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
  return a >= 255 ? `#${rgb}` : `#${rgb}${a.toString(16).padStart(2, "0")}`;
}

/** sRGB 0–255 → OkLab `[L, a, b]` (matrizes de Ottosson). */
export function srgbToOklab(
  red: number,
  green: number,
  blue: number,
): readonly [number, number, number] {
  const lr = srgbChannelToLinear(red / 255);
  const lg = srgbChannelToLinear(green / 255);
  const lb = srgbChannelToLinear(blue / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OkLab `[L, a, b]` → sRGB 0–255, grampeado ao gamute. */
export function oklabToSrgb(
  lightness: number,
  aAxis: number,
  bAxis: number,
): readonly [number, number, number] {
  const l = (lightness + 0.3963377774 * aAxis + 0.2158037573 * bAxis) ** 3;
  const m = (lightness - 0.1055613458 * aAxis - 0.0638541728 * bAxis) ** 3;
  const s = (lightness - 0.0894841775 * aAxis - 1.291485548 * bAxis) ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [
    linearChannelToSrgb(red) * 255,
    linearChannelToSrgb(green) * 255,
    linearChannelToSrgb(blue) * 255,
  ];
}

/**
 * Interpola duas cores hex em OkLab. Devolve `null` se algum lado não for
 * cor — o chamador cai no comportamento discreto, como antes.
 *
 * Nas fronteiras (`progress <= 0` / `>= 1`) devolve a string original, sem
 * roundtrip: o frame exato de um keyframe é bit-idêntico ao valor do
 * documento, que é o que o hash de determinismo compara.
 */
export function lerpOklabHex(left: string, right: string, progress: number): string | null {
  const from = parseHexColor(left);
  const to = parseHexColor(right);
  if (from === null || to === null) return null;
  if (progress <= 0) return left;
  if (progress >= 1) return right;

  const fromLab = srgbToOklab(from[0], from[1], from[2]);
  const toLab = srgbToOklab(to[0], to[1], to[2]);
  const mixed = oklabToSrgb(
    lerp(fromLab[0], toLab[0], progress),
    lerp(fromLab[1], toLab[1], progress),
    lerp(fromLab[2], toLab[2], progress),
  );
  return formatHexColor(mixed[0], mixed[1], mixed[2], lerp(from[3], to[3], progress));
}

function srgbChannelToLinear(value: number): number {
  const channel = clamp(value, 0, 1);
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(value: number): number {
  const channel = clamp(value, 0, 1);
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}
