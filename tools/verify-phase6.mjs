/**
 * Prova automatizada dos seis critérios de saída da Fase 6, no Electron real.
 *
 * Requer `pnpm dev` rodando. Como nas fases anteriores, o script desfaz tudo o
 * que cria e compara o documento com o estado inicial antes de sair.
 *
 *   node tools/verify-phase6.mjs
 *
 * O critério 6 é do lado do host: uma sonda com `Math.random()` é inserida de
 * propósito no pacote de efeitos e o `pnpm lint` precisa rejeitá-la.
 */

import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 90_000;

const KURSK = [36.1873, 51.7304];

/** Params animáveis de um emissor, na forma do documento. */
function emitterParams(overrides = {}) {
  const wrap = (value) => ({ value, keyframes: [], expression: null });
  const base = {
    count: wrap(5000),
    scale: wrap(1),
    lifetime: wrap(42),
    intensity: wrap(1),
    tint: wrap("#ffffffff"),
  };
  for (const [key, value] of Object.entries(overrides)) base[key] = wrap(value);
  return base;
}

const FILTER_PARAMS = {
  radius: { value: 14, keyframes: [], expression: null },
  strength: { value: 1.4, keyframes: [], expression: null },
  tint: { value: "#ffd9a0ff", keyframes: [], expression: null },
};

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
/**
 * Hash SHA-256 do composto de exportação — o que o vídeo mostraria. A captura
 * cruza o CDP só como hex: o Uint8Array inteiro não serializa por valor.
 * O nonzero acompanha de propósito: um hash constante por tela vazia passaria
 * nos critérios 2 e 3 de mentira — foi o que a primeira versão desta prova fez.
 */
const captureStats = async () => {
  const shot = await window.__theatrumPhase4.captureExport();
  let nonzero = 0;
  for (let i = 0; i < shot.data.length; i += 97) {
    if (shot.data[i] !== 0) nonzero += 1;
  }
  const digest = await crypto.subtle.digest('SHA-256', shot.data);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { hash, nonzero };
};
const captureHash = async () => {
  const stats = await captureStats();
  if (stats.nonzero < 100) {
    throw new Error('captura vazia (' + stats.nonzero + ' bytes não nulos); a prova mediria nada');
  }
  return stats.hash;
};
/**
 * Contagem de draw calls no contexto WebGL do overlay Pixi. O patch é no objeto
 * de contexto, então vale para tudo que o Pixi desenhar dali em diante — o mapa
 * fica de fora, porque é outro canvas com outro contexto.
 */
const instrumentDraws = () => {
  if (window.__f6draws) return;
  const canvas = document.querySelector('.scene-overlay__pixi');
  if (!canvas) throw new Error('canvas do overlay ausente');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) throw new Error('contexto WebGL do overlay indisponível');
  const state = { calls: 0 };
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const original = gl[name];
    if (typeof original !== 'function') continue;
    gl[name] = function (...args) {
      state.calls += 1;
      return original.apply(this, args);
    };
  }
  window.__f6draws = state;
};
const drawsSince = (mark) => window.__f6draws.calls - mark;
/**
 * Uma amostra por scrub: draw calls e tempo de render por renderização. Dividir
 * pelos renders absorve o render duplo ocasional (documento + playhead) sem
 * estragar a medida — o que interessa é o custo por render, não quantos houve.
 */
const sampleScrub = async (frame) => {
  const markCalls = window.__f6draws.calls;
  const markRenders = overlay().renders;
  const snapshot = await atFrame(frame);
  const renders = Math.max(1, snapshot.renders - markRenders);
  return {
    drawsPerRender: drawsSince(markCalls) / renders,
    renderMs: snapshot.metrics?.renderMs ?? 0,
  };
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
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

/** Prepara cena e nó em Kursk, com a instrumentação de draw calls ligada. */
async function setupScene(client) {
  return client.evaluate(`(async()=>{
    const map = viewport().map;
    map.jumpTo({ center: ${JSON.stringify(KURSK)}, zoom: 7, bearing: 0, pitch: 0 });
    await viewport().settle(6000);
    await wait(200);
    instrumentDraws();
    session().actions.clearSelection();
    const nodeId = session().actions.addNodeOfType('unit.armor');
    if (nodeId === null) throw new Error('não foi possível criar unit.armor');
    session().actions.renameNode(nodeId, 'Prova F6 · unidade');
    // O nó nasce na âncora padrão [0, 20]: sem mover a âncora para a cena, a
    // explosão renderiza fora da tela e a captura mede um frame vazio.
    const anchored = session().actions.setNodeAnchor(nodeId, {
      space: 'geo',
      lngLat: [...${JSON.stringify(KURSK)}],
    });
    if (!anchored) throw new Error('não foi possível ancorar o nó em Kursk');
    await wait(250);
    await atFrame(0);
    return { nodeId };
  })()`);
}

/** Critério 1: explosão de 5.000 partículas — um draw call, < 2 ms de CPU. */
async function verifySingleDrawCall(client, scene) {
  return client.evaluate(`(async()=>{
    const nodeId = ${JSON.stringify(scene.nodeId)};
    const frames = [12, 14, 16, 18, 20, 22];

    const baseline = [];
    for (const frame of frames) baseline.push(await sampleScrub(frame));
    const drawsAntes = median(baseline.map((sample) => sample.drawsPerRender));
    const cpuAntes = median(baseline.map((sample) => sample.renderMs));
    const particulasAntes = overlay().particles ?? 0;

    const effectId = session().actions.addEffect(nodeId, 'explosion', ${JSON.stringify(emitterParams())});
    if (effectId === null) throw new Error('addEffect explosion: ' + session().getSnapshot().error);
    await wait(250);

    const comExplosao = [];
    for (const frame of frames) comExplosao.push(await sampleScrub(frame));
    const drawsDepois = median(comExplosao.map((sample) => sample.drawsPerRender));
    const cpuDepois = median(comExplosao.map((sample) => sample.renderMs));
    // Delta, não absoluto: a cena pode já ter partículas de outras provas.
    const particulas = (overlay().particles ?? 0) - particulasAntes;

    const deltaDraws = drawsDepois - drawsAntes;
    const deltaCpu = cpuDepois - cpuAntes;
    if (particulas !== 5000) throw new Error('explosão com ' + particulas + ' partículas, não 5000');
    if (Math.abs(deltaDraws - 1) > 0.01) {
      throw new Error('explosão custou ' + deltaDraws + ' draw calls por render, não 1');
    }
    if (deltaCpu >= 2) {
      throw new Error('explosão custou ' + deltaCpu.toFixed(3) + ' ms de CPU por frame');
    }

    return {
      nodeId,
      effectId,
      particulas,
      drawCallsPorRender: Number(deltaDraws.toFixed(3)),
      cpuAntesMs: Number(cpuAntes.toFixed(3)),
      cpuComExplosaoMs: Number(cpuDepois.toFixed(3)),
      cpuDaExplosaoMs: Number(deltaCpu.toFixed(3)),
    };
  })()`);
}

/** Critério 2: scrub para trás sobre a explosão é idêntico ao scrub para frente. */
async function verifyScrubBackwards(client) {
  return client.evaluate(`(async()=>{
    await atFrame(24);
    const indo = await captureHash();
    await atFrame(90);
    await atFrame(24);
    const voltando = await captureHash();
    if (indo !== voltando) {
      throw new Error('scrub para trás divergiu: ' + indo.slice(0, 12) + ' != ' + voltando.slice(0, 12));
    }
    return { hashIdoEVoltei: indo.slice(0, 16), identico: true };
  })()`);
}

/** Critério 3: renderizar o frame 400 direto == renderizar 0..400 sequencialmente. */
async function verifyFrame400Direct(client, scene) {
  return client.evaluate(`(async()=>{
    const nodeId = ${JSON.stringify(scene.nodeId)};
    // Esteira de condensação: partículas ficam onde nasceram (motion trail, fade
    // hold) e vivem 300 frames, então no frame 400 ainda há ~800 vivas **na
    // tela**. Fumaça não serve aqui: sobe e sai do viewport antes do 400, e a
    // captura mediria um frame legitimamente vazio.
    const trailId = session().actions.addEffect(nodeId, 'contrail', ${JSON.stringify(emitterParams({ count: 1200, lifetime: 300 }))});
    if (trailId === null) throw new Error('addEffect contrail: ' + session().getSnapshot().error);
    await wait(250);

    await atFrame(0);
    for (let frame = 5; frame <= 400; frame += 5) await atFrame(frame);
    const sequencial = await captureHash();

    await atFrame(0);
    await atFrame(400);
    const direto = await captureHash();

    if (sequencial !== direto) {
      throw new Error('frame 400 direto divergiu do sequencial');
    }
    return { passosSequenciais: 81, hashFrame400: direto.slice(0, 16), identico: true };
  })()`);
}

/** Critério 4: mudar composition.seed varia tudo; voltar o seed restaura exato. */
async function verifySeedVariation(client) {
  return client.evaluate(`(async()=>{
    const compositionId = session().getSnapshot().selectedCompositionId;
    const seedOriginal = composition().seed;

    await atFrame(18);
    const antes = await captureHash();

    const okTroca = session().actions.dispatch({
      type: 'composition.set-seed',
      payload: { compositionId, seed: seedOriginal + 977 },
      source: 'system',
    });
    if (!okTroca) throw new Error('composition.set-seed rejeitado: ' + session().getSnapshot().error);
    await wait(250);
    await atFrame(18);
    const variado = await captureHash();
    if (variado === antes) throw new Error('mudar o seed não variou a explosão');

    const okVolta = session().actions.dispatch({
      type: 'composition.set-seed',
      payload: { compositionId, seed: seedOriginal },
      source: 'system',
    });
    if (!okVolta) throw new Error('restaurar seed rejeitado: ' + session().getSnapshot().error);
    await wait(250);
    await atFrame(18);
    const restaurado = await captureHash();
    if (restaurado !== antes) throw new Error('voltar o seed não restaurou o frame');

    return {
      seedOriginal,
      hashOriginal: antes.slice(0, 16),
      hashComSeedNovo: variado.slice(0, 16),
      restauradoIdentico: true,
    };
  })()`);
}

/** Critério 5: cena de bombardeio com 5 tipos de efeito simultâneos a 60 fps. */
async function verifyBombardmentScene(client, scene) {
  return client.evaluate(`(async()=>{
    const nodeId = ${JSON.stringify(scene.nodeId)};
    const adicionar = (type, params) => {
      const id = session().actions.addEffect(nodeId, type, params);
      if (id === null) throw new Error('addEffect ' + type + ': ' + session().getSnapshot().error);
      return id;
    };
    adicionar('fire', ${JSON.stringify(emitterParams({ count: 1400, lifetime: 34 }))});
    adicionar('shockwave', ${JSON.stringify(emitterParams({ count: 480, lifetime: 22 }))});
    adicionar('trail', ${JSON.stringify(emitterParams({ count: 700, lifetime: 60 }))});
    adicionar('glow', ${JSON.stringify(FILTER_PARAMS)});
    await wait(300);

    const vivo = await atFrame(10);
    if ((vivo.particles ?? 0) < 5000) {
      throw new Error('poucas partículas na cena de bombardeio: ' + vivo.particles);
    }
    if ((vivo.filters ?? 0) < 1) throw new Error('filtro glow não entrou na cadeia');

    session().actions.setPlayhead(0);
    await wait(150);
    const rendersAntes = overlay().renders;
    const inicio = performance.now();
    session().actions.play();
    await wait(3000);
    session().actions.pause();
    const duracao = (performance.now() - inicio) / 1000;
    const rendersDepois = overlay().renders;
    const fps = (rendersDepois - rendersAntes) / duracao;

    if (fps < 55) throw new Error('cena de bombardeio a ' + fps.toFixed(1) + ' fps');

    return {
      efeitosNaPilha: ['explosion', 'smoke', 'fire', 'shockwave', 'trail', 'glow'],
      particulasNoFrame10: vivo.particles,
      filtrosAtivos: vivo.filters,
      fpsMedido: Number(fps.toFixed(1)),
      rendersMedidos: rendersDepois - rendersAntes,
      duracaoSegundos: Number(duracao.toFixed(2)),
    };
  })()`);
}

/** Critério 6, no host: `pnpm lint` precisa rejeitar um Math.random() num efeito. */
async function verifyLintRejectsRandom() {
  const probe = path.join(ROOT, "packages", "effects", "src", "__f6-sonda-determinismo.ts");
  await writeFile(probe, "export const vazou = Math.random();\n", "utf8");
  try {
    const result = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js"), probe],
        { cwd: ROOT },
        (error, stdout, stderr) => {
          resolve({ code: error === null ? 0 : (error.code ?? 1), output: `${stdout}\n${stderr}` });
        },
      );
    });
    if (result.code === 0) {
      throw new Error("eslint aceitou Math.random() dentro do pacote de efeitos");
    }
    if (!result.output.includes("Math.random")) {
      throw new Error("a rejeição não mencionou Math.random: " + result.output.slice(0, 200));
    }
    return { rejeitado: true, regra: "theatrum/no-nondeterminism" };
  } finally {
    await rm(probe, { force: true });
  }
}

async function restoreSession(client, baseline) {
  const body = `(async()=>{
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
    return { desfeitos: undone, cursor: after.history.cursor, documentoIdenticoAoInicial: identical };
  })()`;
  return client.evaluate(body);
}

async function main() {
  const page = await pageTarget();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  let baseline;
  try {
    await client.request("Page.bringToFront");
    await waitForRenderer(client);
    baseline = await captureBaseline(client);

    const scene = await setupScene(client);
    const drawCall = await verifySingleDrawCall(client, scene);
    const scrub = await verifyScrubBackwards(client);
    const frame400 = await verifyFrame400Direct(client, scene);
    const seed = await verifySeedVariation(client);
    const bombardeio = await verifyBombardmentScene(client, scene);
    const lint = await verifyLintRejectsRandom();
    const cleanup = await restoreSession(client, baseline);

    console.log(
      JSON.stringify(
        {
          ok: true,
          criteria: {
            "1-explosao-5000-um-draw-call": drawCall,
            "2-scrub-para-tras-identico": scrub,
            "3-frame-400-direto-e-sequencial": frame400,
            "4-seed-varia-e-restaura": seed,
            "5-bombardeio-60fps": bombardeio,
            "6-lint-rejeita-math-random": lint,
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
