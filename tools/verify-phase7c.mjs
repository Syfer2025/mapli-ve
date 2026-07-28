/**
 * A rota 7C existe em pixels? Cria caminho Kursk→Belgorod, aplica seta de
 * avanço, e mede: quantos pixels a seta pinta, se a cabeça acompanha a
 * revelação, e se o desenho é determinístico ao voltar no tempo.
 */

const r = await fetch("http://localhost:9222/json/list");
const t = (await r.json()).find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let id = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const ev = (x) =>
  new Promise((res) => {
    const i = id++;
    pending.set(i, (m) =>
      res(
        m.result?.result?.value ??
          "EXC " + String(m.result?.exceptionDetails?.exception?.description ?? "?").slice(0, 500),
      ),
    );
    ws.send(
      JSON.stringify({
        id: i,
        method: "Runtime.evaluate",
        params: { expression: x, awaitPromise: true, returnByValue: true },
      }),
    );
  });

console.log(
  await ev(`(async () => {
  const S = window.__theatrumPhase3;
  const O = () => window.__theatrumPhase4.getSnapshot();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const linhas = [];
  S.actions.pause();

  // Enquadrar Kursk-Belgorod. Sem isso a rota existe e nao aparece: 'drawn: 1'
  // com zero pixel foi exatamente esse engano na primeira medicao.
  const mapa = window.__theatrumPhase2.map;
  mapa.jumpTo({ center: [36.0, 51.2], zoom: 7, pitch: 0, bearing: 0 });
  await window.__theatrumPhase2.settle(1500);

  const atFrame = async (f) => {
    S.actions.setPlayhead(f);
    const fim = Date.now() + 8000;
    let quieto = null, ultimo = -1;
    while (Date.now() < fim) {
      const s = O();
      if (s.frame === f) {
        if (s.renders === ultimo) { if (quieto !== null && Date.now() - quieto >= 90) return s; }
        else { ultimo = s.renders; quieto = Date.now(); }
      }
      await wait(24);
    }
    throw new Error('overlay nao estabilizou em ' + f);
  };
  const sha = async (bytes) => {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  const capturar = async () => {
    const shot = await window.__theatrumPhase4.captureExport();
    const data = new Uint8Array(shot.data);
    let pintados = 0;
    let minX = 1e9, maxX = -1e9;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 24) {
        pintados += 1;
        const px = (i / 4) % shot.width;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
      }
    }
    return { pintados, minX, maxX, hash: await sha(data), largura: shot.width };
  };

  // Caminho Kursk (36.19, 51.73) → Belgorod (36.58, 50.60), com um desvio para
  // não ser reta: uma seta reta não prova que a geometria acompanha a curva.
  const pathId = S.actions.createPath({
    name: 'Kursk-Belgorod',
    space: 'geo',
    interpolation: 'linear',
    vertices: [
      { point: [36.19, 51.73], inHandle: null, outHandle: null },
      { point: [35.40, 51.10], inHandle: null, outHandle: null },
      { point: [36.58, 50.60], inHandle: null, outHandle: null },
    ],
  });
  const nd = S.actions.addNodeOfType('route');
  S.actions.setPropertyValue(nd, 'props.pathId', pathId);
  S.actions.setPropertyValue(nd, 'props.filled', true);
  S.actions.setPropertyValue(nd, 'props.fill', '#e2483dff');
  S.actions.setPropertyValue(nd, 'props.fillAlpha', 1);
  S.actions.setPropertyValue(nd, 'props.bodyWidth', 22);
  S.actions.setPropertyValue(nd, 'props.headWidth', 62);
  S.actions.setPropertyValue(nd, 'props.headLength', 54);
  S.actions.clearSelection();

  const s0 = await atFrame(0);
  const cheia = await capturar();
  linhas.push('rotas desenhadas: ' + JSON.stringify(s0.routes ?? null));
  linhas.push('seta cheia: ' + cheia.pintados + ' px, x de ' + cheia.minX + ' a ' + cheia.maxX);

  // Revelação: keyframes em trimEnd de 0 a 1 em 2 s (60 frames a 30 fps).
  S.actions.setPlayhead(0);
  S.actions.togglePropertyKeyframe(nd, 'props.trimEnd');
  S.actions.setPropertyValue(nd, 'props.trimEnd', 0.02);
  S.actions.setPlayhead(60);
  S.actions.setPropertyValue(nd, 'props.trimEnd', 1);

  const medidas = [];
  for (const f of [0, 15, 30, 45, 60]) {
    await atFrame(f);
    medidas.push({ f, ...(await capturar()) });
  }
  linhas.push('revelacao (frame: px pintados): ' + medidas.map((m) => m.f + ':' + m.pintados).join('  '));
  const cresce = medidas.every((m, i) => i === 0 || m.pintados >= medidas[i - 1].pintados);
  linhas.push('area cresce monotonicamente: ' + cresce);

  // Determinismo: o hash do frame 30 tem de bater na visita direta, depois de
  // varrer para frente e depois de varrer para tras.
  await atFrame(30);
  const direto = (await capturar()).hash;
  for (const f of [0, 20, 40, 60]) await atFrame(f);
  await atFrame(30);
  const depoisFrente = (await capturar()).hash;
  for (const f of [60, 40, 20, 0]) await atFrame(f);
  await atFrame(30);
  const depoisTras = (await capturar()).hash;
  linhas.push('hash frame 30 direto:      ' + direto.slice(0, 16));
  linhas.push('hash apos varrer 0 a 60:   ' + depoisFrente.slice(0, 16) + (depoisFrente === direto ? '  IDENTICO' : '  DIVERGE'));
  linhas.push('hash apos varrer 60 a 0:   ' + depoisTras.slice(0, 16) + (depoisTras === direto ? '  IDENTICO' : '  DIVERGE'));

  // Custo: 50 rotas na tela dentro do orcamento de 8 ms do overlay.
  const extras = [];
  for (let i = 0; i < 49; i += 1) {
    const n = S.actions.addNodeOfType('route');
    S.actions.setPropertyValue(n, 'props.pathId', pathId);
    S.actions.setPropertyValue(n, 'props.filled', i % 2 === 0);
    S.actions.setPropertyValue(n, 'props.dashPx', 18);
    S.actions.setPropertyValue(n, 'props.gapPx', 12);
    extras.push(n);
  }
  const amostras = [];
  for (const f of [10, 20, 30, 40, 50]) {
    const s = await atFrame(f);
    amostras.push(s.metrics.totalMs);
  }
  amostras.sort((a, b) => a - b);
  linhas.push('50 rotas: mediana ' + amostras[2].toFixed(2) + ' ms, pior ' + amostras[4].toFixed(2) + ' ms (orcamento 8)');
  linhas.push('rotas no frame: ' + JSON.stringify(O().routes ?? null));

  while (S.commandBus.history.canUndo()) S.commandBus.history.undo();
  S.actions.setPlayhead(0);
  await wait(400);
  return linhas.join('\\n');
})()`),
);
ws.close();
