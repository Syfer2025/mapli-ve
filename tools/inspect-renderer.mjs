/**
 * Avalia uma expressão dentro do renderer real do Electron, via CDP.
 *
 * Existe porque inspecionar o app pelo navegador comum não prova nada sobre o
 * que roda no Electron: lá `window.theatrum` é undefined e o fallback em
 * memória entra no lugar da persistência em disco. Layout, IPC e tudo que
 * depende do preload só podem ser verificados aqui.
 *
 * Vai ser usado nas fases seguintes para verificar o mapa, o overlay e os
 * frames de export sem depender de inspeção visual.
 *
 * Uso:
 *   node tools/inspect-renderer.mjs "document.title"
 *   node tools/inspect-renderer.mjs --file consulta.js
 *
 * Requer `pnpm dev` rodando (a porta 9222 só abre em desenvolvimento).
 */

import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

const PORT = 9222;
const CONNECT_TIMEOUT_MS = 10_000;
const EVAL_TIMEOUT_MS = 15_000;

async function findPageTarget() {
  const response = await fetch(`http://localhost:${PORT}/json/list`);
  if (!response.ok) throw new Error(`/json/list devolveu ${response.status}`);

  const targets = await response.json();
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  if (page === undefined) {
    throw new Error(
      `nenhum target de página. Targets: ${targets.map((t) => `${t.type} ${t.url}`).join(" | ")}`,
    );
  }
  return page;
}

function evaluateInPage(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timeout esperando resposta do CDP"));
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
            // A expressão pode vir de fora; `userGesture` evita bloqueios em
            // APIs que exigem interação.
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
        reject(
          new Error(`exceção no renderer: ${exceptionDetails.text} ${result?.description ?? ""}`),
        );
        return;
      }
      resolve(result.value);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`falha ao conectar em ${webSocketUrl}`));
    });
  });
}

async function waitForDebugPort() {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  for (;;) {
    try {
      return await findPageTarget();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

const args = argv.slice(2);
let expression;

if (args[0] === "--file") {
  if (args[1] === undefined) {
    console.error("uso: node tools/inspect-renderer.mjs --file <arquivo.js>");
    exit(2);
  }
  expression = await readFile(args[1], "utf8");
} else if (args.length > 0) {
  expression = args.join(" ");
} else {
  console.error('uso: node tools/inspect-renderer.mjs "<expressão>" | --file <arquivo.js>');
  exit(2);
}

try {
  const target = await waitForDebugPort();
  const value = await evaluateInPage(target.webSocketDebuggerUrl, expression);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
} catch (error) {
  console.error(`inspect-renderer: ${error.message}`);
  console.error("`pnpm dev` está rodando? A porta 9222 só abre em desenvolvimento.");
  exit(1);
}
