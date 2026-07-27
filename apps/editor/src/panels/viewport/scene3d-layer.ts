/**
 * Camada 3D do viewport — MapLibre custom layer + Three.js, no mesmo canvas e
 * contexto WebGL do mapa (o padrão canônico "add a 3D model").
 *
 * Desenha os nós do documento que não têm primitiva Pixi (`noVisual`) porque
 * existem de verdade no espaço, não na tela: `model3d` (GLB/glTF da Biblioteca)
 * e `route3d` (rota como tubo volumétrico em altitude). Os dois vivem na mesma
 * `THREE.Scene`, no mesmo renderer e no mesmo depth buffer — é isso que faz a
 * aeronave e a rota se ocluírem entre si em vez de empilharem como decalques.
 *
 * O sync é chamado pelo `SceneOverlay` a cada frame renderizado; fora dele a
 * camada não repinta sozinha, para não queimar GPU com o mapa parado.
 *
 * Escopo honesto: isto é preview de viewport. O export determinístico (Fase 8)
 * ainda não captura WebGL do mapa; opacidade hierárquica também não é aplicada
 * ao modelo (materiais GLTF são compartilhados entre instâncias).
 */

import { type EvaluatedScene } from "@theatrum/animation";
import { pathGeometry, pointAt } from "@theatrum/behaviors";
import type { PathData } from "@theatrum/schema";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type Map as MapLibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetBytes } from "../../assets/asset-media.js";

export const SCENE3D_LAYER_ID = "theatrum-scene3d";

/** Amostras por rota. 96 mantém a curva lisa até em rota transcontinental. */
const ROUTE_SAMPLES = 96;

/** Lados do tubo. 8 já lê como cilindro na escala de zoom geopolítico. */
const ROUTE_SIDES = 8;

/** Estado de um nó `model3d` já avaliado para um frame. */
export interface Model3dSceneNode {
  readonly id: string;
  /** Src do asset (hash de conteúdo), igual a `props.assetId`. */
  readonly assetSrc: string;
  readonly lngLat: readonly [number, number];
  /** Rumo em graus (0 = norte, horário), já com `headingOffset`. */
  readonly headingDeg: number;
  readonly scaleMeters: number;
  readonly altitudeMeters: number;
}

/** Ponto de uma rota no espaço: posição geográfica mais altitude em metros. */
export interface Route3dSample {
  readonly lngLat: readonly [number, number];
  readonly altitudeMeters: number;
}

/** Estado de um nó `route3d` já avaliado e amostrado para um frame. */
export interface Route3dSceneNode {
  readonly id: string;
  /** Caminho do projeto que esta rota desenha; o overlay 2D usa para não repetir. */
  readonly pathId: string;
  readonly samples: readonly Route3dSample[];
  /** Já sem o par de alfa: `THREE.Color` não entende `#RRGGBBAA`. */
  readonly color: string;
  /** Opacidade do nó multiplicada pelo alfa da cor. */
  readonly opacity: number;
  readonly widthMeters: number;
  /** 0 desliga a cortina vertical que liga a rota ao terreno. */
  readonly curtainOpacity: number;
}

/** Tudo que esta camada desenha num frame. */
export interface Scene3dNodes {
  readonly models: readonly Model3dSceneNode[];
  readonly routes: readonly Route3dSceneNode[];
}

interface Model3dInstance {
  readonly root: THREE.Object3D;
  readonly src: string;
}

interface Route3dInstance {
  readonly group: THREE.Group;
  readonly tube: THREE.Mesh;
  readonly tubeMaterial: THREE.MeshStandardMaterial;
  readonly curtain: THREE.Mesh;
  readonly curtainMaterial: THREE.MeshBasicMaterial;
  /** Origem local em unidades mercator; some na matriz do grupo. */
  origin: THREE.Vector3;
  node: Route3dSceneNode;
}

interface Scene3dDebugWindow extends Window {
  __theatrumScene3d?: {
    readonly status: () => {
      readonly nodes: number;
      readonly loaded: number;
      readonly pending: number;
      readonly routes: number;
      readonly renders: number;
      readonly ndc: readonly [number, number, number] | null;
      readonly lastError: string | null;
    };
    readonly materials: () => readonly {
      mesh: string;
      material: string;
      color: string;
      metalness: number;
      roughness: number;
      map: string;
    }[];
  };
}

/**
 * Extrai os nós `model3d` da cena avaliada. Rotação é tratada como rumo
 * geográfico mesmo quando a referência é de tela: com `motion-path` (o caso
 * comum) a referência já é `geo-bearing`; sem ele, a diferença só aparece com
 * o mapa girado — simplificação documentada do preview.
 */
export function collectModel3dNodes(evaluated: EvaluatedScene): readonly Model3dSceneNode[] {
  const result: Model3dSceneNode[] = [];
  for (const [id, node] of evaluated.nodes) {
    if (node.type !== "model3d" || node.visible === false) continue;
    const anchor = node.anchor;
    if (anchor.space !== "geo") continue;
    const props = node.props as Readonly<Record<string, unknown>>;
    const assetSrc = typeof props["assetId"] === "string" ? (props["assetId"] as string) : "";
    if (assetSrc === "") continue;
    result.push({
      id,
      assetSrc,
      lngLat: [anchor.lngLat[0], anchor.lngLat[1]],
      headingDeg: numberProp(props, "headingOffset", 0) + node.transform.rotation,
      scaleMeters: Math.max(1, numberProp(props, "scaleMeters", 30_000)),
      altitudeMeters: numberProp(props, "altitudeMeters", 0),
    });
  }
  return result;
}

/**
 * Extrai e amostra os nós `route3d`. A rota vem de um caminho compartilhado do
 * projeto (`document.paths`), então a amostragem é por `progress` — a mesma
 * métrica de comprimento de arco que o `motion-path` usa para andar sobre ele.
 * Assim a rota desenhada é exatamente a trajetória percorrida, e não uma
 * poligonal parecida.
 *
 * Rota em espaço `comp` é ignorada de propósito: sem terreno e sem altitude ela
 * é desenho 2D, e o lugar dela é o overlay Pixi.
 */
export function collectRoute3dNodes(
  evaluated: EvaluatedScene,
  paths: Readonly<Record<string, PathData>>,
): readonly Route3dSceneNode[] {
  const result: Route3dSceneNode[] = [];
  for (const [id, node] of evaluated.nodes) {
    if (node.type !== "route3d" || node.visible === false) continue;
    const props = node.props as Readonly<Record<string, unknown>>;
    const pathId = stringProp(props, "pathId", "");
    const path = paths[pathId];
    if (path === undefined || path.space !== "geo") continue;
    const geometry = pathGeometry(path);
    if (geometry.segments.length === 0 || geometry.totalLength <= 0) continue;
    const from = clamp01(numberProp(props, "progressStart", 0));
    const to = clamp01(numberProp(props, "progressEnd", 1));
    if (to <= from) continue;
    const altitudeMeters = numberProp(props, "altitudeMeters", 0);
    const arcMeters = numberProp(props, "arcMeters", 0);
    const samples: Route3dSample[] = [];
    for (let step = 0; step <= ROUTE_SAMPLES; step += 1) {
      const progress = from + ((to - from) * step) / ROUTE_SAMPLES;
      const point = pointAt(geometry, progress);
      samples.push({
        lngLat: [point[0], point[1]],
        // O ápice é ancorado no `progress` global, não no trecho visível: o
        // desenho progressivo revela a mesma trajetória em vez de reescalar a
        // parábola a cada frame.
        altitudeMeters: altitudeMeters + arcMeters * Math.sin(Math.PI * progress),
      });
    }
    const color = parseColor(stringProp(props, "color", "#f2a13cff"));
    result.push({
      id,
      pathId,
      samples: Object.freeze(samples),
      color: color.hex,
      opacity: clamp01(node.transform.opacity) * color.alpha,
      widthMeters: Math.max(1, numberProp(props, "widthMeters", 6_000)),
      curtainOpacity: clamp01(numberProp(props, "curtainOpacity", 0)),
    });
  }
  return result;
}

function numberProp(
  props: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringProp(
  props: Readonly<Record<string, unknown>>,
  key: string,
  fallback: string,
): string {
  const value = props[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * `#RRGGBB` ou `#RRGGBBAA` (o formato do `ColorSchema`) → hex de 6 dígitos mais
 * alfa separado. `THREE.Color.set` só entende 3 e 6 dígitos: com o par de alfa
 * anexado ele reclama no console e devolve **branco**, que é exatamente como um
 * míssil vermelho aparece cinza na tela.
 */
function parseColor(value: string): { readonly hex: string; readonly alpha: number } {
  if (/^#[0-9a-f]{8}$/i.test(value)) {
    return { hex: value.slice(0, 7), alpha: Number.parseInt(value.slice(7), 16) / 255 };
  }
  return { hex: /^#[0-9a-f]{6}$/i.test(value) ? value : "#f2a13c", alpha: 1 };
}

class Scene3dLayerRuntime {
  private readonly map: MapLibreMap;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly instances = new Map<string, Model3dInstance>();
  private readonly routes = new Map<string, Route3dInstance>();
  private renderer: THREE.WebGLRenderer | null = null;
  private nodes: readonly Model3dSceneNode[] = [];
  private lastError: string | null = null;
  private renderCount = 0;
  private lastNdc: readonly [number, number, number] | null = null;
  private disposed = false;

  constructor(map: MapLibreMap) {
    this.map = map;
    // Preenchimento de céu/chão em intensidade baixa: quem carrega a base da
    // iluminação é o environment map montado no `attach`.
    this.scene.add(new THREE.HemisphereLight(0xdce6f2, 0x1d2733, 0.35));
    // Chave RASANTE, não zenital. Um mapa é visto de cima e uma aeronave é um
    // objeto quase horizontal: luz vertical dá N·L praticamente igual em toda a
    // superfície visível, e o resultado é a silhueta branca sem volume. A ~22°
    // de elevação, dorso, lateral da fuselagem e deriva recebem intensidades
    // diferentes e a forma aparece.
    const key = new THREE.DirectionalLight(0xfff4e2, 2.2);
    key.position.set(0.62, -0.68, 0.4);
    this.scene.add(key);
    // Preenchimento frio do lado oposto: sem ele o lado na sombra fecha em
    // preto e o contorno se perde no mapa escuro.
    const fill = new THREE.DirectionalLight(0x9fc4e8, 0.55);
    fill.position.set(-0.7, 0.55, 0.18);
    this.scene.add(fill);
  }

  attach(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    // Tone mapping cinematográfico: segura os highlights do env map e das luzes.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Environment map: dá reflexos e volume aos PBR (sem ele o metal fica mudo).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // ...mas em intensidade cheia o RoomEnvironment é um estúdio branco: ilumina
    // por todos os lados ao mesmo tempo e apaga justamente o contraste das
    // direcionais que faz o volume ler. 0,4 mantém o reflexo e devolve a sombra.
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();
  }

  dispose(): void {
    this.disposed = true;
    for (const instance of this.instances.values()) this.scene.remove(instance.root);
    this.instances.clear();
    this.templates.clear();
    for (const instance of this.routes.values()) this.disposeRoute(instance);
    this.routes.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }

  status(): {
    nodes: number;
    loaded: number;
    pending: number;
    routes: number;
    renders: number;
    ndc: readonly [number, number, number] | null;
    lastError: string | null;
  } {
    return {
      nodes: this.nodes.length,
      loaded: this.instances.size,
      pending: this.nodes.length - this.instances.size,
      routes: this.routes.size,
      renders: this.renderCount,
      ndc: this.lastNdc,
      lastError: this.lastError,
    };
  }

  /** Diagnóstico DEV: texturas e materiais das instâncias carregadas. */
  materials(): readonly {
    mesh: string;
    material: string;
    color: string;
    metalness: number;
    roughness: number;
    map: string;
  }[] {
    const report: {
      mesh: string;
      material: string;
      color: string;
      metalness: number;
      roughness: number;
      map: string;
    }[] = [];
    for (const instance of this.instances.values()) {
      instance.root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material instanceof THREE.MeshStandardMaterial) {
              const texture = material.map;
              const image = texture?.image as { width?: number; height?: number } | undefined;
              report.push({
                mesh: object.name,
                material: material.name,
                color: `#${material.color.getHexString()}`,
                metalness: material.metalness,
                roughness: material.roughness,
                map:
                  texture === null || texture === undefined
                    ? "null"
                    : `${image?.width ?? "?"}x${image?.height ?? "?"}`,
              });
            }
          }
        }
      });
    }
    return report;
  }

  /** Reconcilia instâncias com a cena do frame e repinta uma vez. */
  sync(nodes: Scene3dNodes): void {
    this.nodes = nodes.models;
    this.syncModels(nodes.models);
    this.syncRoutes(nodes.routes);
    if (nodes.models.length > 0 || nodes.routes.length > 0) this.map.triggerRepaint();
  }

  private syncModels(nodes: readonly Model3dSceneNode[]): void {
    const wanted = new Set(nodes.map((node) => node.id));
    for (const [id, instance] of this.instances) {
      const node = nodes.find((candidate) => candidate.id === id);
      if (!wanted.has(id) || node === undefined || node.assetSrc !== instance.src) {
        this.scene.remove(instance.root);
        this.instances.delete(id);
      }
    }
    for (const node of nodes) {
      if (this.instances.has(node.id)) continue;
      void this.template(node.assetSrc).then((template) => {
        if (this.disposed || template === null) return;
        // O nó pode ter sumido ou trocado de asset enquanto o GLB carregava.
        const current = this.nodes.find((candidate) => candidate.id === node.id);
        if (current === undefined || current.assetSrc !== node.assetSrc) return;
        if (this.instances.has(node.id)) return;
        const root = template.clone(true);
        root.matrixAutoUpdate = false;
        this.instances.set(node.id, { root, src: node.assetSrc });
        this.scene.add(root);
        this.map.triggerRepaint();
      });
    }
  }

  private syncRoutes(routes: readonly Route3dSceneNode[]): void {
    const wanted = new Set(routes.map((route) => route.id));
    for (const [id, instance] of this.routes) {
      if (wanted.has(id)) continue;
      this.scene.remove(instance.group);
      this.disposeRoute(instance);
      this.routes.delete(id);
    }
    for (const node of routes) {
      const existing = this.routes.get(node.id);
      if (existing === undefined) {
        const created = this.createRoute(node);
        if (created !== null) {
          this.routes.set(node.id, created);
          this.scene.add(created.group);
        }
        continue;
      }
      this.updateRoute(existing, node);
    }
  }

  private createRoute(node: Route3dSceneNode): Route3dInstance | null {
    const built = buildRouteGeometry(node);
    if (built === null) return null;
    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(node.color),
      roughness: 0.34,
      metalness: 0.05,
      // A rota é sinalização, não um objeto físico: um pouco de emissivo garante
      // que ela leia sobre mapa escuro mesmo no lado sem luz do tubo.
      emissive: new THREE.Color(node.color),
      emissiveIntensity: 0.28,
      // O tubo é construído em espaço mercator, que é canhoto (y para o sul):
      // a orientação das faces não sobrevive à conversão, e o mundo dentro do
      // tubo nunca é visto de fora. `DoubleSide` sai mais barato que acertar o
      // winding para o caso que ninguém olha.
      side: THREE.DoubleSide,
    });
    const curtainMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(node.color),
      transparent: true,
      // A cortina é véu, não superfície: escrever profundidade faria ela ocluir
      // o próprio tubo e a aeronave.
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const tube = new THREE.Mesh(built.tube, tubeMaterial);
    const curtain = new THREE.Mesh(built.curtain, curtainMaterial);
    tube.frustumCulled = false;
    curtain.frustumCulled = false;
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(tube);
    group.add(curtain);
    const instance: Route3dInstance = {
      group,
      tube,
      tubeMaterial,
      curtain,
      curtainMaterial,
      origin: built.origin,
      node,
    };
    this.applyRouteAppearance(instance, node);
    return instance;
  }

  private updateRoute(instance: Route3dInstance, node: Route3dSceneNode): void {
    if (
      instance.node.widthMeters !== node.widthMeters ||
      !sameSamples(instance.node.samples, node.samples)
    ) {
      const built = buildRouteGeometry(node);
      if (built !== null) {
        instance.tube.geometry.dispose();
        instance.curtain.geometry.dispose();
        instance.tube.geometry = built.tube;
        instance.curtain.geometry = built.curtain;
        instance.origin = built.origin;
      }
    }
    this.applyRouteAppearance(instance, node);
    instance.node = node;
  }

  private applyRouteAppearance(instance: Route3dInstance, node: Route3dSceneNode): void {
    instance.tubeMaterial.color.set(node.color);
    instance.tubeMaterial.emissive.set(node.color);
    instance.tubeMaterial.opacity = node.opacity;
    instance.tubeMaterial.transparent = node.opacity < 1;
    instance.curtainMaterial.color.set(node.color);
    instance.curtainMaterial.opacity = node.opacity * node.curtainOpacity;
    instance.curtain.visible = node.curtainOpacity > 0 && node.opacity > 0;
    instance.tube.visible = node.opacity > 0;
  }

  private disposeRoute(instance: Route3dInstance): void {
    instance.tube.geometry.dispose();
    instance.curtain.geometry.dispose();
    instance.tubeMaterial.dispose();
    instance.curtainMaterial.dispose();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, mercator: ArrayLike<number>): void {
    if (this.renderer === null || (this.instances.size === 0 && this.routes.size === 0)) return;
    this.renderCount += 1;
    for (const node of this.nodes) {
      const instance = this.instances.get(node.id);
      if (instance === undefined) continue;
      instance.root.matrix.copy(modelMatrix(node));
      instance.root.matrixWorldNeedsUpdate = true;
    }
    for (const instance of this.routes.values()) {
      instance.group.matrix.makeTranslation(
        instance.origin.x,
        instance.origin.y,
        instance.origin.z,
      );
      instance.group.matrixWorldNeedsUpdate = true;
    }
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(mercator as number[]);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    // Diagnóstico de projeção: a origem do primeiro modelo em NDC. Fora de
    // [-1, 1] = fora da tela; |w| degenerado = matriz errada.
    const first = this.nodes.length > 0 ? this.instances.get(this.nodes[0]?.id ?? "") : undefined;
    if (first !== undefined) {
      const clip = new THREE.Vector4(0, 0, 0, 1)
        .applyMatrix4(first.root.matrix)
        .applyMatrix4(this.camera.projectionMatrix);
      this.lastNdc = [clip.x / clip.w, clip.y / clip.w, clip.z / clip.w];
    }
    this.renderer.resetState();
    // Depth buffer limpo, e depth test LIGADO nos materiais. Essa é a diferença
    // entre modelo 3D e adesivo:
    //
    // - Desligar o depth test (o que esta camada fazia antes) resolve o
    //   conflito com o mapa, mas mata a auto-oclusão: os triângulos pintam na
    //   ordem do buffer, a asa de trás cobre a fuselagem, o bocal do motor cobre
    //   a asa, e o modelo vira silhueta chapada.
    // - Limpar a profundidade aqui dá o buffer inteiro para a cena 3D: ela
    //   continua sempre por cima do mapa (o intended de um overlay), mas cada
    //   fragmento é testado contra os outros fragmentos DELA. Fuselagem oclui
    //   asa, aeronave oclui rota, e o volume aparece.
    //
    // O preço: quando a Fase 7B trouxer terreno, morro não vai ocluir aeronave.
    // Quando isso importar, o certo é ler a profundidade do mapa, não voltar a
    // desligar o teste.
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.renderer.render(this.scene, this.camera);
    // O `Context` do MapLibre cacheia estado de GL e só reemite quando o valor
    // muda ("all other state is restored on its own" no `setCustomLayerDefaults`).
    // O three deixa `depthMask` em false ao desenhar a cortina translúcida, e o
    // cache do mapa continuaria acreditando em true — a próxima camada que
    // pedisse escrita de profundidade não escreveria. Devolver o valor em que o
    // mapa acredita custa uma chamada.
    gl.depthMask(true);
  }

  /**
   * GLTF normalizado: centro na origem, dimensão máxima = 1. A escala visual
   * em metros vem da matriz do nó, não do tamanho de fábrica do arquivo.
   * `parse` com buffer (não `load` com URL): o renderer bloqueia fetch de
   * blob: por CSP, e o GLB é arquivo único — sem recursos externos.
   */
  private template(src: string): Promise<THREE.Object3D | null> {
    const cached = this.templates.get(src);
    if (cached !== undefined) return cached;
    const bytes = assetBytes(src);
    if (bytes === null) return Promise.resolve(null);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const promise = new Promise<THREE.Object3D | null>((resolve) => {
      this.loader.parse(
        buffer as ArrayBuffer,
        "",
        (gltf) => {
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDimension = Math.max(size.x, size.y, size.z);
          const normalizer = maxDimension > 0 ? 1 / maxDimension : 1;
          model.scale.setScalar(normalizer);
          model.position.copy(center.multiplyScalar(-normalizer));
          const wrapper = new THREE.Group();
          wrapper.add(model);
          // O wrapper é clonado por instância; o culling de esferas calculadas na
          // origem esconderia o modelo — as matrizes vêm do mundo mercator.
          // ATENÇÃO: o traverse precisa vir DEPOIS do add (antes ele rodava no
          // grupo vazio e nenhum ajuste chegava aos meshes de verdade).
          wrapper.traverse((object) => {
            object.frustumCulled = false;
            if (object instanceof THREE.Mesh) {
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              for (const material of materials) {
                // Depth test e depth write ligados: a auto-oclusão do modelo
                // depende dos dois. Quem garante que a cena 3D fica acima do
                // mapa é a limpeza de profundidade no `render`, não desligar o
                // teste aqui.
                material.depthTest = true;
                material.depthWrite = true;
                // Com environment map o metalness original ganha reflexos;
                // ainda assim limitamos um pouco para não virar espelho escuro.
                if (material instanceof THREE.MeshStandardMaterial) {
                  material.metalness = Math.min(material.metalness, 0.6);
                  material.roughness = Math.max(material.roughness, 0.45);
                }
              }
            }
          });
          resolve(wrapper);
        },
        (error: unknown) => {
          this.lastError =
            error instanceof Error
              ? error.message
              : typeof error === "object" && error !== null && "message" in error
                ? String((error as { message: unknown }).message)
                : String(error);
          resolve(null);
        },
      );
    });
    this.templates.set(src, promise);
    return promise;
  }
}

interface BuiltRoute {
  /** Origem em unidades mercator; o resto da geometria é relativo a ela. */
  readonly origin: THREE.Vector3;
  readonly tube: THREE.BufferGeometry;
  readonly curtain: THREE.BufferGeometry;
}

/**
 * Tubo e cortina de uma rota, em **unidades mercator relativas à origem da
 * rota**.
 *
 * Duas decisões que valem a pena entender:
 *
 * 1. **Unidade mercator, não pixel de mundo.** É a unidade que a `mainMatrix`
 *    consome (ver `modelMatrix`), e ela é invariante ao zoom: a geometria
 *    sobrevive a qualquer roda de mouse sem ser reconstruída, e a matriz do
 *    grupo é translação pura.
 * 2. **Relativa à origem.** As coordenadas mercator absolutas ficam perto de
 *    0,5 e o raio do tubo é da ordem de 1e-4 — quatro ordens de grandeza abaixo.
 *    Subtrair a origem devolve a precisão do float32 para a forma, e o
 *    deslocamento volta na translação da matriz.
 *
 * O raio é recalculado por amostra porque um metro em unidades mercator cresce
 * com a latitude: com raio fixo, uma rota Kiev→Murmansk afinaria visivelmente
 * ao norte.
 */
function buildRouteGeometry(node: Route3dSceneNode): BuiltRoute | null {
  const count = node.samples.length;
  if (count < 2) return null;

  const points: THREE.Vector3[] = [];
  const radii: number[] = [];
  const groundZ: number[] = [];
  for (const sample of node.samples) {
    const coordinate = MercatorCoordinate.fromLngLat(
      [sample.lngLat[0], sample.lngLat[1]],
      sample.altitudeMeters,
    );
    points.push(new THREE.Vector3(coordinate.x, coordinate.y, coordinate.z ?? 0));
    radii.push((coordinate.meterInMercatorCoordinateUnits() * node.widthMeters) / 2);
    groundZ.push(0);
  }
  const origin = points[0]?.clone() ?? new THREE.Vector3();
  for (let index = 0; index < count; index += 1) {
    groundZ[index] = -origin.z;
    points[index]?.sub(origin);
  }

  const tubeVertices = count * ROUTE_SIDES;
  const position = new Float32Array(tubeVertices * 3);
  const normal = new Float32Array(tubeVertices * 3);
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 0, 1);
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();
  const binormal = new THREE.Vector3();

  for (let ring = 0; ring < count; ring += 1) {
    const here = points[ring] as THREE.Vector3;
    const previous = points[Math.max(0, ring - 1)] as THREE.Vector3;
    const next = points[Math.min(count - 1, ring + 1)] as THREE.Vector3;
    tangent.subVectors(next, previous);
    if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);
    tangent.normalize();
    right.crossVectors(tangent, up);
    // Trecho vertical — míssil subindo a pique: a tangente fica paralela ao
    // "para cima" e o produto vetorial degenera. Qualquer perpendicular serve.
    if (right.lengthSq() < 1e-14) right.set(1, 0, 0).cross(tangent);
    right.normalize();
    binormal.crossVectors(right, tangent).normalize();
    const radius = radii[ring] as number;
    for (let side = 0; side < ROUTE_SIDES; side += 1) {
      const angle = (side / ROUTE_SIDES) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = right.x * cos + binormal.x * sin;
      const ny = right.y * cos + binormal.y * sin;
      const nz = right.z * cos + binormal.z * sin;
      const base = (ring * ROUTE_SIDES + side) * 3;
      position[base] = here.x + nx * radius;
      position[base + 1] = here.y + ny * radius;
      position[base + 2] = here.z + nz * radius;
      normal[base] = nx;
      normal[base + 1] = ny;
      normal[base + 2] = nz;
    }
  }
  for (let ring = 0; ring + 1 < count; ring += 1) {
    for (let side = 0; side < ROUTE_SIDES; side += 1) {
      const nextSide = (side + 1) % ROUTE_SIDES;
      const a = ring * ROUTE_SIDES + side;
      const b = ring * ROUTE_SIDES + nextSide;
      const c = (ring + 1) * ROUTE_SIDES + side;
      const d = (ring + 1) * ROUTE_SIDES + nextSide;
      indices.push(a, c, b, b, c, d);
    }
  }
  const tube = new THREE.BufferGeometry();
  tube.setAttribute("position", new THREE.BufferAttribute(position, 3));
  tube.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  tube.setIndex(indices);

  // Cortina: um par de vértices por amostra (rota e terreno abaixo dela) ligados
  // em faixa de quads. A cor é branca com alfa em rampa — o material multiplica
  // pela cor da rota, então a rampa não depende de espaço de cor.
  const curtainPosition = new Float32Array(count * 2 * 3);
  const curtainColor = new Float32Array(count * 2 * 4);
  const curtainIndices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const here = points[index] as THREE.Vector3;
    const top = index * 2 * 3;
    curtainPosition[top] = here.x;
    curtainPosition[top + 1] = here.y;
    curtainPosition[top + 2] = here.z;
    curtainPosition[top + 3] = here.x;
    curtainPosition[top + 4] = here.y;
    curtainPosition[top + 5] = groundZ[index] as number;
    const color = index * 2 * 4;
    // Mais densa junto da rota, dissolvendo perto do chão: assim a cortina
    // amarra a trajetória à altitude sem esconder o mapa.
    curtainColor.set([1, 1, 1, 1, 1, 1, 1, 0.28], color);
  }
  for (let index = 0; index + 1 < count; index += 1) {
    const a = index * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    curtainIndices.push(a, b, c, c, b, d);
  }
  const curtain = new THREE.BufferGeometry();
  curtain.setAttribute("position", new THREE.BufferAttribute(curtainPosition, 3));
  curtain.setAttribute("color", new THREE.BufferAttribute(curtainColor, 4));
  curtain.setIndex(curtainIndices);

  return { origin, tube, curtain };
}

function sameSamples(a: readonly Route3dSample[], b: readonly Route3dSample[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] as Route3dSample;
    const right = b[index] as Route3dSample;
    if (left.altitudeMeters !== right.altitudeMeters) return false;
    if (left.lngLat[0] !== right.lngLat[0] || left.lngLat[1] !== right.lngLat[1]) return false;
  }
  return true;
}

/**
 * Matriz do nó em **unidades mercator nos três eixos** (x leste, y sul, z para
 * cima), o espaço que `defaultProjectionData.mainMatrix` espera.
 *
 * Isto é a correção de um erro que custava o 3D inteiro. A camada usava
 * `args.modelViewProjectionMatrix` tratando o espaço dele como "pixels mercator
 * com z em pixels". Não é: o `_calcMatrices` do MapLibre monta essa matriz com
 * `scale(m, m, [1, 1, _pixelPerMeter])`, ou seja **ela já converte metros de
 * altitude**, e o z de entrada é em METROS, não em pixels. Passar
 * `coordinate.z * worldSize` fazia o `pixelsPerMeter` entrar duas vezes: a
 * escala vertical do modelo saía ~2000× menor que a horizontal (no zoom da
 * demo, `pixelsPerMeter` ≈ 5e-4). O GLB era literalmente prensado num plano —
 * e 90 km de altitude viravam centímetros. Nenhuma quantidade de luz ou depth
 * test conserta um modelo achatado por matriz.
 *
 * `mainMatrix` de `getProjectionDataForCustomLayer` é a saída certa: a própria
 * doc do MapLibre garante que, com `renderingMode: "3d"`, "a coordenada z é
 * conformal — uma caixa com x, y e z iguais em unidades mercator renderiza como
 * um cubo". Espaço isotrópico traz dois ganhos de graça: a escala do modelo
 * volta a ser uniforme (matriz de normais correta, logo iluminação correta) e a
 * geometria deixa de depender do zoom.
 *
 * Composição: translação para a posição mercator, escala com o Y negado (o
 * Y-mundo aponta para o sul, então a conversão de mão acontece aqui), modelo em
 * pé (Rx 90°) e rumo (Ry: o eixo Y do glTF vira o "para cima" depois do Rx).
 * Com o nariz do glTF em +Z, rumo b pede rotação de 180° − b.
 */
function modelMatrix(node: Model3dSceneNode): THREE.Matrix4 {
  const coordinate = MercatorCoordinate.fromLngLat(
    [node.lngLat[0], node.lngLat[1]],
    node.altitudeMeters,
  );
  const scale = coordinate.meterInMercatorCoordinateUnits() * node.scaleMeters;
  const heading = ((180 - node.headingDeg) * Math.PI) / 180;
  return new THREE.Matrix4()
    .makeTranslation(coordinate.x, coordinate.y, coordinate.z ?? 0)
    .multiply(new THREE.Matrix4().makeScale(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeRotationY(heading));
}

const runtimes = new WeakMap<MapLibreMap, Scene3dLayerRuntime>();

function runtimeFor(map: MapLibreMap): Scene3dLayerRuntime {
  let runtime = runtimes.get(map);
  if (runtime === undefined) {
    runtime = new Scene3dLayerRuntime(map);
    runtimes.set(map, runtime);
  }
  return runtime;
}

/**
 * Registra a camada custom no estilo atual. Idempotente: o `style.load` do
 * MapLibre dispara de novo a cada `setStyle`, e a camada precisa voltar.
 */
export function attachScene3dLayer(map: MapLibreMap): void {
  if (map.getLayer(SCENE3D_LAYER_ID) !== undefined) return;
  const layer: CustomLayerInterface = {
    id: SCENE3D_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd: (addedMap, gl) => runtimeFor(addedMap).attach(gl),
    // `mainMatrix`, não `modelViewProjectionMatrix`: só o primeiro é conformal
    // em z. Ver a nota longa em `modelMatrix`.
    render: (gl, args) => runtimeFor(map).render(gl, args.defaultProjectionData.mainMatrix),
  };
  map.addLayer(layer);
  if (import.meta.env.DEV) {
    const debugWindow = window as Scene3dDebugWindow;
    debugWindow.__theatrumScene3d = {
      status: () => runtimeFor(map).status(),
      materials: () => runtimeFor(map).materials(),
    };
  }
}

export function detachScene3dLayer(map: MapLibreMap): void {
  if (map.getLayer(SCENE3D_LAYER_ID) !== undefined) map.removeLayer(SCENE3D_LAYER_ID);
  runtimes.get(map)?.dispose();
  runtimes.delete(map);
}

/** Sync por frame, dirigido pelo SceneOverlay. Sem nós, a camada dorme. */
export function syncScene3dLayer(map: MapLibreMap, nodes: Scene3dNodes): void {
  if (map.getLayer(SCENE3D_LAYER_ID) === undefined) return;
  runtimeFor(map).sync(nodes);
}
