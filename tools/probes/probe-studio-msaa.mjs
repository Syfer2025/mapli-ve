/**
 * O palco 3D (Three, `antialias: true`) e o overlay Pixi (`antialias: true`)
 * sofrem do mesmo que o mapa acima de 2 MP?
 *
 * O palco é o caso mais forte: render 3D de tela cheia, com grade, sombra e
 * reflexo. Se o MSAA quebra a repetição em 4K, aparece aqui.
 */

import { open, activateTab } from "./cdp.mjs";

const client = await open();

try {
  await activateTab(client, "Palco 3D", ".studio-viewport__stage");

  // Sem nó `studio.stage` o `render` do runtime sai na hora e nunca chama
  // `setSize` — o canvas fica no padrão 300x150 e a medição não mede nada.
  // Foi exatamente o que a primeira rodada relatou.
  const montado = await client.evaluate(`(async () => {
    const S = session();
    const estado = S.getSnapshot();
    const comp = estado.document.compositions.find((c) => c.id === estado.selectedCompositionId);
    const existente = Object.values(comp.nodes).find((n) => n.type === 'studio.stage');
    if (existente !== undefined) return { criado: false, id: existente.id };
    const id = S.actions.addNodeOfType('studio.stage');
    S.actions.clearSelection();
    await wait(1200);
    return { criado: true, id };
  })()`);
  console.log(
    `  palco: nó studio.stage ${montado.criado ? "criado" : "já existia"} (${montado.id})`,
  );

  for (const css of [
    [1248, 566],
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ]) {
    const r = await client.evaluate(`(async () => {
      const css = ${JSON.stringify(css)};
      const painel = document.querySelector('.studio-viewport');
      const antes = { w: painel.style.width, h: painel.style.height };
      const sha = async (bytes) => {
        const d = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
      };
      try {
        session().actions.pause();
        session().actions.setPlayhead(0);
        painel.style.width = css[0] + 'px';
        painel.style.height = css[1] + 'px';
        await wait(1800);

        const stage = document.querySelector('.studio-viewport__stage');
        const pixi = document.querySelector('.studio-viewport__pixi');
        const w = stage.width, h = stage.height;
        const gl = stage.getContext('webgl2');
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const ler = (fonte) => {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(fonte, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h).data;
        };
        // Força repintura do palco andando no playhead e voltando: é o gatilho
        // real do render, e é o que o pump do export faz entre frames.
        const repintar = async () => {
          session().actions.setPlayhead(3);
          await wait(320);
          session().actions.setPlayhead(0);
          await wait(420);
        };

        const stageHashes = [await sha(ler(stage))];
        const pixiHashes = pixi === null ? [] : [await sha(ler(pixi))];
        for (let volta = 0; volta < 2; volta += 1) {
          await repintar();
          stageHashes.push(await sha(ler(stage)));
          if (pixi !== null) pixiHashes.push(await sha(ler(pixi)));
        }
        return {
          fisico: [w, h],
          samples: gl === null ? null : gl.getParameter(gl.SAMPLES),
          atributos: gl === null ? null : gl.getContextAttributes(),
          stageDistintos: new Set(stageHashes).size,
          pixiDistintos: pixi === null ? null : new Set(pixiHashes).size,
          leituras: stageHashes.length,
        };
      } finally {
        painel.style.width = antes.w;
        painel.style.height = antes.h;
        session().actions.setPlayhead(0);
        await wait(700);
      }
    })()`);
    console.log(
      `  ${r.fisico.join("x").padEnd(11)} ${((r.fisico[0] * r.fisico[1]) / 1e6).toFixed(2).padStart(5)} MP  ` +
        `SAMPLES=${String(r.samples).padStart(2)} antialias=${r.atributos?.antialias}  ` +
        `palco ${r.stageDistintos}/${r.leituras} ${r.stageDistintos === 1 ? "IDÊNTICO" : "DIVERGE"}  ` +
        `pixi ${r.pixiDistintos}/${r.leituras} ${r.pixiDistintos === 1 ? "IDÊNTICO" : "DIVERGE"}`,
    );
  }
  if (montado.criado) {
    const desfeito = await client.evaluate(`(async () => {
      const bus = session().commandBus;
      let n = 0;
      while (bus.history.canUndo() && n < 20) { bus.history.undo(); n += 1; }
      await wait(400);
      const estado = session().getSnapshot();
      const comp = estado.document.compositions.find((c) => c.id === estado.selectedCompositionId);
      return { n, sobrou: Object.values(comp.nodes).some((x) => x.type === 'studio.stage') };
    })()`);
    console.log(`  desfeito: ${desfeito.n} comandos, studio.stage sobrou=${desfeito.sobrou}`);
  }
} finally {
  client.close();
}
