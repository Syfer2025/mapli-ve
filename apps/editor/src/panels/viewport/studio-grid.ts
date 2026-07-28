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
 * A alternativa óbvia — um THREE.GridHelper de N × N — falha de dois jeitos ao
 * mesmo tempo: a borda aparece assim que a câmera recua, e as linhas viram
 * serrilhado cintilante à distância, porque uma linha de geometria com menos de
 * um pixel de largura ora acerta o centro do pixel, ora não. Aqui a espessura da
 * linha é medida **em pixels** a partir da derivada da coordenada de mundo
 * (fwidth), então uma linha a 5 m e uma a 5 km têm a mesma nitidez.
 *
 * Este arquivo também desenha a **sombra de contato**. Isso é escolha de projeto,
 * não conveniência: o chão é um RawShaderMaterial de tela cheia, e um plano
 * assim não recebe shadow map — não há superfície onde o three projete a sombra.
 * Sombra analítica no próprio shader resolve sem geometria extra, sai sem
 * serrilhado por construção, e a pegada vem da caixa envolvente de cada modelo,
 * então funciona para qualquer objeto importado, não só para o que veio primeiro.
 */

import * as THREE from "three";

/** Sombras simultâneas no chão. Palco de apresentação não tem multidão. */
const MAX_SHADOWS = 4;

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
uniform float uTexture;

uniform int uShadowCount;
uniform vec2 uShadowCenter[${MAX_SHADOWS}];
uniform vec2 uShadowRadius[${MAX_SHADOWS}];
/** (cos, sen) do rumo do objeto: a elipse acompanha a silhueta, não o eixo do mundo. */
uniform vec2 uShadowAxis[${MAX_SHADOWS}];
uniform float uShadowStrength[${MAX_SHADOWS}];
/** Cresce com a altura do objeto sobre o chão: penumbra de luz de área. */
uniform float uShadowSoftness[${MAX_SHADOWS}];

/**
 * Linear → sRGB, na saída.
 *
 * Um RawShaderMaterial escreve no framebuffer sem nenhuma injeção do three: nem
 * tone mapping, nem conversão de espaço de cor. Mas as cores CHEGAM convertidas,
 * porque THREE.Color converte de sRGB para linear ao ler um hex. Sem esta função
 * o chão #39424f saía como 2/3/4 em vez de 20/26/34 — quase preto — e a grade,
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
 * Confiança na amostra, por Nyquist.
 *
 * derivative é quanto a coordenada anda entre pixels vizinhos, em unidades de
 * célula. Acima de meia célula por pixel o padrão periódico deixa de ser
 * amostrável: fract passa a devolver um valor que depende de onde exatamente o
 * pixel caiu, e um décimo de grau de câmera troca esse valor. É essa a origem do
 * cintilar, e é por isso que MSAA não resolve — não existe aresta de geometria
 * aqui para o MSAA amostrar. Acima do limite a única saída correta é parar de
 * amostrar e usar a média.
 */
float sampleTrust(vec2 derivative) {
  return clamp(1.0 - max(derivative.x, derivative.y) * 2.0, 0.0, 1.0);
}

/**
 * Cobertura da grade num espaçamento, em [0,1].
 *
 * A espessura é medida em pixels a partir de fwidth, o que mantém a linha
 * constante com a distância e o zoom. E quando a densidade passa de Nyquist, a
 * cobertura se dissolve para a **média analítica** em vez de oscilar: o perfil da
 * linha é um triângulo de meia-base derivative células, então a área por célula
 * é derivative; duas famílias somam menos a interseção.
 *
 * O desvanecimento por distância que já existia tratava só metade do problema.
 * Distância não é densidade de pixel: chão perto, visto de raspão, tem
 * derivative alto num eixo. Medido no aplicativo, 74% da instabilidade estava
 * na metade INFERIOR da tela — perto da câmera, onde nenhum fade por distância
 * alcança.
 */
float gridCoverage(vec2 world, float spacing) {
  vec2 scaled = world / spacing;
  vec2 derivative = fwidth(scaled);
  // Distância à linha mais próxima, em unidades de célula: 0 na linha, 0.5 no
  // centro da célula.
  vec2 distanceToLine = abs(fract(scaled - 0.5) - 0.5);
  vec2 pixels = distanceToLine / max(derivative, vec2(1e-8));
  float sharp = 1.0 - min(min(pixels.x, pixels.y), 1.0);
  float mean = clamp(derivative.x + derivative.y - derivative.x * derivative.y, 0.0, 1.0);
  return mix(mean, sharp, sampleTrust(derivative));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/** Ruído de valor com interpolação suave: sem descontinuidade entre células. */
float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 smoothed = f * f * (3.0 - 2.0 * f);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, smoothed.x), mix(c, d, smoothed.x), smoothed.y);
}

/**
 * Uma oitava de textura, já filtrada.
 *
 * Passa pelo mesmo sampleTrust da grade: textura procedural sem filtro
 * cintilaria exatamente como as linhas que acabamos de estabilizar, e o defeito
 * voltaria disfarçado de "granulado".
 */
float octave(vec2 world, float sizeMeters, float amplitude) {
  vec2 p = world / sizeMeters;
  float trust = sampleTrust(vec2(fwidth(p.x), fwidth(p.y)));
  return (valueNoise(p) - 0.5) * amplitude * trust;
}

/**
 * Sombra de contato, somando os objetos do palco.
 *
 * Duas parcelas, porque uma só não lê como sombra: um **núcleo** denso sob o
 * objeto, que é o contato, e um **halo** largo e fraco em volta, que é a
 * penumbra. É o halo que dá a moldura de sombra pedida — sem ele o objeto ganha
 * uma mancha de bordas duras, que parece adesivo, não sombra.
 *
 * A elipse gira com o rumo do objeto: um caça de 18 m por 12 m deitado no eixo
 * do mundo teria sombra redonda e errada quando o modelo estivesse a 45°.
 */
float contactShadow(vec2 world) {
  float shade = 0.0;
  for (int i = 0; i < ${MAX_SHADOWS}; i++) {
    if (i >= uShadowCount) break;
    vec2 delta = world - uShadowCenter[i];
    // Rotação inversa: leva o mundo para o eixo do objeto.
    vec2 axis = uShadowAxis[i];
    vec2 local = vec2(delta.x * axis.x + delta.y * axis.y, -delta.x * axis.y + delta.y * axis.x);
    float r = length(local / max(uShadowRadius[i], vec2(1e-3)));
    float soft = uShadowSoftness[i];
    float core = 1.0 - smoothstep(0.45 * (1.0 - soft * 0.5), 1.0 + soft, r);
    float halo = 1.0 - smoothstep(0.0, 2.1 + soft * 2.0, r);
    shade = max(shade, (core * 0.78 + halo * 0.42) * uShadowStrength[i]);
  }
  return clamp(shade, 0.0, 1.0);
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

  // Desvanecimento com a distância. Ele não substitui o filtro de Nyquist — trata
  // outra coisa: dissolve o chão no fundo em vez de terminar numa linha dura.
  float fade = exp(-distance / max(uFade, 1e-3));

  // Textura do piso: três escalas, da mancha larga ao granulado. Amplitude baixa
  // de propósito — é superfície, não estampa, e a grade tem de continuar sendo a
  // referência de leitura.
  float grain = 0.0;
  if (uTexture > 0.0) {
    grain =
      octave(hit.xz, 7.0, 0.20) +
      octave(hit.xz, 1.7, 0.11) +
      octave(hit.xz, 0.45, 0.06);
    grain *= uTexture;
  }

  // Duas escalas de grade: a fina some ao longe, a de dez em dez segura a leitura
  // de profundidade quando a fina já desapareceu.
  float fine = gridCoverage(hit.xz, uSpacing) * fade;
  float coarse = gridCoverage(hit.xz, uSpacing * 10.0) * sqrt(fade);
  float coverage = max(fine * 0.55, coarse) * uOpacity;

  float shade = contactShadow(hit.xz);
  vec3 floorTone = uFloorColor * (1.0 + grain);
  // A sombra escurece o piso e as linhas juntos: sombra que apaga o chão e deixa
  // a grade acesa por baixo denuncia o truque na hora.
  vec3 color = mix(floorTone * (1.0 - shade * 0.82), uGridColor * (1.0 - shade * 0.68), coverage);
  color = mix(uHorizonColor, color, clamp(fade * 1.6 + 0.08, 0.0, 1.0));
  finalColor = vec4(linearToSrgb(color), 1.0);
}
`;

/** Pegada de um objeto no chão, em metros do palco. */
export interface StudioShadow {
  /** Centro em (x leste, z sul). */
  readonly center: readonly [number, number];
  /** Semi-eixos da elipse, no referencial do objeto. */
  readonly radius: readonly [number, number];
  /** Rumo do objeto em graus, para girar a elipse. */
  readonly headingDeg: number;
  readonly strength: number;
  /** 0 = encostado no chão; cresce com a altura, alargando a penumbra. */
  readonly softness: number;
}

export interface StudioGridAppearance {
  readonly floor: THREE.ColorRepresentation;
  readonly grid: THREE.ColorRepresentation;
  readonly horizon: THREE.ColorRepresentation;
  readonly spacingMeters: number;
  readonly opacity: number;
  /** 0 desliga a textura procedural e devolve o piso liso. */
  readonly texture: number;
  readonly shadows: readonly StudioShadow[];
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
    uFloorColor: { value: new THREE.Color("#39424f") },
    uGridColor: { value: new THREE.Color("#5d6f84") },
    uHorizonColor: { value: new THREE.Color("#0d1218") },
    uSpacing: { value: 5 },
    uOpacity: { value: 0.55 },
    uFade: { value: 120 },
    uTexture: { value: 0.35 },
    uShadowCount: { value: 0 },
    // Arrays de uniform precisam existir com o tamanho final desde a primeira
    // compilação: o three dimensiona pelo comprimento do array que recebe aqui.
    uShadowCenter: { value: Array.from({ length: MAX_SHADOWS }, () => new THREE.Vector2()) },
    uShadowRadius: { value: Array.from({ length: MAX_SHADOWS }, () => new THREE.Vector2(1, 1)) },
    uShadowAxis: { value: Array.from({ length: MAX_SHADOWS }, () => new THREE.Vector2(1, 0)) },
    uShadowStrength: { value: new Array<number>(MAX_SHADOWS).fill(0) },
    uShadowSoftness: { value: new Array<number>(MAX_SHADOWS).fill(0) },
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
      uniforms.uTexture.value = Math.max(0, Math.min(1, appearance.texture));
      // O alcance do desvanecimento acompanha a distância da câmera: aproximar
      // para ver um detalhe não deve encher a tela de linhas, e recuar para ver
      // o conjunto não deve apagar a grade toda.
      uniforms.uFade.value = Math.max(10, camera.position.length() * 2.5);

      const count = Math.min(appearance.shadows.length, MAX_SHADOWS);
      uniforms.uShadowCount.value = count;
      for (let index = 0; index < count; index += 1) {
        const shadow = appearance.shadows[index] as StudioShadow;
        const radians = (shadow.headingDeg * Math.PI) / 180;
        (uniforms.uShadowCenter.value[index] as THREE.Vector2).set(
          shadow.center[0],
          shadow.center[1],
        );
        (uniforms.uShadowRadius.value[index] as THREE.Vector2).set(
          Math.max(1e-3, shadow.radius[0]),
          Math.max(1e-3, shadow.radius[1]),
        );
        (uniforms.uShadowAxis.value[index] as THREE.Vector2).set(
          Math.cos(radians),
          Math.sin(radians),
        );
        uniforms.uShadowStrength.value[index] = Math.max(0, Math.min(1, shadow.strength));
        uniforms.uShadowSoftness.value[index] = Math.max(0, Math.min(1, shadow.softness));
      }
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
