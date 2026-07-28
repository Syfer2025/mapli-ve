/**
 * Contratos de IPC — a única superfície entre renderer e sistema operacional.
 *
 * Nada de `ipcRenderer.invoke("string-solta")`. Cada canal é declarado aqui
 * com tipo de requisição e resposta, e o preload expõe exatamente estes.
 * Ver docs/02-MODULES.md § apps/shell.
 */

/** Layout de painéis e estado de sessão. Não afeta o pixel renderizado. */
export interface WorkspaceState {
  /** Serialização opaca do dockview. Formato de terceiro; não interpretamos. */
  readonly layout: unknown;
  readonly version: number;
  readonly savedAtMs: number;
}

export interface AppInfo {
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly userDataPath: string;
  readonly isPackaged: boolean;
}

/** Referência opaca a um arquivo escolhido pelo usuário no processo main. */
export interface ProjectFileReference {
  /**
   * Capacidade efêmera, válida somente nesta execução.
   *
   * O renderer nunca envia um caminho arbitrário para escrita. Ele devolve
   * este handle e o main resolve o caminho previamente autorizado pelo
   * diálogo nativo.
   */
  readonly handle: string;
  readonly name: string;
  readonly path: string;
}

export type ProjectOpenResult =
  | {
      readonly status: "opened";
      readonly file: ProjectFileReference;
      readonly bytes: Uint8Array;
    }
  | { readonly status: "cancelled" };

export interface ProjectSaveRequest {
  readonly file: ProjectFileReference | null;
  readonly suggestedName: string;
  readonly bytes: Uint8Array;
}

export type ProjectSaveResult =
  | { readonly status: "saved"; readonly file: ProjectFileReference }
  | { readonly status: "cancelled" };

export type MenuAction =
  | "project:new"
  | "project:open"
  | "project:save"
  | "project:save-as"
  | "history:undo"
  | "history:redo";

export interface RecoveryCandidateInfo {
  readonly projectId: string;
  readonly projectPath: string | null;
  readonly heartbeat: number;
  readonly sequence: number;
}

export interface RecoveryStartRequest {
  readonly document: unknown;
  readonly projectPath: string | null;
  /**
   * Container-base opcional para preservar assets, thumbnails e notas após um
   * crash. Projetos novos, que contêm somente o documento, não precisam dele.
   */
  readonly container?: Uint8Array;
}

export interface RecoveryRecordRequest {
  readonly document: unknown;
  readonly commands: number;
  readonly force: boolean;
}

export type RecoveryOperationResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

export type RecoveryCandidatesResult =
  | { readonly ok: true; readonly candidates: readonly RecoveryCandidateInfo[] }
  | { readonly ok: false; readonly message: string };

export type RecoveryDocumentResult =
  | { readonly ok: true; readonly document: unknown; readonly container: Uint8Array | null }
  | { readonly ok: false; readonly message: string };

/**
 * Superfície pública do preload no renderer.
 *
 * O tipo vive junto dos contratos, não no arquivo que implementa o preload:
 * assim o editor depende somente do contrato público do host e nunca alcança
 * um detalhe interno de `apps/shell`.
 */
export interface TheatrumBridge {
  readonly app: {
    readonly info: () => Promise<AppInfo>;
  };
  readonly workspace: {
    readonly load: () => Promise<WorkspaceState | null>;
    readonly save: (state: WorkspaceState) => Promise<void>;
    /**
     * Gravação bloqueante reservada ao `pagehide`.
     *
     * O renderer pode morrer antes de um `invoke` assíncrono terminar. O
     * workspace é pequeno, então bloquear por uma única escrita atômica no
     * fechamento é preferível a perder o último ajuste de layout.
     */
    readonly flush: (state: WorkspaceState) => void;
    readonly reset: () => Promise<void>;
  };
  readonly project: {
    readonly open: () => Promise<ProjectOpenResult>;
    readonly save: (request: ProjectSaveRequest) => Promise<ProjectSaveResult>;
    readonly saveAs: (request: ProjectSaveRequest) => Promise<ProjectSaveResult>;
  };
  readonly menu: {
    readonly onAction: (listener: (action: MenuAction) => void) => () => void;
  };
  readonly recovery: {
    readonly start: (request: RecoveryStartRequest) => Promise<RecoveryOperationResult>;
    readonly record: (request: RecoveryRecordRequest) => Promise<RecoveryOperationResult>;
    readonly heartbeat: () => Promise<RecoveryOperationResult>;
    readonly candidates: () => Promise<RecoveryCandidatesResult>;
    readonly recover: (projectId: string) => Promise<RecoveryDocumentResult>;
    readonly discard: (projectId: string) => Promise<RecoveryOperationResult>;
    readonly closeClean: () => Promise<RecoveryOperationResult>;
  };
  readonly window: {
    readonly setTitle: (title: string) => Promise<void>;
  };
  /**
   * Sequência de frames em disco. `begin` pede a pasta uma vez; `frame` escreve
   * um PNG e devolve o hash dele — que é o que prova o critério byte-idêntico da
   * Fase 8 sem precisar reler o arquivo.
   */
  readonly export: {
    readonly begin: (request: ExportBeginRequest) => Promise<ExportBeginResult>;
    readonly frame: (request: ExportFrameRequest) => Promise<ExportFrameResult>;
    readonly append: (request: ExportAppendRequest) => Promise<ExportAppendResult>;
  };
}

/** Pasta de saída de um export de sequência. Ver ADR-013. */
export interface ExportBeginRequest {
  readonly jobName: string;
  /**
   * Pasta de destino já conhecida. Presente, o diálogo é pulado — é o que
   * permite reexportar para o mesmo lugar sem perguntar de novo, e é como o
   * verificador de fase roda sem interação.
   */
  readonly directory?: string;
}

export interface ExportBeginResult {
  readonly ok: boolean;
  readonly directory: string;
  readonly message?: string;
}

/**
 * Um frame a escrever.
 *
 * O RGBA cruza o IPC como `Uint8Array`: o Electron serializa por estrutura, sem
 * passar por JSON, então 7 MB de pixels não viram 20 MB de texto.
 */
export interface ExportFrameRequest {
  readonly directory: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface ExportFrameResult {
  readonly ok: boolean;
  readonly bytes: number;
  /** SHA-256 do arquivo escrito: é o que prova byte-idêntico entre execuções. */
  readonly sha256: string;
  readonly message?: string;
}

/**
 * Um pedaço de arquivo a anexar.
 *
 * O MP4 fragmentado nasce em pedaços — cabeçalho, e depois um par `moof`+`mdat`
 * por fragmento. Juntar tudo em memória antes de escrever anularia a razão de ele
 * ser fragmentado: 450 MB de RAM num vídeo de noventa segundos em 4K.
 */
export interface ExportAppendRequest {
  readonly directory: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
  /** Verdadeiro no primeiro pedaço: zera o arquivo antes de escrever. */
  readonly truncate: boolean;
}

export interface ExportAppendResult {
  readonly ok: boolean;
  readonly bytes: number;
  readonly message?: string;
}

/**
 * Mapa canal → { request, response }.
 *
 * O preload e o main derivam suas assinaturas daqui, então acrescentar um canal
 * sem implementar as duas pontas não compila.
 */
export interface IpcContracts {
  "app:info": { request: void; response: AppInfo };
  "workspace:load": { request: void; response: WorkspaceState | null };
  "workspace:save": { request: WorkspaceState; response: void };
  "workspace:reset": { request: void; response: void };
  "project:open": { request: void; response: ProjectOpenResult };
  "project:save": { request: ProjectSaveRequest; response: ProjectSaveResult };
  "project:save-as": { request: ProjectSaveRequest; response: ProjectSaveResult };
  "recovery:start": { request: RecoveryStartRequest; response: RecoveryOperationResult };
  "recovery:record": { request: RecoveryRecordRequest; response: RecoveryOperationResult };
  "recovery:heartbeat": { request: void; response: RecoveryOperationResult };
  "recovery:candidates": { request: void; response: RecoveryCandidatesResult };
  "recovery:recover": { request: string; response: RecoveryDocumentResult };
  "recovery:discard": { request: string; response: RecoveryOperationResult };
  "recovery:close-clean": { request: void; response: RecoveryOperationResult };
  "window:set-title": { request: string; response: void };
  "export:begin": { request: ExportBeginRequest; response: ExportBeginResult };
  "export:frame": { request: ExportFrameRequest; response: ExportFrameResult };
  "export:append": { request: ExportAppendRequest; response: ExportAppendResult };
}

export type IpcChannel = keyof IpcContracts;
export type IpcRequest<C extends IpcChannel> = IpcContracts[C]["request"];
export type IpcResponse<C extends IpcChannel> = IpcContracts[C]["response"];

export const IPC_CHANNELS = [
  "app:info",
  "workspace:load",
  "workspace:save",
  "workspace:reset",
  "project:open",
  "project:save",
  "project:save-as",
  "recovery:start",
  "recovery:record",
  "recovery:heartbeat",
  "recovery:candidates",
  "recovery:recover",
  "recovery:discard",
  "recovery:close-clean",
  "window:set-title",
  "export:begin",
  "export:frame",
  "export:append",
] as const satisfies readonly IpcChannel[];

/** Canal síncrono separado: nunca entra no fluxo normal de `invoke`. */
export const WORKSPACE_FLUSH_CHANNEL = "workspace:flush";

/** Eventos unidirecionais do menu nativo para o editor. */
export const MENU_ACTION_CHANNEL = "menu:action";

/** Origem somente-leitura dos dados cartográficos locais. */
export const DATA_SCHEME = "theatrum-data";
export const DATA_HOST = "local";
export const DATA_BASE_URL = `${DATA_SCHEME}://${DATA_HOST}`;

/** Versão do formato de workspace. Incompatível → descarta e usa o padrão. */
export const WORKSPACE_VERSION = 3;

/** Nome sob o qual o preload publica a ponte em `window`. */
export const BRIDGE_KEY = "theatrum";
