/**
 * O que a camada 3D do mapa e o palco do estúdio têm em comum: carregar um GLB,
 * normalizá-lo e montar o environment map.
 *
 * O [ADR-012](../../../../../docs/adr/ADR-012-studio-own-canvas.md) escolheu dar
 * um contexto WebGL próprio ao estúdio e listou o preço: duas cópias da carga de
 * modelo e da iluminação. Este módulo é o pagamento — porque duas cópias
 * divergem no primeiro ajuste que alguém faz numa delas, e aí o mesmo caça fica
 * com um metalness no mapa e outro no palco.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetBytes } from "../../assets/asset-media.js";

/** Resultado da normalização: o modelo mais o raio que ele ocupa. */
export interface ModelTemplate {
  /** Centrado na origem, dimensão máxima = 1. A escala real vem da matriz do nó. */
  readonly root: THREE.Object3D;
  /**
   * Raio da esfera que envolve o modelo normalizado, entre 0,5 (cubo) e ~0,87
   * (diagonal). É o que o enquadramento automático do estúdio precisa: um caça
   * é comprido e fino, um tanque é quase cúbico, e recuar a câmera pela dimensão
   * máxima cortaria as pontas do primeiro.
   */
  readonly radius: number;
}

/**
 * GLB do cofre de assets → template normalizado, ou `null` com o motivo.
 *
 * `parse` com buffer em vez de `load` com URL: o renderer bloqueia `blob:` por
 * CSP, e um GLB é arquivo único — não há recurso externo para resolver.
 */
export function loadModelTemplate(
  loader: GLTFLoader,
  src: string,
): Promise<{ template: ModelTemplate | null; error: string | null }> {
  const bytes = assetBytes(src);
  if (bytes === null) return Promise.resolve({ template: null, error: `asset ausente: ${src}` });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve) => {
    loader.parse(
      buffer as ArrayBuffer,
      "",
      (gltf) => resolve({ template: normalizeModel(gltf.scene), error: null }),
      (error: unknown) => resolve({ template: null, error: describeError(error) }),
    );
  });
}

/**
 * Centro na origem, dimensão máxima 1, materiais domados e culling desligado.
 *
 * O culling sai porque as matrizes vêm de fora (mundo mercator no mapa, metros
 * no palco): a esfera envolvente que o three calcula na origem não descreve onde
 * o objeto realmente está, e o modelo some.
 */
function normalizeModel(model: THREE.Object3D): ModelTemplate {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  const normalizer = maxDimension > 0 ? 1 / maxDimension : 1;
  model.scale.setScalar(normalizer);
  model.position.copy(center.clone().multiplyScalar(-normalizer));
  const wrapper = new THREE.Group();
  wrapper.add(model);
  // ATENÇÃO: o traverse vem DEPOIS do add. Antes ele rodava no grupo vazio e
  // nenhum ajuste chegava aos meshes de verdade.
  wrapper.traverse((object) => {
    object.frustumCulled = false;
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      // Os dois ligados: a auto-oclusão do modelo depende deles. Quem garante que
      // a cena fica acima do mapa é a limpeza de profundidade na camada, não
      // desligar o teste aqui.
      material.depthTest = true;
      material.depthWrite = true;
      if (material instanceof THREE.MeshStandardMaterial) {
        // Com environment map o metalness de fábrica vira espelho escuro; um teto
        // e um piso de rugosidade devolvem a superfície.
        material.metalness = Math.min(material.metalness, 0.6);
        material.roughness = Math.max(material.roughness, 0.45);
      }
    }
  });
  return { root: wrapper, radius: (Math.hypot(size.x, size.y, size.z) / 2) * normalizer };
}

/**
 * Environment map de estúdio. Sem ele o PBR fica mudo: metal sem reflexo lê como
 * plástico cinza. O `PMREMGenerator` é descartado logo depois — o que interessa é
 * a textura, e ele segura render targets enquanto vive.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

/** As três direcionais do esquema clássico, já na cena. */
export interface LightRig {
  readonly key: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
}

/**
 * Iluminação de três pontos, com a chave **rasante**.
 *
 * A parte contraintuitiva é a altura da chave. Luz vertical dá N·L quase igual
 * em toda a superfície virada para cima, e o resultado é uma silhueta branca sem
 * volume — foi assim que a aeronave apareceu chapada na primeira versão da
 * camada do mapa. A ~22° de elevação, dorso, lateral da fuselagem e deriva
 * recebem intensidades diferentes, e a forma aparece.
 *
 * `up` escolhe a convenção de eixos: `"z"` para o espaço mercator do mapa (z
 * para cima), `"y"` para o palco (a convenção do Three).
 */
export function createLightRig(up: "y" | "z", intensities?: Partial<LightIntensities>): LightRig {
  const level = { key: 2.2, fill: 0.55, rim: 0, ambient: 0.35, ...intensities };
  const place = (light: THREE.DirectionalLight, east: number, height: number, south: number) => {
    if (up === "y") light.position.set(east, height, south);
    // Espaço mercator: y aponta para o SUL, então o "sul" da convenção é +y.
    else light.position.set(east, south, height);
  };
  const ambient = new THREE.HemisphereLight(0xdce6f2, 0x1d2733, level.ambient);
  const key = new THREE.DirectionalLight(0xfff4e2, level.key);
  place(key, 0.62, 0.4, -0.68);
  const fill = new THREE.DirectionalLight(0x9fc4e8, level.fill);
  place(fill, -0.7, 0.18, 0.55);
  // Contraluz: separa a silhueta do fundo. Vale zero no mapa, onde o "fundo" é o
  // terreno e um halo atrás do modelo só confundiria a leitura.
  const rim = new THREE.DirectionalLight(0xbfd8ff, level.rim);
  place(rim, -0.25, 0.55, 0.9);
  return { key, fill, rim, ambient };
}

export interface LightIntensities {
  key: number;
  fill: number;
  rim: number;
  ambient: number;
}

export function addLightRig(scene: THREE.Scene, rig: LightRig): void {
  scene.add(rig.ambient, rig.key, rig.fill, rig.rim);
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
