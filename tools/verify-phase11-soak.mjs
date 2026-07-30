/**
 * Ensaio sustentado da Fase 11 no renderer Electron real.
 *
 * Requer `pnpm dev` com a porta CDP 9222. Sem argumentos executa o critério
 * formal de quatro horas. `--smoke` roda 60 s para validar o instrumento, mas
 * não é aceito como prova do critério de estabilidade.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 30_000;
const MEBIBYTE = 1024 * 1024;

const argumentsMap = parseArguments(process.argv.slice(2));
const smoke = argumentsMap.has("smoke");
const durationMinutes = smoke ? 1 : numberArgument(argumentsMap, "minutes", 240);
const sampleSeconds = smoke ? 5 : numberArgument(argumentsMap, "sample-seconds", 30);
const warmupMinutes = smoke ? 0 : numberArgument(argumentsMap, "warmup-minutes", 5);
const maxGrowthMb = numberArgument(argumentsMap, "max-growth-mb", 32);
const maxSlopeMbPerHour = numberArgument(argumentsMap, "max-slope-mb-hour", 8);

if (durationMinutes <= 0 || sampleSeconds <= 0 || warmupMinutes < 0) {
  throw new Error("duração, intervalo e aquecimento precisam ser positivos");
}
if (!smoke && durationMinutes < 240) {
  console.warn(
    "AVISO: execução abaixo de 240 minutos valida o instrumento, não o critério formal da Fase 11.",
  );
}

const target = await pageTarget();
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.connect();
await client.request("Runtime.enable");
await client.request("Performance.enable");
await client.request("HeapProfiler.enable");

const original = await client.evaluate(`(() => {
  const session = window.__theatrumPhase3;
  if (session === undefined) throw new Error("sessão do editor indisponível");
  const snapshot = session.getSnapshot();
  session.actions.pause();
  session.actions.setLoop(true);
  session.actions.play();
  return {
    playheadFrame: snapshot.playheadFrame,
    isPlaying: snapshot.isPlaying,
    loopPlayback: snapshot.loopPlayback,
    compositionId: snapshot.selectedCompositionId,
  };
})()`);

const startedAt = Date.now();
const deadline = startedAt + durationMinutes * 60_000;
const warmupDeadline = startedAt + warmupMinutes * 60_000;
const samples = [];

try {
  while (Date.now() <= deadline) {
    await client.request("HeapProfiler.collectGarbage");
    const [usage, performanceMetrics, editor] = await Promise.all([
      client.request("Runtime.getHeapUsage"),
      client.request("Performance.getMetrics"),
      client.evaluate(`(() => {
        const session = window.__theatrumPhase3;
        if (session === undefined) throw new Error("sessão do editor indisponível");
        const snapshot = session.getSnapshot();
        if (!snapshot.isPlaying) session.actions.play();
        const frame = window.__theatrumPhase4?.getSnapshot?.();
        return {
          playheadFrame: snapshot.playheadFrame,
          isPlaying: snapshot.isPlaying,
          renders: frame?.renders ?? null,
          evaluatedFrame: frame?.frame ?? null,
        };
      })()`),
    ]);
    const metrics = Object.fromEntries(
      (performanceMetrics.metrics ?? []).map(({ name, value }) => [name, value]),
    );
    const elapsedMinutes = (Date.now() - startedAt) / 60_000;
    const usedHeapMb = usage.usedSize / MEBIBYTE;
    const embedderHeapMb =
      typeof usage.embedderHeapUsedSize === "number" ? usage.embedderHeapUsedSize / MEBIBYTE : 0;
    const backingStorageMb =
      typeof usage.backingStorageSize === "number" ? usage.backingStorageSize / MEBIBYTE : 0;
    const sample = {
      elapsedMinutes,
      at: new Date().toISOString(),
      usedHeapMb,
      embedderHeapMb,
      backingStorageMb,
      trackedMemoryMb: usedHeapMb + embedderHeapMb + backingStorageMb,
      totalHeapMb: usage.totalSize / MEBIBYTE,
      jsHeapMetricMb:
        typeof metrics.JSHeapUsedSize === "number" ? metrics.JSHeapUsedSize / MEBIBYTE : null,
      nodes: metrics.Nodes ?? null,
      documents: metrics.Documents ?? null,
      frames: metrics.Frames ?? null,
      editor,
    };
    samples.push(sample);
    console.log(
      `${elapsedMinutes.toFixed(1)} min · rastreado ${sample.trackedMemoryMb.toFixed(1)} MiB ` +
        `(V8 ${sample.usedHeapMb.toFixed(1)}, embedder ${sample.embedderHeapMb.toFixed(1)}, backing ${sample.backingStorageMb.toFixed(1)}) ` +
        `· frame ${String(editor.playheadFrame)} · renders ${String(editor.renders)}`,
    );

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await wait(Math.min(sampleSeconds * 1000, remainingMs));
  }

  const measured = samples.filter(
    ({ elapsedMinutes }) => startedAt + elapsedMinutes * 60_000 >= warmupDeadline,
  );
  const analysis = analyzeHeap(measured);
  const activity = analyzeActivity(measured);
  const formal = durationMinutes >= 240 && !smoke;
  const memoryStable =
    analysis.growthMb <= maxGrowthMb && analysis.slopeMbPerHour <= maxSlopeMbPerHour;
  const stable = memoryStable && activity.verified;
  const report = {
    schemaVersion: 1,
    kind: formal ? "formal-4h" : "instrument-smoke",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    requestedMinutes: durationMinutes,
    sampleSeconds,
    warmupMinutes,
    thresholds: { maxGrowthMb, maxSlopeMbPerHour },
    analysis,
    activity,
    coverage: {
      included: ["V8 heap", "embedder heap", "backing storage"],
      excluded: [
        "working set nativo dos processos Electron",
        "alocações da GPU fora do backing storage reportado pelo renderer",
      ],
    },
    memoryStable,
    stable,
    criterionSatisfied: formal && stable,
    original,
    samples,
  };
  const outputDirectory = resolve("artifacts");
  await mkdir(outputDirectory, { recursive: true });
  const reportPath = resolve(
    outputDirectory,
    `phase11-soak-${new Date(startedAt).toISOString().replaceAll(/[:.]/g, "-")}.json`,
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `${stable ? "ESTÁVEL" : "INSTÁVEL"} · crescimento ${analysis.growthMb.toFixed(1)} MiB · inclinação ${analysis.slopeMbPerHour.toFixed(2)} MiB/h`,
  );
  console.log(
    `${activity.verified ? "ATIVIDADE OK" : "SEM ATIVIDADE COMPROVADA"} · ` +
      `${activity.distinctPlayheadFrames} playheads · ${activity.distinctEvaluatedFrames} frames avaliados · ` +
      `delta de renders ${String(activity.renderDelta)}`,
  );
  console.log(
    formal
      ? `Critério formal ${stable ? "atendido" : "falhou"}. Relatório: ${reportPath}`
      : `Instrumento validado; esta duração não substitui as quatro horas. Relatório: ${reportPath}`,
  );
  if (!stable) process.exitCode = 1;
} finally {
  try {
    await client.evaluate(`(() => {
      const session = window.__theatrumPhase3;
      if (session === undefined) return false;
      session.actions.pause();
      session.actions.setLoop(${JSON.stringify(original.loopPlayback)});
      session.actions.setPlayhead(${JSON.stringify(original.playheadFrame)});
      if (${JSON.stringify(original.isPlaying)}) session.actions.play();
      return true;
    })()`);
  } finally {
    client.close();
  }
}

function analyzeHeap(samplesToAnalyze) {
  if (samplesToAnalyze.length < 2) {
    throw new Error("o ensaio precisa de ao menos duas amostras após o aquecimento");
  }
  const windowSize = Math.min(5, Math.max(1, Math.floor(samplesToAnalyze.length / 4)));
  const first = median(
    samplesToAnalyze.slice(0, windowSize).map(({ trackedMemoryMb }) => trackedMemoryMb),
  );
  const last = median(
    samplesToAnalyze.slice(-windowSize).map(({ trackedMemoryMb }) => trackedMemoryMb),
  );
  const meanX =
    samplesToAnalyze.reduce((sum, sample) => sum + sample.elapsedMinutes, 0) /
    samplesToAnalyze.length;
  const meanY =
    samplesToAnalyze.reduce((sum, sample) => sum + sample.trackedMemoryMb, 0) /
    samplesToAnalyze.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samplesToAnalyze) {
    const x = sample.elapsedMinutes - meanX;
    numerator += x * (sample.trackedMemoryMb - meanY);
    denominator += x * x;
  }
  const slopeMbPerMinute = denominator === 0 ? 0 : numerator / denominator;
  return {
    samples: samplesToAnalyze.length,
    firstMedianMb: first,
    lastMedianMb: last,
    growthMb: last - first,
    slopeMbPerHour: slopeMbPerMinute * 60,
    peakMb: Math.max(...samplesToAnalyze.map(({ trackedMemoryMb }) => trackedMemoryMb)),
  };
}

function analyzeActivity(samplesToAnalyze) {
  const playheads = new Set(samplesToAnalyze.map(({ editor }) => editor.playheadFrame));
  const evaluated = new Set(
    samplesToAnalyze
      .map(({ editor }) => editor.evaluatedFrame)
      .filter((value) => typeof value === "number"),
  );
  const renderCounts = samplesToAnalyze
    .map(({ editor }) => editor.renders)
    .filter((value) => typeof value === "number");
  const renderDelta =
    renderCounts.length < 2 ? 0 : Math.max(...renderCounts) - Math.min(...renderCounts);
  const playingSamples = samplesToAnalyze.filter(({ editor }) => editor.isPlaying === true).length;
  const advanced = renderDelta > 0 || playheads.size > 1 || evaluated.size > 1;
  return {
    samples: samplesToAnalyze.length,
    playingSamples,
    distinctPlayheadFrames: playheads.size,
    distinctEvaluatedFrames: evaluated.size,
    renderDelta,
    verified:
      samplesToAnalyze.length >= 2 && playingSamples >= samplesToAnalyze.length - 1 && advanced,
  };
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
    : (ordered[middle] ?? 0);
}

function parseArguments(args) {
  const parsed = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index];
    if (raw === undefined || !raw.startsWith("--")) continue;
    const [name, inline] = raw.slice(2).split("=", 2);
    if (inline !== undefined) {
      parsed.set(name, inline);
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      parsed.set(name, next);
      index += 1;
    } else {
      parsed.set(name, "true");
    }
  }
  return parsed;
}

function numberArgument(args, name, fallback) {
  const raw = args.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} inválido: ${raw}`);
  return value;
}

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

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
