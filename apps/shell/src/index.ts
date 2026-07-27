/**
 * Contrato público entre o host Electron e o renderer.
 *
 * Nada que implemente Electron é exportado por este barrel. O editor enxerga
 * apenas tipos e constantes da ponte; main e preload continuam detalhes
 * privados de `apps/shell`.
 */
export {
  BRIDGE_KEY,
  DATA_BASE_URL,
  DATA_HOST,
  DATA_SCHEME,
  IPC_CHANNELS,
  MENU_ACTION_CHANNEL,
  WORKSPACE_FLUSH_CHANNEL,
  WORKSPACE_VERSION,
  type AppInfo,
  type IpcChannel,
  type IpcContracts,
  type IpcRequest,
  type IpcResponse,
  type MenuAction,
  type ProjectFileReference,
  type ProjectOpenResult,
  type ProjectSaveRequest,
  type ProjectSaveResult,
  type RecoveryCandidateInfo,
  type RecoveryCandidatesResult,
  type RecoveryDocumentResult,
  type RecoveryOperationResult,
  type RecoveryRecordRequest,
  type RecoveryStartRequest,
  type TheatrumBridge,
  type WorkspaceState,
} from "./ipc/contracts.js";
