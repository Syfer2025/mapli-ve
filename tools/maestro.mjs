/**
 * Ponte local entre o Maestro desta conversa (ChatGPT/Codex) e o editor aberto.
 *
 * Não chama modelo, não usa rede externa e não recebe chave. A comunicação é
 * feita pela porta de depuração que o Electron abre apenas em desenvolvimento.
 *
 * Uso:
 *   node tools/maestro.mjs status
 *   node tools/maestro.mjs context
 *   node tools/maestro.mjs apply-scene examples/alexandre.scene.json
 *   node tools/maestro.mjs apply-commands alteracao.commands.json
 *   node tools/maestro.mjs frame 3600
 *   node tools/maestro.mjs screenshot scratchpad/frame.png
 *   node tools/maestro.mjs export export-options.json
 *   node tools/maestro.mjs export-status
 *   node tools/maestro.mjs export-status-compact
 *   node tools/maestro.mjs undo
 *   node tools/maestro.mjs redo
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { argv, exit, stdin } from "node:process";

const PORT = 9222;
const CONNECT_TIMEOUT_MS = 10_000;
const EVAL_TIMEOUT_MS = 30_000;

async function findPageTarget() {
  const response = await fetch(`http://localhost:${PORT}/json/list`);
  if (!response.ok) throw new Error(`/json/list devolveu ${response.status}`);
  const targets = await response.json();
  const page = targets.find(
    (target) => target.type === "page" && !target.url.startsWith("devtools://"),
  );
  if (page === undefined) throw new Error("nenhuma janela do editor foi encontrada");
  return page;
}

function evaluateInPage(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timeout esperando o editor responder"));
    }, EVAL_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
          },
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();

      if (message.error !== undefined) {
        reject(new Error(`CDP: ${message.error.message}`));
        return;
      }
      const { result, exceptionDetails } = message.result;
      if (exceptionDetails !== undefined) {
        reject(new Error(result?.description ?? exceptionDetails.text ?? "erro no editor"));
        return;
      }
      resolve(result.value);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("não foi possível conectar ao editor"));
    });
  });
}

function capturePage(webSocketUrl) {
  return new Promise((resolveCapture, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timeout capturando a janela do editor"));
    }, EVAL_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 2,
          method: "Page.captureScreenshot",
          params: { format: "png", captureBeyondViewport: false },
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 2) return;
      clearTimeout(timer);
      socket.close();
      if (message.error !== undefined) {
        reject(new Error(`CDP: ${message.error.message}`));
        return;
      }
      resolveCapture(message.result.data);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("não foi possível capturar a janela do editor"));
    });
  });
}

async function waitForEditor() {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  for (;;) {
    try {
      return await findPageTarget();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function readJson(source) {
  const text = source === "-" ? await readStdin() : await readFile(source, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON inválido em ${source}: ${error.message}`, { cause: error });
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function invocation(command, payload) {
  const access =
    "window.__theatrumMaestro ?? (() => { throw new Error('Ponte do Maestro ausente. Reinicie pnpm dev.'); })()";
  if (command === "status") return `(${access}).getSummary()`;
  if (command === "context") return `(${access}).getContext()`;
  if (command === "capabilities") return `(${access}).capabilities()`;
  if (command === "frame") return `(${access}).setFrame(${JSON.stringify(payload)})`;
  if (command === "export") {
    return `(window.__theatrumExport ?? (() => { throw new Error('Controle de export ausente. Abra a aba Fila de render.'); })()).start(${JSON.stringify(payload)})`;
  }
  if (command === "export-status") {
    return `(window.__theatrumExport ?? (() => { throw new Error('Controle de export ausente. Abra a aba Fila de render.'); })()).status()`;
  }
  if (command === "export-status-compact") {
    return `(() => {
      const current = (window.__theatrumExport ?? (() => { throw new Error('Controle de export ausente. Abra a aba Fila de render.'); })()).status();
      const report = current.report;
      return {
        ...current,
        report: report === null ? null : {
          ...report,
          plan: {
            ...report.plan,
            frames: {
              count: report.plan.frames.length,
              first: report.plan.frames[0] ?? null,
              last: report.plan.frames.at(-1) ?? null,
            },
          },
          hashes: {
            count: report.hashes.length,
            first: report.hashes[0] ?? null,
            last: report.hashes.at(-1) ?? null,
          },
        },
      };
    })()`;
  }
  if (command === "export-abort") {
    return `(window.__theatrumExport ?? (() => { throw new Error('Controle de export ausente. Abra a aba Fila de render.'); })()).abort()`;
  }
  if (command === "undo") return `(${access}).undo()`;
  if (command === "redo") return `(${access}).redo()`;
  if (command === "apply-scene") {
    return `(${access}).applyScene(${JSON.stringify(payload)})`;
  }
  if (command === "apply-commands") {
    return `(${access}).applyCommands(${JSON.stringify(payload)})`;
  }
  throw new Error(`comando desconhecido: ${command}`);
}

function usage() {
  return [
    "uso:",
    "  node tools/maestro.mjs status|context|capabilities|undo|redo",
    "  node tools/maestro.mjs frame <número>",
    "  node tools/maestro.mjs screenshot <arquivo.png>",
    "  node tools/maestro.mjs apply-scene <arquivo.json|->",
    "  node tools/maestro.mjs apply-commands <arquivo.json|->",
    "  node tools/maestro.mjs export <opções.json|->",
    "  node tools/maestro.mjs export-status|export-status-compact|export-abort",
  ].join("\n");
}

const [command, source] = argv.slice(2);
if (command === undefined) {
  console.error(usage());
  exit(2);
}

try {
  const needsJson =
    command === "apply-scene" || command === "apply-commands" || command === "export";
  if ((needsJson || command === "frame") && source === undefined) throw new Error(usage());
  const payload = needsJson
    ? await readJson(source)
    : command === "frame"
      ? Number(source)
      : undefined;
  const target = await waitForEditor();
  if (command === "screenshot") {
    const outputPath = resolve(source ?? "scratchpad/maestro-frame.png");
    await mkdir(dirname(outputPath), { recursive: true });
    const data = await capturePage(target.webSocketDebuggerUrl);
    await writeFile(outputPath, Buffer.from(data, "base64"));
    console.log(JSON.stringify({ ok: true, path: outputPath }, null, 2));
    exit(0);
  }
  const result = await evaluateInPage(target.webSocketDebuggerUrl, invocation(command, payload));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`maestro: ${error instanceof Error ? error.message : String(error)}`);
  console.error("O Theatrum precisa estar aberto com `pnpm dev`.");
  exit(1);
}
