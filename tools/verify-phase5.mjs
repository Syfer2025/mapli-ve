/**
 * Prova automatizada dos seis critérios de saída da Fase 5, no Electron real.
 *
 * Requer `pnpm dev` rodando. Como na Fase 4, o script desfaz tudo o que cria e
 * compara o documento com o estado inicial antes de sair.
 *
 *   node tools/verify-phase5.mjs
 *
 * Limite conhecido e deliberado: o `Input.dispatchMouseEvent` do CDP no Electron
 * não sintetiza `pointerdown` (só `click`), então os gestos de caneta e de handle
 * usam `PointerEvent` DOM despachado no elemento real. Handler, máquina de
 * estados, matemática de coordenadas e comandos são os de produção; apenas a
 * origem do evento é sintética.
 */

const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 90_000;

const WARSAW = [21.0122, 52.2297];
const LENINGRAD = [30.3158, 59.9391];
const LISBON = [-9.1393, 38.7223];
const MOSCOW = [37.6173, 55.7558];

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
const viewport = () => {
  const surface = window.__theatrumPhase2;
  if (!surface) throw new Error('mapa indisponível');
  return surface;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const composition = () => {
  const state = session().getSnapshot();
  return state.document.compositions.find((entry) => entry.id === state.selectedCompositionId);
};
const nodeById = (id) => composition()?.nodes[id];
const overlayNode = (id) => (overlay().nodes ?? []).find((entry) => entry.id === id);
/**
 * Espera o overlay **estabilizar** no frame pedido: frame certo e nenhum render
 * novo por uma janela curta. Só olhar "chegou um render novo" pega uma renderização
 * que já estava em voo com o documento anterior — foi assim que a primeira amostra
 * de uma trilha recém-criada saiu na âncora antiga e reprovou a prova de
 * velocidade uniforme por engano.
 */
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
const pointer = async (element, type, clientX, clientY, pointerId) => {
  element.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX, clientY,
  }));
  await wait(45);
};
const activatePanel = async (title, selector) => {
  if (document.querySelector(selector)) return;
  const tab = Array.from(document.querySelectorAll('.dv-tab'))
    .find((element) => element.textContent?.trim() === title);
  if (tab instanceof HTMLElement) {
    const box = tab.getBoundingClientRect();
    const options = {
      bubbles: true, cancelable: true, composed: true,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
      button: 0, buttons: 1, pointerId: 90, pointerType: 'mouse', isPrimary: true,
    };
    // Dockview troca de aba no pointerdown/mousedown, não no click.
    tab.dispatchEvent(new PointerEvent('pointerdown', options));
    tab.dispatchEvent(new MouseEvent('mousedown', options));
    tab.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 }));
    tab.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
  }
  const deadline = Date.now() + 5000;
  while (!document.querySelector(selector) && Date.now() < deadline) await wait(60);
  if (!document.querySelector(selector)) throw new Error('painel ' + title + ' não abriu');
};
const EARTH_RADIUS = 6371008.8;
const geodesic = (a, b) => {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
};
const angleDelta = (from, to) => ((((to - from + 180) % 360) + 360) % 360) - 180;
`;

async function waitForRenderer(client) {
  const deadline = Date.now() + 40_000;
  let last = "sem resposta";
  while (Date.now() < deadline) {
    try {
      const ready = await client.evaluate(`(async()=>{
        const state = {
          session: Boolean(window.__theatrumPhase3),
          viewport: Boolean(window.__theatrumPhase2),
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
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
      );
    };
    const map = viewport().map;
    return {
      compositionId: state.selectedCompositionId,
      historyStart: state.history.cursor,
      playhead: state.playheadFrame,
      documentJson: JSON.stringify(canonical(state.document)),
      camera: {
        center: [map.getCenter().lng, map.getCenter().lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
    };
  })()`);
}

/** Critério 1: caminho desenhado com a caneta e percorrido a velocidade uniforme. */
async function verifyUniformSpeed(client) {
  return client.evaluate(`(async()=>{
    await activatePanel('Viewport', '.scene-overlay__gizmos');
    const map = viewport().map;
    map.jumpTo({ center: [25.5, 56], zoom: 4.4, bearing: 0, pitch: 0 });
    await viewport().settle(6000);
    await wait(150);

    const penButton = Array.from(document.querySelectorAll('.scene-overlay__gizmos button'))
      .find((button) => button.textContent?.trim() === 'P');
    if (!penButton) throw new Error('botão da caneta ausente');
    if (!document.querySelector('.scene-overlay__pen-count')) penButton.click();
    await wait(120);

    const container = map.getCanvasContainer();
    const bounds = container.getBoundingClientRect();
    const screenAt = (lngLat) => {
      const point = map.project(lngLat);
      return [bounds.left + point.x, bounds.top + point.y];
    };
    const place = async (lngLat, drag) => {
      const [x, y] = screenAt(lngLat);
      await pointer(container, 'pointerdown', x, y, 11);
      if (drag !== undefined) await pointer(container, 'pointermove', x + drag[0], y + drag[1], 11);
      await pointer(
        container,
        'pointerup',
        drag === undefined ? x : x + drag[0],
        drag === undefined ? y : y + drag[1],
        11,
      );
    };

    await place(${JSON.stringify(WARSAW)}, [70, -34]);
    await place([26.0, 57.0]);
    await place(${JSON.stringify(LENINGRAD)});
    const penCount = document.querySelector('.scene-overlay__pen-count')?.textContent ?? null;
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await wait(400);

    const paths = Object.values(session().getSnapshot().document.paths);
    const drawn = paths.at(-1);
    if (drawn === undefined) throw new Error('a caneta não gravou caminho');

    session().actions.clearSelection();
    const tankId = session().actions.addNodeOfType('unit.armor');
    if (tankId === null) throw new Error('não foi possível criar unit.armor');
    session().actions.renameNode(tankId, 'Prova F5 · blindado');
    const behaviorId = session().actions.assignMotionPath(tankId, drawn.id, { from: 0, to: 300 });
    if (behaviorId === null) throw new Error('assignMotionPath: ' + session().getSnapshot().error);
    // Deixa o documento propagar antes de medir: o passe de comportamentos roda
    // no efeito de render, e amostrar cedo pegaria a âncora anterior.
    await wait(300);

    const samples = [];
    for (let frame = 0; frame <= 300; frame += 15) {
      const snapshot = await atFrame(frame);
      const node = (snapshot.nodes ?? []).find((entry) => entry.id === tankId);
      if (node === undefined || node.anchor.space !== 'geo') {
        throw new Error('tanque sem âncora geo no frame ' + frame);
      }
      samples.push({
        frame,
        lngLat: node.anchor.lngLat,
        rotation: node.transform.rotation,
        reference: node.transform.rotationReference,
      });
    }
    const steps = [];
    for (let index = 0; index + 1 < samples.length; index += 1) {
      steps.push(geodesic(samples[index].lngLat, samples[index + 1].lngLat));
    }
    const mean = steps.reduce((sum, value) => sum + value, 0) / steps.length;
    const worst = Math.max(...steps.map((value) => Math.abs(value - mean) / mean));
    const startError = geodesic(samples[0].lngLat, ${JSON.stringify(WARSAW)});
    const endError = geodesic(samples[samples.length - 1].lngLat, ${JSON.stringify(LENINGRAD)});

    if (worst > 0.05) throw new Error('velocidade não uniforme: desvio de ' + worst);
    if (startError > 20000 || endError > 20000) {
      throw new Error('extremos fora de lugar: ' + startError + ' / ' + endError + ' m');
    }
    if (samples[1].reference !== 'geo-bearing') {
      throw new Error('sem orientação de marcha: ' + samples[1].reference);
    }
    // Direção de marcha acompanha o caminho: o bearing muda ao longo da rota.
    const bearingSpread = Math.max(...samples.map((sample) => sample.rotation)) -
      Math.min(...samples.map((sample) => sample.rotation));
    if (bearingSpread < 1) throw new Error('rotação não acompanhou a curva do caminho');

    return {
      tankId,
      pathId: drawn.id,
      behaviorId,
      contadorDaCaneta: penCount,
      verticesGravados: drawn.vertices.length,
      handleEmGraus: drawn.vertices[0].outHandle,
      amostras: steps.length + 1,
      desvioMaximoDeVelocidade: worst,
      metrosPorPasso: mean,
      erroNoInicioMetros: startError,
      erroNoFimMetros: endError,
      referenciaDeRotacao: samples[1].reference,
      variacaoDeBearing: bearingSpread,
    };
  })()`);
}

/** Critérios 2 e 3: ease no progresso e handle bezier arrastado no graph editor. */
async function verifyGraphEditor(client, placement) {
  return client.evaluate(`(async()=>{
    const tankId = ${JSON.stringify(placement.tankId)};
    session().actions.selectNode(session().getSnapshot().selectedCompositionId, tankId);
    await activatePanel('Editor de curvas', '.graph-panel__canvas');
    await wait(250);

    const select = document.querySelector('.graph-panel__select');
    const option = Array.from(select?.options ?? []).find((entry) =>
      entry.value.includes('params.progress'),
    );
    if (option === undefined) throw new Error('trilha de progress não apareceu no editor');
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(250);

    const progress = () => nodeById(tankId).behaviors[0].params.progress;
    const walkSpeeds = async () => {
      const points = [];
      for (let frame = 0; frame <= 300; frame += 20) {
        const snapshot = await atFrame(frame);
        const node = (snapshot.nodes ?? []).find((entry) => entry.id === tankId);
        points.push(node.anchor.lngLat);
      }
      const speeds = [];
      for (let index = 0; index + 1 < points.length; index += 1) {
        speeds.push(geodesic(points[index], points[index + 1]));
      }
      return speeds;
    };

    const linearSpeeds = await walkSpeeds();
    const linearKinds = progress().keyframes.map((keyframe) => keyframe.out.kind);

    // Critério 2: easy ease nos dois keyframes, pelo botão do painel.
    for (const frame of [0, 300]) {
      session().actions.setPlayhead(frame);
      await wait(140);
      const easeButton = Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Easy ease');
      if (easeButton === undefined) throw new Error('botão easy ease ausente');
      easeButton.click();
      await wait(200);
    }
    const easedKinds = progress().keyframes.map((keyframe) => [keyframe.out.kind, keyframe.in.kind]);
    const easedSpeeds = await walkSpeeds();

    // Parte e freia: primeiro e último passo bem menores que o do meio.
    const middle = easedSpeeds[Math.floor(easedSpeeds.length / 2)];
    const first = easedSpeeds[0];
    const last = easedSpeeds[easedSpeeds.length - 1];
    if (!(first < middle * 0.6)) throw new Error('não parte suave: ' + first + ' vs ' + middle);
    if (!(last < middle * 0.6)) throw new Error('não freia: ' + last + ' vs ' + middle);
    // Sem tranco: passos vizinhos variam pouco entre si.
    const jumps = easedSpeeds.slice(1).map((value, index) => Math.abs(value - easedSpeeds[index]));
    const worstJump = Math.max(...jumps) / middle;
    if (worstJump > 0.5) throw new Error('tranco na curva: ' + worstJump);

    // Critério 3: arrasta o handle de saída usando a posição real na tela.
    const graph = window.__theatrumPhase5Graph;
    if (graph === undefined) throw new Error('superfície do editor de curvas ausente');
    const target = graph.snapshot().handles.find((handle) => handle.side === 'out');
    if (target === undefined) throw new Error('handle de saída não desenhado');
    const canvas = document.querySelector('.graph-panel__canvas');
    const box = canvas.getBoundingClientRect();
    const before = progress().keyframes[0].out.handle;
    const positionBefore = (await atFrame(75)).nodes.find((entry) => entry.id === tankId)
      .anchor.lngLat;

    await pointer(canvas, 'pointerdown', box.left + target.x, box.top + target.y, 12);
    await pointer(
      canvas,
      'pointermove',
      box.left + target.x + box.width * 0.18,
      box.top + target.y - 30,
      12,
    );
    await pointer(
      canvas,
      'pointerup',
      box.left + target.x + box.width * 0.18,
      box.top + target.y - 30,
      12,
    );
    await wait(250);

    const after = progress().keyframes[0].out.handle;
    const positionAfter = (await atFrame(75)).nodes.find((entry) => entry.id === tankId)
      .anchor.lngLat;
    if (Math.abs(after[0] - before[0]) < 1e-6) {
      throw new Error('arrastar o handle não mudou a curva');
    }
    const moved = geodesic(positionBefore, positionAfter);
    if (moved < 100) throw new Error('curva mudou mas a animação não seguiu: ' + moved + ' m');

    return {
      trilhaNoSeletor: option.textContent?.trim() ?? null,
      easingAntes: linearKinds,
      easingDepois: easedKinds,
      passoInicialLinearM: linearSpeeds[0],
      passoInicialComEaseM: first,
      passoDoMeioM: middle,
      passoFinalComEaseM: last,
      maiorTrancoRelativo: worstJump,
      handleAntes: before,
      handleDepois: after,
      deslocamentoNoFrame75M: moved,
      historico: session().getSnapshot().history.entries.slice(-2).map((entry) => entry.label),
    };
  })()`);
}

/** Critério 4: avião em caminho geodésico com banking em curva. */
async function verifyGeodesicBanking(client) {
  return client.evaluate(`(async()=>{
    const pathId = session().actions.createPath({
      name: 'Prova F5 · voo geodésico',
      space: 'geo',
      vertices: [
        { point: ${JSON.stringify(LISBON)}, inHandle: null, outHandle: null },
        { point: ${JSON.stringify(MOSCOW)}, inHandle: null, outHandle: null },
      ],
      interpolation: 'linear',
      geodesic: true,
    });
    if (pathId === null) throw new Error('createPath geodésico: ' + session().getSnapshot().error);

    session().actions.clearSelection();
    const planeId = session().actions.addNodeOfType('symbol.icon');
    if (planeId === null) throw new Error('não foi possível criar symbol.icon');
    session().actions.renameNode(planeId, 'Prova F5 · caça');
    const behaviorId = session().actions.assignMotionPath(planeId, pathId, { from: 0, to: 300 });
    if (behaviorId === null) throw new Error('assignMotionPath: ' + session().getSnapshot().error);

    const map = viewport().map;
    map.jumpTo({ center: [14, 48], zoom: 2.6, bearing: 0, pitch: 0 });
    await viewport().settle(6000);

    const params = () => nodeById(planeId).behaviors[0].params;
    const readRotations = async () => {
      const values = [];
      for (const frame of [30, 90, 150, 210, 270]) {
        const snapshot = await atFrame(frame);
        const node = (snapshot.nodes ?? []).find((entry) => entry.id === planeId);
        values.push({ frame, rotation: node.transform.rotation, lngLat: node.anchor.lngLat });
      }
      return values;
    };

    const semBanking = await readRotations();
    if (!session().actions.setBehaviorParams(planeId, behaviorId, { ...params(), banking: 2 })) {
      throw new Error('setBehaviorParams: ' + session().getSnapshot().error);
    }
    await wait(200);
    const comBanking = await readRotations();

    const bank = comBanking.map((entry, index) =>
      angleDelta(semBanking[index].rotation, entry.rotation),
    );
    const path = session().getSnapshot().document.paths[pathId];
    // A rota geodésica é mais curta que a reta em lng/lat: prova que não virou
    // uma linha de Mercator disfarçada.
    const straight = geodesic(${JSON.stringify(LISBON)}, ${JSON.stringify(MOSCOW)});
    const walked = comBanking
      .slice(1)
      .reduce((total, entry, index) => total + geodesic(comBanking[index].lngLat, entry.lngLat), 0);

    if (!path.geodesic) throw new Error('caminho não ficou marcado como geodésico');
    if (Math.max(...bank.map(Math.abs)) < 0.05) {
      throw new Error('banking não inclinou nada: ' + JSON.stringify(bank));
    }
    // Numa geodésica leste→nordeste o bearing decresce sem inverter, então a
    // inclinação mantém o mesmo lado o tempo inteiro.
    const signs = new Set(bank.filter((value) => Math.abs(value) > 1e-9).map((value) => Math.sign(value)));
    if (signs.size !== 1) throw new Error('inclinação trocou de lado sem curva nova');
    if (Math.max(...bank.map(Math.abs)) > 45) throw new Error('inclinação absurda');

    return {
      planeId,
      pathId,
      behaviorId,
      geodesico: path.geodesic,
      rotacoesSemBanking: semBanking.map((entry) => Number(entry.rotation.toFixed(2))),
      rotacoesComBanking: comBanking.map((entry) => Number(entry.rotation.toFixed(2))),
      inclinacaoGraus: bank.map((value) => Number(value.toFixed(3))),
      distanciaGeodesicaKm: Number((straight / 1000).toFixed(1)),
      percorridoEntreAmostrasKm: Number((walked / 1000).toFixed(1)),
    };
  })()`);
}

/** Critério 5: seguidor com damping idêntico avaliando frames fora de ordem. */
async function verifyFollowDeterminism(client, placement) {
  return client.evaluate(`(async()=>{
    const targetId = ${JSON.stringify(placement.tankId)};
    session().actions.clearSelection();
    const followerId = session().actions.addNodeOfType('unit.infantry');
    if (followerId === null) throw new Error('não foi possível criar unit.infantry');
    session().actions.renameNode(followerId, 'Prova F5 · escolta');
    const behaviorId = session().actions.addBehavior(followerId, 'follow', {
      targetId,
      offset: [0, 0],
      damping: 0.8,
      matchRotation: true,
      windowFrames: 14,
    });
    if (behaviorId === null) throw new Error('addBehavior follow: ' + session().getSnapshot().error);
    await wait(200);

    const read = async (frame) => {
      const snapshot = await atFrame(frame);
      const follower = (snapshot.nodes ?? []).find((entry) => entry.id === followerId);
      const target = (snapshot.nodes ?? []).find((entry) => entry.id === targetId);
      if (follower === undefined || target === undefined) throw new Error('nós ausentes');
      return {
        frame,
        follower: follower.anchor.lngLat,
        target: target.anchor.lngLat,
        atraso: geodesic(follower.anchor.lngLat, target.anchor.lngLat),
      };
    };

    const frames = [40, 220, 120, 20, 219, 121];
    const forward = [];
    for (const frame of frames) forward.push(await read(frame));
    const backward = [];
    for (const frame of [...frames].reverse()) backward.push(await read(frame));
    backward.reverse();

    const identical = forward.every((entry, index) =>
      entry.follower[0] === backward[index].follower[0] &&
      entry.follower[1] === backward[index].follower[1],
    );
    if (!identical) throw new Error('seguidor divergiu ao avaliar fora de ordem');
    const atrasos = forward.filter((entry) => entry.frame > 30).map((entry) => entry.atraso);
    if (Math.min(...atrasos) <= 0) throw new Error('damping não produziu atraso');

    return {
      followerId,
      behaviorId,
      framesAvaliados: frames,
      identicoForaDeOrdem: identical,
      atrasoMetros: atrasos.map((value) => Number(value.toFixed(1))),
      exemplo: forward[0],
    };
  })()`);
}

/** Critério 6: pré-composição aninhada renderizando e aceitando timeRemap. */
async function verifyPrecomp(client, baseline) {
  return client.evaluate(`(async()=>{
    const outerId = ${JSON.stringify(baseline.compositionId)};
    const state = session().getSnapshot();
    const outer = state.document.compositions.find((entry) => entry.id === outerId);
    if (outer === undefined) throw new Error('composição principal ausente');

    // Composição interna: clone da externa com ids próprios e um rótulo animado.
    const innerRootId = 'nd_f5_inner_root';
    const innerLabelId = 'nd_f5_inner_label';
    const innerId = 'cmp_f5_inner';
    const rootTemplate = outer.nodes[outer.root];
    const innerRoot = { ...structuredClone(rootTemplate), id: innerRootId, name: 'Cena interna', parent: null, children: [innerLabelId] };
    const innerLabel = {
      ...structuredClone(rootTemplate),
      id: innerLabelId,
      name: 'Rótulo interno',
      type: 'text.label',
      parent: innerRootId,
      children: [],
      anchor: { space: 'comp', position: [0, 0] },
    };
    innerLabel.transform.position = {
      value: [0, 0],
      keyframes: [
        { id: 'kf_f5_a', frame: 0, value: [0, 0], in: { kind: 'linear' }, out: { kind: 'linear' } },
        { id: 'kf_f5_b', frame: 100, value: [400, 0], in: { kind: 'linear' }, out: { kind: 'linear' } },
      ],
      expression: null,
    };
    const inner = {
      ...structuredClone(outer),
      id: innerId,
      name: 'Interna F5',
      duration: 100,
      // A área de trabalho não pode passar da duração — o schema recusa.
      workArea: [0, 100],
      root: innerRootId,
      nodes: { [innerRootId]: innerRoot, [innerLabelId]: innerLabel },
      markers: [],
    };
    if (!session().actions.dispatch({ type: 'composition.create', payload: { composition: inner }, source: 'user' })) {
      throw new Error('composition.create: ' + session().getSnapshot().error);
    }

    // Nó de pré-composição na composição principal apontando para a interna.
    session().actions.clearSelection();
    const precompId = session().actions.addNodeOfType('precomp');
    if (precompId === null) throw new Error('não foi possível criar precomp');
    session().actions.renameNode(precompId, 'Prova F5 · pré-composição');
    if (!session().actions.setPropertyValue(precompId, 'props.compositionId', innerId, false)) {
      throw new Error('não foi possível apontar a pré-composição: ' + session().getSnapshot().error);
    }
    await wait(250);

    const nestedId = precompId + '/' + innerLabelId;
    const positionAt = async (frame) => {
      const snapshot = await atFrame(frame);
      const node = (snapshot.nodes ?? []).find((entry) => entry.id === nestedId);
      if (node === undefined) throw new Error('nó aninhado ausente no frame ' + frame);
      return { bounds: node.bounds, visible: node.visible };
    };

    const inicio = await positionAt(0);
    const meio = await positionAt(50);
    const fim = await positionAt(100);
    const avancou = meio.bounds.x - inicio.bounds.x;
    if (!(avancou > 1)) throw new Error('conteúdo aninhado não animou: ' + avancou);
    if (!(fim.bounds.x > meio.bounds.x)) throw new Error('conteúdo aninhado parou no meio');

    // timeRemap congelando o tempo interno no frame 25. O campo nasce nulo, então
    // tem comando próprio: property.set exige wrapper animável já existente.
    if (
      !session().actions.setNodeTimeRemap(precompId, {
        value: 25,
        keyframes: [],
        expression: null,
      })
    ) {
      throw new Error('timeRemap: ' + session().getSnapshot().error);
    }
    await wait(250);
    const congeladoInicio = await positionAt(0);
    const congeladoFim = await positionAt(100);
    const deriva = Math.abs(congeladoFim.bounds.x - congeladoInicio.bounds.x);
    if (deriva > 0.5) throw new Error('timeRemap não congelou: deriva de ' + deriva + ' px');

    const esperado = inicio.bounds.x + (meio.bounds.x - inicio.bounds.x) / 2;
    const erroDoFrame = Math.abs(congeladoInicio.bounds.x - esperado);
    if (erroDoFrame > 2) throw new Error('frame congelado errado: erro de ' + erroDoFrame + ' px');

    return {
      precompId,
      innerId,
      nestedId,
      nosNaCena: (overlay().nodes ?? []).length,
      xNoFrame0: Number(inicio.bounds.x.toFixed(2)),
      xNoFrame50: Number(meio.bounds.x.toFixed(2)),
      xNoFrame100: Number(fim.bounds.x.toFixed(2)),
      visivel: inicio.visible,
      congeladoX: [
        Number(congeladoInicio.bounds.x.toFixed(2)),
        Number(congeladoFim.bounds.x.toFixed(2)),
      ],
      derivaCongeladaPx: Number(deriva.toFixed(3)),
      erroDoFrameCongeladoPx: Number(erroDoFrame.toFixed(3)),
    };
  })()`);
}

/** Parenting e objeto nulo: mover o pai leva o filho, sem tocar no filho. */
async function verifyParenting(client) {
  return client.evaluate(`(async()=>{
    session().actions.clearSelection();
    const nullId = session().actions.addNodeOfType('null');
    if (nullId === null) throw new Error('não foi possível criar objeto nulo');
    session().actions.renameNode(nullId, 'Prova F5 · nulo');
    session().actions.selectNode(session().getSnapshot().selectedCompositionId, nullId);
    const childId = session().actions.addNodeOfType('symbol.icon', nullId);
    if (childId === null) throw new Error('não foi possível parentear ao nulo');
    session().actions.renameNode(childId, 'Prova F5 · filho');
    await wait(200);

    const childBounds = async () => {
      const snapshot = await atFrame(session().getSnapshot().playheadFrame === 5 ? 6 : 5);
      const node = (snapshot.nodes ?? []).find((entry) => entry.id === childId);
      if (node === undefined) throw new Error('filho ausente na cena');
      return node.bounds;
    };

    const antes = await childBounds();
    const posicaoDoFilhoAntes = nodeById(childId).transform.position.value;
    if (!session().actions.setPropertyValue(nullId, 'transform.position', [160, -90], false)) {
      throw new Error('não foi possível mover o nulo: ' + session().getSnapshot().error);
    }
    await wait(200);
    const depois = await childBounds();
    const posicaoDoFilhoDepois = nodeById(childId).transform.position.value;

    const dx = depois.x - antes.x;
    const dy = depois.y - antes.y;
    if (Math.abs(dx - 160) > 1.5 || Math.abs(dy + 90) > 1.5) {
      throw new Error('filho não acompanhou o pai: ' + dx + ',' + dy);
    }
    if (posicaoDoFilhoAntes[0] !== posicaoDoFilhoDepois[0]) {
      throw new Error('a posição do filho foi alterada; parenting deve ser só herança');
    }

    return {
      nullId,
      childId,
      deslocamentoDoFilhoPx: [Number(dx.toFixed(2)), Number(dy.toFixed(2))],
      posicaoPropriaDoFilho: posicaoDoFilhoDepois,
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
    session().actions.clearSelection();
    session().actions.selectComposition(baseline.compositionId);
    session().actions.setPlayhead(baseline.playhead);
    viewport().map.jumpTo(baseline.camera);
    await viewport().settle(6000);

    const after = session().getSnapshot();
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
      );
    };
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
    return {
      desfeitos: undone,
      cursor: after.history.cursor,
      documentoIdenticoAoInicial: identical,
      caminhos: Object.keys(after.document.paths).length,
      composicoes: after.document.compositions.length,
    };
  })()`);
}

async function main() {
  const page = await pageTarget();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  let baseline;
  try {
    // A medição de playback e o rAF dependem de janela visível.
    await client.request("Page.bringToFront");
    await waitForRenderer(client);
    baseline = await captureBaseline(client);

    const uniform = await verifyUniformSpeed(client);
    const graph = await verifyGraphEditor(client, uniform);
    const banking = await verifyGeodesicBanking(client);
    const follow = await verifyFollowDeterminism(client, uniform);
    const precomp = await verifyPrecomp(client, baseline);
    const parenting = await verifyParenting(client);
    const cleanup = await restoreSession(client, baseline);

    console.log(
      JSON.stringify(
        {
          ok: true,
          criteria: {
            "1-caminho-velocidade-uniforme": uniform,
            "2-ease-parte-e-freia": {
              passoInicialLinearM: graph.passoInicialLinearM,
              passoInicialComEaseM: graph.passoInicialComEaseM,
              passoDoMeioM: graph.passoDoMeioM,
              passoFinalComEaseM: graph.passoFinalComEaseM,
              maiorTrancoRelativo: graph.maiorTrancoRelativo,
              easingDepois: graph.easingDepois,
            },
            "3-graph-editor-handle": {
              trilhaNoSeletor: graph.trilhaNoSeletor,
              handleAntes: graph.handleAntes,
              handleDepois: graph.handleDepois,
              deslocamentoNoFrame75M: graph.deslocamentoNoFrame75M,
              historico: graph.historico,
            },
            "4-voo-geodesico-com-banking": banking,
            "5-follow-deterministico": follow,
            "6-precomp-com-timeremap": precomp,
            "parenting-e-objeto-nulo": parenting,
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
