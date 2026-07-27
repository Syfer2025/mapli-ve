/**
 * Camada de modelos 3D do viewport — MapLibre custom layer + Three.js, no
 * mesmo canvas e contexto WebGL do mapa (o padrão canônico "add a 3D model").
 *
 * Os nós `model3d` do documento não têm primitiva Pixi (`noVisual`): quem os
 * desenha é esta camada, a partir da cena avaliada — âncora geo e rumo já
 * resolvidos pelos comportamentos (`motion-path` contribui âncora no caminho
 * e rotação em `geo-bearing`). O sync é chamado pelo `SceneOverlay` a cada
 * frame renderizado; fora dele a camada não repinta sozinha, para não queimar
 * GPU com o mapa parado.
 *
 * Escopo honesto: isto é preview de viewport. O export determinístico (Fase 8)
 * ainda não captura WebGL do mapa; opacidade hierárquica também não é aplicada
 * ao modelo (materiais GLTF são compartilhados entre instâncias).
 */

import { type EvaluatedScene } from "@theatrum/animation";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type Map as MapLibreMap,
} from "maplibre-gl";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetBytes } from "../../assets/asset-media.js";

export const MODEL3D_LAYER_ID = "theatrum-model3d";

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

interface Model3dInstance {
  readonly root: THREE.Object3D;
  readonly src: string;
}

interface Model3dDebugWindow extends Window {
  __theatrumModel3d?: {
    readonly status: () => {
      readonly nodes: number;
      readonly loaded: number;
      readonly pending: number;
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

function numberProp(
  props: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

class Model3dLayerRuntime {
  private readonly map: MapLibreMap;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly instances = new Map<string, Model3dInstance>();
  private renderer: THREE.WebGLRenderer | null = null;
  private nodes: readonly Model3dSceneNode[] = [];
  private lastError: string | null = null;
  private renderCount = 0;
  private lastNdc: readonly [number, number, number] | null = null;
  private disposed = false;

  constructor(map: MapLibreMap) {
    this.map = map;
    // Luz de preenchimento moderada: o environment map (RoomEnvironment) já
    // carrega boa parte da iluminação — exagerar aqui estoura o modelo em branco.
    this.scene.add(new THREE.HemisphereLight(0xe8eef4, 0x2c3833, 0.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(0.4, -0.6, 1);
    this.scene.add(sun);
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
    // Environment map: dá reflexos e volume aos PBR (sem ele o modelo fica "chapado").
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  dispose(): void {
    this.disposed = true;
    for (const instance of this.instances.values()) this.scene.remove(instance.root);
    this.instances.clear();
    this.templates.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }

  status(): {
    nodes: number;
    loaded: number;
    pending: number;
    renders: number;
    ndc: readonly [number, number, number] | null;
    lastError: string | null;
  } {
    return {
      nodes: this.nodes.length,
      loaded: this.instances.size,
      pending: this.nodes.length - this.instances.size,
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

  /** Reconcilia instâncias com a lista de nós e repinta uma vez. */
  sync(nodes: readonly Model3dSceneNode[]): void {
    this.nodes = nodes;
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
    if (nodes.length > 0) this.map.triggerRepaint();
  }

  render(modelViewProjectionMatrix: ArrayLike<number>): void {
    if (this.renderer === null || this.instances.size === 0) return;
    this.renderCount += 1;
    const worldSize = worldSizeOf(this.map);
    for (const node of this.nodes) {
      const instance = this.instances.get(node.id);
      if (instance === undefined) continue;
      instance.root.matrix.copy(modelMatrix(node, worldSize));
      instance.root.matrixWorldNeedsUpdate = true;
    }
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(
      modelViewProjectionMatrix as number[],
    );
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
    this.renderer.render(this.scene, this.camera);
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
            // Sem teste de profundidade contra o mapa: o centro do modelo fica
            // no plano do terreno (z≈0) e o depth buffer do MapLibre venceria a
            // metade de baixo. O modelo é overlay de mapa — sempre por cima.
            if (object instanceof THREE.Mesh) {
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              for (const material of materials) {
                material.depthTest = false;
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

/**
 * Matriz do nó no espaço-mundo do MapLibre v5: **pixels mercator no zoom
 * atual** (x leste, y sul, z para cima em pixels por metro). O
 * `modelViewProjectionMatrix` do custom render NÃO usa mercator 0..1 (essa é
 * a `mercatorMatrix` interna) — provado pelo `_calcMatrices` do Transform:
 * translação `[-x, -y]` com `projectToWorldCoordinates(worldSize, center)` e
 * escala z `_pixelPerMeter`.
 *
 * Composição: translação para a posição projetada, escala com o Y negado
 * (o Y-mundo aponta para o sul), modelo em pé (Rx 90°) e rumo (Ry: o eixo Y
 * do glTF vira o "para cima" depois do Rx). Com o nariz do glTF em +Z, rumo
 * b pede rotação de 180° − b.
 */
function modelMatrix(node: Model3dSceneNode, worldSize: number): THREE.Matrix4 {
  const coordinate = MercatorCoordinate.fromLngLat(
    [node.lngLat[0], node.lngLat[1]],
    node.altitudeMeters,
  );
  const pixelsPerMeter = coordinate.meterInMercatorCoordinateUnits() * worldSize;
  const scale = pixelsPerMeter * node.scaleMeters;
  const heading = ((180 - node.headingDeg) * Math.PI) / 180;
  return new THREE.Matrix4()
    .makeTranslation(
      coordinate.x * worldSize,
      coordinate.y * worldSize,
      (coordinate.z ?? 0) * worldSize,
    )
    .multiply(new THREE.Matrix4().makeScale(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeRotationY(heading));
}

/** worldSize = 512·2^zoom; `map.transform` é interno, então há fallback. */
function worldSizeOf(map: MapLibreMap): number {
  const transform = (map as unknown as { transform?: { worldSize?: number } }).transform;
  return typeof transform?.worldSize === "number" && transform.worldSize > 0
    ? transform.worldSize
    : 512 * 2 ** map.getZoom();
}

const runtimes = new WeakMap<MapLibreMap, Model3dLayerRuntime>();

function runtimeFor(map: MapLibreMap): Model3dLayerRuntime {
  let runtime = runtimes.get(map);
  if (runtime === undefined) {
    runtime = new Model3dLayerRuntime(map);
    runtimes.set(map, runtime);
  }
  return runtime;
}

/**
 * Registra a camada custom no estilo atual. Idempotente: o `style.load` do
 * MapLibre dispara de novo a cada `setStyle`, e a camada precisa voltar.
 */
export function attachModel3dLayer(map: MapLibreMap): void {
  if (map.getLayer(MODEL3D_LAYER_ID) !== undefined) return;
  const layer: CustomLayerInterface = {
    id: MODEL3D_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd: (addedMap, gl) => runtimeFor(addedMap).attach(gl),
    render: (_gl, args) => runtimeFor(map).render(args.modelViewProjectionMatrix),
  };
  map.addLayer(layer);
  if (import.meta.env.DEV) {
    const debugWindow = window as Model3dDebugWindow;
    debugWindow.__theatrumModel3d = {
      status: () => runtimeFor(map).status(),
      materials: () => runtimeFor(map).materials(),
    };
  }
}

export function detachModel3dLayer(map: MapLibreMap): void {
  if (map.getLayer(MODEL3D_LAYER_ID) !== undefined) map.removeLayer(MODEL3D_LAYER_ID);
  runtimes.get(map)?.dispose();
  runtimes.delete(map);
}

/** Sync por frame, dirigido pelo SceneOverlay. Sem nós, a camada dorme. */
export function syncModel3dLayer(map: MapLibreMap, nodes: readonly Model3dSceneNode[]): void {
  if (map.getLayer(MODEL3D_LAYER_ID) === undefined) return;
  runtimeFor(map).sync(nodes);
}
