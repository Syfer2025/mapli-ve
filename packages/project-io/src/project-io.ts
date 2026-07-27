import { err, ok, type Result } from "@theatrum/core-utils";

import {
  parseProjectContainer,
  serializeProjectContainer,
  type OpenedProject,
  type ProjectContainerInput,
} from "./container.js";
import { describeCause, projectError, type ProjectError } from "./errors.js";
import { readFile, writeAtomic, type ProjectFileSystemPort } from "./filesystem.js";

export interface SaveProjectArgs extends ProjectContainerInput {
  readonly path: string;
}

export async function saveProjectAtomic(
  fileSystem: ProjectFileSystemPort,
  args: SaveProjectArgs,
): Promise<Result<void, ProjectError>> {
  const encoded = serializeProjectContainer(args);
  if (!encoded.ok) return encoded;
  return writeAtomic(fileSystem, args.path, encoded.value);
}

export async function openProject(
  fileSystem: ProjectFileSystemPort,
  path: string,
): Promise<Result<OpenedProject, ProjectError>> {
  const bytes = await readFile(fileSystem, path);
  return bytes.ok ? parseProjectContainer(bytes.value) : bytes;
}

export interface ProjectIO {
  open(path: string): Promise<Result<OpenedProject, ProjectError>>;
  save(args: SaveProjectArgs): Promise<Result<void, ProjectError>>;
  saveAs(args: SaveProjectArgs): Promise<Result<void, ProjectError>>;
}

export function createProjectIO(fileSystem: ProjectFileSystemPort): ProjectIO {
  return {
    open: (path) => openProject(fileSystem, path),
    save: (args) => saveProjectAtomic(fileSystem, args),
    saveAs: (args) => saveProjectAtomic(fileSystem, args),
  };
}

export async function ensureDirectory(
  fileSystem: ProjectFileSystemPort,
  path: string,
): Promise<Result<void, ProjectError>> {
  try {
    await fileSystem.mkdir(path);
    return ok(undefined);
  } catch (cause) {
    return err(
      projectError("io", `Não foi possível criar "${path}": ${describeCause(cause)}`, {
        path,
        cause,
      }),
    );
  }
}
