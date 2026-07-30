import type { Draft } from "@theatrum/document";
import type {
  ActionInstanceData,
  AnimatableProperty,
  AssetDescriptor,
  BehaviorInstanceData,
  Composition,
  EffectInstanceData,
  Keyframe,
  Node,
  PathData,
  ProjectDocument,
} from "@theatrum/schema";
import type { z } from "zod";
import type { CommandDefinition, SerializableCommand } from "./contracts.js";
import { rejectCommand } from "./errors.js";
import { CommandSchemas, type NativeCommand, type NativeCommandType } from "./schemas.js";

type CommandFor<T extends NativeCommandType> = Extract<NativeCommand, { readonly type: T }>;

interface ErasedDefinition extends CommandDefinition<SerializableCommand> {
  readonly type: NativeCommandType;
}

export const NATIVE_COMMAND_DEFINITIONS: readonly ErasedDefinition[] = [
  defineNative("project.rename", "Renomear projeto", (draft, command) => {
    draft.name = command.payload.name;
  }),
  defineNative("project.update-settings", "Alterar configurações do projeto", (draft, command) => {
    Object.assign(draft.settings, command.payload.settings);
  }),
  defineNative("project.replace-document", "Importar Scene Script", (draft, command) => {
    const next = command.payload.document;
    for (const key of Object.keys(draft)) {
      if (!Object.hasOwn(next, key)) Reflect.deleteProperty(draft, key);
    }
    Object.assign(draft, next);
  }),
  defineNative("composition.create", "Criar composição", (draft, command) => {
    insertComposition(draft, command.payload.composition);
  }),
  defineNative("composition.duplicate", "Duplicar composição", (draft, command) => {
    insertComposition(draft, command.payload.composition);
  }),
  defineNative("composition.rename", "Renomear composição", (draft, command) => {
    getComposition(draft, command.payload.compositionId).name = command.payload.name;
  }),
  defineNative("composition.delete", "Excluir composição", (draft, command) => {
    const index = draft.compositions.findIndex(
      (composition) => composition.id === command.payload.compositionId,
    );
    if (index < 0) rejectCommand(`Composição não encontrada: ${command.payload.compositionId}.`);
    draft.compositions.splice(index, 1);
  }),
  defineNative("composition.set-duration", "Alterar duração", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    composition.duration = command.payload.duration;
    composition.workArea[0] = Math.min(composition.workArea[0], command.payload.duration);
    composition.workArea[1] = Math.min(composition.workArea[1], command.payload.duration);
  }),
  defineNative("composition.set-fps", "Alterar taxa de quadros", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    if (command.payload.mode === "remap") {
      remapCompositionFrames(composition, command.payload.fps / composition.fps);
    }
    composition.fps = command.payload.fps;
  }),
  defineNative("composition.set-resolution", "Alterar resolução", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    composition.width = command.payload.width;
    composition.height = command.payload.height;
    if (command.payload.pixelAspect !== undefined) {
      composition.pixelAspect = command.payload.pixelAspect;
    }
  }),
  defineNative("composition.set-work-area", "Alterar área de trabalho", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    if (command.payload.workArea[1] > composition.duration) {
      rejectCommand("A área de trabalho não pode exceder a duração da composição.");
    }
    composition.workArea = [...command.payload.workArea];
  }),
  defineNative("composition.set-background", "Alterar fundo", (draft, command) => {
    getComposition(draft, command.payload.compositionId).background = command.payload.background;
  }),
  defineNative("composition.set-seed", "Alterar semente", (draft, command) => {
    getComposition(draft, command.payload.compositionId).seed = command.payload.seed;
  }),
  defineNative("composition.set-map", "Alterar mapa", (draft, command) => {
    getComposition(draft, command.payload.compositionId).map = command.payload.map;
  }),
  defineNative(
    "composition.set-reference-audio",
    "Alterar áudio de referência",
    (draft, command) => {
      getComposition(draft, command.payload.compositionId)["referenceAudio"] =
        command.payload["referenceAudio"];
    },
  ),
  defineNative("node.create", "Criar nó", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    const parent = getNode(composition, command.payload.parentId);
    if (composition.nodes[command.payload.node.id] !== undefined) {
      rejectCommand(`Já existe um nó com id ${command.payload.node.id}.`);
    }
    if (command.payload.node.children.length > 0) {
      rejectCommand("node.create aceita somente um nó sem filhos.");
    }
    const node = command.payload.node;
    node.parent = parent.id;
    composition.nodes[node.id] = node;
    insertChild(parent.children, node.id, command.payload.index);
  }),
  defineNative("node.rename", "Renomear nó", (draft, command) => {
    getNode(getComposition(draft, command.payload.compositionId), command.payload.nodeId).name =
      command.payload.name;
  }),
  defineNative("node.reparent", "Reparentar nó", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    const node = getNode(composition, command.payload.nodeId);
    const parent = getNode(composition, command.payload.parentId);
    if (node.id === composition.root)
      rejectCommand("A raiz da composição não pode ser reparentada.");
    if (wouldCreateCycle(composition, node.id, parent.id)) {
      rejectCommand(`Mover ${node.id} para ${parent.id} criaria um ciclo.`);
    }
    if (node.parent !== null) removeChild(getNode(composition, node.parent).children, node.id);
    node.parent = parent.id;
    insertChild(parent.children, node.id, command.payload.index);
  }),
  defineNative("node.reorder", "Reordenar nó", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    const node = getNode(composition, command.payload.nodeId);
    if (node.parent === null) rejectCommand("A raiz da composição não pode ser reordenada.");
    const siblings = getNode(composition, node.parent).children;
    removeChild(siblings, node.id);
    insertChild(siblings, node.id, command.payload.index);
  }),
  defineNative("node.delete", "Excluir nó", (draft, command) => {
    const composition = getComposition(draft, command.payload.compositionId);
    const node = getNode(composition, command.payload.nodeId);
    if (node.id === composition.root) rejectCommand("A raiz da composição não pode ser excluída.");
    if (node.parent !== null) removeChild(getNode(composition, node.parent).children, node.id);
    const removedIds = collectSubtreeIds(composition, node.id);
    for (const id of removedIds) delete composition.nodes[id];
    if (composition.camera.follow !== null && removedIds.has(composition.camera.follow.nodeId)) {
      composition.camera.follow = null;
    }
  }),
  defineNative("node.set-flags", "Alterar flags do nó", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    Object.assign(node, command.payload.flags);
  }),
  defineNative("node.set-time-range", "Alterar intervalo do nó", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    node.timeRange = { in: command.payload.in, out: command.payload.out };
  }),
  defineNative("node.set-time-remap", "Alterar remapeamento de tempo", (draft, command) => {
    getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    ).timeRemap = command.payload.timeRemap;
  }),
  defineNative("node.set-anchor", "Alterar âncora", (draft, command) => {
    getNode(getComposition(draft, command.payload.compositionId), command.payload.nodeId).anchor =
      command.payload.anchor;
  }),
  defineNative("node.set-size", "Alterar tamanho", (draft, command) => {
    getNode(getComposition(draft, command.payload.compositionId), command.payload.nodeId).size =
      command.payload.size;
  }),
  defineNative("node.set-blend-mode", "Alterar modo de mesclagem", (draft, command) => {
    getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    ).blendMode = command.payload.blendMode;
  }),
  defineNative("node.set-track-matte", "Alterar recorte por matte", (draft, command) => {
    getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    ).trackMatte = command.payload.trackMatte;
  }),
  defineNative("property.set", "Alterar propriedade", (draft, command) => {
    getProperty(draft, command.payload).value = command.payload.value;
  }),
  defineNative("property.initialize", "Inicializar propriedade", (draft, command) => {
    initializeProperty(draft, command.payload, command.payload.property);
  }),
  defineNative("property.reset", "Redefinir propriedade", (draft, command) => {
    const property = getProperty(draft, command.payload);
    property.value = command.payload.value;
    property.keyframes = [];
    property.expression = null;
  }),
  defineNative("property.set-expression", "Alterar expressão", (draft, command) => {
    getProperty(draft, command.payload).expression = command.payload.expression;
  }),
  defineNative("keyframe.set", "Definir keyframe", (draft, command) => {
    const property = getProperty(draft, command.payload);
    property.keyframes = property.keyframes.filter(
      (keyframe) =>
        keyframe.id !== command.payload.keyframe.id &&
        keyframe.frame !== command.payload.keyframe.frame,
    );
    property.keyframes.push(command.payload.keyframe);
    sortKeyframes(property.keyframes);
  }),
  defineNative("keyframe.remove", "Remover keyframe", (draft, command) => {
    const property = getProperty(draft, command.payload);
    const index = property.keyframes.findIndex(
      (keyframe) => keyframe.id === command.payload.keyframeId,
    );
    if (index < 0) rejectCommand(`Keyframe não encontrado: ${command.payload.keyframeId}.`);
    property.keyframes.splice(index, 1);
  }),
  defineNative("keyframe.move", "Mover keyframe", (draft, command) => {
    const property = getProperty(draft, command.payload);
    const keyframe = property.keyframes.find(
      (candidate) => candidate.id === command.payload.keyframeId,
    );
    if (keyframe === undefined) {
      rejectCommand(`Keyframe não encontrado: ${command.payload.keyframeId}.`);
    }
    property.keyframes = property.keyframes.filter(
      (candidate) =>
        candidate.id === command.payload.keyframeId || candidate.frame !== command.payload.frame,
    );
    keyframe.frame = command.payload.frame;
    sortKeyframes(property.keyframes);
  }),
  defineNative("keyframe.set-easing", "Alterar easing", (draft, command) => {
    const property = getProperty(draft, command.payload);
    const keyframe = property.keyframes.find(
      (candidate) => candidate.id === command.payload.keyframeId,
    );
    if (keyframe === undefined) {
      rejectCommand(`Keyframe não encontrado: ${command.payload.keyframeId}.`);
    }
    if (command.payload.in !== undefined) keyframe.in = command.payload.in;
    if (command.payload.out !== undefined) keyframe.out = command.payload.out;
  }),
  defineNative("keyframe.clear", "Limpar keyframes", (draft, command) => {
    getProperty(draft, command.payload).keyframes = [];
  }),
  defineNative("keyframe.replace-all", "Substituir keyframes", (draft, command) => {
    const property = getProperty(draft, command.payload);
    property.keyframes = [...command.payload.keyframes];
    sortKeyframes(property.keyframes);
  }),
  defineNative("path.create", "Criar caminho", (draft, command) => {
    const { path } = command.payload;
    if (draft.paths[path.id] !== undefined) {
      rejectCommand(`Caminho já existe: ${path.id}.`);
    }
    // A validação Zod já devolve objetos novos: o payload é cópia própria e
    // atribuir por referência não deixa o chamador mutar o documento depois.
    draft.paths[path.id] = path;
  }),
  defineNative("path.delete", "Excluir caminho", (draft, command) => {
    const { pathId } = command.payload;
    if (draft.paths[pathId] === undefined) rejectCommand(`Caminho não encontrado: ${pathId}.`);
    // Comportamentos que apontavam para ele passam a reportar diagnóstico em vez
    // de sumir sem explicação; excluir em cascata apagaria trabalho do usuário.
    delete draft.paths[pathId];
  }),
  defineNative("path.rename", "Renomear caminho", (draft, command) => {
    getPath(draft, command.payload.pathId).name = command.payload.name;
  }),
  defineNative("path.set-vertices", "Editar caminho", (draft, command) => {
    getPath(draft, command.payload.pathId).vertices = command.payload.vertices;
  }),
  defineNative("path.set-flags", "Alterar caminho", (draft, command) => {
    Object.assign(getPath(draft, command.payload.pathId), command.payload.flags);
  }),

  defineNative("behavior.add", "Adicionar comportamento", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    if (node.behaviors.some((entry) => entry.id === command.payload.behavior.id)) {
      rejectCommand(`Comportamento já existe: ${command.payload.behavior.id}.`);
    }
    const behavior = command.payload.behavior;
    const index = command.payload.index;
    if (index === undefined || index >= node.behaviors.length) node.behaviors.push(behavior);
    else node.behaviors.splice(index, 0, behavior);
  }),
  defineNative("behavior.remove", "Remover comportamento", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    const index = node.behaviors.findIndex((entry) => entry.id === command.payload.behaviorId);
    if (index < 0) rejectCommand(`Comportamento não encontrado: ${command.payload.behaviorId}.`);
    node.behaviors.splice(index, 1);
  }),
  defineNative("behavior.set-params", "Alterar comportamento", (draft, command) => {
    // Substitui o objeto inteiro: params de comportamento são pequenos e a
    // mesclagem parcial esconderia campo removido.
    getBehavior(draft, command.payload).params = command.payload.params;
  }),
  defineNative("behavior.set-enabled", "Ativar comportamento", (draft, command) => {
    getBehavior(draft, command.payload).enabled = command.payload.enabled;
  }),

  defineNative("action.add", "Adicionar ação", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    if (node.actions.some((entry) => entry.id === command.payload.action.id)) {
      rejectCommand(`Ação já existe: ${command.payload.action.id}.`);
    }
    const action = command.payload.action;
    const index = command.payload.index;
    if (index === undefined || index >= node.actions.length) node.actions.push(action);
    else node.actions.splice(index, 0, action);
  }),
  defineNative("action.remove", "Remover ação", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    const index = node.actions.findIndex((entry) => entry.id === command.payload.actionId);
    if (index < 0) rejectCommand(`Ação não encontrada: ${command.payload.actionId}.`);
    node.actions.splice(index, 1);
  }),
  defineNative("action.set-params", "Alterar ação", (draft, command) => {
    getAction(draft, command.payload).params = command.payload.params;
  }),
  defineNative("action.set-enabled", "Ativar ação", (draft, command) => {
    getAction(draft, command.payload).enabled = command.payload.enabled;
  }),

  defineNative("effect.add", "Adicionar efeito", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    if (node.effects.some((entry) => entry.id === command.payload.effect.id)) {
      rejectCommand(`Efeito já existe: ${command.payload.effect.id}.`);
    }
    const effect = command.payload.effect;
    const index = command.payload.index;
    if (index === undefined || index >= node.effects.length) node.effects.push(effect);
    else node.effects.splice(index, 0, effect);
  }),
  defineNative("effect.remove", "Remover efeito", (draft, command) => {
    const node = getNode(
      getComposition(draft, command.payload.compositionId),
      command.payload.nodeId,
    );
    const index = node.effects.findIndex((entry) => entry.id === command.payload.effectId);
    if (index < 0) rejectCommand(`Efeito não encontrado: ${command.payload.effectId}.`);
    node.effects.splice(index, 1);
  }),
  defineNative("effect.set-params", "Alterar efeito", (draft, command) => {
    // Substituição inteira, como em behavior.set-params: a pilha de efeitos é
    // pequena e a mesclagem parcial esconderia campo removido por um preset.
    getEffect(draft, command.payload).params = command.payload.params;
  }),
  defineNative("effect.set-enabled", "Ativar efeito", (draft, command) => {
    getEffect(draft, command.payload).enabled = command.payload.enabled;
  }),

  defineNative("asset.add", "Importar asset", (draft, command) => {
    const asset = command.payload.asset;
    if (draft.assets.some((entry) => entry.id === asset.id)) {
      rejectCommand(`Asset já existe: ${asset.id}.`);
    }
    if (draft.assets.some((entry) => entry.src === asset.src)) {
      // O src é o hash do conteúdo: mesmo arquivo importado duas vezes é o
      // mesmo asset, e duplicar descriptor só criaria lixo na biblioteca.
      rejectCommand(`Este conteúdo já foi importado: ${asset.src}.`);
    }
    draft.assets.push(asset);
  }),
  defineNative("asset.remove", "Remover asset", (draft, command) => {
    const index = draft.assets.findIndex((entry) => entry.id === command.payload.assetId);
    if (index < 0) rejectCommand(`Asset não encontrado: ${command.payload.assetId}.`);
    draft.assets.splice(index, 1);
  }),
  defineNative("asset.rename", "Renomear asset", (draft, command) => {
    getAsset(draft, command.payload.assetId).meta["name"] = command.payload.name;
  }),
  defineNative("asset.set-tags", "Alterar tags do asset", (draft, command) => {
    getAsset(draft, command.payload.assetId).meta["tags"] = [...command.payload.tags];
  }),

  defineNative("palette.add", "Adicionar paleta", (draft, command) => {
    const palette = command.payload.palette;
    if (draft.palettes.some((entry) => entry.id === palette.id)) {
      rejectCommand(`Paleta já existe: ${palette.id}.`);
    }
    draft.palettes.push(palette);
  }),

  defineNative("camera.set-follow", "Alterar seguimento da câmera", (draft, command) => {
    getComposition(draft, command.payload.compositionId).camera.follow = command.payload.follow;
  }),
  defineNative("camera.set-path", "Alterar path da câmera", (draft, command) => {
    getComposition(draft, command.payload.compositionId).camera.path = command.payload.path;
  }),
];

function defineNative<T extends NativeCommandType>(
  type: T,
  label: string,
  handler: (draft: Draft<ProjectDocument>, command: CommandFor<T>) => void,
): ErasedDefinition {
  return {
    type,
    label,
    schema: CommandSchemas[type] as unknown as z.ZodType<SerializableCommand>,
    handler(draft, command) {
      handler(draft, command as CommandFor<T>);
    },
  };
}

function getComposition(draft: Draft<ProjectDocument>, compositionId: string): Draft<Composition> {
  const composition = draft.compositions.find((candidate) => candidate.id === compositionId);
  if (composition === undefined) rejectCommand(`Composição não encontrada: ${compositionId}.`);
  return composition;
}

function getNode(composition: Draft<Composition>, nodeId: string): Draft<Node> {
  const node = composition.nodes[nodeId];
  if (node === undefined) rejectCommand(`Nó não encontrado: ${nodeId}.`);
  return node;
}

function getPath(draft: Draft<ProjectDocument>, pathId: string): Draft<PathData> {
  const path = draft.paths[pathId];
  if (path === undefined) rejectCommand(`Caminho não encontrado: ${pathId}.`);
  return path;
}

function getAsset(draft: Draft<ProjectDocument>, assetId: string): Draft<AssetDescriptor> {
  const asset = draft.assets.find((candidate) => candidate.id === assetId);
  if (asset === undefined) rejectCommand(`Asset não encontrado: ${assetId}.`);
  return asset;
}

function getBehavior(
  draft: Draft<ProjectDocument>,
  location: {
    readonly compositionId: string;
    readonly nodeId: string;
    readonly behaviorId: string;
  },
): Draft<BehaviorInstanceData> {
  const node = getNode(getComposition(draft, location.compositionId), location.nodeId);
  const behavior = node.behaviors.find((entry) => entry.id === location.behaviorId);
  if (behavior === undefined) {
    rejectCommand(`Comportamento não encontrado: ${location.behaviorId}.`);
  }
  return behavior;
}

function getEffect(
  draft: Draft<ProjectDocument>,
  location: {
    readonly compositionId: string;
    readonly nodeId: string;
    readonly effectId: string;
  },
): Draft<EffectInstanceData> {
  const node = getNode(getComposition(draft, location.compositionId), location.nodeId);
  const effect = node.effects.find((entry) => entry.id === location.effectId);
  if (effect === undefined) {
    rejectCommand(`Efeito não encontrado: ${location.effectId}.`);
  }
  return effect;
}

function getAction(
  draft: Draft<ProjectDocument>,
  location: {
    readonly compositionId: string;
    readonly nodeId: string;
    readonly actionId: string;
  },
): Draft<ActionInstanceData> {
  const node = getNode(getComposition(draft, location.compositionId), location.nodeId);
  const action = node.actions.find((entry) => entry.id === location.actionId);
  if (action === undefined) {
    rejectCommand(`Ação não encontrada: ${location.actionId}.`);
  }
  return action;
}

function insertComposition(draft: Draft<ProjectDocument>, composition: Composition): void {
  if (draft.compositions.some((candidate) => candidate.id === composition.id)) {
    rejectCommand(`Já existe uma composição com id ${composition.id}.`);
  }
  draft.compositions.push(composition);
}

function insertChild(children: string[], nodeId: string, index?: number): void {
  const insertionIndex = index === undefined ? children.length : Math.min(index, children.length);
  children.splice(insertionIndex, 0, nodeId);
}

function removeChild(children: string[], nodeId: string): void {
  const index = children.indexOf(nodeId);
  if (index < 0) rejectCommand(`O pai não contém o filho ${nodeId}.`);
  children.splice(index, 1);
}

function wouldCreateCycle(
  composition: Draft<Composition>,
  nodeId: string,
  candidateParentId: string,
): boolean {
  let current: Draft<Node> | undefined = composition.nodes[candidateParentId];
  while (current !== undefined) {
    if (current.id === nodeId) return true;
    current = current.parent === null ? undefined : composition.nodes[current.parent];
  }
  return false;
}

function collectSubtreeIds(composition: Draft<Composition>, rootId: string): Set<string> {
  const result = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || result.has(id)) continue;
    result.add(id);
    const node = composition.nodes[id];
    if (node !== undefined) pending.push(...node.children);
  }
  return result;
}

interface PropertyLocation {
  readonly compositionId: string;
  readonly target: { readonly kind: "node"; readonly nodeId: string } | { readonly kind: "camera" };
  readonly path: readonly (string | number)[];
}

type MutableProperty = Draft<AnimatableProperty<unknown>>;

function getProperty(draft: Draft<ProjectDocument>, location: PropertyLocation): MutableProperty {
  const composition = getComposition(draft, location.compositionId);
  let value: unknown =
    location.target.kind === "node"
      ? getNode(composition, location.target.nodeId)
      : composition.camera;
  for (const segment of location.path) {
    if (typeof value !== "object" || value === null) {
      rejectCommand(`Caminho de propriedade inválido: ${location.path.join(".")}.`);
    }
    value = Reflect.get(value, segment);
  }
  if (!isAnimatableProperty(value)) {
    rejectCommand(`O caminho ${location.path.join(".")} não aponta para uma propriedade animável.`);
  }
  return value;
}

/**
 * Cria somente a folha ausente. Não inventa objetos intermediários e não
 * sobrescreve valor existente: esses dois casos quase sempre significam typo ou
 * comando montado contra uma versão diferente do documento.
 */
function initializeProperty(
  draft: Draft<ProjectDocument>,
  location: PropertyLocation,
  property: AnimatableProperty<unknown>,
): void {
  const composition = getComposition(draft, location.compositionId);
  let parent: unknown =
    location.target.kind === "node"
      ? getNode(composition, location.target.nodeId)
      : composition.camera;
  const leaf = location.path.at(-1);
  if (leaf === undefined) rejectCommand("Caminho de propriedade vazio.");

  for (const segment of location.path.slice(0, -1)) {
    if (typeof parent !== "object" || parent === null) {
      rejectCommand(`Caminho de propriedade inválido: ${location.path.join(".")}.`);
    }
    parent = Reflect.get(parent, segment);
  }
  if (typeof parent !== "object" || parent === null) {
    rejectCommand(`Caminho de propriedade inválido: ${location.path.join(".")}.`);
  }
  if (Reflect.has(parent, leaf)) {
    rejectCommand(`A propriedade ${location.path.join(".")} já existe.`);
  }
  Reflect.set(parent, leaf, property);
}

function isAnimatableProperty(value: unknown): value is MutableProperty {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "keyframes" in value &&
    Array.isArray(Reflect.get(value, "keyframes")) &&
    "expression" in value
  );
}

function sortKeyframes(keyframes: Draft<Keyframe<unknown>>[]): void {
  keyframes.sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id));
}

function remapCompositionFrames(composition: Draft<Composition>, ratio: number): void {
  composition.duration = scaleFrame(composition.duration, ratio);
  composition.workArea = [
    scaleFrame(composition.workArea[0], ratio),
    scaleFrame(composition.workArea[1], ratio),
  ];
  for (const marker of composition.markers) {
    marker.frame = scaleFrame(marker.frame, ratio);
    if (marker.duration !== undefined) marker.duration = scaleFrame(marker.duration, ratio);
  }
  for (const node of Object.values(composition.nodes)) {
    node.timeRange.in = scaleFrame(node.timeRange.in, ratio);
    node.timeRange.out = scaleFrame(node.timeRange.out, ratio);
    for (const action of node.actions) {
      action.startFrame = scaleFrame(action.startFrame, ratio);
    }
  }
  remapNestedKeyframes(composition, ratio, new Set<object>());
}

function remapNestedKeyframes(value: unknown, ratio: number, visited: Set<object>): void {
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);
  if (isAnimatableProperty(value)) {
    for (const keyframe of value.keyframes) {
      keyframe.frame = scaleFrame(keyframe.frame, ratio);
    }
  }
  if (Array.isArray(value)) {
    for (const child of value) remapNestedKeyframes(child, ratio, visited);
    return;
  }
  for (const child of Object.values(value)) remapNestedKeyframes(child, ratio, visited);
}

function scaleFrame(frame: number, ratio: number): number {
  return Math.max(0, Math.round(frame * ratio));
}
