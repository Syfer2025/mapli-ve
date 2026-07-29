/**
 * Provas da revelação da anotação.
 *
 * A ordem das fases é o produto: bolinha, depois a caixa se afastando com a guia, depois o
 * texto. Um erro aqui não aparece como exceção — aparece como a legenda surgindo antes de o
 * espectador saber do que ela fala.
 */

import { describe, expect, it } from "vitest";
import { compileReveal } from "./studio-reveal.js";

const TARGET = { dotRadius: 5, offsetX: 140, offsetY: -90, backgroundAlpha: 0.88, borderWidth: 1 };
const TIMING = { startFrame: 0, dotFrames: 6, slideFrames: 12, textFrames: 24 };

function write(tour: ReturnType<typeof compileReveal>, path: string) {
  return tour.writes.find((entry) => entry.path === path);
}

describe("compileReveal", () => {
  it("escreve as sete props da anotação, e só elas", () => {
    expect(compileReveal(TARGET, TIMING).writes.map((entry) => entry.path)).toEqual([
      "props.dotRadius",
      "props.offsetX",
      "props.offsetY",
      "props.backgroundAlpha",
      "props.borderWidth",
      "props.textReveal",
      "props.leaderProgress",
    ]);
  });

  /**
   * **A ordem é o produto.** A bolinha termina antes de a caixa começar a sair, e a caixa
   * chega antes de a primeira letra aparecer. Fora dessa ordem a legenda se explica antes
   * de apontar.
   */
  it("as fases não se sobrepõem, e vêm na ordem que o dono descreveu", () => {
    const reveal = compileReveal(TARGET, TIMING);
    const fim = (path: string) => write(reveal, path)?.keyframes[1]?.frame ?? -1;
    const inicio = (path: string) => write(reveal, path)?.keyframes[0]?.frame ?? -1;

    expect(inicio("props.dotRadius")).toBe(0);
    expect(fim("props.dotRadius")).toBe(6);
    expect(inicio("props.offsetX")).toBe(6);
    expect(fim("props.offsetX")).toBe(18);
    expect(inicio("props.textReveal")).toBe(18);
    expect(fim("props.textReveal")).toBe(42);
    expect(reveal.endFrame).toBe(42);
  });

  it("cada prop vai de zero até o valor que o nó já tem", () => {
    const reveal = compileReveal(TARGET, TIMING);
    expect(write(reveal, "props.dotRadius")?.keyframes.map((k) => k.value)).toEqual([0, 5]);
    expect(write(reveal, "props.offsetX")?.keyframes.map((k) => k.value)).toEqual([0, 140]);
    expect(write(reveal, "props.offsetY")?.keyframes.map((k) => k.value)).toEqual([0, -90]);
    expect(write(reveal, "props.textReveal")?.keyframes.map((k) => k.value)).toEqual([0, 1]);
  });

  /**
   * As duas coordenadas do deslocamento andam **juntas**. Fases diferentes fariam a caixa
   * sair na diagonal errada no meio do movimento — para o lado primeiro, para cima depois.
   */
  it("as duas coordenadas do afastamento têm os mesmos frames", () => {
    const reveal = compileReveal(TARGET, TIMING);
    expect(write(reveal, "props.offsetX")?.keyframes.map((k) => k.frame)).toEqual(
      write(reveal, "props.offsetY")?.keyframes.map((k) => k.frame),
    );
  });

  /**
   * A guia fica inteira do começo ao fim, e é **escrita** em vez de omitida: um nó com
   * `leaderProgress` animado à mão precisa dessa animação substituída, senão a revelação
   * nova briga com a antiga e a linha pisca sem explicação.
   */
  it("a guia é mantida inteira e cobre a revelação toda", () => {
    const guia = write(compileReveal(TARGET, TIMING), "props.leaderProgress");
    expect(guia?.keyframes.map((k) => k.value)).toEqual([1, 1]);
    expect(guia?.keyframes[0]?.frame).toBe(0);
    expect(guia?.keyframes[1]?.frame).toBe(42);
  });

  /**
   * O texto é digitado em ritmo **linear**. Digitação com aceleração fica com ritmo
   * irregular, e o olho lê isso como travamento em vez de estilo.
   */
  it("o texto revela linear e a bolinha desacelera", () => {
    const reveal = compileReveal(TARGET, TIMING);
    for (const keyframe of write(reveal, "props.textReveal")?.keyframes ?? []) {
      expect(keyframe.in.kind).toBe("linear");
      expect(keyframe.out.kind).toBe("linear");
    }
    expect(write(reveal, "props.dotRadius")?.keyframes[1]?.in.kind).toBe("bezier");
  });

  /** Fase de zero frames viraria dois keyframes no mesmo frame, que é documento inválido. */
  it("nenhuma fase colapsa num único frame", () => {
    const reveal = compileReveal(TARGET, {
      startFrame: -5,
      dotFrames: 0,
      slideFrames: -3,
      textFrames: 0,
    });
    for (const entry of reveal.writes) {
      const frames = entry.keyframes.map((k) => k.frame);
      expect(new Set(frames).size).toBe(frames.length);
      expect(frames.every((frame) => Number.isInteger(frame) && frame >= 0)).toBe(true);
    }
  });

  /** Ids estáveis: recompilar substitui em vez de acumular. */
  it("os ids são função da prop, iguais entre compilações", () => {
    expect(compileReveal(TARGET, TIMING)).toEqual(compileReveal(TARGET, TIMING));
    expect(
      write(compileReveal(TARGET, TIMING), "props.dotRadius")?.keyframes.map((k) => k.id),
    ).toEqual(["reveal:props.dotRadius:0", "reveal:props.dotRadius:1"]);
  });

  /** Dois casos que produzem anotação invisível, e o compilador diz em voz alta. */
  it("avisa quando a anotação não teria como aparecer", () => {
    expect(compileReveal({ ...TARGET, dotRadius: 0 }, TIMING).diagnostics.join(" ")).toContain(
      "bolinha",
    );
    expect(
      compileReveal({ ...TARGET, offsetX: 0, offsetY: 0 }, TIMING).diagnostics.join(" "),
    ).toContain("afastamento");
  });
});
