/**
 * Prova opt-in de UHD-2/8K no Electron real.
 *
 * Requer `pnpm dev`. Conduz uma composição temporariamente a 1920×1080,
 * exporta um frame em escala 4 duas vezes e exige 7680×4320, settle limpo e
 * hashes idênticos. O documento volta byte a byte ao estado inicial por undo.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 240_000;
const outputDirectory = join(tmpdir(), "theatrum-verify-phase8-8k").replaceAll("\\", "/");

const target = await pageTarget();
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.connect();

const result = await client.evaluate(`(async () => {
  const session = window.__theatrumPhase3;
  const overlay = window.__theatrumPhase4;
  const mapSurface = window.__theatrumPhase2;
  if (session === undefined || overlay === undefined || mapSurface === undefined) {
    throw new Error("superfícies de verificação indisponíveis");
  }
  const originalSession = session.getSnapshot();
  session.actions.pause();
  const before = JSON.stringify(originalSession.document);
  const compositionId = originalSession.selectedCompositionId;
  const composition = originalSession.document.compositions.find(
    (candidate) => candidate.id === compositionId,
  );
  if (composition === undefined) throw new Error("composição selecionada ausente");
  const needsResolutionChange = composition.width !== 1920 || composition.height !== 1080;
  if (needsResolutionChange) {
    const changed = session.commandBus.dispatch({
      type: "composition.set-resolution",
      payload: { compositionId, width: 1920, height: 1080 },
      source: "script",
    });
    if (!changed.ok) throw new Error(changed.error.message);
  }

  try {
    await mapSurface.settle(10_000);
    const options = {
      range: { first: 0, last: 0 },
      directory: ${JSON.stringify(outputDirectory)},
      scale: 4,
    };
    const first = await overlay.exportPngSequence(options);
    const second = await overlay.exportPngSequence(options);
    const canvas = mapSurface.map.getCanvas();
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return {
      first: summarize(first),
      second: summarize(second),
      maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? null,
    };
  } finally {
    if (needsResolutionChange) session.commandBus.undo();
    session.actions.setLoop(originalSession.loopPlayback);
    session.actions.setPlayhead(originalSession.playheadFrame);
    if (originalSession.isPlaying) session.actions.play();
    const after = JSON.stringify(session.getSnapshot().document);
    if (after !== before) throw new Error("undo não restaurou o documento depois da prova 8K");
  }

  function summarize(exported) {
    return {
      ok: exported.ok,
      message: exported.message ?? null,
      resolution: exported.resolution?.output ?? null,
      written: exported.report?.written ?? 0,
      settleFailed: exported.report?.settleFailed ?? -1,
      hashes: exported.report?.hashes ?? [],
      errors: exported.report?.errors ?? [],
    };
  }
})()`);

client.close();

const firstHash = result.first.hashes[0]?.sha256;
const secondHash = result.second.hashes[0]?.sha256;
const passed =
  result.first.ok === true &&
  result.second.ok === true &&
  result.first.written === 1 &&
  result.second.written === 1 &&
  result.first.settleFailed === 0 &&
  result.second.settleFailed === 0 &&
  result.first.resolution?.[0] === 7680 &&
  result.first.resolution?.[1] === 4320 &&
  result.second.resolution?.[0] === 7680 &&
  result.second.resolution?.[1] === 4320 &&
  typeof firstHash === "string" &&
  firstHash === secondHash;

console.log(
  `${passed ? "PASSA" : "FALHA"} · UHD-2 7680×4320 · MAX_TEXTURE_SIZE=${String(result.maxTextureSize)}`,
);
console.log(
  `primeiro=${firstHash ?? result.first.message ?? result.first.errors.join("; ")}\n` +
    `segundo=${secondHash ?? result.second.message ?? result.second.errors.join("; ")}\n` +
    `saída=${outputDirectory}`,
);
if (!passed) process.exitCode = 1;

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
    (candidate) => candidate.type === "page" && !candidate.url.startsWith("devtools://"),
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
      await new Promise((resolvePromise, reject) => {
        this.#socket.addEventListener("open", resolvePromise, { once: true });
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
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timeout CDP em ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve: resolvePromise, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(
        `renderer: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`,
      );
    }
    return response.result.value;
  }

  close() {
    this.#socket.close();
  }
}
