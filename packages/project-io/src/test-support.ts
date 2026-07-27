import type { ProjectDocument } from "@theatrum/schema";

import type { FileSystemEntry, ProjectFileSystemPort } from "./filesystem.js";

export class MemoryProjectFileSystem implements ProjectFileSystemPort {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>([".", "/"]);
  readonly operations: string[] = [];
  failRename = false;
  failWrite = false;

  async read(path: string): Promise<Uint8Array> {
    const value = this.files.get(normalize(path));
    if (value === undefined) throw new Error("ENOENT");
    return value.slice();
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    this.operations.push(`write:${normalize(path)}`);
    if (this.failWrite) throw new Error("ENOSPC");
    this.files.set(normalize(path), bytes.slice());
  }

  async sync(path: string): Promise<void> {
    this.operations.push(`sync:${normalize(path)}`);
  }

  async rename(source: string, destination: string): Promise<void> {
    this.operations.push(`rename:${normalize(source)}:${normalize(destination)}`);
    if (this.failRename) throw new Error("rename failed");
    const value = this.files.get(normalize(source));
    if (value === undefined) throw new Error("ENOENT");
    this.files.set(normalize(destination), value);
    this.files.delete(normalize(source));
  }

  async remove(path: string, options?: { readonly recursive?: boolean }): Promise<void> {
    const normalized = normalize(path);
    this.operations.push(`remove:${normalized}`);
    this.files.delete(normalized);
    if (options?.recursive === true) {
      for (const name of [...this.files.keys()]) {
        if (name.startsWith(`${normalized}/`)) this.files.delete(name);
      }
      for (const name of [...this.directories]) {
        if (name === normalized || name.startsWith(`${normalized}/`)) this.directories.delete(name);
      }
    }
  }

  async mkdir(path: string): Promise<void> {
    const normalized = normalize(path);
    this.operations.push(`mkdir:${normalized}`);
    this.directories.add(normalized);
  }

  async list(path: string): Promise<readonly FileSystemEntry[]> {
    const normalized = normalize(path);
    const prefix = normalized === "." ? "" : `${normalized}/`;
    const entries = new Map<string, FileSystemEntry["kind"]>();

    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === normalized) continue;
      const remainder = directory.slice(prefix.length);
      if (!remainder.includes("/") && remainder.length > 0) entries.set(remainder, "directory");
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      const separator = remainder.indexOf("/");
      if (separator === -1) entries.set(remainder, "file");
      else entries.set(remainder.slice(0, separator), "directory");
    }

    return [...entries]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, kind]) => ({ name, kind }));
  }
}

export function renameProject(document: ProjectDocument, name: string): ProjectDocument {
  return { ...document, name };
}

function normalize(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized.length === 0 ? "." : normalized;
}
