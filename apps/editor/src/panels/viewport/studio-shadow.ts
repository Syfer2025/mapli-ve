/**
 * Sombra do palco como **silhueta projetada**.
 *
 * A primeira versão desenhava uma elipse analítica a partir da caixa envolvente,
 * e o dono matou na hora, com razão: elipse não é silhueta. Um caça tem asas,
 * deriva e tanques externos, e uma mancha oval centrada no objeto lê como um
 * borrão flutuando embaixo dele, não como sombra dele.
 *
 * Aqui a sombra é a forma de verdade. O modelo é renderizado **visto de cima**,
 * em branco sobre preto, numa textura fora de tela por uma câmera ortográfica; o
 * shader do chão projeta cada pixel do piso nessa textura e escurece o que caiu
 * dentro da silhueta. É a mesma matemática de um shadow map, com uma
 * simplificação honesta: a luz é vertical e paralela, então não há penumbra
 * geométrica a calcular — a suavidade vem de amostrar a textura em disco, e é o
 * que tira a borda dura sem fingir uma física que não estamos simulando.
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
  let signature = "";
  let coverage = 0;
  let softnessTexels = 6;

  return {
    update: (renderer, scene, hidden, subjects) => {
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
        if (subject.opacity > strongest) {
          strongest = subject.opacity;
          height = subject.heightMeters;
        }
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

      // Repinta só quando algo que muda a silhueta mudou. A câmera do palco não
      // entra: sombra de luz vertical não depende de quem está olhando, e
      // repintar 1024² por órbita seria desperdício puro.
      const next = visible
        .map(
          (subject) =>
            `${subject.center[0].toFixed(3)},${subject.center[1].toFixed(3)},${subject.halfX.toFixed(3)},${subject.halfZ.toFixed(3)},${subject.heightMeters.toFixed(3)},${subject.root.matrix.elements.map((value) => value.toFixed(4)).join("")}`,
        )
        .join("|");
      const changed = next !== signature;
      signature = next;

      if (changed) {
        // Alto o bastante para nada ficar atrás do plano próximo, e o far cobre
        // o objeto inteiro mesmo suspenso.
        const top = Math.max(10, height + half * 4);
        camera.position.set(centerX, top, centerZ);
        camera.lookAt(centerX, 0, centerZ);
        camera.left = -half;
        camera.right = half;
        camera.top = half;
        camera.bottom = -half;
        camera.near = 0.1;
        camera.far = top + half * 4;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

        // O chão e o que mais estiver na cena saem do caminho: a máscara é só dos
        // objetos. Com o chão dentro, a textura sairia inteira branca.
        const wasVisible = hidden.map((object) => object.visible);
        for (const object of hidden) object.visible = false;
        const previousTarget = renderer.getRenderTarget();
        const previousOverride = scene.overrideMaterial;
        scene.overrideMaterial = mask;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        renderer.setRenderTarget(previousTarget);
        scene.overrideMaterial = previousOverride;
        hidden.forEach((object, index) => {
          object.visible = wasVisible[index] ?? true;
        });
      }

      return { texture: target.texture, matrix, softnessTexels, coverage };
    },
    dispose: () => {
      target.dispose();
      mask.dispose();
    },
  };
}
