/**
 * Provas da ancoragem do ponto de interesse ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
 *
 * O defeito que estes testes existem para impedir é o que o dono relatou: o ponto
 * fica no espaço em vez de ficar no objeto, e mudar a escala do modelo o deixa no
 * limbo. Um erro aqui não aparece como exceção — aparece como a câmera do vídeo
 * mirando o vazio ao lado do caça.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { anchorToWorld, worldToAnchor, type AnchorFrame } from "./studio-anchor.js";

function frame(overrides: Partial<AnchorFrame> = {}): AnchorFrame {
  return {
    position: [0, 0, 0],
    headingDeg: 0,
    sizeMeters: 18,
    bottom: -0.25,
    ...overrides,
  };
}

/** O centro do modelo é, por construção, a origem do espaço normalizado. */
function center(anchor: AnchorFrame): readonly [number, number, number] {
  return anchorToWorld([0, 0, 0], anchor);
}

function offsetFromCenter(
  local: readonly [number, number, number],
  anchor: AnchorFrame,
): readonly [number, number, number] {
  const world = anchorToWorld(local, anchor);
  const origin = center(anchor);
  return [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
}

function magnitude(vector: readonly [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

describe("anchorToWorld", () => {
  /**
   * A convenção de rumo, travada com um caso assimétrico de propósito.
   *
   * Com rumo 90° e o ponto uma unidade a leste no espaço do modelo, ele tem de cair
   * uma unidade ao NORTE em z (−1). Uma matriz de rotação escrita de memória com o
   * seno trocado de sinal devolveria +1: o ponto continuaria na silhueta do modelo,
   * espelhado, e o defeito passaria por "quase certo" numa inspeção visual.
   */
  it("gira o ponto na mesma convenção de rumo do palco", () => {
    const world = anchorToWorld([1, 0, 0], frame({ headingDeg: 90, sizeMeters: 1, bottom: 0 }));
    expect(world[0]).toBeCloseTo(0, 10);
    expect(world[1]).toBeCloseTo(0, 10);
    expect(world[2]).toBeCloseTo(-1, 10);
  });

  /**
   * **O critério do ADR-016.** Dobrar `scaleMeters` tem de dobrar o afastamento do
   * ponto em relação ao centro do objeto — é isso que significa "o ponto está no
   * míssil" quando o avião cresce.
   *
   * É também o teste que separa esta decisão da alternativa D, que guardaria o
   * deslocamento em metros: lá este número ficaria constante, e o ponto sairia da
   * superfície sem que nada acusasse.
   */
  it("acompanha a escala do modelo", () => {
    const local: readonly [number, number, number] = [0.3, 0.1, -0.2];
    const pequeno = magnitude(offsetFromCenter(local, frame({ sizeMeters: 18 })));
    const grande = magnitude(offsetFromCenter(local, frame({ sizeMeters: 36 })));
    expect(grande).toBeCloseTo(pequeno * 2, 9);
    // E o ponto de fato se move no palco, que é o que não acontecia antes.
    const antes = anchorToWorld(local, frame({ sizeMeters: 18 }));
    const depois = anchorToWorld(local, frame({ sizeMeters: 36 }));
    expect(
      magnitude([depois[0] - antes[0], depois[1] - antes[1], depois[2] - antes[2]]),
    ).toBeGreaterThan(0.1);
  });

  it("acompanha a translação do modelo", () => {
    const local: readonly [number, number, number] = [0.2, 0.4, 0.1];
    const parado = anchorToWorld(local, frame());
    const movido = anchorToWorld(local, frame({ position: [10, 3, -4] }));
    expect(movido[0]).toBeCloseTo(parado[0] + 10, 9);
    expect(movido[1]).toBeCloseTo(parado[1] + 3, 9);
    expect(movido[2]).toBeCloseTo(parado[2] - 4, 9);
  });

  /**
   * Girar o modelo gira o ponto em torno do centro **sem** mudar a distância até
   * ele. Rotação que estica é sinal de escala vazando para dentro do seno.
   */
  it("gira o ponto em torno do centro sem mudar a distância", () => {
    const local: readonly [number, number, number] = [0.3, 0.05, 0.15];
    const raio = magnitude(offsetFromCenter(local, frame({ headingDeg: 0 })));
    for (const headingDeg of [37, 90, 180, 271, -64]) {
      expect(magnitude(offsetFromCenter(local, frame({ headingDeg })))).toBeCloseTo(raio, 9);
    }
  });

  /**
   * `altitudeMeters` é a altura da **base**, não do centro, e é `bottom` que faz a
   * diferença. Com o ponto no centro do modelo, subir a base sobe o ponto igual.
   */
  it("respeita a base do modelo na altura", () => {
    const apoiado = anchorToWorld([0, 0, 0], frame({ position: [0, 0, 0], bottom: -0.25 }));
    // bottom = −0,25 em unidades normalizadas, escala 18 → o centro fica 4,5 m acima.
    expect(apoiado[1]).toBeCloseTo(4.5, 9);
  });
});

describe("worldToAnchor", () => {
  it("é a inversa exata de anchorToWorld nos casos tabelados", () => {
    const anchor = frame({ position: [12, 2, -7], headingDeg: 63, sizeMeters: 24, bottom: -0.31 });
    const local: readonly [number, number, number] = [0.21, -0.08, 0.44];
    const roundTrip = worldToAnchor(anchorToWorld(local, anchor), anchor);
    expect(roundTrip[0]).toBeCloseTo(local[0], 9);
    expect(roundTrip[1]).toBeCloseTo(local[1], 9);
    expect(roundTrip[2]).toBeCloseTo(local[2], 9);
  });

  /**
   * Ida e volta sobre entrada arbitrária.
   *
   * **Semente fixa, de propósito.** A suíte hoje usa semente livre por omissão, e
   * 09-CONTINUIDADE § 4.17 registra o custo disso: uma propriedade sobre ida e
   * volta com semente livre é exatamente a receita do vermelho intermitente que
   * custou uma investigação inteira. Num teste novo cujo assunto é uma inversa,
   * congelar o achado é a escolha defensável — e a decisão para o resto da suíte
   * continua aberta no roteiro, não fica decidida por acidente aqui.
   */
  it("é a inversa de anchorToWorld sobre entrada arbitrária", () => {
    const finite = (min: number, max: number) =>
      fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(
        finite(-2, 2),
        finite(-2, 2),
        finite(-2, 2),
        finite(-500, 500),
        finite(-90, 400),
        finite(0.1, 500),
        (lx, ly, lz, px, headingDeg, sizeMeters) => {
          const anchor = frame({ position: [px, 3, -px], headingDeg, sizeMeters, bottom: -0.5 });
          const local: readonly [number, number, number] = [lx, ly, lz];
          const back = worldToAnchor(anchorToWorld(local, anchor), anchor);
          // Tolerância relativa: com vão de 500 m e ponto na ponta da asa, o erro
          // de ponto flutuante da ida e volta escala com a escala. Absoluto aqui
          // reprovaria a função por precisão de double, não por defeito.
          const scale = Math.max(1, Math.abs(lx), Math.abs(ly), Math.abs(lz));
          expect(back[0]).toBeCloseTo(local[0], 6 - Math.log10(scale));
          expect(back[1]).toBeCloseTo(local[1], 6 - Math.log10(scale));
          expect(back[2]).toBeCloseTo(local[2], 6 - Math.log10(scale));
        },
      ),
      { seed: 20260728, numRuns: 400 },
    );
  });

  /**
   * Escala degenerada não pode produzir `NaN` nem `Infinity`.
   *
   * `collectStudioModels` já limita a 0,1 m, mas o resolvedor do roteiro monta
   * quadro a partir do documento e um `.theatrum` editado à mão pode trazer zero.
   * Um `Infinity` escapando daqui viraria marcador invisível sem explicação três
   * camadas acima — o modo de falha que este projeto chama de silencioso.
   */
  it("não produz NaN nem Infinity com escala zerada", () => {
    for (const sizeMeters of [0, -1]) {
      const anchor = frame({ sizeMeters });
      const local = worldToAnchor([1, 2, 3], anchor);
      expect(local.every(Number.isFinite)).toBe(true);
      expect(anchorToWorld([0.1, 0.2, 0.3], anchor).every(Number.isFinite)).toBe(true);
    }
  });
});
