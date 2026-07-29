/**
 * O que custa desligar o MSAA do canvas do mapa.
 *
 * A sonda 6a provou que o MSAA é a causa da repintura não bit-exata acima de
 * 2 MP. Antes de decidir, o custo tem de ser medido, não suposto: quantos pixels
 * mudam, de quanto, e como a borda fica — com um recorte salvo em PNG para
 * olhar.
 *
 * Uso:  node scratchpad/probe-msaa-cost.mjs <rótulo>
 * Roda uma vez com o MSAA ligado e outra com ele desligado, e depois compara.
 */

import { writeFileSync } from "node:fs";
import { open, activateTab } from "./cdp.mjs";

const rotulo = process.argv[2] ?? "atual";
const client = await open();

try {
  await activateTab(client, "Viewport", ".maplibregl-canvas");

  const r = await client.evaluate(`(async () => {
    const container = document.querySelector('.map-viewport__map');
    const overlayRaiz = document.querySelector('.scene-overlay');
    const antes = {
      cw: container.style.width, ch: container.style.height,
      ow: overlayRaiz.style.width, oh: overlayRaiz.style.height,
    };
    try {
      session().actions.pause();
      session().actions.clearSelection();
      session().actions.setPlayhead(0);
      for (const el of [container, overlayRaiz]) {
        el.style.width = '1920px';
        el.style.height = '1080px';
      }
      mapa().resize();
      // Enquadramento fixo, com litoral e fronteira dentro: é onde antialias
      // aparece. O mesmo em todas as rodadas, senão não há comparação.
      mapa().jumpTo({ center: [56.0, 26.6], zoom: 7.2, pitch: 0, bearing: 0 });
      await window.__theatrumPhase2.settle(25000);
      await wait(1500);

      // Guarda: uma captura chapada é medição inválida, não resultado. Já
      // produziu "energia de borda 0, uma cor no recorte" logo depois de um
      // reload, e aquilo não dizia nada sobre MSAA — dizia que o mapa ainda não
      // tinha pintado. Espera até o canvas ter conteúdo de verdade.
      const conteudo = () => {
        const t = document.createElement('canvas');
        t.width = 64; t.height = 64;
        const tc = t.getContext('2d', { willReadFrequently: true });
        tc.drawImage(mapa().getCanvas(), 0, 0, 64, 64);
        const d = tc.getImageData(0, 0, 64, 64).data;
        const cores = new Set();
        for (let i = 0; i < d.length; i += 4) {
          cores.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        }
        return cores.size;
      };
      const limite = Date.now() + 60000;
      while (conteudo() < 8) {
        if (Date.now() > limite) throw new Error('mapa não pintou conteúdo em 60 s');
        mapa().triggerRepaint();
        await window.__theatrumPhase2.settle(15000);
        await wait(1200);
      }

      const mapCanvas = mapa().getCanvas();
      const gl = mapCanvas.getContext('webgl2');
      const w = mapCanvas.width, h = mapCanvas.height;

      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(mapCanvas, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;

      // Energia de borda: média do |delta| entre vizinhos horizontais no verde.
      // MSAA suaviza a transição, então baixa este número.
      let soma = 0;
      let contagem = 0;
      let degrausDuros = 0;
      for (let y = 0; y < h; y += 3) {
        for (let x = 1; x < w; x += 1) {
          const a = (y * w + x - 1) * 4 + 1;
          const b = (y * w + x) * 4 + 1;
          const d = Math.abs(px[a] - px[b]);
          soma += d;
          contagem += 1;
          if (d > 40) degrausDuros += 1;
        }
      }

      // Cores distintas num recorte — MSAA cria valores intermediários.
      const recorte = { x: 700, y: 380, w: 480, h: 320 };
      const sub = ctx.getImageData(recorte.x, recorte.y, recorte.w, recorte.h);
      const cores = new Set();
      for (let i = 0; i < sub.data.length; i += 4) {
        cores.add((sub.data[i] << 16) | (sub.data[i + 1] << 8) | sub.data[i + 2]);
      }
      const recorteCanvas = document.createElement('canvas');
      recorteCanvas.width = recorte.w;
      recorteCanvas.height = recorte.h;
      recorteCanvas.getContext('2d').putImageData(sub, 0, 0);

      return {
        samples: gl === null ? null : gl.getParameter(gl.SAMPLES),
        atributos: gl === null ? null : gl.getContextAttributes(),
        tamanho: [w, h],
        energiaDeBorda: Number((soma / contagem).toFixed(4)),
        degrausDuros,
        coresNoRecorte: cores.size,
        png: recorteCanvas.toDataURL('image/png'),
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

  const caminho = `scratchpad/msaa-${rotulo}.png`;
  writeFileSync(caminho, Buffer.from(r.png.split(",")[1], "base64"));
  console.log(
    `${rotulo}: SAMPLES=${r.samples} antialias=${r.atributos?.antialias} ` +
      `${r.tamanho.join("x")}  energia de borda ${r.energiaDeBorda}  ` +
      `degraus duros ${r.degrausDuros}  cores no recorte ${r.coresNoRecorte}  → ${caminho}`,
  );
} finally {
  client.close();
}
