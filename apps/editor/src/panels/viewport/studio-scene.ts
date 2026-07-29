/**
 * Modo estúdio (7E.3): um palco infinito para apresentar equipamento, sem mapa.
 *
 * Canvas e contexto WebGL próprios, pela razão medida no
 * [ADR-012](../../../../../docs/adr/ADR-012-studio-own-canvas.md): o custo de um
 * terceiro contexto é 3,6 ms de dezesseis disponíveis, e fazer o estúdio depender
 * de um MapLibre escondido para lhe dar matriz e repintura sairia caro todo
 * frame, para sempre.
 *
 * O overlay Pixi continua por cima, então rótulos técnicos (`label.callout`) e
 * os filtros da Fase 6 funcionam no palco sem código novo. O que este módulo
 * fornece ao overlay é a **projeção**: onde, em pixels de tela, está um modelo
 * que vive em metros no espaço do palco.
 */

import type { EvaluatedScene } from "@theatrum/animation";
import { orbitCameraPosition } from "@theatrum/core-math";
import type { Vec2 } from "@theatrum/core-math";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  addLightRig,
  countPendingModels,
  createLightRig,
  createStudioEnvironment,
  loadModelTemplate,
  type LightRig,
  type ModelTemplate,
} from "./three-assets.js";
import { anchorToWorld, type AnchorFrame } from "./studio-anchor.js";
import {
  createStudioFrameProfiler,
  type StudioFrameProfiler,
  type StudioFrameProfilerStatus,
} from "./studio-frame-profiler.js";
import { createStudioGrid, type StudioGrid } from "./studio-grid.js";
import {
  createStudioReflectionProjector,
  type StudioReflectionProjector,
  type StudioReflectionStatus,
} from "./studio-reflection.js";
import {
  createStudioShadowProjector,
  type ShadowSubject,
  type StudioShadowProjector,
} from "./studio-shadow.js";

/** Estado do palco num frame, já avaliado. Tudo em metros e graus. */
export interface StudioStageState {
  readonly nodeId: string;
  readonly target: readonly [number, number, number];
  readonly distanceMeters: number;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  readonly fovDeg: number;
  readonly background: string;
  readonly floor: string;
  readonly gridColor: string;
  readonly gridSpacingMeters: number;
  readonly gridOpacity: number;
  readonly keyIntensity: number;
  readonly rimIntensity: number;
  readonly environmentIntensity: number;
  /** Textura procedural do piso. 0 devolve o piso liso. */
  readonly floorTexture: number;
  /** Reflexo planar do equipamento. Ausente em documento antigo equivale a 0. */
  readonly reflectionStrength: number;
  /** Sombra de contato sob cada objeto. 0 desliga. */
  readonly shadowStrength: number;
  /** Gradiente radial ao preto nas bordas: a sensacao de infinito. */
  readonly vignette: number;
  /**
   * Névoa junto ao horizonte, 0..1.
   *
   * Dissolve a costura entre o piso e o fundo — que o dono descreveu como "metade da
   * tela cortada" — e dá profundidade ao vazio. Mora no passe de fundo, então **nunca**
   * cobre o objeto, que era a condição do pedido.
   */
  readonly horizonHaze: number;
  readonly hazeColor: string;
  /** Direcao da luz principal, e da sombra que ela projeta. */
  readonly keyAzimuthDeg: number;
  readonly keyElevationDeg: number;
}

/** Um `model3d` posicionado no palco em vez de no globo. */
export interface StudioModelState {
  readonly id: string;
  readonly assetSrc: string;
  /** Metros: x leste, y altura, z sul. */
  readonly position: readonly [number, number, number];
  readonly headingDeg: number;
  /** Vão máximo do modelo, em metros. */
  readonly sizeMeters: number;
  readonly opacity: number;
}

/**
 * Um ponto de interesse do palco no frame, já avaliado ([ADR-015](../../../../../docs/adr/ADR-015-studio-points-of-interest.md)).
 *
 * `point` está **sempre** em metros de mundo do palco — o mesmo espaço do `pick` e
 * do alvo da câmera — mesmo quando o documento guardou o ponto no espaço do objeto
 * ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)). Resolver
 * aqui, uma vez, é o que mantém marcador, projeção e roteiro lendo um número só:
 * se cada consumidor convertesse por conta, cada um poderia converter diferente.
 *
 * O enquadramento continua absoluto, os mesmos três números que o `studio.stage`
 * anima. Visitar o ponto é copiá-los.
 */
export interface StudioPoiState {
  readonly id: string;
  /** O nome é o do NÓ: é ele que o painel de camadas edita. */
  readonly name: string;
  readonly point: readonly [number, number, number];
  readonly distanceMeters: number;
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  /** Id do `model3d` a que o ponto pertence, ou `""` se é ponto solto do palco. */
  readonly ownerId: string;
  /**
   * Tem dono declarado e o dono não respondeu: nó apagado, tipo trocado, asset
   * removido, ou GLB ainda em parse. O ponto desenha na posição crua para não
   * desaparecer sem explicação, e quem mostra interface avisa.
   */
  readonly orphan: boolean;
}

/** Quem sabe a pose de um modelo do palco. O painel implementa lendo o runtime. */
export type AnchorResolver = (ownerId: string) => AnchorFrame | null;

export interface StudioScene {
  readonly stage: StudioStageState | null;
  readonly models: readonly StudioModelState[];
}

/**
 * O palco do frame, ou `null` se a composição não tem nenhum.
 *
 * Com mais de um `studio.stage` visível vence o primeiro na ordem de avaliação —
 * a mesma ordem do painel de camadas. Duas câmeras não podem filmar a mesma
 * imagem, e escolher a de cima é a regra que o usuário já conhece de todo o
 * resto do editor.
 */
export function collectStudioStage(evaluated: EvaluatedScene): StudioStageState | null {
  for (const [id, node] of evaluated.nodes) {
    if (node.type !== "studio.stage" || node.visible === false) continue;
    const props = node.props as Readonly<Record<string, unknown>>;
    return {
      nodeId: id,
      target: [num(props, "targetX", 0), num(props, "targetY", 0), num(props, "targetZ", 0)],
      distanceMeters: num(props, "distanceMeters", 40),
      azimuthDeg: num(props, "azimuthDeg", 35),
      elevationDeg: num(props, "elevationDeg", 14),
      fovDeg: Math.max(5, Math.min(120, num(props, "fovDeg", 38))),
      background: str(props, "background", "#0d1218ff"),
      floor: str(props, "floor", "#39424fff"),
      gridColor: str(props, "gridColor", "#5d6f84ff"),
      gridSpacingMeters: Math.max(0.05, num(props, "gridSpacingMeters", 5)),
      gridOpacity: clamp01(num(props, "gridOpacity", 0.55)),
      keyIntensity: Math.max(0, num(props, "keyIntensity", 2.6)),
      rimIntensity: Math.max(0, num(props, "rimIntensity", 1.8)),
      environmentIntensity: Math.max(0, num(props, "environmentIntensity", 0.75)),
      floorTexture: clamp01(num(props, "floorTexture", 0.35)),
      reflectionStrength: clamp01(num(props, "reflectionStrength", 0)),
      shadowStrength: clamp01(num(props, "shadowStrength", 0.75)),
      vignette: clamp01(num(props, "vignette", 0.55)),
      horizonHaze: clamp01(num(props, "horizonHaze", 0.55)),
      hazeColor: str(props, "hazeColor", "#8fa6bdff"),
      keyAzimuthDeg: num(props, "keyAzimuthDeg", 138),
      keyElevationDeg: Math.max(0, Math.min(90, num(props, "keyElevationDeg", 24))),
    };
  }
  return null;
}

/**
 * Os `model3d` do frame, lidos como habitantes do palco.
 *
 * A mesma prop que no mapa vale metros de terreno (`scaleMeters`) aqui vale
 * metros de verdade: no palco não há projeção que distorça escala, então um caça
 * de 18 m tem 18 m. Um `scaleMeters` herdado de uma cena de mapa (30 000, o
 * padrão) daria um objeto de trinta quilômetros e a câmera ficaria dentro dele —
 * por isso o valor é limitado ao que cabe num palco.
 */
export function collectStudioModels(evaluated: EvaluatedScene): readonly StudioModelState[] {
  const result: StudioModelState[] = [];
  for (const [id, node] of evaluated.nodes) {
    if (node.type !== "model3d" || node.visible === false) continue;
    const props = node.props as Readonly<Record<string, unknown>>;
    const assetSrc = str(props, "assetId", "");
    if (assetSrc === "") continue;
    result.push({
      id,
      assetSrc,
      position: [num(props, "stageX", 0), num(props, "altitudeMeters", 0), num(props, "stageZ", 0)],
      headingDeg: num(props, "headingOffset", 0) + node.transform.rotation,
      sizeMeters: Math.max(0.1, Math.min(MAX_STAGE_SIZE_METERS, num(props, "scaleMeters", 18))),
      opacity: clamp01(node.transform.opacity),
    });
  }
  return result;
}

/**
 * Os pontos de interesse do frame, na ordem de avaliação — que é a ordem do
 * painel de camadas, e portanto a ordem em que o roteiro os visita.
 *
 * Ponto invisível (nó desligado, fora da faixa de tempo, opacidade zerada no pai)
 * fica de fora do que se **desenha**. O roteiro não passa por aqui: ele compila
 * lendo o documento, não um frame, senão a câmera do frame 300 dependeria de
 * quais nós estavam visíveis no frame em que alguém clicou "compilar".
 */
export function collectStudioPois(
  evaluated: EvaluatedScene,
  resolveAnchor?: AnchorResolver,
): readonly StudioPoiState[] {
  const result: StudioPoiState[] = [];
  for (const [id, node] of evaluated.nodes) {
    if (node.type !== "studio.poi" || node.visible === false) continue;
    const props = node.props as Readonly<Record<string, unknown>>;
    const stored: readonly [number, number, number] = [
      num(props, "pointX", 0),
      num(props, "pointY", 0),
      num(props, "pointZ", 0),
    ];
    const ownerId = str(props, "ownerId", "");
    const anchor = ownerId === "" ? null : (resolveAnchor?.(ownerId) ?? null);
    result.push({
      id,
      name: node.name,
      // Sem dono o valor guardado já é mundo. Com dono resolvido, é o espaço
      // normalizado do modelo e passa pela matriz dele. Com dono NÃO resolvido
      // sobra o valor cru: errado no lugar, mas visível — e o aviso de órfão diz
      // por quê. Esconder o marcador aqui deixaria o dono sem pista do que houve.
      point: anchor === null ? stored : anchorToWorld(stored, anchor),
      distanceMeters: Math.max(0.01, num(props, "distanceMeters", 12)),
      azimuthDeg: num(props, "azimuthDeg", 35),
      elevationDeg: Math.max(-89, Math.min(89, num(props, "elevationDeg", 18))),
      ownerId,
      orphan: ownerId !== "" && anchor === null,
    });
  }
  return result;
}

/**
 * Um `model3d` do palco pelo id, **sem** filtrar por visibilidade.
 *
 * Existe para o resolvedor de ancoragem, e a diferença em relação a
 * `collectStudioModels` é deliberada: a pose de um modelo continua bem definida
 * quando ele está invisível, e um ponto de interesse cujo dono foi ocultado num
 * frame não deve virar órfão por causa disso — órfão é o dono que **não existe**,
 * não o dono que não está aparecendo.
 */
export function collectStudioModel(
  evaluated: EvaluatedScene,
  modelId: string,
): StudioModelState | null {
  const node = evaluated.nodes.get(modelId);
  if (node === undefined || node.type !== "model3d") return null;
  const props = node.props as Readonly<Record<string, unknown>>;
  const assetSrc = str(props, "assetId", "");
  if (assetSrc === "") return null;
  return {
    id: modelId,
    assetSrc,
    position: [num(props, "stageX", 0), num(props, "altitudeMeters", 0), num(props, "stageZ", 0)],
    headingDeg: num(props, "headingOffset", 0) + node.transform.rotation,
    sizeMeters: Math.max(0.1, Math.min(MAX_STAGE_SIZE_METERS, num(props, "scaleMeters", 18))),
    opacity: clamp01(node.transform.opacity),
  };
}

/**
 * Direção da luz principal a partir de azimute e elevação, **da cena para a luz**.
 *
 * A mesma convenção de eixos da câmera orbital: azimute medido do sul (+Z) girando para o
 * leste (+X), elevação acima do horizonte. Assim os dois controles do palco — onde a câmera
 * está e de onde a luz vem — se leem com a mesma régua, em vez de um em graus e o outro num
 * vetor que só quem escreveu entende.
 */
export function keyLightDirection(
  azimuthDeg: number,
  elevationDeg: number,
): readonly [number, number, number] {
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const elevation = (Math.max(0, Math.min(90, elevationDeg)) * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return [horizontal * Math.sin(azimuth), Math.sin(elevation), horizontal * Math.cos(azimuth)];
}

/**
 * Teto do vão de um modelo no palco. 500 m cobre o maior objeto que alguém
 * apresenta (um porta-aviões tem 330) e impede que a escala geográfica herdada
 * de uma cena de mapa engula a câmera.
 */
export const MAX_STAGE_SIZE_METERS = 500;

function num(props: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(props: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = props[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** `#RRGGBB` ou `#RRGGBBAA` → hex de 6 dígitos. `THREE.Color` não come alfa. */
export function stripAlpha(value: string): string {
  if (/^#[0-9a-f]{8}$/i.test(value)) return value.slice(0, 7);
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

interface StudioInstance {
  readonly root: THREE.Object3D;
  readonly src: string;
  readonly radius: number;
  readonly footprint: ModelTemplate["footprint"];
}

/**
 * Onde um clique encontrou a superfície de um modelo do palco.
 *
 * O ponto vem em **metros de mundo do palco**, que é o mesmo espaço em que o
 * `studio.poi` guarda `pointX/Y/Z` e em que a câmera do `studio.stage` mira. Sem
 * conversão no meio: o que o dono clicou é o que o roteiro vai enquadrar.
 */
export interface StudioPick {
  /** Metros de palco: x leste, y altura, z sul. */
  readonly point: readonly [number, number, number];
  /** Qual `model3d` foi atingido — para nomear o ponto e diagnosticar. */
  readonly modelId: string;
  /** Distância da câmera até o ponto, em metros. */
  readonly distanceMeters: number;
}

/** Diagnóstico DEV, e o que o verificador de fase lê. */
export interface StudioStatus {
  readonly active: boolean;
  readonly models: number;
  readonly loaded: number;
  /** Modelos que ainda podem aparecer — o que o settle do export espera zerar. */
  readonly pending: number;
  readonly renders: number;
  /** Diagnóstico do passe planar; não participa da decisão do frame. */
  readonly reflection: StudioReflectionStatus;
  readonly cameraPosition: readonly [number, number, number] | null;
  readonly contextLost: boolean;
  readonly lastError: string | null;
}

/**
 * O palco vivo. Um por canvas; o `SceneOverlay` cria quando entra no modo e
 * descarta quando sai — contexto WebGL vazado é o caminho conhecido para
 * estourar o teto de dezesseis que o ADR-012 mediu.
 */
export class StudioSceneRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.05, 20_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly frameProfiler: StudioFrameProfiler;
  private readonly loader = new GLTFLoader();
  private readonly raycaster = new THREE.Raycaster();
  private readonly grid: StudioGrid;
  private readonly reflectionProjector: StudioReflectionProjector;
  private readonly shadowProjector: StudioShadowProjector;
  private readonly rig: LightRig;
  private readonly templates = new Map<string, Promise<ModelTemplate | null>>();
  private readonly instances = new Map<string, StudioInstance>();
  /**
   * Srcs cujo GLB já resolveu SEM modelo. Erro é resolução, não espera: sem
   * este conjunto o pending nunca zeraria e o settle do export travaria no
   * timeout — o mesmo motivo do conjunto gêmeo na camada 3D do mapa.
   */
  private readonly failedSrcs = new Set<string>();
  private models: readonly StudioModelState[] = [];
  private stage: StudioStageState | null = null;
  private environment: THREE.Texture | null = null;
  private renderCount = 0;
  private lastError: string | null = null;
  private disposed = false;
  private repaint: (() => void) | null = null;
  /** Bucket da última imagem: o relógio externo de CPU precisa usar a mesma classe da query GPU. */
  private profileReflectionOn = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      /**
       * Desligado por decisão — [ADR-023](../../../../../docs/adr/ADR-023-no-msaa-on-composed-surfaces.md).
       *
       * O palco tem o mesmo defeito que o mapa, medido com o mesmo método:
       * repintar o mesmo estado é bit-exato em 1248×566 e 1920×1080 e **diverge**
       * em 2560×1440 e 3840×2160, com `SAMPLES = 4`. O overlay Pixi, que resolve
       * o multiamostrado no render target dele antes de blitar, não sofre — é a
       * etapa que estes dois entregavam ao driver.
       *
       * Este é o custo mais visível da decisão: aresta de modelo 3D é onde o MSAA
       * fazia mais efeito. A mitigação, se o dono reclamar, é supersampling no
       * nosso código — alternativa D do ADR-023, com ADR próprio.
       */
      antialias: false,
      alpha: false,
      // O buffer sobrevive ao fim do frame para poder ser LIDO. O export da
      // Fase 8 precisa disso — um estúdio que não pode ser capturado não serve
      // para apresentar equipamento em vídeo — e é o que permite medir o palco
      // em pixels em vez de confiar no relato dele.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.frameProfiler = createStudioFrameProfiler(this.renderer);
    this.environment = createStudioEnvironment(this.renderer);
    this.scene.environment = this.environment;
    this.rig = createLightRig("y", { key: 2.6, fill: 0.7, rim: 1.8, ambient: 0.3 });
    addLightRig(this.scene, this.rig);
    this.grid = createStudioGrid();
    this.reflectionProjector = createStudioReflectionProjector();
    this.shadowProjector = createStudioShadowProjector();
    this.scene.add(this.grid.mesh);
  }

  /** Quem avisar quando um GLB terminar de carregar depois do frame. */
  onNeedsRepaint(callback: () => void): void {
    this.repaint = callback;
  }

  dispose(): void {
    this.disposed = true;
    for (const instance of this.instances.values()) this.scene.remove(instance.root);
    this.instances.clear();
    this.templates.clear();
    this.grid.dispose();
    this.reflectionProjector.dispose();
    this.shadowProjector.dispose();
    this.frameProfiler.dispose();
    this.environment?.dispose();
    this.environment = null;
    // Só `dispose`. **Não** chamar `WEBGL_lose_context.loseContext()` aqui.
    //
    // Parece a coisa certa — o ADR-012 fala em devolver o contexto explicitamente
    // — e é errado, porque `loseContext` é permanente para aquele canvas: não há
    // `restoreContext` automático. O elemento é o mesmo entre montagens do
    // `SceneOverlay`, então a montagem seguinte pedia `getContext` e recebia de
    // volta o contexto morto. O three ainda o aceitava e só quebrava adiante, ao
    // ler `getShaderPrecisionFormat(...).precision` de null — um `TypeError` no
    // meio da inicialização, sem uma palavra sobre contexto perdido.
    //
    // Quem devolve o contexto é o navegador, quando o elemento canvas é coletado
    // junto com o componente. `dispose` libera as texturas e os buffers, que é a
    // parte que o three de fato controla.
    this.renderer.dispose();
  }

  status(): StudioStatus {
    const position = this.stage === null ? null : this.camera.position;
    return {
      active: this.stage !== null,
      models: this.models.length,
      loaded: this.instances.size,
      pending: this.pendingModels(),
      renders: this.renderCount,
      reflection: this.reflectionProjector.status(),
      cameraPosition: position === null ? null : [position.x, position.y, position.z],
      contextLost: this.renderer.getContext().isContextLost(),
      lastError: this.lastError,
    };
  }

  /**
   * Modelos que ainda podem aparecer no palco: nem carregados, nem resolvidos
   * por erro. O settle do export espera isto zerar — o palco é uma das três
   * superfícies compostas no frame, e um GLB em parse é trabalho pendente.
   */
  pendingModels(): number {
    return countPendingModels(this.models, new Set(this.instances.keys()), this.failedSrcs);
  }

  /**
   * Medição opt-in do frame real. Estas cinco operações só são expostas nas
   * sondas DEV/verificação; o caminho distribuído nunca inicia queries.
   */
  profileStart(): void {
    this.frameProfiler.start();
  }

  profileReset(): void {
    this.frameProfiler.reset();
  }

  profileStop(): void {
    this.frameProfiler.stop();
  }

  profileStatus(): StudioFrameProfilerStatus {
    return this.frameProfiler.status();
  }

  profilePoll(): StudioFrameProfilerStatus {
    return this.frameProfiler.poll();
  }

  /**
   * O painel mede de `evaluate` até terminar Three, marcadores e Pixi. O runtime
   * acrescenta o resultado ao mesmo bucket ON/OFF escolhido antes dos passes GPU.
   */
  recordProfileCpuFrame(milliseconds: number): boolean {
    return this.frameProfiler.recordCpuFrame(milliseconds, this.profileReflectionOn);
  }

  /** Reconcilia e desenha um frame. `width`/`height` em pixels CSS. */
  render(scene: StudioScene, width: number, height: number): void {
    this.stage = scene.stage;
    this.models = scene.models;
    this.profileReflectionOn = false;
    if (scene.stage === null || width <= 0 || height <= 0) return;
    this.syncInstances(scene.models);
    this.applyStage(scene.stage, width, height);
    // O tamanho final é o estado de entrada dos dois passes offscreen. Assim a
    // restauração deles volta ao viewport correto deste frame, não ao anterior.
    this.renderer.setSize(width, height, false);
    for (const model of scene.models) {
      const instance = this.instances.get(model.id);
      if (instance === undefined) continue;
      applyModelTransform(instance.root, model, instance.footprint.bottom);
      instance.root.visible = model.opacity > 0;
    }
    // A silhueta é pintada ANTES do frame: ela usa o mesmo renderer, e trocar de
    // render target no meio do desenho da cena deixaria o palco pela metade.
    /**
     * A luz principal é aimada pelo documento, e a sombra sai da mesma direção.
     *
     * Antes o rig tinha a direção fixa no código e o projetor assumia luz **vertical** —
     * duas verdades diferentes sobre onde está a luz, e por isso a sombra era uma mancha
     * embaixo do objeto em vez de cair para um lado. Uma fonte só para as duas.
     */
    const lightDirection = keyLightDirection(
      scene.stage.keyAzimuthDeg,
      scene.stage.keyElevationDeg,
    );
    this.rig.key.position.set(lightDirection[0], lightDirection[1], lightDirection[2]);
    const hasReflectionSubject = scene.models.some(
      (model) => model.opacity > 0 && this.instances.has(model.id),
    );
    const reflectionWanted = scene.stage.reflectionStrength > 0 && hasReflectionSubject;
    this.frameProfiler.beginFrame(reflectionWanted);
    try {
      const shadow =
        scene.stage.shadowStrength > 0
          ? this.shadowProjector.update(
              this.renderer,
              this.scene,
              [this.grid.mesh],
              this.shadowSubjects(scene.models),
              lightDirection,
            )
          : null;
      const reflection = reflectionWanted
        ? this.reflectionProjector.update(
            this.renderer,
            this.scene,
            this.camera,
            [this.grid.mesh],
            width,
            height,
          )
        : null;
      this.profileReflectionOn = reflection !== null;
      this.grid.update(this.camera, {
        floor: stripAlpha(scene.stage.floor),
        grid: stripAlpha(scene.stage.gridColor),
        horizon: stripAlpha(scene.stage.background),
        spacingMeters: scene.stage.gridSpacingMeters,
        opacity: scene.stage.gridOpacity,
        texture: scene.stage.floorTexture,
        reflection,
        reflectionStrength: scene.stage.reflectionStrength,
        shadow,
        shadowStrength: scene.stage.shadowStrength,
        vignette: scene.stage.vignette,
        haze: scene.stage.horizonHaze,
        hazeColor: stripAlpha(scene.stage.hazeColor),
      });
      this.renderer.render(this.scene, this.camera);
      this.renderCount += 1;
    } finally {
      this.frameProfiler.endFrame(this.profileReflectionOn);
    }
  }

  /**
   * Onde um ponto do palco cai na tela, em pixels CSS — ou `null` se está atrás
   * da câmera. É por aqui que um `label.callout` encontra a asa do caça.
   */
  project(point: readonly [number, number, number], width: number, height: number): Vec2 | null {
    const ndc = new THREE.Vector3(point[0], point[1], point[2]).project(this.camera);
    if (ndc.z > 1) return null;
    return [((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height];
  }

  /**
   * O ponto da superfície de um modelo sob um pixel da tela ([ADR-015](../../../../../docs/adr/ADR-015-studio-points-of-interest.md)).
   *
   * É o inverso exato de `project`, e é o que faz o ponto de interesse nascer de
   * onde o dono **vê** que é a cabine, em vez de onde um exportador de OBJ achou
   * que era. `x`/`y` em pixels CSS relativos ao canvas.
   *
   * **Só modelo, nunca o chão.** O piso é infinito: um clique que erra o objeto
   * acertaria o chão a qualquer distância e criaria um ponto plausível no lugar
   * errado — o modo de falha que este projeto chama de silencioso. Errar devolve
   * `null`, e o painel diz que errou.
   *
   * **Modelo em parse não é alvo.** Ele ainda não tem geometria, então o raio
   * passa direto. Quem chama deve consultar `pendingModels()` antes de tratar
   * `null` como "não há nada aqui" — é a consequência declarada no ADR-015.
   */
  pick(x: number, y: number, width: number, height: number): StudioPick | null {
    if (this.stage === null || width <= 0 || height <= 0) return null;
    const targets: THREE.Object3D[] = [];
    const owners = new Map<THREE.Object3D, string>();
    for (const [id, instance] of this.instances) {
      if (!instance.root.visible) continue;
      targets.push(instance.root);
      owners.set(instance.root, id);
    }
    if (targets.length === 0) return null;
    // As instâncias têm `matrixAutoUpdate = false` e são posicionadas escrevendo
    // `matrix` à mão, então sem esta linha o raio cruzaria a pose do frame
    // anterior — erro de um frame que só apareceria como ponto ligeiramente fora
    // do lugar ao marcar com a câmera em movimento.
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(
      new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1),
      this.camera,
    );
    const hits = this.raycaster.intersectObjects(targets, true);
    const hit = hits[0];
    if (hit === undefined) return null;
    let owner: string | undefined;
    for (let node: THREE.Object3D | null = hit.object; node !== null; node = node.parent) {
      owner = owners.get(node);
      if (owner !== undefined) break;
    }
    if (owner === undefined) return null;
    return {
      point: [hit.point.x, hit.point.y, hit.point.z],
      modelId: owner,
      distanceMeters: hit.distance,
    };
  }

  /**
   * Raio da esfera que envolve tudo que está visível no palco, medido do alvo da
   * câmera. É o número que dimensiona o alcance de profundidade: sem ele, `near`
   * e `far` seriam palpite, e palpite largo custa z-fighting.
   *
   * Piso mínimo de 1 m para palco vazio não gerar um frustum degenerado.
   */
  private sceneRadiusMeters(target: readonly [number, number, number]): number {
    let radius = 1;
    for (const model of this.models) {
      const instance = this.instances.get(model.id);
      if (instance === undefined || model.opacity <= 0) continue;
      const offset = Math.hypot(
        model.position[0] - target[0],
        model.position[1] - target[1],
        model.position[2] - target[2],
      );
      radius = Math.max(radius, offset + instance.radius * model.sizeMeters);
    }
    return radius;
  }

  /**
   * O que o projetor de sombra precisa saber de cada objeto: onde está, que
   * pegada tem e a que altura do chão. A **forma** ele extrai renderizando o
   * próprio modelo visto de cima, então aqui não há aproximação de silhueta —
   * só o enquadramento da câmera de cima.
   */
  private shadowSubjects(models: readonly StudioModelState[]): readonly ShadowSubject[] {
    const subjects: ShadowSubject[] = [];
    for (const model of models) {
      const instance = this.instances.get(model.id);
      if (instance === undefined) continue;
      const scale = model.sizeMeters;
      subjects.push({
        root: instance.root,
        center: [model.position[0], model.position[2]],
        halfX: Math.max(0.05, instance.footprint.halfX * scale),
        halfZ: Math.max(0.05, instance.footprint.halfZ * scale),
        // `altitudeMeters` já É a altura da base (ver `applyModelTransform`), então
        // aqui não há offset a refazer. Negativo conta como encostado, não como
        // suspenso ao contrário.
        heightMeters: Math.max(0, model.position[1]),
        opacity: model.opacity,
      });
    }
    return subjects;
  }

  /**
   * Raio do modelo **em pixels de tela**, no frame corrente.
   *
   * É o que faltava para um rótulo saber que está cobrindo a aeronave. Até agora
   * o modelo entrava no layout como um ponto — `bounds` de largura e altura zero
   * — e o passe de rótulo não tinha como escolher o lado livre: para ele o caça
   * não ocupava área nenhuma.
   *
   * Medido projetando o centro e um ponto a um raio de distância na direção
   * **direita da câmera**. Assim o número já vem com a perspectiva embutida: o
   * mesmo objeto rende mais pixels perto que longe, que é o comportamento certo.
   * A esfera envolvente é generosa — a silhueta real cabe dentro dela — e essa
   * folga é a favor, porque o rótulo se afasta um pouco mais do que o necessário
   * em vez de encostar.
   */
  screenRadius(id: string, width: number, height: number): number | null {
    const model = this.models.find((candidate) => candidate.id === id);
    const radius = this.modelRadius(id);
    if (model === undefined || radius === null || width <= 0 || height <= 0) return null;
    const center = this.project(model.position, width, height);
    if (center === null) return null;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = forward.clone().cross(this.camera.up).normalize();
    const edge = this.project(
      [
        model.position[0] + right.x * radius,
        model.position[1] + right.y * radius,
        model.position[2] + right.z * radius,
      ],
      width,
      height,
    );
    if (edge === null) return null;
    return Math.hypot(edge[0] - center[0], edge[1] - center[1]);
  }

  /** Raio em metros do modelo carregado, para o enquadramento automático. */
  modelRadius(id: string): number | null {
    const instance = this.instances.get(id);
    const model = this.models.find((candidate) => candidate.id === id);
    if (instance === undefined || model === undefined) return null;
    return instance.radius * model.sizeMeters;
  }

  /**
   * A base do modelo normalizado, em unidades normalizadas ([ADR-016](../../../../../docs/adr/ADR-016-poi-anchored-to-object.md)).
   *
   * É o único número da matriz de ancoragem que **não** vem do documento: ele sai
   * da caixa envolvente do GLB, medida uma vez em `normalizeModel`. Por isso a
   * conversão de ponto exige o modelo carregado, e por isso ela vive aqui e não
   * numa função pura sobre o documento.
   *
   * `null` quando o GLB ainda está em parse ou falhou — e quem chama trata isso
   * como órfão temporário em vez de assumir zero, que poria o ponto meio metro
   * fora do lugar sem avisar.
   */
  modelBottom(id: string): number | null {
    return this.instances.get(id)?.footprint.bottom ?? null;
  }

  /**
   * O quadro de ancoragem completo do modelo **neste** frame.
   *
   * Combina o que vem do documento (pose e escala do último `render`) com o que
   * vem da geometria (base e raio normalizados). É o atalho para quem converte no
   * frame corrente — marcar um ponto, anexar um ponto existente. Quem precisa de
   * outro frame monta o quadro à mão, com `collectStudioModel` mais `modelBottom`:
   * a pose de um objeto animado no frame 300 não está aqui.
   */
  anchorFrame(id: string): (AnchorFrame & { readonly normalizedRadius: number }) | null {
    const instance = this.instances.get(id);
    const model = this.models.find((candidate) => candidate.id === id);
    if (instance === undefined || model === undefined) return null;
    return {
      position: model.position,
      headingDeg: model.headingDeg,
      sizeMeters: model.sizeMeters,
      bottom: instance.footprint.bottom,
      normalizedRadius: instance.radius,
    };
  }

  /** Ids dos modelos com geometria carregada, na ordem do último frame. */
  loadedModelIds(): readonly string[] {
    return this.models.filter((model) => this.instances.has(model.id)).map((model) => model.id);
  }

  private applyStage(stage: StudioStageState, width: number, height: number): void {
    const position = orbitCameraPosition({
      target: [stage.target[0], stage.target[1], stage.target[2]],
      distanceMeters: stage.distanceMeters,
      azimuthDeg: stage.azimuthDeg,
      elevationDeg: stage.elevationDeg,
    });
    this.camera.position.set(position[0], position[1], position[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(stage.target[0], stage.target[1], stage.target[2]);
    this.camera.fov = stage.fovDeg;
    this.camera.aspect = width / height;
    // Alcance de profundidade derivado do CONTEÚDO, não de um divisor arbitrário.
    //
    // A versão anterior escalava com a distância (`distanceMeters / 2000`) com a
    // intenção certa — está no comentário dela: "as faces do modelo começam a
    // piscar umas sobre as outras". Mas o divisor não alcançava o objetivo: com a
    // câmera a 34 m dava `near` 0,02 e `far` 1360, razão **68.000:1**. Nessa
    // razão, 1 mm de separação entre duas faces a 34 m vale 0,29 de um passo do
    // depth buffer de 24 bits — ou seja, **menos que um passo**, e duas faces
    // coplanares passam a ganhar uma da outra conforme o arredondamento. É o
    // z-fighting que aparece como linhas finas piscando sobre a fuselagem.
    //
    // O plano próximo não tem motivo para ficar a 2 cm quando a geometria mais
    // próxima está a 17 m. Derivando do raio da cena a razão cai para a casa de
    // 10:1, e o mesmo milímetro passa a valer ~270 passos.
    // Mas o conteúdo não é só o modelo: o CHÃO é infinito e começa embaixo da
    // câmera. Derivar `near` apenas do raio da cena recortava tudo mais perto que
    // ele — com o palco vazio o raio é o mínimo de 1 m, `near` ia a 38 m, e o piso
    // inteiro abaixo do horizonte virava fundo. O verificador do 7E.3 pegou isso
    // como "transições por linha 0/0/0": a grade não tinha desaparecido, o chão
    // tinha. `near` fica limitado a metade da altura da câmera sobre o piso, que é
    // menor que a distância de qualquer ponto de chão visível.
    const radius = this.sceneRadiusMeters(stage.target);
    const cameraHeight = Math.max(0.5, Math.abs(position[1]));
    this.camera.near = Math.max(
      0.05,
      Math.min(stage.distanceMeters - radius * 1.6, cameraHeight * 0.5),
    );
    this.camera.far = stage.distanceMeters + radius * 6 + 50;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.rig.key.intensity = stage.keyIntensity;
    this.rig.rim.intensity = stage.rimIntensity;
    this.scene.environmentIntensity = stage.environmentIntensity;
    this.renderer.setClearColor(new THREE.Color(stripAlpha(stage.background)), 1);
  }

  private syncInstances(models: readonly StudioModelState[]): void {
    const wanted = new Map(models.map((model) => [model.id, model]));
    for (const [id, instance] of this.instances) {
      const model = wanted.get(id);
      if (model === undefined || model.assetSrc !== instance.src) {
        this.scene.remove(instance.root);
        this.instances.delete(id);
      }
    }
    for (const model of models) {
      if (this.instances.has(model.id)) continue;
      void this.template(model.assetSrc).then((template) => {
        if (this.disposed || template === null) return;
        // O nó pode ter sumido ou trocado de asset enquanto o GLB carregava.
        const current = this.models.find((candidate) => candidate.id === model.id);
        if (current === undefined || current.assetSrc !== model.assetSrc) return;
        if (this.instances.has(model.id)) return;
        const root = template.root.clone(true);
        root.matrixAutoUpdate = false;
        this.instances.set(model.id, {
          root,
          src: model.assetSrc,
          radius: template.radius,
          footprint: template.footprint,
        });
        this.scene.add(root);
        this.repaint?.();
      });
    }
  }

  private template(src: string): Promise<ModelTemplate | null> {
    const cached = this.templates.get(src);
    if (cached !== undefined) return cached;
    const promise = loadModelTemplate(this.loader, src).then(({ template, error }) => {
      if (error !== null) {
        this.lastError = error;
        this.failedSrcs.add(src);
      }
      return template;
    });
    this.templates.set(src, promise);
    return promise;
  }
}

/**
 * Modelo normalizado → palco.
 *
 * Duas diferenças em relação ao mapa. A escala é **uniforme e positiva** — não há
 * eixo invertido para compensar, porque o palco já usa a convenção do Three. E o
 * rumo gira em torno de Y, o "para cima" daqui, sem o Rx de 90° que no mapa
 * levanta o modelo do plano mercator. Com o nariz do glTF em +Z, rumo `b` pede
 * rotação de 180° − b, a mesma convenção do mapa: um caça apontado para o norte
 * na cena geográfica continua apontado para o norte no palco.
 */
/**
 * `altitudeMeters` no palco é a altura da **base**, não do centro.
 *
 * O GLB é normalizado com o centro na origem, então translação crua com altitude
 * 0 enterra metade do objeto no piso — e enterrado ele esconde a própria sombra,
 * que foi como o defeito apareceu. Somar `-bottom * escala` faz altitude 0 querer
 * dizer "apoiado no chão", que é o que qualquer um espera de uma vitrine, e
 * mantém altitude 5 querendo dizer "cinco metros de vão livre".
 */
function applyModelTransform(root: THREE.Object3D, model: StudioModelState, bottom: number): void {
  const heading = ((180 - model.headingDeg) * Math.PI) / 180;
  root.matrix
    .makeTranslation(
      model.position[0],
      model.position[1] - bottom * model.sizeMeters,
      model.position[2],
    )
    .multiply(new THREE.Matrix4().makeScale(model.sizeMeters, model.sizeMeters, model.sizeMeters))
    .multiply(new THREE.Matrix4().makeRotationY(heading));
  root.matrixWorldNeedsUpdate = true;
}

/**
 * O palco vivo do aplicativo, para quem não é o painel dele.
 *
 * Existe por uma razão concreta: o `settle` do export precisa saber quantos GLB
 * ainda estão em parse no palco, e quem dirige o export vive no painel do
 * Viewport. Com o palco em painel próprio ([ADR-014](../../../../../docs/adr/ADR-014-studio-own-panel.md))
 * não há mais uma ref compartilhada entre os dois.
 *
 * Singleton de módulo, e não um store, porque **um palco por aplicativo é o limite
 * declarado** no ADR-014 — `collectStudioStage` já devolve só o primeiro
 * `studio.stage` da ordem de avaliação. Se a Fase 9 pedir dois palcos, é aqui e
 * lá que a decisão muda junto.
 */
let activeRuntime: StudioSceneRuntime | null = null;

export function setActiveStudioRuntime(runtime: StudioSceneRuntime | null): void {
  // Só o painel que está montando assume; desmontar limpa apenas o próprio.
  if (runtime === null && activeRuntime === null) return;
  activeRuntime = runtime;
}

/** 0 quando não há palco montado — ausência de painel não é trabalho pendente. */
export function activeStudioPendingModels(): number {
  return activeRuntime?.pendingModels() ?? 0;
}
