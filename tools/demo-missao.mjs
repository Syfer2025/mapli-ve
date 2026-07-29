/**
 * Missão de demonstração: exercita o máximo do que o Theatrum sabe fazer, numa
 * composição só, e exporta em MP4.
 *
 *   node tools/demo-missao.mjs
 *
 * O que entra, e de qual bloco vem:
 *
 * | Bloco  | O que a missão usa                                            |
 * | ------ | ------------------------------------------------------------- |
 * | F2     | Mapa offline com relevo, câmera inclinada e girada             |
 * | F5     | Caminhos bezier compartilhados; comportamento `motion-path`    |
 * | F6     | Filtro `glow` no território; partículas de explosão            |
 * | 7A+    | Modelo 3D GLB da biblioteca local voando sobre o terreno       |
 * | 7B     | Território `geo.region` com preenchimento e contorno           |
 * | 7B.1   | Camada de estradas do país                                     |
 * | 7C     | Duas setas de avanço revelando, e um eixo previsto tracejado   |
 * | 7D     | Topônimos com halo, entrando em sequência                      |
 * | 7E.2   | Rótulo com guia acompanhando a aeronave                        |
 * | F8     | Export para MP4 H.264                                          |
 *
 * Cada etapa relata o que criou, então uma falha aparece na etapa dela e não
 * como um vídeo vazio no fim.
 */

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAIDA = join(tmpdir(), "theatrum-missao").replaceAll("\\", "/");
const DURACAO = 300;

async function pageTarget() {
  const response = await fetch("http://localhost:9222/json/list").catch(() => null);
  if (response === null) throw new Error("Electron não encontrado. Inicie `pnpm dev`.");
  const targets = await response.json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("5273"));
  if (page === undefined) throw new Error("página do editor não encontrada");
  return page;
}

class Cdp {
  #socket;
  #nextId = 1;
  #pending = new Map();

  constructor(url) {
    this.#socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      if (this.#socket.readyState === WebSocket.OPEN) return resolve();
      this.#socket.addEventListener("open", resolve, { once: true });
      this.#socket.addEventListener("error", () => reject(new Error("WebSocket CDP")), {
        once: true,
      });
    });
    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message);
    });
  }

  call(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout em ${method}`)), 600_000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async run(expression) {
    const message = await this.call("Runtime.evaluate", {
      expression: `(async () => {${PRELUDE}\n${expression}})()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    const detail = message.result?.exceptionDetails;
    if (detail !== undefined) {
      throw new Error(`renderer: ${detail.exception?.description ?? detail.text}`);
    }
    return message.result.result.value;
  }

  close() {
    this.#socket.close();
  }
}

const PRELUDE = `
const S = window.__theatrumPhase3;
const O = window.__theatrumPhase4;
const M = window.__theatrumPhase2;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Grava um keyframe de um valor num frame, criando a trilha se preciso. */
const chave = (no, caminho, frame, valor) => {
  S.actions.setPlayhead(frame);
  const estado = S.getSnapshot();
  const comp = estado.document.compositions.find((c) => c.id === estado.selectedCompositionId);
  const prop = caminho.split('.').reduce((o, k) => (o ? o[k] : undefined), comp.nodes[no]);
  const temTrilha = prop && Array.isArray(prop.keyframes) && prop.keyframes.length > 0;
  if (!temTrilha) S.actions.togglePropertyKeyframe(no, caminho);
  S.actions.setPropertyValue(no, caminho, valor);
};
`;

function log(etapa, detalhe) {
  console.log(`  ${etapa.padEnd(38)} ${detalhe}`);
}

/**
 * Espera as superfícies de depuração existirem.
 *
 * Contar segundos depois de um reload é chute: mapa e overlay sobem em ordem
 * própria, e o app leva cinco segundos ou vinte dependendo do que o Vite tem em
 * cache. Perguntar até existir é a única forma que não erra.
 */
async function esperarApp(client) {
  const prazo = Date.now() + 90_000;
  const expressao = [
    "typeof window.__theatrumPhase2 === 'object'",
    "typeof window.__theatrumPhase3 === 'object'",
    "typeof window.__theatrumPhase4 === 'object'",
  ].join(" && ");
  while (Date.now() < prazo) {
    const pronto = await client
      .call("Runtime.evaluate", { expression: expressao, returnByValue: true })
      .then((message) => message.result?.result?.value === true)
      .catch(() => false);
    if (pronto) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("o editor não terminou de subir em 90 s");
}

async function main() {
  const client = new Cdp((await pageTarget()).webSocketDebuggerUrl);
  await client.connect();
  await esperarApp(client);

  console.log("\nOPERAÇÃO CERCO — montando a missão\n");

  // ── Palco: mapa limpo, câmera de cinema ─────────────────────────────────
  log(
    "1 · mapa e câmera",
    await client.run(`
      S.actions.pause();
      while (S.commandBus.history.canUndo()) S.commandBus.history.undo();
      await wait(500);
      M.map.jumpTo({ center: [35.4, 49.9], zoom: 6.1, pitch: 42, bearing: -16 });
      await M.settle(6000);
      const c = M.map.getCanvas();
      return 'relevo, ' + c.width + 'x' + c.height + ', pitch 42, bearing -16';
    `),
  );

  // ── Território: preenchimento, contorno e glow neon ─────────────────────
  log(
    "2 · território com glow (7B + F6)",
    await client.run(`
      const ucr = S.actions.addGeoFeature(
        { id: 'c:UKR', name: 'Ucrânia', kind: 'country' },
        [31.2, 48.4],
      );
      if (ucr === null) return 'FALHOU ao criar o território';
      S.actions.setPropertyValue(ucr, 'props.fill', '#12304dff');
      S.actions.setPropertyValue(ucr, 'props.fillAlpha', 0.26);
      S.actions.setPropertyValue(ucr, 'props.stroke', '#7dd3fcff');
      S.actions.setPropertyValue(ucr, 'props.strokeWidth', 2.5);
      const glow = S.actions.addEffect(ucr, 'glow', {
        radius: 10, strength: 0.8, tint: '#38bdf8ff',
      });
      // Aparece: o contorno cresce em opacidade nos primeiros 40 frames.
      chave(ucr, 'transform.opacity', 0, 0);
      chave(ucr, 'transform.opacity', 40, 1);
      S.actions.clearSelection();
      window.__missao = { ucr };
      return 'geo.region + glow ' + (glow === null ? 'RECUSADO' : 'aplicado');
    `),
  );

  // ── Estradas do país ────────────────────────────────────────────────────
  log(
    "3 · malha de estradas (7B.1)",
    await client.run(`
      const est = S.actions.addGeoFeature(
        { id: 'c:UKR', name: 'Estradas', kind: 'road' },
        [31.2, 48.4],
      );
      if (est === null) return 'FALHOU';
      S.actions.setPropertyValue(est, 'props.stroke', '#8fa8bcff');
      S.actions.setPropertyValue(est, 'props.strokeWidth', 0.9);
      S.actions.setPropertyValue(est, 'props.strokeAlpha', 0.5);
      chave(est, 'transform.opacity', 20, 0);
      chave(est, 'transform.opacity', 70, 1);
      S.actions.clearSelection();
      window.__missao.est = est;
      return 'geo.roads sobre o território';
    `),
  );

  // ── Duas setas de avanço, revelando em tempos diferentes ────────────────
  log(
    "4 · setas de avanço (7C)",
    await client.run(`
      const eixos = [
        { nome: 'Eixo norte', cor: '#e2483dff', ini: 30, fim: 150,
          v: [[36.19, 51.73], [35.10, 51.00], [34.95, 50.10]] },
        { nome: 'Eixo sul', cor: '#f2a13cff', ini: 70, fim: 200,
          v: [[38.20, 49.80], [36.80, 49.30], [35.30, 49.00]] },
      ];
      const criadas = [];
      for (const eixo of eixos) {
        const pid = S.actions.createPath({
          name: eixo.nome, space: 'geo', interpolation: 'bezier',
          vertices: eixo.v.map((p) => ({ point: p, inHandle: null, outHandle: null })),
        });
        const nd = S.actions.addNodeOfType('route');
        S.actions.renameNode(nd, eixo.nome);
        S.actions.setPropertyValue(nd, 'props.pathId', pid);
        S.actions.setPropertyValue(nd, 'props.filled', true);
        S.actions.setPropertyValue(nd, 'props.fill', eixo.cor);
        S.actions.setPropertyValue(nd, 'props.fillAlpha', 0.94);
        S.actions.setPropertyValue(nd, 'props.bodyWidth', 19);
        S.actions.setPropertyValue(nd, 'props.headWidth', 56);
        S.actions.setPropertyValue(nd, 'props.headLength', 50);
        chave(nd, 'props.trimEnd', eixo.ini, 0.01);
        chave(nd, 'props.trimEnd', eixo.fim, 1);
        S.actions.clearSelection();
        criadas.push(nd);
      }
      window.__missao.setas = criadas;
      return criadas.length + ' setas gordas, revelando em 30–150 e 70–200';
    `),
  );

  // ── Eixo previsto: tracejado com formiguinha ────────────────────────────
  log(
    "5 · eixo previsto tracejado (7C)",
    await client.run(
      `
      const pid = S.actions.createPath({
        name: 'Eixo previsto', space: 'geo', interpolation: 'bezier',
        vertices: [[32.90, 48.10], [34.30, 48.80], [35.20, 48.95]]
          .map((p) => ({ point: p, inHandle: null, outHandle: null })),
      });
      const nd = S.actions.addNodeOfType('route');
      S.actions.renameNode(nd, 'Eixo previsto');
      S.actions.setPropertyValue(nd, 'props.pathId', pid);
      S.actions.setPropertyValue(nd, 'props.color', '#9fd0ffff');
      S.actions.setPropertyValue(nd, 'props.width', 5);
      S.actions.setPropertyValue(nd, 'props.dashPx', 20);
      S.actions.setPropertyValue(nd, 'props.gapPx', 14);
      S.actions.setPropertyValue(nd, 'props.arrowSize', 26);
      // A formiguinha: o padrão anda sem a rota se mover.
      chave(nd, 'props.dashOffset', 0, 0);
      chave(nd, 'props.dashOffset', DURACAO_FRAMES, 900);
      chave(nd, 'transform.opacity', 90, 0);
      chave(nd, 'transform.opacity', 130, 1);
      S.actions.clearSelection();
      return 'tracejado 20/14 px, deslocamento 0→900 px';
    `.replace("DURACAO_FRAMES", String(DURACAO - 1)),
    ),
  );

  // ── Topônimos com halo ──────────────────────────────────────────────────
  log(
    "6 · topônimos com halo (7D)",
    await client.run(`
      const lugares = [
        ['KHARKIV', 36.23, 49.99, 30, 40],
        ['KYIV',    30.52, 50.45, 34, 10],
        ['DNIPRO',  35.05, 48.46, 28, 100],
        ['DONETSK', 37.80, 48.00, 26, 150],
      ];
      for (const [nome, lng, lat, tam, entra] of lugares) {
        const nd = S.actions.addNodeOfType('text.label');
        S.actions.renameNode(nd, nome);
        S.actions.setNodeAnchor(nd, { space: 'geo', lngLat: [lng, lat] });
        S.actions.setPropertyValue(nd, 'props.text', nome);
        S.actions.setPropertyValue(nd, 'props.fontSize', tam);
        S.actions.setPropertyValue(nd, 'props.color', '#ffffffff');
        S.actions.setPropertyValue(nd, 'props.halo', '#04080df2');
        S.actions.setPropertyValue(nd, 'props.haloWidth', 3);
        chave(nd, 'transform.opacity', entra, 0);
        chave(nd, 'transform.opacity', entra + 20, 1);
        S.actions.clearSelection();
      }
      return lugares.length + ' rótulos, halo de 3 px, entrando em sequência';
    `),
  );

  // ── Aeronave: GLB da biblioteca, voando um caminho curvo ────────────────
  log(
    "7 · aeronave 3D em motion-path (7A+ / F5)",
    await client.run(`
      const idx = await fetch('theatrum-data://local/models-index.json').then((r) => r.json());
      const alvo = idx.models.find((m) => /tu-22m3/i.test(m.file)) ?? idx.models[0];
      const bytes = await fetch('theatrum-data://local/models/' + encodeURIComponent(alvo.file))
        .then((r) => r.arrayBuffer());
      await S.actions.importAssetFiles([
        new File([bytes], alvo.file, { type: 'model/gltf-binary' }),
      ]);
      const prazo = Date.now() + 30000;
      let asset = null;
      while (Date.now() < prazo && asset === null) {
        await wait(200);
        asset = S.getSnapshot().document.assets.find((a) => a.kind === 'model') ?? null;
      }
      if (asset === null) return 'FALHOU: modelo não entrou no cofre';

      // O caminho do voo: entra pelo leste, curva sobre o teatro, sai ao norte.
      const voo = S.actions.createPath({
        name: 'Voo', space: 'geo', interpolation: 'bezier', geodesic: false,
        vertices: [[39.4, 47.9], [37.2, 48.9], [35.6, 50.2], [34.2, 51.4]]
          .map((p) => ({ point: p, inHandle: null, outHandle: null })),
      });

      const nd = S.actions.applyAsset(asset.id);
      if (nd === null) return 'FALHOU: applyAsset recusou';
      S.actions.renameNode(nd, 'Tu-22M3');
      // Vão de 190 km, não 26: no zoom 6 um quilômetro é meio pixel, e a
      // aeronave em escala real teria onze pixels. Num mapa ela é símbolo, e
      // é assim que um canal de análise geopolítica desenha.
      S.actions.setPropertyValue(nd, 'props.scaleMeters', 190000);
      // 42 km punham o NDC z em 0,9965 — à beira do plano distante do mapa.
      S.actions.setPropertyValue(nd, 'props.altitudeMeters', 16000);
      // Auto-orient: o nariz acompanha o rumo do caminho, frame a frame.
      const beh = S.actions.assignMotionPath(nd, voo, { from: 0, to: 260, autoOrient: true });
      S.actions.clearSelection();

      // A rota 3D: tubo volumétrico com cortina até o terreno, revelando junto.
      const tubo = S.actions.addNodeOfType('route3d');
      S.actions.renameNode(tubo, 'Trajetória');
      S.actions.setPropertyValue(tubo, 'props.pathId', voo);
      S.actions.setPropertyValue(tubo, 'props.color', '#5eead4ff');
      S.actions.setPropertyValue(tubo, 'props.widthMeters', 9000);
      S.actions.setPropertyValue(tubo, 'props.altitudeMeters', 16000);
      S.actions.setPropertyValue(tubo, 'props.curtainOpacity', 0.3);
      chave(tubo, 'props.progressEnd', 0, 0.02);
      chave(tubo, 'props.progressEnd', 260, 1);
      S.actions.clearSelection();

      window.__missao.aviao = nd;
      return alvo.label + ' (' + (alvo.bytes/1048576).toFixed(1) + ' MB), motion-path ' +
        (beh === null ? 'RECUSADO' : 'ativo') + ', tubo 3D com cortina';
    `),
  );

  // ── Rótulo com guia acompanhando a aeronave ─────────────────────────────
  log(
    "8 · rótulo com guia no alvo (7E.2)",
    await client.run(`
      const nd = S.actions.addNodeOfType('label.callout');
      S.actions.renameNode(nd, 'Ficha do alvo');
      S.actions.setPropertyValue(nd, 'props.targetId', window.__missao.aviao);
      S.actions.setPropertyValue(nd, 'props.text', 'TU-22M3 · 16 000 m · rumo 315');
      S.actions.setPropertyValue(nd, 'props.offsetX', 175);
      S.actions.setPropertyValue(nd, 'props.offsetY', 105);
      S.actions.setPropertyValue(nd, 'props.fontSize', 15);
      S.actions.setPropertyValue(nd, 'props.borderColor', '#5eead4ff');
      S.actions.setPropertyValue(nd, 'props.leaderColor', '#5eead4ff');
      chave(nd, 'transform.opacity', 60, 0);
      chave(nd, 'transform.opacity', 85, 1);
      S.actions.clearSelection();
      return 'callout ancorado no Tu-22M3, guia de 175×105 px';
    `),
  );

  // ── Impacto: partículas de explosão ─────────────────────────────────────
  log(
    "9 · impacto com partículas (F6)",
    await client.run(`
      // Partícula não é tipo de nó: é um **efeito** num nó comum, e o passe do
      // viewport expande cada emissor em nós sintéticos. Um \`null\` serve de
      // âncora porque ele não desenha nada por conta própria — só marca o lugar.
      const nd = S.actions.addNodeOfType('null');
      if (nd === null) return 'FALHOU ao criar a âncora do impacto';
      S.actions.renameNode(nd, 'Impacto');
      S.actions.setNodeAnchor(nd, { space: 'geo', lngLat: [36.60, 49.60] });
      // Os cinco parâmetros são obrigatórios pelo schema do emissor. Passar
      // \`life\` no lugar de \`lifetime\` recusa o efeito inteiro, e o único sinal é
      // "Invalid input" no diagnóstico do frame — a cena sobe sem partícula.
      const ef = S.actions.addEffect(nd, 'explosion', {
        count: 2200,
        scale: 2.4,
        lifetime: 70,
        intensity: 1.6,
        tint: '#ffd08aff',
      });
      // O burst conta do \`timeRange.in\` do nó, não do playhead: com o nó
      // começando em 0, a explosão acontece no frame 0 e já acabou em 70.
      //
      // \`setPropertyValue\` não alcança \`timeRange\` — ele só mexe em propriedade
      // animável, e intervalo de nó não é uma. O comando existe e vai direto ao
      // barramento, que é o mesmo caminho de qualquer edição: entra no histórico e
      // é desfeito por Ctrl+Z como o resto.
      const estado = S.getSnapshot();
      const moveu = S.actions.dispatch({
        type: 'node.set-time-range',
        payload: {
          compositionId: estado.selectedCompositionId,
          nodeId: nd,
          in: 196,
          out: 300,
        },
        source: 'user',
      });
      S.actions.clearSelection();
      return 'emissor de explosão ' + (ef === null ? 'RECUSADO' : 'ok') +
        ', burst ' + (moveu ? 'no frame 196' : 'NÃO MOVIDO');
    `),
  );

  // ── Estabiliza e mede o frame ──────────────────────────────────────────
  log(
    "10 · cena estabilizada",
    await client.run(`
      S.actions.setPlayhead(0);
      S.actions.clearSelection();
      await M.settle(5000);
      await wait(2000);
      S.actions.setPlayhead(150);
      await wait(900);
      const antes = O.getSnapshot().particles;
      S.actions.setPlayhead(215);
      await wait(1200);
      const s = O.getSnapshot();
      const nos = S.getSnapshot().document.compositions[0];
      return Object.keys(nos.nodes).length + ' nós; frame em ' + s.metrics.totalMs.toFixed(1) +
        ' ms; rotas ' + JSON.stringify(s.routes) + '; geo desenhados ' + (s.geo ? s.geo.drawn : '?') +
        '; partículas ' + antes + '→' + s.particles + ' (frame 150→215)' + '; filtros ' + s.filters;
    `),
  );

  // ── Export ─────────────────────────────────────────────────────────────
  console.log("\n  exportando MP4 (isso demora — 300 frames com settle por frame)…\n");
  const relatorio = await client.run(`
    S.actions.setPlayhead(0);
    await wait(800);
    const r = await O.exportPngSequence({
      format: 'mp4',
      range: { first: 0, last: ${DURACAO - 1} },
      directory: ${JSON.stringify(SAIDA)},
    });
    return {
      ok: r.ok,
      arquivo: r.videoFile ?? null,
      bytes: r.videoBytes ?? 0,
      frames: r.report ? r.report.written : 0,
      settleFailed: r.report ? r.report.settleFailed : -1,
      quaisFalharam: r.report ? r.report.settleFailedFrames : [],
      settleP99: r.report ? r.report.settleP99Ms : -1,
      erros: r.report ? r.report.errors.slice(0, 3) : [],
      mensagem: r.message ?? null,
    };
  `);

  console.log(
    `  arquivo:        ${relatorio.arquivo ?? "NENHUM"}` +
      (relatorio.mensagem === null ? "" : ` — ${relatorio.mensagem}`),
  );
  if (relatorio.arquivo !== null) {
    const caminho = join(SAIDA, relatorio.arquivo);
    const bytes = readFileSync(caminho);
    console.log(`  tamanho:        ${(bytes.length / 1048576).toFixed(2)} MB`);
    console.log(`  frames:         ${relatorio.frames}`);
    console.log(
      `  settle falhou:  ${relatorio.settleFailed}` +
        (relatorio.quaisFalharam.length === 0
          ? ""
          : ` nos frames ${relatorio.quaisFalharam.slice(0, 20).join(", ")}`),
    );
    console.log(`  settle p99:     ${relatorio.settleP99.toFixed(0)} ms`);
    console.log(`  caixas de topo: ${topoBoxes(bytes).join(" ")}`);
    console.log(`\n  ${caminho}`);
  }
  if (relatorio.erros.length > 0) console.log(`  erros: ${relatorio.erros.join("; ")}`);

  client.close();
}

function topoBoxes(bytes) {
  const out = [];
  let at = 0;
  while (at + 8 <= bytes.length && out.length < 12) {
    const size = bytes.readUInt32BE(at);
    if (size < 8 || at + size > bytes.length) break;
    out.push(bytes.toString("ascii", at + 4, at + 8));
    at += size;
  }
  return out;
}

await main();
