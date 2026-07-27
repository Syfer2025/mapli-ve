/**
 * Prova automatizada dos cinco critérios de saída do bloco 7A (Biblioteca de
 * ativos), no Electron real. Requer `pnpm dev` rodando.
 *
 *   node tools/verify-phase7a.mjs
 *
 * 1. Importar um PNG → descriptor no documento, dedupe por hash, thumbnail no
 *    painel (object URL + <img> lazy).
 * 2. Aplicar → nó `image` com dimensões reais, textura no cache do Pixi,
 *    renderiza no frame e responde a property.set (animável).
 * 3. Round-trip do container `.theatrum` preserva descriptor e bytes (SHA-256
 *    idêntico) — o que "salvar e reabrir" garante, sem diálogo nativo.
 * 4. Remover um asset em uso → aviso lista os nós; removido, o nó permanece
 *    (sem imagem) e a textura sai do cache e da cena.
 * 5. 200 assets importados de uma vez → grid completo com thumbnails lazy.
 *
 * Como nas fases anteriores, o script desfaz tudo o que cria e compara o
 * documento com o estado inicial antes de sair.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
void ROOT;
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
const biblioteca = () => {
  const surface = window.__theatrumPhase7a;
  if (!surface) throw new Error('superfície 7A indisponível');
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
/** Igual ao da F6: hash + contagem de bytes não nulos do composto de exportação.
 *  Aqui não há guarda de mínimo: o sprite da prova é 64x48, pequeno demais para
 *  o limiar de 100 amostras calibrado para explosões de 5.000 partículas. As
 *  asserções são por diferença de hash entre estados, não por volume. */
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
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
};
/** PNG gerado em canvas: casco, torre e cano — um tanque de mentira, 64x48. */
const makeTankPng = async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b03a2e';
  ctx.fillRect(8, 16, 40, 20);
  ctx.fillStyle = '#7b241c';
  ctx.fillRect(20, 6, 22, 14);
  ctx.fillStyle = '#1b2631';
  ctx.fillRect(42, 11, 20, 4);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) throw new Error('canvas.toBlob falhou');
  return new File([blob], 'T-34 de teste.png', { type: 'image/png' });
};
const sha256Hex = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
          biblioteca: Boolean(window.__theatrumPhase7a),
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
    return {
      compositionId: state.selectedCompositionId,
      historyStart: state.history.cursor,
      playhead: state.playheadFrame,
      documentJson: JSON.stringify(canonical(state.document)),
    };
  })()`);
}

/** Critério 1: importar PNG → descriptor, dedupe por hash, thumbnail na hora. */
async function verifyImportAndThumbnail(client) {
  return client.evaluate(`(async()=>{
    const file = await makeTankPng();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(fileBytes);

    const antes = session().getSnapshot().document.assets.length;
    await session().actions.importAssetFiles([file]);

    const assets = session().getSnapshot().document.assets;
    if (assets.length !== antes + 1) {
      throw new Error('descriptor não entrou no documento (' + assets.length + ')');
    }
    const descriptor = assets[assets.length - 1];
    if (descriptor.kind !== 'image') throw new Error('kind errado: ' + descriptor.kind);
    if (descriptor.meta.name !== 'T-34 de teste') {
      throw new Error('nome errado: ' + String(descriptor.meta.name));
    }
    if (descriptor.meta.width !== 64 || descriptor.meta.height !== 48) {
      throw new Error('dimensões erradas: ' + JSON.stringify(descriptor.meta));
    }
    if (!descriptor.src.endsWith('/' + sha256 + '.png')) {
      throw new Error('src não carrega o hash do conteúdo: ' + descriptor.src);
    }

    // Importar o mesmo arquivo de novo é no-op — o hash é o id natural.
    await session().actions.importAssetFiles([file]);
    if (session().getSnapshot().document.assets.length !== antes + 1) {
      throw new Error('dedupe falhou: import duplicado criou outro descriptor');
    }

    const url = biblioteca().thumbnailUrl(descriptor.src);
    if (url === null || !url.startsWith('blob:')) {
      throw new Error('thumbnail sem object URL');
    }
    await wait(350);
    const img = document.querySelector('.library-card__thumb img');
    if (img === null) throw new Error('painel Biblioteca sem <img> de thumbnail');
    if (img.getAttribute('loading') !== 'lazy') throw new Error('thumbnail sem lazy loading');
    if (!img.src.startsWith('blob:')) throw new Error('<img> não usa o object URL do asset');

    return { assetId: descriptor.id, src: descriptor.src, sha256, thumbnailNoPainel: true };
  })()`);
}

/** Critério 2: aplicar → nó renderiza a imagem e responde a propriedade animável. */
async function verifyApplyRenders(client, imported) {
  return client.evaluate(`(async()=>{
    await atFrame(0);
    const semTanque = (await captureStats()).hash;

    const nodeId = session().actions.applyAsset(${JSON.stringify(imported.assetId)});
    if (nodeId === null) throw new Error('applyAsset falhou: ' + session().getSnapshot().error);

    const state = session().getSnapshot();
    const node = composition().nodes[nodeId];
    if (node === undefined) throw new Error('nó não foi criado');
    if (node.type !== 'image') throw new Error('tipo errado: ' + node.type);
    if (node.props.assetId.value !== ${JSON.stringify(imported.src)}) {
      throw new Error('assetId do nó errado: ' + String(node.props.assetId.value));
    }
    // Imagem menor que o teto de 480 px → o nó nasce no tamanho natural 64x48.
    if (node.size.size[0] !== 64 || node.size.size[1] !== 48) {
      throw new Error('tamanho do nó não segue a imagem: ' + JSON.stringify(node.size));
    }

    await wait(300);
    await atFrame(0);
    const info = await biblioteca().textureInfo(${JSON.stringify(imported.src)});
    if (info === null) throw new Error('textura não está no cache do Pixi');
    if (info.width !== 64 || info.height !== 48) {
      throw new Error('textura com dimensões erradas: ' + JSON.stringify(info));
    }

    const opaco = await captureStats();
    if (opaco.hash === semTanque) {
      throw new Error('o nó aplicado não mudou o frame — não renderizou');
    }
    if (opaco.nonzero === 0) throw new Error('captura vazia mesmo com o tanque aplicado');

    const setOpacity = (value) =>
      session().actions.dispatch({
        type: 'property.set',
        payload: {
          compositionId: composition().id,
          target: { kind: 'node', nodeId },
          path: ['transform', 'opacity'],
          value,
        },
        source: 'system',
      });

    if (!setOpacity(0.15)) throw new Error('property.set rejeitado: ' + session().getSnapshot().error);
    await wait(250);
    await atFrame(0);
    const transparente = (await captureStats()).hash;
    if (transparente === opaco.hash) {
      throw new Error('opacidade não alterou o frame — nó não animável');
    }

    if (!setOpacity(1)) throw new Error('restaurar opacidade rejeitado');
    await wait(250);
    await atFrame(0);
    const restaurado = (await captureStats()).hash;
    if (restaurado !== opaco.hash) {
      throw new Error('restaurar opacidade não restaurou o frame');
    }

    return {
      nodeId,
      semTanque,
      amostrasNaoNulasComTanque: opaco.nonzero,
      texturaNoPixi: true,
      animavelPorPropriedade: true,
    };
  })()`);
}

/** Critério 3: salvar e reabrir — round-trip do container preserva tudo. */
async function verifyContainerRoundTrip(client, imported) {
  return client.evaluate(`(async()=>{
    const result = await biblioteca().containerRoundTrip();
    if (!result.ok) throw new Error('round-trip falhou: ' + result.error);
    const encontrado = (result.assets ?? []).find(
      (entry) => entry.path === ${JSON.stringify(imported.src)},
    );
    if (encontrado === undefined) throw new Error('bytes do asset não estão no container');
    if (encontrado.sha256 !== ${JSON.stringify(imported.sha256)}) {
      throw new Error('bytes divergem após o round-trip');
    }
    if (result.descriptors !== 1) {
      throw new Error('descriptor não sobreviveu ao round-trip: ' + result.descriptors);
    }
    return {
      containerBytes: result.containerBytes,
      descriptors: result.descriptors,
      sha256Preservado: true,
    };
  })()`);
}

/** Critério 4: remover asset em uso → aviso lista nós; nó fica, imagem sai. */
async function verifyRemoveInUse(client, imported, applied) {
  return client.evaluate(`(async()=>{
    const usages = session().actions.assetUsages(${JSON.stringify(imported.assetId)});
    if (usages.length !== 1) throw new Error('esperava 1 uso, achei ' + usages.length);
    if (usages[0].nodeId !== ${JSON.stringify(applied.nodeId)}) {
      throw new Error('o aviso de uso aponta o nó errado');
    }
    if (usages[0].propertyPath !== 'props.assetId') {
      throw new Error('propertyPath errado: ' + usages[0].propertyPath);
    }

    if (!session().actions.removeAsset(${JSON.stringify(imported.assetId)})) {
      throw new Error('removeAsset falhou');
    }
    const state = session().getSnapshot();
    if (state.document.assets.length !== 0) throw new Error('descriptor não saiu do documento');

    // O nó permanece, com a referência intacta — só a imagem some.
    const node = composition().nodes[${JSON.stringify(applied.nodeId)}];
    if (node === undefined) throw new Error('o nó sumiu junto com o asset');
    if (node.props.assetId.value !== ${JSON.stringify(imported.src)}) {
      throw new Error('o nó perdeu a referência — deveria preservá-la');
    }

    const info = await biblioteca().textureInfo(${JSON.stringify(imported.src)});
    if (info !== null) throw new Error('textura continua no cache após a remoção');
    if (biblioteca().thumbnailUrl(${JSON.stringify(imported.src)}) !== null) {
      throw new Error('thumbnail continua ativo após a remoção');
    }

    await wait(300);
    await atFrame(0);
    const semImagem = (await captureStats()).hash;
    if (semImagem !== ${JSON.stringify(applied.semTanque)}) {
      throw new Error('a imagem não saiu da cena após a remoção do asset');
    }

    return { avisoListaNos: true, noPreservado: true, imagemForaDaCena: true };
  })()`);
}

/** Critério 5: 200 assets de uma vez → grid completo, thumbnails lazy. */
async function verifyBulkImport(client) {
  return client.evaluate(`(async()=>{
    const files = [];
    for (let index = 0; index < 200; index += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#' + ((index * 9973) % 0xffffff).toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, 8, 8);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      files.push(
        new File([blob], 'lote-' + String(index).padStart(3, '0') + '.png', { type: 'image/png' }),
      );
    }

    const inicio = performance.now();
    await session().actions.importAssetFiles(files);
    const duracaoMs = performance.now() - inicio;

    const total = session().getSnapshot().document.assets.length;
    if (total !== 200) throw new Error('esperava 200 assets, há ' + total);

    await wait(400);
    const grid = document.querySelector('.library__grid');
    if (grid === null) throw new Error('grid da Biblioteca ausente');
    if (grid.children.length !== 200) {
      throw new Error('grid com ' + grid.children.length + ' cards, não 200');
    }
    const lazy = grid.querySelectorAll('img[loading="lazy"]').length;
    if (lazy !== 200) throw new Error('thumbnails sem lazy: ' + lazy + '/200');

    return { importados: 200, duracaoMs: Math.round(duracaoMs), thumbnailsLazy: lazy };
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

async function main() {
  const page = await pageTarget();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  let baseline;
  try {
    await client.request("Page.bringToFront");
    await waitForRenderer(client);
    baseline = await captureBaseline(client);

    const importado = await verifyImportAndThumbnail(client);
    const aplicado = await verifyApplyRenders(client, importado);
    const roundTrip = await verifyContainerRoundTrip(client, importado);
    const remocao = await verifyRemoveInUse(client, importado, aplicado);
    const lote = await verifyBulkImport(client);
    const cleanup = await restoreSession(client, baseline);

    console.log(
      JSON.stringify(
        {
          ok: true,
          criteria: {
            "1-importa-e-mostra-thumbnail": importado,
            "2-aplicar-renderiza-e-anima": aplicado,
            "3-round-trip-preserva-bytes": roundTrip,
            "4-remover-em-uso-avisa-e-preserva-no": remocao,
            "5-200-assets-thumbnails-lazy": lote,
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
