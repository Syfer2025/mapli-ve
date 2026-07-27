/**
 * Prova automatizada dos seis critérios de saída da Fase 4, no Electron real.
 *
 * Requer `pnpm dev` rodando: as provas dependem do mapa MapLibre, do overlay
 * Pixi e do canvas da timeline montados de verdade. Nada aqui é medido em
 * jsdom; os testes unitários cobrem a parte pura.
 *
 *   node tools/verify-phase4.mjs
 *
 * O script devolve o documento ao estado inicial (undo de todas as transações
 * que criou), restaura câmera, playhead e seleção, e nunca encerra processos.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 60_000;

const KURSK = [36.190028, 51.73998];
const PROOF_TYPE = "shape.circle";
const EXTENSION_FILES = [
  "packages/renderer/src/builtins.ts",
  "packages/scene-graph/src/builtin-node-types.ts",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
      // O prelúdio vive num escopo de função: avaliações repetidas no mesmo
      // contexto não colidem em redeclaração.
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

/**
 * Prelúdio injetado em toda avaliação. `renders` do overlay é o que impede
 * medir um frame obsoleto depois de mover a câmera.
 */
const PRELUDE = `
const surfaces = () => {
  const overlay = window.__theatrumPhase4;
  const session = window.__theatrumPhase3;
  const viewport = window.__theatrumPhase2;
  const timeline = window.__theatrumPhase4Timeline;
  if (!overlay || !session || !viewport || !timeline) {
    throw new Error('superfícies de debug ausentes; o app está em modo dev?');
  }
  return { overlay, session, viewport, timeline };
};
// Corrida com timer: se a janela for ocultada, o rAF congela e a espera
// travaria até o V8 coletar a promise ("Promise was collected" no CDP).
const raf = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 32);
  });
const frames = async (count) => { for (let i = 0; i < count; i += 1) await raf(); };
const waitFor = async (test, label, timeoutMs) => {
  const deadline = performance.now() + (timeoutMs ?? 8000);
  for (;;) {
    const value = test();
    if (value) return value;
    if (performance.now() > deadline) throw new Error('timeout esperando ' + label);
    await raf();
  }
};
const overlayNode = (id) => {
  const snapshot = surfaces().overlay.getSnapshot();
  return snapshot.ready ? (snapshot.nodes ?? []).find((node) => node.id === id) : undefined;
};
const center = (bounds) => [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
const angleDelta = (left, right) =>
  Math.abs((((left - right + 180) % 360) + 360) % 360 - 180);
const applyCamera = async (state) => {
  const { overlay, viewport } = surfaces();
  const before = overlay.getSnapshot().renders;
  viewport.map.jumpTo({
    center: state.center,
    zoom: state.zoom,
    bearing: state.bearing,
    pitch: state.pitch,
  });
  await viewport.settle(6000);
  await waitFor(() => overlay.getSnapshot().renders > before, 'novo frame do overlay');
  await frames(2);
};
const activatePanel = async (title, selector) => {
  if (document.querySelector(selector)) return;
  const tab = Array.from(document.querySelectorAll('[role="tab"],.dv-tab')).find(
    (element) => element.textContent?.trim() === title,
  );
  if (tab instanceof HTMLElement) tab.click();
  await waitFor(() => document.querySelector(selector), 'painel ' + title);
};
const CAMERA_STATES = [
  { label: 'base', center: [36.190028, 51.73998], zoom: 5.2, bearing: 0, pitch: 0 },
  { label: 'zoom', center: [36.190028, 51.73998], zoom: 8.4, bearing: 0, pitch: 0 },
  { label: 'bearing47', center: [36.42, 51.9], zoom: 7.1, bearing: 47, pitch: 0 },
  { label: 'pitch45', center: [36.02, 51.62], zoom: 6.6, bearing: -23, pitch: 45 },
  { label: 'pitch70', center: [36.190028, 51.73998], zoom: 7.8, bearing: 128, pitch: 70 },
];
`;

async function waitForRenderer(client) {
  const deadline = Date.now() + 40_000;
  let lastError = "sem resposta";
  while (Date.now() < deadline) {
    try {
      const ready = await client.evaluate(`(async()=>{
        const overlay = window.__theatrumPhase4;
        const state = {
          session: Boolean(window.__theatrumPhase3),
          viewport: Boolean(window.__theatrumPhase2),
          overlay: Boolean(overlay?.getSnapshot().ready),
          timeline: Boolean(window.__theatrumPhase4Timeline),
          bridge: Boolean(window.theatrum),
        };
        return { ok: Object.values(state).every(Boolean), state };
      })()`);
      if (ready.ok) return;
      lastError = JSON.stringify(ready.state);
    } catch (error) {
      lastError = error.message;
    }
    await delay(200);
  }
  throw new Error(`superfícies da Fase 4 não ficaram prontas em 40 s (${lastError})`);
}

/**
 * Estado anterior a qualquer edição. Fica separado para que a restauração
 * funcione mesmo quando uma prova falha no meio.
 */
async function captureBaseline(client) {
  return client.evaluate(`(async()=>{
    const { session, viewport } = surfaces();
    const before = session.getSnapshot();
    if (before.recoveryCandidate !== null) {
      throw new Error('há recuperação pendente; recupere ou descarte antes da prova');
    }
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    };
    return {
      compositionId: before.selectedCompositionId,
      historyStart: before.history.cursor,
      initialPlayhead: before.playheadFrame,
      documentJson: JSON.stringify(canonical(before.document)),
      initialCamera: {
        center: [viewport.map.getCenter().lng, viewport.map.getCenter().lat],
        zoom: viewport.map.getZoom(),
        bearing: viewport.map.getBearing(),
        pitch: viewport.map.getPitch(),
      },
    };
  })()`);
}

/** Critérios 1 e 2: âncora geo estável e âncora comp imune à câmera. */
async function verifyPlacement(client) {
  return client.evaluate(`(async()=>{
    const { overlay, session, viewport } = surfaces();

    session.actions.clearSelection();
    const tankId = session.actions.addNodeOfType('unit.armor');
    if (tankId === null) throw new Error('não foi possível criar unit.armor');
    if (!session.actions.setNodeAnchor(tankId, { space: 'geo', lngLat: ${JSON.stringify(KURSK)} })) {
      throw new Error('âncora geo do tanque rejeitada');
    }
    session.actions.clearSelection();
    const titleId = session.actions.addNodeOfType('text.title');
    if (titleId === null) throw new Error('não foi possível criar text.title');
    if (!session.actions.setNodeAnchor(titleId, { space: 'comp', position: [960, 220] })) {
      throw new Error('âncora comp do título rejeitada');
    }
    await waitFor(() => overlayNode(tankId) && overlayNode(titleId), 'nós no overlay');

    const samples = [];
    for (const state of CAMERA_STATES) {
      await applyCamera(state);
      const tank = overlayNode(tankId);
      const title = overlayNode(titleId);
      if (!tank || !title) throw new Error('nó ausente no frame do overlay');
      const projected = viewport.map.project(${JSON.stringify(KURSK)});
      const [tankX, tankY] = center(tank.bounds);
      samples.push({
        label: state.label,
        bearing: viewport.map.getBearing(),
        pitch: viewport.map.getPitch(),
        zoom: Number(viewport.map.getZoom().toFixed(3)),
        tank: {
          deltaPx: Math.hypot(tankX - projected.x, tankY - projected.y),
          sizePx: tank.sizePx,
          visible: tank.visible,
          screenAngle: tank.screenAngle,
          expectedAngle: ((-viewport.map.getBearing() % 360) + 360) % 360,
          angleErrorDeg: angleDelta(
            tank.screenAngle,
            ((-viewport.map.getBearing() % 360) + 360) % 360,
          ),
          rotationReference: tank.transform.rotationReference,
        },
        title: {
          bounds: title.bounds,
          sizePx: title.sizePx,
          visible: title.visible,
        },
      });
    }

    const first = samples[0];
    const worstDelta = Math.max(...samples.map((sample) => sample.tank.deltaPx));
    const worstAngle = Math.max(...samples.map((sample) => sample.tank.angleErrorDeg));
    const sizeStable = samples.every(
      (sample) =>
        sample.tank.sizePx[0] === first.tank.sizePx[0] &&
        sample.tank.sizePx[1] === first.tank.sizePx[1],
    );
    const titleFixed = samples.every(
      (sample) =>
        Math.abs(sample.title.bounds.x - first.title.bounds.x) < 1e-9 &&
        Math.abs(sample.title.bounds.y - first.title.bounds.y) < 1e-9 &&
        Math.abs(sample.title.bounds.width - first.title.bounds.width) < 1e-9 &&
        Math.abs(sample.title.bounds.height - first.title.bounds.height) < 1e-9,
    );
    const allVisible = samples.every((sample) => sample.tank.visible && sample.title.visible);

    if (worstDelta > 0.5) throw new Error('tanque saiu da coordenada: ' + worstDelta + ' px');
    if (worstAngle > 0.001) throw new Error('orientação de norte errada: ' + worstAngle + '°');
    if (!sizeStable) throw new Error('tamanho de tela do tanque variou com o zoom');
    if (!titleFixed) throw new Error('título em espaço comp se moveu com a câmera');
    if (!allVisible) throw new Error('algum nó ficou fora do viewport durante a prova');

    return {
      tankId,
      titleId,
      worstDeltaPx: worstDelta,
      worstAngleErrorDeg: worstAngle,
      constantScreenSize: first.tank.sizePx,
      titleBounds: first.title.bounds,
      samples,
    };
  })()`);
}

/** Critério 3: keyframes de opacidade e escala com playback real a 60 fps. */
async function verifyAnimation(client, placement) {
  return client.evaluate(`(async()=>{
    const { overlay, session } = surfaces();
    const nodeId = ${JSON.stringify(placement.tankId)};
    const cursorBefore = session.getSnapshot().history.cursor;

    session.actions.setPlayhead(0);
    if (!session.actions.togglePropertyKeyframe(nodeId, 'transform.opacity')) {
      throw new Error('keyframe de opacidade em 0 rejeitado');
    }
    if (!session.actions.togglePropertyKeyframe(nodeId, 'transform.scale')) {
      throw new Error('keyframe de escala em 0 rejeitado');
    }
    session.actions.setPlayhead(60);
    if (!session.actions.setPropertyValue(nodeId, 'transform.opacity', 0.2)) {
      throw new Error('opacidade final rejeitada');
    }
    if (!session.actions.setPropertyValue(nodeId, 'transform.scale', [2, 2])) {
      throw new Error('escala final rejeitada');
    }

    const lerp = (from, to, t) => from + (to - from) * t;
    const measured = [];
    for (const frame of [0, 15, 30, 45, 60]) {
      const rendersBefore = overlay.getSnapshot().renders;
      session.actions.setPlayhead(frame);
      await waitFor(
        () => overlay.getSnapshot().renders > rendersBefore && overlay.getSnapshot().frame === frame,
        'frame ' + frame + ' no overlay',
      );
      const node = overlayNode(nodeId);
      if (!node) throw new Error('nó animado ausente no frame ' + frame);
      const t = frame / 60;
      measured.push({
        frame,
        opacity: node.opacity,
        expectedOpacity: lerp(1, 0.2, t),
        scale: node.transform.scale,
        expectedScale: lerp(1, 2, t),
        sizePx: node.sizePx,
      });
    }
    const worstOpacity = Math.max(
      ...measured.map((sample) => Math.abs(sample.opacity - sample.expectedOpacity)),
    );
    const worstScale = Math.max(
      ...measured.map((sample) =>
        Math.max(
          Math.abs(sample.scale[0] - sample.expectedScale),
          Math.abs(sample.scale[1] - sample.expectedScale),
        ),
      ),
    );
    if (worstOpacity > 1e-9) throw new Error('opacidade interpolada errada: ' + worstOpacity);
    if (worstScale > 1e-9) throw new Error('escala interpolada errada: ' + worstScale);

    // Playback real: conta frames de overlay efetivamente renderizados.
    session.actions.setPlayhead(0);
    session.actions.setLoop(true);
    await frames(2);
    const startedAt = performance.now();
    const startPlayhead = session.getSnapshot().playheadFrame;
    const startRenders = overlay.getSnapshot().renders;
    const seenFrames = new Set();
    const totals = [];
    session.actions.play();
    while (performance.now() - startedAt < 1200) {
      await raf();
      const snapshot = overlay.getSnapshot();
      if (snapshot.ready) {
        seenFrames.add(snapshot.frame);
        if (snapshot.metrics) totals.push(snapshot.metrics.totalMs);
      }
    }
    const elapsedMs = performance.now() - startedAt;
    const endPlayhead = session.getSnapshot().playheadFrame;
    const renders = overlay.getSnapshot().renders - startRenders;
    session.actions.pause();
    session.actions.stop();
    session.actions.setLoop(${JSON.stringify(false)});
    totals.sort((left, right) => left - right);
    const p95Total = totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))] ?? 0;
    const playheadFps = ((endPlayhead - startPlayhead) / elapsedMs) * 1000;
    const renderedFps = (renders / elapsedMs) * 1000;
    const distinctFps = (seenFrames.size / elapsedMs) * 1000;

    if (playheadFps < 55) throw new Error('playhead avançou a ' + playheadFps + ' fps');
    if (renderedFps < 55) throw new Error('overlay renderizou a ' + renderedFps + ' fps');
    if (p95Total > 16.7) throw new Error('frame de overlay custou ' + p95Total + ' ms no p95');

    return {
      keyframedProperties: ['transform.opacity', 'transform.scale'],
      worstOpacityErro: worstOpacity,
      worstScaleErro: worstScale,
      samples: measured,
      playback: {
        elapsedMs,
        playheadFps,
        renderedFps,
        distinctFps,
        overlayFrameP95Ms: p95Total,
        overlayFrameMaxMs: totals.at(-1) ?? 0,
      },
      transactions: session.getSnapshot().history.cursor - cursorBefore,
    };
  })()`);
}

/** Critério 4: 200+ trilhas e 3000+ keyframes com scrub e redraw medidos. */
async function verifyTimeline(client, baseline) {
  return client.evaluate(`(async()=>{
    const { session, timeline } = surfaces();
    const compositionId = ${JSON.stringify(baseline.compositionId)};
    const cursorBefore = session.getSnapshot().history.cursor;
    await activatePanel('Timeline', '.timeline-panel__canvas');

    const snapshot = session.getSnapshot();
    const composition = snapshot.document.compositions.find((item) => item.id === compositionId);
    const root = composition?.nodes[composition.root];
    if (!composition || !root) throw new Error('composição sem raiz');

    const NODES = 40;
    const KEYFRAMES_PER_PROPERTY = 13;
    const PROPERTIES = [
      ['transform.position', (index) => [index * 3, index * 2]],
      ['transform.rotation', (index) => index * 4],
      ['transform.scale', (index) => [1 + index / 40, 1 + index / 40]],
      ['transform.opacity', (index) => (index % 10) / 10],
      ['transform.anchorPoint', (index) => [0.5, (index % 5) / 10]],
      ['transform.skew', (index) => [index % 7, index % 3]],
    ];
    const created = [];
    const transaction = session.commandBus.transaction('Prova F4 · timeline densa', () => {
      for (let index = 0; index < NODES; index += 1) {
        const id = 'nd_phase4_timeline_' + String(index).padStart(3, '0');
        const node = structuredClone(root);
        Object.assign(node, {
          id,
          name: 'Trilha de prova ' + String(index + 1),
          type: 'group',
          parent: root.id,
          children: [],
        });
        for (const [path, valueAt] of PROPERTIES) {
          const segments = path.split('.');
          let target = node;
          for (const segment of segments.slice(0, -1)) target = target[segment];
          const property = target[segments[segments.length - 1]];
          property.keyframes = Array.from({ length: KEYFRAMES_PER_PROPERTY }, (_unused, step) => ({
            id: 'kf_' + id + '_' + segments.join('_') + '_' + String(step),
            frame: Math.round((step / (KEYFRAMES_PER_PROPERTY - 1)) * composition.duration),
            value: valueAt(step),
            in: { kind: 'linear' },
            out: { kind: 'linear' },
          }));
        }
        const result = session.commandBus.dispatch({
          type: 'node.create',
          payload: { compositionId, parentId: root.id, node },
          source: 'system',
        });
        if (!result.ok) throw new Error(result.error.message);
        created.push(id);
      }
    });
    if (!transaction.ok) throw new Error(transaction.error.message);

    // Selecionar expande as trilhas de propriedade: é o mesmo caminho da UI.
    session.actions.selectNodes(compositionId, created);
    const expected = created.length * PROPERTIES.length * KEYFRAMES_PER_PROPERTY;
    await waitFor(
      () => timeline.summary().keyframes >= expected && timeline.summary().tracks >= 200,
      'timeline densa montada',
      20000,
    );

    // Três medições. \`panel\` é o painel atual; \`maximized\` é o caso exigível
    // — um painel de 900 px (tela cheia em 1080p) rolado até a região densa,
    // com a duração inteira visível, de modo que centenas de keyframes sejam
    // realmente desenhados; \`unbounded\` desenha as 300 trilhas de uma vez num
    // canvas de altura impossível numa tela, como teto informativo.
    const summary = timeline.summary();
    const denseScrollY = Math.round((summary.tracks * 22) / 2);
    const panel = timeline.measureRedraw(180, { scrollY: denseScrollY });
    const maximized = timeline.measureRedraw(180, {
      height: 900,
      fitDuration: true,
      scrollY: denseScrollY,
    });
    const unbounded = timeline.measureRedraw(60, {
      height: 24 + summary.tracks * 22,
      fitDuration: true,
      scrollY: 0,
    });
    session.actions.clearSelection();

    if (summary.tracks < 200) throw new Error('trilhas insuficientes: ' + summary.tracks);
    if (summary.keyframes < 3000) throw new Error('keyframes insuficientes: ' + summary.keyframes);
    if (maximized.drawn.keyframes < 300) {
      throw new Error('medição vazia: só ' + maximized.drawn.keyframes + ' keyframes desenhados');
    }
    if (unbounded.drawn.keyframes < 3000) {
      throw new Error('teto não desenhou os 3000 keyframes: ' + unbounded.drawn.keyframes);
    }
    if (maximized.p95Ms >= 4) throw new Error('redraw p95 de ' + maximized.p95Ms + ' ms');
    if (1000 / maximized.p95Ms < 30) throw new Error('scrub abaixo de 30 fps');

    return {
      created: created.length,
      tracks: summary.tracks,
      keyframes: summary.keyframes,
      duration: summary.duration,
      maximized: { ...maximized, scrubFpsFromP95: 1000 / maximized.p95Ms },
      panel: {
        ...panel,
        scrubFpsFromP95: panel.p95Ms === 0 ? null : 1000 / panel.p95Ms,
      },
      unbounded: {
        ...unbounded,
        scrubFpsFromP95: 1000 / unbounded.p95Ms,
        nota: 'todas as trilhas num canvas de altura irreal; teto, não critério',
      },
      transactions: session.getSnapshot().history.cursor - cursorBefore,
    };
  })()`);
}

/** Critérios 5 e 6: tipo novo criado pela UI e Inspector gerado por descriptors. */
async function verifyNewNodeType(client) {
  return client.evaluate(`(async()=>{
    const { overlay, session } = surfaces();
    const cursorBefore = session.getSnapshot().history.cursor;
    await activatePanel('Documento', '.project-tree');

    const menu = document.querySelector('.project-tree__add');
    if (!(menu instanceof HTMLDetailsElement)) throw new Error('menu de objetos ausente');
    const summary = menu.querySelector('summary');
    if (!(summary instanceof HTMLElement)) throw new Error('acionador do menu ausente');
    summary.click();
    await waitFor(() => menu.open && menu.querySelector('.project-tree__add-item'), 'menu aberto');

    const offered = Array.from(menu.querySelectorAll('.project-tree__add-item')).map((item) =>
      item.getAttribute('data-node-type'),
    );
    const item = menu.querySelector('[data-node-type="${PROOF_TYPE}"]');
    if (!(item instanceof HTMLElement)) {
      throw new Error('tipo ${PROOF_TYPE} não apareceu no menu gerado pelo registry');
    }
    session.actions.clearSelection();
    item.click();
    await waitFor(() => {
      const selected = session.getSnapshot().selectedNodeId;
      if (selected === null) return false;
      const composition = session
        .getSnapshot()
        .document.compositions.find((entry) => entry.id === session.getSnapshot().selectedCompositionId);
      return composition?.nodes[selected]?.type === '${PROOF_TYPE}';
    }, 'nó ${PROOF_TYPE} criado pela UI');

    const state = session.getSnapshot();
    const circleId = state.selectedNodeId;
    const composition = state.document.compositions.find(
      (entry) => entry.id === state.selectedCompositionId,
    );
    const node = composition.nodes[circleId];
    // Ancora no centro visível do mapa: prova que o tipo novo atravessa
    // evaluate → layout → renderer e chega à tela, não só ao documento.
    const mapCenter = surfaces().viewport.map.getCenter();
    if (!session.actions.setNodeAnchor(circleId, {
      space: 'geo',
      lngLat: [mapCenter.lng, mapCenter.lat],
    })) {
      throw new Error('âncora do círculo rejeitada');
    }
    const rendered = await waitFor(
      () => {
        const candidate = overlayNode(circleId);
        return candidate?.visible === true ? candidate : undefined;
      },
      'círculo visível no overlay',
    );

    await activatePanel('Inspector', '.inspector-panel');
    await waitFor(
      () =>
        Array.from(document.querySelectorAll('.inspector-panel .ui-field__label')).some(
          (label) => label.textContent?.trim() === 'Raio',
        ),
      'campo Raio no Inspector',
    );
    const inspector = {
      typeLabel: document.querySelector('.inspector-panel__identity small')?.textContent?.trim(),
      groups: Array.from(document.querySelectorAll('.inspector-panel .ui-field-group__title')).map(
        (title) => title.textContent?.trim(),
      ),
      fields: Array.from(document.querySelectorAll('.inspector-panel .ui-field__label')).map(
        (label) => label.textContent?.trim(),
      ),
    };
    if (!inspector.fields.includes('Raio')) throw new Error('Inspector não mostrou Raio');
    if (!inspector.fields.includes('Preenchimento')) {
      throw new Error('Inspector não mostrou Preenchimento');
    }
    if (document.querySelector('.inspector-panel__warning')) {
      throw new Error('Inspector tratou o tipo novo como desconhecido');
    }

    return {
      circleId,
      offeredTypes: offered,
      createdVia: 'clique no menu gerado pelo registry',
      nodeType: node.type,
      nodeProps: Object.keys(node.props).sort(),
      radius: node.props.radius.value,
      renderedSizePx: rendered.sizePx,
      renderedVisible: rendered.visible,
      inspector,
      transactions: session.getSnapshot().history.cursor - cursorBefore,
    };
  })()`);
}

async function restoreSession(client, baseline) {
  return client.evaluate(`(async()=>{
    const { session, viewport } = surfaces();
    const baseline = ${JSON.stringify(baseline)};
    let undone = 0;
    while (session.getSnapshot().history.cursor > baseline.historyStart && undone < 500) {
      session.actions.undo();
      undone += 1;
    }
    await frames(2);
    session.actions.clearSelection();
    session.actions.setPlayhead(baseline.initialPlayhead);
    viewport.map.jumpTo(baseline.initialCamera);
    await viewport.settle(6000);
    const after = session.getSnapshot();
    if (after.history.cursor !== baseline.historyStart) {
      throw new Error(
        'histórico não voltou ao cursor inicial: ' +
          after.history.cursor +
          ' != ' +
          baseline.historyStart,
      );
    }
    const composition = after.document.compositions.find(
      (entry) => entry.id === baseline.compositionId,
    );
    const leftovers = Object.keys(composition?.nodes ?? {}).filter((id) =>
      id.startsWith('nd_phase4_timeline_'),
    );
    if (leftovers.length > 0) throw new Error(leftovers.length + ' nós de prova sobraram');

    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    };
    const identical = JSON.stringify(canonical(after.document)) === baseline.documentJson;
    if (!identical) throw new Error('documento restaurado difere do inicial');

    // Reinicia o sidecar de recuperação para não deixar a sessão suja.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const reset = await window.theatrum.recovery.start({
      document: after.document,
      projectPath: after.file?.path ?? null,
    });
    if (!reset.ok) throw new Error(reset.message);
    return {
      undone,
      historyCursor: after.history.cursor,
      nodes: Object.keys(composition?.nodes ?? {}).length,
      documentIdenticalToBaseline: identical,
      // O flag continua marcado: houve edição na sessão, mesmo desfeita. O
      // sidecar de recuperação foi reiniciado com o documento restaurado.
      dirty: after.dirty,
    };
  })()`);
}

/** Critério 5, parte estática: quais arquivos de produção citam o tipo novo. */
async function scanExtensionFootprint() {
  const skipped = new Set(["dist", "node_modules", "out", "coverage"]);
  const files = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) await walk(absolute);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|bench)\.tsx?$/.test(entry.name)) continue;
      files.push(absolute);
    }
  }

  for (const root of ["packages", "apps"]) {
    for (const workspace of await readdir(path.join(ROOT, root), { withFileTypes: true })) {
      if (workspace.isDirectory()) await walk(path.join(ROOT, root, workspace.name, "src"));
    }
  }

  const mentions = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (content.includes(PROOF_TYPE)) {
      mentions.push(path.relative(ROOT, file).replaceAll("\\", "/"));
    }
  }
  mentions.sort();

  assert(
    mentions.length === EXTENSION_FILES.length &&
      EXTENSION_FILES.every((file) => mentions.includes(file)),
    `${PROOF_TYPE} citado em ${mentions.length} arquivos: ${mentions.join(", ")}`,
  );
  return { scannedFiles: files.length, mentions };
}

async function main() {
  const footprint = await scanExtensionFootprint();
  const page = await pageTarget();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  let baseline;
  try {
    // A medição de playback depende de rAF em ritmo normal: janela oculta é
    // throttled pelo Chromium e reprovaria por motivo errado.
    await client.request("Page.bringToFront");
    await waitForRenderer(client);
    baseline = await captureBaseline(client);
    const placement = await verifyPlacement(client);
    const animation = await verifyAnimation(client, placement);
    const timeline = await verifyTimeline(client, baseline);
    const newType = await verifyNewNodeType(client);
    const cleanup = await restoreSession(client, baseline);

    console.log(
      JSON.stringify(
        {
          ok: true,
          criteria: {
            "1-tanque-em-kursk": {
              worstDeltaPx: placement.worstDeltaPx,
              worstAngleErrorDeg: placement.worstAngleErrorDeg,
              constantScreenSize: placement.constantScreenSize,
              cameraStates: placement.samples.map((sample) => ({
                label: sample.label,
                zoom: sample.zoom,
                bearing: sample.bearing,
                pitch: sample.pitch,
                deltaPx: sample.tank.deltaPx,
                screenAngle: sample.tank.screenAngle,
              })),
            },
            "2-titulo-em-comp": {
              bounds: placement.titleBounds,
              movedPx: 0,
              cameraStates: placement.samples.length,
            },
            "3-keyframes-e-playback": animation,
            "4-timeline-densa": timeline,
            "5-tipo-novo": { ...footprint, ...newType },
            "6-inspector-gerado": newType.inspector,
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
