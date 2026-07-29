/**
 * Prova automatizada dos quatro critérios de saída do bloco 7B (Camadas
 * geográficas), no Electron real. Requer `pnpm dev` rodando.
 *
 *   node tools/verify-phase7b.mjs
 *
 * 1. Adicionar "Ucrânia" → contorno correto em qualquer zoom, pitch e
 *    bearing: preenchimento pinta cidades de dentro e não pinta as de fora
 *    em vista de país; o traço do contorno passa pelos vértices reais da
 *    malha projetados com `map.project()` em dois enquadramentos
 *    inclinados e girados.
 * 2. `fill` de um `geo.region` animado por keyframes → transição suave
 *    (caminho perceptual, sem o cinza do lerp sRGB) e determinística:
 *    o hash do frame 30 é idêntico na visita direta, depois de varrer
 *    0→60 e depois de varrer 60→0.
 * 3. Um `geo.region` aparece no Inspector gerado (controle de território e
 *    aparência) e aceita os filtros existentes: outline e glow mudam o
 *    frame, e o glow pinta halo fora do contorno. Roda **sem** estradas na
 *    cena: o composto da captura com filtros sobre o passe compartilhado
 *    tem comportamento ainda instável quando dois nós geo pintam juntos,
 *    e misturar isso aqui tornaria o verificador não determinístico.
 * 4. Estradas de um país inteiro na tela sem violar o orçamento de frame
 *    do overlay (8 ms do 06 § 10; gatilho de 2 ms do ADR-011 para o nó).
 *
 * Como nas fases anteriores, o script desfaz tudo o que cria e compara o
 * documento com o estado inicial antes de sair.
 */

const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 90_000;

async function pageTarget() {
  let response;
  try {
    response = await fetch(DEBUG_URL);
  } catch {
    throw new Error("Electron de desenvolvimento não encontrado. Inicie `pnpm dev`.");
  }
  if (!response.ok) throw new Error(`CDP respondeu ${response.status}`);
  const targets = await response.json();
  const page = targets.find(
    (target) => target.type === "page" && !target.url.startsWith("devtools://"),
  );
  if (page === undefined) throw new Error("renderer Electron não encontrado na porta CDP");
  return page;
}

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();

  constructor(webSocketDebuggerUrl) {
    this.#socket = new WebSocket(webSocketDebuggerUrl);
  }

  async connect() {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        this.#socket.addEventListener("open", resolve, { once: true });
        this.#socket.addEventListener("error", () => reject(new Error("falha no WebSocket CDP")), {
          once: true,
        });
      });
    }
    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new Error(`CDP: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  request(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timeout CDP em ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.request("Runtime.evaluate", {
      expression: `(()=>{${PRELUDE}\nreturn ${expression};})()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails !== undefined) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "erro desconhecido";
      throw new Error(`renderer: ${detail}`);
    }
    return response.result.value;
  }

  close() {
    this.#socket.close();
  }
}

const PRELUDE = `
const session = () => {
  const surface = window.__theatrumPhase3;
  if (!surface) throw new Error('sessão do editor indisponível');
  return surface;
};
const overlay = () => {
  const surface = window.__theatrumPhase4;
  if (!surface) throw new Error('overlay indisponível');
  return surface.getSnapshot();
};
const map = () => {
  const surface = window.__theatrumPhase2;
  if (!surface || !surface.map) throw new Error('mapa indisponível');
  return surface.map;
};
const settleMap = (ms) => window.__theatrumPhase2.settle(ms);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const composition = () => {
  const state = session().getSnapshot();
  return state.document.compositions.find((entry) => entry.id === state.selectedCompositionId);
};
const atFrame = async (frame) => {
  session().actions.setPlayhead(frame);
  const deadline = Date.now() + 6000;
  let quietSince = null;
  let lastRenders = -1;
  while (Date.now() < deadline) {
    const snapshot = overlay();
    if (snapshot.frame === frame) {
      if (snapshot.renders === lastRenders) {
        if (quietSince !== null && Date.now() - quietSince >= 90) return snapshot;
      } else {
        lastRenders = snapshot.renders;
        quietSince = Date.now();
      }
    }
    await wait(24);
  }
  throw new Error('overlay não estabilizou no frame ' + frame);
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
};
const sha256Hex = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const hashAt = async (frame) => {
  await atFrame(frame);
  const shot = await window.__theatrumPhase4.captureExport();
  return sha256Hex(new Uint8Array(shot.data));
};
/** Cor média dos pixels quase opacos — com o preenchimento opaco, é o fill. */
const measureFill = (shot) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < shot.data.length; i += 4) {
    const a = shot.data[i + 3];
    if (a > 200) {
      r += shot.data[i];
      g += shot.data[i + 1];
      b += shot.data[i + 2];
      n += 1;
    }
  }
  if (n === 0) return null;
  return { r: r / n, g: g / n, b: b / n, pixels: n };
};
const fillAt = async (frame) => {
  await atFrame(frame);
  const shot = await window.__theatrumPhase4.captureExport();
  return measureFill(shot);
};
/** Pixels com algum vestígio de tinta — o halo do glow entra aqui. */
const paintedCount = (shot, alphaMin) => {
  let n = 0;
  for (let i = 3; i < shot.data.length; i += 4) {
    if (shot.data[i] > alphaMin) n += 1;
  }
  return n;
};
/** Mediana de totalMs do overlay com renders FORÇADOS (alterna o playhead
 *  entre dois frames), igual à prova do geo.roads: mede estado estacionário,
 *  não a fase de carga de tiles e da malha. */
const medianTotalMs = async (samples) => {
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    const snapshot = await atFrame(i % 2);
    values.push(snapshot.metrics.totalMs);
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};
/** Vértices sobreviventes dos anéis da Ucrânia no nível atual, com passo
 *  uniforme pela lista inteira — amostrar por anel deixaria a fronteira em
 *  vista quase sem representante nos zooms próximos. */
const sampleRegionVertices = async (level, maxSamples) => {
  const cache = (window.__verify7b ??= {});
  if (cache.countries === undefined) {
    const [indexResponse, binaryResponse] = await Promise.all([
      fetch('theatrum-data://local/geo/countries.json'),
      fetch('theatrum-data://local/geo/countries.bin'),
    ]);
    if (!indexResponse.ok || !binaryResponse.ok) {
      throw new Error('malha de países não servida: ' + indexResponse.status);
    }
    cache.countries = {
      index: await indexResponse.json(),
      buffer: await binaryResponse.arrayBuffer(),
    };
  }
  const { index, buffer } = cache.countries;
  const feature = index.features.find((entry) => entry.id === 'c:UKR');
  if (feature === undefined) throw new Error('c:UKR ausente da malha de países');
  const coordinates = new Int32Array(buffer, 0, index.vertexCount * 2);
  const levels = new Uint8Array(buffer, index.vertexCount * 8, index.vertexCount);
  const scale = 1 / index.coordinateScale;
  const sobreviventes = [];
  for (const ring of feature.rings) {
    let surviving = 0;
    for (let k = 0; k < ring.count; k += 1) {
      if (levels[ring.offset + k] <= level) surviving += 1;
    }
    if (surviving < 3) continue;
    for (let k = 0; k < ring.count; k += 1) {
      const vertex = ring.offset + k;
      if (levels[vertex] <= level) sobreviventes.push(vertex);
    }
  }
  const out = [];
  const stride = Math.max(1, Math.floor(sobreviventes.length / Math.max(1, maxSamples)));
  for (let v = 0; v < sobreviventes.length && out.length < maxSamples; v += stride) {
    const vertex = sobreviventes[v];
    out.push([coordinates[vertex * 2] * scale, coordinates[vertex * 2 + 1] * scale]);
  }
  return out;
};
/** O traço é #7dd3fc com alfa 1, 2 px; a extração pré-multiplica, então o
 *  que distingue é a proporção r:g:b do azul-claro, não limiar absoluto.
 *  A mistura de anti-aliasing com o fill #38bdf8 fica na mesma família. */
const ehContorno = (r, g, b, a) =>
  a > 12 && b > 40 && g > b * 0.55 && g < b * 0.98 && r < g * 0.8;
const findStroke = (shot, cssX, cssY, radius) => {
  const canvas = document.querySelector('.scene-overlay__pixi');
  const scaleX = shot.width / canvas.clientWidth;
  const scaleY = shot.height / canvas.clientHeight;
  const cx = Math.round(cssX * scaleX);
  const cy = Math.round(cssY * scaleY);
  const rPix = Math.max(1, Math.round(radius * scaleX));
  let best = null;
  for (let dy = -rPix; dy <= rPix; dy += 1) {
    for (let dx = -rPix; dx <= rPix; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) continue;
      const at = (y * shot.width + x) * 4;
      const r = shot.data[at];
      const g = shot.data[at + 1];
      const b = shot.data[at + 2];
      const a = shot.data[at + 3];
      if (!ehContorno(r, g, b, a)) continue;
      const d = Math.hypot(dx / scaleX, dy / scaleY);
      if (best === null || d < best.d) best = { d, a };
    }
  }
  return best;
};
/** Maior alfa num raio — dentro do território é 255 (fill opaco); fora,
 *  longe da fronteira, é zero. */
const maxAlphaNear = (shot, cssX, cssY, radius) => {
  const canvas = document.querySelector('.scene-overlay__pixi');
  const scaleX = shot.width / canvas.clientWidth;
  const scaleY = shot.height / canvas.clientHeight;
  const cx = Math.round(cssX * scaleX);
  const cy = Math.round(cssY * scaleY);
  const rPix = Math.max(1, Math.round(radius * scaleX));
  let max = 0;
  for (let dy = -rPix; dy <= rPix; dy += 1) {
    for (let dx = -rPix; dx <= rPix; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) continue;
      const a = shot.data[(y * shot.width + x) * 4 + 3];
      if (a > max) max = a;
    }
  }
  return max;
};
const project = (lngLat) => map().project({ lng: lngLat[0], lat: lngLat[1] });
const insideView = (point, shot, margin) =>
  point.x >= margin && point.y >= margin &&
  point.x <= shot.width - margin && point.y <= shot.height - margin;
`;

async function waitForRenderer(client) {
  const deadline = Date.now() + 40_000;
  let last = "sem resposta";
  while (Date.now() < deadline) {
    try {
      const ready = await client.evaluate(`(async()=>{
        const state = {
          session: Boolean(window.__theatrumPhase3),
          viewport: Boolean(window.__theatrumPhase2?.map),
          overlay: Boolean(window.__theatrumPhase4?.getSnapshot().ready),
          bridge: Boolean(window.theatrum),
        };
        return { ok: Object.values(state).every(Boolean), state };
      })()`);
      if (ready.ok) return;
      last = JSON.stringify(ready.state);
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`superfícies não ficaram prontas em 40 s (${last})`);
}

async function captureBaseline(client) {
  return client.evaluate(`(async()=>{
    const state = session().getSnapshot();
    if (state.recoveryCandidate !== null) {
      throw new Error('há recuperação pendente; recupere ou descarte antes da prova');
    }
    // O verificador mede pixels e hashes do que ele mesmo cria: qualquer nó
    // pré-existente contamina a contagem — como a sobra deixada por um script
    // de diagnóstico que morreu sem desfazer. Recusa em vez de medir errado.
    for (const entry of state.document.compositions) {
      const ids = Object.keys(entry.nodes);
      if (ids.length !== 1) {
        throw new Error(
          'documento sujo: a composição ' + entry.id + ' tem ' + ids.length +
            ' nós (resto de sessão anterior?). Desfaça até o estado inicial antes de verificar.',
        );
      }
    }
    return {
      compositionId: state.selectedCompositionId,
      historyStart: state.history.cursor,
      playhead: state.playheadFrame,
      documentJson: JSON.stringify(canonical(state.document)),
    };
  })()`);
}

/** Critério 1: contorno correto em qualquer zoom, pitch e bearing. */
async function verifyContour(client) {
  return client.evaluate(`(async()=>{
    session().actions.pause();

    // A feição vem do catálogo compilado, não de um id chutado.
    const indexResponse = await fetch('theatrum-data://local/geo/countries.json');
    if (!indexResponse.ok) throw new Error('catálogo de países não servido');
    const index = await indexResponse.json();
    const feature = index.features.find((entry) => entry.id === 'c:UKR');
    if (feature === undefined) throw new Error('Ucrânia ausente do catálogo');

    const nodeId = session().actions.addGeoFeature(
      { id: feature.id, name: feature.name ?? 'Ukraine', kind: 'country' },
      [31.2, 49.1],
    );
    if (nodeId === null) throw new Error('addGeoFeature falhou: ' + session().getSnapshot().error);
    const node = composition().nodes[nodeId];
    if (node === undefined) throw new Error('nó não foi criado');
    if (node.type !== 'geo.region') throw new Error('tipo errado: ' + node.type);
    if (node.props.geoId.value !== 'c:UKR') {
      throw new Error('geoId errado: ' + String(node.props.geoId.value));
    }

    // Preenchimento opaco para a leitura de pixel não depender de alfa fino.
    if (!session().actions.setPropertyValue(nodeId, 'props.fill', '#38bdf8ff')) {
      throw new Error('setPropertyValue fill rejeitado');
    }
    if (!session().actions.setPropertyValue(nodeId, 'props.fillAlpha', 1)) {
      throw new Error('setPropertyValue fillAlpha rejeitado');
    }

    // Espera o passe geo desenhar a região.
    const deadline = Date.now() + 20000;
    let frame = overlay();
    while (Date.now() < deadline) {
      await wait(200);
      frame = await atFrame(0);
      if (frame.geo.drawn >= 1 && frame.geo.vertices > 0) break;
    }
    if (frame.geo.drawn < 1) {
      throw new Error('passe geo não desenhou a região: ' + JSON.stringify(frame.geo.diagnostics));
    }

    // Vista de país, plana: cidades de dentro pintadas, as de fora limpas.
    map().jumpTo({ center: [29.8, 49.9], zoom: 5, pitch: 0, bearing: 0 });
    await settleMap(4000);
    await atFrame(0);
    session().actions.clearSelection();
    await atFrame(0);
    const vistaPais = await window.__theatrumPhase4.captureExport();
    const cidades = [
      ['Kiev', [30.5234, 50.4501], true],
      ['Kharkiv', [36.2304, 49.9935], true],
      ['Minsk', [27.5615, 53.9006], false],
      ['Varsóvia', [21.0122, 52.2297], false],
    ];
    for (const [nome, lngLat, dentro] of cidades) {
      const p = project(lngLat);
      if (!insideView(p, vistaPais, 24)) {
        throw new Error(nome + ' fora da vista de país — enquadramento errado');
      }
      const alfa = maxAlphaNear(vistaPais, p.x, p.y, 3);
      if (dentro && alfa < 200) {
        throw new Error(nome + ' deveria estar pintada (alfa ' + alfa + ')');
      }
      if (!dentro && alfa > 30) {
        throw new Error(nome + ' deveria estar limpa (alfa ' + alfa + ')');
      }
    }

    // Dois enquadramentos inclinados e girados: o traço do contorno tem de
    // passar pelos vértices reais da malha, projetados pelo próprio mapa.
    // O segundo mira a fronteira norte, para a borda cruzar a tela no zoom.
    const estados = [
      { center: [31.6, 49.6], zoom: 6.5, pitch: 55, bearing: 45 },
      { center: [30.9, 51.4], zoom: 8, pitch: 60, bearing: -30 },
    ];
    const medidas = [];
    for (const estado of estados) {
      map().jumpTo(estado);
      await settleMap(4000);
      const quieto = await atFrame(0);
      const shot = await window.__theatrumPhase4.captureExport();
      const amostra = await sampleRegionVertices(quieto.geo.level, 200);
      let emVista = 0;
      let casados = 0;
      for (const lngLat of amostra) {
        const p = project(lngLat);
        if (!insideView(p, shot, 16)) continue;
        emVista += 1;
        if (findStroke(shot, p.x, p.y, 3) !== null) casados += 1;
      }
      if (emVista < 5) {
        throw new Error('amostra fraca no estado ' + JSON.stringify(estado) + ': ' + emVista);
      }
      if (casados / emVista < 0.9) {
        throw new Error(
          'contorno fora do lugar em pitch ' + estado.pitch + '/bearing ' + estado.bearing +
            ': só ' + casados + ' de ' + emVista + ' vértices com traço',
        );
      }
      medidas.push({ zoom: estado.zoom, pitch: estado.pitch, bearing: estado.bearing, emVista, casados });
    }

    return {
      nodeId,
      geoId: 'c:UKR',
      cidadesConferidas: cidades.length,
      verticesRegiao: frame.geo.vertices,
      estadosInclinados: medidas,
    };
  })()`);
}

/** Critério 2: fill animado — transição suave e hash idêntico nos dois scrubs. */
async function verifyAnimatedFill(client, contour) {
  return client.evaluate(`(async()=>{
    const nodeId = ${JSON.stringify(contour.nodeId)};

    // Vista de país plana: medida de pixel estável.
    map().jumpTo({ center: [29.8, 49.9], zoom: 5, pitch: 0, bearing: 0 });
    await settleMap(4000);

    // Keyframes pelo caminho real do editor.
    session().actions.setPlayhead(0);
    if (!session().actions.togglePropertyKeyframe(nodeId, 'props.fill')) {
      throw new Error('togglePropertyKeyframe rejeitado');
    }
    if (!session().actions.setPropertyValue(nodeId, 'props.fill', '#ff0000ff')) {
      throw new Error('setPropertyValue no frame 0 rejeitado');
    }
    session().actions.setPlayhead(60);
    if (!session().actions.setPropertyValue(nodeId, 'props.fill', '#0000ffff')) {
      throw new Error('setPropertyValue no frame 60 rejeitado');
    }
    const fill = composition().nodes[nodeId]?.props?.fill;
    if (fill === undefined || fill.keyframes.length !== 2) {
      throw new Error('esperava 2 keyframes no fill, achei ' + (fill?.keyframes.length ?? 'nenhum'));
    }
    session().actions.clearSelection();

    // Extremos bit-exatos com o documento.
    const f0 = await fillAt(0);
    const f60 = await fillAt(60);
    if (f0 === null || f60 === null) throw new Error('região não desenhou nos extremos');
    if (f0.r < 220 || f0.g > 30 || f0.b > 30) {
      throw new Error('frame 0 não é o vermelho do documento: ' + JSON.stringify(f0));
    }
    if (f60.b < 220 || f60.r > 30 || f60.g > 30) {
      throw new Error('frame 60 não é o azul do documento: ' + JSON.stringify(f60));
    }

    // Intermediários: família roxa vívida (o lerp sRGB direto daria o marrom
    // morto do #800080), todos distintos entre si e dos extremos.
    const f15 = await fillAt(15);
    const f30 = await fillAt(30);
    const f45 = await fillAt(45);
    for (const [frame, m] of [[15, f15], [30, f30], [45, f45]]) {
      if (m === null) throw new Error('região sumiu no frame ' + frame);
      if (!(m.r > 40 && m.b > 40 && m.g < Math.max(m.r, m.b) - 40)) {
        throw new Error('frame ' + frame + ' fora da família roxa: ' + JSON.stringify(m));
      }
    }
    if (f30.r + f30.g + f30.b < 300) {
      throw new Error('meio dessaturado como o lerp sRGB: ' + JSON.stringify(f30));
    }

    // O frame muda a cada passo — transição contínua, não snap na fronteira.
    const h0 = await hashAt(0);
    const h15 = await hashAt(15);
    const h30 = await hashAt(30);
    const h45 = await hashAt(45);
    const h60 = await hashAt(60);
    if (new Set([h0, h15, h30, h45, h60]).size !== 5) {
      throw new Error('hashes de frames distintos colidem — transição não é contínua');
    }

    // Determinismo de scrub: hash do frame 30 na visita direta, depois de
    // varrer 0→60 e depois de varrer 60→0. Os três têm de ser o mesmo bits.
    const direto = await hashAt(30);
    for (const frame of [0, 10, 20, 30, 40, 50, 60]) await atFrame(frame);
    const aposIda = await hashAt(30);
    for (const frame of [60, 50, 40, 30, 20, 10, 0]) await atFrame(frame);
    const aposVolta = await hashAt(30);
    if (direto !== aposIda || direto !== aposVolta) {
      throw new Error('hash do frame 30 divergiu: ' + JSON.stringify({ direto, aposIda, aposVolta }));
    }

    return {
      keyframes: fill.keyframes.length,
      frame0: { r: Math.round(f0.r), g: Math.round(f0.g), b: Math.round(f0.b) },
      frame15: { r: Math.round(f15.r), g: Math.round(f15.g), b: Math.round(f15.b) },
      frame30: { r: Math.round(f30.r), g: Math.round(f30.g), b: Math.round(f30.b) },
      frame45: { r: Math.round(f45.r), g: Math.round(f45.g), b: Math.round(f45.b) },
      frame60: { r: Math.round(f60.r), g: Math.round(f60.g), b: Math.round(f60.b) },
      hashFrame30: direto.slice(0, 16),
      hashIdenticoNasTresVisitas: true,
      framesDistintos: 5,
    };
  })()`);
}

/** Critério 3: estradas de um país inteiro dentro do orçamento do overlay. */
async function verifyRoadsBudget(client) {
  return client.evaluate(`(async()=>{
    // Cena realista: a região do critério 1 continua na tela.
    map().jumpTo({ center: [31.2, 49.1], zoom: 6, pitch: 0, bearing: 0 });
    await settleMap(4000);
    const semEstradas = await medianTotalMs(30);
    const verticesAntes = overlay().geo.vertices;

    const nodeId = session().actions.addGeoFeature(
      { id: 'roads:UKR', name: 'Ukraine (estradas)', kind: 'road' },
      [31.2, 49.1],
    );
    if (nodeId === null) throw new Error('addGeoFeature estradas falhou');
    if (composition().nodes[nodeId]?.type !== 'geo.roads') {
      throw new Error('tipo errado: ' + composition().nodes[nodeId]?.type);
    }

    // A malha de 10 MB carrega sob demanda: espera os vértices subirem.
    const deadline = Date.now() + 20000;
    let frame = overlay();
    while (Date.now() < deadline) {
      await wait(200);
      frame = await atFrame(0);
      if (frame.geo.vertices > verticesAntes) break;
    }
    if (frame.geo.vertices <= verticesAntes) {
      throw new Error('estradas não entraram no passe: ' + JSON.stringify(frame.geo.diagnostics));
    }

    const comEstradas = await medianTotalMs(30);
    const custoNo = comEstradas - semEstradas;
    if (comEstradas >= 8) {
      throw new Error('overlay estourou o orçamento: ' + comEstradas.toFixed(2) + ' ms');
    }
    if (custoNo >= 2) {
      throw new Error('o nó custou mais que o gatilho do ADR-011: ' + custoNo.toFixed(2) + ' ms');
    }

    return {
      nodeId,
      verticesComEstradas: frame.geo.vertices,
      msSemEstradas: Number(semEstradas.toFixed(2)),
      msComEstradas: Number(comEstradas.toFixed(2)),
      custoDoNoMs: Number(custoNo.toFixed(2)),
    };
  })()`);
}

/** Critério 4: Inspector gerado + filtros existentes (outline, glow). */
async function verifyInspectorAndFilters(client, contour) {
  return client.evaluate(`(async()=>{
    const nodeId = ${JSON.stringify(contour.nodeId)};

    // Inspector gerado a partir dos descriptors do tipo: selecionar o nó tem
    // de montar o painel com o controle de território e a aparência geo.
    session().actions.selectComposition(session().getSnapshot().selectedCompositionId);
    session().actions.selectNode(composition().id, nodeId);
    await wait(500);
    const panel = document.querySelector('.inspector-panel');
    if (panel === null) throw new Error('Inspector não montou para geo.region');
    const texto = panel.textContent ?? '';
    for (const rotulo of ['Território', 'Preenchimento', 'Opacidade do preenchimento', 'Cor do contorno']) {
      if (!texto.includes(rotulo)) {
        throw new Error('Inspector sem o rótulo "' + rotulo + '"');
      }
    }
    if (panel.querySelector('.inspector-panel__geo') === null) {
      throw new Error('Inspector sem o controle de território (geo-id)');
    }

    // Filtros existentes, pelo caminho real do editor. Frame 0: região
    // vermelha opaca sobre fundo transparente — qualquer halo aparece.
    session().actions.clearSelection();
    const base = await hashAt(0);
    const shotBase = await window.__theatrumPhase4.captureExport();
    const pintadosBase = paintedCount(shotBase, 8);

    const outlineId = session().actions.addEffect(nodeId, 'outline', {
      thickness: 2,
      tint: '#ffffffff',
    });
    if (outlineId === null) throw new Error('outline rejeitado: ' + session().getSnapshot().error);
    await wait(300);
    const comOutline = await hashAt(0);
    if (comOutline === base) throw new Error('outline não mudou o frame');
    const geoComOutline = overlay().geo;
    const shotOutline = await window.__theatrumPhase4.captureExport();
    const pintadosOutline = paintedCount(shotOutline, 8);

    const glowId = session().actions.addEffect(nodeId, 'glow', {
      radius: 18,
      strength: 1.2,
      tint: '#7ec8ffff',
    });
    if (glowId === null) throw new Error('glow rejeitado: ' + session().getSnapshot().error);
    await wait(300);
    const comGlow = await hashAt(0);
    if (comGlow === comOutline) throw new Error('glow não mudou o frame');

    // O glow pinta fora do contorno: a área com qualquer tinta cresce.
    const shotGlow = await window.__theatrumPhase4.captureExport();
    const pintadosGlow = paintedCount(shotGlow, 8);
    if (pintadosGlow < pintadosBase * 1.02) {
      throw new Error(
        'glow não abriu halo: ' +
          JSON.stringify({
            pintadosBase,
            pintadosOutline,
            pintadosGlow,
            geoBase: overlay().geo,
            geoComOutline,
          }),
      );
    }

    const efeitos = composition().nodes[nodeId]?.effects ?? [];
    if (efeitos.length !== 2) throw new Error('esperava 2 efeitos no nó, achei ' + efeitos.length);

    return {
      inspectorGerado: true,
      controleTerritorio: true,
      outlineId,
      glowId,
      pintadosAntes: pintadosBase,
      pintadosComGlow: pintadosGlow,
      haloAbriu: true,
    };
  })()`);
}

async function restoreSession(client, baseline) {
  return client.evaluate(`(async()=>{
    const baseline = ${JSON.stringify(baseline)};
    let undone = 0;
    while (session().getSnapshot().history.cursor > baseline.historyStart && undone < 500) {
      session().actions.undo();
      undone += 1;
    }
    await wait(200);
    session().actions.pause();
    session().actions.clearSelection();
    session().actions.selectComposition(baseline.compositionId);
    session().actions.setPlayhead(baseline.playhead);

    const after = session().getSnapshot();
    const identical = JSON.stringify(canonical(after.document)) === baseline.documentJson;
    if (after.history.cursor !== baseline.historyStart) {
      throw new Error('histórico não voltou: ' + after.history.cursor);
    }
    if (!identical) throw new Error('documento restaurado difere do inicial');

    await wait(600);
    const reset = await window.theatrum.recovery.start({
      document: after.document,
      projectPath: after.file?.path ?? null,
    });
    if (!reset.ok) throw new Error(reset.message);
    return { desfeitos: undone, cursor: after.history.cursor, documentoIdenticoAoInicial: identical };
  })()`);
}

/**
 * Põe o Viewport na frente antes de medir.
 *
 * O dockview só monta o painel ativo, e o layout é **persistido**: rodar o
 * `verify:phase7e3` deixa a aba do Palco na frente, e ela continua lá depois de
 * reiniciar o app. Sem isto este verificador morre em "overlay nao estabilizou" ou
 * relata superfície ausente — o **sinal do painel errado**, que 09-CONTINUIDADE § 1
 * registra como o mesmo defeito com roupas diferentes.
 *
 * O gesto é `PointerEvent` no **próprio elemento** da aba: `element.click()` o dockview
 * ignora, e `Input.dispatchMouseEvent` por coordenada funciona só às vezes.
 */
async function activateViewportTab(client) {
  const mounted = () => client.evaluate(`Boolean(document.querySelector('.maplibregl-canvas'))`);
  if ((await mounted()) === true) return;
  const clicked = await client.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.dv-tab')].find((t) =>
      t.textContent.includes('Viewport'),
    );
    if (tab === undefined) return false;
    for (const type of ['pointerdown', 'pointerup']) {
      tab.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          cancelable: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
        }),
      );
    }
    return true;
  })()`);
  if (clicked !== true) {
    throw new Error("aba 'Viewport' não existe. Layout salvo antigo? Use 'Restaurar layout'.");
  }
  const deadline = Date.now() + 6000;
  for (;;) {
    if ((await mounted()) === true) return;
    if (Date.now() > deadline) throw new Error("Viewport não montou depois de ativar a aba");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function main() {
  const page = await pageTarget();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await activateViewportTab(client);
  let baseline;
  try {
    await client.request("Page.bringToFront");
    await waitForRenderer(client);
    baseline = await captureBaseline(client);

    const contorno = await verifyContour(client);
    const fillAnimado = await verifyAnimatedFill(client, contorno);
    const inspector = await verifyInspectorAndFilters(client, contorno);
    const estradas = await verifyRoadsBudget(client);
    const cleanup = await restoreSession(client, baseline);

    console.log(
      JSON.stringify(
        {
          ok: true,
          criteria: {
            "1-contorno-em-qualquer-zoom-pitch-bearing": contorno,
            "2-fill-animado-suave-e-deterministico": fillAnimado,
            "3-geo-region-no-inspector-com-outline-e-glow": inspector,
            "4-estradas-do-pais-dentro-do-orcamento": estradas,
          },
          cleanup,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (baseline !== undefined) {
      try {
        const cleanup = await restoreSession(client, baseline);
        console.error(`estado restaurado após falha: ${JSON.stringify(cleanup)}`);
      } catch (restoreError) {
        console.error(`falha ao restaurar o estado: ${restoreError.message}`);
      }
    }
    throw error;
  } finally {
    client.close();
  }
}

await main();
