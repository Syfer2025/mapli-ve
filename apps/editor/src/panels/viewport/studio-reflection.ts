/**
 * Reflexo planar do piso do palco ([ADR-018](../../../../../docs/adr/ADR-018-studio-planar-floor-reflection.md)).
 *
 * O piso não é uma malha no mundo: é um quad de tela cheia cujo fragment shader
 * reconstrói o ponto em que cada raio cruza `y = 0`. Por isso o `Reflector` pronto
 * do Three não encaixa — ele depende do `onBeforeRender` de uma malha refletora.
 *
 * Este módulo adapta somente a matemática provada daquele `Reflector.js`:
 *
 * - espelha a câmera em `y = 0`;
 * - calcula a matriz de amostragem **antes** de alterar a projeção;
 * - transforma o piso no near plane da câmera espelhada por recorte oblíquo;
 * - desenha a cena sem o grid num target RGBA transparente;
 * - restaura em `finally` todo estado que o passe toca.
 *
 * Não há cache por pose. Câmera, modelo, material e luz podem mudar a cada frame,
 * e uma assinatura incompleta produziria um reflexo atrasado mas plausível.
 */

import * as THREE from "three";

const FLOOR_Y = 0;
const CAMERA_EPSILON = 1e-6;
const CLIP_DENOMINATOR_EPSILON = 1e-9;

/** O target usa metade do tamanho físico do canvas. */
export const REFLECTION_RESOLUTION_SCALE = 0.5;
/** Teto de custo do segundo passe colorido. */
export const REFLECTION_MAX_SIDE_PX = 1024;
/** Mesmo viés do `Reflector.js`: afasta o near plane o bastante para não faiscar. */
export const REFLECTION_CLIP_BIAS = 0.003;

export interface ReflectionTargetSize {
  readonly width: number;
  readonly height: number;
}

export interface ReflectionCameraPose {
  readonly position: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

export interface ReflectionProjection {
  readonly texture: THREE.Texture;
  /**
   * `bias × projection × view` da câmera espelhada, calculada antes do clip
   * oblíquo. Leva um ponto de mundo diretamente a UV homogêneo.
   */
  readonly matrix: THREE.Matrix4;
  /** Inverso de largura e altura do target, para o filtro curto do shader. */
  readonly texelSize: THREE.Vector2;
  readonly width: number;
  readonly height: number;
}

export interface StudioReflectionStatus {
  /** Passes concluídos; render que lançou não entra. */
  readonly renders: number;
  /** Tamanho alocado mais recente; zero antes do primeiro passe válido. */
  readonly width: number;
  readonly height: number;
}

export interface StudioReflectionProjector {
  /**
   * Renderiza o reflexo do frame corrente.
   *
   * `widthCss`/`heightCss` são o tamanho do canvas em CSS px. O DPR vem do
   * renderer, a mesma fonte que dimensiona o backing store do palco.
   */
  readonly update: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    hidden: readonly THREE.Object3D[],
    widthCss: number,
    heightCss: number,
  ) => ReflectionProjection | null;
  readonly status: () => StudioReflectionStatus;
  readonly dispose: () => void;
}

/**
 * Tamanho efetivo do target: 50% do canvas físico, sem ampliar e com maior lado
 * limitado a 1024 px.
 */
export function reflectionTargetSize(
  widthCss: number,
  heightCss: number,
  pixelRatio: number,
): ReflectionTargetSize {
  const safeWidth = Number.isFinite(widthCss) && widthCss > 0 ? widthCss : 1;
  const safeHeight = Number.isFinite(heightCss) && heightCss > 0 ? heightCss : 1;
  const safeRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const rawWidth = safeWidth * safeRatio * REFLECTION_RESOLUTION_SCALE;
  const rawHeight = safeHeight * safeRatio * REFLECTION_RESOLUTION_SCALE;
  const cap = Math.min(1, REFLECTION_MAX_SIDE_PX / Math.max(rawWidth, rawHeight));
  return Object.freeze({
    width: Math.max(1, Math.round(rawWidth * cap)),
    height: Math.max(1, Math.round(rawHeight * cap)),
  });
}

/** Espelha um ponto ou vetor no plano horizontal `y = 0`. */
export function reflectAcrossStudioFloor(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  return Object.freeze([value[0], FLOOR_Y * 2 - value[1], value[2]]);
}

/** Espelha os três componentes que definem a câmera, sem alterar a entrada. */
export function reflectCameraPoseAcrossStudioFloor(
  pose: ReflectionCameraPose,
): ReflectionCameraPose {
  return Object.freeze({
    position: reflectAcrossStudioFloor(pose.position),
    lookAt: reflectAcrossStudioFloor(pose.lookAt),
    // `up` é direção, não ponto. Como o plano passa pela origem, a mesma reflexão
    // troca somente o sinal de Y.
    up: reflectAcrossStudioFloor(pose.up),
  });
}

/**
 * Matriz que o shader do piso consome.
 *
 * É deliberadamente uma função separada do clip: o `Reflector.js` calcula UV com
 * a projeção original e só depois substitui a terceira linha para recortar. Usar
 * a projeção recortada aqui deforma a textura sobre o piso.
 */
export function reflectionSamplingMatrix(
  projection: THREE.Matrix4,
  view: THREE.Matrix4,
): THREE.Matrix4 {
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  return bias.multiply(projection).multiply(view);
}

/**
 * Faz `y = 0` virar o near plane da câmera espelhada.
 *
 * Adaptação da implementação de `three/examples/jsm/objects/Reflector.js`
 * (Three 0.185.1), que por sua vez implementa o recorte oblíquo de Lengyel.
 * Retorna uma nova matriz e nunca altera `projection` nem `view`.
 */
export function obliqueFloorProjection(
  projection: THREE.Matrix4,
  view: THREE.Matrix4,
  clipBias = REFLECTION_CLIP_BIAS,
): THREE.Matrix4 | null {
  const clipped = projection.clone();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);
  floor.applyMatrix4(view);
  const clipPlane = new THREE.Vector4(
    floor.normal.x,
    floor.normal.y,
    floor.normal.z,
    floor.constant,
  );
  const elements = clipped.elements;
  const projectionX = elements[0] ?? Number.NaN;
  const projectionY = elements[5] ?? Number.NaN;
  const projectionOffsetX = elements[8] ?? Number.NaN;
  const projectionOffsetY = elements[9] ?? Number.NaN;
  const projectionDepth = elements[10] ?? Number.NaN;
  const projectionDepthOffset = elements[14] ?? Number.NaN;
  if (
    ![
      projectionX,
      projectionY,
      projectionOffsetX,
      projectionOffsetY,
      projectionDepth,
      projectionDepthOffset,
    ].every(Number.isFinite) ||
    Math.abs(projectionX) < CLIP_DENOMINATOR_EPSILON ||
    Math.abs(projectionY) < CLIP_DENOMINATOR_EPSILON ||
    Math.abs(projectionDepthOffset) < CLIP_DENOMINATOR_EPSILON
  ) {
    return null;
  }
  const q = new THREE.Vector4(
    (Math.sign(clipPlane.x) + projectionOffsetX) / projectionX,
    (Math.sign(clipPlane.y) + projectionOffsetY) / projectionY,
    -1,
    (1 + projectionDepth) / projectionDepthOffset,
  );
  const denominator = clipPlane.dot(q);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < CLIP_DENOMINATOR_EPSILON) {
    return null;
  }
  clipPlane.multiplyScalar(2 / denominator);
  elements[2] = clipPlane.x;
  elements[6] = clipPlane.y;
  elements[10] = clipPlane.z + 1 - clipBias;
  elements[14] = clipPlane.w;
  return elements.every((value) => Number.isFinite(value)) ? clipped : null;
}

function sourceCameraPose(camera: THREE.PerspectiveCamera): ReflectionCameraPose {
  camera.updateMatrixWorld();
  const position = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorld);
  const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rotation).add(position);
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(rotation);
  return {
    position: [position.x, position.y, position.z],
    lookAt: [lookAt.x, lookAt.y, lookAt.z],
    up: [up.x, up.y, up.z],
  };
}

/**
 * Configura a câmera interna e devolve a matriz de amostragem não recortada.
 * `null` significa que a câmera está do lado em que o piso refletor não é visível.
 */
function configureReflectionCamera(
  source: THREE.PerspectiveCamera,
  reflected: THREE.PerspectiveCamera,
): THREE.Matrix4 | null {
  const sourcePose = sourceCameraPose(source);
  if (sourcePose.position[1] <= FLOOR_Y + CAMERA_EPSILON) return null;
  const pose = reflectCameraPoseAcrossStudioFloor(sourcePose);

  reflected.position.fromArray(pose.position);
  reflected.up.fromArray(pose.up);
  reflected.lookAt(...pose.lookAt);
  reflected.near = source.near;
  reflected.far = source.far;
  reflected.fov = source.fov;
  reflected.aspect = source.aspect;
  reflected.zoom = source.zoom;
  reflected.layers.mask = source.layers.mask;
  reflected.updateMatrixWorld();
  // Primeiro a projeção original...
  reflected.projectionMatrix.copy(source.projectionMatrix);
  reflected.projectionMatrixInverse.copy(source.projectionMatrixInverse);
  const sampling = reflectionSamplingMatrix(
    reflected.projectionMatrix,
    reflected.matrixWorldInverse,
  );
  // ...e só depois o near plane oblíquo usado para desenhar.
  const clipped = obliqueFloorProjection(reflected.projectionMatrix, reflected.matrixWorldInverse);
  if (clipped === null) return null;
  reflected.projectionMatrix.copy(clipped);
  reflected.projectionMatrixInverse.copy(clipped).invert();
  return sampling;
}

export function createStudioReflectionProjector(): StudioReflectionProjector {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    format: THREE.RGBAFormat,
    // O passe guarda luz linear antes do ACES. RGBA8 cortaria highlights em 1
    // antes que o shader do piso pudesse aplicar a mesma curva do modelo direto.
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  target.texture.name = "studio-floor-reflection";
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;
  target.texture.generateMipmaps = false;

  const reflectedCamera = new THREE.PerspectiveCamera();
  const matrix = new THREE.Matrix4();
  const texelSize = new THREE.Vector2(1, 1);
  let width = 0;
  let height = 0;
  let renders = 0;
  let rendering = false;
  let disposed = false;

  return {
    update: (renderer, scene, camera, hidden, widthCss, heightCss) => {
      if (
        disposed ||
        rendering ||
        !Number.isFinite(widthCss) ||
        !Number.isFinite(heightCss) ||
        widthCss <= 0 ||
        heightCss <= 0
      ) {
        return null;
      }

      const sampling = configureReflectionCamera(camera, reflectedCamera);
      if (sampling === null) return null;

      const nextSize = reflectionTargetSize(widthCss, heightCss, renderer.getPixelRatio());
      if (nextSize.width !== width || nextSize.height !== height) {
        target.setSize(nextSize.width, nextSize.height);
        width = nextSize.width;
        height = nextSize.height;
        texelSize.set(1 / width, 1 / height);
      }
      matrix.copy(sampling);

      const previousTarget = renderer.getRenderTarget();
      const previousCubeFace = renderer.getActiveCubeFace();
      const previousMipmapLevel = renderer.getActiveMipmapLevel();
      const previousViewport = renderer.getViewport(new THREE.Vector4());
      const previousScissor = renderer.getScissor(new THREE.Vector4());
      const previousScissorTest = renderer.getScissorTest();
      const previousClearColor = renderer.getClearColor(new THREE.Color());
      const previousClearAlpha = renderer.getClearAlpha();
      const previousAutoClear = renderer.autoClear;
      const previousXrEnabled = renderer.xr.enabled;
      const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
      const context = renderer.getContext();
      const previousDepthMask = Boolean(context.getParameter(context.DEPTH_WRITEMASK));
      const colorMask = context.getParameter(context.COLOR_WRITEMASK) as
        readonly boolean[] | boolean;
      const previousColorMask = Array.isArray(colorMask) ? (colorMask[0] ?? true) : colorMask;
      const previousBackground = scene.background;
      const previousOverride = scene.overrideMaterial;
      const previousVisibility = hidden.map((object) => object.visible);

      rendering = true;
      try {
        for (const object of hidden) object.visible = false;
        // Fundo transparente: environment continua iluminando materiais, mas não
        // vira tinta em todo o target.
        scene.background = null;
        scene.overrideMaterial = null;
        renderer.xr.enabled = false;
        renderer.shadowMap.autoUpdate = false;
        renderer.autoClear = false;
        renderer.setRenderTarget(target);
        renderer.setViewport(0, 0, width, height);
        renderer.setScissor(0, 0, width, height);
        renderer.setScissorTest(false);
        renderer.setClearColor(0x000000, 0);
        // Padrão usado pelo Reflector do Three: garante que os buffers podem ser
        // limpos mesmo se o material anterior deixou escrita desligada. O finally
        // devolve as duas máscaras ao valor de entrada.
        renderer.state.buffers.depth.setMask(true);
        renderer.state.buffers.color.setMask(true);
        renderer.clear(true, true, false);
        renderer.render(scene, reflectedCamera);
        renders += 1;
        return {
          texture: target.texture,
          matrix,
          texelSize,
          width,
          height,
        };
      } finally {
        renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
        renderer.setViewport(previousViewport);
        renderer.setScissor(previousScissor);
        renderer.setScissorTest(previousScissorTest);
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.autoClear = previousAutoClear;
        renderer.xr.enabled = previousXrEnabled;
        renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
        renderer.state.buffers.depth.setMask(previousDepthMask);
        renderer.state.buffers.color.setMask(previousColorMask);
        scene.background = previousBackground;
        scene.overrideMaterial = previousOverride;
        hidden.forEach((object, index) => {
          object.visible = previousVisibility[index] ?? true;
        });
        rendering = false;
      }
    },
    status: () => Object.freeze({ renders, width, height }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      target.dispose();
    },
  };
}
