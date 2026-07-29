/**
 * Provas da sombra direcional do palco.
 *
 * A sombra era calculada com a luz assumida **vertical**, o que dá uma mancha embaixo do
 * objeto em vez de uma sombra que se estica para um lado. O que estes testes travam é a
 * geometria que tornou a sombra direcional possível — a base da câmera de luz e o retângulo
 * que tem de conter a sombra, não só a pegada.
 */

import { describe, expect, it } from "vitest";
import { fitLightFrustum, lightBasis } from "./studio-shadow.js";
import { keyLightDirection } from "./studio-scene.js";

function magnitude(v: readonly [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("keyLightDirection", () => {
  /** Mesma régua da câmera orbital: azimute do sul girando para o leste. */
  it("azimute 0 põe a luz ao sul, 90 ao leste", () => {
    const sul = keyLightDirection(0, 0);
    expect(sul[2]).toBeCloseTo(1, 9);
    expect(sul[0]).toBeCloseTo(0, 9);
    const leste = keyLightDirection(90, 0);
    expect(leste[0]).toBeCloseTo(1, 9);
    expect(leste[2]).toBeCloseTo(0, 9);
  });

  it("elevação 90 põe a luz no zênite, e a direção é sempre unitária", () => {
    expect(keyLightDirection(35, 90)[1]).toBeCloseTo(1, 9);
    for (const [az, el] of [
      [0, 0],
      [138, 24],
      [-70, 61],
      [400, 89],
    ]) {
      expect(magnitude(keyLightDirection(az ?? 0, el ?? 0))).toBeCloseTo(1, 9);
    }
  });

  /** Elevação fora da faixa satura em vez de virar luz vinda de baixo do chão. */
  it("elevação negativa satura em zero", () => {
    expect(keyLightDirection(0, -30)[1]).toBeCloseTo(0, 9);
  });
});

describe("lightBasis", () => {
  it("a base é ortonormal", () => {
    const basis = lightBasis(keyLightDirection(138, 24));
    expect(basis).not.toBeNull();
    if (basis === null) return;
    for (const axis of [basis.forward, basis.right, basis.up]) {
      expect(magnitude(axis as [number, number, number])).toBeCloseTo(1, 9);
    }
    expect(dot(basis.forward, basis.right)).toBeCloseTo(0, 9);
    expect(dot(basis.forward, basis.up)).toBeCloseTo(0, 9);
    expect(dot(basis.right, basis.up)).toBeCloseTo(0, 9);
  });

  /** A câmera olha **da luz para a cena**: o oposto da direção da luz. */
  it("o forward aponta para baixo, contra a direção da luz", () => {
    const direction = keyLightDirection(138, 24);
    const basis = lightBasis(direction);
    expect(basis?.forward[1]).toBeLessThan(0);
    expect(dot(basis?.forward ?? [0, 0, 0], direction)).toBeCloseTo(-1, 9);
  });

  /**
   * Luz rente ao horizonte devolve `null`, e o projetor recua para a projeção vertical.
   *
   * Não é preguiça: a sombra tende ao infinito e o retângulo teria de cobrir o palco todo
   * para conter uma silhueta de um texel de altura. Recuar para o que sempre funcionou é
   * mais honesto que entregar sombra ilegível.
   */
  it("recusa luz baixa demais e direção degenerada", () => {
    expect(lightBasis(keyLightDirection(138, 0))).toBeNull();
    expect(lightBasis(keyLightDirection(138, 3))).toBeNull();
    expect(lightBasis([0, 0, 0])).toBeNull();
    expect(lightBasis([0, -1, 0])).toBeNull();
  });

  /**
   * Perto do zênite a base não pode degenerar. Com `up` fixo em Y ela degeneraria — foi por
   * isso que a versão vertical deste projetor usava `up` em −Z.
   */
  it("sobrevive à luz no zênite", () => {
    const basis = lightBasis(keyLightDirection(0, 89.9));
    expect(basis).not.toBeNull();
    if (basis === null) return;
    expect(magnitude(basis.right as [number, number, number])).toBeCloseTo(1, 6);
    expect(magnitude(basis.up as [number, number, number])).toBeCloseTo(1, 6);
  });
});

describe("fitLightFrustum", () => {
  const cube = (half: number, top: number): (readonly [number, number, number])[] => {
    const corners: (readonly [number, number, number])[] = [];
    for (const x of [-half, half]) {
      for (const y of [0, top]) {
        for (const z of [-half, half]) corners.push([x, y, z]);
      }
    }
    return corners;
  };

  /**
   * **O critério do bloco.** Com luz oblíqua o retângulo tem de ser **maior** que com luz
   * vertical, porque a sombra sai da pegada. Ajustar pela pegada — que é o que a versão
   * anterior fazia, e estava certo para luz vertical — cortaria a sombra ao meio.
   */
  it("luz mais baixa exige retângulo maior que luz alta", () => {
    const corners = cube(5, 10);
    const alta = fitLightFrustum(corners, [0, 5, 0], lightBasis(keyLightDirection(138, 80))!);
    const baixa = fitLightFrustum(corners, [0, 5, 0], lightBasis(keyLightDirection(138, 12))!);
    expect(alta).not.toBeNull();
    expect(baixa).not.toBeNull();
    const area = (fit: NonNullable<typeof alta>) => fit.halfWidth * fit.halfHeight;
    expect(area(baixa as NonNullable<typeof alta>)).toBeGreaterThan(
      area(alta as NonNullable<typeof alta>),
    );
  });

  it("contém todos os cantos que recebeu", () => {
    const corners = cube(4, 9);
    const basis = lightBasis(keyLightDirection(138, 24));
    expect(basis).not.toBeNull();
    if (basis === null) return;
    const origin: readonly [number, number, number] = [0, 4.5, 0];
    const fit = fitLightFrustum(corners, origin, basis);
    expect(fit).not.toBeNull();
    if (fit === null) return;
    for (const corner of corners) {
      const d: readonly [number, number, number] = [
        corner[0] - origin[0],
        corner[1] - origin[1],
        corner[2] - origin[2],
      ];
      expect(Math.abs(dot(d, basis.right))).toBeLessThanOrEqual(fit.halfWidth + 1e-9);
      expect(Math.abs(dot(d, basis.up))).toBeLessThanOrEqual(fit.halfHeight + 1e-9);
      expect(Math.abs(dot(d, basis.forward))).toBeLessThanOrEqual(fit.depth + 1e-9);
    }
  });

  it("objeto maior dá retângulo proporcionalmente maior", () => {
    const basis = lightBasis(keyLightDirection(138, 24))!;
    const pequeno = fitLightFrustum(cube(2, 4), [0, 2, 0], basis)!;
    const grande = fitLightFrustum(cube(4, 8), [0, 4, 0], basis)!;
    expect(grande.halfWidth).toBeCloseTo(pequeno.halfWidth * 2, 6);
    expect(grande.halfHeight).toBeCloseTo(pequeno.halfHeight * 2, 6);
  });

  it("sem cantos devolve null, e objeto degenerado tem piso", () => {
    const basis = lightBasis(keyLightDirection(138, 24))!;
    expect(fitLightFrustum([], [0, 0, 0], basis)).toBeNull();
    const minusculo = fitLightFrustum([[0, 0, 0]], [0, 0, 0], basis);
    expect(minusculo?.halfWidth).toBeGreaterThan(0);
    expect(minusculo?.depth).toBeGreaterThan(0);
  });
});
