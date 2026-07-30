/**
 * Prova do núcleo da Fase 8 (exportação), no Electron real.
 * Requer `pnpm dev` rodando.
 *
 *   node tools/verify-phase8.mjs
 *
 * Estes são os critérios que **não dependem de codec** e que sustentam todos os
 * outros. O critério 2 do roteiro — exportar duas vezes e obter arquivos byte a
 * byte idênticos — é o mais importante do projeto inteiro.
 *
 * 1. O frame de export inclui as três superfícies: mapa, palco e overlay. Hoje
 *    a captura antiga trazia só o overlay, e um export sairia sem terreno.
 * 2. **Exportar o mesmo trecho duas vezes dá os mesmos hashes, arquivo por
 *    arquivo.** É o critério 2 da Fase 8.
 * 3. Nenhum gizmo aparece em nenhum frame: com um nó selecionado — o que desenha
 *    alça de transformação no viewport — os hashes continuam os mesmos.
 * 4. O relatório traz `settleFailed: 0` e p99 de settle dentro do orçamento.
 * 5. Dois nós geo com filtros continuam determinísticos.
 * 6. Com cache frio, `model3d` e `route3d` já aparecem no primeiro export; a
 *    execução quente produz os mesmos hashes. Esta é a prova de que o settle
 *    espera o parse assíncrono do GLB, não apenas câmera e tiles.
 * 7. **Exportar acima de 2 MP dá arquivos byte-idênticos.** Até o ADR-022 o frame
 *    saía do tamanho do painel — 0,71 MP nesta máquina — e por isso este
 *    verificador ficou 7/7 durante sessões sem nunca exportar grande, que é
 *    justamente onde a repintura com MSAA deixava de ser bit-exata.
 * 8. **`SAMPLES === 0` no mapa e no palco.** Afirmação estrutural, e não
 *    substituível pelo critério 7: há GPU em que o defeito do MSAA não reproduz
 *    (medido numa RTX 4090), e nela comparar hashes deixaria a regressão passar.
 *    Ver a segunda medição do ADR-023.
 * 9. **Supersampling 2× é byte-idêntico e usa o box decidido.** O verificador
 *    reduz por conta própria o PNG 4K e exige os mesmos pixels do arquivo 1080p.
 * 10. O controle explícito do preview dobra os backing stores de Map/Pixi/Three
 *     e devolve a preferência local ao valor anterior no fim.
 * 11. Motion blur visita subframes realmente fracionários, repete bytes entre
 *     execuções, difere do frame instantâneo e preserva os três bypasses.
 *
 * Escreve numa pasta temporária escolhida sem diálogo (o verificador chama o
 * escritor direto), e desfaz o que criou no documento.
 */

import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

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
const SAIDA = join(tmpdir(), "theatrum-verify-phase8").replaceAll("\\", "/");
/** Pasta separada para o export 4K: os arquivos são grandes e o nome se repete. */
const SAIDA_4K = join(tmpdir(), "theatrum-verify-phase8-4k").replaceAll("\\", "/");
/** SS2 termina em 1080p; pasta própria preserva a referência 4K para o box externo. */
const SAIDA_SS = join(tmpdir(), "theatrum-verify-phase8-ss").replaceAll("\\", "/");
/** Tem de continuar inexistente: plano inválido não pode sequer começar a saída. */
const SAIDA_RECUSA_SS = join(
  tmpdir(),
  `theatrum-verify-phase8-ss-refusal-${process.pid}-${Date.now()}`,
).replaceAll("\\", "/");
const MOTION_RUN = `${process.pid}-${Date.now()}`;
const SAIDA_MOTION_A = join(tmpdir(), `theatrum-verify-phase8-motion-a-${MOTION_RUN}`).replaceAll(
  "\\",
  "/",
);
const SAIDA_MOTION_B = join(tmpdir(), `theatrum-verify-phase8-motion-b-${MOTION_RUN}`).replaceAll(
  "\\",
  "/",
);
const SAIDA_MOTION_OFF = join(
  tmpdir(),
  `theatrum-verify-phase8-motion-off-${MOTION_RUN}`,
).replaceAll("\\", "/");
const SAIDA_MOTION_ANGLE_ZERO = join(
  tmpdir(),
  `theatrum-verify-phase8-motion-angle-zero-${MOTION_RUN}`,
).replaceAll("\\", "/");
const SAIDA_MOTION_ONE_SAMPLE = join(
  tmpdir(),
  `theatrum-verify-phase8-motion-one-sample-${MOTION_RUN}`,
).replaceAll("\\", "/");
const SAIDA_RECUSA_MOTION = join(
  tmpdir(),
  `theatrum-verify-phase8-motion-refusal-${MOTION_RUN}`,
).replaceAll("\\", "/");

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

/** Hash dos pixels que já estão nos canvases, sem pedir repaint nem export. */
const hashPreviewCanvases = async () => {
  const required = ['.maplibregl-canvas', '.scene-overlay__pixi'];
  const selectors = [
    '.maplibregl-canvas',
    '.scene-overlay__studio',
    '.scene-overlay__pixi',
  ];
  const surfaces = [];
  try {
    for (const selector of selectors) {
      const canvas = document.querySelector(selector);
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      if (canvas.width <= 1 || canvas.height <= 1) {
        return { ok: false, reason: selector + ' sem tamanho físico', surfaces };
      }
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (context === null) {
        return { ok: false, reason: 'contexto 2D ausente para ' + selector, surfaces };
      }
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
      let energy = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        energy += pixels[index] + pixels[index + 1] + pixels[index + 2] + pixels[index + 3];
      }
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pixels));
      const sha256 = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
      surfaces.push({
        selector,
        size: [scratch.width, scratch.height],
        energy,
        sha256,
      });
    }
    const requiredPresent = required.every((selector) =>
      surfaces.some((surface) => surface.selector === selector && surface.energy > 0),
    );
    return {
      ok: requiredPresent,
      reason: requiredPresent ? null : 'mapa/Pixi ausentes ou sem pixels legíveis',
      surfaces,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      surfaces,
    };
  }
};
`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASSA" : "FALHA"}  ${name}\n        ${detail}`);
}

/** Monta uma cena pequena com mapa, território e rótulo, e enquadra. */
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

  const ucr = S.actions.addGeoFeature({ id: 'c:UKR', name: 'Ucrânia', kind: 'country' }, [31.2, 48.4]);
  if (ucr) {
    S.actions.setPropertyValue(ucr, 'props.fill', '#1b3a5c99');
    S.actions.setPropertyValue(ucr, 'props.fillAlpha', 0.5);
  }
  const rot = S.actions.addNodeOfType('text.label');
  S.actions.setNodeAnchor(rot, { space: 'geo', lngLat: [36.23, 49.99] });
  S.actions.setPropertyValue(rot, 'props.text', 'KHARKIV');
  S.actions.setPropertyValue(rot, 'props.fontSize', 32);
  // Uma opacidade animada garante que os frames do trecho sejam diferentes entre
  // si — hashes iguais entre frames diferentes esconderiam um export congelado.
  S.actions.setPlayhead(0);
  S.actions.togglePropertyKeyframe(rot, 'transform.opacity');
  S.actions.setPropertyValue(rot, 'transform.opacity', 0.15);
  S.actions.setPlayhead(8);
  S.actions.setPropertyValue(rot, 'transform.opacity', 1);
  S.actions.setPlayhead(0);
  S.actions.clearSelection();
  await window.__theatrumPhase2.settle(3000);
  await wait(600);
  return { rot, ucr };
})()`;

/**
 * Monta `model3d` + `route3d` e devolve IMEDIATAMENTE, sem esperar o GLB.
 *
 * A cópia do GLB recebe apenas um `asset.extras` único. O conteúdo visual não
 * muda, mas o hash do asset muda a cada execução do verificador, garantindo
 * que o cache de templates esteja realmente frio mesmo se o script for rodado
 * duas vezes no mesmo renderer.
 */
const MONTAR_CENA_3D = `(async () => {
  const S = session();
  // Relativo ao documento: no dev resolve para /models/...; no build estático,
  // para o diretório out/renderer/models. Começar com / em file:// apontaria
  // para a raiz do volume e reprovaria o empacotado antes de testar o settle.
  const response = await fetch(new URL('./models/fa-18f.glb', location.href));
  if (!response.ok) throw new Error('GLB não servido pelo dev server: ' + response.status);
  const source = new Uint8Array(await response.arrayBuffer());
  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (
    source.byteLength < 20 ||
    sourceView.getUint32(0, true) !== 0x46546c67 ||
    sourceView.getUint32(4, true) !== 2 ||
    sourceView.getUint32(16, true) !== 0x4e4f534a
  ) {
    throw new Error('fa-18f.glb não é um GLB 2.0 com JSON no primeiro chunk');
  }

  const oldJsonLength = sourceView.getUint32(12, true);
  const restStart = 20 + oldJsonLength;
  if (restStart > source.byteLength) throw new Error('chunk JSON inválido no fa-18f.glb');
  const jsonText = new TextDecoder().decode(source.subarray(20, restStart)).trimEnd();
  const gltf = JSON.parse(jsonText);
  const previousExtras =
    gltf.asset.extras !== null &&
    typeof gltf.asset.extras === 'object' &&
    !Array.isArray(gltf.asset.extras)
      ? gltf.asset.extras
      : {};
  gltf.asset.extras = {
    ...previousExtras,
    theatrumSettleProbe: crypto.randomUUID(),
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + jsonLength + (source.byteLength - restStart));
  bytes.set(source.subarray(0, 12));
  const outputView = new DataView(bytes.buffer);
  outputView.setUint32(8, bytes.byteLength, true);
  outputView.setUint32(12, jsonLength, true);
  outputView.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLength);
  bytes.set(source.subarray(restStart), 20 + jsonLength);

  const before = new Set(S.getSnapshot().document.assets.map((asset) => asset.src));
  await S.actions.importAssetFiles([
    new File([bytes], 'fa-18f-settle-probe.glb', { type: 'model/gltf-binary' }),
  ]);
  const asset = S.getSnapshot().document.assets.find(
    (candidate) => !before.has(candidate.src) && candidate.kind === 'model',
  );
  if (!asset) throw new Error('asset GLB único não entrou no documento');

  const pathId = S.actions.createPath({
    name: 'Rota 3D · prova de settle',
    space: 'geo',
    interpolation: 'catmull-rom',
    vertices: [
      [34.4, 49.65],
      [35.6, 50.2],
      [36.8, 50.75],
    ].map((point) => ({ point, inHandle: null, outHandle: null })),
  });
  if (!pathId) throw new Error('createPath da prova 3D falhou');

  const modelId = S.actions.addNodeOfType('model3d');
  if (!modelId) throw new Error('addNodeOfType model3d falhou');
  S.actions.renameNode(modelId, 'F/A-18F · prova de settle');
  S.actions.setNodeAnchor(modelId, { space: 'geo', lngLat: [34.4, 49.65] });
  if (!S.actions.setPropertyValue(modelId, 'props.assetId', asset.src)) {
    throw new Error('props.assetId não aceitou o GLB da prova');
  }
  S.actions.setPropertyValue(modelId, 'props.scaleMeters', 120000);
  S.actions.setPropertyValue(modelId, 'props.altitudeMeters', 60000);
  const behaviorId = S.actions.assignMotionPath(modelId, pathId, { from: 0, to: 8 });
  if (!behaviorId) throw new Error('assignMotionPath da prova 3D falhou');

  const routeId = S.actions.addNodeOfType('route3d');
  if (!routeId) throw new Error('addNodeOfType route3d falhou');
  S.actions.renameNode(routeId, 'Rota 3D · prova de settle');
  if (!S.actions.setPropertyValue(routeId, 'props.pathId', pathId)) {
    throw new Error('props.pathId não aceitou o caminho da prova');
  }
  S.actions.setPropertyValue(routeId, 'props.color', '#f2a13cff');
  S.actions.setPropertyValue(routeId, 'props.widthMeters', 18000);
  S.actions.setPropertyValue(routeId, 'props.altitudeMeters', 35000);
  S.actions.setPropertyValue(routeId, 'props.arcMeters', 90000);
  S.actions.setPropertyValue(routeId, 'props.curtainOpacity', 0.18);
  S.actions.setPropertyValue(routeId, 'props.progressStart', 0);
  S.actions.setPropertyValue(routeId, 'props.progressEnd', 1);

  S.actions.setPlayhead(0);
  S.actions.clearSelection();
  const composition = S.getSnapshot().document.compositions.find(
    (candidate) => candidate.id === S.getSnapshot().selectedCompositionId,
  );
  const nodes = composition ? Object.values(composition.nodes) : [];
  return {
    modelId,
    routeId,
    pathId,
    model3d: nodes.filter((node) => node.type === 'model3d').length,
    route3d: nodes.filter((node) => node.type === 'route3d').length,
  };
})()`;

/** Roda um export do trecho [0..8] e devolve o relatório. */
const EXPORTAR = `(async () => {
  const r = await overlay().exportPngSequence({
    range: { first: 0, last: 8 },
    directory: ${JSON.stringify(SAIDA)},
  });
  return {
    ok: r.ok,
    directory: r.directory,
    message: r.message ?? null,
    written: r.report ? r.report.written : 0,
    settleFailed: r.report ? r.report.settleFailed : -1,
    settleP99Ms: r.report ? r.report.settleP99Ms : -1,
    errors: r.report ? r.report.errors : [],
    hashes: r.report ? r.report.hashes : [],
  };
})()`;

/**
 * Export **acima de 2 MP**, com a escala do job (ADR-022).
 *
 * Quatro frames, não nove: em 3840×2160 cada frame é 8,29 MP, e a prova de
 * byte-identidade não precisa de mais. Os quatro cabem na animação de opacidade
 * do rótulo, então continuam distintos entre si — export congelado não passa.
 */
const EXPORTAR_4K = `(async () => {
  const r = await overlay().exportPngSequence({
    range: { first: 0, last: 3 },
    scale: 2,
    directory: ${JSON.stringify(SAIDA_4K)},
  });
  return {
    ok: r.ok,
    directory: r.directory,
    message: r.message ?? null,
    written: r.report ? r.report.written : 0,
    settleFailed: r.report ? r.report.settleFailed : -1,
    errors: r.report ? r.report.errors : [],
    hashes: r.report ? r.report.hashes : [],
  };
})()`;

/**
 * Mesma saída 1080p do job normal, mas superfícies a 3840×2160 e box 2×.
 *
 * O resultado traz o plano para provar que escala de saída e supersampling não
 * foram confundidos. A prova de pixel abaixo continua independente dele.
 */
const EXPORTAR_SS2 = `(async () => {
  const r = await overlay().exportPngSequence({
    range: { first: 0, last: 3 },
    supersampling: 2,
    directory: ${JSON.stringify(SAIDA_SS)},
  });
  return {
    ok: r.ok,
    directory: r.directory,
    message: r.message ?? null,
    written: r.report ? r.report.written : 0,
    settleFailed: r.report ? r.report.settleFailed : -1,
    errors: r.report ? r.report.errors : [],
    hashes: r.report ? r.report.hashes : [],
    resolution: r.resolution ?? null,
    boxReducedFrames: r.boxReducedFrames ?? -1,
  };
})()`;

/**
 * Três frames com SS2 e configuração temporal opcional.
 *
 * O polling roda concorrente ao export dentro do renderer. Como cada subframe
 * precisa ficar quieto por 60 ms, consultar a cada 10 ms torna observável o frame
 * que o overlay realmente avaliou — não apenas o que o planejador diz ter pedido.
 */
function exportarMotion(directory, motionBlur = null) {
  const temporal = motionBlur === null ? "" : `motionBlur: ${JSON.stringify(motionBlur)},`;
  return `(async () => {
    const seen = [];
    let last = '';
    const timer = setInterval(() => {
      const snapshot = overlay().getSnapshot();
      if (!snapshot || snapshot.ready !== true) return;
      const key = String(snapshot.renders) + ':' + String(snapshot.frame);
      if (key === last || seen.length >= 512) return;
      last = key;
      seen.push({ renders: snapshot.renders, frame: snapshot.frame });
    }, 10);
    try {
      const r = await overlay().exportPngSequence({
        range: { first: 3, last: 5 },
        supersampling: 2,
        ${temporal}
        directory: ${JSON.stringify(directory)},
      });
      return {
        ok: r.ok,
        directory: r.directory,
        message: r.message ?? null,
        written: r.report ? r.report.written : 0,
        settleFailed: r.report ? r.report.settleFailed : -1,
        settleFailedOutputFrames: r.report ? r.report.settleFailedOutputFrames : -1,
        errors: r.report ? r.report.errors : [],
        hashes: r.report ? r.report.hashes : [],
        motionBlur: r.report ? r.report.motionBlur : null,
        boxReducedFrames: r.boxReducedFrames ?? -1,
        seen,
      };
    } finally {
      clearInterval(timer);
    }
  })()`;
}

/** Círculo opaco com 140 px/frame, e o único outro nó animado desligado. */
function montarCenaMotion(labelId) {
  return `(async () => {
    const S = session();
    const state = S.getSnapshot();
    const compositionId = state.selectedCompositionId;
    const labelDisabled = S.actions.dispatch({
      type: 'node.set-flags',
      payload: {
        compositionId,
        nodeId: ${JSON.stringify(labelId)},
        flags: { enabled: false },
      },
      source: 'user',
    });
    const circle = S.actions.addNodeOfType('shape.circle');
    if (!circle) throw new Error('addNodeOfType shape.circle da prova motion falhou');
    S.actions.renameNode(circle, 'Motion blur · prova temporal');
    S.actions.setNodeAnchor(circle, { space: 'comp', position: [400, 540] });
    S.actions.setPropertyValue(circle, 'props.radius', 64);
    S.actions.setPropertyValue(circle, 'props.fill', '#ff3b30ff');
    S.actions.setPropertyValue(circle, 'props.stroke', '#ffffffff');
    S.actions.setPropertyValue(circle, 'props.strokeWidth', 0);
    S.actions.setPlayhead(0);
    S.actions.setPropertyValue(circle, 'transform.position', [0, 0]);
    if (!S.actions.togglePropertyKeyframe(circle, 'transform.position')) {
      throw new Error('keyframe inicial do círculo motion falhou');
    }
    S.actions.setPlayhead(8);
    if (!S.actions.setPropertyValue(circle, 'transform.position', [1120, 0])) {
      throw new Error('keyframe final do círculo motion falhou');
    }
    S.actions.setPlayhead(3);
    S.actions.clearSelection();
    await window.__theatrumPhase2.settle(3000);
    await wait(500);
    return { circle, labelDisabled, compositionId };
  })()`;
}

function desmontarCenaMotion(fixture, labelId) {
  return `(async () => {
    const S = session();
    const before = S.getSnapshot();
    const beforeComposition = before.document.compositions.find(
      (candidate) => candidate.id === ${JSON.stringify(fixture.compositionId)},
    );
    const circlePresentBefore = beforeComposition?.nodes[${JSON.stringify(fixture.circle)}] !== undefined;
    const labelDisabledBefore =
      beforeComposition?.nodes[${JSON.stringify(labelId)}]?.enabled === false;
    const deleteAccepted = S.actions.dispatch({
      type: 'node.delete',
      payload: {
        compositionId: ${JSON.stringify(fixture.compositionId)},
        nodeId: ${JSON.stringify(fixture.circle)},
      },
      source: 'user',
    });
    const enableAccepted = S.actions.dispatch({
      type: 'node.set-flags',
      payload: {
        compositionId: ${JSON.stringify(fixture.compositionId)},
        nodeId: ${JSON.stringify(labelId)},
        flags: { enabled: true },
      },
      source: 'user',
    });
    S.actions.setPlayhead(0);
    S.actions.clearSelection();
    await window.__theatrumPhase2.settle(3000);
    await wait(300);
    const after = S.getSnapshot();
    const afterComposition = after.document.compositions.find(
      (candidate) => candidate.id === ${JSON.stringify(fixture.compositionId)},
    );
    return {
      circlePresentBefore,
      labelDisabledBefore,
      deleteAccepted,
      enableAccepted,
      circleAbsentAfter: afterComposition?.nodes[${JSON.stringify(fixture.circle)}] === undefined,
      labelEnabledAfter: afterComposition?.nodes[${JSON.stringify(labelId)}]?.enabled === true,
      playheadRestored: after.playheadFrame === 0,
      document: JSON.stringify(canonical(after.document)),
    };
  })()`;
}

/**
 * `SAMPLES` de uma superfície composta, lido do contexto vivo.
 *
 * É afirmação estrutural, e é a única que sobrevive a uma GPU onde o defeito do
 * MSAA não reproduz — como a RTX 4090 desta máquina, medida em 2026-07-29:
 * lá, `antialias: true` repete bit a bit até 8,29 MP, então **comparar hashes não
 * pegaria a regressão**. Ver a segunda medição do ADR-023.
 */
const SAMPLES_DE = (seletor) => `(() => {
  const canvas = document.querySelector(${JSON.stringify(seletor)});
  if (canvas === null) return { presente: false };
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl === null) return { presente: true, contexto: false };
  const attrs = gl.getContextAttributes();
  return {
    presente: true,
    contexto: true,
    samples: gl.getParameter(gl.SAMPLES),
    antialias: attrs === null ? null : attrs.antialias,
    fisico: [canvas.width, canvas.height],
  };
})()`;

/** Largura e altura de um PNG, direto do IHDR. Prova em disco, não em canvas. */
function pngSize(file) {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Decodificador independente e deliberadamente estreito.
 *
 * O escritor da base produz PNG RGBA8, sem entrelaçamento e com filtro 0 por
 * linha. Exigir esse contrato deixa qualquer mudança do encoder visível em vez
 * de interpretar bytes por aproximação.
 */
function decodePngRgba(file) {
  const bytes = readFileSync(file);
  const signature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`${file}: assinatura PNG inválida`);
  }
  let at = 8;
  let width = 0;
  let height = 0;
  let bitDepth = -1;
  let colorType = -1;
  let interlace = -1;
  const idat = [];
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    at += length + 12;
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(
      `${file}: esperado RGBA8 não entrelaçado; veio ${width}×${height}, ` +
        `depth=${bitDepth}, color=${colorType}, interlace=${interlace}`,
    );
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (inflated.length !== (stride + 1) * height) {
    throw new Error(`${file}: IDAT tem ${inflated.length} bytes, tamanho incompatível`);
  }
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const source = y * (stride + 1);
    if (inflated[source] !== 0) {
      throw new Error(`${file}: filtro PNG ${inflated[source]} na linha ${y}; esperado 0`);
    }
    rgba.set(inflated.subarray(source + 1, source + 1 + stride), y * stride);
  }
  return { width, height, rgba };
}

/** Referência externa do box 2×: não importa nem executa código de produção. */
function independentBox2(frame) {
  if (frame.width % 2 !== 0 || frame.height % 2 !== 0) {
    throw new Error(`referência 2× exige dimensão par, veio ${frame.width}×${frame.height}`);
  }
  const width = frame.width / 2;
  const height = frame.height / 2;
  const rgba = new Uint8Array(width * height * 4);
  let nonUniformBlocks = 0;
  let differsFromDecimation = false;
  let target = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offsets = [
        (y * 2 * frame.width + x * 2) * 4,
        (y * 2 * frame.width + x * 2 + 1) * 4,
        ((y * 2 + 1) * frame.width + x * 2) * 4,
        ((y * 2 + 1) * frame.width + x * 2 + 1) * 4,
      ];
      const first = offsets[0];
      let alphaSum = 0;
      let redAlpha = 0;
      let greenAlpha = 0;
      let blueAlpha = 0;
      let uniform = true;
      for (const offset of offsets) {
        const alpha = frame.rgba[offset + 3];
        alphaSum += alpha;
        redAlpha += frame.rgba[offset] * alpha;
        greenAlpha += frame.rgba[offset + 1] * alpha;
        blueAlpha += frame.rgba[offset + 2] * alpha;
        if (
          frame.rgba[offset] !== frame.rgba[first] ||
          frame.rgba[offset + 1] !== frame.rgba[first + 1] ||
          frame.rgba[offset + 2] !== frame.rgba[first + 2] ||
          frame.rgba[offset + 3] !== frame.rgba[first + 3]
        ) {
          uniform = false;
        }
      }
      if (!uniform) nonUniformBlocks += 1;
      rgba[target] =
        alphaSum === 0 ? 0 : Math.floor((redAlpha + Math.floor(alphaSum / 2)) / alphaSum);
      rgba[target + 1] =
        alphaSum === 0 ? 0 : Math.floor((greenAlpha + Math.floor(alphaSum / 2)) / alphaSum);
      rgba[target + 2] =
        alphaSum === 0 ? 0 : Math.floor((blueAlpha + Math.floor(alphaSum / 2)) / alphaSum);
      rgba[target + 3] = Math.floor((alphaSum + 2) / 4);
      if (
        rgba[target] !== frame.rgba[first] ||
        rgba[target + 1] !== frame.rgba[first + 1] ||
        rgba[target + 2] !== frame.rgba[first + 2] ||
        rgba[target + 3] !== frame.rgba[first + 3]
      ) {
        differsFromDecimation = true;
      }
      target += 4;
    }
  }
  return { width, height, rgba, nonUniformBlocks, differsFromDecimation };
}

function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function sameExportBytes(a, directoryA, b, directoryB) {
  if (a.hashes.length === 0 || a.hashes.length !== b.hashes.length) return false;
  return a.hashes.every((entry, index) => {
    const other = b.hashes[index];
    return (
      other !== undefined &&
      entry.filename === other.filename &&
      sameBytes(
        readFileSync(join(directoryA, entry.filename)),
        readFileSync(join(directoryB, other.filename)),
      )
    );
  });
}

/**
 * Mede o A/B visual do motion blur sem importar código de produção.
 *
 * O círculo da fixture cruza uma faixa conhecida. Fora dela, os bytes devem ser
 * exatamente os do frame instantâneo: é a guarda de que o mapa estático não foi
 * alterado por um pós-processo espacial de tela inteira.
 */
function measureMotionPixels(blurReport, blurDirectory, instantReport, instantDirectory) {
  const proof = {
    allFramesDiffer: true,
    changedPixels: 0,
    changedInsideCorridor: 0,
    changedOutsideCorridor: 0,
    error: null,
  };
  try {
    for (let index = 0; index < 3; index += 1) {
      const blurEntry = blurReport.hashes[index];
      const instantEntry = instantReport.hashes[index];
      if (blurEntry === undefined || instantEntry === undefined) {
        throw new Error(`relatório incompleto no frame motion ${index}`);
      }
      const blur = decodePngRgba(join(blurDirectory, blurEntry.filename));
      const instant = decodePngRgba(join(instantDirectory, instantEntry.filename));
      if (blur.width !== instant.width || blur.height !== instant.height) {
        throw new Error(
          `dimensão divergiu: ${blur.width}×${blur.height} / ${instant.width}×${instant.height}`,
        );
      }
      const compositionFrame = index + 3;
      const centerX = 400 + 140 * compositionFrame;
      const left = Math.floor(centerX - 100);
      const right = Math.ceil(centerX + 100);
      const top = 440;
      const bottom = 640;
      let frameDifferences = 0;
      for (let y = 0; y < blur.height; y += 1) {
        for (let x = 0; x < blur.width; x += 1) {
          const offset = (y * blur.width + x) * 4;
          const differs =
            blur.rgba[offset] !== instant.rgba[offset] ||
            blur.rgba[offset + 1] !== instant.rgba[offset + 1] ||
            blur.rgba[offset + 2] !== instant.rgba[offset + 2] ||
            blur.rgba[offset + 3] !== instant.rgba[offset + 3];
          if (!differs) continue;
          frameDifferences += 1;
          proof.changedPixels += 1;
          if (x >= left && x <= right && y >= top && y <= bottom) {
            proof.changedInsideCorridor += 1;
          } else {
            proof.changedOutsideCorridor += 1;
          }
        }
      }
      proof.allFramesDiffer &&= frameDifferences > 100;
    }
  } catch (error) {
    proof.allFramesDiffer = false;
    proof.error = error instanceof Error ? error.message : String(error);
  }
  return proof;
}

function measureSupersamplingPixels(highReport, ssReport, lowReport) {
  const proof = {
    kernelMatches: true,
    differsFromLow: false,
    nonUniformBlocks: 0,
    differsFromDecimation: false,
    highSize: null,
    ssSize: null,
    error: null,
  };
  try {
    for (let index = 0; index < 4; index += 1) {
      const highHash = highReport.hashes[index];
      const ssHash = ssReport.hashes[index];
      const lowHash = lowReport.hashes[index];
      if (highHash === undefined || ssHash === undefined || lowHash === undefined) {
        throw new Error(`relatório incompleto no frame ${index}`);
      }
      const high = decodePngRgba(join(SAIDA_4K, highHash.filename));
      const ss = decodePngRgba(join(SAIDA_SS, ssHash.filename));
      const low = decodePngRgba(join(SAIDA, lowHash.filename));
      const expected = independentBox2(high);
      proof.highSize ??= [high.width, high.height];
      proof.ssSize ??= [ss.width, ss.height];
      proof.kernelMatches &&= sameBytes(expected.rgba, ss.rgba);
      proof.differsFromLow ||= !sameBytes(ss.rgba, low.rgba);
      proof.nonUniformBlocks += expected.nonUniformBlocks;
      proof.differsFromDecimation ||= expected.differsFromDecimation;
    }
  } catch (error) {
    proof.kernelMatches = false;
    proof.error = error instanceof Error ? error.message : String(error);
  }
  return proof;
}

/**
 * Põe uma aba qualquer do dockview na frente.
 *
 * `PointerEvent` no próprio elemento da aba: `element.click()` o dockview ignora,
 * e `Input.dispatchMouseEvent` por coordenada funciona só às vezes. Ver
 * 09-CONTINUIDADE, "Trocar de aba do dockview por CDP".
 */
async function activateTabNamed(client, label, mountedSelector) {
  const mounted = () =>
    client.evaluate(`Boolean(document.querySelector(${JSON.stringify(mountedSelector)}))`);
  if ((await mounted()) === true) return true;
  const clicked = await client.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.dv-tab')].find((t) =>
      t.textContent.includes(${JSON.stringify(label)}),
    );
    if (tab === undefined) return false;
    for (const type of ['pointerdown', 'pointerup']) {
      tab.dispatchEvent(new PointerEvent(type, {
        bubbles: true, composed: true, cancelable: true,
        pointerId: 1, isPrimary: true, button: 0,
      }));
    }
    return true;
  })()`);
  if (clicked !== true) return false;
  const deadline = Date.now() + 8000;
  for (;;) {
    if ((await mounted()) === true) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Usa o controle visível — não o store interno — e espera o backing store chegar.
 *
 * Isso prova as duas metades do requisito de preview: existe um controle
 * explícito e ele está realmente ligado às superfícies do painel ativo.
 */
async function setPreviewFactorAndMeasure(client, factor, selectors, maxBaseDpr = null) {
  const maxDprLiteral = maxBaseDpr === null ? "null" : String(maxBaseDpr);
  return client.evaluate(`(async () => {
    const control = document.querySelector('select[aria-label="Qualidade do preview"]');
    if (!(control instanceof HTMLSelectElement)) {
      return { ok: false, reason: 'controle de qualidade ausente', surfaces: [] };
    }
    control.value = ${JSON.stringify(String(factor))};
    control.dispatchEvent(new Event('change', { bubbles: true }));
    const maxBaseDpr = ${maxDprLiteral};
    const base = maxBaseDpr === null
      ? window.devicePixelRatio
      : Math.max(1, Math.min(window.devicePixelRatio, maxBaseDpr));
    const expectedRatio = base * ${String(factor)};
    const selectors = ${JSON.stringify(selectors)};
    const measure = () => selectors.map((selector) => {
      const canvas = document.querySelector(selector);
      if (!(canvas instanceof HTMLCanvasElement)) return { selector, present: false };
      return {
        selector,
        present: true,
        css: [canvas.clientWidth, canvas.clientHeight],
        physical: [canvas.width, canvas.height],
        expected: [
          Math.round(canvas.clientWidth * expectedRatio),
          Math.round(canvas.clientHeight * expectedRatio),
        ],
      };
    });
    const deadline = Date.now() + 8000;
    for (;;) {
      const surfaces = measure();
      const settled = surfaces.length === selectors.length && surfaces.every((surface) =>
        surface.present === true &&
        surface.css[0] > 1 &&
        surface.css[1] > 1 &&
        surface.physical[0] === surface.expected[0] &&
        surface.physical[1] === surface.expected[1]
      );
      if (settled) return { ok: true, value: control.value, expectedRatio, surfaces };
      if (Date.now() >= deadline) {
        return { ok: false, value: control.value, expectedRatio, surfaces, reason: 'timeout' };
      }
      await wait(16);
    }
  })()`);
}

/**
 * Põe o Viewport na frente antes de medir.
 *
 * **Por que isto existe.** O dockview só monta o painel ativo, e o layout é
 * **persistido** — rodar o `verify:phase7e3` deixa a aba do Palco na frente, e ela
 * continua lá depois de reiniciar o app. Sem esta função, este verificador relata
 * `.maplibregl-canvas ausente` em cinco critérios e a leitura errada é "o export
 * quebrou". É o sinal do painel errado, pela quinta vez (09-CONTINUIDADE § 1).
 *
 * O gesto é `PointerEvent` despachado **no próprio elemento da aba**, com
 * `bubbles`, `composed`, `pointerId` e `isPrimary` — não `element.click()`, que o
 * dockview ignora, nem `Input.dispatchMouseEvent` por coordenada, que funciona só
 * às vezes. É a conclusão registrada em 09-CONTINUIDADE, aplicada aqui.
 */
/**
 * O Viewport está montado **e pintado**?
 *
 * Montado não basta, e a diferença custou uma rodada inteira. O MapLibre cria o
 * canvas na hora, com o **fallback de 400×300** quando o container ainda não foi
 * medido; e `drawImage` de um canvas WebGL que ainda não pintou devolve zero em
 * todos os canais. Rodar o critério 1 nesse instante relata
 * `.maplibregl-canvas 400x300 soma=0 ILEGÍVEL`, e a leitura errada é "o export
 * quebrou".
 *
 * Medido nesta base: logo depois de recarregar o renderer, o verificador dá 6/7
 * no código **sem nenhuma mudança**, e 7/7 com o app já assentado. Verificador que
 * depende de quão recente foi o último reload não é verificador — é a mesma
 * família do critério que dependia da ordem em que outro rodou.
 *
 * As três condições são as mesmas de uma sonda honesta: existe, tem tamanho
 * plausível, e tem conteúdo. A terceira é a guarda de conteúdo do
 * `tools/probes/README.md`, lição 3.
 */
const VIEWPORT_PRONTO = `(async () => {
  const canvas = document.querySelector('.maplibregl-canvas');
  if (canvas === null) return { pronto: false, motivo: 'canvas ausente' };
  if (canvas.clientWidth <= 1 || canvas.clientHeight <= 1) {
    return { pronto: false, motivo: 'canvas sem tamanho de CSS' };
  }
  const m = window.__theatrumPhase2 === undefined ? null : window.__theatrumPhase2.map;
  if (m === null) return { pronto: false, motivo: 'superfície do mapa ausente' };
  // isStyleLoaded() NAO entra aqui. Medido nesta base: ele devolve false com o
  // mapa carregado, pintando, nove camadas no estilo e areTilesLoaded()
  // verdadeiro. Usa-lo como porta trava o verificador por 20 s num mapa
  // perfeitamente pronto. Quem responde "da para capturar?" e a leitura de volta.
  //
  // Sem acento grave neste bloco: ele mora DENTRO de um template literal, e
  // backtick aqui fecha a string. E a armadilha 4.1, e ela acabou de morder.
  //
  // Pedir a repintura, nao esperar por ela. O MapLibre repinta sob demanda:
  // depois de assentar, ele fica ocioso e a leitura de volta devolve zero em
  // todos os canais — a armadilha 4.11, e a condição exata do pump do export
  // entre frames. Esperar passivamente aqui deu 20 s de 'soma 0' com o mapa
  // perfeitamente carregado. Toda sonda deste repositório força o repaint; esta
  // guarda também.
  await new Promise((resolve) => { m.once('idle', resolve); m.triggerRepaint(); });
  if (!m.areTilesLoaded()) return { pronto: false, motivo: 'tiles pendentes' };
  const s = document.createElement('canvas');
  s.width = 32; s.height = 32;
  const ctx = s.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 32, 32);
  const px = ctx.getImageData(0, 0, 32, 32).data;
  let soma = 0;
  for (let i = 0; i < px.length; i += 4) soma += px[i] + px[i + 1] + px[i + 2];
  if (soma === 0) return { pronto: false, motivo: 'canvas não pintou nem sob triggerRepaint' };
  return { pronto: true, tamanho: [canvas.clientWidth, canvas.clientHeight], soma };
})()`;

async function activateViewportTab(client) {
  const mounted = () => client.evaluate(`Boolean(document.querySelector('.maplibregl-canvas'))`);
  if ((await mounted()) !== true) await clickViewportTab(client);
  await waitForViewportReady(client);
}

/** Espera o Viewport ficar legível, ou nomeia o que faltou. */
async function waitForViewportReady(client) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const ultimo = await client.evaluate(VIEWPORT_PRONTO);
    if (ultimo.pronto === true) return ultimo;
    if (Date.now() > deadline) {
      throw new Error(`Viewport não ficou pronto em 20 s: ${ultimo.motivo}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function clickViewportTab(client) {
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
    const montado = await client.evaluate(`Boolean(document.querySelector('.maplibregl-canvas'))`);
    if (montado === true) return;
    if (Date.now() > deadline) throw new Error("Viewport não montou depois de ativar a aba");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
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
      "verify:phase8 recusou uma sessão com histórico: salve/recarregue o projeto antes de " +
        "rodar a prova; nenhum comando do documento foi executado.",
    );
  }
  const baseline = baselineState.document;

  try {
    const cena = await client.evaluate(MONTAR_CENA);

    // ── 1. As três superfícies entram no frame ──────────────────────────────
    {
      const surfaces = await client.evaluate("medirComposicao()");
      const mapa = surfaces.find((s) => s.sel === ".maplibregl-canvas");
      const pixi = surfaces.find((s) => s.sel === ".scene-overlay__pixi");
      const ok =
        mapa?.presente === true && mapa.soma > 0 && pixi?.presente === true && pixi.soma > 0;
      record(
        "1 · mapa e overlay são legíveis para compor",
        ok,
        surfaces
          .map((s) =>
            s.presente
              ? `${s.sel} ${s.tamanho} soma=${s.soma}${s.soma === 0 ? " ILEGÍVEL" : ""}`
              : `${s.sel} ausente`,
          )
          .join("; "),
      );
    }

    // ── 2. Duas execuções, hashes idênticos ─────────────────────────────────
    const primeira = await client.evaluate(EXPORTAR);
    if (!primeira.ok && primeira.written === 0) {
      record(
        "2 · exportar duas vezes dá arquivos byte-idênticos",
        false,
        `primeira execução falhou: ${primeira.message ?? primeira.errors.join("; ")}`,
      );
    } else {
      const segunda = await client.evaluate(EXPORTAR);
      const iguais =
        primeira.hashes.length > 0 &&
        primeira.hashes.length === segunda.hashes.length &&
        primeira.hashes.every(
          (h, i) =>
            h.filename === segunda.hashes[i].filename && h.sha256 === segunda.hashes[i].sha256,
        );
      // Frames distintos entre si: a opacidade animada garante isso, e sem essa
      // checagem um export congelado passaria com hashes todos iguais.
      const distintos = new Set(primeira.hashes.map((h) => h.sha256)).size;
      record(
        "2 · exportar duas vezes dá arquivos byte-idênticos",
        iguais && distintos > 1,
        `${primeira.written} frames nas duas execuções, ${iguais ? "TODOS os hashes idênticos" : "hashes DIVERGEM"}; ` +
          `${distintos} hashes distintos entre os ${primeira.hashes.length} frames (animação de verdade)`,
      );

      // ── 3. Nenhum gizmo no frame ─────────────────────────────────────────
      const comGizmo = await client.evaluate(
        `(async () => {
          // Selecionar desenha alça de transformação no canvas de gizmos, que é
          // justamente o que não pode vazar para o arquivo.
          const state = session().getSnapshot();
          session().actions.selectNode(state.selectedCompositionId, ${JSON.stringify(cena.rot)});
          await wait(500);
          const r = await overlay().exportPngSequence({
            range: { first: 0, last: 8 },
            directory: ${JSON.stringify(SAIDA)},
          });
          session().actions.clearSelection();
          return { hashes: r.report ? r.report.hashes : [], written: r.report ? r.report.written : 0 };
        })()`,
      );
      const semVazamento =
        comGizmo.hashes.length === primeira.hashes.length &&
        comGizmo.hashes.every((h, i) => h.sha256 === primeira.hashes[i].sha256);
      record(
        "3 · gizmo de seleção não vaza para nenhum frame",
        semVazamento,
        `${comGizmo.written} frames com nó selecionado, hashes ${semVazamento ? "idênticos aos sem seleção" : "DIFERENTES — vazou UI"}`,
      );

      // ── 4. Relatório de settle ────────────────────────────────────────────
      record(
        "4 · relatório traz settleFailed zero e p99 dentro do orçamento",
        primeira.settleFailed === 0 && primeira.settleP99Ms < 4000,
        `settleFailed=${primeira.settleFailed}, p99=${primeira.settleP99Ms.toFixed(0)} ms, ` +
          `erros=${primeira.errors.length}; saída em ${primeira.directory}`,
      );

      // ── (medição do 7, na cena limpa — antes dos filtros e do 3D) ────────
      //
      // A posição é deliberada e está declarada no roteiro, não é régua movida.
      // A referência high-res e o SS precisam vir da mesma cena. Filtros e 3D
      // entram depois porque mudariam os pixels entre H e S, não porque sejam
      // instáveis: a regressão correspondente está fechada no critério 5.
      const primeira4k = await client.evaluate(EXPORTAR_4K);
      const segunda4k = await client.evaluate(EXPORTAR_4K);
      // Mesmas superfícies físicas do 4K acima, mas arquivo final 1080p. Isso
      // permite conferir o kernel contra os próprios pixels high-res.
      const primeiroSs2 = await client.evaluate(EXPORTAR_SS2);
      const segundoSs2 = await client.evaluate(EXPORTAR_SS2);
      // Agora, antes de o critério de filtros reutilizar SAIDA e substituir o
      // 1080p sem SS, preserva a comparação de pixel low/high/SS.
      const pixelsSs2 = measureSupersamplingPixels(segunda4k, segundoSs2, segunda);
      const recusadoSs2 = await client.evaluate(
        `(async () => {
          const r = await overlay().exportPngSequence({
            range: { first: 0, last: 0 },
            scale: 2,
            supersampling: 2,
            directory: ${JSON.stringify(SAIDA_RECUSA_SS)},
          });
          return {
            ok: r.ok,
            directory: r.directory,
            message: r.message ?? null,
            written: r.report ? r.report.written : 0,
          };
        })()`,
      );
      const refusalDirectoryCreated = existsSync(SAIDA_RECUSA_SS);

      // ── 5. A cena suspeita: dois nós geo com filtro ──────────────────────
      //
      // Este é o dono da regressão filtro + resize: não basta comparar dois
      // vetores de hashes. Os efeitos precisam existir, as duas execuções
      // precisam estar completas e assentadas, e os nove frames animados
      // precisam continuar diferentes entre si. Sem essas guardas, renderer
      // congelado ou export parcial vira uma falsa aprovação "idêntica".
      const comFiltros = await client.evaluate(
        `(async () => {
          const S = session();
          const est = S.actions.addGeoFeature(
            { id: 'c:UKR', name: 'Estradas', kind: 'road' },
            [31.2, 48.4],
          );
          const alvo = ${JSON.stringify(cena.ucr)};
          const outline = S.actions.addEffect(alvo, 'outline', { thickness: 2, tint: '#ffffffff' });
          const glow = S.actions.addEffect(alvo, 'glow', { radius: 18, strength: 1.2, tint: '#7ec8ffff' });
          S.actions.clearSelection();
          await window.__theatrumPhase2.settle(3000);
          await wait(900);
          const a = await overlay().exportPngSequence({
            range: { first: 0, last: 8 },
            directory: ${JSON.stringify(SAIDA)},
          });
          const b = await overlay().exportPngSequence({
            range: { first: 0, last: 8 },
            directory: ${JSON.stringify(SAIDA)},
          });
          if (glow !== null) S.actions.removeEffect(alvo, glow);
          if (outline !== null) S.actions.removeEffect(alvo, outline);
          await window.__theatrumPhase2.settle(3000);
          await wait(300);
          const semEfeitos = await overlay().exportPngSequence({
            range: { first: 0, last: 0 },
            directory: ${JSON.stringify(SAIDA)},
          });
          return {
            estradas: est !== null,
            outline: outline !== null,
            glow: glow !== null,
            erro: S.getSnapshot().error ?? null,
            a: {
              ok: a.ok,
              written: a.report ? a.report.written : 0,
              hashes: a.report ? a.report.hashes : [],
              settleFailed: a.report ? a.report.settleFailed : -1,
              errors: a.report ? a.report.errors : [a.message],
            },
            b: {
              ok: b.ok,
              written: b.report ? b.report.written : 0,
              hashes: b.report ? b.report.hashes : [],
              settleFailed: b.report ? b.report.settleFailed : -1,
              errors: b.report ? b.report.errors : [b.message],
            },
            semEfeitos: {
              ok: semEfeitos.ok,
              written: semEfeitos.report ? semEfeitos.report.written : 0,
              hashes: semEfeitos.report ? semEfeitos.report.hashes : [],
              settleFailed: semEfeitos.report ? semEfeitos.report.settleFailed : -1,
              errors: semEfeitos.report ? semEfeitos.report.errors : [semEfeitos.message],
            },
          };
        })()`,
      );
      const filtrosCompletos =
        comFiltros.estradas &&
        comFiltros.outline &&
        comFiltros.glow &&
        comFiltros.a.ok &&
        comFiltros.b.ok &&
        comFiltros.a.written === 9 &&
        comFiltros.b.written === 9 &&
        comFiltros.a.hashes.length === 9 &&
        comFiltros.b.hashes.length === 9 &&
        comFiltros.semEfeitos.ok &&
        comFiltros.semEfeitos.written === 1 &&
        comFiltros.semEfeitos.hashes.length === 1 &&
        comFiltros.a.settleFailed === 0 &&
        comFiltros.b.settleFailed === 0 &&
        comFiltros.semEfeitos.settleFailed === 0 &&
        comFiltros.a.errors.length === 0 &&
        comFiltros.b.errors.length === 0 &&
        comFiltros.semEfeitos.errors.length === 0;
      const filtrosIguais =
        comFiltros.a.hashes.length === comFiltros.b.hashes.length &&
        comFiltros.a.hashes.every(
          (hash, index) =>
            hash.filename === comFiltros.b.hashes[index]?.filename &&
            hash.sha256 === comFiltros.b.hashes[index]?.sha256,
        );
      const filtrosDistintosA = new Set(comFiltros.a.hashes.map((hash) => hash.sha256)).size;
      const filtrosDistintosB = new Set(comFiltros.b.hashes.map((hash) => hash.sha256)).size;
      const filtrosAlteramPixel =
        comFiltros.a.hashes[0]?.sha256 !== comFiltros.semEfeitos.hashes[0]?.sha256;
      record(
        "5 · export estável com dois nós geo e filtros aplicados",
        filtrosCompletos &&
          filtrosIguais &&
          filtrosDistintosA === 9 &&
          filtrosDistintosB === 9 &&
          filtrosAlteramPixel,
        `estradas=${comFiltros.estradas} outline=${comFiltros.outline} glow=${comFiltros.glow}; ` +
          `frames=${comFiltros.a.written}/${comFiltros.b.written}, ` +
          `settleFailed=${comFiltros.a.settleFailed}/${comFiltros.b.settleFailed}, ` +
          `erros=${comFiltros.a.errors.length}/${comFiltros.b.errors.length}, ` +
          `hashes entre execuções ${filtrosIguais ? "idênticos" : "DIVERGEM"}, ` +
          `distintos=${filtrosDistintosA}/${filtrosDistintosB}, ` +
          `frame filtrado ${filtrosAlteramPixel ? "difere" : "NÃO DIFERE"} do mesmo frame sem efeitos` +
          `${comFiltros.erro === null ? "" : `; erro na sessão: ${comFiltros.erro}`}`,
      );

      // ── (medição do 11, antes de inserir qualquer outro movimento) ────────
      //
      // O model3d do critério seguinte percorre uma rota. Medir o A/B temporal
      // antes dele deixa uma única explicação para cada pixel diferente: o
      // círculo conhecido abaixo. O placar fica na ordem e só é impresso depois
      // do critério 10.
      const motionProof = {
        complete: false,
        hashesStable: false,
        bytesStable: false,
        distinctFrames: 0,
        traceMatches: false,
        traceSamples: 0,
        liveObserved: false,
        liveFrames: 0,
        settleTiming: false,
        settleMinMs: null,
        settleMaxMs: null,
        diagnostics: false,
        identities: false,
        bypassDistinct: false,
        bypassSeeksObserved: false,
        bypassSeenFrames: [],
        bypassDiagnostics: [],
        fixtureRestored: false,
        fixtureTeardown: null,
        refusal: false,
        pixels: {
          allFramesDiffer: false,
          changedPixels: 0,
          changedInsideCorridor: 0,
          changedOutsideCorridor: -1,
          error: null,
        },
        ui: null,
        error: null,
      };
      const motionDocumentBefore = await client.evaluate(
        "JSON.stringify(canonical(session().getSnapshot().document))",
      );
      let motionFixture = null;
      try {
        motionFixture = await client.evaluate(montarCenaMotion(cena.rot));
        if (motionFixture.labelDisabled !== true) {
          throw new Error("não foi possível isolar o rótulo animado");
        }
        const motionA = await client.evaluate(
          exportarMotion(SAIDA_MOTION_A, { shutterAngle: 180, samples: 4 }),
        );
        const motionB = await client.evaluate(
          exportarMotion(SAIDA_MOTION_B, { shutterAngle: 180, samples: 4 }),
        );
        const instant = await client.evaluate(exportarMotion(SAIDA_MOTION_OFF));
        const angleZero = await client.evaluate(
          exportarMotion(SAIDA_MOTION_ANGLE_ZERO, { shutterAngle: 0, samples: 4 }),
        );
        const oneSample = await client.evaluate(
          exportarMotion(SAIDA_MOTION_ONE_SAMPLE, { shutterAngle: 180, samples: 1 }),
        );
        const invalidMotion = await client.evaluate(`(async () => {
          const r = await overlay().exportPngSequence({
            range: { first: 3, last: 3 },
            motionBlur: { shutterAngle: 180, samples: 0 },
            directory: ${JSON.stringify(SAIDA_RECUSA_MOTION)},
          });
          return {
            ok: r.ok,
            directory: r.directory,
            message: r.message ?? null,
            report: r.report ?? null,
          };
        })()`);

        const complete = (report) =>
          report.ok === true &&
          report.written === 3 &&
          report.hashes.length === 3 &&
          report.settleFailed === 0 &&
          report.settleFailedOutputFrames === 0 &&
          report.errors.length === 0;
        motionProof.complete =
          complete(motionA) &&
          complete(motionB) &&
          complete(instant) &&
          complete(angleZero) &&
          complete(oneSample);
        motionProof.hashesStable =
          motionA.hashes.length === motionB.hashes.length &&
          motionA.hashes.every(
            (entry, index) =>
              entry.filename === motionB.hashes[index]?.filename &&
              entry.sha256 === motionB.hashes[index]?.sha256,
          );
        motionProof.bytesStable = sameExportBytes(motionA, SAIDA_MOTION_A, motionB, SAIDA_MOTION_B);
        motionProof.distinctFrames = new Set(motionA.hashes.map((entry) => entry.sha256)).size;

        // Referência independente: 180° = meia exposição; quatro pontos médios.
        const expectedSamples = [3, 4, 5].flatMap((center) =>
          [-0.1875, -0.0625, 0.0625, 0.1875].map((offset) => center + offset),
        );
        const close = (a, b) => Math.abs(a - b) <= 1e-12;
        const traceMatches = (report) => {
          const trace = report.motionBlur?.sampleTrace ?? [];
          return (
            trace.length === expectedSamples.length &&
            trace.every(
              (sample, index) =>
                sample.outputFrame === Math.floor(index / 4) + 3 &&
                sample.sampleIndex === index % 4 &&
                close(sample.requestedFrame, expectedSamples[index]) &&
                close(sample.observedFrame, expectedSamples[index]) &&
                sample.quiet === true,
            )
          );
        };
        const liveObserved = (report) =>
          expectedSamples.every((expected) =>
            report.seen.some(
              (sample) => Number.isFinite(sample.frame) && close(sample.frame, expected),
            ),
          );
        motionProof.traceMatches = traceMatches(motionA) && traceMatches(motionB);
        motionProof.traceSamples = motionA.motionBlur?.sampleTrace?.length ?? 0;
        motionProof.liveObserved = liveObserved(motionA) && liveObserved(motionB);
        motionProof.liveFrames = new Set(
          motionA.seen
            .map((sample) => sample.frame)
            .filter((frame) => expectedSamples.some((expected) => close(frame, expected))),
        ).size;
        const settleSamples = [motionA, motionB].flatMap(
          (report) => report.motionBlur?.sampleTrace?.map((sample) => sample.settleMs) ?? [],
        );
        motionProof.settleTiming =
          settleSamples.length === expectedSamples.length * 2 &&
          settleSamples.every(
            (settleMs) => Number.isFinite(settleMs) && settleMs >= 60 && settleMs < 4_000,
          );
        motionProof.settleMinMs = settleSamples.length === 0 ? null : Math.min(...settleSamples);
        motionProof.settleMaxMs = settleSamples.length === 0 ? null : Math.max(...settleSamples);

        const diagnosticMatches = (report) =>
          report.motionBlur?.enabled === true &&
          report.motionBlur?.shutterAngle === 180 &&
          report.motionBlur?.samples === 4 &&
          report.motionBlur?.effectiveSamples === 4 &&
          report.motionBlur?.totalSamples === 12 &&
          report.motionBlur?.processedSamples === 12 &&
          report.motionBlur?.settledSamples === 12 &&
          report.motionBlur?.accumulatedSamples === 12 &&
          report.motionBlur?.resolvedFrames === 3 &&
          report.motionBlur?.accumulatorAllocations === 1 &&
          report.motionBlur?.accumulatorBytes === 41_472_000 &&
          report.motionBlur?.accumulatorFloatBytes === 33_177_600 &&
          report.boxReducedFrames === 12;
        motionProof.diagnostics = diagnosticMatches(motionA) && diagnosticMatches(motionB);

        const identityDiagnostic = (report, shutterAngle, samples) =>
          report.motionBlur?.enabled === false &&
          report.motionBlur?.shutterAngle === shutterAngle &&
          report.motionBlur?.samples === samples &&
          report.motionBlur?.effectiveSamples === 1 &&
          report.motionBlur?.exposureFrames === 0 &&
          report.motionBlur?.totalSamples === 3 &&
          report.motionBlur?.processedSamples === 3 &&
          report.motionBlur?.settledSamples === 3 &&
          report.motionBlur?.accumulatedSamples === 0 &&
          report.motionBlur?.resolvedFrames === 0 &&
          report.motionBlur?.accumulatorAllocations === 0 &&
          report.motionBlur?.accumulatorBytes === 0 &&
          report.motionBlur?.accumulatorFloatBytes === 0 &&
          report.motionBlur?.sampleTrace?.length === 0 &&
          report.boxReducedFrames === 3;
        const expectedBypassFrames = [3, 4, 5];
        const observedBypassFrames = (report) =>
          expectedBypassFrames.filter((expected) =>
            report.seen.some(
              (sample) => Number.isFinite(sample.frame) && close(sample.frame, expected),
            ),
          );
        const bypasses = [
          { label: "ausente", report: instant, shutterAngle: 180, samples: 1 },
          { label: "ângulo0", report: angleZero, shutterAngle: 0, samples: 4 },
          { label: "amostra1", report: oneSample, shutterAngle: 180, samples: 1 },
        ];
        motionProof.bypassDiagnostics = bypasses.map(
          ({ label, report, shutterAngle, samples }) => ({
            label,
            ok: identityDiagnostic(report, shutterAngle, samples),
            shutterAngle: report.motionBlur?.shutterAngle ?? null,
            samples: report.motionBlur?.samples ?? null,
            total: report.motionBlur?.totalSamples ?? null,
            processed: report.motionBlur?.processedSamples ?? null,
            settled: report.motionBlur?.settledSamples ?? null,
            trace: report.motionBlur?.sampleTrace?.length ?? null,
            box: report.boxReducedFrames,
            distinctHashes: new Set(report.hashes.map((entry) => entry.sha256)).size,
            seen: observedBypassFrames(report),
          }),
        );
        motionProof.bypassSeenFrames = motionProof.bypassDiagnostics.map(
          (diagnostic) => diagnostic.seen,
        );
        motionProof.bypassSeeksObserved = motionProof.bypassSeenFrames.every(
          (frames) => frames.length === expectedBypassFrames.length,
        );
        motionProof.bypassDistinct = motionProof.bypassDiagnostics.every(
          (diagnostic) => diagnostic.distinctHashes === 3,
        );
        motionProof.identities =
          sameExportBytes(instant, SAIDA_MOTION_OFF, angleZero, SAIDA_MOTION_ANGLE_ZERO) &&
          sameExportBytes(instant, SAIDA_MOTION_OFF, oneSample, SAIDA_MOTION_ONE_SAMPLE) &&
          motionProof.bypassDistinct &&
          motionProof.bypassSeeksObserved &&
          motionProof.bypassDiagnostics.every((diagnostic) => diagnostic.ok);
        motionProof.refusal =
          invalidMotion.ok === false &&
          invalidMotion.directory === "" &&
          invalidMotion.report === null &&
          /amostras|inteiro/i.test(invalidMotion.message ?? "") &&
          !existsSync(SAIDA_RECUSA_MOTION);
        motionProof.pixels = measureMotionPixels(
          motionA,
          SAIDA_MOTION_A,
          instant,
          SAIDA_MOTION_OFF,
        );
      } catch (error) {
        motionProof.error = error instanceof Error ? error.message : String(error);
      } finally {
        if (motionFixture !== null) {
          motionProof.fixtureTeardown = await client.evaluate(
            desmontarCenaMotion(motionFixture, cena.rot),
          );
        } else {
          motionProof.fixtureTeardown = await client.evaluate(`(() => ({
            circlePresentBefore: false,
            labelDisabledBefore: false,
            deleteAccepted: false,
            enableAccepted: false,
            circleAbsentAfter: false,
            labelEnabledAfter: false,
            playheadRestored: session().getSnapshot().playheadFrame === 0,
            document: JSON.stringify(canonical(session().getSnapshot().document)),
          }))()`);
        }
        const teardown = motionProof.fixtureTeardown;
        motionProof.fixtureRestored =
          teardown.circlePresentBefore === true &&
          teardown.labelDisabledBefore === true &&
          teardown.deleteAccepted === true &&
          teardown.enableAccepted === true &&
          teardown.circleAbsentAfter === true &&
          teardown.labelEnabledAfter === true &&
          teardown.playheadRestored === true &&
          teardown.document === motionDocumentBefore;
      }
      if (!motionProof.fixtureRestored) {
        const teardown = motionProof.fixtureTeardown;
        throw new Error(
          "fixture de motion blur não restaurou o documento antes da prova 3D: " +
            `delete=${String(teardown?.deleteAccepted)}, ` +
            `enable=${String(teardown?.enableAccepted)}, ` +
            `circleAbsent=${String(teardown?.circleAbsentAfter)}, ` +
            `labelEnabled=${String(teardown?.labelEnabledAfter)}, ` +
            `playhead=${String(teardown?.playheadRestored)}, ` +
            `document=${String(teardown?.document === motionDocumentBefore)}`,
        );
      }

      // ── 6. GLB frio: model3d + route3d já no primeiro export ─────────────
      //
      // `MONTAR_CENA_3D` termina antes do parse. Se o settle vir apenas câmera,
      // tiles e repinturas, o primeiro export sai sem a aeronave e diverge do
      // segundo, cujo template já está quente. O asset tem src único para que
      // rodar este verificador de novo no mesmo renderer continue sendo prova.
      const cena3d = await client.evaluate(MONTAR_CENA_3D);
      const frio3d = await client.evaluate(EXPORTAR);
      const quente3d = await client.evaluate(EXPORTAR);
      const hashes3dIguais =
        frio3d.hashes.length > 0 &&
        frio3d.hashes.length === quente3d.hashes.length &&
        frio3d.hashes.every(
          (hash, index) =>
            hash.filename === quente3d.hashes[index].filename &&
            hash.sha256 === quente3d.hashes[index].sha256,
        );
      const visual3dEntrou =
        frio3d.hashes.length === comFiltros.b.hashes.length &&
        frio3d.hashes.some((hash, index) => hash.sha256 !== comFiltros.b.hashes[index]?.sha256);
      const distintos3d = new Set(frio3d.hashes.map((hash) => hash.sha256)).size;
      const settle3dOk =
        frio3d.ok && quente3d.ok && frio3d.settleFailed === 0 && quente3d.settleFailed === 0;
      record(
        "6 · settle espera GLB frio de model3d com route3d",
        cena3d.model3d > 0 &&
          cena3d.route3d > 0 &&
          hashes3dIguais &&
          visual3dEntrou &&
          distintos3d > 1 &&
          settle3dOk,
        `model3d=${cena3d.model3d} route3d=${cena3d.route3d}; ` +
          `${frio3d.hashes.length} frames, frio×quente ${hashes3dIguais ? "idênticos" : "DIVERGEM"}; ` +
          `visual 3D ${visual3dEntrou ? "entrou no frame" : "não alterou o frame"}; ` +
          `${distintos3d} hashes distintos; settleFailed frio=${frio3d.settleFailed} quente=${quente3d.settleFailed}`,
      );

      // ── 7. Export ACIMA de 2 MP, byte-idêntico ───────────────────────────
      //
      // O critério 2 estava 7/7 há sessões porque nunca exportou grande: o frame
      // saía do tamanho do painel, 0,71 MP nesta máquina, abaixo do limiar em que
      // a repintura do MSAA deixava de ser bit-exata. Com o ADR-022 o tamanho vem
      // da composição, e com escala 2 são 8,29 MP — quatro vezes acima do limiar
      // medido na RTX 3060 Ti do ADR-023.
      //
      // O tamanho é afirmado no **arquivo em disco**, pelo IHDR do PNG, e não no
      // canvas: o canvas volta ao tamanho do painel no `finally` da transação, e
      // perguntar a ele depois responderia sobre o preview, não sobre a entrega.
      //
      // As duas execuções foram medidas acima, com a cena de mapa e overlay.
      const iguais4k =
        primeira4k.hashes.length > 0 &&
        primeira4k.hashes.length === segunda4k.hashes.length &&
        primeira4k.hashes.every(
          (hash, index) =>
            hash.filename === segunda4k.hashes[index].filename &&
            hash.sha256 === segunda4k.hashes[index].sha256,
        );
      const distintos4k = new Set(primeira4k.hashes.map((hash) => hash.sha256)).size;
      let medido4k = null;
      let erro4k = null;
      try {
        const primeiro = primeira4k.hashes[0];
        if (primeiro !== undefined) {
          medido4k = pngSize(join(SAIDA_4K, primeiro.filename));
        }
      } catch (error) {
        erro4k = error instanceof Error ? error.message : String(error);
      }
      const megapixels = medido4k === null ? 0 : (medido4k.width * medido4k.height) / 1e6;
      record(
        "7 · export acima de 2 MP dá arquivos byte-idênticos",
        iguais4k &&
          distintos4k > 1 &&
          primeira4k.settleFailed === 0 &&
          medido4k !== null &&
          medido4k.width === 3840 &&
          medido4k.height === 2160,
        `${primeira4k.written} frames em ` +
          `${medido4k === null ? `TAMANHO NÃO LIDO${erro4k === null ? "" : ` (${erro4k})`}` : `${medido4k.width}×${medido4k.height}`} ` +
          `= ${megapixels.toFixed(2)} MP; duas execuções ${iguais4k ? "IDÊNTICAS" : "DIVERGEM"}; ` +
          `${distintos4k} hashes distintos; settleFailed=${primeira4k.settleFailed}` +
          `${primeira4k.errors.length === 0 ? "" : `; erros: ${primeira4k.errors.slice(0, 2).join("; ")}`}`,
      );

      // ── 8. SAMPLES === 0 nas duas superfícies compostas ──────────────────
      //
      // **Este critério é estrutural de propósito, e o 7 não o substitui.** Na
      // RTX 4090 desta máquina, medido em 2026-07-29, o defeito do MSAA não
      // reproduz: com `antialias: true` a repintura repete bit a bit até 8,29 MP.
      // Ou seja, quem reintroduzir a flag por qualidade de imagem passaria pelo
      // critério 7 aqui e entregaria arquivo divergente na máquina de quem
      // recebe. Comparar bytes é sintoma; perguntar `SAMPLES` é estrutura.
      //
      // O palco exige aba própria e um nó `studio.stage`: sem ele o runtime nunca
      // chama `setSize`, o canvas fica nos 300×150 de fábrica e o contexto medido
      // não é o que exporta.
      const samplesMapa = await client.evaluate(SAMPLES_DE(".maplibregl-canvas"));
      const palcoMontado = await client.evaluate(
        `(async () => {
          const S = session();
          const estado = S.getSnapshot();
          const comp = estado.document.compositions.find((c) => c.id === estado.selectedCompositionId);
          const existente = Object.values(comp.nodes).find((n) => n.type === 'studio.stage');
          if (existente !== undefined) return { criado: false };
          S.actions.addNodeOfType('studio.stage');
          S.actions.clearSelection();
          await wait(400);
          return { criado: true };
        })()`,
      );
      const abriuPalco = await activateTabNamed(client, "Palco 3D", ".studio-viewport__stage");
      const samplesPalco = abriuPalco
        ? await client.evaluate(
            `(async () => { await wait(1200); return ${SAMPLES_DE(".studio-viewport__stage")}; })()`,
          )
        : { presente: false };
      // Volta para o Viewport antes do desfazer, senão o próximo critério — e a
      // próxima rodada — herdam a aba errada. É a lição do verificador que não era
      // idempotente, aplicada a este.
      await activateViewportTab(client);
      const msaaDesligado =
        samplesMapa.presente === true &&
        samplesMapa.samples === 0 &&
        samplesMapa.antialias === false &&
        samplesPalco.presente === true &&
        samplesPalco.samples === 0 &&
        samplesPalco.antialias === false;
      record(
        "8 · MSAA desligado nas duas superfícies compostas (ADR-023)",
        msaaDesligado,
        `mapa SAMPLES=${samplesMapa.samples ?? "?"} antialias=${samplesMapa.antialias ?? "?"}` +
          ` (${samplesMapa.fisico?.join("x") ?? "ausente"}); ` +
          `palco SAMPLES=${samplesPalco.samples ?? "?"} antialias=${samplesPalco.antialias ?? "?"}` +
          ` (${samplesPalco.fisico?.join("x") ?? "ausente"})` +
          `${palcoMontado.criado ? "; nó studio.stage criado para medir" : ""}` +
          `${abriuPalco ? "" : "; ABA DO PALCO NÃO ABRIU"}`,
      );

      // ── 9. Supersampling determinístico, com kernel provado ───────────────
      //
      // H = scale2/SS1 e S = scale1/SS2 conduzem as superfícies à MESMA
      // resolução física (3840×2160). O Node decodifica H e executa outro box,
      // sem importar o redutor de produção. Exigir S === box(H) prova mais que
      // dois hashes iguais: fator ignorado, nearest-neighbor ou drawImage
      // reduzindo pelo Chromium ficam vermelhos.
      const sameHashes = (a, b) =>
        a.hashes.length === 4 &&
        b.hashes.length === 4 &&
        a.hashes.every(
          (hash, index) =>
            hash.filename === b.hashes[index]?.filename && hash.sha256 === b.hashes[index]?.sha256,
        );
      const complete = (report) =>
        report.ok === true &&
        report.written === 4 &&
        report.hashes.length === 4 &&
        report.settleFailed === 0 &&
        report.errors.length === 0;
      const highStable = sameHashes(primeira4k, segunda4k);
      const ssStable = sameHashes(primeiroSs2, segundoSs2);
      const highDistinct = new Set(primeira4k.hashes.map((hash) => hash.sha256)).size;
      const ssDistinct = new Set(primeiroSs2.hashes.map((hash) => hash.sha256)).size;
      const ssPlan = segundoSs2.resolution;
      const planCorrect =
        ssPlan !== null &&
        ssPlan.scale === 1 &&
        ssPlan.supersampling === 2 &&
        ssPlan.renderPixelRatio === 2 &&
        ssPlan.render?.[0] === 3840 &&
        ssPlan.render?.[1] === 2160 &&
        ssPlan.output?.[0] === 1920 &&
        ssPlan.output?.[1] === 1080;
      const refusalCorrect =
        recusadoSs2.ok === false &&
        recusadoSs2.written === 0 &&
        recusadoSs2.directory === "" &&
        !refusalDirectoryCreated &&
        /teto|4096/i.test(recusadoSs2.message ?? "");
      const sizesCorrect =
        pixelsSs2.highSize?.[0] === 3840 &&
        pixelsSs2.highSize?.[1] === 2160 &&
        pixelsSs2.ssSize?.[0] === 1920 &&
        pixelsSs2.ssSize?.[1] === 1080;
      record(
        "9 · SS2 repete bytes e é exatamente o box do render 4K (ADR-024)",
        complete(primeira4k) &&
          complete(segunda4k) &&
          complete(primeiroSs2) &&
          complete(segundoSs2) &&
          highStable &&
          ssStable &&
          highDistinct === 4 &&
          ssDistinct === 4 &&
          primeiroSs2.boxReducedFrames === 4 &&
          segundoSs2.boxReducedFrames === 4 &&
          planCorrect &&
          refusalCorrect &&
          sizesCorrect &&
          pixelsSs2.kernelMatches &&
          pixelsSs2.differsFromLow &&
          pixelsSs2.nonUniformBlocks > 0 &&
          pixelsSs2.differsFromDecimation,
        `H ${pixelsSs2.highSize?.join("×") ?? "?"}, S ${pixelsSs2.ssSize?.join("×") ?? "?"}; ` +
          `H1=H2 ${highStable}, S1=S2 ${ssStable}, distintos=${highDistinct}/${ssDistinct}; ` +
          `S=box(H) ${pixelsSs2.kernelMatches}, S≠low ${pixelsSs2.differsFromLow}, ` +
          `box CPU=${primeiroSs2.boxReducedFrames}/${segundoSs2.boxReducedFrames} frames, ` +
          `blocos não uniformes=${pixelsSs2.nonUniformBlocks}, ` +
          `difere de decimação=${pixelsSs2.differsFromDecimation}; ` +
          `plano=${planCorrect}, teto recusado=${refusalCorrect}, ` +
          `pasta de recusa criada=${refusalDirectoryCreated}` +
          `${pixelsSs2.error === null ? "" : `; erro: ${pixelsSs2.error}`}`,
      );

      // ── 10. Controle explícito do preview, desligado da saída ─────────────
      const queueOpened = await activateTabNamed(
        client,
        "Fila de render",
        'select[aria-label="Qualidade do preview"]',
      );
      const originalPreview = await client.evaluate(
        `document.querySelector('select[aria-label="Qualidade do preview"]')?.value ?? '1'`,
      );
      let mapNormal = { ok: false, surfaces: [], reason: "não medido" };
      let mapSmooth = { ok: false, surfaces: [], reason: "não medido" };
      let studioNormal = { ok: false, surfaces: [], reason: "não medido" };
      let studioSmooth = { ok: false, surfaces: [], reason: "não medido" };
      let studioOpenedForPreview = false;
      let restoredPreview = { ok: false, surfaces: [], reason: "não restaurado" };
      try {
        mapNormal = await setPreviewFactorAndMeasure(
          client,
          1,
          [".maplibregl-canvas", ".scene-overlay__pixi"],
          null,
        );
        mapSmooth = await setPreviewFactorAndMeasure(
          client,
          2,
          [".maplibregl-canvas", ".scene-overlay__pixi"],
          null,
        );
        studioOpenedForPreview = await activateTabNamed(
          client,
          "Palco 3D",
          ".studio-viewport__stage",
        );
        if (studioOpenedForPreview) {
          studioNormal = await setPreviewFactorAndMeasure(
            client,
            1,
            [".studio-viewport__stage", ".studio-viewport__pixi"],
            2,
          );
          studioSmooth = await setPreviewFactorAndMeasure(
            client,
            2,
            [".studio-viewport__stage", ".studio-viewport__pixi"],
            2,
          );
        }
      } finally {
        if (studioOpenedForPreview) {
          await setPreviewFactorAndMeasure(
            client,
            Number(originalPreview),
            [".studio-viewport__stage", ".studio-viewport__pixi"],
            2,
          );
        }
        await activateViewportTab(client);
        restoredPreview = await setPreviewFactorAndMeasure(
          client,
          Number(originalPreview),
          [".maplibregl-canvas", ".scene-overlay__pixi"],
          null,
        );
        await activateTabNamed(client, "Timeline", ".timeline-panel__canvas");
      }
      const doubled = (normal, smooth) =>
        normal.ok === true &&
        smooth.ok === true &&
        normal.surfaces.length === smooth.surfaces.length &&
        normal.surfaces.every((surface) => {
          const next = smooth.surfaces.find((candidate) => candidate.selector === surface.selector);
          return (
            next !== undefined &&
            surface.css[0] === next.css[0] &&
            surface.css[1] === next.css[1] &&
            next.physical[0] === surface.physical[0] * 2 &&
            next.physical[1] === surface.physical[1] * 2
          );
        });
      const mapDoubled = doubled(mapNormal, mapSmooth);
      const studioDoubled = doubled(studioNormal, studioSmooth);
      record(
        "10 · controle visível dobra Map/Pixi/Three no preview e restaura a preferência",
        mapDoubled &&
          studioDoubled &&
          queueOpened &&
          studioOpenedForPreview &&
          restoredPreview.ok === true &&
          restoredPreview.value === originalPreview,
        `controle ${originalPreview}× restaurado=${restoredPreview.ok}; ` +
          `mapa/Pixi dobraram=${mapDoubled}, Three/Pixi dobraram=${studioDoubled}; ` +
          `mapa ${mapNormal.surfaces.map((surface) => surface.physical?.join("×")).join("+")}→` +
          `${mapSmooth.surfaces.map((surface) => surface.physical?.join("×")).join("+")}; ` +
          `palco ${studioNormal.surfaces
            .map((surface) => surface.physical?.join("×"))
            .join("+")}→${studioSmooth.surfaces
            .map((surface) => surface.physical?.join("×"))
            .join("+")}`,
      );

      // ── 11. Motion blur temporal real, determinístico e com bypass ────────
      //
      // O custo também é contrato: muda o controle sem apertar Exportar e lê a
      // estimativa já visível. O valor vem de duração × 8 × 100 ms, calculado
      // aqui sem importar o estimador de produção.
      try {
        const queueOpenedForMotion = await activateTabNamed(
          client,
          "Fila de render",
          'select[aria-label="Amostras de motion blur do export"]',
        );
        motionProof.ui = await client.evaluate(`(async () => {
          const samples = document.querySelector(
            'select[aria-label="Amostras de motion blur do export"]',
          );
          const shutter = document.querySelector(
            'select[aria-label="Ângulo do obturador do motion blur"]',
          );
          if (!(samples instanceof HTMLSelectElement) || !(shutter instanceof HTMLSelectElement)) {
            return { ok: false, reason: 'controles ausentes' };
          }
          const initialSamples = samples.value;
          const shutterDisabledWhenOff = shutter.disabled;
          await window.__theatrumPhase2.settle(3000);
          await wait(200);
          const playheadBefore = session().getSnapshot().playheadFrame;
          const previewBefore = await hashPreviewCanvases();
          samples.value = '8';
          samples.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(80);
          const state = session().getSnapshot();
          const playheadAfterSelection = state.playheadFrame;
          const previewAfterSelection = await hashPreviewCanvases();
          const previewUnchanged =
            previewBefore.ok === true &&
            previewAfterSelection.ok === true &&
            previewBefore.surfaces.length === previewAfterSelection.surfaces.length &&
            previewBefore.surfaces.every((surface) => {
              const after = previewAfterSelection.surfaces.find(
                (candidate) => candidate.selector === surface.selector,
              );
              return (
                after !== undefined &&
                after.size[0] === surface.size[0] &&
                after.size[1] === surface.size[1] &&
                after.sha256 === surface.sha256
              );
            });
          const composition = state.document.compositions.find(
            (candidate) => candidate.id === state.selectedCompositionId,
          );
          const duration = composition ? composition.duration : 0;
          const seconds = duration * 8 * 100 / 1000;
          const rounded = Math.max(0, Math.round(seconds));
          const hours = Math.floor(rounded / 3600);
          const minutes = Math.floor((rounded % 3600) / 60);
          const remaining = rounded % 60;
          const pad = (value) => String(value).padStart(2, '0');
          const formatted =
            hours > 0
              ? String(hours) + ':' + pad(minutes) + ':' + pad(remaining)
              : String(minutes) + ':' + pad(remaining);
          const panel = samples.closest('.ui-panel');
          const text = panel ? panel.textContent : '';
          const enabledAfterSelection = shutter.disabled === false;
          samples.value = '1';
          samples.dispatchEvent(new Event('change', { bubbles: true }));
          await wait(50);
          const playheadAfterRestore = session().getSnapshot().playheadFrame;
          return {
            ok:
              initialSamples === '1' &&
              shutterDisabledWhenOff &&
              enabledAfterSelection &&
              playheadBefore === playheadAfterSelection &&
              playheadBefore === playheadAfterRestore &&
              previewUnchanged &&
              text.includes('≈' + formatted) &&
              text.includes('só de estabilização') &&
              text.includes(String(duration) + ' frames × 8 amostras') &&
              text.includes('preview continua instantâneo'),
            initialSamples,
            shutterDisabledWhenOff,
            enabledAfterSelection,
            playheadBefore,
            playheadAfterSelection,
            playheadAfterRestore,
            previewUnchanged,
            previewBefore,
            previewAfterSelection,
            duration,
            formatted,
            text: text.slice(0, 1200),
          };
        })()`);
        motionProof.ui.queueOpened = queueOpenedForMotion;
      } catch (error) {
        motionProof.ui = {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await activateTabNamed(client, "Timeline", ".timeline-panel__canvas");
      }

      const pixelsLocalized =
        motionProof.pixels.allFramesDiffer &&
        motionProof.pixels.changedPixels > 100 &&
        motionProof.pixels.changedInsideCorridor === motionProof.pixels.changedPixels &&
        motionProof.pixels.changedOutsideCorridor === 0;
      record(
        "11 · motion blur acumula subframes reais, repete bytes e preserva os bypasses",
        motionProof.error === null &&
          motionProof.complete &&
          motionProof.hashesStable &&
          motionProof.bytesStable &&
          motionProof.distinctFrames === 3 &&
          motionProof.traceMatches &&
          motionProof.liveObserved &&
          motionProof.settleTiming &&
          motionProof.diagnostics &&
          motionProof.identities &&
          motionProof.fixtureRestored &&
          motionProof.refusal &&
          pixelsLocalized &&
          motionProof.ui?.ok === true &&
          motionProof.ui?.queueOpened === true,
        `A/B hashes=${motionProof.hashesStable} bytes=${motionProof.bytesStable}, ` +
          `frames distintos=${motionProof.distinctFrames}; ` +
          `trace=${motionProof.traceSamples}/12 correto=${motionProof.traceMatches}, ` +
          `subframes vistos ao vivo=${motionProof.liveFrames}/12; ` +
          `settle por amostra=${motionProof.settleTiming} ` +
          `(${motionProof.settleMinMs?.toFixed(1) ?? "?"}–${motionProof.settleMaxMs?.toFixed(1) ?? "?"} ms); ` +
          `diagnóstico Float32/SS=${motionProof.diagnostics}, ` +
          `bypasses=${motionProof.bypassDiagnostics
            .map(
              (diagnostic) =>
                `${diagnostic.label} ${diagnostic.shutterAngle}°/${diagnostic.samples} ` +
                `t/p/s=${diagnostic.total}/${diagnostic.processed}/${diagnostic.settled} ` +
                `trace=${diagnostic.trace} box=${diagnostic.box} ` +
                `hashes=${diagnostic.distinctHashes} seeks=${diagnostic.seen.join("/")}`,
            )
            .join("; ")}, ` +
          `ausente=ângulo0=amostra1 ${motionProof.identities ? "idênticos" : "DIVERGEM"}; ` +
          `fixture restaurada=${motionProof.fixtureRestored}; ` +
          `configuração inválida recusada antes da pasta=${motionProof.refusal}; ` +
          `pixels alterados=${motionProof.pixels.changedPixels}, ` +
          `dentro=${motionProof.pixels.changedInsideCorridor}, ` +
          `fora=${motionProof.pixels.changedOutsideCorridor}; ` +
          `estimativa antes do clique=${motionProof.ui?.ok === true} ` +
          `(${motionProof.ui?.formatted ?? motionProof.ui?.reason ?? "?"}), ` +
          `preview/playhead intactos=${motionProof.ui?.previewUnchanged === true && motionProof.ui?.playheadBefore === motionProof.ui?.playheadAfterSelection}` +
          `${motionProof.error === null ? "" : `; erro: ${motionProof.error}`}` +
          `${motionProof.pixels.error === null ? "" : `; pixel: ${motionProof.pixels.error}`}`,
      );
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
        // A entrada foi aceita apenas com histórico vazio. Depois de desfazer os
        // comandos da prova, apagar as entradas deixa a próxima rodada igualmente
        // limpa sem tocar em trabalho do usuário.
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
