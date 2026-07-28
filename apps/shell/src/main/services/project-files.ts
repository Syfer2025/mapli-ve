/**
 * Adapter de arquivos de projeto do Electron.
 *
 * O renderer recebe um handle opaco depois de um diálogo nativo. Saves
 * subsequentes devolvem esse handle; nunca aceitamos um caminho arbitrário
 * vindo da página. A gravação é temporário + fsync + rename no mesmo diretório.
 */

import { app, dialog, type BrowserWindow } from "electron";
import { APP_NAME, PROJECT_EXTENSION } from "@theatrum/schema";
import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  ProjectExampleInfo,
  ProjectFileReference,
  ProjectOpenResult,
  ProjectSaveRequest,
  ProjectSaveResult,
} from "../../ipc/contracts.js";

const MAX_PROJECT_BYTES = 1024 * 1024 * 1024;

const PROJECT_EXAMPLES: readonly (ProjectExampleInfo & { readonly filename: string })[] =
  Object.freeze([
    {
      id: "hormuz-blockade",
      label: "Hormuz · bloqueio naval",
      filename: "01-hormuz-bloqueio-naval.theatrum",
    },
    {
      id: "hormuz-missile",
      label: "Hormuz · lançamento de míssil",
      filename: "02-hormuz-lancamento-missil.theatrum",
    },
    {
      id: "iran-frontline",
      label: "Irã · linha de frente",
      filename: "03-ira-linha-de-frente.theatrum",
    },
  ]);

const authorizedFiles = new Map<string, string>();

export async function openProjectFile(window: BrowserWindow): Promise<ProjectOpenResult> {
  const selection = await dialog.showOpenDialog(window, {
    title: "Abrir projeto",
    properties: ["openFile"],
    filters: [
      { name: `Projeto ${APP_NAME}`, extensions: [PROJECT_EXTENSION] },
      { name: "Todos os arquivos", extensions: ["*"] },
    ],
  });

  const selectedPath = selection.filePaths[0];
  if (selection.canceled || selectedPath === undefined) return { status: "cancelled" };

  const bytes = await readFile(selectedPath);
  if (bytes.byteLength > MAX_PROJECT_BYTES) {
    throw new RangeError("O projeto excede o limite de 1 GiB para abertura interativa.");
  }

  return {
    status: "opened",
    file: authorize(selectedPath),
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  };
}

export function listProjectExamples(): readonly ProjectExampleInfo[] {
  return PROJECT_EXAMPLES.map(({ id, label }) => ({ id, label }));
}

/** Abre somente um arquivo do catálogo fixo; o id nunca vira caminho. */
export async function openProjectExample(id: string): Promise<ProjectOpenResult> {
  const example = PROJECT_EXAMPLES.find((candidate) => candidate.id === id);
  if (example === undefined) throw new RangeError(`Exemplo desconhecido: "${id}".`);
  const filePath = path.join(exampleRoot(), example.filename);
  const bytes = await readFile(filePath);
  if (bytes.byteLength > MAX_PROJECT_BYTES) {
    throw new RangeError("O projeto de exemplo excede o limite de 1 GiB.");
  }
  // Não autorizar o handle para escrita: Salvar abre "Salvar como" e nunca
  // tenta sobrescrever os arquivos que vieram com o aplicativo.
  const file = { handle: `example:${randomUUID()}`, name: example.filename, path: filePath };
  return {
    status: "opened",
    file,
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  };
}

function exampleRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "examples")
    : path.join(app.getAppPath(), "examples");
}

export async function saveProjectFile(
  window: BrowserWindow,
  request: ProjectSaveRequest,
): Promise<ProjectSaveResult> {
  const existingHandle = request.file?.handle;
  const existingPath =
    existingHandle === undefined ? undefined : authorizedFiles.get(existingHandle);
  if (existingPath === undefined) return saveProjectFileAs(window, request);

  await writeAtomic(existingPath, copyBytes(request.bytes));
  return { status: "saved", file: authorize(existingPath, existingHandle) };
}

export async function saveProjectFileAs(
  window: BrowserWindow,
  request: ProjectSaveRequest,
): Promise<ProjectSaveResult> {
  const selection = await dialog.showSaveDialog(window, {
    title: "Salvar projeto como",
    defaultPath: ensureProjectExtension(sanitizeSuggestedName(request.suggestedName)),
    filters: [{ name: `Projeto ${APP_NAME}`, extensions: [PROJECT_EXTENSION] }],
  });

  if (selection.canceled || selection.filePath === undefined) return { status: "cancelled" };
  const selectedPath = ensureProjectExtension(selection.filePath);
  await writeAtomic(selectedPath, copyBytes(request.bytes));
  return { status: "saved", file: authorize(selectedPath) };
}

function authorize(filePath: string, existingHandle?: string): ProjectFileReference {
  const handle = existingHandle ?? randomUUID();
  authorizedFiles.set(handle, filePath);
  return { handle, name: path.basename(filePath), path: filePath };
}

function copyBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("Conteúdo de projeto inválido: eram esperados bytes.");
  }
  if (value.byteLength > MAX_PROJECT_BYTES) {
    throw new RangeError("O projeto excede o limite de 1 GiB para salvamento interativo.");
  }
  return Uint8Array.from(value);
}

function sanitizeSuggestedName(value: string): string {
  const withoutExtension = value.replace(new RegExp(`\\.${PROJECT_EXTENSION}$`, "i"), "");
  const forbidden = '<>:"/\\|?*';
  const safe = [...withoutExtension]
    .map((character) =>
      character.charCodeAt(0) < 32 || forbidden.includes(character) ? "-" : character,
    )
    .join("")
    .trim();
  return safe.length > 0 ? safe : "Projeto sem título";
}

function ensureProjectExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)
    ? filePath
    : `${filePath}.${PROJECT_EXTENSION}`;
}

async function writeAtomic(target: string, bytes: Uint8Array): Promise<void> {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(temporary, "wx");
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    file = null;
    await rename(temporary, target);
  } catch (error: unknown) {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
