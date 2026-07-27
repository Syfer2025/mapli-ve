/**
 * Cenário de demonstração do preview 3D (bloco pós-7A): F/A-18F Super Hornet
 * voando de Kiev a Moscou por rota curva (catmull-rom geo), com marcadores de
 * passagem temporizados e destaque de contorno para Ucrânia (azul) e Rússia
 * (vermelho). Requer `pnpm dev` rodando e o GLB em
 * `apps/editor/public/models/fa-18f.glb`.
 *
 *   node tools/demo-f18.mjs
 *
 * Diferente das provas verify-*, este script NÃO desfaz o que cria: o cenário
 * fica na sessão para exploração (asset na Biblioteca, nó model3d, caminho,
 * marcadores). As camadas de destaque dos países são adicionadas ao estilo em
 * runtime (não vão para o documento) — contorno de país como nó do documento
 * é o bloco 7B.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS_DIR = path.join(ROOT, "demo-f18");
const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 90_000;

/** [lng, lat] — Kiev, três pontos de passagem a nordeste, Moscou. */
const WAYPOINTS = [
  [30.5234, 50.4501],
  [31.9, 52.1],
  [33.8, 53.5],
  [35.9, 54.7],
  [37.6176, 55.7558],
];

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
const mapa = () => {
  const surface = window.__theatrumPhase2;
  if (!surface) throw new Error('mapa indisponível');
  return surface.map;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
const waitModel3d = async (minLoaded) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const surface = window.__theatrumModel3d;
    if (surface) {
      const status = surface.status();
      if (status.loaded >= minLoaded) return status;
    }
    await wait(200);
  }
  throw new Error('modelo 3D não carregou a tempo');
};
`;

async function waitForRenderer(client) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const ready = await client.evaluate(`(async()=>{
        return Boolean(window.__theatrumPhase3) && Boolean(window.__theatrumPhase2) && Boolean(window.__theatrumPhase4);
      })()`);
      if (ready === true) return;
    } catch {
      // CDP ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("editor não ficou pronto a tempo");
}

/** Monta o cenário (idempotente: reutiliza um cenário demo já existente). */
async function setupScenario(client) {
  return client.evaluate(`(async()=>{
    const S = session();
    const actions = S.actions;
    const snap0 = S.getSnapshot();
    const comp = snap0.document.compositions.find((c) => c.id === snap0.selectedCompositionId);
    if (!comp) throw new Error('sem composição selecionada');
    const duration = comp.duration;
    const waypoints = ${JSON.stringify(WAYPOINTS)};

    const existing = Object.values(comp.nodes).find((n) => n.name === 'F/A-18F Super Hornet');
    if (existing !== undefined) {
      return { reused: true, nodeId: existing.id, duration };
    }

    // 1. Asset: o GLB servido pelo Vite entra na Biblioteca (dedupe por hash).
    const before = new Set(snap0.document.assets.map((a) => a.src));
    const response = await fetch('/models/fa-18f.glb');
    if (!response.ok) throw new Error('GLB não servido pelo dev server: ' + response.status);
    const bytes = await response.arrayBuffer();
    await actions.importAssetFiles([
      new File([bytes], 'fa-18f-super-hornet.glb', { type: 'model/gltf-binary' }),
    ]);
    const snap1 = S.getSnapshot();
    const asset =
      snap1.document.assets.find((a) => !before.has(a.src) && a.kind === 'model') ??
      snap1.document.assets.find((a) => a.kind === 'model');
    if (!asset) throw new Error('asset do modelo não entrou no documento');

    // 2. Nó model3d com o asset aplicado.
    const nodeId = actions.addNodeOfType('model3d');
    if (!nodeId) throw new Error('addNodeOfType model3d falhou');
    actions.renameNode(nodeId, 'F/A-18F Super Hornet');
    if (!actions.setPropertyValue(nodeId, 'props.assetId', asset.src)) {
      throw new Error('props.assetId não aceitou o src do asset');
    }
    actions.setPropertyValue(nodeId, 'props.scaleMeters', 160000);
    // Altitude real no mundo: sem ela o modelo fica colado no terreno (parece
    // recorte 2D em qualquer pitch). A 90 km a câmera baixa enxerga o ventre,
    // a fuselagem e as deriva — o volume 3D de verdade.
    actions.setPropertyValue(nodeId, 'props.altitudeMeters', 90000);

    // 3. Rota curva: catmull-rom geo pelos cinco pontos — nada de reta.
    const pathId = actions.createPath({
      name: 'Rota Kiev → Moscou',
      space: 'geo',
      interpolation: 'catmull-rom',
      vertices: waypoints.map((point) => ({ point, inHandle: null, outHandle: null })),
    });
    if (!pathId) throw new Error('createPath falhou');
    const behaviorId = actions.assignMotionPath(nodeId, pathId, { from: 0, to: duration });
    if (!behaviorId) throw new Error('assignMotionPath falhou');

    // 4. Marcadores: círculos geo-ancorados. Passagens (amarelo) aparecem no
    //    instante da passada; extremidades (ciano/vermelho) sempre visíveis.
    const bus = S.commandBus;
    const compId = snap0.selectedCompositionId;
    const kf = (id, frame, value) => ({
      id, frame, value, in: { kind: 'linear' }, out: { kind: 'linear' },
    });
    let markerSeq = 0;
    const marker = (point, color, stroke, radius, appearFrame) => {
      const id = actions.addNodeOfType('shape.circle');
      if (!id) throw new Error('addNodeOfType shape.circle falhou');
      actions.renameNode(id, appearFrame === null ? 'Extremidade' : 'Passagem ' + (++markerSeq));
      actions.setNodeAnchor(id, { space: 'geo', lngLat: [point[0], point[1]] });
      actions.setPropertyValue(id, 'props.radius', radius);
      actions.setPropertyValue(id, 'props.fill', color);
      actions.setPropertyValue(id, 'props.stroke', stroke);
      actions.setPropertyValue(id, 'props.strokeWidth', 2);
      if (appearFrame !== null) {
        const fade = 40;
        for (const [frame, value] of [[0, 0], [Math.max(0, appearFrame - fade), 0], [appearFrame, 1]]) {
          bus.dispatch({
            type: 'keyframe.set',
            payload: {
              compositionId: compId,
              target: { kind: 'node', nodeId: id },
              path: ['transform', 'opacity'],
              keyframe: kf('kf_demo_' + id + '_' + frame, frame, value),
            },
            source: 'user',
          });
        }
      }
      return id;
    };

    marker(waypoints[0], '#38bdf8cc', '#7dd3fcff', 10, null);
    marker(waypoints[4], '#ef4444cc', '#f87171ff', 10, null);
    for (const index of [1, 2, 3]) {
      const frame = Math.round((duration * index) / 4);
      marker(waypoints[index], '#facc15aa', '#fde047ff', 13, frame);
    }

    return { reused: false, nodeId, pathId, assetId: asset.id, duration };
  })()`);
}

/** Destaque de contorno dos países (runtime, não-documental) + enquadramento. */
async function setupMap(client) {
  return client.evaluate(`(async()=>{
    const map = mapa();
    const style = map.getStyle();
    // GeoJSON carregado volta do getStyle() como objeto, não URL — a base se
    // deriva da URL do PMTiles, que permanece string.
    const pmtilesUrl = style.sources && style.sources['natural-earth'] && style.sources['natural-earth'].url;
    if (typeof pmtilesUrl !== 'string') throw new Error('source natural-earth sem url string');
    const base = pmtilesUrl.split('://').slice(1).join('://').split('/basemap/')[0];
    const countriesUrl = base + '/natural-earth/ne_110m_admin_0_countries.geojson';
    if (map.getSource('demo-countries') === undefined) {
      map.addSource('demo-countries', { type: 'geojson', data: countriesUrl });
    }
    const layers = [
      {
        id: 'demo-ukr-fill',
        type: 'fill',
        filter: ['==', ['get', 'ADM0_A3'], 'UKR'],
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.16 },
      },
      {
        id: 'demo-ukr-line',
        type: 'line',
        filter: ['==', ['get', 'ADM0_A3'], 'UKR'],
        paint: { 'line-color': '#60a5fa', 'line-width': 2.4 },
      },
      {
        id: 'demo-rus-fill',
        type: 'fill',
        filter: ['==', ['get', 'ADM0_A3'], 'RUS'],
        paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.12 },
      },
      {
        id: 'demo-rus-line',
        type: 'line',
        filter: ['==', ['get', 'ADM0_A3'], 'RUS'],
        paint: { 'line-color': '#f87171', 'line-width': 2.4 },
      },
    ];
    for (const layer of layers) {
      if (map.getLayer(layer.id) !== undefined) continue;
      map.addLayer({
        id: layer.id,
        type: layer.type,
        source: 'demo-countries',
        filter: layer.filter,
        paint: layer.paint,
      });
    }
    map.jumpTo({ center: [31.5, 52.3], zoom: 4.55, bearing: 0, pitch: 45 });
    await window.__theatrumPhase2.settle(4000);
    return { countriesUrl };
  })()`);
}

async function screenshot(client, name) {
  const shot = await client.request("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOTS_DIR, name);
  await writeFile(file, Buffer.from(shot.data, "base64"));
  return file;
}

async function main() {
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await mkdir(SHOTS_DIR, { recursive: true });
  try {
    await client.request("Page.enable");
    await waitForRenderer(client);

    const scenario = await setupScenario(client);
    console.log(
      scenario.reused
        ? `Cenário demo já existia — reutilizado (nó ${scenario.nodeId}).`
        : `Cenário montado: asset ${scenario.assetId}, nó ${scenario.nodeId}, caminho ${scenario.pathId}.`,
    );

    const { countriesUrl } = await setupMap(client);
    console.log(`Contornos UA/RU via ${countriesUrl}`);

    console.log("Aguardando o GLB carregar na camada 3D…");
    const status = await client.evaluate(`waitModel3d(1)`);
    console.log(`Camada 3D: ${JSON.stringify(status)}`);

    const duration = scenario.duration;
    const frames = [0, Math.round(duration * 0.35), Math.round(duration * 0.7)];
    for (const frame of frames) {
      await client.evaluate(`(async()=>{
        await atFrame(${frame});
        await wait(400);
        return true;
      })()`);
      const file = await screenshot(client, `frame-${String(frame).padStart(3, "0")}.png`);
      console.log(`Screenshot: ${file}`);
    }

    // Deixa a missão tocando em loop para o usuário assistir, com a janela à frente.
    await client.evaluate(`(async()=>{
      session().actions.setLoop(true);
      session().actions.setPlayhead(0);
      session().actions.play();
      return true;
    })()`);
    try {
      await client.request("Page.bringToFront");
    } catch {
      // Foco de janela é best-effort; a reprodução não depende disso.
    }
    console.log("Reproduzindo a missão em LOOP na viewport (barra de espaço pausa).");
    console.log("NOTA: cenário de demo NÃO é desfeito — fica na sessão para exploração.");
  } finally {
    client.close();
  }
}

await main();
