/**
 * 6a · limiar da repintura do MapLibre, sem criar contexto WebGL novo.
 *
 * A versão que criava quatro contextos crus estourou o tempo do CDP e é risco
 * real: o teto do Chromium é dezesseis contextos (ADR-012), e o aplicativo tem
 * os seus vivos. Aqui só o canvas do mapa é usado, e `SAMPLES` é lido a cada
 * tamanho — se ele muda com o tamanho, o MSAA é o suspeito sem precisar de
 * bancada separada.
 */

import { open, activateTab } from "./cdp.mjs";

const client = await open();

try {
  await activateTab(client, "Viewport", ".maplibregl-canvas");
  await client.evaluate(`(async () => {
    session().actions.pause();
    session().actions.clearSelection();
    session().actions.setPlayhead(0);
    mapa().jumpTo({ center: [35.6, 50.2], zoom: 6, pitch: 0, bearing: 0 });
    await window.__theatrumPhase2.settle(10000);
    await wait(800);
    return true;
  })()`);

  console.log("── limiar da repintura do MapLibre ──────────────────────────────");
  for (const css of [
    [1248, 566],
    [1920, 1080],
    [2560, 1440],
    [3072, 1728],
    [3840, 2160],
  ]) {
    const r = await client.evaluate(`(async () => {
      const css = ${JSON.stringify(css)};
      const container = document.querySelector('.map-viewport__map');
      const overlayRaiz = document.querySelector('.scene-overlay');
      const antes = {
        cw: container.style.width, ch: container.style.height,
        ow: overlayRaiz.style.width, oh: overlayRaiz.style.height,
      };
      const sha = async (bytes) => {
        const d = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
      };
      try {
        for (const el of [container, overlayRaiz]) {
          el.style.width = css[0] + 'px';
          el.style.height = css[1] + 'px';
        }
        mapa().resize();
        await window.__theatrumPhase2.settle(20000);
        await wait(900);
        const mapCanvas = mapa().getCanvas();
        const w = mapCanvas.width, h = mapCanvas.height;
        const gl = mapCanvas.getContext('webgl2');
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const ler = () => {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(mapCanvas, 0, 0, w, h);
          return ctx.getImageData(0, 0, w, h).data;
        };
        const repintar = () => new Promise((resolve) => {
          mapa().once('idle', () => resolve());
          mapa().triggerRepaint();
        });
        const hashes = [await sha(ler())];
        for (let volta = 0; volta < 2; volta += 1) {
          await repintar();
          await wait(200);
          hashes.push(await sha(ler()));
        }
        return {
          fisico: [w, h],
          samples: gl === null ? null : gl.getParameter(gl.SAMPLES),
          maxSamples: gl === null ? null : gl.getParameter(gl.MAX_SAMPLES),
          distintos: new Set(hashes).size,
          voltas: hashes.length,
        };
      } finally {
        container.style.width = antes.cw;
        container.style.height = antes.ch;
        overlayRaiz.style.width = antes.ow;
        overlayRaiz.style.height = antes.oh;
        mapa().resize();
        await wait(400);
      }
    })()`);
    console.log(
      `  ${r.fisico.join("x").padEnd(11)} ${((r.fisico[0] * r.fisico[1]) / 1e6).toFixed(2).padStart(5)} MP  ` +
        `SAMPLES=${String(r.samples).padStart(2)} (max ${r.maxSamples})  ` +
        `${r.distintos} hash(es) em ${r.voltas} leituras  ${r.distintos === 1 ? "IDÊNTICO" : "DIVERGE"}`,
    );
  }
} finally {
  client.close();
}
