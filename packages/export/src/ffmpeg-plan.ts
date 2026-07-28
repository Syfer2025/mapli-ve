/**
 * Plano determinístico de chamadas ao FFmpeg.
 *
 * O processo principal executa estes argumentos sem shell. Manter a construção
 * aqui, pura, permite provar codec, pixel format, metadata e o fluxo de dois
 * passos do GIF sem iniciar processo nem depender do FFmpeg da máquina.
 */

export type FfmpegExportFormat = "gif" | "prores4444";

export interface FfmpegPlanInput {
  readonly format: FfmpegExportFormat;
  readonly fps: number;
  /** Padrão image2, por exemplo `C:\job\Cena_%04d.png`. */
  readonly framePattern: string;
  readonly outputPath: string;
  /** Obrigatório para GIF; ignorado por ProRes. */
  readonly palettePath?: string;
}

export interface FfmpegPlan {
  readonly format: FfmpegExportFormat;
  /** Uma chamada para ProRes; palettegen + paletteuse para GIF. */
  readonly passes: readonly (readonly string[])[];
}

const COMMON = Object.freeze([
  "-hide_banner",
  "-loglevel",
  "error",
  "-nostdin",
  "-y",
  "-fflags",
  "+bitexact",
]);

export function planFfmpegExport(input: FfmpegPlanInput): FfmpegPlan {
  if (!Number.isFinite(input.fps) || input.fps <= 0 || input.fps > 240) {
    throw new Error(`taxa de saída inválida para FFmpeg: ${input.fps}`);
  }
  const fps = stableNumber(input.fps);
  const source = ["-framerate", fps, "-i", input.framePattern];

  if (input.format === "prores4444") {
    return Object.freeze({
      format: input.format,
      passes: Object.freeze([
        Object.freeze([
          ...COMMON,
          ...source,
          "-an",
          "-c:v",
          "prores_ks",
          "-profile:v",
          "4",
          "-pix_fmt",
          "yuva444p10le",
          "-alpha_bits",
          "16",
          "-threads",
          "1",
          "-vendor",
          "apl0",
          "-color_primaries",
          "bt709",
          "-color_trc",
          "bt709",
          "-colorspace",
          "bt709",
          "-map_metadata",
          "-1",
          "-metadata",
          "creation_time=1970-01-01T00:00:00Z",
          input.outputPath,
        ]),
      ]),
    });
  }

  if (input.palettePath === undefined || input.palettePath === "") {
    throw new Error("GIF exige caminho de paleta");
  }
  return Object.freeze({
    format: input.format,
    passes: Object.freeze([
      Object.freeze([
        ...COMMON,
        ...source,
        "-vf",
        "palettegen=stats_mode=full",
        "-frames:v",
        "1",
        "-update",
        "1",
        input.palettePath,
      ]),
      Object.freeze([
        ...COMMON,
        ...source,
        "-i",
        input.palettePath,
        "-lavfi",
        "paletteuse=dither=sierra2_4a:diff_mode=rectangle",
        "-loop",
        "0",
        "-final_delay",
        "0",
        "-gifflags",
        "-offsetting",
        input.outputPath,
      ]),
    ]),
  });
}

/** String decimal sem locale nem notação exponencial para taxas usuais. */
function stableNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "");
}
