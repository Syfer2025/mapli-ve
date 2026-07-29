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
 * Este arquivo também **recebe a sombra**. Isso é escolha de projeto, não
 * conveniência: um plano de tela cheia em RawShaderMaterial não recebe shadow map
 * — não há superfície onde o three projete. A silhueta vem pronta de
 * `studio-shadow.ts` como textura vista de cima, e aqui cada ponto do piso é
 * levado para o espaço dela e amostrado.
 *
 * A primeira tentativa foi elipse analítica a partir da caixa envolvente, e o
 * dono recusou com a palavra certa: "como se fosse uma sombra flutuando". Elipse
 * não é silhueta. Um caça tem asa, deriva e tanque externo, e uma oval centrada
 * no objeto lê como borrão embaixo dele. A silhueta projetada tem a forma de
 * verdade, e vale para qualquer objeto importado.
 */

import * as THREE from "three";
import type { ReflectionProjection } from "./studio-reflection.js";
import type { ShadowProjection } from "./studio-shadow.js";

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
/* Névoa junto ao horizonte: 0 desliga. */
uniform float uHaze;
uniform vec3 uHazeColor;

uniform sampler2D uReflectionMap;
/* bias * projection * view: leva mundo direto em UV homogêneo. */
uniform mat4 uReflectionMatrix;
uniform vec2 uReflectionTexelSize;
uniform float uReflectionStrength;
uniform float uReflectionValid;

uniform sampler2D uShadowMap;
/* projection * view da camera de cima: leva mundo direto em UV da silhueta. */
uniform mat4 uShadowMatrix;
uniform float uShadowStrength;
/* Raio do desfoque em texels. Cresce com a altura do objeto. */
uniform float uShadowSoftness;
uniform float uShadowValid;
/* Gradiente radial que fecha a cena em preto: e ele que da o infinito. */
uniform float uVignette;

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

/**
 * A mesma curva ACESFilmicToneMapping do Three, com exposure 1.
 *
 * O modelo direto recebe esta curva do renderer. O target do espelho precisa
 * guardar HDR linear e chegar aqui antes da curva; aplicar só depois do clamp de
 * RGBA8 apagaria highlights, e omiti-la faria reflexo e objeto terem contrastes
 * diferentes apesar de virem do mesmo material.
 */
vec3 acesFilmicToneMapping(vec3 color) {
  const mat3 inputMatrix = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 outputMatrix = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602)
  );
  color *= 1.0 / 0.6;
  color = inputMatrix * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = a / b;
  return clamp(outputMatrix * color, 0.0, 1.0);
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
 * Sombra por silhueta projetada.
 *
 * A textura vem do modelo renderizado visto de cima, branco sobre preto
 * (studio-shadow.ts). Aqui cada ponto do piso é levado para o espaço dessa
 * câmera e amostrado: onde caiu dentro da silhueta, escurece. A forma é a do
 * objeto — asa, deriva, tanque externo — e não uma aproximação.
 *
 * O desfoque é um disco de treze amostras em espiral, não uma cruz. Cruz deixa
 * rastro em X visível em silhueta fina como asa; espiral distribui o erro sem
 * direção preferida. O raio vem em texels e cresce com a altura do objeto: é o
 * que dá a penumbra que o dono descreveu como brilho preto em volta, e é o que
 * impede a sombra de terminar numa borda dura e reta.
 */
float silhouetteShadow(vec3 world) {
  if (uShadowValid < 0.5) return 0.0;
  vec4 projected = uShadowMatrix * vec4(world, 1.0);
  vec2 uv = projected.xy / projected.w * 0.5 + 0.5;
  // Fora da textura não há objeto: nada de repetir a borda pelo chão inteiro.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;

  float radius = uShadowSoftness / 1024.0;
  float sum = texture(uShadowMap, uv).r;
  float weight = 1.0;
  for (int i = 0; i < 12; i++) {
    float angle = float(i) * 2.399963;
    float step = sqrt((float(i) + 0.5) / 12.0);
    vec2 offset = vec2(cos(angle), sin(angle)) * radius * step;
    float falloff = 1.0 - step * 0.55;
    sum += texture(uShadowMap, uv + offset).r * falloff;
    weight += falloff;
  }
  float mask = sum / weight;
  // Curva no resultado: o núcleo fecha e a franja abre, que é como uma penumbra
  // se comporta. Sem ela a máscara desfocada parece um adesivo translúcido.
  return clamp(pow(mask, 0.72), 0.0, 1.0) * uShadowStrength;
}

/**
 * Cor e cobertura do espelho planar no ponto reconstruído do piso.
 *
 * O target tem fundo transparente, portanto alfa zero é uma prova geométrica de
 * que não há equipamento naquele ponto — ligar o controle num palco vazio não
 * cria um brilho genérico. Cinco amostras dão rugosidade curta sem transformar
 * o reflexo em borrão; o tamanho vem do target real, não de um 1024 presumido.
 */
vec4 floorReflection(vec3 world, float distanceFade) {
  if (uReflectionValid < 0.5 || uReflectionStrength <= 0.0) return vec4(0.0);
  vec4 projected = uReflectionMatrix * vec4(world, 1.0);
  if (projected.w <= 1e-6) return vec4(0.0);
  vec2 uv = projected.xy / projected.w;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);

  vec2 radius = uReflectionTexelSize * 1.5;
  vec4 reflected = texture(uReflectionMap, uv) * 0.36;
  reflected += texture(uReflectionMap, uv + vec2(radius.x, 0.0)) * 0.16;
  reflected += texture(uReflectionMap, uv - vec2(radius.x, 0.0)) * 0.16;
  reflected += texture(uReflectionMap, uv + vec2(0.0, radius.y)) * 0.16;
  reflected += texture(uReflectionMap, uv - vec2(0.0, radius.y)) * 0.16;

  // O blur mistura cor com o fundo transparente e devolve RGB pré-multiplicado
  // pela cobertura. Recuperar a cor reta antes do mix evita aplicar alfa duas
  // vezes (c*a no filtro e outra vez no mix), que escureceria toda borda.
  float coverage = clamp(reflected.a, 0.0, 1.0);
  if (coverage <= 1e-5) return vec4(0.0);
  reflected.rgb = acesFilmicToneMapping(max(reflected.rgb / coverage, vec3(0.0)));

  vec3 toCamera = normalize(uCameraPosition - world);
  float facing = clamp(dot(toCamera, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
  // Piso de vitrine: reflexo discreto de frente e mais forte em ângulo rasante.
  float fresnel = 0.22 + 0.78 * pow(1.0 - facing, 2.0);
  reflected.a = coverage * uReflectionStrength * fresnel * sqrt(max(distanceFade, 0.0));
  return reflected;
}

/**
 * A cor do fundo numa direção do olhar.
 *
 * Dois problemas que o dono relatou de uma vez: "metade da tela do palco parece
 * cortada, não dá sensação de espaço" e "a linha de transição da base com o fundo está
 * esquisita". Eram o mesmo defeito visto de dois lados. O céu era **uma cor lisa** — sem
 * gradiente não há profundidade, e o olho lê a metade de cima como um bloco chapado — e o
 * piso nunca alcançava essa cor, porque a mistura tinha um piso de 0,08: sobrava sempre
 * 8% de cor de chão no infinito, e é isso que desenhava a aresta.
 *
 * Agora os dois lados do horizonte pedem a cor à **mesma** função, avaliada na mesma
 * direção. Eles se encontram no mesmo valor por construção, e não por ajuste fino de
 * dois números que alguém teria de manter iguais.
 *
 * A névoa é mais densa rente ao horizonte e rareia subindo. **Ela nunca cobre o objeto**
 * — o pedido explícito do dono — e não por cuidado de quem escreveu: este passe é um quad
 * de tela cheia com depthTest desligado e renderOrder −1, então tudo o que é geometria
 * desenha depois, em cima. Névoa volumétrica de verdade (THREE.Fog) faria o oposto: ela é
 * por profundidade e lavaria o modelo junto.
 *
 * (Sem acento grave neste comentário: ele vive dentro de um template literal, e um
 * backtick aqui fecharia a string do shader. Prima da armadilha 4.1 do 09-CONTINUIDADE.)
 */
vec3 skyTone(vec3 dir) {
  float above = clamp(dir.y / 0.30, 0.0, 1.0);
  float haze = uHaze * pow(1.0 - above, 2.0);
  return mix(uHorizonColor, uHazeColor, haze);
}

void main() {
  // Dois pontos do mesmo raio: perto e longe do plano de recorte.
  vec3 near = unproject(vClip, -1.0);
  vec3 far = unproject(vClip, 1.0);
  vec3 direction = far - near;
  vec3 viewDir = normalize(direction);

  // Onde o raio cruza y = 0. Raio subindo ou paralelo ao chão nunca cruza:
  // esse é o céu, e é o que dá o horizonte de graça.
  // Gradiente radial em espaço de tela. É ele que fecha a cena em preto nos
  // cantos e dá a sensação de infinito: sem borda, sem horizonte marcado, o
  // olho não encontra onde o cenário termina.
  float vignette = 1.0 - uVignette * clamp(dot(vClip, vClip) * 0.62, 0.0, 1.0);

  float t = -near.y / direction.y;
  if (direction.y >= 0.0 || t < 0.0 || t > 1.0) {
    finalColor = vec4(linearToSrgb(skyTone(viewDir) * vignette), 1.0);
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

  float shade = silhouetteShadow(hit);
  vec4 reflection = floorReflection(hit, fade);
  vec3 floorTone = uFloorColor * (1.0 + grain);
  vec3 reflectedFloor = mix(floorTone, reflection.rgb, clamp(reflection.a, 0.0, 1.0));
  // A sombra escurece o piso e as linhas juntos: sombra que apaga o chão e deixa
  // a grade acesa por baixo denuncia o truque na hora.
  vec3 color = mix(
    reflectedFloor * (1.0 - shade * 0.86),
    uGridColor * (1.0 - shade * 0.74),
    coverage
  );
  // Sem o antigo + 0.08: era ele que impedia o piso de chegar à cor do fundo e
  // deixava a aresta no horizonte. O piso agora dissolve por completo, e no valor
  // exato que o céu tem naquela mesma direção.
  color = mix(skyTone(viewDir), color, clamp(fade * 1.6, 0.0, 1.0));
  finalColor = vec4(linearToSrgb(color * vignette), 1.0);
}
`;

export interface StudioGridAppearance {
  readonly floor: THREE.ColorRepresentation;
  readonly grid: THREE.ColorRepresentation;
  readonly horizon: THREE.ColorRepresentation;
  readonly spacingMeters: number;
  readonly opacity: number;
  /** 0 desliga a textura procedural e devolve o piso liso. */
  readonly texture: number;
  /** Cena colorida vista pela câmera espelhada; `null` não amostra target antigo. */
  readonly reflection: ReflectionProjection | null;
  /** Força do reflexo, 0..1. */
  readonly reflectionStrength: number;
  /** Silhueta projetada vinda do `StudioShadowProjector`; `null` some a sombra. */
  readonly shadow: ShadowProjection | null;
  /** Força da sombra, 0..1. */
  readonly shadowStrength: number;
  /** Gradiente radial que fecha a cena em preto. */
  readonly vignette: number;
  /**
   * Névoa junto ao horizonte, 0..1. É ela que dissolve a costura entre piso e fundo e
   * dá profundidade ao vazio — e, por viver no passe de fundo, nunca cobre o objeto.
   */
  readonly haze: number;
  readonly hazeColor: THREE.ColorRepresentation;
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
    uReflectionMap: { value: null as THREE.Texture | null },
    uReflectionMatrix: { value: new THREE.Matrix4() },
    uReflectionTexelSize: { value: new THREE.Vector2(1, 1) },
    uReflectionStrength: { value: 0 },
    uReflectionValid: { value: 0 },
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowStrength: { value: 0 },
    uShadowSoftness: { value: 8 },
    uShadowValid: { value: 0 },
    uVignette: { value: 0.55 },
    uHaze: { value: 0.55 },
    uHazeColor: { value: new THREE.Color("#8fa6bd") },
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
      uniforms.uVignette.value = Math.max(0, Math.min(1, appearance.vignette));
      uniforms.uHaze.value = Math.max(0, Math.min(1, appearance.haze));
      uniforms.uHazeColor.value.set(appearance.hazeColor);

      const reflection = appearance.reflection;
      if (reflection === null) {
        uniforms.uReflectionValid.value = 0;
        uniforms.uReflectionStrength.value = 0;
        uniforms.uReflectionMap.value = null;
      } else {
        uniforms.uReflectionValid.value = 1;
        uniforms.uReflectionMap.value = reflection.texture;
        uniforms.uReflectionMatrix.value.copy(reflection.matrix);
        uniforms.uReflectionTexelSize.value.copy(reflection.texelSize);
        uniforms.uReflectionStrength.value = Math.max(
          0,
          Math.min(1, appearance.reflectionStrength),
        );
      }

      const shadow = appearance.shadow;
      if (shadow === null) {
        uniforms.uShadowValid.value = 0;
        uniforms.uShadowStrength.value = 0;
        uniforms.uShadowMap.value = null;
      } else {
        uniforms.uShadowValid.value = 1;
        uniforms.uShadowMap.value = shadow.texture;
        uniforms.uShadowMatrix.value.copy(shadow.matrix);
        uniforms.uShadowSoftness.value = shadow.softnessTexels;
        uniforms.uShadowStrength.value =
          Math.max(0, Math.min(1, appearance.shadowStrength)) * shadow.coverage;
      }
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
