/**
 * Biblioteca 3D local: os modelos que estão no disco mas ainda não no projeto.
 *
 * A distinção é o ponto deste módulo. O AssetStore da Fase 7A guarda os bytes
 * **dentro** do `.theatrum`, o que é certo para reabrir um projeto sem pedir
 * caminho de arquivo — mas com 2,7 GB de modelos, importar tudo daria um arquivo
 * de projeto de 2,7 GB por dados que a cena talvez nem use.
 *
 * Então há dois níveis: o índice local lista o que **existe** na máquina, e
 * importar traz um modelo para dentro do projeto. Um clique atravessa a fronteira,
 * e só o que atravessou viaja com o arquivo.
 *
 * A pasta é uma junção criada à mão — ver `tools/build-model-index.ts`. Índice
 * ausente não é erro: significa que esta máquina não tem biblioteca local, e o
 * painel simplesmente não mostra a seção.
 */

const INDEX_URL = "theatrum-data://local/models-index.json";
const MODEL_BASE = "theatrum-data://local/models";

export interface LocalModel {
  readonly file: string;
  readonly label: string;
  readonly category: string;
  readonly bytes: number;
  /** Número da variação quando o nome traz `(n)`; `null` quando é o principal. */
  readonly variant: number | null;
}

export interface LocalModelIndex {
  readonly version: number;
  readonly models: readonly LocalModel[];
}

/** Nome de exibição, com a variação anexada quando existe. */
export function localModelLabel(model: LocalModel): string {
  return model.variant === null ? model.label : `${model.label} · variação ${model.variant}`;
}

let indexPromise: Promise<LocalModelIndex | null> | undefined;

/**
 * Lê o índice uma vez por sessão.
 *
 * `null` quer dizer "esta máquina não tem biblioteca local" — não é falha. Quem
 * chama esconde a seção em vez de mostrar erro: um editor que reclama de algo
 * opcional treina o usuário a ignorar avisos.
 */
export function loadLocalModelIndex(): Promise<LocalModelIndex | null> {
  indexPromise ??= (async (): Promise<LocalModelIndex | null> => {
    try {
      const response = await fetch(INDEX_URL);
      if (!response.ok) return null;
      const parsed = (await response.json()) as LocalModelIndex;
      if (!Array.isArray(parsed.models)) return null;
      return parsed;
    } catch {
      return null;
    }
  })();
  return indexPromise;
}

export interface LocalModelImport {
  readonly ok: boolean;
  readonly label: string;
  readonly bytes: number;
  readonly message: string | undefined;
}

/**
 * Traz um modelo local para dentro do projeto.
 *
 * Devolve um `File` para o caminho de import que já existe, em vez de um caminho
 * paralelo: o AssetStore continua sendo quem calcula o hash de conteúdo, gera
 * thumbnail e registra o descriptor. Importar da Biblioteca local e importar por
 * arrastar arquivo passam a ser o **mesmo** código depois deste ponto.
 */
export async function importLocalModel(
  model: LocalModel,
  importFiles: (files: readonly File[]) => Promise<unknown>,
): Promise<LocalModelImport> {
  try {
    const response = await fetch(`${MODEL_BASE}/${encodeURIComponent(model.file)}`);
    if (!response.ok) {
      return {
        ok: false,
        label: localModelLabel(model),
        bytes: 0,
        message: `o arquivo respondeu ${response.status}`,
      };
    }
    const bytes = await response.arrayBuffer();
    const type = model.file.toLowerCase().endsWith(".gltf")
      ? "model/gltf+json"
      : "model/gltf-binary";
    await importFiles([new File([bytes], model.file, { type })]);
    return { ok: true, label: localModelLabel(model), bytes: bytes.byteLength, message: undefined };
  } catch (error: unknown) {
    return {
      ok: false,
      label: localModelLabel(model),
      bytes: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Agrupa por categoria, preservando a ordem estável do índice. */
export function groupLocalModels(
  models: readonly LocalModel[],
): readonly (readonly [string, readonly LocalModel[]])[] {
  const groups = new Map<string, LocalModel[]>();
  for (const model of models) {
    const bucket = groups.get(model.category);
    if (bucket === undefined) groups.set(model.category, [model]);
    else bucket.push(model);
  }
  return Object.freeze([...groups.entries()].map(([category, list]) => [category, list] as const));
}

/** Filtra por texto livre sobre nome, categoria e arquivo. */
export function filterLocalModels(
  models: readonly LocalModel[],
  query: string,
): readonly LocalModel[] {
  const needle = query.trim().toLocaleLowerCase("pt-BR");
  if (needle === "") return models;
  return models.filter((model) =>
    `${model.label} ${model.category} ${model.file}`.toLocaleLowerCase("pt-BR").includes(needle),
  );
}
