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
 *
 * Escreve numa pasta temporária escolhida sem diálogo (o verificador chama o
 * escritor direto), e desfaz o que criou no documento.
 */

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
const SAIDA = join(tmpdir(), "theatrum-verify-phase8").replaceAll("\\", "/");

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

/** Monta uma cena pequena com mapa, território e rótulo, e enquadra. */
const MONTAR_CENA = `(async () => {
  const S = session();
  S.actions.pause();
  while (S.commandBus.history.canUndo()) S.commandBus.history.undo();
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
  const response = await fetch('/models/fa-18f.glb');
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

      // ── 5. A cena suspeita: dois nós geo com filtro ──────────────────────
      //
      // O 09-CONTINUIDADE carregava uma suspeita herdada: com região **e**
      // estradas pintando ao mesmo tempo, aplicar outline+glow derrubou a área
      // da captura de 1,25 M para 539 mil pixels, uma vez, sem reproduzir. Ou o
      // caminho de captura com filtros é instável — e aí o export não presta —
      // ou o episódio foi outra coisa. Montar a cena e exportar duas vezes é o
      // que resolve a dúvida em vez de carregá-la para a próxima fase.
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
          return {
            estradas: est !== null,
            outline: outline !== null,
            glow: glow !== null,
            erro: S.getSnapshot().error ?? null,
            a: a.report ? a.report.hashes : [],
            b: b.report ? b.report.hashes : [],
            bytesA: a.report ? a.report.written : 0,
          };
        })()`,
      );
      const filtrosIguais =
        comFiltros.a.length > 0 &&
        comFiltros.a.length === comFiltros.b.length &&
        comFiltros.a.every((h, i) => h.sha256 === comFiltros.b[i].sha256);
      // E os frames continuam diferentes entre si: com filtro instável o
      // esperado seria variação onde não deveria haver, ou nenhuma onde deveria.
      const filtrosDistintos = new Set(comFiltros.a.map((h) => h.sha256)).size;
      record(
        "5 · export estável com dois nós geo e filtros aplicados",
        filtrosIguais && filtrosDistintos > 1,
        `estradas=${comFiltros.estradas} outline=${comFiltros.outline} glow=${comFiltros.glow}; ` +
          `${comFiltros.bytesA} frames, hashes entre execuções ${filtrosIguais ? "idênticos" : "DIVERGEM"}, ` +
          `${filtrosDistintos} distintos entre frames` +
          `${comFiltros.erro === null ? "" : `; erro na sessão: ${comFiltros.erro}`}`,
      );

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
        frio3d.hashes.length === comFiltros.b.length &&
        frio3d.hashes.some((hash, index) => hash.sha256 !== comFiltros.b[index]?.sha256);
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
