/**
 * A transação de tamanho do export, sem DOM e sem GPU.
 *
 * O que se afirma aqui é a parte que erra em silêncio: uma superfície que não
 * aplicou o tamanho ainda, a volta que não acontece quando o export estoura, e a
 * geração que uma superfície desmontada deixaria para trás. Todos os três
 * produzem um arquivo **plausível** — com o frame no tamanho do painel, ou com o
 * painel do usuário travado em 4K — e nenhum deles aparece num verificador que
 * só compara hashes entre duas execuções, porque as duas erram igual.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  effectivePixelRatio,
  expectedSurfacePixels,
  getSurfaceOverrideSnapshot,
  registerExportSurface,
  resetSurfaceOverrideForTest,
  runWithSurfaceOverride,
  subscribeSurfaceOverride,
  surfaceMatches,
  type SurfaceOverride,
} from "./surface-override.js";

const ALVO: SurfaceOverride = { width: 1920, height: 1080, pixelRatio: 2 };

/**
 * Uma superfície com canvas de mentira, que redimensiona quando o estado muda.
 *
 * `atrasoTicks` imita o overlay Pixi: ele só chega ao tamanho novo alguns ticks
 * depois, por `ResizeObserver` → `setState` → efeito de render. É esse atraso que
 * a transação tem de esperar, e é ele que a primeira versão não esperava.
 */
function fakeSurface(
  id: string,
  atrasoTicks = 0,
): { readonly canvas: { width: number; height: number }; dispose(): void } {
  const canvas = { width: 800, height: 600 };
  let restantes = 0;
  const unregister = registerExportSurface(id, (override) => {
    const alvo = expectedSurfacePixels(override);
    if (alvo === null) return true;
    if (restantes > 0) {
      restantes -= 1;
      return false;
    }
    canvas.width = alvo.width;
    canvas.height = alvo.height;
    return surfaceMatches(override, canvas);
  });
  const unsubscribe = subscribeSurfaceOverride(() => {
    restantes = atrasoTicks;
  });
  return {
    canvas,
    dispose(): void {
      unsubscribe();
      unregister();
    },
  };
}

afterEach(() => {
  resetSurfaceOverrideForTest();
});

describe("runWithSurfaceOverride", () => {
  it("roda o corpo quando não há superfície montada", async () => {
    // Aba inativa não existe no DOM e por isso não se registra. Travar o export
    // esperando por ela seria o oposto do que o frame-composer faz.
    const resultado = await runWithSurfaceOverride(ALVO, () => Promise.resolve("pronto"));
    expect(resultado).toBe("pronto");
  });

  it("só solta o corpo quando a superfície ESTÁ no tamanho", async () => {
    // O caso da regressão: a superfície demora alguns ticks para chegar lá. Se a
    // transação soltasse o corpo antes, o compositor esticaria o frame.
    const superficie = fakeSurface("overlay", 4);
    try {
      let dentro: { width: number; height: number } | null = null;
      await runWithSurfaceOverride(ALVO, () => {
        dentro = { ...superficie.canvas };
        return Promise.resolve();
      });
      expect(dentro).toEqual({ width: 3840, height: 2160 });
      expect(getSurfaceOverrideSnapshot().override).toBeNull();
    } finally {
      superficie.dispose();
    }
  });

  it("devolve o tamanho medido mesmo quando o export estoura", async () => {
    // A metade que ninguém testa até deixar o painel do usuário em 4K.
    const superficie = fakeSurface("mapa");
    try {
      await expect(
        runWithSurfaceOverride(ALVO, () => Promise.reject(new Error("disco cheio"))),
      ).rejects.toThrow("disco cheio");
      expect(getSurfaceOverrideSnapshot().override).toBeNull();
    } finally {
      superficie.dispose();
    }
  });

  it("estoura nomeando a superfície que nunca chega ao tamanho", async () => {
    // É o caso do `maxCanvasSize` do MapLibre, que baixa o pixel ratio em silêncio
    // acima de 4096 px: o canvas nunca alcança o pedido. Travar calado seria pior.
    const unregister = registerExportSurface("palco", () => false);
    try {
      let corpoRodou = false;
      await expect(
        runWithSurfaceOverride(
          ALVO,
          () => {
            corpoRodou = true;
            return Promise.resolve();
          },
          { timeoutMs: 60 },
        ),
      ).rejects.toThrow("palco");
      expect(corpoRodou).toBe(false);
      expect(getSurfaceOverrideSnapshot().override).toBeNull();
    } finally {
      unregister();
    }
  });

  it("cancelamento solta a espera inicial para o corpo produzir o relatório", async () => {
    const unregister = registerExportSurface("palco", () => false);
    let checks = 0;
    try {
      const result = await runWithSurfaceOverride(ALVO, () => Promise.resolve("abortado"), {
        timeoutMs: 1_000,
        shouldAbort: () => {
          checks += 1;
          return checks >= 2;
        },
      });
      expect(result).toBe("abortado");
      expect(checks).toBeGreaterThanOrEqual(2);
      expect(getSurfaceOverrideSnapshot().override).toBeNull();
    } finally {
      unregister();
    }
  });

  it("superfície que estoura ao se medir não mata o export", async () => {
    // Ref nula durante troca de aba não pode derrubar um export em curso.
    const explode = registerExportSurface("quebrada", () => {
      throw new Error("ref nula");
    });
    const boa = fakeSurface("mapa");
    try {
      await expect(
        runWithSurfaceOverride(ALVO, () => Promise.resolve(), { timeoutMs: 60 }),
      ).rejects.toThrow("quebrada");
    } finally {
      explode();
      boa.dispose();
    }
  });

  it("recusa dois exports ao mesmo tempo", async () => {
    // Gatilho de revisão 1 do ADR-022: dois jobs sobre uma superfície só pedem a
    // segunda instância de motor, não um redimensionamento por baixo do outro.
    let libera = (): void => undefined;
    const bloqueado = new Promise<void>((resolve) => {
      libera = resolve;
    });
    const primeiro = runWithSurfaceOverride(ALVO, () => bloqueado);
    await expect(runWithSurfaceOverride(ALVO, () => Promise.resolve())).rejects.toThrow(
      /já há um export/,
    );
    libera();
    await primeiro;
  });

  it("superfície desmontada deixa de ser esperada", async () => {
    // Aba que sai de cena no meio do export não pode travá-lo: o frame-composer
    // exporta o modo montado, e o que não está montado não entra no frame.
    const sumiu = registerExportSurface("palco", () => false);
    sumiu();
    await expect(
      runWithSurfaceOverride(ALVO, () => Promise.resolve("ok"), { timeoutMs: 60 }),
    ).resolves.toBe("ok");
  });
});

describe("surfaceMatches", () => {
  it("exige igualdade exata durante o export", () => {
    // Um pixel de diferença faz o compositor ESCALAR a superfície dentro do frame
    // planejado — plausível, e diferente entre execuções.
    const alvo: SurfaceOverride = { width: 1920, height: 1080, pixelRatio: 1 };
    expect(surfaceMatches(alvo, { width: 1920, height: 1080 })).toBe(true);
    expect(surfaceMatches(alvo, { width: 1919, height: 1080 })).toBe(false);
  });

  it("não espera superfície que saiu do documento", () => {
    // O dockview desmonta o painel inativo e o canvas GUARDA o último tamanho.
    // Ele não recebe mais ResizeObserver, então nunca chegaria ao alvo — e o
    // frame-composer não o compõe, porque procura por querySelector. Esperar por
    // ele travou o export por 10 s e devolveu zero frame.
    const alvo: SurfaceOverride = { width: 1920, height: 1080, pixelRatio: 1 };
    expect(surfaceMatches(alvo, { width: 2032, height: 828, isConnected: false })).toBe(true);
    // Conectado e do tamanho errado continua sendo espera legítima.
    expect(surfaceMatches(alvo, { width: 2032, height: 828, isConnected: true })).toBe(false);
  });

  it("não espera superfície que o compositor ignora", () => {
    // O palco sem nó studio.stage nunca chama setSize e fica nos 300×150 de
    // fábrica. Esperar por ele travava um export que nem ia lê-lo — foi o que
    // parou o verify:phase8 em "superfícies não chegaram ao tamanho: studio".
    const alvo: SurfaceOverride = { width: 1920, height: 1080, pixelRatio: 1 };
    expect(surfaceMatches(alvo, { width: 300, height: 150 })).toBe(true);
    expect(surfaceMatches(alvo, { width: 1, height: 1 })).toBe(true);
    expect(surfaceMatches(alvo, null)).toBe(true);
    // Mas um canvas do tamanho do painel É composto, e por isso tem de esperar.
    expect(surfaceMatches(alvo, { width: 2360, height: 800 })).toBe(false);
  });

  it("fora do export, qualquer tamanho serve", () => {
    expect(surfaceMatches(null, { width: 7, height: 3 })).toBe(true);
    expect(surfaceMatches(null, null)).toBe(true);
  });

  it("a escala multiplica o tamanho de CSS", () => {
    expect(expectedSurfacePixels(ALVO)).toEqual({ width: 3840, height: 2160 });
    expect(expectedSurfacePixels(null)).toBeNull();
  });
});

describe("effectivePixelRatio", () => {
  it("a escala do job ganha do teto da tela durante o export", () => {
    // Recortar a escala pedida produziria um arquivo menor que o pedido sem
    // dizer nada — que é o pecado do maxCanvasSize que o ADR-022 recusa repetir.
    expect(effectivePixelRatio({ width: 1920, height: 1080, pixelRatio: 3 }, 1, 2)).toBe(3);
  });

  it("fora do export vale a tela, com o teto", () => {
    expect(effectivePixelRatio(null, 3, 2)).toBe(2);
    expect(effectivePixelRatio(null, 1, 2)).toBe(1);
    // Nunca abaixo de 1: um devicePixelRatio fracionário não pode encolher o
    // backing store abaixo do tamanho de CSS.
    expect(effectivePixelRatio(null, 0.5, 2)).toBe(1);
  });
});
