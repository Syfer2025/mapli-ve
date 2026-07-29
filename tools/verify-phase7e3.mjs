/**
 * Prova automatizada do bloco 7E.3 (modo estúdio), no Electron real.
 * Requer `pnpm dev` rodando.
 *
 *   node tools/verify-phase7e3.mjs
 *
 * 1. Um studio.stage na cena troca o mapa pelo palco: o canvas do estúdio
 *    passa a pintar, o do MapLibre some da imagem, e o chão infinito tem
 *    grade de verdade — medida como variação de luminância ao longo de uma
 *    linha de pixels, não como "o shader compilou".
 * 2. Um model3d no palco aparece em pixels sobre o chão, e some quando o
 *    nó é escondido. É a diferença entre o modelo estar carregado e o modelo
 *    estar visível.
 * 3. Azimute animado por keyframes orbita a câmera de verdade: a posição
 *    percorre um arco à distância constante do alvo, e a imagem muda. Só
 *    isso separa uma câmera que gira de um número que muda.
 * 4. Um label.callout apontando para o modelo acompanha a projeção 3D
 *    enquanto a câmera orbita — a costura entre o palco e o overlay Pixi.
 * 5. Ponto de interesse (ADR-015): dois cliques de mouse DE VERDADE na
 *    superfície do modelo criam dois nós studio.poi, o marcador desenha e
 *    apaga, e o roteiro compilado leva a câmera até o ponto. As duas
 *    afirmações que sobram são em pixel: a ida e volta do raycast, e o ponto
 *    da segunda parada projetando no centro da tela no frame de chegada.
 *
 * Como nas fases anteriores, o script desfaz tudo o que cria e compara o
 * documento com o estado inicial antes de sair.
 */

const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 90_000;
// O painel divide a janela com camadas, inspector e timeline. Este viewport
// produz um drawing buffer do palco >= 1920×1080 sem extrapolar custo: Chromium
// realmente aloca e desenha todos os pixels, e o override é limpo no finally.
const PROFILE_VIEWPORT_WIDTH = 3000;
const PROFILE_VIEWPORT_HEIGHT = 1800;

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
const studio = () => {
  const surface = window.__theatrumStudio;
  if (!surface) throw new Error('palco indisponível — build antigo?');
  return surface.status();
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const composition = () => {
  const state = session().getSnapshot();
  return state.document.compositions.find((entry) => entry.id === state.selectedCompositionId);
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
};

/**
 * Espera o PALCO parar de repintar no frame pedido.
 *
 * Antes esperava o overlay do Viewport (window.__theatrumPhase4). Com o palco em
 * painel proprio (ADR-014) o Viewport esta DESMONTADO enquanto a aba do palco esta
 * ativa, e aquele sinal nunca chega — o verificador morria em
 * 'overlay nao estabilizou' por um motivo que nao tinha nada a ver com o palco.
 *
 * O contador certo e o do proprio palco. Ele repinta por efeito do React quando a
 * sessao muda, nao em laco continuo, entao estabilizar e o sinal correto de
 * 'terminou' — nao de 'esta parado porque nunca comecou'.
 */
const atFrame = async (frame) => {
  session().actions.setPlayhead(frame);
  const deadline = Date.now() + 8000;
  let quietSince = null;
  let lastRenders = -1;
  while (Date.now() < deadline) {
    const renders = studio().renders;
    if (renders === lastRenders) {
      if (quietSince !== null && Date.now() - quietSince >= 120) return { frame, renders };
    } else {
      lastRenders = renders;
      quietSince = Date.now();
    }
    await wait(24);
  }
  throw new Error('palco nao estabilizou no frame ' + frame);
};

const studioCanvas = () => {
  const canvas = document.querySelector('.studio-viewport__stage');
  if (canvas === null) throw new Error('canvas do palco ausente no DOM — a aba Palco 3D está ativa?');
  return canvas;
};

/** O painel do palco, para perguntar o que existe DENTRO dele. */
const studioPanel = () => document.querySelector('.studio-viewport');

/**
 * O mapa não existe dentro do painel do palco.
 *
 * Este é o critério que substituiu "o palco esconde o mapa". A diferença não é
 * de redação: antes o canvas do mapa ESTAVA lá, invisível por CSS, e qualquer
 * coisa que zerasse visible no nó do palco o reacendia — foi assim que o
 * defeito apareceu. Agora ele não está. Isolamento estrutural, não visual.
 */
const mapAusenteDoPalco = () => {
  const panel = studioPanel();
  if (panel === null) return false;
  return panel.querySelector('.maplibregl-canvas') === null;
};

/** O overlay Pixi do próprio palco, a segunda superfície da etapa 2. */
const studioOverlayPresente = () => {
  const panel = studioPanel();
  if (panel === null) return false;
  const canvas = panel.querySelector('.studio-viewport__pixi');
  return canvas !== null && canvas.width > 1 && canvas.height > 1;
};

/**
 * Pixels do palco, via canvas 2D intermediário. O drawing buffer sobrevive ao
 * frame (preserveDrawingBuffer), então a leitura não depende de acertar o
 * instante entre o render e o compositor.
 */
const studioPixels = () => {
  const source = studioCanvas();
  const scratch = document.createElement('canvas');
  scratch.width = source.width;
  scratch.height = source.height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, scratch.width, scratch.height);
};

/**
 * Tinta na superfície dos marcadores (ADR-015).
 *
 * Canvas 2D comum, então basta ler. O que se prova com isto é que o modo de
 * marcação DESENHA — e, no fim do critério, que desligá-lo APAGA. Um canvas que
 * só é limpo quando há o que desenhar deixaria o último quadro na tela para
 * sempre, e o dono exportaria com números fantasmas por cima do modelo.
 */
const markerInk = () => {
  const canvas = document.querySelector('.studio-viewport__markers');
  if (canvas === null) return -1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i] > 8) painted += 1;
  }
  return painted;
};

/** O botão da barra do palco, pelo texto. */
const studioTool = (label) =>
  [...document.querySelectorAll('.studio-viewport__tools button')].find((button) =>
    button.textContent.includes(label),
  ) ?? null;

/** Os nós de um tipo na composição corrente, na ordem das camadas. */
const nodesOfType = (type) => {
  const comp = composition();
  if (comp === undefined) return [];
  return Object.values(comp.nodes).filter((node) => node.type === type);
};

/** O palco está realmente aparecendo, ou só existe no DOM? */
const studioVisible = () => {
  const canvas = studioCanvas();
  const box = canvas.getBoundingClientRect();
  return getComputedStyle(canvas).visibility === 'visible' && box.width > 1 && box.height > 1;
};

/**
 * O palco desligou como MODO: não há studio.stage visível na cena.
 *
 * Substitui o antigo mapVisible. Perguntar "o mapa voltou?" deixou de fazer
 * sentido: com painéis separados isso depende de qual aba o usuário está olhando,
 * e aba ativa não é estado do documento — é do espaço de trabalho.
 */
const palcoDesligado = () => window.__theatrumStudio.status().active === false;

/** Quantos pixels de uma imagem diferem de outra além do ruído de compressão. */
const differingPixels = (a, b, tolerance = 6) => {
  if (a.data.length !== b.data.length) return a.data.length;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > tolerance ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > tolerance ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > tolerance
    ) count += 1;
  }
  return count;
};

/**
 * Conta transições claro/escuro ao longo de uma linha horizontal. Uma grade
 * produz muitas; um chão liso, nenhuma. Mede a GRADE, não o shader.
 */
const lineTransitions = (image, y, threshold = 4) => {
  const row = y * image.width * 4;
  let transitions = 0;
  let previous = null;
  let rising = null;
  for (let x = 0; x < image.width; x += 1) {
    const i = row + x * 4;
    const luma = 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
    if (previous !== null) {
      const delta = luma - previous;
      if (Math.abs(delta) > threshold) {
        const nowRising = delta > 0;
        if (rising !== null && nowRising !== rising) transitions += 1;
        rising = nowRising;
      }
    }
    previous = luma;
  }
  return transitions;
};

/** Caixa dos pixels que diferem de uma imagem de referência — onde está o modelo. */
const changedBox = (before, after, tolerance = 12) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const i = (y * before.width + x) * 4;
      if (
        Math.abs(before.data[i] - after.data[i]) > tolerance ||
        Math.abs(before.data[i + 1] - after.data[i + 1]) > tolerance ||
        Math.abs(before.data[i + 2] - after.data[i + 2]) > tolerance
      ) {
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count === 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, count };
};

/**
 * Primeiro asset de modelo já no cofre, ou null.
 *
 * Devolve o descriptor inteiro porque id e src não são a mesma coisa: o
 * documento indexa por id, e props.assetId de um model3d guarda o src (o hash
 * de conteúdo). Trocar os dois faz o GLB "sumir" com a mensagem "asset
 * ausente", que soa como arquivo faltando e é só o campo errado.
 */
const anyModelAsset = () => {
  const state = session().getSnapshot();
  const assets = Object.values(state.document.assets ?? {});
  return assets.find((asset) => asset.kind === 'model') ?? null;
};

/**
 * Garante um modelo no cofre, importando da Biblioteca local se preciso —
 * o mesmo caminho que o botão do painel usa, não um atalho de teste.
 * Escolhe o menor arquivo do índice: o palco não liga para qual modelo é, e
 * 3 MB carregam em uma fração do tempo de 25 MB.
 */

/**
 * Centroide dos pixels desenhados no overlay Pixi DO PALCO.
 *
 * No palco o overlay desenha apenas rotulos: no ancorado em geo e descartado pelo
 * projetor do palco, e o modelo vive no canvas 3D. Entao pixel opaco aqui E o
 * rotulo, e o centroide dele e uma medida direta do efeito — sem ler layout,
 * sem confiar em estrutura interna.
 */
const calloutCentroid = () => {
  const src = document.querySelector('.studio-viewport__pixi');
  if (src === null) return null;
  const scratch = document.createElement('canvas');
  scratch.width = src.width;
  scratch.height = src.height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, scratch.width, scratch.height);
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 24) { sx += x; sy += y; n++; }
    }
  }
  if (n < 40) return null;
  // De pixels de buffer para pixels CSS: o overlay renderiza em devicePixelRatio.
  const box = src.getBoundingClientRect();
  return [(sx / n) * (box.width / img.width), (sy / n) * (box.height / img.height), n];
};

const ensureModelAsset = async () => {
  const existing = anyModelAsset();
  if (existing !== null) return { asset: existing, file: '(já estava no cofre)' };
  const index = await fetch('theatrum-data://local/models-index.json').then((r) =>
    r.ok ? r.json() : null,
  );
  let nome = null;
  let bytes = null;
  if (index !== null && Array.isArray(index.models) && index.models.length > 0) {
    const smallest = [...index.models].sort((a, b) => a.bytes - b.bytes)[0];
    const response = await fetch(
      'theatrum-data://local/models/' + encodeURIComponent(smallest.file),
    );
    if (response.ok) {
      nome = smallest.file;
      bytes = await response.arrayBuffer();
    }
  }
  if (bytes === null) {
    // Recuo para o GLB do repositório.
    //
    // A biblioteca 3D local depende de data/library-roots.json, que é configuração
    // DE MÁQUINA. Um critério de fase que se pula porque a máquina não foi
    // configurada não prova nada e ainda passa a impressão de que provou — o
    // relatório dizia "pulado" e o placar contava como falha sem explicar a causa.
    // O caça em apps/editor/public/models/fa-18f.glb está no repositório, então
    // este caminho existe em qualquer clone.
    const response = await fetch('/models/fa-18f.glb');
    if (!response.ok) return null;
    nome = 'fa-18f.glb';
    bytes = await response.arrayBuffer();
  }
  const smallest = { file: nome };
  await session().actions.importAssetFiles([
    new File([bytes], smallest.file, { type: 'model/gltf-binary' }),
  ]);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const asset = anyModelAsset();
    if (asset !== null) return { asset, file: smallest.file };
    await wait(120);
  }
  return null;
};
`;

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASSA" : "FALHA"}  ${name}\n        ${detail}`);
}

/**
 * Ativa a aba do Palco 3D.
 *
 * Obrigatório desde o [ADR-014](../docs/adr/ADR-014-studio-own-panel.md): o palco
 * é painel próprio, e o dockview **só monta o painel ativo** — com a aba do
 * Viewport na frente, o canvas do palco não existe no DOM e todo critério aqui
 * falharia por um motivo que não tem nada a ver com o palco.
 *
 * E tem de ser evento de ponteiro de verdade, por coordenada: o dockview escuta
 * pointer, e element.click() NÃO troca de aba. Perdi uma volta descobrindo isso;
 * está aqui para ninguém perder a segunda.
 */
async function activateStudioTab(client) {
  // Já montado significa que a aba já está na frente: não há o que ativar, e
  // tentar clicar de novo só arriscaria trocar para outra coisa.
  const alreadyMounted = await client.evaluate(
    `Boolean(document.querySelector('.studio-viewport__stage'))`,
  );
  if (alreadyMounted === true) return;

  const box = await client.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.dv-tab')].find((t) => t.textContent.includes('Palco'));
    if (tab === undefined) return null;
    const r = tab.getBoundingClientRect();
    return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
  })()`);
  if (box === null) {
    throw new Error(
      "aba 'Palco 3D' não existe. Layout salvo antigo? Use 'Restaurar layout' no cabeçalho.",
    );
  }
  const [x, y] = JSON.parse(box);
  await client.request("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await client.request("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
  const deadline = Date.now() + 6000;
  for (;;) {
    const ready = await client.evaluate(
      `Boolean(document.querySelector('.studio-viewport__stage'))`,
    );
    if (ready === true) return;
    if (Date.now() > deadline) throw new Error("painel do palco não montou depois de ativar a aba");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function main() {
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await activateStudioTab(client);

  const baseline = await client.evaluate(
    `(async () => {
      session().actions.pause();
      session().actions.clearSelection();
      await wait(120);
      return JSON.stringify(canonical(session().getSnapshot().document));
    })()`,
  );

  // Preenchidos pelos critérios. Sem inicializador: um critério que falhe cedo
  // deixa o id indefinido, e os seguintes se pulam sozinhos em vez de tentar
  // agir sobre um nó que nunca existiu.
  let stageId;
  let modelId;
  let metricsOverrideRequested = false;

  try {
    // Dentro do try: até uma falha/timeout na preparação precisa limpar a
    // emulação e fechar o CDP no finally.
    metricsOverrideRequested = true;
    await client.request("Emulation.setDeviceMetricsOverride", {
      width: PROFILE_VIEWPORT_WIDTH,
      height: PROFILE_VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: PROFILE_VIEWPORT_WIDTH,
      screenHeight: PROFILE_VIEWPORT_HEIGHT,
      dontSetVisibleSize: false,
    });
    await client.evaluate(`(async () => {
      window.dispatchEvent(new Event('resize'));
      await wait(300);
      return [innerWidth, innerHeight];
    })()`);

    // ── 1. O palco é ambiente à parte, com chão de verdade ──────────────────
    {
      const report = await client.evaluate(
        `(async () => {
          const id = session().actions.addNodeOfType('studio.stage');
          if (id === null) throw new Error('addNodeOfType recusou studio.stage');
          await atFrame(0);
          await wait(200);
          const status = studio();
          const image = studioPixels();
          // Três linhas espalhadas pela altura: perto do horizonte a grade
          // adensa, perto da base ela abre. Se só uma tivesse transições,
          // seria artefato, não grade.
          const rows = [0.55, 0.7, 0.85].map((f) => Math.floor(image.height * f));
          const transitions = rows.map((y) => lineTransitions(image, y));
          return {
            id,
            mapAusente: mapAusenteDoPalco(),
            overlayProprio: studioOverlayPresente(),
            studioShowing: studioVisible(),
            renders: status.renders,
            active: status.active,
            contextLost: status.contextLost,
            lastError: status.lastError,
            transitions,
            size: [image.width, image.height],
          };
        })()`,
      );
      stageId = report.id;
      const gridOk = report.transitions.filter((count) => count >= 4).length >= 2;
      const ok =
        report.mapAusente &&
        report.overlayProprio &&
        report.studioShowing &&
        report.active &&
        report.renders > 0 &&
        !report.contextLost &&
        gridOk;
      record(
        "1 · palco é ambiente à parte e desenha chão com grade",
        ok,
        `mapa dentro do painel do palco: ${report.mapAusente ? "AUSENTE (correto)" : "PRESENTE"}, ` +
          `overlay próprio ${report.overlayProprio ? "ok" : "AUSENTE"}, ` +
          `palco ${report.studioShowing ? "visível" : "oculto"}, ${report.renders} renders, ` +
          `contexto ${report.contextLost ? "PERDIDO" : "ok"}, transições por linha ${report.transitions.join("/")} ` +
          `em ${report.size.join("×")}${report.lastError === null ? "" : `, erro: ${report.lastError}`}`,
      );
    }

    // ── 2. O modelo aparece em pixels sobre o chão ──────────────────────────
    {
      const report = await client.evaluate(
        `(async () => {
          const found = await ensureModelAsset();
          if (found === null) return { skipped: 'nenhum modelo disponível na Biblioteca local' };
          await atFrame(0);
          await wait(200);
          const empty = studioPixels();
          // applyAsset é o caminho de verdade: é o que a Biblioteca chama ao
          // trazer um modelo para a cena, e é ele que sabe que props.assetId
          // guarda o src e não o id.
          const id = session().actions.applyAsset(found.asset.id);
          if (id === null) throw new Error('applyAsset recusou o modelo');
          // Metros de verdade no palco: um caça tem 18 m, não 30 000.
          session().actions.setPropertyValue(id, 'props.scaleMeters', 18);
          await atFrame(0);
          // O GLB carrega fora do frame; o palco avisa e o overlay repinta.
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline && studio().loaded === 0) await wait(80);
          await wait(400);
          const withModel = studioPixels();
          const box = changedBox(empty, withModel);
          // Opacidade zero, não visible: a propriedade de visibilidade não é
          // editável por caminho, e opacidade é o controle real que o usuário
          // tem para apagar um modelo do palco.
          const applied = session().actions.setPropertyValue(id, 'transform.opacity', 0);
          await atFrame(0);
          await wait(250);
          const hidden = studioPixels();
          session().actions.setPropertyValue(id, 'transform.opacity', 1);
          await atFrame(0);
          await wait(250);
          return {
            id,
            importedFile: found.file,
            loaded: studio().loaded,
            models: studio().models,
            box,
            applied,
            hiddenDelta: differingPixels(empty, hidden),
            lastError: studio().lastError,
            size: [empty.width, empty.height],
          };
        })()`,
      );
      if (report.skipped !== undefined) {
        record("2 · modelo no palco", false, `pulado: ${report.skipped}`);
      } else {
        modelId = report.id;
        const area = report.size[0] * report.size[1];
        // O modelo tem de pintar área visível — mas não a tela inteira, o que
        // significaria a câmera dentro dele.
        const painted = report.box === null ? 0 : report.box.count;
        const ok =
          report.loaded === 1 &&
          painted > area * 0.002 &&
          painted < area * 0.6 &&
          report.hiddenDelta < area * 0.002;
        record(
          "2 · modelo carrega, pinta o palco e some quando oculto",
          ok,
          `${report.importedFile}: ${report.loaded}/${report.models} carregado, ${painted} px pintados ` +
            `(${((painted / area) * 100).toFixed(2)}% de ${report.size.join("×")}), ` +
            `caixa ${report.box === null ? "nenhuma" : `${report.box.width}×${report.box.height}`}, ` +
            `opacidade 0 ${report.applied ? "aplicada" : "RECUSADA"} deixa ${report.hiddenDelta} px de resíduo` +
            `${report.lastError === null ? "" : `, erro: ${report.lastError}`}`,
        );
      }
    }

    // ── 3. Keyframe no azimute orbita a câmera de verdade ───────────────────
    if (stageId !== undefined) {
      const report = await client.evaluate(
        `(async () => {
          const id = ${JSON.stringify(stageId)};
          session().actions.setPlayhead(0);
          if (!session().actions.togglePropertyKeyframe(id, 'props.azimuthDeg')) {
            throw new Error('não deu para gravar keyframe no azimute');
          }
          session().actions.setPropertyValue(id, 'props.azimuthDeg', 0);
          session().actions.setPlayhead(60);
          session().actions.setPropertyValue(id, 'props.azimuthDeg', 180);
          const samples = [];
          const frames = [0, 20, 40, 60];
          for (const frame of frames) {
            await atFrame(frame);
            await wait(160);
            samples.push({
              frame,
              camera: studio().cameraPosition,
              image: studioPixels(),
            });
          }
          const target = [0, 0, 0];
          const radii = samples.map((s) =>
            Math.hypot(s.camera[0] - target[0], s.camera[1] - target[1], s.camera[2] - target[2]),
          );
          const azimuths = samples.map((s) => (Math.atan2(s.camera[0], s.camera[2]) * 180) / Math.PI);
          const deltas = [];
          for (let i = 1; i < samples.length; i += 1) {
            deltas.push(differingPixels(samples[i - 1].image, samples[i].image));
          }
          return {
            frames,
            radii,
            azimuths,
            deltas,
            size: [samples[0].image.width, samples[0].image.height],
          };
        })()`,
      );
      const area = report.size[0] * report.size[1];
      const radiusSpread = Math.max(...report.radii) - Math.min(...report.radii);
      // Órbita: raio constante (a menos de arredondamento) e azimute varrendo.
      const radiusOk = radiusSpread < 0.05;
      const sweepOk = Math.abs(report.azimuths[3] - report.azimuths[0]) > 150;
      // A imagem tem de mudar de verdade entre as amostras: uma câmera que
      // gira sem mudar a imagem é um número que muda, não uma câmera.
      const imageOk = report.deltas.every((delta) => delta > area * 0.02);
      record(
        "3 · azimute animado orbita a câmera e muda a imagem",
        radiusOk && sweepOk && imageOk,
        `raio ${report.radii.map((r) => r.toFixed(3)).join("/")} m (dispersão ${radiusSpread.toFixed(4)} m), ` +
          `azimute ${report.azimuths.map((a) => a.toFixed(1)).join("→")}°, ` +
          `pixels alterados ${report.deltas.map((d) => `${((d / area) * 100).toFixed(1)}%`).join("/")}`,
      );
    }

    // ── 4. Rótulo técnico acompanha o modelo pela projeção 3D ───────────────
    //
    // Medido em PIXEL, não lendo o layout. A versão anterior lia
    // window.__theatrumPhase4 — o overlay do VIEWPORT — para achar as posições, e
    // esse painel está desmontado quando a aba do palco está na frente
    // (ADR-014). Além de quebrar, era a prova errada: afirmava a estrutura
    // interna em vez do efeito. Agora a projeção vem do diagnóstico do palco e a
    // posição do rótulo vem dos pixels que ele realmente desenhou.
    if (modelId !== undefined) {
      const report = await client.evaluate(
        `(async () => {
          const id = session().actions.addNodeOfType('label.callout');
          if (id === null) throw new Error('addNodeOfType recusou label.callout');
          session().actions.setPropertyValue(id, 'props.targetId', ${JSON.stringify(modelId)});
          session().actions.setPropertyValue(id, 'props.text', 'F/A-18 · 18 m');
          session().actions.setPropertyValue(id, 'props.offsetX', 140);
          session().actions.setPropertyValue(id, 'props.offsetY', -90);
          // O modelo sai do centro para que a projeção tenha o que provar: com
          // ele na origem, o rótulo acertaria o alvo mesmo com projeção errada.
          session().actions.setPropertyValue(${JSON.stringify(modelId)}, 'props.stageX', 6);
          const stageX = 6;
          const samples = [];
          for (const frame of [0, 20, 40]) {
            await atFrame(frame);
            await wait(220);
            samples.push({
              frame,
              modelo: window.__theatrumStudio.project([stageX, 0, 0]),
              rotulo: calloutCentroid(),
            });
          }
          return { id, samples };
        })()`,
      );
      const completos = report.samples.filter(
        (sample) => Array.isArray(sample.modelo) && Array.isArray(sample.rotulo),
      );
      // O rótulo fica do lado pedido do modelo: à direita (offsetX 140) e acima
      // (offsetY -90). Tolerância larga de propósito — o centroide é do BLOCO
      // desenhado, com caixa e guia, não do ponto de âncora. O que se prova é a
      // relação, não uma coordenada exata.
      const ladoOk =
        completos.length === report.samples.length &&
        completos.every(
          (sample) =>
            sample.rotulo[0] > sample.modelo[0] && sample.rotulo[1] < sample.modelo[1] + 40,
        );
      // E o modelo tem de se mover de verdade na tela enquanto a câmera orbita —
      // senão a relação acima se manteria por acidente, com tudo parado.
      const andou =
        completos.length < 2
          ? 0
          : Math.hypot(
              completos[completos.length - 1].modelo[0] - completos[0].modelo[0],
              completos[completos.length - 1].modelo[1] - completos[0].modelo[1],
            );
      // O rótulo tem de acompanhar: se ele ficasse parado enquanto o modelo anda,
      // a relação de lado quebraria em algum frame — mas medir os dois deixa a
      // falha legível em vez de misteriosa.
      const rotuloAndou =
        completos.length < 2
          ? 0
          : Math.hypot(
              completos[completos.length - 1].rotulo[0] - completos[0].rotulo[0],
              completos[completos.length - 1].rotulo[1] - completos[0].rotulo[1],
            );
      record(
        "4 · rótulo acompanha o modelo pela projeção da câmera orbital",
        ladoOk && andou > 12 && rotuloAndou > 6,
        `${completos.length}/${report.samples.length} amostras com rótulo desenhado, ` +
          `lado ${ladoOk ? "correto em todas" : "ERRADO"}, ` +
          `modelo andou ${andou.toFixed(1)} px, rótulo andou ${rotuloAndou.toFixed(1)} px`,
      );
    }

    // ── 5. Ponto de interesse nasce do clique, e o roteiro leva a câmera lá ──
    //
    // O critério do [ADR-015](../docs/adr/ADR-015-studio-points-of-interest.md).
    // Ele prova a cadeia inteira com dois cliques de mouse DE VERDADE, e as duas
    // afirmações que sobram são em pixel:
    //
    // - **ida e volta**: projetar o ponto que o raycast devolveu tem de cair no
    //   pixel de onde o raio partiu. Duas transformações independentes casando
    //   em pixel é o que pega matriz de um frame atrás, que nenhum teste de
    //   unidade veria;
    // - **a câmera visitou**: no frame de chegada da segunda parada, o ponto dela
    //   tem de projetar no CENTRO da tela — porque é para lá que a câmera mira.
    //   Isso afirma o efeito, não a estrutura: não adianta o keyframe existir se
    //   a câmera não for.
    if (modelId !== undefined && stageId !== undefined) {
      const alvos = await client.evaluate(
        `(async () => {
          await atFrame(0);
          const botao = studioTool('Marcar pontos');
          if (botao === null) throw new Error('botão "Marcar pontos" ausente na barra do palco');
          /*
           * GARANTE o modo ligado, em vez de alternar.
           *
           * Alternar assumia que ele começa desligado, e isso é falso na segunda rodada
           * seguida do verificador: os critérios 8 e 10 ligam a marcação e não desligam, e
           * o modo é estado do PAINEL — o undo do documento no fim não o desfaz. Resultado:
           * a segunda rodada desligava a marcação aqui e criava zero pontos, com a mesma
           * mensagem de "clique errou a geometria". É a irmã da falsa aprovação do critério
           * 10: critério que herda estado de outra rodada não mede o que o nome dele diz.
           *
           * Botão HTML comum: aqui click() basta. Foi a ABA do dockview que exigiu evento
           * de ponteiro por coordenada (ADR-014), não isto.
           *
           * (Sem acento grave neste comentário: ele vive dentro de um template literal.)
           */
          if (botao.getAttribute('aria-pressed') !== 'true') {
            botao.click();
            await wait(200);
          }
          const canvas = studioCanvas().getBoundingClientRect();
          /**
           * Dois pixels que o raycast REALMENTE acerta, achados por varredura.
           *
           * Antes eram duas coordenadas de mundo fixas — \`[6,0,0]\` e \`[6,1.2,0]\` —
           * escolhidas para a silhueta do F/A-18. Numa máquina cuja
           * \`library-roots.json\` serve outro modelo, o primeiro cai no vão embaixo
           * do veículo: o clique erra a geometria, só um ponto nasce, e a ida e
           * volta passa a comparar esse ponto com o pixel do clique que ERROU —
           * reprovando o critério por causa do arquivo instalado, não do código.
           * Foi assim que ele estava vermelho nesta máquina antes do ADR-016.
           *
           * A varredura não presume silhueta nenhuma. É a mesma correção que o
           * critério 2 recebeu ao ganhar recuo para o GLB do repositório: critério
           * de fase não pode depender de configuração de máquina.
           */
          const acertos = [];
          const passo = 32;
          for (let y = Math.round(canvas.height * 0.15); y < canvas.height * 0.9; y += passo) {
            for (let x = Math.round(canvas.width * 0.15); x < canvas.width * 0.85; x += passo) {
              if (window.__theatrumStudio.pick(x, y) !== null) acertos.push([x, y]);
            }
          }
          if (acertos.length < 2) {
            throw new Error('varredura não achou dois pixels de geometria no palco');
          }
          const primeiro = acertos[0];
          // O mais distante do primeiro: os dois marcadores não podem cair dentro
          // do mesmo raio de acerto (16 px), senão o segundo clique SELECIONA o
          // marcador do primeiro em vez de criar um ponto novo.
          let segundo = primeiro;
          let maior = -1;
          for (const candidato of acertos) {
            const d = Math.hypot(candidato[0] - primeiro[0], candidato[1] - primeiro[1]);
            if (d > maior) {
              maior = d;
              segundo = candidato;
            }
          }
          return {
            canvas: [canvas.left, canvas.top, canvas.width, canvas.height],
            pontos: [primeiro, segundo],
            separacaoPx: maior,
            acertos: acertos.length,
            marcandoAntes: markerInk(),
            // Ligou de fato ao clicar no botão? Distingue "nunca ligou" de "algo desligou".
            ligouAoClicar: studioTool('Marcar pontos')?.getAttribute('aria-pressed') === 'true',
            // E onde está a barra de ferramentas, para saber se um clique pode acertá-la.
            toolbar: (() => {
              const tools = document.querySelector('.studio-viewport__tools');
              if (tools === null) return null;
              const r = tools.getBoundingClientRect();
              return [Math.round(r.top), Math.round(r.bottom)];
            })(),
          };
        })()`,
      );

      const cliques = [];
      for (const ponto of alvos.pontos) {
        if (!Array.isArray(ponto)) continue;
        const x = Math.round(alvos.canvas[0] + ponto[0]);
        const y = Math.round(alvos.canvas[1] + ponto[1]);
        await client.request("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        for (const type of ["mousePressed", "mouseReleased"]) {
          await client.request("Input.dispatchMouseEvent", {
            type,
            x,
            y,
            button: "left",
            clickCount: 1,
          });
        }
        cliques.push([ponto[0], ponto[1]]);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const report = await client.evaluate(
        `(async () => {
          await wait(250);
          const pois = nodesOfType('studio.poi');
          const cliques = ${JSON.stringify(cliques)};
          /**
           * O ponto **resolvido**, não o triplo cru do documento ([ADR-016](../docs/adr/ADR-016-poi-anchored-to-object.md)).
           *
           * Com dono, \`props.pointX\` é o espaço normalizado do modelo — projetá-lo
           * como se fosse metros de palco põe o alvo perto da origem e mede o lugar
           * errado com total confiança. \`__theatrumStudio.pois()\` entrega o que o
           * palco de fato usa.
           */
          const resolvidos = window.__theatrumStudio.pois();
          // Ida e volta: onde cada ponto marcado projeta agora.
          const roundTrip = resolvidos.map((poi, index) => {
            const tela = window.__theatrumStudio.project(poi.point);
            const clique = cliques[index];
            return tela === null || clique === undefined
              ? null
              : Math.hypot(tela[0] - clique[0], tela[1] - clique[1]);
          });
          // O ponto tem de estar na SUPERFÍCIE do modelo, não no chão nem no
          // vazio. O modelo está em stageX = 6, e nada legítimo cai a mais de 12 m
          // do centro de um objeto de 18 m de vão.
          const distanciasAoModelo = resolvidos.map((poi) =>
            Math.hypot(poi.point[0] - 6, poi.point[1], poi.point[2]),
          );
          // E cada ponto nasceu ANCORADO no objeto, não solto no palco: é o que o
          // ADR-016 decidiu, e é o que faz o ponto sobreviver ao objeto se mexer.
          const ancorados = resolvidos.filter((poi) => poi.ownerId !== '' && !poi.orphan).length;
          const tintaMarcando = markerInk();
          const marcadores = window.__theatrumStudio.markers();
          /**
           * A barra de estado do painel, no relatório.
           *
           * Sem ela, "0 pontos criados" não distingue clique que errou a geometria, modo de
           * marcação desligado, modelo ainda carregando e falha ao gravar a prop — quatro
           * causas com o mesmo sintoma. O painel já sabe qual foi; era só perguntar.
           */
          const estado = document.querySelector('.studio-viewport__status')?.textContent ?? '';
          const marcandoLigado =
            studioTool('Marcar pontos')?.getAttribute('aria-pressed') === 'true';

          // Compilar. O aviso de substituição é window.confirm, o mesmo padrão
          // que o resto do editor usa para ação destrutiva; aqui ele é respondido
          // em vez de contornado, senão o critério não passaria pelo caminho que
          // o dono percorre.
          const confirmOriginal = window.confirm;
          window.confirm = () => true;
          let compilou = false;
          try {
            const compilar = studioTool('Compilar roteiro');
            if (compilar === null) throw new Error('botão "Compilar roteiro" ausente');
            compilar.click();
            compilou = true;
          } finally {
            window.confirm = confirmOriginal;
          }
          await wait(250);

          const palco = composition().nodes[${JSON.stringify(stageId)}];
          const trilhas = [
            'targetX', 'targetY', 'targetZ', 'distanceMeters', 'azimuthDeg', 'elevationDeg',
          ].map((key) => palco.props[key].keyframes.length);

          return {
            pois: pois.length,
            estado,
            marcandoLigado,
            roundTrip,
            distanciasAoModelo,
            ancorados,
            tintaMarcando,
            marcadores: marcadores.length,
            ordinais: marcadores.map((m) => m.ordinal),
            compilou,
            trilhas,
            chegadaSegunda: palco.props.targetX.keyframes.map((k) => k.frame),
            // Resolvido, pela mesma razão da ida e volta.
            pontoSegunda: resolvidos.length < 2 ? null : resolvidos[1].point,
          };
        })()`,
      );

      // A câmera visitou de verdade? No frame de chegada da segunda parada o
      // ponto dela projeta no centro da tela, porque é o alvo da câmera.
      let centragem = null;
      let apagou = null;
      if (report.pontoSegunda !== null && report.chegadaSegunda.length >= 3) {
        const chegada = report.chegadaSegunda[2];
        const visita = await client.evaluate(
          `(async () => {
            await atFrame(${String(chegada)});
            const canvas = studioCanvas().getBoundingClientRect();
            const tela = window.__theatrumStudio.project(${JSON.stringify(report.pontoSegunda)});
            // E desliga a marcação: a superfície tem de ficar limpa, não guardar
            // o último quadro desenhado.
            studioTool('Marcar pontos').click();
            await wait(250);
            return {
              tela,
              centro: [canvas.width / 2, canvas.height / 2],
              tintaDepois: markerInk(),
            };
          })()`,
        );
        centragem =
          visita.tela === null
            ? null
            : Math.hypot(visita.tela[0] - visita.centro[0], visita.tela[1] - visita.centro[1]);
        apagou = visita.tintaDepois;
      }

      const roundTripOk =
        report.roundTrip.length === 2 && report.roundTrip.every((d) => d !== null && d < 3);
      const superficieOk =
        report.distanciasAoModelo.length === 2 && report.distanciasAoModelo.every((d) => d < 12);
      const trilhasOk = report.trilhas.every((count) => count === 4);
      // Tolerância de 6 px: o alvo da câmera é o ponto, e o resto é arredondamento
      // de projeção e do próprio frame de chegada.
      const centradoOk = centragem !== null && centragem < 6;
      record(
        "5 · ponto do clique vira nó, e o roteiro leva a câmera até ele",
        report.pois === 2 &&
          roundTripOk &&
          superficieOk &&
          // Os dois pontos nasceram ancorados no objeto (ADR-016), não soltos.
          report.ancorados === 2 &&
          report.tintaMarcando > 200 &&
          report.marcadores === 2 &&
          report.compilou &&
          trilhasOk &&
          centradoOk &&
          apagou === 0,
        `${report.pois} ponto(s) criados por clique, ${report.ancorados} ancorado(s) no objeto, ` +
          `ida e volta ` +
          `${report.roundTrip.map((d) => (d === null ? "—" : d.toFixed(2))).join("/")} px, ` +
          `distância ao modelo ${report.distanciasAoModelo.map((d) => d.toFixed(1)).join("/")} m, ` +
          `marcadores ${report.ordinais.join("/")} com ${report.tintaMarcando} px de tinta ` +
          `(${apagou} depois de desligar), ` +
          `keyframes por trilha ${report.trilhas.join("/")}, ` +
          `ponto centrado a ${centragem === null ? "—" : centragem.toFixed(2)} px do centro ` +
          `· marcação ligou ao clicar: ${String(alvos.ligouAoClicar)}, no fim: ${String(report.marcandoLigado)}, ` +
          `toolbar em y ${JSON.stringify(alvos.toolbar)}, cliques em ${JSON.stringify(cliques)}, ` +
          `painel diz "${report.estado}" ` +
          `· sondagem achou ${String(alvos.acertos)} pixels de geometria, ` +
          `separação ${alvos.separacaoPx.toFixed(0)} px`,
      );

      // ── 7. Ponto ancorado sobrevive a mover, girar e escalar o objeto ────────
      //
      // O critério do [ADR-016](../docs/adr/ADR-016-poi-anchored-to-object.md), e
      // o relato do dono que o motivou: _"se o avião mudar de escala os objetos
      // ficam travados no limbo e não no objeto"_.
      //
      // **A reprodução do defeito e a correção convivem no mesmo run.** Dois
      // pontos nascem no mesmo lugar do palco: um ancorado no objeto (o clique
      // grava o dono) e um solto, que é exatamente o comportamento de antes deste
      // ADR. Depois o objeto muda de lugar, de rumo e de vão. O ancorado tem de
      // acompanhar e continuar projetando sobre a silhueta; o solto tem de ficar
      // onde estava — e o pixel dele deixa de acertar geometria alguma. É a
      // diferença entre "no míssil" e "no vazio", medida em pixel.
      const ancoragem = await client.evaluate(
        `(async () => {
          await atFrame(0);
          const stageId = ${JSON.stringify(stageId)};
          const modelId = ${JSON.stringify(modelId)};
          const actions = session().actions;

          // A câmera compilada pelo critério 5 sai de cena: este critério mede o
          // PONTO, e câmera animada mudaria o enquadramento junto com a escala,
          // misturando duas causas num número só.
          actions.writeStudioTour(stageId, [
            'props.targetX', 'props.targetY', 'props.targetZ',
            'props.distanceMeters', 'props.azimuthDeg', 'props.elevationDeg',
          ].map((path) => ({ path, keyframes: [] })));
          // Enquadramento largo que cobre o objeto ANTES e DEPOIS de ele andar.
          for (const [path, value] of [
            ['props.targetX', 13], ['props.targetY', 2], ['props.targetZ', 0],
            ['props.distanceMeters', 70], ['props.azimuthDeg', 35], ['props.elevationDeg', 14],
          ]) actions.setPropertyValue(stageId, path, value, false);
          for (const [path, value] of [
            ['props.stageX', 6], ['props.scaleMeters', 18], ['props.headingOffset', 0],
          ]) actions.setPropertyValue(modelId, path, value, false);
          await wait(300);

          // Marca um ponto novo na superfície, por clique de verdade — o dono vem
          // do \`pick\`, como no critério 5.
          if (studioTool('Marcar pontos').getAttribute('aria-pressed') !== 'true') {
            studioTool('Marcar pontos').click();
            await wait(200);
          }
          const canvas = studioCanvas().getBoundingClientRect();
          let alvo = null;
          for (let y = Math.round(canvas.height * 0.2); y < canvas.height * 0.85 && alvo === null; y += 16) {
            for (let x = Math.round(canvas.width * 0.2); x < canvas.width * 0.8; x += 16) {
              if (window.__theatrumStudio.pick(x, y) !== null) { alvo = [x, y]; break; }
            }
          }
          if (alvo === null) throw new Error('nenhum pixel de geometria para o critério 7');
          return { canvas: [canvas.left, canvas.top], alvo };
        })()`,
      );

      const alvoX = Math.round(ancoragem.canvas[0] + ancoragem.alvo[0]);
      const alvoY = Math.round(ancoragem.canvas[1] + ancoragem.alvo[1]);
      await client.request("Input.dispatchMouseEvent", { type: "mouseMoved", x: alvoX, y: alvoY });
      for (const type of ["mousePressed", "mouseReleased"]) {
        await client.request("Input.dispatchMouseEvent", {
          type,
          x: alvoX,
          y: alvoY,
          button: "left",
          clickCount: 1,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 300));

      const invariancia = await client.evaluate(
        `(async () => {
          await wait(250);
          const modelId = ${JSON.stringify(modelId)};
          const actions = session().actions;
          const antes = window.__theatrumStudio.pois();
          const ancorado = antes.find((poi) => poi.ownerId === modelId);
          if (ancorado === undefined) throw new Error('o clique do critério 7 não ancorou o ponto');

          // O controle: mesmo lugar do palco, SEM dono. É o comportamento de antes
          // do ADR-016, montado de propósito para poder ser medido ao lado.
          const controleId = actions.addStudioPoi(
            ancorado.point, 'Controle solto', { distanceMeters: 12, azimuthDeg: 35, elevationDeg: 18 }, '',
          );
          await wait(250);
          const w1 = ancorado.point;

          // Agora o objeto anda 14 m, cresce de 18 para 30 m de vão e gira 55°.
          for (const [path, value] of [
            ['props.stageX', 20], ['props.scaleMeters', 30], ['props.headingOffset', 55],
          ]) actions.setPropertyValue(modelId, path, value, false);
          await wait(400);

          const depois = window.__theatrumStudio.pois();
          const ancoradoDepois = depois.find((poi) => poi.id === ancorado.id);
          const controleDepois = depois.find((poi) => poi.id === controleId);
          if (ancoradoDepois === undefined || controleDepois === undefined) {
            throw new Error('ponto desapareceu entre as duas leituras');
          }
          const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          const telaAncorado = window.__theatrumStudio.project(ancoradoDepois.point);
          const telaControle = window.__theatrumStudio.project(controleDepois.point);
          return {
            andouAncorado: dist(ancoradoDepois.point, w1),
            andouControle: dist(controleDepois.point, w1),
            // Cada ponto projeta sobre geometria, ou sobre o vazio?
            acertaAncorado:
              telaAncorado === null
                ? null
                : (window.__theatrumStudio.pick(telaAncorado[0], telaAncorado[1])?.modelId ?? null),
            acertaControle:
              telaControle === null
                ? null
                : (window.__theatrumStudio.pick(telaControle[0], telaControle[1])?.modelId ?? null),
            orfaoAncorado: ancoradoDepois.orphan,
          };
        })()`,
      );

      record(
        "7 · ponto ancorado acompanha mover, girar e escalar o objeto",
        // O ancorado andou junto com o objeto...
        invariancia.andouAncorado > 5 &&
          // ...e continua sobre a superfície DELE, medido em pixel pelo raycast.
          invariancia.acertaAncorado === modelId &&
          !invariancia.orfaoAncorado &&
          // O controle solto ficou exatamente onde estava — é o defeito relatado...
          invariancia.andouControle < 1e-9 &&
          // ...e o pixel dele não acerta geometria alguma: o limbo, medido.
          invariancia.acertaControle === null,
        `ancorado andou ${invariancia.andouAncorado.toFixed(2)} m e ainda acerta ` +
          `${invariancia.acertaAncorado === modelId ? "o objeto" : String(invariancia.acertaAncorado)}; ` +
          `controle solto andou ${invariancia.andouControle.toFixed(2)} m e acerta ` +
          `${invariancia.acertaControle === null ? "o vazio" : "geometria"}`,
      );

      // ── 8. Câmera de autoria move a imagem sem mover o documento ─────────────
      //
      // O critério do [ADR-017](../docs/adr/ADR-017-studio-authoring-camera.md), e as
      // três afirmações que ele exige:
      //
      // 1. arrastar o mouse **muda a imagem** e **não muda uma vírgula** das props do
      //    palco — é o que garante que o export continua sendo o documento;
      // 2. o enquadramento que um POI grava é o da câmera **solta**, não o do
      //    documento. Era a lacuna que o ADR-015 descrevia sem poder cumprir, porque
      //    não havia como girar o palco com o mouse;
      // 3. "Gravar enquadramento" leva as seis props **exatamente** para os valores
      //    compostos — exato por construção, porque as duas câmeras vivem no mesmo
      //    espaço de parâmetros. É o argumento que derrubou a câmera de voo livre.
      const seisProps = [
        "targetX",
        "targetY",
        "targetZ",
        "distanceMeters",
        "azimuthDeg",
        "elevationDeg",
      ];
      const antesDoArrasto = await client.evaluate(
        `(async () => {
          await atFrame(0);
          // Marcação ligada de propósito: o pedido do dono é mover o cenário
          // livremente COM o modo de marcação ativo, e é essa combinação que o
          // limiar de arrasto tem de resolver.
          if (studioTool('Marcar pontos').getAttribute('aria-pressed') !== 'true') {
            studioTool('Marcar pontos').click();
            await wait(200);
          }
          const canvas = studioCanvas().getBoundingClientRect();
          const palco = composition().nodes[${JSON.stringify(stageId)}];
          const image = studioPixels();
          return {
            canvas: [canvas.left, canvas.top, canvas.width, canvas.height],
            props: ${JSON.stringify(seisProps)}.map((key) => palco.props[key].value),
            camera: window.__theatrumStudio.camera(),
            soma: [...image.data].reduce((total, value) => total + value, 0),
          };
        })()`,
      );

      // Arrasto de verdade: press, vários move, release. Um único `mouseMoved` de 200 px
      // passaria pelo limiar mas não parece com o gesto humano que o produto recebe.
      const arrastoX = Math.round(antesDoArrasto.canvas[0] + antesDoArrasto.canvas[2] * 0.5);
      const arrastoY = Math.round(antesDoArrasto.canvas[1] + antesDoArrasto.canvas[3] * 0.5);
      await client.request("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: arrastoX,
        y: arrastoY,
        button: "left",
        clickCount: 1,
      });
      for (let step = 1; step <= 10; step += 1) {
        await client.request("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: arrastoX + step * 18,
          y: arrastoY + step * 4,
          button: "left",
          buttons: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      await client.request("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: arrastoX + 180,
        y: arrastoY + 40,
        button: "left",
        clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 350));

      const autoria = await client.evaluate(
        `(async () => {
          await wait(200);
          const stageId = ${JSON.stringify(stageId)};
          const chaves = ${JSON.stringify(seisProps)};
          const depoisDoArrasto = studioPixels();
          const palcoDepois = composition().nodes[stageId];
          const cameraSolta = window.__theatrumStudio.camera();
          const poisAntes = window.__theatrumStudio.pois().length;

          // Um ponto marcado AGORA tem de gravar o azimute da câmera solta.
          let alvo = null;
          const canvas = studioCanvas().getBoundingClientRect();
          for (let y = Math.round(canvas.height * 0.2); y < canvas.height * 0.85 && alvo === null; y += 16) {
            for (let x = Math.round(canvas.width * 0.2); x < canvas.width * 0.8; x += 16) {
              if (window.__theatrumStudio.pick(x, y) !== null) { alvo = [x, y]; break; }
            }
          }
          return {
            somaDepois: [...depoisDoArrasto.data].reduce((total, value) => total + value, 0),
            propsDepois: chaves.map((key) => palcoDepois.props[key].value),
            cameraSolta,
            poisAntes,
            alvo,
            canvas: [canvas.left, canvas.top],
          };
        })()`,
      );

      // Marca com a câmera solta, e depois grava o enquadramento.
      let enquadramento = null;
      if (Array.isArray(autoria.alvo)) {
        const mx = Math.round(autoria.canvas[0] + autoria.alvo[0]);
        const my = Math.round(autoria.canvas[1] + autoria.alvo[1]);
        await client.request("Input.dispatchMouseEvent", { type: "mouseMoved", x: mx, y: my });
        for (const type of ["mousePressed", "mouseReleased"]) {
          await client.request("Input.dispatchMouseEvent", {
            type,
            x: mx,
            y: my,
            button: "left",
            clickCount: 1,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        enquadramento = await client.evaluate(
          `(async () => {
            await wait(200);
            const chaves = ${JSON.stringify(seisProps)};
            const pontos = nodesOfType('studio.poi');
            const ultimo = pontos[pontos.length - 1];
            const camera = window.__theatrumStudio.camera();
            // Gravar: as seis props do palco têm de virar exatamente o que se compôs.
            const confirmOriginal = window.confirm;
            window.confirm = () => true;
            try {
              studioTool('Gravar enquadramento').click();
            } finally {
              window.confirm = confirmOriginal;
            }
            await wait(300);
            const palco = composition().nodes[${JSON.stringify(stageId)}];
            return {
              azimutePonto: ultimo === undefined ? null : ultimo.props.azimuthDeg.value,
              azimuteCamera: camera === null ? null : camera.azimuthDeg,
              gravado: chaves.map((key) => palco.props[key].value),
              alvoComposto: camera === null ? null : [
                camera.target[0], camera.target[1], camera.target[2],
                camera.distanceMeters, camera.azimuthDeg, camera.elevationDeg,
              ],
              soltaDepoisDeGravar: window.__theatrumStudio.camera()?.authoring ?? null,
            };
          })()`,
        );
      }

      const documentoIntacto =
        JSON.stringify(antesDoArrasto.props) === JSON.stringify(autoria.propsDepois);
      const imagemMudou = autoria.somaDepois !== antesDoArrasto.soma;
      const soltou = autoria.cameraSolta?.authoring === true;
      const girou =
        autoria.cameraSolta !== null &&
        antesDoArrasto.camera !== null &&
        Math.abs(autoria.cameraSolta.azimuthDeg - antesDoArrasto.camera.azimuthDeg) > 1;
      // O ponto gravou o ângulo da câmera solta, não o do documento.
      const pontoSeguiuACamera =
        enquadramento !== null &&
        enquadramento.azimutePonto !== null &&
        enquadramento.azimuteCamera !== null &&
        Math.abs(enquadramento.azimutePonto - enquadramento.azimuteCamera) < 0.01;
      // E gravar foi exato: nenhuma conversão, nenhum salto.
      const gravouExato =
        enquadramento !== null &&
        enquadramento.alvoComposto !== null &&
        enquadramento.gravado.every(
          (value, index) => Math.abs(value - enquadramento.alvoComposto[index]) < 1e-9,
        );

      record(
        "8 · câmera de autoria move a imagem sem mover o documento",
        soltou &&
          girou &&
          imagemMudou &&
          documentoIntacto &&
          pontoSeguiuACamera &&
          gravouExato &&
          // Gravar devolve a câmera ao documento: o desvio deixou de existir porque
          // agora ele É o documento.
          enquadramento.soltaDepoisDeGravar === false,
        `arrasto girou o azimute de ${antesDoArrasto.camera?.azimuthDeg.toFixed(1)}° para ` +
          `${autoria.cameraSolta?.azimuthDeg.toFixed(1)}°, imagem ${imagemMudou ? "mudou" : "NÃO mudou"}, ` +
          `props do palco ${documentoIntacto ? "intactas" : "ALTERADAS"}; ` +
          `ponto marcado gravou ${enquadramento?.azimutePonto?.toFixed(1) ?? "—"}° ` +
          `contra ${enquadramento?.azimuteCamera?.toFixed(1) ?? "—"}° da câmera; ` +
          `gravar foi ${gravouExato ? "exato nas seis props" : "INEXATO"}`,
      );

      // ── 9. O horizonte dissolve em vez de terminar numa aresta ───────────────
      //
      // A queixa do dono, palavra por palavra: _"parece que metade da tela do palco
      // está cortada... não dá sensação de espaço... está esquisita essa linha de
      // transição da base com o fundo"_.
      //
      // Isso se mede. Uma coluna de pixels atravessando o horizonte tem de variar
      // **suavemente**: o maior salto entre dois pixels vizinhos é a altura da aresta.
      // Com a névoa desligada o salto reaparece — e o critério afirma os dois lados,
      // senão ele passaria com um palco chapado, que também não tem aresta.
      const horizonte = await client.evaluate(
        `(async () => {
          const stageId = ${JSON.stringify(stageId)};
          const actions = session().actions;
          // Câmera rasante: é o enquadramento em que o horizonte cruza a tela e a
          // costura, se existir, fica bem no meio.
          //
          // **Grade e textura desligadas durante a medição.** Linha de grade é uma
          // aresta nítida DE PROPÓSITO, e com ela ligada o maior salto da coluna é
          // sempre uma linha da grade — foi assim que a primeira versão deste critério
          // mediu 14,6 com e sem névoa e concluiu nada. Sem elas, a única estrutura
          // vertical que sobra é a transição piso → fundo, que é justamente o assunto.
          for (const [path, value] of [
            ['props.targetY', 0], ['props.distanceMeters', 60], ['props.elevationDeg', 8],
            ['props.gridOpacity', 0], ['props.floorTexture', 0], ['props.vignette', 0],
          ]) actions.setPropertyValue(stageId, path, value, false);

          // Uma coluna no centro, longe do modelo, medida em luminância.
          const coluna = () => {
            const image = studioPixels();
            const x = Math.floor(image.width * 0.12);
            const valores = [];
            for (let y = 0; y < image.height; y += 1) {
              const i = (y * image.width + x) * 4;
              valores.push(
                0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2],
              );
            }
            return valores;
          };
          const maiorSalto = (valores) => {
            let maior = 0;
            let onde = 0;
            for (let i = 1; i < valores.length; i += 1) {
              const salto = Math.abs(valores[i] - valores[i - 1]);
              if (salto > maior) {
                maior = salto;
                onde = i;
              }
            }
            return { maior, onde };
          };

          actions.setPropertyValue(stageId, 'props.horizonHaze', 0.55, false);
          await wait(450);
          const comNevoa = coluna();
          actions.setPropertyValue(stageId, 'props.horizonHaze', 0, false);
          await wait(450);
          const semNevoa = coluna();
          actions.setPropertyValue(stageId, 'props.horizonHaze', 0.55, false);
          await wait(300);

          const com = maiorSalto(comNevoa);
          const sem = maiorSalto(semNevoa);
          return {
            saltoComNevoa: com.maior,
            saltoSemNevoa: sem.maior,
            linhaComNevoa: com.onde,
            altura: comNevoa.length,
            // E a cena não pode ter ficado chapada: sem variação nenhuma não há
            // espaço, só uma parede de uma cor.
            amplitude: Math.max(...comNevoa) - Math.min(...comNevoa),
          };
        })()`,
      );

      record(
        "9 · o horizonte dissolve em vez de terminar numa aresta",
        // Salto pequeno com névoa...
        horizonte.saltoComNevoa < 12 &&
          // ...e menor do que sem ela, senão a névoa não está fazendo o trabalho...
          horizonte.saltoComNevoa < horizonte.saltoSemNevoa &&
          // ...e a imagem continua tendo profundidade em vez de virar uma parede.
          horizonte.amplitude > 20,
        `maior salto entre pixels vizinhos: ${horizonte.saltoComNevoa.toFixed(1)} com névoa ` +
          `(linha ${String(horizonte.linhaComNevoa)} de ${String(horizonte.altura)}), ` +
          `${horizonte.saltoSemNevoa.toFixed(1)} sem; amplitude da coluna ` +
          `${horizonte.amplitude.toFixed(1)}`,
      );

      // ── 10. O alvo acompanha objeto animado durante a pausa ──────────────────
      //
      // O limite que o [ADR-016](../docs/adr/ADR-016-poi-anchored-to-object.md) declarou
      // e não corrigiu: com o dono animado, o alvo da câmera era um par de keyframes
      // parado, então a câmera escorregava do míssil justamente enquanto o narrador
      // falava dele.
      //
      // A medição é em pixel e cobre os dois instantes que importam: **na chegada** e no
      // **meio da pausa**. Antes do acompanhamento só o primeiro centrava — e é por isso
      // que o critério afirma os dois, senão passaria com a versão antiga.
      const acompanha = await client.evaluate(
        `(async () => {
          const stageId = ${JSON.stringify(stageId)};
          const modelId = ${JSON.stringify(modelId)};
          const actions = session().actions;

          /**
           * **Os pontos das etapas anteriores saem de cena.**
           *
           * A primeira versão deste critério não os removia, e passou por acidente: com
           * seis paradas acumuladas, a minha era a última — chegada no frame 450 — e a
           * medição olhava os frames 0, 30 e 60, que são a **primeira** parada, de um
           * objeto parado. Deu 0,00 px nos três e o placar disse verde sem ter testado
           * nada. Falso verde é pior que critério ausente, e a causa era escopo: um
           * critério que mede "a parada" precisa de exatamente uma.
           */
          for (const poi of nodesOfType('studio.poi')) actions.deleteNode(poi.id);
          await wait(250);

          // Palco num enquadramento neutro e objeto de volta ao começo.
          for (const [path, value] of [
            ['props.gridOpacity', 0.55], ['props.floorTexture', 0.35], ['props.vignette', 0.55],
            ['props.elevationDeg', 14], ['props.tourStartFrame', 0],
            ['props.tourTravelFrames', 30], ['props.tourHoldFrames', 60],
          ]) actions.setPropertyValue(stageId, path, value, false);
          for (const [path, value] of [
            ['props.stageX', 0], ['props.scaleMeters', 18], ['props.headingOffset', 0],
          ]) actions.setPropertyValue(modelId, path, value, false);
          await wait(350);

          /**
           * O objeto vai e **volta**: stageX 0 → 40 → 0 entre os frames 0, 30 e 60.
           *
           * O caminho tem de ser curvo, e isto custou uma rodada. A primeira versão movia
           * o objeto em **linha reta** de 0 a 40, e o critério deu desvio 0,00 px nos três
           * frames com zero keyframe de acompanhamento — parecendo defeito e não sendo.
           * Movimento linear é descrito **exatamente** pela reta entre os dois extremos,
           * então a redução corretamente não insere nada e a câmera já acompanha de graça.
           * Só caminho que se afasta da reta exige keyframe no meio. O teste de unidade
           * deste recurso usa uma parábola pelo mesmo motivo, e o comentário lá já dizia
           * isto — eu repeti o erro aqui de todo modo.
           *
           * \`writeStudioTour\` é usada fora do roteiro de propósito: o que ela faz é um
           * \`keyframe.replace-all\` por caminho de prop, para qualquer nó.
           */
          actions.writeStudioTour(modelId, [{
            path: 'props.stageX',
            keyframes: [
              { id: 'mov:0', frame: 0, value: 0, in: { kind: 'linear' }, out: { kind: 'linear' } },
              { id: 'mov:1', frame: 30, value: 40, in: { kind: 'linear' }, out: { kind: 'linear' } },
              { id: 'mov:2', frame: 60, value: 0, in: { kind: 'linear' }, out: { kind: 'linear' } },
            ],
          }]);
          await wait(300);

          // Um ponto novo na superfície, ancorado no objeto — por clique, como sempre.
          if (studioTool('Marcar pontos').getAttribute('aria-pressed') !== 'true') {
            studioTool('Marcar pontos').click();
            await wait(200);
          }
          await atFrame(0);
          const canvas = studioCanvas().getBoundingClientRect();
          let alvo = null;
          for (let y = Math.round(canvas.height * 0.2); y < canvas.height * 0.85 && alvo === null; y += 16) {
            for (let x = Math.round(canvas.width * 0.2); x < canvas.width * 0.8; x += 16) {
              if (window.__theatrumStudio.pick(x, y) !== null) { alvo = [x, y]; break; }
            }
          }
          if (alvo === null) throw new Error('nenhum pixel de geometria para o critério 10');
          // Leitura de volta: sem ela, uma falha adiante não distingue "o objeto não
          // animou" de "o alvo não acompanhou", e as duas causas ficam misturadas.
          const modelo = composition().nodes[modelId];
          return {
            canvas: [canvas.left, canvas.top],
            alvo,
            keyframesDoModelo: modelo.props.stageX.keyframes.length,
            stageXBase: modelo.props.stageX.value,
          };
        })()`,
      );

      const seguirX = Math.round(acompanha.canvas[0] + acompanha.alvo[0]);
      const seguirY = Math.round(acompanha.canvas[1] + acompanha.alvo[1]);
      await client.request("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: seguirX,
        y: seguirY,
      });
      for (const type of ["mousePressed", "mouseReleased"]) {
        await client.request("Input.dispatchMouseEvent", {
          type,
          x: seguirX,
          y: seguirY,
          button: "left",
          clickCount: 1,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 350));

      const seguimento = await client.evaluate(
        `(async () => {
          await wait(200);
          const confirmOriginal = window.confirm;
          window.confirm = () => true;
          try {
            studioTool('Compilar roteiro').click();
          } finally {
            window.confirm = confirmOriginal;
          }
          await wait(400);

          const palco = composition().nodes[${JSON.stringify(stageId)}];
          const alvoX = palco.props.targetX.keyframes;
          const pontos = nodesOfType('studio.poi');

          // A que distância do centro da tela o ponto projeta, num frame dado.
          const desvio = async (frame) => {
            await atFrame(frame);
            const canvas = studioCanvas().getBoundingClientRect();
            const resolvidos = window.__theatrumStudio.pois();
            const ponto = resolvidos.find((poi) => poi.ownerId !== '');
            if (ponto === undefined) return null;
            const tela = window.__theatrumStudio.project(ponto.point);
            return tela === null
              ? null
              : Math.hypot(tela[0] - canvas.width / 2, tela[1] - canvas.height / 2);
          };

          // O ponto de fato se move no palco entre a chegada e o meio da pausa? Sem isto,
          // "centrado nos três frames" também descreve um objeto parado.
          await atFrame(0);
          const em0 = window.__theatrumStudio.pois()[0]?.point ?? null;
          await atFrame(30);
          const em30 = window.__theatrumStudio.pois()[0]?.point ?? null;
          const andou =
            em0 === null || em30 === null
              ? null
              : Math.hypot(em30[0] - em0[0], em30[1] - em0[1], em30[2] - em0[2]);

          return {
            // Com uma parada só, a pausa é [0, 60] e não há ambiguidade de janela.
            pontos: pontos.length,
            andou,
            keyframesDeAlvo: alvoX.length,
            framesDeAlvo: alvoX.map((k) => k.frame),
            // Os keyframes ESTRITAMENTE dentro da pausa: é isto que prova o
            // acompanhamento, e não a contagem total, que cresce com o número de paradas.
            dentroDaPausa: alvoX.filter((k) => k.frame > 0 && k.frame < 60).length,
            naChegada: await desvio(0),
            noMeio: await desvio(30),
            noFim: await desvio(60),
          };
        })()`,
      );

      record(
        "10 · o alvo acompanha objeto animado durante a pausa",
        // Uma parada só, para a janela da pausa não ser ambígua...
        seguimento.pontos === 1 &&
          // ...o objeto de fato se mexendo, senão o resto não prova nada...
          (seguimento.andou ?? 0) > 5 &&
          // ...com keyframe DENTRO da pausa: é isto que é o acompanhamento...
          seguimento.dentroDaPausa > 0 &&
          // ...e o ponto centrado nos três instantes, não só na chegada.
          seguimento.naChegada !== null &&
          seguimento.noMeio !== null &&
          seguimento.noFim !== null &&
          seguimento.naChegada < 6 &&
          seguimento.noMeio < 6 &&
          seguimento.noFim < 6,
        `${String(seguimento.pontos)} parada; ${String(acompanha.keyframesDoModelo)} keyframes ` +
          `no stageX do modelo; o ponto andou ${seguimento.andou?.toFixed(2) ?? "—"} m ` +
          `entre a chegada e o meio; ${String(seguimento.keyframesDeAlvo)} keyframes ` +
          `de alvo em ${JSON.stringify(seguimento.framesDeAlvo)}, ` +
          `${String(seguimento.dentroDaPausa)} dentro da pausa; desvio do centro: ` +
          `${seguimento.naChegada?.toFixed(2) ?? "—"} px na chegada, ` +
          `${seguimento.noMeio?.toFixed(2) ?? "—"} px no meio da pausa, ` +
          `${seguimento.noFim?.toFixed(2) ?? "—"} px na partida`,
      );

      // ── 11. Anotação aponta para o PONTO, e revela em fases ──────────────────
      //
      // O pedido do dono: _"marcar o míssil do avião e uma animação de textbox aparecer
      // uma bolinha uma linha até o text box se afastando do avião e o texto aparecendo"_.
      //
      // Duas afirmações, e a primeira é a que estava bloqueada: a guia do rótulo tem de
      // apontar para o **ponto**, não para a âncora do objeto inteiro. Antes só `model3d`
      // entrava no layout do palco, então era impossível anotar a peça. A segunda é a
      // revelação: a tinta do overlay tem de **crescer** ao longo das fases, em vez de
      // aparecer inteira no primeiro frame.
      const anotacao = await client.evaluate(
        `(async () => {
          const pontos = nodesOfType('studio.poi');
          const poi = pontos[0];
          if (poi === undefined) throw new Error('nenhum ponto para anotar no critério 11');
          session().actions.selectNode(session().getSnapshot().selectedCompositionId, poi.id);
          await atFrame(0);
          await wait(200);

          const botao = studioTool('Anotar ponto');
          if (botao === null) throw new Error('botão "Anotar ponto" ausente na barra do palco');
          botao.click();
          await wait(350);

          const rotulos = nodesOfType('label.callout');
          const rotulo = rotulos[rotulos.length - 1];
          if (rotulo === undefined) throw new Error('a anotação não foi criada');

          // Tinta do overlay Pixi do palco, que é onde o rótulo desenha.
          const tinta = () => {
            const canvas = document.querySelector('.studio-viewport__pixi');
            const ctx = canvas.getContext('webgl2') ?? null;
            // Canvas WebGL: passa por um 2D intermediário, como o studioPixels().
            const scratch = document.createElement('canvas');
            scratch.width = canvas.width;
            scratch.height = canvas.height;
            const c2d = scratch.getContext('2d', { willReadFrequently: true });
            c2d.drawImage(canvas, 0, 0);
            const image = c2d.getImageData(0, 0, scratch.width, scratch.height);
            return image;
          };
          const pixelsComTinta = (image) => {
            let pintados = 0;
            for (let i = 3; i < image.data.length; i += 4) {
              if (image.data[i] > 8) pintados += 1;
            }
            return pintados;
          };

          // Três amostras ao longo da revelação: começo, meio e fim.
          await atFrame(0);
          const imagemNoComeco = tinta();
          await atFrame(12);
          const imagemNoMeio = tinta();
          await atFrame(60);
          const imagemNoFim = tinta();

          return {
            alvoDoRotulo: rotulo.props.targetId.value,
            idDoPonto: poi.id,
            keyframesDaRevelacao: [
              'dotRadius', 'offsetX', 'offsetY', 'textReveal', 'leaderProgress',
            ].map((key) => rotulo.props[key].keyframes.length),
            noComeco: pixelsComTinta(imagemNoComeco),
            noMeio: pixelsComTinta(imagemNoMeio),
            noFim: pixelsComTinta(imagemNoFim),
            // Contagem de tinta oscila alguns pixels quando o balão cruza
            // coordenadas subpixel. A diferença espacial prova que a segunda fase
            // continuou animando sem exigir uma monotonicidade que o rasterizador
            // não promete.
            mudancaMeioFim: differingPixels(imagemNoMeio, imagemNoFim, 4),
            area: imagemNoFim.width * imagemNoFim.height,
          };
        })()`,
      );

      record(
        "11 · anotação aponta para o ponto e revela em fases",
        // A guia mira o PONTO, que é o que estava impossível antes...
        anotacao.alvoDoRotulo === anotacao.idDoPonto &&
          // ...as cinco props da revelação têm par de keyframes...
          anotacao.keyframesDaRevelacao.every((count) => count === 2) &&
          // ...a primeira fase cria tinta e a segunda ainda muda a imagem. A
          // contagem final pode oscilar por rasterização subpixel quando o balão
          // termina de deslizar; exigir `fim > meio` seria medir o rasterizador,
          // não a revelação.
          anotacao.noMeio > anotacao.noComeco &&
          anotacao.noFim > anotacao.noComeco &&
          anotacao.mudancaMeioFim > Math.max(40, anotacao.area * 0.00002),
        `alvo do rótulo ${anotacao.alvoDoRotulo === anotacao.idDoPonto ? "é o ponto" : "NÃO é o ponto"}; ` +
          `keyframes por prop ${anotacao.keyframesDaRevelacao.join("/")}; ` +
          `tinta do overlay ${String(anotacao.noComeco)} → ${String(anotacao.noMeio)} → ` +
          `${String(anotacao.noFim)} px, mudança meio/fim ${String(
            anotacao.mudancaMeioFim,
          )} px ao longo da revelação`,
      );

      // ── 12. A sombra cai para o lado da luz, e segue a luz ───────────────────
      //
      // O pedido do dono: _"quero uma melhora gráfica na renderização desse modo palco,
      // quero efeitos de luz e sombra e reflexos melhorados"_.
      //
      // A sombra era calculada com a luz assumida **vertical**: uma mancha simétrica
      // embaixo do objeto. Agora ela é projetada da direção da luz, então tem de sair
      // **deslocada** da pegada — e girar a luz 180° tem de jogar a sombra para o lado
      // oposto. Medido pelo centroide da tinta escura do piso, com a câmera de cima para
      // a assimetria ser legível.
      const sombra = await client.evaluate(
        `(async () => {
          const stageId = ${JSON.stringify(stageId)};
          const actions = session().actions;
          // Câmera de cima, olhando o objeto: é o enquadramento em que "para que lado a
          // sombra vai" é uma pergunta sobre pixels.
          for (const [path, value] of [
            ['props.targetX', 0], ['props.targetY', 0], ['props.targetZ', 0],
            ['props.distanceMeters', 46], ['props.azimuthDeg', 0], ['props.elevationDeg', 62],
            ['props.gridOpacity', 0], ['props.floorTexture', 0], ['props.vignette', 0],
            ['props.horizonHaze', 0], ['props.shadowStrength', 1],
            ['props.keyElevationDeg', 22],
          ]) actions.setPropertyValue(stageId, path, value, false);
          for (const [path, value] of [['props.stageX', 0], ['props.altitudeMeters', 0]]) {
            actions.setPropertyValue(${JSON.stringify(modelId)}, path, value, false);
          }
          await wait(500);

          /**
           * Centroide dos pixels mais escuros da metade inferior do piso.
           *
           * Só a sombra escurece o chão nesta configuração — grade, textura e vinheta estão
           * desligadas. O objeto em si é claro e fica no centro; a sombra é o que sobra de
           * escuro em volta.
           */
          const centroide = () => {
            const image = studioPixels();
            let somaX = 0;
            let somaY = 0;
            let contagem = 0;
            // Limiar relativo: a média do quadro serve de referência e sobrevive a
            // mudança de cor do piso.
            let total = 0;
            for (let i = 0; i < image.data.length; i += 4) total += image.data[i];
            const media = total / (image.data.length / 4);
            for (let y = 0; y < image.height; y += 2) {
              for (let x = 0; x < image.width; x += 2) {
                const i = (y * image.width + x) * 4;
                if (image.data[i] < media * 0.55) {
                  somaX += x;
                  somaY += y;
                  contagem += 1;
                }
              }
            }
            return contagem === 0 ? null : { x: somaX / contagem, y: somaY / contagem, contagem };
          };

          actions.setPropertyValue(stageId, 'props.keyAzimuthDeg', 90, false);
          await wait(500);
          const leste = centroide();
          actions.setPropertyValue(stageId, 'props.keyAzimuthDeg', 270, false);
          await wait(500);
          const oeste = centroide();
          const canvas = studioCanvas().getBoundingClientRect();
          return { leste, oeste, largura: canvas.width };
        })()`,
      );

      const desviouLados =
        sombra.leste !== null &&
        sombra.oeste !== null &&
        // Girar a luz meia volta joga a sombra para o outro lado: o centroide troca de
        // lado em x, e por uma distância que não é ruído.
        Math.abs(sombra.leste.x - sombra.oeste.x) > 20;
      record(
        "12 · a sombra cai para o lado da luz e acompanha a luz",
        desviouLados && (sombra.leste?.contagem ?? 0) > 200 && (sombra.oeste?.contagem ?? 0) > 200,
        `centroide da sombra em x: ${sombra.leste?.x.toFixed(0) ?? "—"} com a luz a leste, ` +
          `${sombra.oeste?.x.toFixed(0) ?? "—"} a oeste ` +
          `(deslocamento ${
            sombra.leste !== null && sombra.oeste !== null
              ? Math.abs(sombra.leste.x - sombra.oeste.x).toFixed(0)
              : "—"
          } px de ${String(Math.round(sombra.largura))}); ` +
          `pixels escuros ${String(sombra.leste?.contagem ?? 0)}/${String(sombra.oeste?.contagem ?? 0)}`,
      );

      // ── 13. Reflexo planar espelha o modelo e acompanha a altura ────────────
      //
      // Um brilho no piso também muda pixels quando reflectionStrength sai de 0 para
      // 1. Uma sombra falsa também pode copiar aproximadamente a silhueta. A prova que
      // separa essas três coisas é geométrica: sem modelo, ligar o efeito não pinta nada;
      // com o modelo, a tinta nova nasce abaixo do contato com o piso; e, quando o
      // objeto sobe, a imagem direta sobe enquanto a refletida desce. Sombra, grade,
      // textura, vinheta e névoa ficam zeradas para não poderem explicar a diferença.
      const reflexo = await client.evaluate(
        `(async () => {
          const stageId = ${JSON.stringify(stageId)};
          const modelId = ${JSON.stringify(modelId)};
          const actions = session().actions;
          actions.pause();
          actions.clearSelection();

          // Estado de painel não pertence ao documento e sobrevive ao undo. Começar
          // explicitamente na câmera do documento e fora da marcação torna o critério
          // independente da rodada anterior e evita os marcadores sobre a medição.
          const cameraDoDocumento = studioTool('Câmera do documento');
          if (cameraDoDocumento !== null) {
            cameraDoDocumento.click();
            await wait(180);
          }
          const marcar = studioTool('Marcar pontos');
          if (marcar !== null && marcar.getAttribute('aria-pressed') === 'true') {
            marcar.click();
            await wait(180);
          }

          const stagePaths = [
            'props.targetX', 'props.targetY', 'props.targetZ',
            'props.distanceMeters', 'props.azimuthDeg', 'props.elevationDeg', 'props.fovDeg',
            'props.background', 'props.floor',
            'props.gridOpacity', 'props.floorTexture', 'props.shadowStrength',
            'props.reflectionStrength', 'props.vignette', 'props.horizonHaze',
            'props.keyIntensity', 'props.rimIntensity', 'props.environmentIntensity',
            'props.keyAzimuthDeg', 'props.keyElevationDeg',
          ];
          const modelPaths = [
            'props.stageX', 'props.stageZ', 'props.altitudeMeters',
            'props.scaleMeters', 'props.headingOffset',
            'transform.rotation', 'transform.opacity',
          ];
          // O roteiro dos critérios 5/10 e qualquer documento de entrada podem deixar
          // trilhas nestas props. property.set não vence uma trilha avaliada no frame,
          // portanto elas saem antes de fixar a cena A/B.
          const stageTracksCleared = actions.writeKeyframeTracks(
            stageId,
            stagePaths.map((path) => ({ path, keyframes: [] })),
          );
          const modelTracksCleared = actions.writeKeyframeTracks(
            modelId,
            modelPaths.map((path) => ({ path, keyframes: [] })),
          );
          if (!stageTracksCleared || !modelTracksCleared) {
            throw new Error('não foi possível limpar as trilhas do critério de reflexo');
          }

          for (const [path, value] of [
            ['props.targetX', 0], ['props.targetY', 4], ['props.targetZ', 0],
            ['props.distanceMeters', 50], ['props.azimuthDeg', 0],
            ['props.elevationDeg', 14], ['props.fovDeg', 38],
            ['props.background', '#05070aff'], ['props.floor', '#080b10ff'],
            ['props.gridOpacity', 0], ['props.floorTexture', 0],
            ['props.shadowStrength', 0], ['props.reflectionStrength', 0],
            ['props.vignette', 0], ['props.horizonHaze', 0],
            ['props.keyIntensity', 2.6], ['props.rimIntensity', 1.8],
            ['props.environmentIntensity', 0.75],
            ['props.keyAzimuthDeg', 0], ['props.keyElevationDeg', 90],
          ]) {
            if (!actions.setPropertyValue(stageId, path, value, false)) {
              throw new Error('palco recusou ' + path + ' no critério de reflexo');
            }
          }
          for (const [path, value] of [
            ['props.stageX', 0], ['props.stageZ', 0], ['props.altitudeMeters', 2],
            ['props.scaleMeters', 18], ['props.headingOffset', 0],
            ['transform.rotation', 0], ['transform.opacity', 0],
          ]) {
            if (!actions.setPropertyValue(modelId, path, value, false)) {
              throw new Error('modelo recusou ' + path + ' no critério de reflexo');
            }
          }

          const capture = async () => {
            await atFrame(0);
            // O target planar é outro passe WebGL. O silêncio do palco mais esta
            // margem cobre a atualização de estado do React que pediu o passe.
            await wait(180);
            return studioPixels();
          };
          const reflectionPasses = () => studio().reflection?.renders ?? null;
          const setLighting = (key, rim, environment) => {
            const writes = [
              ['props.keyIntensity', key],
              ['props.rimIntensity', rim],
              ['props.environmentIntensity', environment],
            ];
            for (const [path, value] of writes) {
              if (!actions.setPropertyValue(stageId, path, value, false)) {
                throw new Error('palco recusou ' + path + ' no A/B de iluminação');
              }
            }
          };

          /**
           * Diferença ponderada pela maior mudança RGB.
           *
           * count diz a área; energy torna o centroide resistente à antialiasing.
           * As frações acima/abaixo do contato impedem um brilho de tela inteira de
           * passar como reflexo.
           */
          const diffStats = (before, after, splitY, tolerance = 8) => {
            if (
              before.width !== after.width ||
              before.height !== after.height ||
              before.data.length !== after.data.length
            ) return null;
            let count = 0;
            let energy = 0;
            let sumX = 0;
            let sumY = 0;
            let aboveEnergy = 0;
            let belowEnergy = 0;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let y = 0; y < before.height; y += 1) {
              for (let x = 0; x < before.width; x += 1) {
                const i = (y * before.width + x) * 4;
                const delta = Math.max(
                  Math.abs(before.data[i] - after.data[i]),
                  Math.abs(before.data[i + 1] - after.data[i + 1]),
                  Math.abs(before.data[i + 2] - after.data[i + 2]),
                );
                if (delta <= tolerance) continue;
                count += 1;
                energy += delta;
                sumX += x * delta;
                sumY += y * delta;
                if (y < splitY) aboveEnergy += delta;
                else belowEnergy += delta;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
              }
            }
            if (count === 0 || energy === 0) {
              return {
                count: 0,
                energy: 0,
                centroid: null,
                aboveFraction: 0,
                belowFraction: 0,
                box: null,
              };
            }
            return {
              count,
              energy,
              centroid: { x: sumX / energy, y: sumY / energy },
              aboveFraction: aboveEnergy / energy,
              belowFraction: belowEnergy / energy,
              box: {
                x: minX,
                y: minY,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
              },
            };
          };

          // H0/H1: nenhum modelo visível. Um passe/target existir não basta; sem
          // assunto ele não pode deixar tinta residual no piso.
          const passesBefore = reflectionPasses();
          const h0 = await capture();
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 1, false);
          const h1 = await capture();

          const canvas = studioCanvas().getBoundingClientRect();
          const contatoCss = window.__theatrumStudio.project([0, 0, 0]);
          const contato =
            contatoCss === null
              ? null
              : {
                  x: contatoCss[0] * (h0.width / canvas.width),
                  y: contatoCss[1] * (h0.height / canvas.height),
                };
          const splitY = contato?.y ?? h0.height / 2;

          // Dlow/Rlow: imagem direta com o reflexo desligado e o mesmo frame com
          // ele ligado. A diferença entre as duas é exclusivamente o reflexo.
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 0, false);
          actions.setPropertyValue(modelId, 'transform.opacity', 1, false);
          const dLow = await capture();
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 1, false);
          const rLowA = await capture();
          const passesAfterSeed = reflectionPasses();

          // O target agora contém o modelo iluminado. Ocultá-lo e fazer outro OFF/ON
          // prova que a textura antiga não vaza quando deixa de haver assunto.
          actions.setPropertyValue(modelId, 'transform.opacity', 0, false);
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 0, false);
          const hiddenAfterSeedOff = await capture();
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 1, false);
          const hiddenAfterSeedOn = await capture();
          const passesAfterHidden = reflectionPasses();

          // OFF -> ON de verdade entre as leituras iguais. Se o target acumular o
          // quadro anterior ou depender da ordem de passes, a segunda imagem denuncia.
          actions.setPropertyValue(modelId, 'transform.opacity', 1, false);
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 0, false);
          const dLowB = await capture();
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 1, false);
          const rLowB = await capture();

          // A cor refletida tem de vir do material iluminado, não de uma máscara ou
          // elipse genérica. Com key, rim e environment zerados ainda há a luz ambiente
          // mínima do palco, mas a energia isolada do reflexo deve cair fortemente.
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 0, false);
          setLighting(0, 0, 0);
          const dDark = await capture();
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 1, false);
          const rDark = await capture();

          // Dhigh/Rhigh: ao subir o objeto, a silhueta direta vai para cima e a
          // silhueta no espelho se afasta do piso no sentido oposto.
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 0, false);
          setLighting(2.6, 1.8, 0.75);
          actions.setPropertyValue(modelId, 'props.altitudeMeters', 7, false);
          const dHigh = await capture();
          actions.setPropertyValue(stageId, 'props.reflectionStrength', 1, false);
          const rHigh = await capture();
          const passesAfter = reflectionPasses();

          const directLow = diffStats(h0, dLow, splitY);
          const reflectionLow = diffStats(dLow, rLowA, splitY);
          const directDark = diffStats(h0, dDark, splitY);
          const reflectionDark = diffStats(dDark, rDark, splitY);
          const directHigh = diffStats(h0, dHigh, splitY);
          const reflectionHigh = diffStats(dHigh, rHigh, splitY);

          // O status do target ajuda a diagnosticar alocação/passe, mas não participa
          // do verde: a prova é o efeito final em pixel.
          const targetDiagnostic = studio().reflection ?? null;

          return {
            size: [h0.width, h0.height],
            contato,
            hiddenDelta: differingPixels(h0, h1, 8),
            hiddenAfterSeedDelta: differingPixels(hiddenAfterSeedOff, hiddenAfterSeedOn, 8),
            directLow,
            reflectionLow,
            directDark,
            reflectionDark,
            directHigh,
            reflectionHigh,
            repeatedOnDelta: differingPixels(rLowA, rLowB, 0),
            repeatedOffDelta: differingPixels(dLow, dLowB, 0),
            reflectionPasses: {
              before: passesBefore,
              afterSeed: passesAfterSeed,
              afterHidden: passesAfterHidden,
              after: passesAfter,
            },
            targetDiagnostic,
            cameraAuthoring: window.__theatrumStudio.camera()?.authoring ?? false,
            marking: studioTool('Marcar pontos')?.getAttribute('aria-pressed') === 'true',
          };
        })()`,
      );

      const [reflexoWidth, reflexoHeight] = reflexo.size;
      const reflexoArea = reflexoWidth * reflexoHeight;
      const minDirectPixels = Math.max(300, reflexoArea * 0.001);
      const minReflectionPixels = Math.max(
        150,
        (reflexo.directLow?.count ?? 0) * 0.04,
        reflexoArea * 0.00025,
      );
      const hiddenLimit = Math.max(20, reflexoArea * 0.0002);
      const statsCompletas = Boolean(
        reflexo.contato &&
        reflexo.directLow?.centroid &&
        reflexo.reflectionLow?.centroid &&
        reflexo.directHigh?.centroid &&
        reflexo.reflectionHigh?.centroid,
      );
      const diretoVisivel =
        (reflexo.directLow?.count ?? 0) > minDirectPixels &&
        (reflexo.directHigh?.count ?? 0) > minDirectPixels * 0.5;
      const reflexoVisivel =
        (reflexo.reflectionLow?.count ?? 0) > minReflectionPixels &&
        (reflexo.reflectionHigh?.count ?? 0) > minReflectionPixels * 0.5 &&
        (reflexo.reflectionLow?.count ?? reflexoArea) < reflexoArea * 0.25;
      const ladosDoPiso =
        statsCompletas &&
        reflexo.directLow.aboveFraction > 0.7 &&
        reflexo.reflectionLow.belowFraction > 0.7 &&
        reflexo.directLow.centroid.y < reflexo.contato.y - reflexoHeight * 0.008 &&
        reflexo.reflectionLow.centroid.y > reflexo.contato.y + reflexoHeight * 0.008;
      const directShift = statsCompletas
        ? reflexo.directLow.centroid.y - reflexo.directHigh.centroid.y
        : 0;
      const reflectionShift = statsCompletas
        ? reflexo.reflectionHigh.centroid.y - reflexo.reflectionLow.centroid.y
        : 0;
      const shiftRatio = directShift > 0 ? reflectionShift / directShift : 0;
      const movimentoEspelhado =
        directShift > reflexoHeight * 0.012 &&
        reflectionShift > reflexoHeight * 0.008 &&
        shiftRatio > 0.25 &&
        shiftRatio < 3.5;
      const semModeloSemTinta = reflexo.hiddenDelta < hiddenLimit;
      const targetVelhoNaoVazou = reflexo.hiddenAfterSeedDelta < hiddenLimit;
      const litReflectionEnergy = reflexo.reflectionLow?.energy ?? 0;
      const darkReflectionEnergy = reflexo.reflectionDark?.energy ?? Number.POSITIVE_INFINITY;
      const darkEnergyRatio =
        litReflectionEnergy > 0
          ? darkReflectionEnergy / litReflectionEnergy
          : Number.POSITIVE_INFINITY;
      // Fill e ambiente mínimos continuam ligados no rig, portanto zero não é uma
      // expectativa honesta. Exigir queda de ao menos 35% ainda deixa folga para
      // materiais escuros e reprova uma máscara cuja tinta independe da iluminação.
      const materialRespondeALuz = darkEnergyRatio < 0.65;
      const repetivel = reflexo.repeatedOnDelta === 0 && reflexo.repeatedOffDelta === 0;
      const uiNormalizada = !reflexo.cameraAuthoring && !reflexo.marking;
      const centro = (stats) =>
        stats?.centroid === null || stats?.centroid === undefined
          ? "—"
          : `${stats.centroid.x.toFixed(0)},${stats.centroid.y.toFixed(0)}`;

      record(
        "13 · reflexo espelha a geometria abaixo do piso e acompanha a altura",
        statsCompletas &&
          diretoVisivel &&
          reflexoVisivel &&
          ladosDoPiso &&
          movimentoEspelhado &&
          semModeloSemTinta &&
          targetVelhoNaoVazou &&
          materialRespondeALuz &&
          repetivel &&
          uiNormalizada,
        `sem modelo antes/depois de semear deixou ${String(reflexo.hiddenDelta)}/` +
          `${String(reflexo.hiddenAfterSeedDelta)} px (limite ${hiddenLimit.toFixed(0)}); ` +
          `direto baixo/alto ${String(reflexo.directLow?.count ?? 0)}/${String(reflexo.directHigh?.count ?? 0)} px ` +
          `em ${centro(reflexo.directLow)} → ${centro(reflexo.directHigh)}; ` +
          `reflexo baixo/alto ${String(reflexo.reflectionLow?.count ?? 0)}/${String(reflexo.reflectionHigh?.count ?? 0)} px ` +
          `em ${centro(reflexo.reflectionLow)} → ${centro(reflexo.reflectionHigh)}; ` +
          `energia iluminado/escuro ${String(Math.round(litReflectionEnergy))}/` +
          `${String(Math.round(darkReflectionEnergy))} (razão ${darkEnergyRatio.toFixed(2)}); ` +
          `contato y ${reflexo.contato?.y.toFixed(0) ?? "—"}, deslocamentos opostos ` +
          `${directShift.toFixed(1)}/${reflectionShift.toFixed(1)} px (razão ${shiftRatio.toFixed(2)}); ` +
          `ON/OFF repetidos diferem em ${String(reflexo.repeatedOnDelta)}/` +
          `${String(reflexo.repeatedOffDelta)} px; passes ` +
          `${JSON.stringify(reflexo.reflectionPasses)}; target ` +
          `${JSON.stringify(reflexo.targetDiagnostic)}`,
      );

      // ── 13b. Three + submissão CPU cabem no orçamento de 1080p ───────────────
      //
      // Não há cronômetro improvisado aqui. A CPU vem do intervalo que o painel
      // mede de evaluate até terminar Three, marcadores e a submissão do Pixi; a
      // GPU é a do canvas Three, via EXT_disjoint_timer_query_webgl2 assíncrona.
      // Pixi vive em outro contexto e não cabe na mesma query; o nome do critério
      // diz essa fronteira em vez de chamar a medida de "GPU do frame completo".
      //
      // A ordem A-B-B-A separa tendência térmica/clock da diferença do reflexo.
      // Cada bloco aquece shaders e targets antes de abrir uma época nova de
      // medição. Durante a época, cada mudança de playhead espera apenas o contador
      // real de renders avançar — não existe pausa fixa fingindo estabilização.
      const perfil = await client.evaluate(
        `(async () => {
          const stageId = ${JSON.stringify(stageId)};
          const modelId = ${JSON.stringify(modelId)};
          const actions = session().actions;
          const profile = window.__theatrumStudio?.profile;
          const requiredMethods = ['start', 'reset', 'stop', 'status', 'poll'];
          if (
            profile === undefined ||
            requiredMethods.some((method) => typeof profile[method] !== 'function')
          ) {
            return {
              error: 'API window.__theatrumStudio.profile incompleta',
              blocks: [],
              initial: null,
            };
          }

          actions.pause();
          profile.stop();
          profile.reset();
          const initial = profile.status();
          const comp = composition();
          const duration = comp?.duration ?? 0;
          if (duration < 80) {
            return {
              error: 'composição precisa ter ao menos 80 frames únicos',
              duration,
              blocks: [],
              initial,
            };
          }

          // Estado constante entre A e B. Só reflectionStrength varia.
          for (const [path, value] of [
            ['props.gridOpacity', 0],
            ['props.floorTexture', 0],
            ['props.shadowStrength', 0],
            ['props.vignette', 0],
            ['props.horizonHaze', 0],
          ]) {
            if (!actions.setPropertyValue(stageId, path, value, false)) {
              return {
                error: 'palco recusou ' + path + ' no perfil 1080p',
                duration,
                blocks: [],
                initial,
              };
            }
          }
          for (const [path, value] of [
            ['props.altitudeMeters', 2],
            ['transform.opacity', 1],
          ]) {
            if (!actions.setPropertyValue(modelId, path, value, false)) {
              return {
                error: 'modelo recusou ' + path + ' no perfil 1080p',
                duration,
                blocks: [],
                initial,
              };
            }
          }

          const nextRenderedFrame = async (frame) => {
            const before = studio().renders;
            actions.setPlayhead(frame);
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
              const after = studio().renders;
              if (after > before) return { frame, renders: after - before };
              await new Promise((resolve) => requestAnimationFrame(() => resolve()));
            }
            throw new Error(
              'contador do palco não avançou para o frame de perfil ' + String(frame),
            );
          };

          const pollUntilComplete = async () => {
            const deadline = Date.now() + 3000;
            let snapshot = profile.poll();
            while (snapshot.pending > 0 && Date.now() < deadline) {
              await wait(16);
              snapshot = profile.poll();
            }
            return snapshot;
          };

          const order = [false, true, true, false];
          const blocks = [];
          try {
            for (let blockIndex = 0; blockIndex < order.length; blockIndex += 1) {
              const reflectionOn = order[blockIndex];
              if (
                !actions.setPropertyValue(
                  stageId,
                  'props.reflectionStrength',
                  reflectionOn ? 1 : 0,
                  false,
                )
              ) {
                throw new Error(
                  'palco recusou reflectionStrength no bloco ' + String(blockIndex + 1),
                );
              }

              // Doze frames fora da época medida aquecem shader, target e driver.
              // Alternar as pontas garante um render mesmo se a rodada anterior
              // terminou no mesmo playhead.
              const warmupRenders = [];
              for (let warmup = 0; warmup < 12; warmup += 1) {
                warmupRenders.push(
                  await nextRenderedFrame(warmup % 2 === 0 ? duration : 0),
                );
              }

              const firstFrame = blockIndex * 20 + 1;
              const measuredFrames = Array.from(
                { length: 20 },
                (_, offset) => firstFrame + offset,
              );
              profile.start();
              const started = profile.status();
              const measuredRenders = [];
              try {
                for (const frame of measuredFrames) {
                  measuredRenders.push(await nextRenderedFrame(frame));
                }
              } finally {
                profile.stop();
              }
              const finished = await pollUntilComplete();
              blocks.push({
                index: blockIndex + 1,
                label: reflectionOn ? 'ON' : 'OFF',
                reflectionOn,
                warmupFrames: warmupRenders.length,
                measuredFrames,
                measuredRenderDeltas: measuredRenders.map((entry) => entry.renders),
                started,
                finished,
              });
            }
          } catch (error) {
            profile.stop();
            return {
              error: error instanceof Error ? error.message : String(error),
              duration,
              blocks,
              initial,
            };
          }
          profile.stop();
          return { error: null, duration, blocks, initial };
        })()`,
      );

      const validSamples = (samples) =>
        Array.isArray(samples)
          ? samples.filter(
              (sample) => typeof sample === "number" && Number.isFinite(sample) && sample >= 0,
            )
          : [];
      const percentile = (samples, fraction) => {
        if (samples.length === 0) return null;
        const ordered = [...samples].sort((a, b) => a - b);
        const rank = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
        return ordered[Math.min(rank, ordered.length - 1)];
      };
      const summarize = (samples) => ({
        count: samples.length,
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
      });
      const formatMetric = (metric) =>
        `${String(metric.count)} amostras, p50 ${
          metric.p50 === null ? "—" : metric.p50.toFixed(2)
        } ms, p95 ${metric.p95 === null ? "—" : metric.p95.toFixed(2)} ms`;

      const cpuOff = [];
      const cpuOn = [];
      const gpuOff = [];
      const gpuOn = [];
      for (const block of perfil.blocks ?? []) {
        const cpu = validSamples(
          block.finished?.cpuMs?.[block.reflectionOn ? "reflectionOn" : "reflectionOff"],
        );
        const gpu = validSamples(
          block.finished?.gpuMs?.[block.reflectionOn ? "reflectionOn" : "reflectionOff"],
        );
        (block.reflectionOn ? cpuOn : cpuOff).push(...cpu);
        (block.reflectionOn ? gpuOn : gpuOff).push(...gpu);
      }
      const metrics = {
        cpuOff: summarize(cpuOff),
        cpuOn: summarize(cpuOn),
        gpuOff: summarize(gpuOff),
        gpuOn: summarize(gpuOn),
      };
      const blocksCompletos =
        perfil.error === null &&
        perfil.blocks.length === 4 &&
        perfil.blocks.every((block) => {
          const cpu = validSamples(
            block.finished?.cpuMs?.[block.reflectionOn ? "reflectionOn" : "reflectionOff"],
          );
          const gpu = validSamples(
            block.finished?.gpuMs?.[block.reflectionOn ? "reflectionOn" : "reflectionOff"],
          );
          return (
            block.warmupFrames === 12 &&
            block.measuredFrames.length === 20 &&
            new Set(block.measuredFrames).size === 20 &&
            block.finished?.pending === 0 &&
            cpu.length >= 20 &&
            gpu.length >= 20
          );
        });
      const measuredFrames = (perfil.blocks ?? []).flatMap((block) => block.measuredFrames);
      const framesUnicos =
        measuredFrames.length === 80 && new Set(measuredFrames).size === measuredFrames.length;
      const ordemAbba =
        (perfil.blocks ?? []).map((block) => block.label).join("-") === "OFF-ON-ON-OFF";
      const measuredStatuses = (perfil.blocks ?? [])
        .flatMap((block) => [block.started, block.finished])
        .filter(Boolean);
      const statuses = [perfil.initial, ...measuredStatuses].filter(Boolean);
      const gpuDisponivel = statuses.length > 0 && statuses.every((status) => status.supported);
      const semDisjoint = (perfil.blocks ?? []).every((block) => block.finished?.disjoints === 0);
      const canvas1080p =
        measuredStatuses.length === 8 &&
        measuredStatuses.every(
          (status) => status.canvas?.width >= 1920 && status.canvas?.height >= 1080,
        );
      const amostras40 =
        metrics.cpuOff.count >= 40 &&
        metrics.cpuOn.count >= 40 &&
        metrics.gpuOff.count >= 40 &&
        metrics.gpuOn.count >= 40;
      const dentroDoOrcamento =
        metrics.cpuOn.p95 !== null &&
        metrics.gpuOn.p95 !== null &&
        metrics.cpuOn.p95 < 16.6 &&
        metrics.gpuOn.p95 < 16.6;
      const finalStatus = perfil.blocks?.at(-1)?.finished ?? perfil.initial;
      const angle =
        finalStatus?.diagnostics?.angle ??
        finalStatus?.diagnostics?.unmaskedRenderer ??
        finalStatus?.diagnostics?.renderer ??
        "indisponível";
      const canvas = finalStatus?.canvas;
      const blockCounts = (perfil.blocks ?? [])
        .map((block) => {
          const bucket = block.reflectionOn ? "reflectionOn" : "reflectionOff";
          return (
            `${String(block.index)}:${block.label} ` +
            `CPU ${String(validSamples(block.finished?.cpuMs?.[bucket]).length)}/` +
            `GPU ${String(validSamples(block.finished?.gpuMs?.[bucket]).length)}, ` +
            `pending ${String(block.finished?.pending ?? "—")}, ` +
            `disjoint ${String(block.finished?.disjoints ?? "—")}`
          );
        })
        .join(" | ");

      record(
        "13b · canvas Three com reflexo e CPU de submissão cabem em 1080p",
        perfil.error === null &&
          blocksCompletos &&
          framesUnicos &&
          ordemAbba &&
          gpuDisponivel &&
          semDisjoint &&
          canvas1080p &&
          amostras40 &&
          dentroDoOrcamento,
        `${perfil.error === null ? "medição concluída" : `erro: ${perfil.error}`}; ` +
          `canvas físico ${String(canvas?.width ?? 0)}×${String(canvas?.height ?? 0)} ` +
          `${canvas1080p ? "(1080p real ou maior)" : "(MENOR que 1920×1080)"}; ` +
          `GPU Three ${gpuDisponivel ? "timer suportado" : "SEM timer"}, ` +
          `ANGLE/renderer ${angle}; ordem ${String(
            (perfil.blocks ?? []).map((block) => block.label).join("-") || "—",
          )}; blocos ${blockCounts || "nenhum"}; ` +
          `CPU OFF ${formatMetric(metrics.cpuOff)}; CPU ON ${formatMetric(metrics.cpuOn)}; ` +
          `GPU Three OFF ${formatMetric(metrics.gpuOff)}; GPU Three ON ${formatMetric(
            metrics.gpuOn,
          )}; limite p95 ON < 16,60 ms, disjoints ${
            semDisjoint ? "0" : "PRESENTES"
          }; sem extrapolação de resolução`,
      );
    }
  } finally {
    // ── Desfaz tudo e prova que o documento voltou ao início ────────────────
    try {
      const restored = await client.evaluate(
        `(async () => {
        // Estes dois estados pertencem ao painel, não ao Command Bus. Normalizá-los
        // antes do undo é o que permite duas rodadas idênticas do verificador.
        const cameraDoDocumento = studioTool('Câmera do documento');
        if (cameraDoDocumento !== null) cameraDoDocumento.click();
        const marcar = studioTool('Marcar pontos');
        if (marcar !== null && marcar.getAttribute('aria-pressed') === 'true') marcar.click();
        await wait(180);
        const bus = session().commandBus;
        let undone = 0;
        while (bus.history.canUndo() && undone < 400) {
          bus.history.undo();
          undone += 1;
        }
        const limiteAtingido = bus.history.canUndo();
        session().actions.setPlayhead(0);
        session().actions.clearSelection();
        await wait(300);
        return {
          undone,
          limiteAtingido,
          document: JSON.stringify(canonical(session().getSnapshot().document)),
          palcoDesligado: palcoDesligado(),
          studioActive: studio().active,
          cameraAuthoring: window.__theatrumStudio.camera()?.authoring ?? false,
          marking: studioTool('Marcar pontos')?.getAttribute('aria-pressed') === 'true',
        };
        })()`,
      );
      const clean = restored.document === baseline;
      record(
        "0 · desfazer devolve o documento e desliga o palco",
        clean &&
          restored.palcoDesligado &&
          !restored.studioActive &&
          !restored.limiteAtingido &&
          !restored.cameraAuthoring &&
          !restored.marking,
        `${restored.undone} comandos desfeitos, documento ${clean ? "idêntico" : "DIVERGENTE"}, ` +
          `palco ${restored.studioActive ? "AINDA ATIVO" : "desligado"}, ` +
          `UI ${restored.cameraAuthoring || restored.marking ? "AINDA ATIVA" : "neutra"}, ` +
          `histórico ${restored.limiteAtingido ? "AINDA TEM UNDO" : "esgotado"}`,
      );
    } finally {
      try {
        if (metricsOverrideRequested) {
          await client.request("Emulation.clearDeviceMetricsOverride");
        }
      } finally {
        client.close();
      }
    }
  }

  const failures = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failures.length}/${results.length} critérios provados.`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
