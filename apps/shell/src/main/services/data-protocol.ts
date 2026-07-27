/**
 * Protocolo somente-leitura para dados cartográficos locais.
 *
 * PMTiles depende de HTTP Range. Entregar o arquivo por uma ponte IPC copiaria
 * buffers entre processos e acoplaria o renderer ao Electron; um protocolo
 * padrão/seguro deixa Chromium fazer streaming e cache normalmente.
 */

import { app, net, protocol } from "electron";
import { readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DATA_HOST, DATA_SCHEME } from "../../ipc/contracts.js";

const MIME_TYPES: Readonly<Record<string, string>> = {
  // Malha geográfica compilada por tools/build-geo.ts (ADR-010).
  ".bin": "application/octet-stream",
  ".geojson": "application/geo+json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".json": "application/json",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/vnd.pmtiles",
  ".txt": "text/plain; charset=utf-8",
};
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

/**
 * Precisa rodar antes de `app.ready`. Sem `standard` URLs relativas e storage
 * não funcionam; `supportFetchAPI` + `corsEnabled` permitem que os workers do
 * MapLibre façam ranges a partir do renderer de desenvolvimento.
 */
export function registerDataScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DATA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function dataRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "data")
    : path.join(app.getAppPath(), "data");
}

/**
 * Raízes extras, nomeadas, além de `data/`.
 *
 * Existe porque a biblioteca 3D do usuário pode ter gigabytes e viver fora do
 * projeto — copiar para dentro de `data/` duplicaria tudo, e apontar para lá com
 * uma junção é justamente o que o `realpath` abaixo barra, de propósito.
 *
 * A saída não é enfraquecer a contenção: é declarar **quais** pastas o protocolo
 * serve. Cada nome vira um prefixo de URL, e a contenção continua valendo dentro
 * de cada raiz — um caminho com `..` ou uma junção que escape da raiz nomeada
 * continua recusado.
 *
 * O arquivo é local da máquina e não entra no repositório:
 *
 *   data/library-roots.json → { "models": "C:\\caminho\\para\\modelos" }
 */
let extraRootsCache: Readonly<Record<string, string>> | undefined;

function extraRoots(): Readonly<Record<string, string>> {
  if (extraRootsCache !== undefined) return extraRootsCache;
  try {
    const raw = readFileSync(path.join(dataRoot(), "library-roots.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const roots: Record<string, string> = {};
    if (typeof parsed === "object" && parsed !== null) {
      for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        // Nome de raiz é um segmento simples: nada de barra, nada de `..`.
        if (!/^[a-z0-9_-]+$/i.test(name)) continue;
        if (typeof value === "string" && path.isAbsolute(value)) roots[name] = path.resolve(value);
      }
    }
    extraRootsCache = Object.freeze(roots);
  } catch {
    extraRootsCache = Object.freeze({});
  }
  return extraRootsCache;
}

/**
 * Confere que o alvo está mesmo dentro da raiz, lexicalmente e depois de resolver
 * links. As duas checagens são necessárias: a primeira barra `..`, a segunda barra
 * junção e symlink que escapem em silêncio no Windows.
 */
async function containedIn(root: string, target: string): Promise<string | null> {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative === "" || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return null;
    }
    return realTarget;
  } catch {
    return null;
  }
}

async function safeDataPath(url: URL): Promise<string | null> {
  if (
    url.hostname !== DATA_HOST ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
  } catch {
    return null;
  }

  if (!ALLOWED_EXTENSIONS.has(path.extname(decoded).toLowerCase())) return null;

  // Primeiro segmento pode nomear uma raiz extra; senão, tudo cai sob `data/`.
  const separator = decoded.indexOf("/");
  const head = separator < 0 ? decoded : decoded.slice(0, separator);
  const named = extraRoots()[head];
  if (named !== undefined && separator > 0) {
    const rest = decoded.slice(separator + 1);
    return containedIn(named, path.resolve(named, rest));
  }

  const root = path.resolve(dataRoot());
  return containedIn(root, path.resolve(root, decoded));
}

function responseHeaders(source: Headers, target: string): Headers {
  const headers = new Headers(source);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "Range");
  headers.set(
    "access-control-expose-headers",
    "Accept-Ranges, Content-Length, Content-Range, Content-Type",
  );
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set("accept-ranges", "bytes");

  const mime = MIME_TYPES[path.extname(target).toLowerCase()];
  if (mime !== undefined) headers.set("content-type", mime);
  return headers;
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

function parseByteRange(value: string, fileSize: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (match === null) return null;

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText === "" ? fileSize - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= fileSize ||
    requestedEnd < start
  ) {
    return null;
  }

  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

/** Registra o handler depois de `app.ready` e antes de criar a janela. */
export function registerDataProtocol(): void {
  protocol.handle(DATA_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== DATA_HOST) {
      return new Response("origem inválida", { status: 400 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "Range",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("método não permitido", { status: 405 });
    }

    const target = await safeDataPath(requestUrl);
    if (target === null) return new Response("caminho inválido ou ausente", { status: 404 });

    try {
      const file = await stat(target);
      if (!file.isFile()) return new Response("caminho não é arquivo", { status: 404 });

      const rangeHeader = request.headers.get("range");
      let range: ByteRange | undefined;
      if (rangeHeader !== null) {
        const parsedRange = parseByteRange(rangeHeader, file.size);
        if (parsedRange === null) {
          return new Response(null, {
            status: 416,
            headers: {
              "accept-ranges": "bytes",
              "access-control-allow-origin": "*",
              "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range",
              "content-range": `bytes */${file.size}`,
              "content-length": "0",
            },
          });
        }
        range = parsedRange;
      }

      const fileResponse = await net.fetch(pathToFileURL(target).toString(), {
        method: request.method,
        headers: request.headers,
      });
      const headers = responseHeaders(fileResponse.headers, target);
      if (range !== undefined) {
        headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`);
        headers.set("content-length", String(range.end - range.start + 1));
      } else {
        headers.set("content-length", String(file.size));
      }

      return new Response(request.method === "HEAD" ? null : fileResponse.body, {
        status: range === undefined ? fileResponse.status : 206,
        statusText: fileResponse.statusText,
        headers,
      });
    } catch {
      return new Response("arquivo local indisponível", { status: 404 });
    }
  });
}
