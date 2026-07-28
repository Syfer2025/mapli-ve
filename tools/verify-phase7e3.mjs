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

  try {
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
          // Botão HTML comum: aqui click() basta. Foi a ABA do dockview que
          // exigiu evento de ponteiro por coordenada (ADR-014), não isto.
          botao.click();
          await wait(200);
          const canvas = studioCanvas().getBoundingClientRect();
          // Dois pontos do modelo, afastados na tela para não caírem no mesmo
          // marcador — e o clique tem de acertar geometria, então saem da
          // projeção do próprio modelo, não de um palpite de coordenada.
          const pontos = [[6, 0, 0], [6, 1.2, 0]].map((p) => window.__theatrumStudio.project(p));
          return {
            canvas: [canvas.left, canvas.top, canvas.width, canvas.height],
            pontos,
            marcandoAntes: markerInk(),
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
          // Ida e volta: onde cada ponto marcado projeta agora.
          const roundTrip = pois.map((poi, index) => {
            const ponto = [
              poi.props.pointX.value,
              poi.props.pointY.value,
              poi.props.pointZ.value,
            ];
            const tela = window.__theatrumStudio.project(ponto);
            const clique = cliques[index];
            return tela === null || clique === undefined
              ? null
              : Math.hypot(tela[0] - clique[0], tela[1] - clique[1]);
          });
          // O ponto tem de estar na SUPERFÍCIE do modelo, não no chão nem no
          // vazio: o F/A-18 tem 18 m de vão, então nada legítimo cai a mais de
          // 12 m do centro dele.
          const distanciasAoModelo = pois.map((poi) =>
            Math.hypot(
              poi.props.pointX.value - 6,
              poi.props.pointY.value,
              poi.props.pointZ.value,
            ),
          );
          const tintaMarcando = markerInk();
          const marcadores = window.__theatrumStudio.markers();

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
            roundTrip,
            distanciasAoModelo,
            tintaMarcando,
            marcadores: marcadores.length,
            ordinais: marcadores.map((m) => m.ordinal),
            compilou,
            trilhas,
            chegadaSegunda: palco.props.targetX.keyframes.map((k) => k.frame),
            pontoSegunda: pois.length < 2 ? null : [
              pois[1].props.pointX.value,
              pois[1].props.pointY.value,
              pois[1].props.pointZ.value,
            ],
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
          report.tintaMarcando > 200 &&
          report.marcadores === 2 &&
          report.compilou &&
          trilhasOk &&
          centradoOk &&
          apagou === 0,
        `${report.pois} ponto(s) criados por clique, ida e volta ` +
          `${report.roundTrip.map((d) => (d === null ? "—" : d.toFixed(2))).join("/")} px, ` +
          `distância ao modelo ${report.distanciasAoModelo.map((d) => d.toFixed(1)).join("/")} m, ` +
          `marcadores ${report.ordinais.join("/")} com ${report.tintaMarcando} px de tinta ` +
          `(${apagou} depois de desligar), ` +
          `keyframes por trilha ${report.trilhas.join("/")}, ` +
          `ponto centrado a ${centragem === null ? "—" : centragem.toFixed(2)} px do centro`,
      );
    }
  } finally {
    // ── Desfaz tudo e prova que o documento voltou ao início ────────────────
    const restored = await client.evaluate(
      `(async () => {
        const bus = session().commandBus;
        let undone = 0;
        while (bus.history.canUndo() && undone < 200) {
          bus.history.undo();
          undone += 1;
        }
        session().actions.setPlayhead(0);
        session().actions.clearSelection();
        await wait(300);
        return {
          undone,
          document: JSON.stringify(canonical(session().getSnapshot().document)),
          palcoDesligado: palcoDesligado(),
          studioActive: studio().active,
        };
      })()`,
    );
    const clean = restored.document === baseline;
    record(
      "0 · desfazer devolve o documento e desliga o palco",
      clean && restored.palcoDesligado && !restored.studioActive,
      `${restored.undone} comandos desfeitos, documento ${clean ? "idêntico" : "DIVERGENTE"}, ` +
        `palco ${restored.studioActive ? "AINDA ATIVO" : "desligado"}`,
    );
    client.close();
  }

  const failures = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failures.length}/${results.length} critérios provados.`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
