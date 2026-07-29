/**
 * A pergunta que as sondas anteriores não responderam.
 *
 * Elas compunham o frame à mão, com espera que eu mesmo escrevi. O pump do export
 * é mais estrito: exige `observed.frame === alvo`, contador de repinturas estável
 * por 60 ms, mapa sem tile pendente e nenhum asset em parse. A pergunta que decide
 * se o ADR-022 se sustenta é:
 *
 *   **o export DE VERDADE, duas vezes, no tamanho da composição e em 4K, escreve
 *   arquivos byte-idênticos?**
 *
 * O redimensionamento aqui é feito pela sonda porque a ligação dos painéis ainda
 * não existe. Isso não invalida a prova: o caminho medido é o `runExport` +
 * `FrameComposer` + escritor PNG reais, que é o que vai rodar depois.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { open, activateTab } from "./cdp.mjs";

const SAIDA = join(tmpdir(), "theatrum-probe-resolucao").replaceAll("\\", "/");
const client = await open();

try {
  await activateTab(client, "Viewport", ".maplibregl-canvas");

  await client.evaluate(`(async () => {
    const S = session();
    S.actions.pause();
    while (S.commandBus.history.canUndo()) S.commandBus.history.undo();
    await wait(300);
    mapa().jumpTo({ center: [35.6, 50.2], zoom: 6, pitch: 0, bearing: 0 });
    await window.__theatrumPhase2.settle(10000);
    const ucr = S.actions.addGeoFeature({ id: 'c:UKR', name: 'Ucrânia', kind: 'country' }, [31.2, 48.4]);
    if (ucr) S.actions.setPropertyValue(ucr, 'props.fill', '#1b3a5c99');
    const rot = S.actions.addNodeOfType('text.label');
    S.actions.setNodeAnchor(rot, { space: 'geo', lngLat: [36.23, 49.99] });
    S.actions.setPropertyValue(rot, 'props.text', 'KHARKIV');
    S.actions.setPropertyValue(rot, 'props.fontSize', 32);
    S.actions.setPlayhead(0);
    S.actions.togglePropertyKeyframe(rot, 'transform.opacity');
    S.actions.setPropertyValue(rot, 'transform.opacity', 0.15);
    S.actions.setPlayhead(4);
    S.actions.setPropertyValue(rot, 'transform.opacity', 1);
    S.actions.setPlayhead(0);
    S.actions.clearSelection();
    await window.__theatrumPhase2.settle(8000);
    await wait(700);
    return true;
  })()`);

  for (const alvo of [
    { rotulo: "painel (como é hoje)", css: null, ratio: null },
    { rotulo: "1920x1080 · composição", css: [1920, 1080], ratio: 1 },
    { rotulo: "3840x2160 · 4K por ratio 2", css: [1920, 1080], ratio: 2 },
  ]) {
    const r = await client.evaluate(`(async () => {
      const alvo = ${JSON.stringify(alvo)};
      const container = document.querySelector('.map-viewport__map');
      const overlayRaiz = document.querySelector('.scene-overlay');
      const antes = {
        cw: container.style.width, ch: container.style.height,
        ow: overlayRaiz.style.width, oh: overlayRaiz.style.height,
      };
      try {
        if (alvo.css !== null) {
          for (const el of [container, overlayRaiz]) {
            el.style.width = alvo.css[0] + 'px';
            el.style.height = alvo.css[1] + 'px';
          }
          mapa().resize();
        }
        if (alvo.ratio !== null) mapa().setPixelRatio(alvo.ratio);
        await window.__theatrumPhase2.settle(25000);
        await wait(1200);

        const mapCanvas = mapa().getCanvas();
        const gl = mapCanvas.getContext('webgl2');
        const exportar = () => overlay().exportPngSequence({
          range: { first: 0, last: 4 },
          directory: ${JSON.stringify(SAIDA)},
        });
        const a = await exportar();
        const b = await exportar();
        const hashesA = a.report ? a.report.hashes : [];
        const hashesB = b.report ? b.report.hashes : [];
        return {
          rotulo: alvo.rotulo,
          canvas: [mapCanvas.width, mapCanvas.height],
          samples: gl === null ? null : gl.getParameter(gl.SAMPLES),
          escritos: a.report ? a.report.written : 0,
          settleFailed: a.report ? a.report.settleFailed : -1,
          settleP99: a.report ? Math.round(a.report.settleP99Ms) : -1,
          iguais:
            hashesA.length > 0 &&
            hashesA.length === hashesB.length &&
            hashesA.every((h, i) => h.sha256 === hashesB[i].sha256),
          distintos: new Set(hashesA.map((h) => h.sha256)).size,
          erros: (a.report ? a.report.errors : []).slice(0, 2),
        };
      } finally {
        container.style.width = antes.cw;
        container.style.height = antes.ch;
        overlayRaiz.style.width = antes.ow;
        overlayRaiz.style.height = antes.oh;
        mapa().setPixelRatio(window.devicePixelRatio);
        mapa().resize();
        await wait(500);
      }
    })()`);
    const mp = ((r.canvas[0] * r.canvas[1]) / 1e6).toFixed(2);
    console.log(
      `  ${r.rotulo.padEnd(26)} canvas ${r.canvas.join("x").padEnd(11)} ${mp.padStart(5)} MP ` +
        `SAMPLES=${r.samples}  ${r.escritos} frames  ` +
        `duas execuções ${r.iguais ? "IDÊNTICAS" : "DIVERGEM"}  ` +
        `${r.distintos} distintos entre frames  settleFailed=${r.settleFailed} p99=${r.settleP99}ms` +
        (r.erros.length > 0 ? `  erros: ${r.erros.join("; ")}` : ""),
    );
  }

  const limpo = await client.evaluate(`(async () => {
    const bus = session().commandBus;
    let n = 0;
    while (bus.history.canUndo() && n < 400) { bus.history.undo(); n += 1; }
    session().actions.setPlayhead(0);
    session().actions.clearSelection();
    await wait(300);
    return n;
  })()`);
  console.log(`  documento restaurado: ${limpo} comandos desfeitos`);
} finally {
  client.close();
}
