/**
 * Revelação de uma anotação: bolinha, guia e texto entram em cena na ordem certa.
 *
 * O pedido do dono, na ordem dele: _"marcar o míssil do avião e uma animação de textbox
 * aparecer uma bolinha uma linha até o text box se afastando do avião e o texto aparecendo
 * falando sobre o míssil"_.
 *
 * **Compila para keyframes, como o roteiro.** Um player que animasse a anotação enquanto o
 * playhead anda seria mais curto e destruiria a mesma propriedade que o
 * [ADR-015](../../../../../docs/adr/ADR-015-studio-points-of-interest.md) protegeu na
 * câmera: a cena deixaria de ser função pura de `(documento, frame)`, e sem isso não há
 * export byte-idêntico. Compilando, a revelação é keyframe como qualquer outro — a
 * timeline mostra, o editor de curvas ajusta, o `Ctrl+Z` desfaz.
 *
 * **Três fases, e a segunda faz duas coisas de uma vez.** A bolinha aparece; então a caixa
 * se **afasta** do objeto e a guia a acompanha, porque a guia é desenhada da bolinha até a
 * borda da caixa e cresce sozinha conforme a caixa sai; então o texto surge por caractere.
 * Animar `leaderProgress` nesta fase seria errado: a linha ficaria mais curta que o vão e
 * não alcançaria a caixa. Aquela prop existe para o outro gesto — caixa já parada, linha se
 * desenhando — e fica disponível para quem quiser animá-la à mão.
 */

import type { Keyframe } from "@theatrum/schema";

export interface RevealTiming {
  /** Frame em que a bolinha começa a aparecer. */
  readonly startFrame: number;
  /** Frames para a bolinha crescer. */
  readonly dotFrames: number;
  /** Frames para a caixa se afastar até o deslocamento final. */
  readonly slideFrames: number;
  /** Frames para o texto ser digitado. */
  readonly textFrames: number;
}

export interface RevealTarget {
  /** Raio final da bolinha, em pixels. É o valor que o nó já tem. */
  readonly dotRadius: number;
  /** Deslocamento final da caixa, em pixels de tela. É o valor que o nó já tem. */
  readonly offsetX: number;
  readonly offsetY: number;
  /**
   * Fundo e borda finais da caixa.
   *
   * **Elas precisam entrar na revelação, e isso foi um defeito achado ao vivo.** A caixa é
   * dimensionada pelo texto **completo** em qualquer valor de `textReveal` — de propósito,
   * senão ela cresceria letra a letra e arrastaria a borda de onde a guia sai. A
   * consequência é que, sem animar fundo e borda, a revelação começa com uma **caixa vazia
   * em tamanho final** já na tela: o balão aparece antes da bolinha que ele deveria
   * explicar. O critério 11 do verificador pegou isso medindo tinta que não crescia.
   */
  readonly backgroundAlpha: number;
  readonly borderWidth: number;
}

export interface RevealWrite {
  readonly path: string;
  readonly keyframes: readonly Keyframe<number>[];
}

export interface CompiledReveal {
  readonly writes: readonly RevealWrite[];
  /** Frame em que a anotação está inteira na tela. */
  readonly endFrame: number;
  readonly diagnostics: readonly string[];
}

/**
 * Alças de aceleração da revelação.
 *
 * A bolinha e a caixa entram com desaceleração — chegam e param, sem ricochete. O texto é
 * **linear** de propósito: digitação com aceleração fica com ritmo irregular, e o olho lê
 * isso como travamento em vez de estilo.
 */
const EASE_IN: readonly [number, number] = [0.25, 1];
const EASE_OUT: readonly [number, number] = [0.4, 0];

/** Um par de keyframes de 0 até o valor final, com as curvas da fase. */
function ramp(
  path: string,
  fromFrame: number,
  toFrame: number,
  fromValue: number,
  toValue: number,
  linear: boolean,
): RevealWrite {
  const id = `reveal:${path}`;
  return {
    path,
    keyframes: [
      {
        id: `${id}:0`,
        frame: fromFrame,
        value: fromValue,
        in: { kind: "linear" },
        out: linear ? { kind: "linear" } : { kind: "bezier", handle: [...EASE_OUT] },
      },
      {
        id: `${id}:1`,
        frame: toFrame,
        value: toValue,
        in: linear ? { kind: "linear" } : { kind: "bezier", handle: [...EASE_IN] },
        out: { kind: "linear" },
      },
    ],
  };
}

export function compileReveal(target: RevealTarget, timing: RevealTiming): CompiledReveal {
  const diagnostics: string[] = [];
  const start = Math.max(0, Math.round(timing.startFrame));
  // Piso de 1 frame em cada fase: com 0 as duas pontas cairiam no mesmo frame, e dois
  // keyframes no mesmo frame são documento inválido — o mesmo cuidado do compilador do
  // roteiro quando a pausa é zero.
  const dot = Math.max(1, Math.round(timing.dotFrames));
  const slide = Math.max(1, Math.round(timing.slideFrames));
  const text = Math.max(1, Math.round(timing.textFrames));

  const dotEnd = start + dot;
  const slideEnd = dotEnd + slide;
  const textEnd = slideEnd + text;

  if (target.dotRadius <= 0) {
    diagnostics.push("A bolinha está com raio zero: ela não vai aparecer.");
  }
  if (target.offsetX === 0 && target.offsetY === 0) {
    diagnostics.push(
      "A caixa está sem afastamento: ela vai nascer sobre o ponto, e a guia não terá para onde crescer.",
    );
  }

  return Object.freeze({
    writes: Object.freeze([
      // Fase 1: a bolinha nasce no ponto.
      ramp("props.dotRadius", start, dotEnd, 0, target.dotRadius, false),
      // Fase 2: a caixa se afasta, e a guia cresce com ela. As duas props andam juntas —
      // separá-las faria a caixa sair na diagonal errada no meio do movimento.
      ramp("props.offsetX", dotEnd, slideEnd, 0, target.offsetX, false),
      ramp("props.offsetY", dotEnd, slideEnd, 0, target.offsetY, false),
      // E a caixa **materializa** enquanto sai, em vez de já estar lá vazia. Ver a nota
      // em `RevealTarget`: sem isto o balão aparece antes da bolinha que ele explica.
      ramp("props.backgroundAlpha", dotEnd, slideEnd, 0, target.backgroundAlpha, false),
      ramp("props.borderWidth", dotEnd, slideEnd, 0, target.borderWidth, false),
      // Fase 3: o texto é digitado.
      ramp("props.textReveal", slideEnd, textEnd, 0, 1, true),
      /**
       * E a guia fica inteira do começo ao fim.
       *
       * Ela é escrita, e não deixada de lado, porque um nó que já tenha `leaderProgress`
       * animado à mão precisaria dessa animação **substituída** — senão a revelação
       * compilada brigaria com a antiga e a linha piscaria sem explicação.
       */
      ramp("props.leaderProgress", start, textEnd, 1, 1, true),
    ]),
    endFrame: textEnd,
    diagnostics: Object.freeze(diagnostics),
  });
}
