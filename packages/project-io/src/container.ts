import { err, ok, type Result } from "@theatrum/core-utils";
import {
  APP_NAME,
  CURRENT_SCHEMA_VERSION,
  FORMAT_ID,
  PROJECT_CONTAINER_VERSION,
  ProjectManifestSchema,
  FutureSchemaVersionError,
  InvalidSchemaVersionError,
  safeParseProjectDocument,
  type ProjectDocument,
  type ProjectManifest,
} from "@theatrum/schema";

import {
  contentAddressAsset,
  verifyContentAddressedAsset,
  type ContentAddressedAsset,
} from "./assets.js";
import { encodeCanonicalJson, parseJsonBytes } from "./canonical-json.js";
import { projectError, type ProjectError } from "./errors.js";
import { decodeUtf8, encodeUtf8 } from "./utf8.js";
import { decodeZip, encodeZip, type ZipEntry } from "./zip.js";

export const DETERMINISTIC_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export interface ProjectContainerInput {
  readonly document: ProjectDocument;
  readonly assets?: readonly ContentAddressedAsset[];
  readonly app?: {
    readonly version?: string;
  };
  /**
   * Timestamps só mudam quando o chamador os fornece. O padrão fixo mantém dois
   * saves do mesmo documento idênticos byte a byte.
   */
  readonly timestamps?: {
    readonly created: string;
    readonly modified: string;
  };
  readonly thumbnails?: Readonly<Record<string, Uint8Array>>;
  readonly notes?: string;
}

export interface OpenedProject {
  readonly document: ProjectDocument;
  readonly manifest: ProjectManifest;
  readonly assets: ReadonlyMap<string, Uint8Array>;
  readonly thumbnails: ReadonlyMap<string, Uint8Array>;
  readonly notes: string | null;
  readonly migratedFrom: null;
}

export function createEmbeddedAsset(
  bytes: Uint8Array,
  extension: string,
): Result<ContentAddressedAsset, ProjectError> {
  return contentAddressAsset(bytes, extension);
}

export function serializeProjectContainer(
  input: ProjectContainerInput,
): Result<Uint8Array, ProjectError> {
  const validatedDocument = parseDocument(input.document);
  if (!validatedDocument.ok) return validatedDocument;
  const document = validatedDocument.value;

  const documentIdentity = readIdentity(document);
  if (!documentIdentity.ok) return documentIdentity;

  const projectJson = encodeCanonicalJson(document);
  if (!projectJson.ok) return projectJson;

  const assets = deduplicateAssets(input.assets ?? []);
  if (!assets.ok) return assets;
  const embeddedReferences = validateEmbeddedReferences(
    document,
    new Set(assets.value.map((asset) => asset.path)),
  );
  if (!embeddedReferences.ok) return embeddedReferences;

  const manifest: ProjectManifest = {
    format: FORMAT_ID,
    container: PROJECT_CONTAINER_VERSION,
    schemaVersion: document.schemaVersion,
    app: {
      name: APP_NAME,
      version: input.app?.version ?? "0.0.0",
    },
    project: documentIdentity.value,
    created: input.timestamps?.created ?? DETERMINISTIC_TIMESTAMP,
    modified: input.timestamps?.modified ?? DETERMINISTIC_TIMESTAMP,
    stats: computeStats(document, assets.value.length),
  };
  const validatedManifest = validateManifest(manifest);
  if (!validatedManifest.ok) return validatedManifest;
  const manifestJson = encodeCanonicalJson(validatedManifest.value);
  if (!manifestJson.ok) return manifestJson;

  const entries: ZipEntry[] = [
    { name: "manifest.json", bytes: manifestJson.value },
    { name: "project.json", bytes: projectJson.value },
    ...assets.value.map((asset) => ({ name: asset.path, bytes: asset.bytes })),
  ];

  for (const [name, bytes] of sortedEntries(input.thumbnails)) {
    const safeName = name.replaceAll("\\", "/");
    entries.push({ name: `thumbnails/${safeName}`, bytes });
  }
  if (input.notes !== undefined) {
    entries.push({ name: "meta/notes.md", bytes: encodeUtf8(input.notes) });
  }

  return encodeZip(entries);
}

export function parseProjectContainer(bytes: Uint8Array): Result<OpenedProject, ProjectError> {
  const decoded = decodeZip(bytes);
  if (!decoded.ok) return decoded;
  if (decoded.value[0]?.name !== "manifest.json") {
    return err(
      projectError(
        "invalid-container",
        "manifest.json precisa ser o primeiro membro do container.",
        { expected: "manifest.json", actual: decoded.value[0]?.name ?? "(ausente)" },
      ),
    );
  }

  const entries = new Map(decoded.value.map((entry) => [entry.name, entry.bytes] as const));
  const manifestBytes = entries.get("manifest.json");
  const projectBytes = entries.get("project.json");
  if (manifestBytes === undefined) return missingEntry("manifest.json");
  if (projectBytes === undefined) return missingEntry("project.json");

  const manifestRaw = parseJsonBytes(manifestBytes, "manifest.json");
  if (!manifestRaw.ok) return manifestRaw;
  const manifest = validateManifest(manifestRaw.value);
  if (!manifest.ok) return manifest;

  const projectRaw = parseJsonBytes(projectBytes, "project.json");
  if (!projectRaw.ok) return projectRaw;
  const document = parseDocument(projectRaw.value);
  if (!document.ok) return document;

  if (manifest.value.schemaVersion !== document.value.schemaVersion) {
    return err(
      projectError(
        "invalid-container",
        "schemaVersion diverge entre manifest.json e project.json.",
        {
          pointer: "/schemaVersion",
          expected: document.value.schemaVersion,
          actual: manifest.value.schemaVersion,
        },
      ),
    );
  }

  const assets = new Map<string, Uint8Array>();
  const thumbnails = new Map<string, Uint8Array>();
  for (const [name, content] of entries) {
    if (name.startsWith("assets/")) {
      const verified = verifyContentAddressedAsset(name, content);
      if (!verified.ok) return verified;
      assets.set(name, content);
    } else if (name.startsWith("thumbnails/")) {
      thumbnails.set(name.slice("thumbnails/".length), content);
    }
  }
  const embeddedReferences = validateEmbeddedReferences(document.value, new Set(assets.keys()));
  if (!embeddedReferences.ok) return embeddedReferences;

  const notesBytes = entries.get("meta/notes.md");
  let notes: string | null = null;
  if (notesBytes !== undefined) {
    const decodedNotes = decodeUtf8(notesBytes);
    if (typeof decodedNotes !== "string") return err(decodedNotes);
    notes = decodedNotes;
  }

  return ok({
    document: document.value,
    manifest: manifest.value,
    assets,
    thumbnails,
    notes,
    migratedFrom: null,
  });
}

function validateManifest(value: unknown): Result<ProjectManifest, ProjectError> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err(projectError("invalid-format", "manifest.json precisa conter um objeto."));
  }
  const manifest = value as Record<string, unknown>;
  if (manifest["format"] !== FORMAT_ID) {
    return err(
      projectError("invalid-format", "O arquivo não é um projeto Theatrum.", {
        pointer: "/format",
        expected: FORMAT_ID,
        actual: String(manifest["format"]),
      }),
    );
  }
  if (manifest["container"] !== PROJECT_CONTAINER_VERSION) {
    return err(
      projectError(
        "unsupported-container",
        `Container v${String(manifest["container"])} não é suportado; esta versão lê container v${PROJECT_CONTAINER_VERSION}.`,
        {
          pointer: "/container",
          expected: PROJECT_CONTAINER_VERSION,
          actual:
            typeof manifest["container"] === "number"
              ? manifest["container"]
              : String(manifest["container"]),
        },
      ),
    );
  }
  if (!Number.isSafeInteger(manifest["schemaVersion"])) {
    return err(
      projectError("invalid-format", "schemaVersion inválido no manifest.", {
        pointer: "/schemaVersion",
      }),
    );
  }
  if ((manifest["schemaVersion"] as number) > CURRENT_SCHEMA_VERSION) {
    return err(
      projectError(
        "future-schema",
        `Este projeto usa schema v${String(manifest["schemaVersion"])}, mas esta versão do aplicativo suporta até v${CURRENT_SCHEMA_VERSION}. Atualize o aplicativo para abrir o arquivo.`,
        {
          pointer: "/schemaVersion",
          expected: CURRENT_SCHEMA_VERSION,
          actual: manifest["schemaVersion"] as number,
        },
      ),
    );
  }

  const parsed = ProjectManifestSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        projectError("invalid-format", "manifest.json não corresponde ao schema do formato.", {
          pointer: parsed.error.issues[0]?.path.length
            ? `/${parsed.error.issues[0].path.join("/")}`
            : "/",
          cause: parsed.error,
        }),
      );
}

function readIdentity(document: ProjectDocument): Result<ProjectManifest["project"], ProjectError> {
  return ok({ id: document["id"], name: document["name"] });
}

function computeStats(document: ProjectDocument, assetCount: number): ProjectManifest["stats"] {
  const compositions = Array.isArray(document["compositions"]) ? document["compositions"] : [];
  let nodeCount = 0;
  let durationFrames = 0;

  for (const composition of compositions) {
    if (typeof composition !== "object" || composition === null) continue;
    const record = composition as Record<string, unknown>;
    if (typeof record["nodes"] === "object" && record["nodes"] !== null) {
      nodeCount += Object.keys(record["nodes"]).length;
    }
    if (typeof record["duration"] === "number" && Number.isFinite(record["duration"])) {
      durationFrames = Math.max(durationFrames, Math.max(0, Math.floor(record["duration"])));
    }
  }

  return {
    assets: assetCount,
    compositions: compositions.length,
    durationFrames,
    nodes: nodeCount,
  };
}

function deduplicateAssets(
  assets: readonly ContentAddressedAsset[],
): Result<readonly ContentAddressedAsset[], ProjectError> {
  const deduplicated = new Map<string, ContentAddressedAsset>();
  for (const asset of assets) {
    const verified = verifyContentAddressedAsset(asset.path, asset.bytes);
    if (!verified.ok) return verified;
    const existing = deduplicated.get(asset.path);
    if (existing !== undefined && !bytesEqual(existing.bytes, asset.bytes)) {
      return err(
        projectError("asset-corrupt", `Dois assets diferentes usam o caminho ${asset.path}.`, {
          path: asset.path,
        }),
      );
    }
    deduplicated.set(asset.path, asset);
  }
  return ok(
    [...deduplicated.values()].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
  );
}

function sortedEntries(
  value: Readonly<Record<string, Uint8Array>> | undefined,
): readonly [string, Uint8Array][] {
  return Object.entries(value ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function parseDocument(value: unknown): Result<ProjectDocument, ProjectError> {
  const parsed = safeParseProjectDocument(value);
  if (parsed.success) return ok(parsed.data);

  if (parsed.error instanceof FutureSchemaVersionError) {
    return err(
      projectError("future-schema", parsed.error.message, {
        pointer: "/schemaVersion",
        expected: parsed.error.supportedVersion,
        actual: parsed.error.foundVersion,
        cause: parsed.error,
      }),
    );
  }
  if (parsed.error instanceof InvalidSchemaVersionError) {
    return err(
      projectError("invalid-document", parsed.error.message, {
        pointer: "/schemaVersion",
        cause: parsed.error,
      }),
    );
  }
  return err(
    projectError("invalid-document", "project.json não corresponde ao schema de projeto.", {
      pointer: parsed.error.issues[0]?.path.length
        ? `/${parsed.error.issues[0].path.join("/")}`
        : "/",
      cause: parsed.error,
    }),
  );
}

function missingEntry(name: string): Result<never, ProjectError> {
  return err(
    projectError("missing-entry", `O container não contém ${name}.`, {
      path: name,
    }),
  );
}

function validateEmbeddedReferences(
  document: ProjectDocument,
  availablePaths: ReadonlySet<string>,
): Result<void, ProjectError> {
  for (const descriptor of [...document.assets, ...document.geoData]) {
    if (descriptor.src.startsWith("assets/") && !availablePaths.has(descriptor.src)) {
      return missingEntry(descriptor.src);
    }
  }
  return ok(undefined);
}
