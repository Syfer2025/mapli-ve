import {
  assetDimensions,
  assetDisplayName,
  assetKindForFile,
  baseNameFromFileName,
  buildAssetDescriptor,
  extensionForFileName,
  findAssetReferences,
  type AssetReference,
} from "@theatrum/assets";
import { createCommandBus, type HistorySnapshot } from "@theatrum/commands";
import { createBuiltinActionRegistry } from "@theatrum/behaviors";
import { subframe } from "@theatrum/core-time";
import { createIdFactory } from "@theatrum/core-utils";
import { createDocumentStore } from "@theatrum/document";
import { createBuiltinNodeTypeRegistry, type NodeTypeDefinition } from "@theatrum/scene-graph";
import {
  createEmbeddedAsset,
  parseProjectContainer,
  serializeProjectContainer,
  type ContentAddressedAsset,
  type OpenedProject,
  type ProjectContainerInput,
} from "@theatrum/project-io";
import {
  APP_NAME,
  createEmptyProjectDocument,
  safeParseProjectDocument,
  type AnimatableProperty,
  type Anchor,
  type EasingHandle,
  type Node,
  type PathData,
  type PathVertex,
  type ProjectDocument,
  type SizeSpec,
} from "@theatrum/schema";
import type { MenuAction, ProjectFileReference, RecoveryCandidateInfo } from "@theatrum/shell";
import {
  assetMediaSources,
  assetTextureInfo,
  assetThumbnailUrl,
  createTextureBitmap,
  registerAssetMedia,
  resetAssetMedia,
  unregisterAssetMedia,
} from "../assets/asset-media.js";
import { bridge } from "../bridge/index.js";
import {
  resolveNodeAnimatableProperty,
  type ResolvedNodeAnimatableProperty,
} from "./optional-animatable-property.js";

const AUTOSAVE_DEBOUNCE_MS = 500;
const HEARTBEAT_INTERVAL_MS = 5_000;

const ids = createIdFactory(0x0f03_2026, { detectCollisions: true });
export const nodeTypeRegistry = createBuiltinNodeTypeRegistry();
export const actionTemplateRegistry = createBuiltinActionRegistry();
const initialDocument = createEmptyProjectDocument();
const documentStore = createDocumentStore(initialDocument);
export const commandBus = createCommandBus(documentStore);

export interface EditorSessionSnapshot {
  readonly document: ProjectDocument;
  readonly revision: number;
  readonly dirty: boolean;
  readonly file: ProjectFileReference | null;
  readonly status: string;
  readonly error: string | null;
  readonly selectedCompositionId: string;
  readonly selectedNodeId: string | null;
  readonly selectedNodeIds: readonly string[];
  readonly playheadFrame: number;
  readonly isPlaying: boolean;
  readonly loopPlayback: boolean;
  readonly history: HistorySnapshot;
  readonly recoveryCandidate: RecoveryCandidateInfo | null;
  readonly ready: boolean;
}

type SessionListener = () => void;
type ContainerExtras = Omit<ProjectContainerInput, "document">;
interface NodeClipboard {
  readonly roots: readonly string[];
  readonly nodes: Readonly<Record<string, Node>>;
}

const EMPTY_CONTAINER_EXTRAS: ContainerExtras = Object.freeze({});

const listeners = new Set<SessionListener>();
let initialized: Promise<void> | null = null;
let autosaveReady = false;
let autosaveTimer: number | null = null;
let pendingCommands = 0;
let suppressDocumentEffects = false;
let heartbeatTimer: number | null = null;
let projectGeneration = 0;
let containerExtras: ContainerExtras = EMPTY_CONTAINER_EXTRAS;
let playbackRequest: number | null = null;
let playbackStartedAt = 0;
let playbackStartFrame = 0;
let nodeClipboard: NodeClipboard | null = null;

let snapshot: EditorSessionSnapshot = Object.freeze({
  document: initialDocument,
  revision: 0,
  dirty: false,
  file: null,
  status: "Projeto novo",
  error: null,
  selectedCompositionId: initialDocument.compositions[0]?.id ?? "",
  selectedNodeId: null,
  selectedNodeIds: Object.freeze([]),
  playheadFrame: 0,
  isPlaying: false,
  loopPlayback: false,
  history: historySnapshot(),
  recoveryCandidate: null,
  ready: false,
});

export function subscribeEditorSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEditorSessionSnapshot(): EditorSessionSnapshot {
  return snapshot;
}

export function initializeEditorSession(): Promise<void> {
  initialized ??= initialize();
  return initialized;
}

export const editorActions = Object.freeze({
  dispatch(command: unknown): boolean {
    const result = commandBus.dispatch(command);
    if (!result.ok) {
      update({ error: result.error.message, status: "Comando rejeitado" });
      return false;
    }
    update({ error: null, status: result.label });
    return true;
  },

  undo(): void {
    if (commandBus.undo()) update({ status: "Desfeito", error: null });
  },

  redo(): void {
    if (commandBus.redo()) update({ status: "Refeito", error: null });
  },

  jumpHistory(index: number): void {
    commandBus.history.jumpTo(index);
    update({ status: index < 0 ? "Estado inicial" : "Histórico restaurado" });
  },

  selectComposition(compositionId: string): void {
    pausePlayback();
    update({
      selectedCompositionId: compositionId,
      selectedNodeId: null,
      selectedNodeIds: Object.freeze([]),
      playheadFrame: 0,
    });
  },

  selectNode(compositionId: string, nodeId: string, additive = false): void {
    const current =
      additive && compositionId === snapshot.selectedCompositionId
        ? [...snapshot.selectedNodeIds]
        : [];
    const existing = current.indexOf(nodeId);
    if (additive && existing >= 0) current.splice(existing, 1);
    else if (existing < 0) current.push(nodeId);
    update({
      selectedCompositionId: compositionId,
      selectedNodeId: current.at(-1) ?? null,
      selectedNodeIds: Object.freeze(current),
    });
  },

  selectNodes(compositionId: string, nodeIds: readonly string[]): void {
    const composition = documentStore
      .get()
      .compositions.find((candidate) => candidate.id === compositionId);
    if (composition === undefined) return;
    const unique = [
      ...new Set(nodeIds.filter((nodeId) => composition.nodes[nodeId] !== undefined)),
    ];
    update({
      selectedCompositionId: compositionId,
      selectedNodeId: unique.at(-1) ?? null,
      selectedNodeIds: Object.freeze(unique),
    });
  },

  clearSelection(): void {
    update({ selectedNodeId: null, selectedNodeIds: Object.freeze([]) });
  },

  setPlayhead(frame: number): void {
    const composition = selectedComposition();
    if (composition === undefined || !Number.isFinite(frame)) return;
    update({
      playheadFrame: Math.max(0, Math.min(composition.duration, Math.round(frame))),
    });
  },

  /**
   * Move temporal exclusivo do pump de export.
   *
   * Scrub, teclado e playback continuam em `setPlayhead`, que arredonda. Só o
   * motion blur pode pôr uma fração no estado transitório da sessão, e ela nunca
   * entra no documento nem no histórico. O último frame visível é
   * `duration - 1`; o sentinel `duration` do fim da timeline não é uma pose para
   * amostrar.
   */
  setExportPlayhead(frame: number): void {
    const composition = selectedComposition();
    if (composition === undefined || !Number.isFinite(frame)) return;
    update({
      playheadFrame: subframe(Math.max(0, Math.min(Math.max(0, composition.duration - 1), frame))),
    });
  },

  play(): void {
    if (playbackRequest !== null) return;
    const composition = selectedComposition();
    if (composition === undefined) return;
    const startFrame = snapshot.playheadFrame >= composition.duration ? 0 : snapshot.playheadFrame;
    playbackStartFrame = startFrame;
    playbackStartedAt = performance.now();
    update({ playheadFrame: startFrame, isPlaying: true, status: "Reproduzindo" });
    playbackRequest = requestAnimationFrame(playbackTick);
  },

  pause(): void {
    pausePlayback();
    update({ status: "Pausado" });
  },

  togglePlayback(): void {
    if (snapshot.isPlaying) this.pause();
    else this.play();
  },

  stop(): void {
    pausePlayback();
    update({ playheadFrame: 0, status: "Parado" });
  },

  setLoop(loopPlayback: boolean): void {
    update({ loopPlayback });
  },

  setPropertyValue(
    nodeId: string,
    path: string,
    value: unknown,
    keyframeWhenAnimated = true,
  ): boolean {
    const resolved = selectedEditableProperty(nodeId, path);
    if (resolved === undefined) return false;
    const { property } = resolved;
    const existing = property.keyframes.find(
      (keyframe) => keyframe.frame === snapshot.playheadFrame,
    );
    if (keyframeWhenAnimated && property.keyframes.length > 0) {
      const command = {
        type: "keyframe.set",
        payload: {
          ...propertyLocation(nodeId, path),
          keyframe: {
            id: existing?.id ?? ids("kf"),
            frame: snapshot.playheadFrame,
            value,
            in: existing?.in ?? { kind: "linear" },
            out: existing?.out ?? { kind: "linear" },
          },
        },
        source: "user",
      } as const;
      return resolved.initializationRequired
        ? initializePropertyAndDispatch(
            "Alterar propriedade animada",
            nodeId,
            path,
            property,
            command,
          )
        : this.dispatch(command);
    }
    if (resolved.initializationRequired) {
      const initialized = structuredClone(property);
      initialized.value = structuredClone(value);
      return this.dispatch({
        type: "property.initialize",
        payload: {
          ...propertyLocation(nodeId, path),
          property: initialized,
        },
        source: "user",
      });
    }
    return this.dispatch({
      type: "property.set",
      payload: { ...propertyLocation(nodeId, path), value },
      source: "user",
    });
  },

  togglePropertyKeyframe(nodeId: string, path: string): boolean {
    const resolved = selectedEditableProperty(nodeId, path);
    if (resolved === undefined || !resolved.descriptor.animatable) return false;
    const { property } = resolved;
    const existing = property.keyframes.find(
      (keyframe) => keyframe.frame === snapshot.playheadFrame,
    );
    if (existing !== undefined) {
      const command = {
        type: "keyframe.remove",
        payload: {
          ...propertyLocation(nodeId, path),
          keyframeId: existing.id,
        },
        source: "user",
      } as const;
      return resolved.initializationRequired
        ? initializePropertyAndDispatch("Remover keyframe", nodeId, path, property, command)
        : this.dispatch(command);
    }
    const command = {
      type: "keyframe.set",
      payload: {
        ...propertyLocation(nodeId, path),
        keyframe: {
          id: ids("kf"),
          frame: snapshot.playheadFrame,
          value: structuredClone(property.value),
          in: { kind: "linear" },
          out: { kind: "linear" },
        },
      },
      source: "user",
    } as const;
    return resolved.initializationRequired
      ? initializePropertyAndDispatch("Criar keyframe", nodeId, path, property, command)
      : this.dispatch(command);
  },

  removePropertyKeyframe(nodeId: string, path: string, keyframeId: string): boolean {
    return this.dispatch({
      type: "keyframe.remove",
      payload: { ...propertyLocation(nodeId, path), keyframeId },
      source: "user",
    });
  },

  movePropertyKeyframe(
    nodeId: string,
    path: string,
    keyframeId: string,
    targetFrame: number,
  ): boolean {
    const composition = selectedComposition();
    if (composition === undefined || !Number.isFinite(targetFrame)) return false;
    return this.dispatch({
      type: "keyframe.move",
      payload: {
        ...propertyLocation(nodeId, path),
        keyframeId,
        frame: Math.max(0, Math.min(composition.duration, Math.round(targetFrame))),
      },
      source: "user",
    });
  },

  setPropertyKeyframeEasing(
    nodeId: string,
    path: string,
    keyframeId: string,
    easing: { readonly in?: EasingHandle; readonly out?: EasingHandle },
  ): boolean {
    if (easing.in === undefined && easing.out === undefined) return false;
    return this.dispatch({
      type: "keyframe.set-easing",
      payload: {
        ...propertyLocation(nodeId, path),
        keyframeId,
        ...(easing.in === undefined ? {} : { in: easing.in }),
        ...(easing.out === undefined ? {} : { out: easing.out }),
      },
      source: "user",
    });
  },

  setNodeAnchor(nodeId: string, anchor: Anchor): boolean {
    return this.dispatch({
      type: "node.set-anchor",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        anchor,
      },
      source: "user",
    });
  },

  /** `null` remove o remapeamento e devolve o nó ao tempo da composição. */
  setNodeTimeRemap(nodeId: string, timeRemap: AnimatableProperty<number> | null): boolean {
    return this.dispatch({
      type: "node.set-time-remap",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        timeRemap,
      },
      source: "user",
    });
  },

  setNodeSize(nodeId: string, size: SizeSpec): boolean {
    return this.dispatch({
      type: "node.set-size",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        size,
      },
      source: "user",
    });
  },

  addNode(parentId?: string): string | null {
    return this.addNodeOfType("group", parentId);
  },

  /** Aceita qualquer tipo registrado: a UI enumera o registry, não uma lista fixa. */
  addNodeOfType(type: string, parentId?: string): string | null {
    const document = documentStore.get();
    const composition = document.compositions.find(
      (item) => item.id === snapshot.selectedCompositionId,
    );
    if (composition === undefined) return null;
    const definition = nodeTypeRegistry.get(type);
    if (definition === undefined) return null;
    const explicitlyRequested = parentId === undefined ? undefined : composition.nodes[parentId];
    const selected =
      snapshot.selectedNodeId === null ? undefined : composition.nodes[snapshot.selectedNodeId];
    const parent =
      explicitlyRequested ??
      (selected !== undefined && supportsChildren(selected.type)
        ? selected
        : selected?.parent === null || selected?.parent === undefined
          ? composition.nodes[composition.root]
          : composition.nodes[selected.parent]);
    if (parent === undefined || !supportsChildren(parent.type)) return null;

    const nodeId = ids("nd");
    const node = createNodeFromDefinition(
      composition.nodes[composition.root],
      definition,
      nodeId,
      parent.id,
      composition,
    );
    const ok = this.dispatch({
      type: "node.create",
      payload: { compositionId: composition.id, parentId: parent.id, node },
      source: "user",
    });
    if (ok) {
      update({
        selectedNodeId: nodeId,
        selectedNodeIds: Object.freeze([nodeId]),
      });
    }
    return ok ? nodeId : null;
  },

  /**
   * Cria um território ou rio a partir de uma feição do catálogo.
   *
   * Três comandos num só gesto do usuário — criar, nomear, apontar o `geoId` — e
   * a âncora vai para o centro da caixa envolvente da feição, porque é a partir
   * dela que os anéis são projetados. Sem isso o contorno nasceria deslocado.
   *
   * Cada comando entra no histórico separado, então `Ctrl+Z` desfaz por etapa.
   * Agrupar num comando composto é assunto do bloco 7C, quando a caneta também
   * precisar disso.
   */
  addGeoFeature(
    feature: { readonly id: string; readonly name: string; readonly kind: string },
    center: readonly [number, number],
  ): string | null {
    const type =
      feature.kind === "river"
        ? "geo.rivers"
        : feature.kind === "road"
          ? "geo.roads"
          : "geo.region";
    const nodeId = this.addNodeOfType(type);
    if (nodeId === null) return null;
    this.renameNode(nodeId, feature.name);
    this.setNodeAnchor(nodeId, { space: "geo", lngLat: [center[0], center[1]] });
    if (!this.setPropertyValue(nodeId, "props.geoId", feature.id)) return null;
    return nodeId;
  },

  /**
   * Cria um ponto de interesse do palco onde o dono clicou ([ADR-015](../../../../docs/adr/ADR-015-studio-points-of-interest.md)).
   *
   * Mesma forma do `addGeoFeature`: um gesto do usuário, vários comandos, cada um
   * no histórico separado. Esta camada não sabe raycast nem matriz de modelo, e
   * não deve saber: o ponto chega **no espaço em que vai ser guardado** e o
   * `ownerId` diz qual espaço é esse
   * ([ADR-016](../../../../docs/adr/ADR-016-poi-anchored-to-object.md)) — vazio para
   * metros de palco, preenchido para o espaço normalizado daquele `model3d`. Quem
   * converte é o painel, que é quem tem a caixa do GLB.
   *
   * O enquadramento também chega pronto, e é de propósito: quem sabe de que
   * ângulo a câmera estava olhando e qual o tamanho do modelo é o painel do palco.
   * Um padrão fixo aqui daria a mesma visita para um caça de 18 m e um obuseiro
   * de 11 m, e nenhuma das duas seria a que o dono estava vendo ao marcar.
   */
  addStudioPoi(
    point: readonly [number, number, number],
    name: string,
    framing: {
      readonly distanceMeters: number;
      readonly azimuthDeg: number;
      readonly elevationDeg: number;
    },
    ownerId = "",
  ): string | null {
    const nodeId = this.addNodeOfType("studio.poi");
    if (nodeId === null) return null;
    this.renameNode(nodeId, name);
    // `keyframeWhenAnimated = false`: marcar um ponto não é animar. Sem isso, um
    // POI cujo `pointX` já tenha keyframe ganharia mais um no playhead atual, e o
    // ponto marcado passaria a existir só naquele frame.
    const written =
      this.setPropertyValue(nodeId, "props.ownerId", ownerId, false) &&
      this.setPropertyValue(nodeId, "props.pointX", point[0], false) &&
      this.setPropertyValue(nodeId, "props.pointY", point[1], false) &&
      this.setPropertyValue(nodeId, "props.pointZ", point[2], false) &&
      this.setPropertyValue(nodeId, "props.distanceMeters", framing.distanceMeters, false) &&
      this.setPropertyValue(nodeId, "props.azimuthDeg", framing.azimuthDeg, false) &&
      this.setPropertyValue(nodeId, "props.elevationDeg", framing.elevationDeg, false);
    return written ? nodeId : null;
  },

  /**
   * Grava o enquadramento da câmera de autoria nas props do palco ([ADR-017](../../../../docs/adr/ADR-017-studio-authoring-camera.md)).
   *
   * `keyframeWhenAnimated = false` em todas as seis: gravar um enquadramento é dizer
   * "a câmera de repouso é esta", não "anime a câmera aqui". Com `true`, gravar depois
   * de compilar um roteiro cravaria um keyframe no playhead e furaria a visita — o
   * mesmo cuidado que o `addStudioPoi` toma.
   */
  writeStudioCamera(
    stageNodeId: string,
    camera: {
      readonly target: readonly [number, number, number];
      readonly distanceMeters: number;
      readonly azimuthDeg: number;
      readonly elevationDeg: number;
    },
  ): boolean {
    return (
      this.setPropertyValue(stageNodeId, "props.targetX", camera.target[0], false) &&
      this.setPropertyValue(stageNodeId, "props.targetY", camera.target[1], false) &&
      this.setPropertyValue(stageNodeId, "props.targetZ", camera.target[2], false) &&
      this.setPropertyValue(stageNodeId, "props.distanceMeters", camera.distanceMeters, false) &&
      this.setPropertyValue(stageNodeId, "props.azimuthDeg", camera.azimuthDeg, false) &&
      this.setPropertyValue(stageNodeId, "props.elevationDeg", camera.elevationDeg, false)
    );
  },

  /**
   * Anexa um ponto que já existe a um objeto, ou o solta ([ADR-016](../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
   *
   * Dono e coordenadas mudam **juntos**, porque mudar um sem o outro deixa o
   * documento momentaneamente mentindo: o mesmo triplo lido como metros de palco e
   * como fração do vão do modelo são dois lugares diferentes, e o frame que cair
   * entre os dois comandos desenha o ponto no segundo. São quatro comandos no
   * histórico, como no resto desta camada, mas quem chama já traz o ponto
   * convertido para o espaço de destino.
   */
  attachStudioPoi(
    nodeId: string,
    ownerId: string,
    point: readonly [number, number, number],
  ): boolean {
    return (
      this.setPropertyValue(nodeId, "props.ownerId", ownerId, false) &&
      this.setPropertyValue(nodeId, "props.pointX", point[0], false) &&
      this.setPropertyValue(nodeId, "props.pointY", point[1], false) &&
      this.setPropertyValue(nodeId, "props.pointZ", point[2], false)
    );
  },

  /**
   * Grava o roteiro do palco compilado nas props de câmera do `studio.stage`.
   *
   * `keyframe.replace-all` por prop, e não `keyframe.set` por keyframe: o roteiro
   * **substitui** a animação de câmera, e é assim que a consequência declarada no
   * ADR-015 fica visível em vez de virar surpresa — recompilar apaga a curva que
   * alguém tenha ajustado à mão. Acrescentar keyframes em cima dos antigos daria
   * o pior dos dois mundos: uma trilha com paradas de dois roteiros diferentes,
   * que ninguém consegue ler nem desfazer com sentido.
   *
   * Cada prop é um comando, então `Ctrl+Z` volta uma prop por vez. Agrupar num
   * comando composto é o mesmo assunto pendente do `addGeoFeature`.
   */
  writeStudioTour(
    stageNodeId: string,
    writes: readonly {
      readonly path: string;
      readonly keyframes: readonly unknown[];
      /**
       * Rótulo amarrado a uma parada; ausente, é o próprio palco.
       *
       * O roteiro deixou de escrever só a câmera: um `label.callout` com
       * `props.stopId` preenchido ganha a entrada e a saída compiladas junto,
       * com a guia crescendo da bolinha até a caixa na chegada.
       */
      readonly nodeId?: string;
    }[],
  ): boolean {
    let ok = true;
    // Agrupado por nó para preservar a semântica do `writeKeyframeTracks`: ele
    // troca as trilhas de UM nó, e passar o palco com writes de outro faria a
    // trilha do rótulo aterrissar na câmera.
    const byNode = new Map<string, { path: string; keyframes: readonly unknown[] }[]>();
    for (const write of writes) {
      const target = write.nodeId ?? stageNodeId;
      const list = byNode.get(target) ?? [];
      list.push({ path: write.path, keyframes: write.keyframes });
      byNode.set(target, list);
    }
    for (const [nodeId, list] of byNode) ok = this.writeKeyframeTracks(nodeId, list) && ok;
    return ok;
  },

  /**
   * Substitui as trilhas de keyframe de um nó, uma prop por vez.
   *
   * É a operação genérica por trás de `writeStudioTour` e da revelação da anotação: um
   * `keyframe.replace-all` por caminho, para **qualquer** nó. O nome do método do roteiro
   * ficou porque o chamador dele fala de roteiro; quem precisa da operação crua chama
   * esta, sem herdar um nome que mente sobre o escopo.
   */
  writeKeyframeTracks(
    nodeId: string,
    writes: readonly { readonly path: string; readonly keyframes: readonly unknown[] }[],
  ): boolean {
    let ok = true;
    for (const write of writes) {
      ok =
        this.dispatch({
          type: "keyframe.replace-all",
          payload: {
            ...propertyLocation(nodeId, write.path),
            keyframes: [...write.keyframes],
          },
          source: "user",
        }) && ok;
    }
    return ok;
  },

  /**
   * Cria uma anotação apontando para um nó — o ponto do palco, tipicamente.
   *
   * O alvo é gravado em `props.targetId`, que é onde `label.callout` já procura desde o
   * 7E.2. O que mudou para isto funcionar num POI foi do outro lado: o passe de projeção
   * do palco passou a pôr os pontos no layout, e o rótulo os encontra sem uma linha nova.
   */
  addCalloutFor(targetId: string, text: string): string | null {
    const nodeId = this.addNodeOfType("label.callout");
    if (nodeId === null) return null;
    this.renameNode(nodeId, text);
    const written =
      this.setPropertyValue(nodeId, "props.targetId", targetId, false) &&
      this.setPropertyValue(nodeId, "props.text", text, false);
    return written ? nodeId : null;
  },

  renameNode(nodeId: string, name: string): void {
    this.dispatch({
      type: "node.rename",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        name,
      },
      source: "user",
    });
  },

  deleteNode(nodeId: string): void {
    const ok = this.dispatch({
      type: "node.delete",
      payload: { compositionId: snapshot.selectedCompositionId, nodeId },
      source: "user",
    });
    if (ok && snapshot.selectedNodeIds.includes(nodeId)) {
      const selectedNodeIds = snapshot.selectedNodeIds.filter(
        (selectedId) => selectedId !== nodeId,
      );
      update({
        selectedNodeId: selectedNodeIds.at(-1) ?? null,
        selectedNodeIds: Object.freeze(selectedNodeIds),
      });
    }
  },

  reparentNode(nodeId: string, parentId: string): void {
    this.dispatch({
      type: "node.reparent",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        parentId,
      },
      source: "user",
    });
  },

  deleteSelection(): void {
    const composition = selectedComposition();
    if (composition === undefined) return;
    const roots = selectedRootIds(composition.nodes, snapshot.selectedNodeIds).filter(
      (nodeId) => nodeId !== composition.root,
    );
    if (roots.length === 0) return;
    const deleted = runTransaction(
      roots.length === 1 ? "Excluir nó" : `Excluir ${roots.length} nós`,
      () => {
        for (const nodeId of roots) {
          commandBus.dispatch({
            type: "node.delete",
            payload: { compositionId: composition.id, nodeId },
            source: "user",
          });
        }
      },
    );
    if (deleted) this.clearSelection();
  },

  copySelection(): boolean {
    const composition = selectedComposition();
    if (composition === undefined) return false;
    const roots = selectedRootIds(composition.nodes, snapshot.selectedNodeIds).filter(
      (nodeId) => nodeId !== composition.root,
    );
    if (roots.length === 0) return false;
    const copied: Record<string, Node> = {};
    for (const rootId of roots) {
      for (const nodeId of subtreeIds(composition.nodes, rootId)) {
        const node = composition.nodes[nodeId];
        if (node !== undefined) copied[nodeId] = structuredClone(node);
      }
    }
    nodeClipboard = Object.freeze({
      roots: Object.freeze(roots),
      nodes: Object.freeze(copied),
    });
    update({
      status: roots.length === 1 ? "Nó copiado" : `${roots.length} nós copiados`,
      error: null,
    });
    return true;
  },

  pasteNodes(parentId?: string): readonly string[] {
    const composition = selectedComposition();
    if (composition === undefined || nodeClipboard === null) return [];
    const selectedParent =
      parentId === undefined && snapshot.selectedNodeId !== null
        ? composition.nodes[snapshot.selectedNodeId]
        : undefined;
    const targetParentId =
      parentId ??
      (selectedParent !== undefined && supportsChildren(selectedParent.type)
        ? selectedParent.id
        : composition.root);
    if (composition.nodes[targetParentId] === undefined) return [];

    const idMap = new Map<string, string>();
    for (const oldId of Object.keys(nodeClipboard.nodes)) idMap.set(oldId, ids("nd"));
    const ordered = nodeClipboard.roots.flatMap((rootId) =>
      subtreeIds(nodeClipboard?.nodes ?? {}, rootId),
    );
    const pastedRoots = nodeClipboard.roots
      .map((rootId) => idMap.get(rootId))
      .filter((nodeId): nodeId is string => nodeId !== undefined);
    const rootSet = new Set(nodeClipboard.roots);

    const pasted = runTransaction(
      pastedRoots.length === 1 ? "Colar nó" : `Colar ${pastedRoots.length} nós`,
      () => {
        for (const oldId of ordered) {
          const source = nodeClipboard?.nodes[oldId];
          const nodeId = idMap.get(oldId);
          if (source === undefined || nodeId === undefined) continue;
          const mappedParent =
            rootSet.has(oldId) || source.parent === null
              ? targetParentId
              : (idMap.get(source.parent) ?? targetParentId);
          const node: Node = {
            ...structuredClone(source),
            id: nodeId,
            name: rootSet.has(oldId) ? `${source.name} cópia` : source.name,
            parent: mappedParent,
            children: [],
          };
          commandBus.dispatch({
            type: "node.create",
            payload: { compositionId: composition.id, parentId: mappedParent, node },
            source: "user",
          });
        }
      },
    );
    if (!pasted) return [];
    this.selectNodes(composition.id, pastedRoots);
    return pastedRoots;
  },

  duplicateSelection(): readonly string[] {
    const composition = selectedComposition();
    if (composition === undefined) return [];
    const roots = selectedRootIds(composition.nodes, snapshot.selectedNodeIds);
    const first = roots[0] === undefined ? undefined : composition.nodes[roots[0]];
    const commonParent =
      first !== undefined &&
      roots.every((nodeId) => composition.nodes[nodeId]?.parent === first.parent)
        ? (first.parent ?? composition.root)
        : composition.root;
    return this.copySelection() ? this.pasteNodes(commonParent) : [];
  },

  groupSelection(): string | null {
    const composition = selectedComposition();
    if (composition === undefined) return null;
    const roots = selectedRootIds(composition.nodes, snapshot.selectedNodeIds).filter(
      (nodeId) => nodeId !== composition.root,
    );
    if (roots.length === 0) return null;
    const first = composition.nodes[roots[0] as string];
    const commonParent =
      first !== undefined &&
      roots.every((nodeId) => composition.nodes[nodeId]?.parent === first.parent)
        ? (first.parent ?? composition.root)
        : composition.root;
    const nodeId = ids("nd");
    const groupDefinition = nodeTypeRegistry.get("group");
    if (groupDefinition === undefined) return null;
    const group = createNodeFromDefinition(
      composition.nodes[composition.root],
      groupDefinition,
      nodeId,
      commonParent,
      composition,
    );
    group.name = "Grupo";
    const grouped = runTransaction("Agrupar nós", () => {
      commandBus.dispatch({
        type: "node.create",
        payload: {
          compositionId: composition.id,
          parentId: commonParent,
          node: group,
        },
        source: "user",
      });
      for (const childId of roots) {
        commandBus.dispatch({
          type: "node.reparent",
          payload: { compositionId: composition.id, nodeId: childId, parentId: nodeId },
          source: "user",
        });
      }
    });
    if (!grouped) return null;
    this.selectNodes(composition.id, [nodeId]);
    return nodeId;
  },

  ungroupSelection(): void {
    const composition = selectedComposition();
    if (composition === undefined) return;
    const groups = selectedRootIds(composition.nodes, snapshot.selectedNodeIds)
      .map((nodeId) => composition.nodes[nodeId])
      .filter(
        (node): node is Node =>
          node !== undefined &&
          node.id !== composition.root &&
          (node.type === "group" || node.type === "folder") &&
          node.parent !== null,
      );
    if (groups.length === 0) return;
    const nextSelection = groups.flatMap((group) => group.children);
    const ungrouped = runTransaction("Desagrupar nós", () => {
      for (const group of groups) {
        const parentId = group.parent;
        if (parentId === null) continue;
        const parent = composition.nodes[parentId];
        const insertion = parent?.children.indexOf(group.id) ?? -1;
        group.children.forEach((childId, index) => {
          commandBus.dispatch({
            type: "node.reparent",
            payload: {
              compositionId: composition.id,
              nodeId: childId,
              parentId,
              ...(insertion < 0 ? {} : { index: insertion + index }),
            },
            source: "user",
          });
        });
        commandBus.dispatch({
          type: "node.delete",
          payload: { compositionId: composition.id, nodeId: group.id },
          source: "user",
        });
      }
    });
    if (ungrouped) this.selectNodes(composition.id, nextSelection);
  },

  async newProject(): Promise<void> {
    if (!confirmDiscard()) return;
    const document = createEmptyProjectDocument({
      id: ids("prj"),
      compositionId: ids("cmp"),
      rootNodeId: ids("nd"),
    });
    await replaceProject(document, null, "Projeto novo", false);
  },

  async openProject(): Promise<void> {
    if (!confirmDiscard()) return;
    update({ status: "Abrindo…", error: null });
    try {
      const opened = await bridge.project.open();
      if (opened.status === "cancelled") {
        update({ status: "Abertura cancelada" });
        return;
      }
      const parsed = parseProjectContainer(opened.bytes);
      if (!parsed.ok) {
        update({ status: "Falha ao abrir", error: parsed.error.message });
        return;
      }
      await replaceProject(
        parsed.value.document,
        opened.file,
        "Projeto aberto",
        false,
        containerExtrasFromOpenedProject(parsed.value),
      );
    } catch (error: unknown) {
      update({ status: "Falha ao abrir", error: describeError(error) });
    }
  },

  async openExample(exampleId: string): Promise<void> {
    if (!confirmDiscard()) return;
    update({ status: "Abrindo exemplo…", error: null });
    try {
      const opened = await bridge.project.openExample(exampleId);
      if (opened.status === "cancelled") return;
      const parsed = parseProjectContainer(opened.bytes);
      if (!parsed.ok) {
        update({ status: "Falha ao abrir exemplo", error: parsed.error.message });
        return;
      }
      await replaceProject(
        parsed.value.document,
        opened.file,
        "Exemplo aberto · Salvar criará uma cópia",
        false,
        containerExtrasFromOpenedProject(parsed.value),
      );
    } catch (error: unknown) {
      update({ status: "Falha ao abrir exemplo", error: describeError(error) });
    }
  },

  async saveProject(saveAs = false): Promise<void> {
    update({ status: "Salvando…", error: null });
    const documentToSave = documentStore.get();
    const revisionToSave = snapshot.revision;
    const generationToSave = projectGeneration;
    const fileToSave = snapshot.file;
    const extrasToSave = containerExtras;
    const encoded = serializeProjectContainer({
      ...referencedContainerExtras(documentToSave, extrasToSave),
      document: documentToSave,
    });
    if (!encoded.ok) {
      update({ status: "Falha ao salvar", error: encoded.error.message });
      return;
    }

    try {
      const request = {
        file: fileToSave,
        suggestedName: documentToSave.name,
        bytes: encoded.value,
      };
      const saved = saveAs
        ? await bridge.project.saveAs(request)
        : await bridge.project.save(request);
      if (saved.status === "cancelled") {
        update({ status: "Salvamento cancelado" });
        return;
      }
      // O diálogo nativo pode ficar aberto enquanto outro comando troca o
      // projeto. O arquivo antigo foi salvo, mas não pertence ao novo documento.
      if (projectGeneration !== generationToSave) return;

      const unchanged =
        snapshot.revision === revisionToSave && documentStore.get() === documentToSave;
      update({
        file: saved.file,
        dirty: !unchanged,
        status: unchanged ? "Salvo" : "Salvo; há alterações posteriores",
        error: null,
      });
      await startAutosave(saved.file.path, !unchanged);
      await updateWindowTitle();
    } catch (error: unknown) {
      update({ status: "Falha ao salvar", error: describeError(error) });
    }
  },

  async recover(candidate: RecoveryCandidateInfo): Promise<void> {
    update({ status: "Recuperando…", error: null });
    const recovered = await bridge.recovery.recover(candidate.projectId);
    if (!recovered.ok) {
      update({ status: "Falha na recuperação", error: recovered.message });
      return;
    }
    const parsed = safeParseProjectDocument(recovered.document);
    if (!parsed.success) {
      update({ status: "Falha na recuperação", error: parsed.error.message });
      return;
    }
    let recoveredExtras = EMPTY_CONTAINER_EXTRAS;
    if (recovered.container !== null) {
      const container = parseProjectContainer(recovered.container);
      if (!container.ok) {
        update({ status: "Falha na recuperação", error: container.error.message });
        return;
      }
      if (container.value.document.id !== parsed.data.id) {
        update({
          status: "Falha na recuperação",
          error: "O container-base pertence a outro projeto.",
        });
        return;
      }
      recoveredExtras = containerExtrasFromOpenedProject(container.value);
    }
    await replaceProject(parsed.data, null, "Projeto recuperado", true, recoveredExtras);
  },

  async discardRecovery(candidate: RecoveryCandidateInfo): Promise<void> {
    const discarded = await bridge.recovery.discard(candidate.projectId);
    if (!discarded.ok) {
      update({ error: discarded.message, status: "Falha ao descartar recuperação" });
      return;
    }
    update({ recoveryCandidate: null, ready: true, status: "Recuperação descartada" });
    await startAutosave(null, snapshot.dirty);
  },

  /**
   * Cria um caminho no projeto (não na composição: a mesma rota serve a várias
   * cenas). Devolve o id para quem precisa atribuí-lo em seguida.
   */
  createPath(input: {
    readonly name: string;
    readonly space: PathData["space"];
    readonly vertices: readonly PathVertex[];
    readonly interpolation?: PathData["interpolation"];
    readonly closed?: boolean;
    readonly geodesic?: boolean;
  }): string | null {
    const pathId = ids("pth");
    const ok = this.dispatch({
      type: "path.create",
      payload: {
        path: {
          id: pathId,
          name: input.name,
          space: input.space,
          vertices: input.vertices.map((vertex) => ({ ...vertex })),
          closed: input.closed ?? false,
          interpolation: input.interpolation ?? "bezier",
          geodesic: input.geodesic ?? false,
        },
      },
      source: "user",
    });
    return ok ? pathId : null;
  },

  setPathVertices(pathId: string, vertices: readonly PathVertex[]): boolean {
    return this.dispatch({
      type: "path.set-vertices",
      payload: { pathId, vertices: vertices.map((vertex) => ({ ...vertex })) },
      source: "user",
    });
  },

  setPathFlags(
    pathId: string,
    flags: {
      readonly closed?: boolean;
      readonly interpolation?: PathData["interpolation"];
      readonly geodesic?: boolean;
    },
  ): boolean {
    return this.dispatch({ type: "path.set-flags", payload: { pathId, flags }, source: "user" });
  },

  renamePath(pathId: string, name: string): boolean {
    return this.dispatch({ type: "path.rename", payload: { pathId, name }, source: "user" });
  },

  /**
   * Falha de propósito enquanto algum comportamento apontar para o caminho: o
   * documento não admite `pathId` pendurado.
   */
  deletePath(pathId: string): boolean {
    return this.dispatch({ type: "path.delete", payload: { pathId }, source: "user" });
  },

  /**
   * Bloco 7A — Biblioteca de ativos. O descriptor entra no documento por
   * comando (undo exato); os bytes vivem fora do histórico, em
   * `containerExtras`, e seguem para dentro do `.theatrum` no próximo save.
   * Textura GPU e thumbnail sobem pelo `asset-media` (cache de runtime).
   */
  async importAssetFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    let imported = 0;
    let skipped = 0;
    for (const file of files) {
      const kind = assetKindForFile(file.name, file.type);
      const extension = extensionForFileName(file.name);
      if (kind === null || extension === null) {
        skipped += 1;
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const embedded = createEmbeddedAsset(bytes, extension);
      if (!embedded.ok) {
        update({ status: "Falha ao importar", error: embedded.error.message });
        continue;
      }
      // O src é o hash do conteúdo: importar o mesmo arquivo duas vezes é no-op.
      if (snapshot.document.assets.some((asset) => asset.src === embedded.value.path)) {
        skipped += 1;
        continue;
      }
      const bitmap = kind === "model" ? null : await createTextureBitmap(bytes, kind);
      const descriptor = buildAssetDescriptor({
        id: ids("ast"),
        kind,
        src: embedded.value.path,
        name: baseNameFromFileName(file.name),
        mime: file.type || "application/octet-stream",
        byteSize: bytes.byteLength,
        ...(bitmap === null ? {} : { width: bitmap.width, height: bitmap.height }),
      });
      const ok = this.dispatch({
        type: "asset.add",
        payload: { asset: descriptor },
        source: "user",
      });
      if (!ok) continue;
      containerExtras = {
        ...containerExtras,
        assets: [...(containerExtras.assets ?? []), embedded.value],
      };
      await registerAssetMedia(embedded.value.path, bytes, kind, bitmap);
      imported += 1;
    }
    update({
      status:
        imported === 0
          ? "Nenhum asset novo (já importado ou não suportado)"
          : `${imported} asset${imported > 1 ? "s" : ""} importado${imported > 1 ? "s" : ""}${
              skipped > 0 ? ` · ${skipped} ignorado${skipped > 1 ? "s" : ""}` : ""
            }`,
      error: null,
    });
  },

  assetUsages(assetId: string): readonly AssetReference[] {
    const asset = snapshot.document.assets.find((entry) => entry.id === assetId);
    return asset === undefined ? [] : findAssetReferences(snapshot.document, asset.src);
  },

  removeAsset(assetId: string): boolean {
    const asset = snapshot.document.assets.find((entry) => entry.id === assetId);
    if (asset === undefined) return false;
    const ok = this.dispatch({ type: "asset.remove", payload: { assetId }, source: "user" });
    if (!ok) return false;
    containerExtras = {
      ...containerExtras,
      assets: (containerExtras.assets ?? []).filter((entry) => entry.path !== asset.src),
    };
    unregisterAssetMedia(asset.src);
    return true;
  },

  renameAsset(assetId: string, name: string): void {
    this.dispatch({ type: "asset.rename", payload: { assetId, name }, source: "user" });
  },

  setAssetTags(assetId: string, tags: readonly string[]): void {
    this.dispatch({
      type: "asset.set-tags",
      payload: { assetId, tags: [...tags] },
      source: "user",
    });
  },

  /**
   * Cria um nó `image`/`svg`/`model3d` com o asset aplicado, na composição
   * selecionada. Imagem/SVG ajustam o tamanho às dimensões reais (teto de
   * 480 px); modelos entram com a escala visual padrão do tipo (30 km).
   */
  applyAsset(assetId: string): string | null {
    const asset = snapshot.document.assets.find((entry) => entry.id === assetId);
    const composition =
      snapshot.document.compositions.find((item) => item.id === snapshot.selectedCompositionId) ??
      snapshot.document.compositions[0];
    if (asset === undefined || composition === undefined) return null;
    const type = asset.kind === "svg" ? "svg" : asset.kind === "model" ? "model3d" : "image";
    const definition = nodeTypeRegistry.get(type);
    const root = composition.nodes[composition.root];
    if (definition === undefined || root === undefined) return null;

    const nodeId = ids("nd");
    const node = createNodeFromDefinition(root, definition, nodeId, root.id, composition);
    node.name = assetDisplayName(asset);
    node.props["assetId"] = { value: asset.src, keyframes: [], expression: null };
    const dimensions = assetDimensions(asset);
    if (dimensions !== null) node.size = { mode: "screen", size: fitWithin(dimensions, 480) };

    const ok = this.dispatch({
      type: "node.create",
      payload: { compositionId: composition.id, parentId: root.id, node },
      source: "user",
    });
    if (ok) {
      update({ selectedNodeId: nodeId, selectedNodeIds: Object.freeze([nodeId]) });
    }
    return ok ? nodeId : null;
  },

  addBehavior(nodeId: string, type: string, params: Record<string, unknown>): string | null {
    const behaviorId = ids("bhv");
    const ok = this.dispatch({
      type: "behavior.add",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        behavior: { id: behaviorId, type, enabled: true, params },
      },
      source: "user",
    });
    return ok ? behaviorId : null;
  },

  /**
   * Atribui um caminho a um nó com `progress` já animado de 0 a 1 no intervalo
   * de tempo do nó — o estado útil por padrão, em vez de um comportamento inerte
   * que exige dois keyframes manuais antes de mostrar qualquer coisa.
   */
  assignMotionPath(
    nodeId: string,
    pathId: string,
    options: { readonly from?: number; readonly to?: number; readonly autoOrient?: boolean } = {},
  ): string | null {
    const composition = selectedComposition();
    const node = composition?.nodes[nodeId];
    if (composition === undefined || node === undefined) return null;
    const from = options.from ?? node.timeRange.in;
    const to = options.to ?? Math.max(from + 1, node.timeRange.out);
    return this.addBehavior(nodeId, "motion-path", {
      pathId,
      progress: {
        value: 0,
        keyframes: [
          { id: ids("kf"), frame: from, value: 0, in: { kind: "linear" }, out: { kind: "linear" } },
          { id: ids("kf"), frame: to, value: 1, in: { kind: "linear" }, out: { kind: "linear" } },
        ],
        expression: null,
      },
      autoOrient: options.autoOrient ?? true,
      orientOffset: 0,
      banking: 0,
      offset: [0, 0],
      loop: false,
    });
  },

  setBehaviorParams(nodeId: string, behaviorId: string, params: Record<string, unknown>): boolean {
    return this.dispatch({
      type: "behavior.set-params",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        behaviorId,
        params,
      },
      source: "user",
    });
  },

  setBehaviorEnabled(nodeId: string, behaviorId: string, enabled: boolean): boolean {
    return this.dispatch({
      type: "behavior.set-enabled",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        behaviorId,
        enabled,
      },
      source: "user",
    });
  },

  removeBehavior(nodeId: string, behaviorId: string): boolean {
    return this.dispatch({
      type: "behavior.remove",
      payload: { compositionId: snapshot.selectedCompositionId, nodeId, behaviorId },
      source: "user",
    });
  },

  addAction(nodeId: string, type: string, params: Record<string, unknown>): string | null {
    if (!actionTemplateRegistry.has(type)) return null;
    const actionId = ids("act");
    const ok = this.dispatch({
      type: "action.add",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        action: {
          id: actionId,
          type,
          enabled: true,
          mode: "live",
          startFrame: snapshot.playheadFrame,
          params,
        },
      },
      source: "user",
    });
    return ok ? actionId : null;
  },

  setActionParams(nodeId: string, actionId: string, params: Record<string, unknown>): boolean {
    return this.dispatch({
      type: "action.set-params",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        actionId,
        params,
      },
      source: "user",
    });
  },

  setActionEnabled(nodeId: string, actionId: string, enabled: boolean): boolean {
    return this.dispatch({
      type: "action.set-enabled",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        actionId,
        enabled,
      },
      source: "user",
    });
  },

  removeAction(nodeId: string, actionId: string): boolean {
    return this.dispatch({
      type: "action.remove",
      payload: { compositionId: snapshot.selectedCompositionId, nodeId, actionId },
      source: "user",
    });
  },

  /**
   * Materializa a expansão live como uma única entrada de histórico.
   *
   * Cada comando dentro da transação continua validado. O último remove a
   * Action; Ctrl+Z restaura a Action e retira nós/comportamentos/keyframes de
   * uma vez, sem estado intermediário visível.
   */
  bakeAction(nodeId: string, actionId: string): boolean {
    const document = documentStore.get();
    const composition = selectedComposition();
    const owner = composition?.nodes[nodeId];
    const action = owner?.actions.find((entry) => entry.id === actionId);
    if (composition === undefined || owner === undefined || action === undefined) return false;
    const resolution = actionTemplateRegistry.resolve(action, owner, composition, document);
    if (resolution.status !== "expanded") {
      const message =
        resolution.status === "invalid-params"
          ? resolution.message
          : resolution.status === "unknown-type"
            ? `Ação não registrada: ${resolution.type}.`
            : "A ação não está disponível para conversão.";
      update({ error: message, status: "Não foi possível converter a ação" });
      return false;
    }
    const expansion = resolution.expansion;
    const blocking = expansion.diagnostics[0];
    if (blocking !== undefined) {
      update({ error: blocking.message, status: "Não foi possível converter a ação" });
      return false;
    }

    return runTransaction(`Converter ${action.type} em keyframes`, () => {
      for (const placement of expansion.behaviors) {
        commandBus.dispatch({
          type: "behavior.add",
          payload: {
            compositionId: composition.id,
            nodeId: placement.nodeId,
            behavior: placement.behavior,
          },
          source: "user",
        });
      }
      for (const node of expansion.nodes) {
        commandBus.dispatch({
          type: "node.create",
          payload: {
            compositionId: composition.id,
            parentId: node.parent ?? composition.root,
            node,
          },
          source: "user",
        });
      }
      for (const write of expansion.keyframes) {
        commandBus.dispatch({
          type: "keyframe.set",
          payload: {
            compositionId: composition.id,
            target: write.target,
            path: [...write.path],
            keyframe: write.keyframe,
          },
          source: "user",
        });
      }
      commandBus.dispatch({
        type: "action.remove",
        payload: { compositionId: composition.id, nodeId, actionId },
        source: "user",
      });
    });
  },

  addEffect(nodeId: string, type: string, params: Record<string, unknown>): string | null {
    const effectId = ids("fx");
    const ok = this.dispatch({
      type: "effect.add",
      payload: {
        compositionId: snapshot.selectedCompositionId,
        nodeId,
        effect: { id: effectId, type, enabled: true, params },
      },
      source: "user",
    });
    return ok ? effectId : null;
  },

  setEffectParams(nodeId: string, effectId: string, params: Record<string, unknown>): boolean {
    return this.dispatch({
      type: "effect.set-params",
      payload: { compositionId: snapshot.selectedCompositionId, nodeId, effectId, params },
      source: "user",
    });
  },

  setEffectEnabled(nodeId: string, effectId: string, enabled: boolean): boolean {
    return this.dispatch({
      type: "effect.set-enabled",
      payload: { compositionId: snapshot.selectedCompositionId, nodeId, effectId, enabled },
      source: "user",
    });
  },

  removeEffect(nodeId: string, effectId: string): boolean {
    return this.dispatch({
      type: "effect.remove",
      payload: { compositionId: snapshot.selectedCompositionId, nodeId, effectId },
      source: "user",
    });
  },

  handleMenu(action: MenuAction): void {
    if (action === "project:new") void this.newProject();
    else if (action === "project:open") void this.openProject();
    else if (action === "project:save") void this.saveProject();
    else if (action === "project:save-as") void this.saveProject(true);
    else if (action === "history:undo") this.undo();
    else if (action === "history:redo") this.redo();
  },

  clearError(): void {
    update({ error: null });
  },
});

documentStore.subscribe(() => {
  const document = documentStore.get();
  const selectedComposition =
    document.compositions.find((item) => item.id === snapshot.selectedCompositionId) ??
    document.compositions[0];
  const selectedNodeId =
    snapshot.selectedNodeId !== null &&
    selectedComposition?.nodes[snapshot.selectedNodeId] !== undefined
      ? snapshot.selectedNodeId
      : null;
  const selectedNodeIds = snapshot.selectedNodeIds.filter(
    (nodeId) => selectedComposition?.nodes[nodeId] !== undefined,
  );
  snapshot = Object.freeze({
    ...snapshot,
    document,
    revision: snapshot.revision + 1,
    dirty: suppressDocumentEffects ? snapshot.dirty : true,
    selectedCompositionId: selectedComposition?.id ?? "",
    selectedNodeId:
      selectedNodeId !== null && selectedNodeIds.includes(selectedNodeId)
        ? selectedNodeId
        : (selectedNodeIds.at(-1) ?? null),
    selectedNodeIds: Object.freeze(selectedNodeIds),
  });
  notify();
  if (!suppressDocumentEffects) scheduleAutosave();
});

commandBus.history.subscribe((history) => {
  update({ history });
});

async function initialize(): Promise<void> {
  const result = await bridge.recovery.candidates();
  if (!result.ok) {
    update({ ready: true, error: result.message, status: "Recuperação indisponível" });
    await startAutosave(null);
    return;
  }
  const candidate = result.candidates[0] ?? null;
  update({
    ready: true,
    recoveryCandidate: candidate,
    status: candidate === null ? "Pronto" : "Recuperação disponível",
  });
  if (candidate === null) await startAutosave(null);
  startHeartbeat();
  await updateWindowTitle();
}

async function replaceProject(
  document: ProjectDocument,
  file: ProjectFileReference | null,
  status: string,
  dirty: boolean,
  extras: ContainerExtras = EMPTY_CONTAINER_EXTRAS,
): Promise<void> {
  pausePlayback();
  suppressDocumentEffects = true;
  try {
    documentStore.replace(document);
    commandBus.history.clear();
  } finally {
    suppressDocumentEffects = false;
  }
  projectGeneration += 1;
  containerExtras = extras;
  // Biblioteca (7A): sobe thumbnails e texturas GPU dos assets embutidos.
  resetAssetMedia();
  const mediaRegistrations: Promise<void>[] = [];
  for (const embedded of extras.assets ?? []) {
    const descriptor = document.assets.find((asset) => asset.src === embedded.path);
    if (descriptor === undefined) continue;
    mediaRegistrations.push(registerAssetMedia(embedded.path, embedded.bytes, descriptor.kind));
  }
  // A última textura que sobe força uma notificação para a cena re-renderizar.
  if (mediaRegistrations.length > 0) {
    void Promise.allSettled(mediaRegistrations).then(() => update({}));
  }
  update({
    document: documentStore.get(),
    dirty,
    file,
    status,
    error: null,
    selectedCompositionId: document.compositions[0]?.id ?? "",
    selectedNodeId: null,
    selectedNodeIds: Object.freeze([]),
    playheadFrame: 0,
    recoveryCandidate: null,
  });
  await startAutosave(file?.path ?? null, dirty);
  await updateWindowTitle();
}

async function startAutosave(projectPath: string | null, markDirty = false): Promise<void> {
  autosaveReady = false;
  pendingCommands = 0;
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const baseRevision = snapshot.revision;
  const baseDocument = documentStore.get();
  const recoveryContainer = serializeRecoveryContainer(baseDocument);
  if (typeof recoveryContainer === "string") {
    update({ error: recoveryContainer, status: "Autosave indisponível" });
    return;
  }
  const result = await bridge.recovery.start({
    document: baseDocument,
    projectPath,
    ...(recoveryContainer === undefined ? {} : { container: recoveryContainer }),
  });
  autosaveReady = result.ok;
  if (!result.ok) {
    update({ error: result.message, status: "Autosave indisponível" });
    return;
  }

  // A base pode representar dados ainda não salvos (recuperação ou edição feita
  // enquanto Save estava em voo). Um record imediato marca a sessão como suja
  // mesmo quando o diff é vazio e também cobre comandos ocorridos durante o IPC.
  if (markDirty || snapshot.revision !== baseRevision) {
    const recorded = await bridge.recovery.record({
      document: documentStore.get(),
      commands: 1,
      force: true,
    });
    if (!recorded.ok) update({ error: recorded.message, status: "Falha no autosave" });
  }
}

function scheduleAutosave(): void {
  if (!autosaveReady) return;
  pendingCommands += 1;
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    const commands = pendingCommands;
    pendingCommands = 0;
    void bridge.recovery
      .record({ document: documentStore.get(), commands, force: true })
      .then((result) => {
        if (!result.ok) update({ error: result.message, status: "Falha no autosave" });
      });
  }, AUTOSAVE_DEBOUNCE_MS);
}

function startHeartbeat(): void {
  if (heartbeatTimer !== null) return;
  heartbeatTimer = window.setInterval(() => {
    void bridge.recovery.heartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

function historySnapshot(): HistorySnapshot {
  return Object.freeze({
    entries: commandBus.history.entries(),
    cursor: commandBus.history.cursor(),
    canUndo: commandBus.history.canUndo(),
    canRedo: commandBus.history.canRedo(),
  });
}

function selectedComposition() {
  return documentStore
    .get()
    .compositions.find((composition) => composition.id === snapshot.selectedCompositionId);
}

function runTransaction(label: string, callback: () => void): boolean {
  const result = commandBus.transaction(label, callback);
  if (!result.ok) {
    update({ error: result.error.message, status: "Comando rejeitado" });
    return false;
  }
  update({ error: null, status: label });
  return true;
}

function selectedRootIds(
  nodes: Readonly<Record<string, Node>>,
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds);
  return selectedIds.filter((nodeId) => {
    let parentId = nodes[nodeId]?.parent ?? null;
    while (parentId !== null) {
      if (selected.has(parentId)) return false;
      parentId = nodes[parentId]?.parent ?? null;
    }
    return nodes[nodeId] !== undefined;
  });
}

function subtreeIds(nodes: Readonly<Record<string, Node>>, rootId: string): string[] {
  const result: string[] = [];
  const pending = [rootId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodes[nodeId];
    if (node === undefined) continue;
    result.push(nodeId);
    pending.push(...[...node.children].reverse());
  }
  return result;
}

function supportsChildren(type: string): boolean {
  return nodeTypeRegistry.get(type)?.supportsChildren ?? false;
}

function selectedEditableProperty(
  nodeId: string,
  path: string,
): ResolvedNodeAnimatableProperty | undefined {
  const node = selectedComposition()?.nodes[nodeId];
  if (node === undefined) return undefined;
  return resolveNodeAnimatableProperty(node, nodeTypeRegistry.get(node.type), path);
}

/**
 * Materializar o wrapper e aplicar a operação seguinte é um único gesto de
 * autoria. A transação garante que um primeiro keyframe nunca deixe para trás
 * uma prop vazia se o segundo comando for rejeitado, e um único undo remove os
 * dois.
 */
function initializePropertyAndDispatch(
  label: string,
  nodeId: string,
  path: string,
  property: AnimatableProperty<unknown>,
  nextCommand: unknown,
): boolean {
  return runTransaction(label, () => {
    const initialized = commandBus.dispatch({
      type: "property.initialize",
      payload: {
        ...propertyLocation(nodeId, path),
        property: structuredClone(property),
      },
      source: "user",
    });
    if (!initialized.ok) return;
    commandBus.dispatch(nextCommand);
  });
}

function propertyLocation(nodeId: string, path: string) {
  return {
    compositionId: snapshot.selectedCompositionId,
    target: { kind: "node" as const, nodeId },
    path: path.split("."),
  };
}

function playbackTick(now: number): void {
  const composition = selectedComposition();
  if (composition === undefined) {
    pausePlayback();
    return;
  }
  const elapsedFrames = ((now - playbackStartedAt) / 1000) * composition.fps;
  const nextFrame = playbackStartFrame + Math.floor(elapsedFrames);
  if (nextFrame >= composition.duration) {
    if (!snapshot.loopPlayback) {
      playbackRequest = null;
      update({
        playheadFrame: composition.duration,
        isPlaying: false,
        status: "Fim da composição",
      });
      return;
    }
    playbackStartFrame = 0;
    playbackStartedAt = now;
    update({ playheadFrame: 0 });
  } else {
    update({ playheadFrame: nextFrame });
  }
  playbackRequest = requestAnimationFrame(playbackTick);
}

function pausePlayback(): void {
  if (playbackRequest !== null) cancelAnimationFrame(playbackRequest);
  playbackRequest = null;
  if (snapshot.isPlaying) update({ isPlaying: false });
}

function createNodeFromDefinition(
  root: Node | undefined,
  definition: NodeTypeDefinition,
  id: string,
  parent: string,
  composition: ProjectDocument["compositions"][number],
): Node {
  if (root === undefined) throw new Error("A composição não possui nó raiz.");
  const anchor =
    definition.defaultAnchorSpace === "geo"
      ? {
          space: "geo" as const,
          lngLat: structuredClone(composition.camera.center.value),
        }
      : definition.defaultAnchorSpace === "parent"
        ? { space: "parent" as const, offset: [0, 0] as [number, number] }
        : {
            space: "comp" as const,
            position: [composition.width / 2, composition.height / 2] as [number, number],
          };
  const size =
    definition.defaultSizeMode === "ground"
      ? { mode: "ground" as const, meters: [1_000, 1_000] as [number, number] }
      : {
          mode: "screen" as const,
          size: defaultNodeSize(definition.type),
        };
  return {
    ...structuredClone(root),
    id,
    type: definition.type,
    name: `${definition.label} ${id.slice(-4)}`,
    parent,
    children: [],
    label: "cyan",
    timeRange: { in: 0, out: composition.duration },
    timeRemap: null,
    anchor,
    size,
    transform: {
      position: animatable([0, 0]),
      rotation: animatable(0),
      scale: animatable([1, 1]),
      opacity: animatable(1),
      anchorPoint: animatable(
        definition.type === "group" || definition.type === "null" ? [0, 0] : [0.5, 0.5],
      ),
      skew: animatable([0, 0]),
      rotationReference: definition.category === "unit" ? "geo-bearing" : "screen",
    },
    props: nodeTypeRegistry.createDefaultProps(definition.type),
    effects: [],
    behaviors: [],
    actions: [],
  };
}

function defaultNodeSize(type: string): [number, number] {
  if (type === "text.title") return [720, 120];
  if (type === "text.label") return [240, 52];
  if (type === "image" || type === "svg") return [320, 180];
  if (type === "shape.line" || type === "shape.polygon") return [120, 100];
  if (type === "group") return [1, 1];
  if (type === "null") return [32, 32];
  return [64, 64];
}

function animatable<T>(value: T) {
  return { value, keyframes: [], expression: null };
}

function confirmDiscard(): boolean {
  return (
    !snapshot.dirty || window.confirm("Há alterações não salvas. Deseja descartá-las e continuar?")
  );
}

async function updateWindowTitle(): Promise<void> {
  const dirtyMark = snapshot.dirty ? " *" : "";
  await bridge.window.setTitle(`${snapshot.document.name}${dirtyMark} — ${APP_NAME}`);
}

function update(patch: Partial<EditorSessionSnapshot>): void {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  notify();
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fitWithin(
  dimensions: { readonly width: number; readonly height: number },
  max: number,
): [number, number] {
  const scale = Math.min(1, max / Math.max(dimensions.width, dimensions.height, 1));
  return [
    Math.max(1, Math.round(dimensions.width * scale)),
    Math.max(1, Math.round(dimensions.height * scale)),
  ];
}

/**
 * Save e autosave só embutem bytes referenciados pelo documento: undo de um
 * import (ou remoção de asset) não deixa bytes órfãos inchando o `.theatrum`.
 */
function referencedContainerExtras(
  document: ProjectDocument,
  extras: ContainerExtras,
): ContainerExtras {
  const embedded = extras.assets;
  if (embedded === undefined || embedded.length === 0) return extras;
  const referenced = new Set(
    document.assets.map((asset) => asset.src).filter((src) => src.startsWith("assets/")),
  );
  const assets = embedded.filter((entry) => referenced.has(entry.path));
  return assets.length === embedded.length ? extras : { ...extras, assets };
}

function containerExtrasFromOpenedProject(project: OpenedProject): ContainerExtras {
  const assets: ContentAddressedAsset[] = [...project.assets].map(([path, bytes]) => ({
    path,
    bytes,
    hash: contentHashFromAssetPath(path),
  }));
  const thumbnails = Object.fromEntries(project.thumbnails);
  return {
    assets,
    thumbnails,
    ...(project.notes === null ? {} : { notes: project.notes }),
    app: { version: project.manifest.app.version },
    timestamps: {
      created: project.manifest.created,
      modified: project.manifest.modified,
    },
  };
}

function serializeRecoveryContainer(document: ProjectDocument): Uint8Array | undefined | string {
  const hasEmbeddedContent =
    (containerExtras.assets?.length ?? 0) > 0 ||
    Object.keys(containerExtras.thumbnails ?? {}).length > 0 ||
    containerExtras.notes !== undefined;
  if (!hasEmbeddedContent) return undefined;

  const serialized = serializeProjectContainer({
    ...referencedContainerExtras(document, containerExtras),
    document,
  });
  return serialized.ok
    ? serialized.value
    : `Não foi possível preparar o container-base do autosave: ${serialized.error.message}`;
}

function contentHashFromAssetPath(path: string): string {
  const match = /^assets\/[0-9a-f]{2}\/([0-9a-f]{64})\./.exec(path);
  if (match?.[1] === undefined) {
    throw new Error(`Caminho de asset validado sem hash de conteúdo: ${path}.`);
  }
  return match[1];
}

declare global {
  interface Window {
    __theatrumPhase3?: {
      readonly getSnapshot: () => EditorSessionSnapshot;
      readonly actions: typeof editorActions;
      readonly commandBus: typeof commandBus;
    };
    /** Superfície de prova do bloco 7A — ver tools/verify-phase7a.mjs. */
    __theatrumPhase7a?: {
      readonly thumbnailUrl: (src: string) => string | null;
      readonly mediaSources: () => readonly string[];
      readonly containerRoundTrip: () => Promise<ContainerRoundTripResult>;
      readonly textureInfo: (
        src: string,
      ) => Promise<{ readonly width: number; readonly height: number } | null>;
    };
  }
}

interface ContainerRoundTripResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly containerBytes?: number;
  readonly descriptors?: number;
  readonly assets?: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
}

/**
 * Serializa o container exatamente como o save (extras filtrados pelos
 * descriptors) e o lê de volta — a prova de "salvar e reabrir preserva o
 * asset" sem diálogo nativo no caminho.
 */
async function containerRoundTrip(): Promise<ContainerRoundTripResult> {
  const document = documentStore.get();
  const encoded = serializeProjectContainer({
    ...referencedContainerExtras(document, containerExtras),
    document,
  });
  if (!encoded.ok) return { ok: false, error: encoded.error.message };
  const parsed = parseProjectContainer(encoded.value);
  if (!parsed.ok) return { ok: false, error: parsed.error.message };
  const assets: NonNullable<ContainerRoundTripResult["assets"]>[number][] = [];
  for (const [path, bytes] of parsed.value.assets) {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    assets.push({ path, bytes: bytes.byteLength, sha256 });
  }
  return {
    ok: true,
    containerBytes: encoded.value.byteLength,
    descriptors: parsed.value.document.assets.length,
    assets,
  };
}

Object.defineProperty(window, "__theatrumPhase3", {
  value: Object.freeze({
    getSnapshot: getEditorSessionSnapshot,
    actions: editorActions,
    commandBus,
  }),
  configurable: true,
});

Object.defineProperty(window, "__theatrumPhase7a", {
  value: Object.freeze({
    thumbnailUrl: assetThumbnailUrl,
    mediaSources: assetMediaSources,
    containerRoundTrip,
    textureInfo: assetTextureInfo,
  }),
  configurable: true,
});
