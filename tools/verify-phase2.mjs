/**
 * Verifica os critérios de saída da Fase 2 no renderer Electron real.
 *
 * Requer `pnpm dev` rodando. A porta CDP só existe em desenvolvimento.
 * O PMTiles é renomeado por ~300 ms para provar o timeout e sempre restaurado
 * em `finally`, inclusive quando uma asserção falha.
 */

import { access, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = path.join(ROOT, "data");
const PMTILES_PATH = path.join(DATA_ROOT, "basemap", "natural-earth-world.pmtiles");
const HIDDEN_PMTILES_PATH = `${PMTILES_PATH}.verification-unavailable`;
const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 30_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pageTarget() {
  const response = await fetch(DEBUG_URL);
  if (!response.ok) throw new Error(`CDP respondeu ${response.status}`);
  const targets = await response.json();
  const page = targets.find(
    (target) => target.type === "page" && !target.url.startsWith("devtools://"),
  );
  if (page === undefined) throw new Error("renderer Electron não encontrado");
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
    if (this.#socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener("open", resolve, { once: true });
      this.#socket.addEventListener("error", () => reject(new Error("falha no WebSocket CDP")), {
        once: true,
      });
    });

    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(new Error(`CDP: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
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
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(
        `renderer: ${response.exceptionDetails.text} ${response.result?.description ?? ""}`,
      );
    }
    return response.result.value;
  }

  close() {
    this.#socket.close();
  }
}

async function waitForRenderer(client) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const ready = await client.evaluate(
        "Boolean(window.__theatrumPhase2?.map && document.querySelector('.map-viewport'))",
      );
      if (ready) return;
    } catch {
      // O execution context é substituído durante reload.
    }
    await delay(100);
  }
  throw new Error("viewport não ficou pronto em 10 s");
}

async function reloadRenderer(client) {
  await client.request("Page.reload", { ignoreCache: true });
  // `Page.reload` confirma o pedido antes de destruir o execution context.
  // Sem esta pequena janela, a checagem pode enxergar a página antiga.
  await delay(300);
  await waitForRenderer(client);
  await client.evaluate(
    "(async()=>{const d=window.__theatrumPhase2;const limit=performance.now()+5000;while((!d.map.loaded()||!d.map.areTilesLoaded())&&performance.now()<limit){await new Promise(r=>setTimeout(r,25));}return true})()",
  );
}

async function verifyRange(client) {
  const result = await client.evaluate(`(async()=>{
    const url='theatrum-data://local/basemap/natural-earth-world.pmtiles';
    const response=await fetch(url,{headers:{Range:'bytes=0-126'}});
    const bytes=await response.arrayBuffer();
    const invalid=await fetch(url,{headers:{Range:'bytes=999999999-1000000000'}});
    const traversal=await fetch('theatrum-data://local/%2e%2e%2fpackage.json');
    const host=await fetch('theatrum-data://invalid/basemap/natural-earth-world.pmtiles');
    const post=await fetch(url,{method:'POST',body:'x'});
    return {
      status:response.status,
      bytes:bytes.byteLength,
      contentRange:response.headers.get('content-range'),
      contentLength:response.headers.get('content-length'),
      magic:new TextDecoder().decode(bytes.slice(0,7)),
      invalidStatus:invalid.status,
      invalidRange:invalid.headers.get('content-range'),
      traversal:traversal.status,
      host:host.status,
      post:post.status
    };
  })()`);

  assert(result.status === 206, `Range deveria responder 206, recebeu ${result.status}`);
  assert(result.bytes === 127, `Range devolveu ${result.bytes} bytes`);
  assert(result.contentRange === "bytes 0-126/3829650", "Content-Range divergente");
  assert(result.contentLength === "127", "Content-Length divergente");
  assert(result.magic === "PMTiles", "magic PMTiles ausente");
  assert(result.invalidStatus === 416, "range impossível não respondeu 416");
  assert(result.invalidRange === "bytes */3829650", "416 sem tamanho do arquivo");
  assert(result.traversal === 404, "traversal não foi rejeitado");
  assert(result.host === 400, "host incorreto não foi rejeitado");
  assert(result.post === 405, "método de escrita não foi rejeitado");
  return result;
}

async function verifyStyles(client) {
  const result = await client.evaluate(`(async()=>{
    const map=window.__theatrumPhase2.map;
    const module=await import('/src/panels/viewport/map-styles.ts');
    const styles=[];
    for(const option of module.MAP_STYLE_OPTIONS){
      const style=module.createMapStyle(option.id);
      const serialized=JSON.stringify(style);
      if(/https?:\\/\\/|mapbox:\\/\\/|cdn\\./i.test(serialized)){
        throw new Error(option.id+' contém URL externa');
      }
      map.setStyle(style,{diff:false});
      const limit=performance.now()+5000;
      while(
        (map.getStyle()?.name!==option.label||!map.isStyleLoaded())&&
        performance.now()<limit
      ){
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      styles.push({
        id:option.id,
        name:map.getStyle()?.name,
        loaded:map.isStyleLoaded()
      });
    }
    const external=performance.getEntriesByType('resource')
      .map(entry=>entry.name)
      .filter(url=>/^https?:/i.test(url)&&!url.startsWith('http://localhost:5273/'));
    return {styles,external};
  })()`);

  assert(result.styles.length === 3, "quantidade de estilos divergente");
  assert(
    result.styles.every((style) => style.loaded),
    "um estilo não terminou de carregar",
  );
  assert(result.external.length === 0, `recursos externos: ${result.external.join(", ")}`);
  return result;
}

async function verifyProjector(client) {
  const result = await client.evaluate(`(async()=>{
    const map=window.__theatrumPhase2.map;
    const module=await import('/src/panels/viewport/maplibre-adapters.ts');
    const projector=module.createMapLibreProjectorPort(map);
    const point=[36.1874,51.7304];
    const results=[];
    for(const pitch of [0,45,70]){
      map.jumpTo({center:[30,55],zoom:4.5,bearing:23,pitch});
      await new Promise(resolve=>setTimeout(resolve,40));
      const expected=map.project(point);
      const actual=projector.project(point);
      results.push({
        pitch,
        delta:Math.hypot(actual[0]-expected.x,actual[1]-expected.y),
        snapshotPitch:projector.snapshot().pitch
      });
    }
    return results;
  })()`);

  assert(result.length === 3, "projeções ausentes");
  assert(
    result.every((item) => item.delta === 0),
    "ProjectorPort divergiu de map.project()",
  );
  assert(
    result.every((item) => item.pitch === item.snapshotPitch),
    "snapshot perdeu pitch",
  );
  return result;
}

async function verifyGazetteer(client) {
  const result = await client.evaluate(`(async()=>{
    const module=await import('/src/panels/viewport/natural-earth-gazetteer.ts');
    const gazetteer=await module.loadNaturalEarthGazetteer();
    const kursk=gazetteer.resolveResult('Kursk, RU');
    const springfield=gazetteer.resolveResult('Springfield');
    return {
      kursk,
      springfieldStatus:springfield.status,
      springfields:springfield.status==='ambiguous'
        ? springfield.hits.map(hit=>hit.admin1)
        : []
    };
  })()`);

  assert(result.kursk.status === "resolved", "Kursk não resolveu");
  assert(result.kursk.hit.country === "RU", "Kursk resolveu no país errado");
  assert(result.springfieldStatus === "ambiguous", "Springfield não ficou ambíguo");
  assert(result.springfields.length === 5, "Natural Earth deveria trazer 5 Springfields");
  return result;
}

async function verifyPlayback(client) {
  const result = await client.evaluate(`(async()=>{
    const stop=Array.from(document.querySelectorAll('button'))
      .find(button=>button.getAttribute('aria-label')==='Parar');
    stop?.click();
    const play=Array.from(document.querySelectorAll('button'))
      .find(button=>button.getAttribute('aria-label')==='Reproduzir');
    play?.click();
    await new Promise(resolve=>setTimeout(resolve,6200));
    const map=window.__theatrumPhase2.map;
    return {
      frame:Number(document.querySelector('.map-viewport__scrub')?.value),
      center:[map.getCenter().lng,map.getCenter().lat],
      zoom:map.getZoom(),
      bearing:map.getBearing(),
      pitch:map.getPitch()
    };
  })()`);

  assert(result.frame === 360, `playback terminou no frame ${result.frame}`);
  assert(Math.abs(result.center[0] - 30.3158) < 1e-9, "longitude final divergente");
  assert(Math.abs(result.center[1] - 59.9391) < 1e-9, "latitude final divergente");
  assert(Math.abs(result.zoom - 7.05) < 1e-9, "zoom final divergente");
  assert(Math.abs(result.bearing - 18) < 1e-9, "bearing final divergente");
  assert(Math.abs(result.pitch - 56) < 1e-9, "pitch final divergente");
  return result;
}

async function verifySettlePerformance(client) {
  const result = await client.evaluate(`(async()=>{
    const debug=window.__theatrumPhase2;
    const states=[
      [-3.7,40.4,4],[2.35,48.86,5],[30.3,59.9,5],[37.6,55.75,5],
      [-74,40.7,4],[-99,39,3],[139.7,35.7,4],[116.4,39.9,4],
      [28,-29,4],[151.2,-33.9,4]
    ];
    const times=[];
    const results=[];
    for(const [lng,lat,zoom] of states){
      debug.cameraPort.apply({center:[lng,lat],zoom,bearing:12,pitch:35},'jump');
      const started=performance.now();
      results.push(await debug.settle(2000));
      times.push(performance.now()-started);
    }
    const sorted=[...times].sort((a,b)=>a-b);
    return {
      times:times.map(value=>Number(value.toFixed(1))),
      p50:Number(sorted[Math.floor(sorted.length/2)].toFixed(1)),
      max:Number(Math.max(...times).toFixed(1)),
      allSettled:results.every(item=>item.settled)
    };
  })()`);

  assert(result.allSettled, "uma vista local não assentou");
  assert(result.p50 < 100, `p50 de settle foi ${result.p50} ms`);
  return result;
}

async function verifyMissingPmtilesTimeout(client) {
  const relative = path.relative(DATA_ROOT, PMTILES_PATH);
  assert(!relative.startsWith("..") && !path.isAbsolute(relative), "PMTiles fora de data/");
  await access(PMTILES_PATH);
  try {
    await access(HIDDEN_PMTILES_PATH);
    throw new Error(`arquivo temporário já existe: ${HIDDEN_PMTILES_PATH}`);
  } catch (error) {
    if (error instanceof Error && !("code" in error && error.code === "ENOENT")) throw error;
  }

  await rename(PMTILES_PATH, HIDDEN_PMTILES_PATH);
  try {
    const result = await client.evaluate(`(async()=>{
      const debug=window.__theatrumPhase2;
      const style=debug.map.getStyle();
      style.sources['natural-earth'].url=
        'pmtiles://theatrum-data://local/basemap/natural-earth-world.pmtiles';
      debug.map.setStyle(style,{diff:false});
      debug.map.jumpTo({center:[179,-70],zoom:6,bearing:0,pitch:35});
      const started=performance.now();
      const settleResult=await debug.settle(300);
      return {settleResult,elapsed:performance.now()-started};
    })()`);

    assert(result.settleResult.settled === false, "PMTiles ausente declarou settle");
    assert(result.settleResult.reason === "timeout", "falha não foi classificada como timeout");
    assert(result.elapsed >= 300 && result.elapsed < 600, `timeout levou ${result.elapsed} ms`);
    return result;
  } finally {
    await rename(HIDDEN_PMTILES_PATH, PMTILES_PATH);
  }
}

async function main() {
  const page = await pageTarget();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  try {
    await reloadRenderer(client);
    const range = await verifyRange(client);
    const styles = await verifyStyles(client);
    const projector = await verifyProjector(client);
    const gazetteer = await verifyGazetteer(client);
    const playback = await verifyPlayback(client);
    const settle = await verifySettlePerformance(client);
    const missingPmtiles = await verifyMissingPmtilesTimeout(client);
    await reloadRenderer(client);

    console.log(
      JSON.stringify(
        {
          ok: true,
          range,
          styles: styles.styles,
          projector,
          gazetteer: {
            kursk: gazetteer.kursk.hit,
            springfields: gazetteer.springfields,
          },
          playback,
          settle,
          missingPmtiles,
        },
        null,
        2,
      ),
    );
  } finally {
    client.close();
  }
}

await main();
