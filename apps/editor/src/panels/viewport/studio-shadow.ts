/**
 * Sombra do palco como **silhueta projetada**.
 *
 * A primeira versão desenhava uma elipse analítica a partir da caixa envolvente,
 * e o dono matou na hora, com razão: elipse não é silhueta. Um caça tem asas,
 * deriva e tanques externos, e uma mancha oval centrada no objeto lê como um
 * borrão flutuando embaixo dele, não como sombra dele.
 *
 * Aqui a sombra é a forma de verdade. O modelo é renderizado **visto da luz**, em branco
 * sobre preto, numa textura fora de tela por uma câmera ortográfica; o shader do chão
 * projeta cada pixel do piso nessa textura e escurece o que caiu dentro da silhueta. É a
 * mesma matemática de um shadow map, sem comparação de profundidade — o receptor é um plano
 * e o emissor está acima dele, então todo ponto do piso cujo raio de luz atravessa o objeto
 * está na sombra, e não há o que comparar.
 *
 * **A luz era assumida vertical, e deixou de ser.** Projetar de cima dá uma mancha embaixo
 * do objeto; projetar da direção da luz dá sombra que se estica para um lado, que é metade
 * da composição de um plano de apresentação. O preço é que o retângulo da textura tem de
 * conter a **sombra**, não a pegada — com luz a 23° a sombra vai a 2,3 alturas de distância
 * — e é o que `fitLightFrustum` resolve. Luz rente ao horizonte recua para a projeção
 * vertical: a sombra tenderia ao infinito e a silhueta sairia com um texel de altura.
 *
 * A suavidade continua vindo de amostrar a textura em disco, e não de penumbra geométrica:
 * é o que tira a borda dura sem fingir uma física que não estamos simulando.
 *
 * Duas razões para a câmera ortográfica e não perspectiva: sombra de luz distante
 * não deforma com a altura, e a projeção inversa no shader fica sendo uma
 * multiplicação de matriz em vez de uma divisão por profundidade que precisaria
 * de cuidado com o zero.
 */

import * as THREE from "three";

/** Lado da textura de sombra. 1024 dá silhueta limpa até em asa fina. */
const SHADOW_SIZE = 1024;

/** Margem em volta da pegada, para o desfoque ter para onde crescer. */
const MARGIN = 0.35;

/**
 * Elevação mínima da luz, em graus, para efeito de sombra.
 *
 * Com a luz rente ao horizonte a sombra tende ao infinito, e o retângulo da textura teria
 * de cobrir o palco todo para conter uma silhueta que sairia com um texel de altura. Oito
 * graus já é uma sombra bem esticada e mantém a textura útil.
 */
const MIN_LIGHT_ELEVATION_DEG = 8;

/**
 * Base da câmera de luz: para onde ela olha, e o que é largura e altura na textura.
 *
 * `direction` aponta **da cena para a luz**, a mesma convenção de `position` de uma
 * `DirectionalLight` do three. `null` quando a direção é degenerada — vetor nulo ou
 * apontando para baixo, que descreveria luz vindo de dentro do chão.
 *
 * A escolha de `up` é o detalhe que morde: com a luz quase no zênite, um `up` fixo em Y
 * fica paralelo à direção de vista e a matriz degenera — foi por isso que a versão vertical
 * deste projetor usava `up` em −Z. Aqui o `up` sai de um produto vetorial com o eixo menos
 * alinhado à direção, o que nunca degenera.
 */
export function lightBasis(direction: readonly [number, number, number]): {
  readonly forward: readonly [number, number, number];
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
} | null {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  const toLight: readonly [number, number, number] = [
    direction[0] / length,
    direction[1] / length,
    direction[2] / length,
  ];
  if (toLight[1] <= Math.sin((MIN_LIGHT_ELEVATION_DEG * Math.PI) / 180) * 0.999) {
    // Luz baixa demais: quem chama recua para a projeção vertical, que é o que sempre
    // funciona. Devolver uma base aqui produziria sombra maior que a textura.
    return null;
  }
  // A câmera olha da luz para a cena: o oposto de "para a luz".
  const forward: readonly [number, number, number] = [-toLight[0], -toLight[1], -toLight[2]];
  // O eixo de referência menos alinhado com `forward` — assim o produto vetorial nunca
  // sai curto.
  const reference: readonly [number, number, number] =
    Math.abs(forward[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
  const right = normalize(cross(forward, reference));
  if (right === null) return null;
  return { forward, right, up: cross(right, forward) };
}

/**
 * O retângulo ortográfico que contém a caixa do objeto **vista da luz**.
 *
 * Com luz oblíqua a sombra sai da pegada: um objeto de altura `h` com luz a 23° projeta
 * sombra a `h / tan(23°)` ≈ 2,3 `h` de distância. Ajustar o retângulo à pegada — que é o
 * que a versão vertical fazia, e estava certo para luz vertical — cortaria a sombra pela
 * metade. Aqui os oito cantos da caixa entram no espaço da câmera de luz e o retângulo se
 * ajusta ao que eles ocupam, o que vale para qualquer inclinação sem caso especial.
 */
export function fitLightFrustum(
  corners: readonly (readonly [number, number, number])[],
  origin: readonly [number, number, number],
  basis: {
    readonly forward: readonly [number, number, number];
    readonly right: readonly [number, number, number];
    readonly up: readonly [number, number, number];
  },
): { readonly halfWidth: number; readonly halfHeight: number; readonly depth: number } | null {
  if (corners.length === 0) return null;
  let maxRight = 0;
  let maxUp = 0;
  let maxDepth = 0;
  for (const corner of corners) {
    const dx = corner[0] - origin[0];
    const dy = corner[1] - origin[1];
    const dz = corner[2] - origin[2];
    maxRight = Math.max(
      maxRight,
      Math.abs(dx * basis.right[0] + dy * basis.right[1] + dz * basis.right[2]),
    );
    maxUp = Math.max(maxUp, Math.abs(dx * basis.up[0] + dy * basis.up[1] + dz * basis.up[2]));
    maxDepth = Math.max(
      maxDepth,
      Math.abs(dx * basis.forward[0] + dy * basis.forward[1] + dz * basis.forward[2]),
    );
  }
  return {
    halfWidth: Math.max(0.25, maxRight * (1 + MARGIN)),
    halfHeight: Math.max(0.25, maxUp * (1 + MARGIN)),
    depth: Math.max(1, maxDepth),
  };
}

function normalize(
  vector: readonly [number, number, number],
): readonly [number, number, number] | null {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export interface ShadowSubject {
  readonly root: THREE.Object3D;
  /** Centro em (x, z) e altura da base, em metros do palco. */
  readonly center: readonly [number, number];
  readonly halfX: number;
  readonly halfZ: number;
  readonly heightMeters: number;
  readonly opacity: number;
}

export interface ShadowProjection {
  readonly texture: THREE.Texture;
  /** `projection * view` da câmera de cima: leva mundo em UV no shader. */
  readonly matrix: THREE.Matrix4;
  /** Raio do desfoque em texels; cresce com a altura do objeto. */
  readonly softnessTexels: number;
  /** 0 quando não há nada para projetar. */
  readonly coverage: number;
}

export interface StudioShadowProjector {
  /**
   * Repinta a textura se algo mudou, e devolve o que o chão precisa. `null`
   * quando não há objeto visível.
   */
  readonly update: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    hidden: readonly THREE.Object3D[],
    subjects: readonly ShadowSubject[],
    /**
     * Direção **da cena para a luz**, a convenção de `position` da `DirectionalLight`.
     *
     * Omitida ou baixa demais, a projeção volta a ser vertical — que é o que sempre
     * funcionou e continua sendo o recuo honesto.
     */
    lightDirection?: readonly [number, number, number],
  ) => ShadowProjection | null;
  readonly dispose: () => void;
}

export function createStudioShadowProjector(): StudioShadowProjector {
  const target = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
    // Uma silhueta é uma máscara: um canal basta, e filtrar linear é o que dá a
    // borda suave de graça na amostragem.
    format: THREE.RedFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  // `up` no eixo -Z: olhando para baixo, é ele que fixa a orientação da imagem.
  // Sem isso a matriz de vista fica degenerada (up paralelo à direção de vista).
  camera.up.set(0, 0, -1);

  // Branco puro, sem luz nem profundidade de material: o que interessa é a
  // cobertura, e qualquer sombreamento aqui só sujaria a máscara.
  const mask = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const matrix = new THREE.Matrix4();
  let coverage = 0;
  let softnessTexels = 6;

  return {
    update: (renderer, scene, hidden, subjects, lightDirection) => {
      const visible = subjects.filter((subject) => subject.opacity > 0);
      if (visible.length === 0) {
        coverage = 0;
        return null;
      }

      // Pegada de tudo junto, em metros.
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let height = 0;
      let strongest = 0;
      for (const subject of visible) {
        minX = Math.min(minX, subject.center[0] - subject.halfX);
        maxX = Math.max(maxX, subject.center[0] + subject.halfX);
        minZ = Math.min(minZ, subject.center[1] - subject.halfZ);
        maxZ = Math.max(maxZ, subject.center[1] + subject.halfZ);
        strongest = Math.max(strongest, subject.opacity);
        // O frustum precisa conter o MAIS ALTO, não o mais opaco. Misturar as
        // duas decisões recortava um segundo objeto alto quando as opacidades
        // empatavam ou quando o objeto baixo era ligeiramente mais forte.
        height = Math.max(height, subject.heightMeters);
      }
      const spanX = Math.max(0.5, maxX - minX);
      const spanZ = Math.max(0.5, maxZ - minZ);
      const half = (Math.max(spanX, spanZ) / 2) * (1 + MARGIN);
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;

      // Objeto no ar espalha e dilui a sombra. Relativo ao próprio tamanho: um
      // caça a 2 m do chão e um míssil a 2 m não estão igualmente soltos.
      const lift = Math.min(1, Math.max(0, height) / Math.max(0.5, half));
      softnessTexels = 4 + lift * 26;
      coverage = strongest * (1 - lift * 0.45);

      /**
       * Sem cache por assinatura.
       *
       * A sombra é função do frame corrente. Uma chave que arredondava matrizes e
       * ignorava identidade/revisão da geometria fazia B depender de A: trocar
       * asset por outro com caixa parecida ou animar abaixo da quantização podia
       * devolver a textura anterior. O passe custa menos que aceitar essa violação
       * silenciosa; se voltar a haver cache, ele precisa ser exato e provado.
       */
      const basis = lightDirection === undefined ? null : lightBasis(lightDirection);

      {
        // Alto o bastante para nada ficar atrás do plano próximo, e o far cobre
        // o objeto inteiro mesmo suspenso.
        const top = Math.max(10, height + half * 4);
        if (basis === null) {
          // Recuo vertical: luz no zênite, ou baixa demais para caber na textura.
          camera.position.set(centerX, top, centerZ);
          camera.up.set(0, 0, -1);
          camera.lookAt(centerX, 0, centerZ);
          camera.left = -half;
          camera.right = half;
          camera.top = half;
          camera.bottom = -half;
          camera.near = 0.1;
          camera.far = top + half * 4;
        } else {
          /**
           * Sombra direcional: a câmera vai para o lado da luz.
           *
           * O retângulo se ajusta aos oito cantos da caixa **vistos da luz**, e não à
           * pegada — com luz oblíqua a sombra sai da pegada, e ajustar por ela cortaria a
           * sombra ao meio. Ver `fitLightFrustum`.
           */
          const boxTop = Math.max(0.25, height + half);
          const corners: (readonly [number, number, number])[] = [];
          for (const x of [centerX - half, centerX + half]) {
            for (const y of [0, boxTop]) {
              for (const z of [centerZ - half, centerZ + half]) corners.push([x, y, z]);
            }
          }
          // A câmera parte do centro da caixa, recuada na direção da luz o bastante para
          // a caixa inteira ficar à frente do plano próximo.
          const pivot: readonly [number, number, number] = [centerX, boxTop / 2, centerZ];
          const fit = fitLightFrustum(corners, pivot, basis);
          if (fit === null) return null;
          const back = fit.depth + Math.max(1, half);
          camera.position.set(
            pivot[0] - basis.forward[0] * back,
            pivot[1] - basis.forward[1] * back,
            pivot[2] - basis.forward[2] * back,
          );
          camera.up.set(basis.up[0], basis.up[1], basis.up[2]);
          camera.lookAt(pivot[0], pivot[1], pivot[2]);
          camera.left = -fit.halfWidth;
          camera.right = fit.halfWidth;
          camera.top = fit.halfHeight;
          camera.bottom = -fit.halfHeight;
          camera.near = 0.1;
          camera.far = back + fit.depth * 2 + half * 2;
        }
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

        // O chão e o que mais estiver na cena saem do caminho: a máscara é só dos
        // objetos. Com o chão dentro, a textura sairia inteira branca.
        const wasVisible = hidden.map((object) => object.visible);
        const previousTarget = renderer.getRenderTarget();
        const previousCubeFace = renderer.getActiveCubeFace();
        const previousMipmapLevel = renderer.getActiveMipmapLevel();
        const previousOverride = scene.overrideMaterial;
        const previousBackground = scene.background;
        const previousViewport = renderer.getViewport(new THREE.Vector4());
        const previousScissor = renderer.getScissor(new THREE.Vector4());
        const previousScissorTest = renderer.getScissorTest();
        const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
        const previousClearAlpha = renderer.getClearAlpha();
        const previousXrEnabled = renderer.xr.enabled;
        const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        const context = renderer.getContext();
        const previousDepthMask = Boolean(context.getParameter(context.DEPTH_WRITEMASK));
        const colorMask = context.getParameter(context.COLOR_WRITEMASK) as
          readonly boolean[] | boolean;
        const previousColorMask = Array.isArray(colorMask) ? (colorMask[0] ?? true) : colorMask;
        try {
          for (const object of hidden) object.visible = false;
          scene.background = null;
          scene.overrideMaterial = mask;
          renderer.xr.enabled = false;
          renderer.shadowMap.autoUpdate = false;
          renderer.setRenderTarget(target);
          renderer.setClearColor(0x000000, 1);
          // `clear()` respeita as máscaras de escrita do WebGL. Um material do
          // passe anterior pode tê-las deixado desligadas; abra para limpar o
          // target e devolva exatamente o estado observado no `finally`.
          renderer.state.buffers.depth.setMask(true);
          renderer.state.buffers.color.setMask(true);
          renderer.clear(true, true, false);
          renderer.render(scene, camera);
        } finally {
          renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
          renderer.setViewport(previousViewport);
          renderer.setScissor(previousScissor);
          renderer.setScissorTest(previousScissorTest);
          renderer.setClearColor(previousClearColor, previousClearAlpha);
          renderer.xr.enabled = previousXrEnabled;
          renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
          renderer.state.buffers.depth.setMask(previousDepthMask);
          renderer.state.buffers.color.setMask(previousColorMask);
          scene.background = previousBackground;
          scene.overrideMaterial = previousOverride;
          hidden.forEach((object, index) => {
            object.visible = wasVisible[index] ?? true;
          });
        }
      }

      return { texture: target.texture, matrix, softnessTexels, coverage };
    },
    dispose: () => {
      target.dispose();
      mask.dispose();
    },
  };
}
