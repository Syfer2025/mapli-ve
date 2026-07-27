// Captura close-up do nó model3d para avaliar shading/iluminação.
// Requer o app rodando (pnpm dev) com o cenário do demo-f18 já montado.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS_DIR = path.join(ROOT, "demo-f18");

const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const target = list.find((t) => t.type === "page" && t.url.includes("localhost"));
if (!target) throw new Error("Página do editor não encontrada no CDP.");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function request(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await request("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? "erro no renderer");
  return r.result.value;
}

const center = await evaluate(`(async()=>{
  const S = window.__theatrumPhase3;
  const map = window.__theatrumPhase2.map;
  S.actions.pause();
  S.actions.setPlayhead(330);
  await window.__theatrumPhase2.settle(1200);
  // NDC do centro do modelo → pixel do canvas → lngLat no mapa.
  const deadline = Date.now() + 8000;
  let ndc = null;
  while (Date.now() < deadline) {
    const status = window.__theatrumScene3d.status();
    if (status.ndc && status.loaded >= 1) { ndc = status.ndc; break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!ndc) throw new Error("NDC do modelo indisponível");
  const canvas = map.getCanvas();
  const px = ((ndc[0] + 1) / 2) * canvas.width;
  const py = ((1 - ndc[1]) / 2) * canvas.height;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const lngLat = map.unproject([px * scaleX, py * scaleY]);
  map.jumpTo({ center: [lngLat.lng, lngLat.lat], zoom: 7.4, pitch: 62, bearing: 35 });
  await window.__theatrumPhase2.settle(2000);
  return [lngLat.lng, lngLat.lat];
})()`);
console.log(`Avião em ${center}`);
await new Promise((r) => setTimeout(r, 900));
const shot = await request("Page.captureScreenshot", { format: "png" });
await mkdir(SHOTS_DIR, { recursive: true });
const file = path.join(SHOTS_DIR, "closeup.png");
await writeFile(file, Buffer.from(shot.data, "base64"));
console.log(`Close-up salvo: ${file}`);

// Restaura a visão geral e o loop.
await evaluate(`(async()=>{
  const map = window.__theatrumPhase2.map;
  map.jumpTo({ center: [31.5, 52.3], zoom: 4.55, bearing: 0, pitch: 45 });
  const S = window.__theatrumPhase3;
  S.actions.setLoop(true);
  S.actions.setPlayhead(0);
  S.actions.play();
  return true;
})()`);
try {
  await request("Page.bringToFront");
} catch {
  // Foco de janela é best-effort; a captura não depende disso.
}
ws.close();
