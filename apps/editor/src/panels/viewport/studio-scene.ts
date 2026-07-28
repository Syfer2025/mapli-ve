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
import { createStudioGrid, type StudioGrid } from "./studio-grid.js";
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
  /** Sombra de contato sob cada objeto. 0 desliga. */
  readonly shadowStrength: number;
  /** Gradiente radial ao preto nas bordas: a sensacao de infinito. */
  readonly vignette: number;
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
      shadowStrength: clamp01(num(props, "shadowStrength", 0.75)),
      vignette: clamp01(num(props, "vignette", 0.55)),
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

/** Diagnóstico DEV, e o que o verificador de fase lê. */
export interface StudioStatus {
  readonly active: boolean;
  readonly models: number;
  readonly loaded: number;
  /** Modelos que ainda podem aparecer — o que o settle do export espera zerar. */
  readonly pending: number;
  readonly renders: number;
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
  private readonly loader = new GLTFLoader();
  private readonly grid: StudioGrid;
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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
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
    this.environment = createStudioEnvironment(this.renderer);
    this.scene.environment = this.environment;
    this.rig = createLightRig("y", { key: 2.6, fill: 0.7, rim: 1.8, ambient: 0.3 });
    addLightRig(this.scene, this.rig);
    this.grid = createStudioGrid();
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
    this.shadowProjector.dispose();
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

  /** Reconcilia e desenha um frame. `width`/`height` em pixels CSS. */
  render(scene: StudioScene, width: number, height: number): void {
    this.stage = scene.stage;
    this.models = scene.models;
    if (scene.stage === null || width <= 0 || height <= 0) return;
    this.syncInstances(scene.models);
    this.applyStage(scene.stage, width, height);
    for (const model of scene.models) {
      const instance = this.instances.get(model.id);
      if (instance === undefined) continue;
      applyModelTransform(instance.root, model, instance.footprint.bottom);
      instance.root.visible = model.opacity > 0;
    }
    // A silhueta é pintada ANTES do frame: ela usa o mesmo renderer, e trocar de
    // render target no meio do desenho da cena deixaria o palco pela metade.
    const shadow =
      scene.stage.shadowStrength > 0
        ? this.shadowProjector.update(
            this.renderer,
            this.scene,
            [this.grid.mesh],
            this.shadowSubjects(scene.models),
          )
        : null;
    this.grid.update(this.camera, {
      floor: stripAlpha(scene.stage.floor),
      grid: stripAlpha(scene.stage.gridColor),
      horizon: stripAlpha(scene.stage.background),
      spacingMeters: scene.stage.gridSpacingMeters,
      opacity: scene.stage.gridOpacity,
      texture: scene.stage.floorTexture,
      shadow,
      shadowStrength: scene.stage.shadowStrength,
      vignette: scene.stage.vignette,
    });
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
    this.renderCount += 1;
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

  /** Raio em metros do modelo carregado, para o enquadramento automático. */
  modelRadius(id: string): number | null {
    const instance = this.instances.get(id);
    const model = this.models.find((candidate) => candidate.id === id);
    if (instance === undefined || model === undefined) return null;
    return instance.radius * model.sizeMeters;
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
    const radius = this.sceneRadiusMeters(stage.target);
    this.camera.near = Math.max(0.05, stage.distanceMeters - radius * 1.6);
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
