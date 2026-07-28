/**
 * O chão infinito do estúdio.
 *
 * "Infinito" aqui não é figura de linguagem nem um plano muito grande: é um
 * quad em espaço de recorte que o fragment shader **desprojeta** de volta para o
 * mundo. Cada pixel da tela pergunta onde o raio que passa por ele cruza o plano
 * y = 0, e desenha a grade nessa coordenada. O chão não tem borda porque não tem
 * geometria — a única fronteira é o horizonte, que cai naturalmente onde o raio
 * deixa de descer.
 *
 * A alternativa óbvia — um `THREE.GridHelper` de N × N — falha de dois jeitos ao
 * mesmo tempo: a borda aparece assim que a câmera recua, e as linhas viram
 * serrilhado cintilante à distância, porque uma linha de geometria com menos de
 * um pixel de largura ora acerta o centro do pixel, ora não. Aqui a espessura da
 * linha é medida **em pixels** a partir da derivada da coordenada de mundo
 * (`fwidth`), então uma linha a 5 m e uma a 5 km têm a mesma nitidez.
 */

import * as THREE from "three";

const VERTEX = /* glsl */ `
precision highp float;

// RawShaderMaterial não injeta NADA: nem precisão, nem os atributos padrão que
// o ShaderMaterial normal declara por você. Sem esta linha o shader referencia
// um "position" que não existe, o programa não linka, e o chão simplesmente não
// aparece — sem erro visível, porque o three engole a falha de link.
in vec3 position;

out vec2 vClip;
void main() {
  // Quad de tela cheia. Sem model-view: a posição JÁ é coordenada de recorte, e
  // é o fragment shader que descobre o mundo por trás dela.
  vClip = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

in vec2 vClip;
out vec4 finalColor;

uniform mat4 uInverseViewProjection;
uniform vec3 uCameraPosition;
uniform vec3 uFloorColor;
uniform vec3 uGridColor;
uniform vec3 uHorizonColor;
uniform float uSpacing;
uniform float uOpacity;
uniform float uFade;

/**
 * Linear → sRGB, na saída.
 *
 * Um RawShaderMaterial escreve no framebuffer sem nenhuma injeção do three: nem
 * tone mapping, nem conversão de espaço de cor. Mas as cores CHEGAM convertidas,
 * porque THREE.Color converte de sRGB para linear ao ler um hex. Sem esta função
 * o chão #141a22 saía como 2/3/4 em vez de 20/26/34 — quase preto — e a grade,
 * que é uma mistura entre duas cores já escuras, desaparecia junto. O bug não
 * gera erro nenhum: o desenho está lá, só ilegível.
 *
 * A mistura acontece antes da conversão, de propósito: interpolar em linear é o
 * que faz a grade desvanecer sem passar por um cinza sujo.
 */
vec3 linearToSrgb(vec3 linear) {
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(max(linear, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, step(linear, vec3(0.0031308)));
}

/** Ponto do mundo sob um ponto de recorte, na profundidade dada. */
vec3 unproject(vec2 clip, float depth) {
  vec4 world = uInverseViewProjection * vec4(clip, depth, 1.0);
  return world.xyz / world.w;
}

/**
 * Cobertura da grade num espaçamento, em [0,1].
 *
 * fwidth() dá quanto a coordenada de mundo anda entre dois pixels vizinhos.
 * Dividir a distância à linha mais próxima por isso converte metros em pixels, e
 * é o que mantém a espessura constante independente da distância e do zoom. O
 * min() dos dois eixos junta as duas famílias de linhas sem somar o cruzamento.
 */
float gridCoverage(vec2 world, float spacing) {
  vec2 scaled = world / spacing;
  vec2 derivative = fwidth(scaled);
  // Distância à linha mais próxima, em unidades de célula: 0 na linha, 0.5 no
  // centro da célula.
  vec2 distanceToLine = abs(fract(scaled - 0.5) - 0.5);
  vec2 pixels = distanceToLine / max(derivative, vec2(1e-8));
  return 1.0 - min(min(pixels.x, pixels.y), 1.0);
}

void main() {
  // Dois pontos do mesmo raio: perto e longe do plano de recorte.
  vec3 near = unproject(vClip, -1.0);
  vec3 far = unproject(vClip, 1.0);
  vec3 direction = far - near;

  // Onde o raio cruza y = 0. Raio subindo ou paralelo ao chão nunca cruza:
  // esse é o céu, e é o que dá o horizonte de graça.
  float t = -near.y / direction.y;
  if (direction.y >= 0.0 || t < 0.0 || t > 1.0) {
    finalColor = vec4(uHorizonColor, 1.0);
    return;
  }

  vec3 hit = near + direction * t;
  float distance = length(hit - uCameraPosition);

  // Desvanecimento com a distância. Sem ele, a grade se acumula até virar uma
  // superfície sólida no horizonte — e o serrilhado volta pela porta dos fundos,
  // agora como moiré.
  float fade = exp(-distance / max(uFade, 1e-3));

  // Duas escalas: a grade fina some ao longe, a de dez em dez segura a leitura
  // de profundidade quando a fina já desapareceu.
  float fine = gridCoverage(hit.xz, uSpacing) * fade;
  float coarse = gridCoverage(hit.xz, uSpacing * 10.0) * sqrt(fade);
  float coverage = max(fine * 0.55, coarse) * uOpacity;

  vec3 color = mix(uFloorColor, uGridColor, coverage);
  // O chão se dissolve no fundo em vez de terminar numa linha dura.
  color = mix(uHorizonColor, color, clamp(fade * 1.6 + 0.08, 0.0, 1.0));
  finalColor = vec4(linearToSrgb(color), 1.0);
}
`;

export interface StudioGridAppearance {
  readonly floor: THREE.ColorRepresentation;
  readonly grid: THREE.ColorRepresentation;
  readonly horizon: THREE.ColorRepresentation;
  readonly spacingMeters: number;
  readonly opacity: number;
}

export interface StudioGrid {
  readonly mesh: THREE.Mesh;
  /** Chamado por frame, antes do render. */
  readonly update: (camera: THREE.PerspectiveCamera, appearance: StudioGridAppearance) => void;
  readonly dispose: () => void;
}

export function createStudioGrid(): StudioGrid {
  const uniforms = {
    uInverseViewProjection: { value: new THREE.Matrix4() },
    uCameraPosition: { value: new THREE.Vector3() },
    uFloorColor: { value: new THREE.Color("#141a22") },
    uGridColor: { value: new THREE.Color("#2f4256") },
    uHorizonColor: { value: new THREE.Color("#0b0f14") },
    uSpacing: { value: 5 },
    uOpacity: { value: 0.55 },
    uFade: { value: 120 },
  };
  const material = new THREE.RawShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    glslVersion: THREE.GLSL3,
    // O chão é o fundo: escreve cor, não profundidade, e é desenhado antes de
    // tudo. Escrever profundidade em z = 1 empurraria o modelo para trás dele.
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  // Primeiro da fila, sempre: é o fundo da imagem.
  mesh.renderOrder = -1;

  const inverse = new THREE.Matrix4();
  return {
    mesh,
    update: (camera, appearance) => {
      inverse.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
      uniforms.uInverseViewProjection.value.copy(inverse);
      uniforms.uCameraPosition.value.copy(camera.position);
      uniforms.uFloorColor.value.set(appearance.floor);
      uniforms.uGridColor.value.set(appearance.grid);
      uniforms.uHorizonColor.value.set(appearance.horizon);
      uniforms.uSpacing.value = Math.max(0.05, appearance.spacingMeters);
      uniforms.uOpacity.value = Math.max(0, Math.min(1, appearance.opacity));
      // O alcance do desvanecimento acompanha a distância da câmera: aproximar
      // para ver um detalhe não deve encher a tela de linhas, e recuar para ver
      // o conjunto não deve apagar a grade toda.
      uniforms.uFade.value = Math.max(10, camera.position.length() * 2.5);
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
