/**
 * Cliente CDP mínimo, extraído dos verificadores para as sondas de bancada.
 *
 * Mesma forma de `tools/verify-phase8.mjs`: acha o alvo de página, abre o
 * WebSocket, e avalia expressão com o prelúdio de atalhos já injetado.
 */

const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 240_000;

export const PRELUDE = `
const session = () => window.__theatrumPhase3;
const overlay = () => window.__theatrumPhase4;
const mapa = () => window.__theatrumPhase2.map;
const estudio = () => window.__theatrumStudio;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
};
/** Soma de canais de uma superfície, reduzida a 32x32 — prova de legibilidade. */
const somaSuperficie = (sel) => {
  const c = document.querySelector(sel);
  if (c === null) return null;
  const s = document.createElement('canvas');
  s.width = 32; s.height = 32;
  const ctx = s.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(c, 0, 0, 32, 32);
  const px = ctx.getImageData(0, 0, 32, 32).data;
  let soma = 0;
  for (let i = 0; i < px.length; i += 4) soma += px[i] + px[i + 1] + px[i + 2];
  return { sel, fisico: [c.width, c.height], css: [c.clientWidth, c.clientHeight], soma };
};
`;

export async function pageTarget() {
  let response;
  try {
    response = await fetch(DEBUG_URL);
  } catch {
    throw new Error("Electron de desenvolvimento não encontrado. Inicie o dev.");
  }
  if (!response.ok) throw new Error(`CDP respondeu ${response.status}`);
  const targets = await response.json();
  const page = targets.find(
    (target) => target.type === "page" && !target.url.startsWith("devtools://"),
  );
  if (page === undefined) throw new Error("renderer Electron não encontrado na porta CDP");
  return page;
}

export class CdpClient {
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

/** Põe uma aba do dockview na frente. Ver 09-CONTINUIDADE § armadilha do painel. */
export async function activateTab(client, label, mountedSelector) {
  const mounted = () =>
    client.evaluate(`Boolean(document.querySelector(${JSON.stringify(mountedSelector)}))`);
  if ((await mounted()) === true) return;
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
  if (clicked !== true) throw new Error(`aba ${label} não existe`);
  const deadline = Date.now() + 8000;
  for (;;) {
    if ((await mounted()) === true) return;
    if (Date.now() > deadline) throw new Error(`${label} não montou depois de ativar a aba`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function open() {
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return client;
}
