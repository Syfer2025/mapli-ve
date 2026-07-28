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
 * 4. O video DECODIFICA: o proprio Chromium abre o arquivo e reporta duracao e
 *    dimensoes. Estrutura correta que nao decodifica nao serve de nada.
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
const SAIDA = join(tmpdir(), "theatrum-verify-video").replaceAll("\\", "/");

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
  while (S.commandBus.history.canUndo()) S.commandBus.history.undo();
  await wait(300);
  mapa().jumpTo({ center: [35.6, 50.2], zoom: 6, pitch: 0, bearing: 0 });
  await window.__theatrumPhase2.settle(4000);

  const ucr = S.actions.addGeoFeature({ id: 'c:UKR', name: 'Ucrania', kind: 'country' }, [31.2, 48.4]);
  if (ucr) S.actions.setPropertyValue(ucr, 'props.fillAlpha', 0.5);
  const rot = S.actions.addNodeOfType('text.label');
  S.actions.setNodeAnchor(rot, { space: 'geo', lngLat: [36.23, 49.99] });
  S.actions.setPropertyValue(rot, 'props.text', 'KHARKIV');
  S.actions.setPropertyValue(rot, 'props.fontSize', 40);
  S.actions.setPlayhead(0);
  S.actions.togglePropertyKeyframe(rot, 'transform.opacity');
  S.actions.setPropertyValue(rot, 'transform.opacity', 0.1);
  S.actions.setPlayhead(11);
  S.actions.setPropertyValue(rot, 'transform.opacity', 1);
  S.actions.setPlayhead(0);
  S.actions.clearSelection();
  await window.__theatrumPhase2.settle(3000);
  await wait(600);
  return { rot, ucr };
})()`;

const EXPORTAR_VIDEO = `(async () => {
  const r = await overlay().exportPngSequence({
    format: 'mp4',
    range: { first: 0, last: 11 },
    directory: ${JSON.stringify(SAIDA)},
  });
  return {
    ok: r.ok,
    message: r.message ?? null,
    videoFile: r.videoFile ?? null,
    videoBytes: r.videoBytes ?? 0,
    written: r.report ? r.report.written : 0,
    settleFailed: r.report ? r.report.settleFailed : -1,
    errors: r.report ? r.report.errors : [],
  };
})()`;

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

async function main() {
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  const baseline = await client.evaluate(
    `(async () => {
      session().actions.pause();
      session().actions.clearSelection();
      await wait(120);
      return JSON.stringify(canonical(session().getSnapshot().document));
    })()`,
  );

  try {
    await client.evaluate(MONTAR_CENA);
    const primeira = await client.evaluate(EXPORTAR_VIDEO);

    // ── 1. O arquivo existe e é um MP4 ──────────────────────────────────────
    if (primeira.videoFile === null) {
      record(
        "1 · o arquivo de vídeo sai do export",
        false,
        `sem arquivo: ${primeira.message ?? primeira.errors.join("; ")}`,
      );
    } else {
      const caminho = join(SAIDA, primeira.videoFile);
      const bytes = readFileSync(caminho);
      // Um MP4 começa com o tamanho do `ftyp` e depois "ftyp" em ASCII.
      const assinatura = bytes.toString("ascii", 4, 8);
      record(
        "1 · o arquivo de vídeo sai do export",
        assinatura === "ftyp" && bytes.length > 1000,
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
      const segunda = await client.evaluate(EXPORTAR_VIDEO);
      const bytesB = readFileSync(join(SAIDA, segunda.videoFile ?? primeira.videoFile));
      const hashB = createHash("sha256").update(bytesB).digest("hex");
      record(
        "3 · exportar duas vezes dá o mesmo arquivo de vídeo",
        hashA === hashB && bytes.length === bytesB.length,
        `${(bytes.length / 1024).toFixed(0)} kB e ${(bytesB.length / 1024).toFixed(0)} kB; ` +
          `sha ${hashA.slice(0, 12)} e ${hashB.slice(0, 12)} — ` +
          (hashA === hashB ? "IDÊNTICOS" : "DIVERGEM"),
      );

      // ── 4. O vídeo decodifica de verdade ──────────────────────────────────
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
          v.src = url;
          const resultado = await new Promise((resolve) => {
            const fim = setTimeout(() => resolve({ erro: 'timeout ao carregar' }), 10000);
            v.addEventListener('loadedmetadata', () => {
              clearTimeout(fim);
              resolve({ duracao: v.duration, largura: v.videoWidth, altura: v.videoHeight });
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
          decodificado.largura > 0 &&
          decodificado.altura > 0 &&
          decodificado.duracao > 0,
        decodificado.erro === undefined
          ? `${decodificado.largura}×${decodificado.altura}, ${decodificado.duracao.toFixed(2)} s`
          : `falhou: ${decodificado.erro}`,
      );

      record(
        "5 · relatório sem falha de settle nem erro",
        primeira.settleFailed === 0 && primeira.errors.length === 0,
        `settleFailed=${primeira.settleFailed}, erros=${primeira.errors.length}`,
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
        return { n, doc: JSON.stringify(canonical(session().getSnapshot().document)) };
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
