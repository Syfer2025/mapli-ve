/**
 * Prova do bloco 7D (textos e rótulos no mapa), no Electron real.
 * Requer `pnpm dev` rodando.
 *
 *   node tools/verify-phase7d.mjs
 *
 * 1. Duplo clique no vazio do mapa cria um `text.label` ancorado naquele
 *    ponto geográfico — e o texto continua no mesmo lugar do terreno depois
 *    de zoom, giro e inclinação.
 * 2. O halo pinta de verdade em volta do glifo: pixels da cor do halo
 *    aparecem onde antes não havia nada, e some quando a espessura é zero.
 * 3. `maxWidth` quebra a linha: a caixa do texto fica mais estreita e mais
 *    alta, e nenhuma linha ultrapassa a largura pedida.
 *
 * Desfaz tudo o que cria e compara o documento com o estado inicial.
 */

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

const PRELUDE = `
const session = () => window.__theatrumPhase3;
const overlay = () => window.__theatrumPhase4.getSnapshot();
const mapa = () => window.__theatrumPhase2.map;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
};
const atFrame = async (f) => {
  session().actions.setPlayhead(f);
  const fim = Date.now() + 8000;
  let quieto = null, ultimo = -1;
  while (Date.now() < fim) {
    const s = overlay();
    if (s.frame === f) {
      if (s.renders === ultimo) { if (quieto !== null && Date.now() - quieto >= 90) return s; }
      else { ultimo = s.renders; quieto = Date.now(); }
    }
    await wait(24);
  }
  throw new Error('overlay nao estabilizou em ' + f);
};
const capturar = async () => window.__theatrumPhase4.captureExport();

/** Conta pixels cuja proporcao de canais bate com uma cor, acima de um alfa. */
const contarCor = (shot, alvo, tolerancia) => {
  const d = shot.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 40) continue;
    // Pre-multiplicado sobre fundo transparente: comparar proporcao, nao valor.
    const a = d[i + 3] / 255;
    if (
      Math.abs(d[i] / a - alvo[0]) <= tolerancia &&
      Math.abs(d[i + 1] / a - alvo[1]) <= tolerancia &&
      Math.abs(d[i + 2] / a - alvo[2]) <= tolerancia
    ) n += 1;
  }
  return n;
};

/** Caixa dos pixels com alfa, para medir a extensao do texto desenhado. */
const caixaDesenhada = (shot) => {
  const d = shot.data;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 24) continue;
    const p = i / 4;
    const x = p % shot.width;
    const y = Math.floor(p / shot.width);
    n += 1;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (n === 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels: n };
};

/** Dispara um duplo clique real no container do mapa. */
const duploClique = (x, y) => {
  const alvo = mapa().getCanvasContainer();
  const caixa = alvo.getBoundingClientRect();
  const comum = { bubbles: true, cancelable: true, clientX: caixa.left + x, clientY: caixa.top + y, button: 0 };
  alvo.dispatchEvent(new MouseEvent('dblclick', comum));
};
`;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASSA" : "FALHA"}  ${name}\n        ${detail}`);
}

async function main() {
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  const baseline = await client.evaluate(
    `(async () => {
      session().actions.pause();
      session().actions.clearSelection();
      mapa().jumpTo({ center: [30.52, 50.45], zoom: 6, pitch: 0, bearing: 0 });
      await window.__theatrumPhase2.settle(1200);
      await wait(150);
      return JSON.stringify(canonical(session().getSnapshot().document));
    })()`,
  );

  let labelId = null;

  try {
    // ── 1. Duplo clique cria rótulo ancorado no terreno ─────────────────────
    {
      const report = await client.evaluate(
        `(async () => {
          const antes = session().getSnapshot().document.compositions[0];
          const contaAntes = Object.keys(antes.nodes).length;
          const alvo = [700, 400];
          duploClique(alvo[0], alvo[1]);
          await wait(500);
          await atFrame(0);
          const estado = session().getSnapshot();
          const comp = estado.document.compositions.find((c) => c.id === estado.selectedCompositionId);
          const criados = Object.values(comp.nodes).filter((n) => n.type === 'text.label');
          if (criados.length === 0) {
            return { criou: false, contaAntes, contaDepois: Object.keys(comp.nodes).length };
          }
          const no = criados[criados.length - 1];
          const ancora = no.anchor;
          // O ponto geografico do rotulo tem de bater com o que o mapa
          // desprojeta no pixel clicado.
          const esperado = mapa().unproject(alvo);
          session().actions.setPropertyValue(no.id, 'props.text', 'KIEV');
          session().actions.setPropertyValue(no.id, 'props.fontSize', 48);
          session().actions.clearSelection();

          // Ancorado no TERRENO: girar, inclinar e dar zoom tem de mover o
          // rotulo junto com o ponto, nao deixa-lo parado na tela.
          //
          // Mede o CENTRO DOS PIXELS DESENHADOS, nao a translacao da matriz do
          // no. A matriz posiciona a caixa do no, e o pivot 'anchorPoint x
          // tamanho' desloca essa caixa em relacao a ancora — um desvio
          // constante de ~123 px que nao diz nada sobre projecao. Quem responde
          // "o texto ficou no lugar do terreno?" e o pixel.
          const posicoes = [];
          for (const vista of [
            { zoom: 6, pitch: 0, bearing: 0 },
            { zoom: 7.4, pitch: 42, bearing: 33 },
            { zoom: 5.2, pitch: 18, bearing: -70 },
          ]) {
            mapa().jumpTo({ center: [30.52, 50.45], ...vista });
            await window.__theatrumPhase2.settle(900);
            await atFrame(0);
            const caixa = caixaDesenhada(await capturar());
            const proj = mapa().project([ancora.lngLat[0], ancora.lngLat[1]]);
            posicoes.push({
              vista,
              desenhado: caixa === null ? null : [caixa.x + caixa.width / 2, caixa.y + caixa.height / 2],
              projetado: [proj.x, proj.y],
            });
          }
          mapa().jumpTo({ center: [30.52, 50.45], zoom: 6, pitch: 0, bearing: 0 });
          await window.__theatrumPhase2.settle(900);
          return {
            criou: true,
            id: no.id,
            contaAntes,
            contaDepois: Object.keys(comp.nodes).length,
            ancora: ancora,
            esperado: [esperado.lng, esperado.lat],
            posicoes,
          };
        })()`,
      );
      if (!report.criou) {
        record(
          "1 · duplo clique cria rótulo ancorado no terreno",
          false,
          `nenhum text.label criado (${report.contaAntes} → ${report.contaDepois} nós)`,
        );
      } else {
        labelId = report.id;
        const erroAncora = Math.hypot(
          report.ancora.lngLat[0] - report.esperado[0],
          report.ancora.lngLat[1] - report.esperado[1],
        );
        const desvios = report.posicoes
          .filter((p) => p.desenhado !== null)
          .map((p) => Math.hypot(p.desenhado[0] - p.projetado[0], p.desenhado[1] - p.projetado[1]));
        const ok =
          report.ancora.space === "geo" &&
          erroAncora < 1e-6 &&
          desvios.length === 3 &&
          // Tolerancia de 3 px: a caixa de pixels inclui a folga de antialias do
          // glifo, entao o centro dela nao coincide ao pixel com a linha de base.
          desvios.every((d) => d < 3);
        record(
          "1 · duplo clique cria rótulo ancorado no terreno",
          ok,
          `âncora ${report.ancora.space} a ${erroAncora.toExponential(1)}° do ponto clicado; ` +
            `desvio do ponto projetado em 3 enquadramentos: ${desvios.map((d) => d.toFixed(2)).join("/")} px`,
        );
      }
    }

    // ── 2. O halo pinta em volta do glifo ───────────────────────────────────
    if (labelId !== null) {
      const report = await client.evaluate(
        `(async () => {
          const id = ${JSON.stringify(labelId)};
          // Texto branco, halo vermelho: cores distantes o bastante para a
          // contagem por proporcao de canais nao confundir uma com a outra.
          session().actions.setPropertyValue(id, 'props.color', '#ffffffff');
          session().actions.setPropertyValue(id, 'props.halo', '#ff0000ff');
          session().actions.setPropertyValue(id, 'props.haloWidth', 0);
          await atFrame(0);
          const sem = await capturar();
          session().actions.setPropertyValue(id, 'props.haloWidth', 6);
          await atFrame(0);
          const com = await capturar();
          return {
            semHalo: { vermelhos: contarCor(sem, [255, 0, 0], 60), caixa: caixaDesenhada(sem) },
            comHalo: { vermelhos: contarCor(com, [255, 0, 0], 60), caixa: caixaDesenhada(com) },
          };
        })()`,
      );
      const cresceu =
        report.comHalo.caixa !== null &&
        report.semHalo.caixa !== null &&
        report.comHalo.caixa.width > report.semHalo.caixa.width;
      const ok = report.semHalo.vermelhos === 0 && report.comHalo.vermelhos > 200 && cresceu;
      record(
        "2 · halo pinta contorno e desaparece com espessura zero",
        ok,
        `pixels de halo: ${report.semHalo.vermelhos} sem → ${report.comHalo.vermelhos} com; ` +
          `caixa ${report.semHalo.caixa?.width}×${report.semHalo.caixa?.height} → ` +
          `${report.comHalo.caixa?.width}×${report.comHalo.caixa?.height}`,
      );
    }

    // ── 3. maxWidth quebra a linha ──────────────────────────────────────────
    if (labelId !== null) {
      const report = await client.evaluate(
        `(async () => {
          const id = ${JSON.stringify(labelId)};
          session().actions.setPropertyValue(id, 'props.haloWidth', 0);
          session().actions.setPropertyValue(
            id,
            'props.text',
            'Ofensiva de primavera sobre o eixo norte',
          );
          session().actions.setPropertyValue(id, 'props.maxWidth', 0);
          await atFrame(0);
          const solto = caixaDesenhada(await capturar());
          session().actions.setPropertyValue(id, 'props.maxWidth', 260);
          await atFrame(0);
          const quebrado = caixaDesenhada(await capturar());
          return { solto, quebrado };
        })()`,
      );
      const ok =
        report.solto !== null &&
        report.quebrado !== null &&
        report.quebrado.width <= 280 &&
        report.quebrado.width < report.solto.width * 0.75 &&
        report.quebrado.height > report.solto.height * 1.5;
      record(
        "3 · maxWidth quebra a linha em vez de esticar",
        ok,
        `sem limite ${report.solto?.width}×${report.solto?.height} px → ` +
          `com 260 px de limite ${report.quebrado?.width}×${report.quebrado?.height} px`,
      );
    }
  } finally {
    const restored = await client.evaluate(
      `(async () => {
        const bus = session().commandBus;
        let n = 0;
        while (bus.history.canUndo() && n < 300) { bus.history.undo(); n += 1; }
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
