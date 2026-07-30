/**
 * Prova do export para arquivo de VIDEO (MP4 H.264), no Electron real.
 * Requer `pnpm dev` rodando.
 *
 *   node tools/verify-phase8-video.mjs
 *
 * 1. O arquivo sai, com tamanho plausivel, e comeca com a assinatura de um MP4.
 * 2. A estrutura e um MP4 fragmentado de verdade: ftyp, moov com mvex, e pares
 *    moof+mdat depois — e o avcC esta no lugar, senao o player mostra tela verde.
 * 3. Exportar duas vezes produz o MESMO arquivo, byte a byte. E o criterio 2 da
 *    Fase 8 aplicado ao caminho de codec, que e onde ele e mais facil de perder:
 *    um codificador em modo realtime decide por tempo de parede.
 * 4. O video DECODIFICA: o proprio Chromium abre o arquivo, entrega um frame e
 *    permite ler seus pixels. Estrutura correta que nao decodifica nao serve.
 * 5. O caminho separado do WebCodecs recebe SS2, reduz o render 4K e mantém a
 *    saída final em 1920×1080, com settle completo nas duas execuções.
 * 6. O mesmo caminho recebe motion blur: duas execuções repetem o MP4, os 24
 *    pontos médios aparecem no diagnóstico e três instantes decodificados são
 *    temporalmente distintos, além de diferirem do instante sem blur.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 240_000;

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

  constructor(url) {
    this.#socket = new WebSocket(url);
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
      throw new Error(
        `renderer: ${
          response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
        }`,
      );
    }
    return response.result.value;
  }

  close() {
    this.#socket.close();
  }
}

/**
 * Pasta de saída da prova, no temporário do sistema.
 *
 * Barra normal mesmo no Windows: o caminho é embutido numa string que atravessa
 * para o renderer, e barra invertida em template é comida em silêncio — já virou
 * `C:UsersalexmOneDrive` sem erro nenhum nesta base de código.
 */
const SAIDA_A = join(tmpdir(), "theatrum-verify-video-a").replaceAll("\\", "/");
const SAIDA_B = join(tmpdir(), "theatrum-verify-video-b").replaceAll("\\", "/");
const MOTION_RUN = `${process.pid}-${Date.now()}`;
const SAIDA_MOTION_A = join(tmpdir(), `theatrum-verify-video-motion-a-${MOTION_RUN}`).replaceAll(
  "\\",
  "/",
);
const SAIDA_MOTION_B = join(tmpdir(), `theatrum-verify-video-motion-b-${MOTION_RUN}`).replaceAll(
  "\\",
  "/",
);

const PRELUDE = `
const session = () => window.__theatrumPhase3;
const overlay = () => window.__theatrumPhase4;
const mapa = () => window.__theatrumPhase2.map;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
};

/** Compõe o frame atual e devolve estatística por superfície. */
const medirComposicao = () => {
  const nomes = ['.maplibregl-canvas', '.scene-overlay__studio', '.scene-overlay__pixi'];
  const info = nomes.map((sel) => {
    const c = document.querySelector(sel);
    if (c === null) return { sel, presente: false };
    const s = document.createElement('canvas');
    s.width = 32; s.height = 32;
    const ctx = s.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(c, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    let soma = 0, opacos = 0;
    for (let i = 0; i < px.length; i += 4) {
      soma += px[i] + px[i + 1] + px[i + 2];
      if (px[i + 3] > 200) opacos += 1;
    }
    return { sel, presente: true, tamanho: c.width + 'x' + c.height, soma, opacos };
  });
  return info;
};
`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASSA" : "FALHA"}  ${name}\n        ${detail}`);
}

/** Cena com animação visível, para os frames não serem todos iguais. */
const MONTAR_CENA = `(async () => {
  const S = session();
  S.actions.pause();
  const history = S.commandBus.history;
  if (history.entries().length !== 0 || history.cursor() !== -1) {
    throw new Error('verificador exige histórico vazio para não apagar trabalho preexistente');
  }
  await wait(300);
  mapa().jumpTo({ center: [35.6, 50.2], zoom: 6, pitch: 0, bearing: 0 });
  await window.__theatrumPhase2.settle(4000);

  const ucr = S.actions.addGeoFeature({ id: 'c:UKR', name: 'Ucrania', kind: 'country' }, [31.2, 48.4]);
  if (ucr) S.actions.setPropertyValue(ucr, 'props.fillAlpha', 0.5);
  const rot = S.actions.addNodeOfType('text.label');
  S.actions.setNodeAnchor(rot, { space: 'geo', lngLat: [36.23, 49.99] });
  S.actions.setPropertyValue(rot, 'props.text', 'KHARKIV');
  S.actions.setPropertyValue(rot, 'props.fontSize', 40);
  const circle = S.actions.addNodeOfType('shape.circle');
  if (!circle) throw new Error('shape.circle da prova de vídeo falhou');
  S.actions.setNodeAnchor(circle, { space: 'comp', position: [400, 540] });
  S.actions.setPropertyValue(circle, 'props.radius', 64);
  S.actions.setPropertyValue(circle, 'props.fill', '#ff3b30ff');
  S.actions.setPropertyValue(circle, 'props.strokeWidth', 0);
  S.actions.setPlayhead(0);
  // O rótulo fica deliberadamente estático: qualquer diferença temporal
  // decodificada precisa sobreviver sem depender da opacidade dele.
  S.actions.setPropertyValue(rot, 'transform.opacity', 1);
  S.actions.setPropertyValue(circle, 'transform.position', [0, 0]);
  S.actions.togglePropertyKeyframe(circle, 'transform.position');
  S.actions.setPlayhead(11);
  S.actions.setPropertyValue(circle, 'transform.position', [1120, 0]);
  S.actions.setPlayhead(0);
  S.actions.clearSelection();
  await window.__theatrumPhase2.settle(3000);
  await wait(600);
  const snapshot = S.getSnapshot();
  const composition = snapshot.document.compositions.find(
    (entry) => entry.id === snapshot.selectedCompositionId,
  );
  const circleNode = composition?.nodes[circle];
  const labelNode = composition?.nodes[rot];
  return {
    rot,
    ucr,
    circle,
    durationFrames: composition?.duration ?? null,
    circleFixture: circleNode === undefined ? null : {
      type: circleNode.type,
      anchor: circleNode.anchor,
      radius: circleNode.props?.radius?.value ?? null,
      fill: circleNode.props?.fill?.value ?? null,
      strokeWidth: circleNode.props?.strokeWidth?.value ?? null,
      positionValue: circleNode.transform.position.value,
      positionKeyframes: circleNode.transform.position.keyframes.map((keyframe) => ({
        frame: keyframe.frame,
        value: keyframe.value,
      })),
    },
    labelOpacityKeyframes: labelNode?.transform.opacity.keyframes.length ?? null,
  };
})()`;

const exportarVideo = (directory) => `(async () => {
  const r = await overlay().exportPngSequence({
    format: 'mp4',
    range: { first: 0, last: 11 },
    supersampling: 2,
    directory: ${JSON.stringify(directory)},
  });
  return {
    ok: r.ok,
    message: r.message ?? null,
    videoFile: r.videoFile ?? null,
    videoBytes: r.videoBytes ?? 0,
    written: r.report ? r.report.written : 0,
    settleFailed: r.report ? r.report.settleFailed : -1,
    errors: r.report ? r.report.errors : [],
    resolution: r.resolution ?? null,
    boxReducedFrames: r.boxReducedFrames ?? -1,
  };
})()`;

const exportarVideoComMotion = (directory) => `(async () => {
  const r = await overlay().exportPngSequence({
    format: 'mp4',
    range: { first: 0, last: 11 },
    supersampling: 2,
    motionBlur: { shutterAngle: 180, samples: 2 },
    directory: ${JSON.stringify(directory)},
  });
  return {
    ok: r.ok,
    message: r.message ?? null,
    videoFile: r.videoFile ?? null,
    videoBytes: r.videoBytes ?? 0,
    written: r.report ? r.report.written : 0,
    settleFailed: r.report ? r.report.settleFailed : -1,
    settleFailedOutputFrames: r.report ? r.report.settleFailedOutputFrames : -1,
    errors: r.report ? r.report.errors : [],
    motionBlur: r.report ? r.report.motionBlur : null,
    resolution: r.resolution ?? null,
    boxReducedFrames: r.boxReducedFrames ?? -1,
  };
})()`;

/**
 * Inicia sem aguardar para o Node observar o backing store enquanto o override do
 * job está ativo. Só olhar o plano provaria intenção, não que Map/Pixi chegaram a
 * 3840×2160 no caminho separado do WebCodecs.
 */
const iniciarVideoComSonda = (directory) => `(() => {
  const slot = { done: false, result: null, error: null };
  window.__theatrumPhase8VideoExport = slot;
  overlay().exportPngSequence({
    format: 'mp4',
    range: { first: 0, last: 11 },
    supersampling: 2,
    directory: ${JSON.stringify(directory)},
  }).then((r) => {
    slot.result = {
      ok: r.ok,
      message: r.message ?? null,
      videoFile: r.videoFile ?? null,
      videoBytes: r.videoBytes ?? 0,
      written: r.report ? r.report.written : 0,
      settleFailed: r.report ? r.report.settleFailed : -1,
      errors: r.report ? r.report.errors : [],
      resolution: r.resolution ?? null,
      boxReducedFrames: r.boxReducedFrames ?? -1,
    };
    slot.done = true;
  }, (error) => {
    slot.error = error instanceof Error ? error.message : String(error);
    slot.done = true;
  });
  return true;
})()`;

async function exportarVideoMedindoRender(client, directory) {
  await client.evaluate(iniciarVideoComSonda(directory));
  const deadline = Date.now() + 60_000;
  let observedRender = null;
  for (;;) {
    const state = await client.evaluate(`(() => {
      const slot = window.__theatrumPhase8VideoExport;
      const surfaces = ['.maplibregl-canvas', '.scene-overlay__pixi'].map((selector) => {
        const canvas = document.querySelector(selector);
        return {
          selector,
          width: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
          height: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
        };
      });
      return {
        done: slot?.done === true,
        result: slot?.result ?? null,
        error: slot?.error ?? null,
        surfaces,
      };
    })()`);
    if (
      state.surfaces.length === 2 &&
      state.surfaces.every((surface) => surface.width === 3840 && surface.height === 2160)
    ) {
      observedRender = state.surfaces;
    }
    if (state.done) {
      if (state.error !== null) throw new Error(`export MP4 falhou: ${state.error}`);
      if (state.result === null) throw new Error("export MP4 terminou sem resultado");
      return { result: state.result, observedRender };
    }
    if (Date.now() > deadline) throw new Error("timeout observando o render 4K do MP4");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Caixas de topo de um MP4, para conferir a estrutura sem depender de player. */
function topBoxes(bytes) {
  const out = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    const size = bytes.readUInt32BE(at);
    if (size < 8 || at + size > bytes.length) break;
    out.push({ type: bytes.toString("ascii", at + 4, at + 8), size, at });
    at += size;
  }
  return out;
}

/**
 * Decodifica os mesmos instantes de dois MP4 no próprio Chromium.
 *
 * Além do delta blur × instante, compara todos os pares do vídeo com blur. Assim
 * um único frame decodificável repetido do começo ao fim não passa como vídeo
 * temporalmente correto.
 */
async function inspectDecodedVideoFrames(client, instantBytes, blurBytes, timeSeconds) {
  const instantBase64 = instantBytes.toString("base64");
  const blurBase64 = blurBytes.toString("base64");
  return client.evaluate(`(async () => {
    const makeVideo = async (encoded) => {
      const raw = atob(encoded);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = url;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout loadeddata')), 10000);
        video.addEventListener('loadeddata', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        video.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('player recusou MP4'));
        }, { once: true });
      });
      return { video, url };
    };
    const seek = async (video, time) => {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout seeked')), 10000);
        video.addEventListener('seeked', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        video.currentTime = Math.min(time, Math.max(0, video.duration - 0.001));
      });
    };
    const [instant, blur] = await Promise.all([
      makeVideo(${JSON.stringify(instantBase64)}),
      makeVideo(${JSON.stringify(blurBase64)}),
    ]);
    try {
      const width = 480;
      const height = 270;
      const render = (video) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(video, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
      };
      const difference = (a, b) => {
        let differentPixels = 0;
        let absoluteDelta = 0;
        for (let offset = 0; offset < a.length; offset += 4) {
          const delta =
            Math.abs(a[offset] - b[offset]) +
            Math.abs(a[offset + 1] - b[offset + 1]) +
            Math.abs(a[offset + 2] - b[offset + 2]);
          absoluteDelta += delta;
          if (delta > 12) differentPixels += 1;
        }
        return { differentPixels, absoluteDelta };
      };
      const signature = (pixels) => {
        let hash = 2166136261;
        for (let offset = 0; offset < pixels.length; offset += 1) {
          hash = Math.imul(hash ^ pixels[offset], 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
      };
      const requestedTimes = ${JSON.stringify(timeSeconds)};
      const instantFrames = [];
      const motionFrames = [];
      const decodedTimes = [];
      for (const requestedTime of requestedTimes) {
        await Promise.all([
          seek(instant.video, requestedTime),
          seek(blur.video, requestedTime),
        ]);
        instantFrames.push(render(instant.video));
        motionFrames.push(render(blur.video));
        decodedTimes.push({
          requested: requestedTime,
          instant: instant.video.currentTime,
          motion: blur.video.currentTime,
        });
      }
      const blurVsInstant = motionFrames.map((frame, index) => ({
        index,
        ...difference(instantFrames[index], frame),
      }));
      const motionTemporalPairs = [];
      for (let left = 0; left < motionFrames.length; left += 1) {
        for (let right = left + 1; right < motionFrames.length; right += 1) {
          motionTemporalPairs.push({
            left,
            right,
            ...difference(motionFrames[left], motionFrames[right]),
          });
        }
      }
      return {
        decodedTimes,
        blurVsInstant,
        motionTemporalPairs,
        motionSignatures: motionFrames.map(signature),
        instantSize: [instant.video.videoWidth, instant.video.videoHeight],
        blurSize: [blur.video.videoWidth, blur.video.videoHeight],
      };
    } finally {
      for (const entry of [instant, blur]) {
        entry.video.removeAttribute('src');
        entry.video.load();
        URL.revokeObjectURL(entry.url);
      }
    }
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

function sameVec2(value, x, y) {
  return Array.isArray(value) && value.length === 2 && value[0] === x && value[1] === y;
}

/**
 * Confere a fonte conhecida de movimento antes de atribuir qualquer delta ao
 * motion blur. O rótulo não tem keyframes; o círculo vermelho tem exatamente a
 * trilha 0 → 11 que a prova espera.
 */
function movingFixtureIsValid(fixture) {
  const circle = fixture?.circleFixture;
  const keyframes = circle?.positionKeyframes;
  return (
    Number.isInteger(fixture?.durationFrames) &&
    fixture.durationFrames >= 12 &&
    circle?.type === "shape.circle" &&
    circle.anchor?.space === "comp" &&
    sameVec2(circle.anchor?.position, 400, 540) &&
    circle.radius === 64 &&
    circle.fill === "#ff3b30ff" &&
    circle.strokeWidth === 0 &&
    sameVec2(circle.positionValue, 0, 0) &&
    Array.isArray(keyframes) &&
    keyframes.length === 2 &&
    keyframes[0]?.frame === 0 &&
    sameVec2(keyframes[0]?.value, 0, 0) &&
    keyframes[1]?.frame === 11 &&
    sameVec2(keyframes[1]?.value, 1120, 0) &&
    fixture.labelOpacityKeyframes === 0
  );
}

/**
 * Referência independente para 180° × 2: meia exposição, dois estratos e seus
 * pontos médios. A borda é a composição, não o trecho exportado.
 */
function expectedMotionSamples(durationFrames) {
  const exposureFrames = 180 / 360;
  const samples = 2;
  const lastCompositionFrame = durationFrames - 1;
  return Array.from({ length: 12 }, (_, outputFrame) =>
    Array.from({ length: samples }, (_unused, sampleIndex) => {
      const firstEdge = outputFrame - exposureFrames / 2;
      const midpoint = firstEdge + (exposureFrames * (sampleIndex + 0.5)) / samples;
      return {
        outputFrame,
        sampleIndex,
        frame: Math.max(0, Math.min(lastCompositionFrame, midpoint)),
      };
    }),
  ).flat();
}

async function main() {
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await activateViewportTab(client);

  const baselineState = await client.evaluate(
    `(async () => {
      const S = session();
      S.actions.pause();
      S.actions.clearSelection();
      await wait(120);
      return {
        document: JSON.stringify(canonical(S.getSnapshot().document)),
        historyEntries: S.commandBus.history.entries().length,
        historyCursor: S.commandBus.history.cursor(),
      };
    })()`,
  );
  if (baselineState.historyEntries !== 0 || baselineState.historyCursor !== -1) {
    client.close();
    throw new Error(
      "verify:phase8-video recusou uma sessão com histórico: salve/recarregue o projeto antes " +
        "de rodar a prova; nenhum comando do documento foi executado.",
    );
  }
  const baseline = baselineState.document;

  try {
    const fixture = await client.evaluate(MONTAR_CENA);
    const primeiraMedida = await exportarVideoMedindoRender(client, SAIDA_A);
    const primeira = primeiraMedida.result;

    // ── 1. O arquivo existe e é um MP4 ──────────────────────────────────────
    if (primeira.videoFile === null) {
      record(
        "1 · o arquivo de vídeo sai do export",
        false,
        `sem arquivo: ${primeira.message ?? primeira.errors.join("; ")}`,
      );
    } else {
      const caminho = join(SAIDA_A, primeira.videoFile);
      const bytes = readFileSync(caminho);
      // Um MP4 começa com o tamanho do `ftyp` e depois "ftyp" em ASCII.
      const assinatura = bytes.toString("ascii", 4, 8);
      record(
        "1 · o arquivo de vídeo sai do export",
        primeira.ok &&
          primeira.written === 12 &&
          primeira.settleFailed === 0 &&
          primeira.errors.length === 0 &&
          assinatura === "ftyp" &&
          bytes.length > 1000,
        `${primeira.videoFile}: ${(bytes.length / 1024).toFixed(0)} kB, ` +
          `${primeira.written} frames, assinatura "${assinatura}"`,
      );

      // ── 2. Estrutura de fMP4 ──────────────────────────────────────────────
      const tipos = topBoxes(bytes).map((c) => c.type);
      const temMvex = bytes.includes(Buffer.from("mvex", "ascii"));
      const temAvcC = bytes.includes(Buffer.from("avcC", "ascii"));
      const fragmentos = tipos.filter((t) => t === "moof").length;
      record(
        "2 · é um MP4 fragmentado, com avcC no lugar",
        tipos[0] === "ftyp" &&
          tipos.includes("moov") &&
          fragmentos >= 1 &&
          tipos.includes("mdat") &&
          temMvex &&
          temAvcC,
        `caixas de topo: ${tipos.join(" ")}; ${fragmentos} fragmento(s); ` +
          `mvex ${temMvex ? "presente" : "AUSENTE"}, avcC ${temAvcC ? "presente" : "AUSENTE"}`,
      );

      // ── 3. Duas execuções, arquivo idêntico ───────────────────────────────
      //
      // É o critério 2 da Fase 8 aplicado ao codec, que é onde ele é mais fácil
      // de perder: um codificador em `latencyMode: "realtime"` decide o que
      // descartar pelo relógio de parede, e dois exports divergem.
      const hashA = createHash("sha256").update(bytes).digest("hex");
      const segunda = await client.evaluate(exportarVideo(SAIDA_B));
      const bytesB =
        segunda.videoFile === null ? null : readFileSync(join(SAIDA_B, segunda.videoFile));
      const hashB = bytesB === null ? null : createHash("sha256").update(bytesB).digest("hex");
      record(
        "3 · exportar duas vezes dá o mesmo arquivo de vídeo",
        segunda.ok &&
          segunda.written === 12 &&
          segunda.settleFailed === 0 &&
          segunda.errors.length === 0 &&
          bytesB !== null &&
          hashA === hashB &&
          bytes.length === bytesB.length,
        `${(bytes.length / 1024).toFixed(0)} kB e ${
          bytesB === null ? "?" : (bytesB.length / 1024).toFixed(0)
        } kB; ` +
          `sha ${hashA.slice(0, 12)} e ${hashB?.slice(0, 12) ?? "ausente"} — ` +
          (hashA === hashB ? "IDÊNTICOS" : "DIVERGEM"),
      );

      // ── 4. O vídeo decodifica um frame de verdade ─────────────────────────
      //
      // Estrutura correta que não decodifica não serve de nada. Quem responde é
      // o próprio Chromium: os bytes entram por data URL num `<video>` e ele
      // reporta o que encontrou. Injetar daqui em vez de servir por protocolo
      // porque o temporário do sistema está fora das raízes autorizadas — e
      // afrouxar essa guarda para rodar um teste seria trocar segurança por
      // conveniência.
      const base64 = bytes.toString("base64");
      const decodificado = await client.evaluate(
        `(async () => {
          const v = document.createElement('video');
          v.muted = true;
          // Blob, nao data URL: o Chromium recusa data: em elemento de midia com
          // 'Media load rejected by URL safety check' — o que na primeira tentativa
          // parecia arquivo corrompido e era o metodo de teste.
          const cru = atob(${JSON.stringify(base64)});
          const buf = new Uint8Array(cru.length);
          for (let i = 0; i < cru.length; i += 1) buf[i] = cru.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }));
          v.preload = 'auto';
          v.src = url;
          const resultado = await new Promise((resolve) => {
            const fim = setTimeout(() => resolve({ erro: 'timeout ao carregar' }), 10000);
            v.addEventListener('loadeddata', () => {
              clearTimeout(fim);
              const canvas = document.createElement('canvas');
              canvas.width = 32;
              canvas.height = 32;
              const context = canvas.getContext('2d', { willReadFrequently: true });
              context.drawImage(v, 0, 0, 32, 32);
              const pixels = context.getImageData(0, 0, 32, 32).data;
              let soma = 0;
              for (let index = 0; index < pixels.length; index += 4) {
                soma += pixels[index] + pixels[index + 1] + pixels[index + 2];
              }
              resolve({
                duracao: v.duration,
                largura: v.videoWidth,
                altura: v.videoHeight,
                soma,
              });
            }, { once: true });
            v.addEventListener('error', () => {
              clearTimeout(fim);
              resolve({
                erro: 'o player recusou: codigo ' + (v.error ? v.error.code : '?') +
                  ' — ' + (v.error && v.error.message ? v.error.message : 'sem detalhe'),
              });
            }, { once: true });
          });
          v.removeAttribute('src');
          v.load();
          URL.revokeObjectURL(url);
          return resultado;
        })()`,
      );
      record(
        "4 · o Chromium decodifica o arquivo",
        decodificado.erro === undefined &&
          decodificado.largura === 1920 &&
          decodificado.altura === 1080 &&
          decodificado.duracao > 0 &&
          decodificado.soma > 0,
        decodificado.erro === undefined
          ? `${decodificado.largura}×${decodificado.altura}, ` +
              `${decodificado.duracao.toFixed(2)} s, soma do frame=${decodificado.soma}`
          : `falhou: ${decodificado.erro}`,
      );

      const liveRenderCorrect =
        primeiraMedida.observedRender !== null &&
        primeiraMedida.observedRender.length === 2 &&
        primeiraMedida.observedRender.every(
          (surface) => surface.width === 3840 && surface.height === 2160,
        );
      record(
        "5 · WebCodecs recebe SS2 e mantém saída 1080p",
        primeira.resolution?.scale === 1 &&
          primeira.resolution?.supersampling === 2 &&
          primeira.resolution?.renderPixelRatio === 2 &&
          primeira.resolution?.render?.[0] === 3840 &&
          primeira.resolution?.render?.[1] === 2160 &&
          primeira.resolution?.output?.[0] === 1920 &&
          primeira.resolution?.output?.[1] === 1080 &&
          liveRenderCorrect &&
          primeira.boxReducedFrames === 12 &&
          segunda.boxReducedFrames === 12 &&
          primeira.settleFailed === 0 &&
          segunda.settleFailed === 0 &&
          primeira.errors.length === 0 &&
          segunda.errors.length === 0,
        `render=${primeira.resolution?.render?.join("×") ?? "?"}, ` +
          `output=${primeira.resolution?.output?.join("×") ?? "?"}, ` +
          `superfícies ao vivo=${
            primeiraMedida.observedRender
              ?.map((surface) => `${surface.selector} ${surface.width}×${surface.height}`)
              .join(" + ") ?? "não observadas"
          }, ` +
          `box CPU=${primeira.boxReducedFrames}/${segunda.boxReducedFrames} frames, ` +
          `settleFailed=${primeira.settleFailed}/${segunda.settleFailed}, ` +
          `erros=${primeira.errors.length}/${segunda.errors.length}`,
      );

      // ── 6. Motion blur também atravessa WebCodecs ─────────────────────────
      try {
        const motionA = await client.evaluate(exportarVideoComMotion(SAIDA_MOTION_A));
        const motionB = await client.evaluate(exportarVideoComMotion(SAIDA_MOTION_B));
        const motionBytesA =
          motionA.videoFile === null ? null : readFileSync(join(SAIDA_MOTION_A, motionA.videoFile));
        const motionBytesB =
          motionB.videoFile === null ? null : readFileSync(join(SAIDA_MOTION_B, motionB.videoFile));
        const motionHashA =
          motionBytesA === null ? null : createHash("sha256").update(motionBytesA).digest("hex");
        const motionHashB =
          motionBytesB === null ? null : createHash("sha256").update(motionBytesB).digest("hex");
        const decodedFrames =
          motionBytesA === null
            ? null
            : await inspectDecodedVideoFrames(client, bytes, motionBytesA, [
                1 / 30,
                3 / 30,
                5 / 30,
              ]);
        const expectedTrace = Number.isInteger(fixture.durationFrames)
          ? expectedMotionSamples(fixture.durationFrames)
          : [];
        const close = (left, right) => Math.abs(left - right) <= 1e-12;
        // HTMLMediaElement expõe currentTime em microssegundos neste muxer.
        const closeMediaTime = (left, right) => Math.abs(left - right) <= 1e-5;
        const traceMatches = (report) => {
          const trace = report.motionBlur?.sampleTrace ?? [];
          return (
            expectedTrace.length === 24 &&
            trace.length === expectedTrace.length &&
            trace.every((sample, index) => {
              const expected = expectedTrace[index];
              return (
                expected !== undefined &&
                sample.outputFrame === expected.outputFrame &&
                sample.sampleIndex === expected.sampleIndex &&
                close(sample.requestedFrame, expected.frame) &&
                close(sample.observedFrame, expected.frame) &&
                sample.quiet === true &&
                Number.isFinite(sample.settleMs) &&
                sample.settleMs >= 60
              );
            })
          );
        };
        const diagnostic = (report) =>
          report.ok === true &&
          report.written === 12 &&
          report.settleFailed === 0 &&
          report.settleFailedOutputFrames === 0 &&
          report.errors.length === 0 &&
          report.motionBlur?.enabled === true &&
          report.motionBlur?.shutterAngle === 180 &&
          report.motionBlur?.samples === 2 &&
          report.motionBlur?.effectiveSamples === 2 &&
          report.motionBlur?.totalSamples === 24 &&
          report.motionBlur?.processedSamples === 24 &&
          report.motionBlur?.settledSamples === 24 &&
          report.motionBlur?.accumulatedSamples === 24 &&
          report.motionBlur?.resolvedFrames === 12 &&
          report.motionBlur?.accumulatorAllocations === 1 &&
          report.motionBlur?.accumulatorBytes === 41_472_000 &&
          report.motionBlur?.accumulatorFloatBytes === 33_177_600 &&
          traceMatches(report) &&
          report.boxReducedFrames === 24;
        const decodedChanged =
          decodedFrames !== null &&
          decodedFrames.instantSize?.[0] === 1920 &&
          decodedFrames.instantSize?.[1] === 1080 &&
          decodedFrames.blurSize?.[0] === 1920 &&
          decodedFrames.blurSize?.[1] === 1080 &&
          decodedFrames.decodedTimes?.length === 3 &&
          decodedFrames.decodedTimes.every(
            (time) =>
              closeMediaTime(time.instant, time.requested) &&
              closeMediaTime(time.motion, time.requested),
          ) &&
          decodedFrames.blurVsInstant?.length === 3 &&
          decodedFrames.blurVsInstant.every(
            (difference) => difference.differentPixels > 50 && difference.absoluteDelta > 1000,
          ) &&
          decodedFrames.motionTemporalPairs?.length === 3 &&
          decodedFrames.motionTemporalPairs.every(
            (difference) => difference.differentPixels > 50 && difference.absoluteDelta > 1000,
          ) &&
          new Set(decodedFrames.motionSignatures ?? []).size === 3;
        const fixtureValid = movingFixtureIsValid(fixture);
        const diagnosticA = diagnostic(motionA);
        const diagnosticB = diagnostic(motionB);
        const blurPixelMinimum =
          decodedFrames?.blurVsInstant?.length > 0
            ? Math.min(
                ...decodedFrames.blurVsInstant.map((difference) => difference.differentPixels),
              )
            : 0;
        const temporalPixelMinimum =
          decodedFrames?.motionTemporalPairs?.length > 0
            ? Math.min(
                ...decodedFrames.motionTemporalPairs.map(
                  (difference) => difference.differentPixels,
                ),
              )
            : 0;
        const settleMinimum =
          motionA.motionBlur?.sampleTrace?.length > 0
            ? Math.min(...motionA.motionBlur.sampleTrace.map((sample) => sample.settleMs))
            : 0;
        record(
          "6 · MP4 com motion blur repete bytes, subframes e movimento decodificado",
          diagnosticA &&
            diagnosticB &&
            fixtureValid &&
            motionBytesA !== null &&
            motionBytesB !== null &&
            motionHashA === motionHashB &&
            motionBytesA.length === motionBytesB.length &&
            decodedChanged,
          `diagnóstico A/B=${diagnosticA}/${diagnosticB}, ` +
            `24/24 subframes, box=${motionA.boxReducedFrames}/${motionB.boxReducedFrames}, ` +
            `Float32=${((motionA.motionBlur?.accumulatorFloatBytes ?? 0) / 1048576).toFixed(1)} MB; ` +
            `sha ${motionHashA?.slice(0, 12) ?? "ausente"}/${motionHashB?.slice(0, 12) ?? "ausente"} ` +
            `${motionHashA === motionHashB ? "IDÊNTICOS" : "DIVERGEM"}; ` +
            `fixture ${fixtureValid ? "válida" : "INVÁLIDA"}, settle mínimo=${settleMinimum.toFixed(1)} ms; ` +
            `3 instantes: blur×instant mínimo=${blurPixelMinimum} px, ` +
            `movimento entre instantes mínimo=${temporalPixelMinimum} px, ` +
            `decoded=${decodedChanged}, assinaturas=${
              new Set(decodedFrames?.motionSignatures ?? []).size
            }, tempos=${JSON.stringify(decodedFrames?.decodedTimes ?? [])}`,
        );
      } catch (error) {
        record(
          "6 · MP4 com motion blur repete bytes, subframes e movimento decodificado",
          false,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  } finally {
    const restored = await client.evaluate(
      `(async () => {
        const bus = session().commandBus;
        let n = 0;
        while (bus.history.canUndo() && n < 400) { bus.history.undo(); n += 1; }
        session().actions.setPlayhead(0);
        session().actions.clearSelection();
        await wait(300);
        const doc = JSON.stringify(canonical(session().getSnapshot().document));
        // A entrada foi aceita apenas com histórico vazio. Remover as entradas
        // desfeitas torna a prova repetível sem destruir trabalho preexistente.
        bus.history.clear();
        return { n, doc };
      })()`,
    );
    const clean = restored.doc === baseline;
    record(
      "0 · desfazer devolve o documento",
      clean,
      `${restored.n} comandos desfeitos, documento ${clean ? "idêntico" : "DIVERGENTE"}`,
    );
    client.close();
  }

  const failures = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failures.length}/${results.length} critérios provados.`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
