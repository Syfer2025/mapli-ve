/**
 * Prova automatizada do bloco 7E.3 (modo estúdio), no Electron real.
 * Requer `pnpm dev` rodando.
 *
 *   node tools/verify-phase7e3.mjs
 *
 * 1. Um `studio.stage` na cena troca o mapa pelo palco: o canvas do estúdio
 *    passa a pintar, o do MapLibre some da imagem, e o chão infinito tem
 *    grade de verdade — medida como variação de luminância ao longo de uma
 *    linha de pixels, não como "o shader compilou".
 * 2. Um `model3d` no palco aparece em pixels sobre o chão, e some quando o
 *    nó é escondido. É a diferença entre o modelo estar carregado e o modelo
 *    estar visível.
 * 3. Azimute animado por keyframes orbita a câmera de verdade: a posição
 *    percorre um arco à distância constante do alvo, e a imagem muda. Só
 *    isso separa uma câmera que gira de um número que muda.
 * 4. Um `label.callout` apontando para o modelo acompanha a projeção 3D
 *    enquanto a câmera orbita — a costura entre o palco e o overlay Pixi.
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

/** Espera o overlay parar de repintar no frame pedido. */
const atFrame = async (frame) => {
  session().actions.setPlayhead(frame);
  const deadline = Date.now() + 8000;
  let quietSince = null;
  let lastRenders = -1;
  while (Date.now() < deadline) {
    const snapshot = overlay();
    if (snapshot.frame === frame) {
      if (snapshot.renders === lastRenders) {
        if (quietSince !== null && Date.now() - quietSince >= 90) return snapshot;
      } else {
        lastRenders = snapshot.renders;
        quietSince = Date.now();
      }
    }
    await wait(24);
  }
  throw new Error('overlay não estabilizou no frame ' + frame);
};

const studioCanvas = () => {
  const canvas = document.querySelector('.scene-overlay__studio');
  if (canvas === null) throw new Error('canvas do palco ausente no DOM');
  return canvas;
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

/** O palco está realmente aparecendo, ou só existe no DOM? */
const studioVisible = () => {
  const canvas = studioCanvas();
  const box = canvas.getBoundingClientRect();
  return getComputedStyle(canvas).visibility === 'visible' && box.width > 1 && box.height > 1;
};

const mapVisible = () => {
  const canvas = document.querySelector('.maplibregl-canvas');
  if (canvas === null) return false;
  return getComputedStyle(canvas).visibility === 'visible';
};

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
const ensureModelAsset = async () => {
  const existing = anyModelAsset();
  if (existing !== null) return { asset: existing, file: '(já estava no cofre)' };
  const index = await fetch('theatrum-data://local/models-index.json').then((r) =>
    r.ok ? r.json() : null,
  );
  if (index === null || !Array.isArray(index.models) || index.models.length === 0) return null;
  const smallest = [...index.models].sort((a, b) => a.bytes - b.bytes)[0];
  const response = await fetch('theatrum-data://local/models/' + encodeURIComponent(smallest.file));
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
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

  // Preenchidos pelos critérios. Sem inicializador: um critério que falhe cedo
  // deixa o id indefinido, e os seguintes se pulam sozinhos em vez de tentar
  // agir sobre um nó que nunca existiu.
  let stageId;
  let modelId;

  try {
    // ── 1. O palco substitui o mapa, com chão de verdade ────────────────────
    {
      const report = await client.evaluate(
        `(async () => {
          const mapBefore = mapVisible();
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
            mapBefore,
            mapAfter: mapVisible(),
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
        report.mapBefore &&
        !report.mapAfter &&
        report.studioShowing &&
        report.active &&
        report.renders > 0 &&
        !report.contextLost &&
        gridOk;
      record(
        "1 · palco substitui o mapa e desenha chão com grade",
        ok,
        `mapa ${report.mapBefore ? "visível" : "oculto"}→${report.mapAfter ? "visível" : "oculto"}, ` +
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
          const samples = [];
          for (const frame of [0, 20, 40]) {
            const snapshot = await atFrame(frame);
            await wait(140);
            const model = snapshot.nodes.find((n) => n.id === ${JSON.stringify(modelId)});
            const callout = snapshot.nodes.find((n) => n.id === id);
            samples.push({
              frame,
              camera: studio().cameraPosition,
              model: model === undefined ? null : model.screenPx,
              callout: callout === undefined ? null : callout.screenPx,
              visible: model === undefined ? null : model.visible,
            });
          }
          return { id, samples };
        })()`,
      );
      const withPositions = report.samples.filter(
        (sample) => Array.isArray(sample.model) && Array.isArray(sample.callout),
      );
      // O rótulo tem de ficar exatamente no afastamento pedido do modelo, em
      // todo frame — é essa igualdade que prova que ele leu a projeção 3D.
      const offsets = withPositions.map((sample) => [
        sample.callout[0] - sample.model[0],
        sample.callout[1] - sample.model[1],
      ]);
      const offsetOk =
        offsets.length === report.samples.length &&
        offsets.every(([dx, dy]) => Math.abs(dx - 140) < 1.5 && Math.abs(dy + 90) < 1.5);
      // E o modelo tem de realmente se mover na tela enquanto a câmera orbita.
      const moved =
        withPositions.length < 2
          ? 0
          : Math.hypot(
              withPositions[withPositions.length - 1].model[0] - withPositions[0].model[0],
              withPositions[withPositions.length - 1].model[1] - withPositions[0].model[1],
            );
      record(
        "4 · rótulo acompanha o modelo pela projeção da câmera orbital",
        offsetOk && moved > 20,
        `${withPositions.length}/${report.samples.length} amostras com posição; ` +
          `modelo em ${withPositions.map((s) => `(${s.model[0].toFixed(0)},${s.model[1].toFixed(0)})`).join("→")}, ` +
          `deslocamento na tela ${Number(moved).toFixed(0)} px, ` +
          `afastamento do rótulo ${offsets.map(([dx, dy]) => `(${dx.toFixed(1)},${dy.toFixed(1)})`).join(" ")}`,
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
          mapBack: mapVisible(),
          studioActive: studio().active,
        };
      })()`,
    );
    const clean = restored.document === baseline;
    record(
      "0 · desfazer devolve o documento e o mapa",
      clean && restored.mapBack && !restored.studioActive,
      `${restored.undone} comandos desfeitos, documento ${clean ? "idêntico" : "DIVERGENTE"}, ` +
        `mapa ${restored.mapBack ? "de volta" : "AINDA OCULTO"}, palco ${restored.studioActive ? "AINDA ATIVO" : "desligado"}`,
    );
    client.close();
  }

  const failures = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failures.length}/${results.length} critérios provados.`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
