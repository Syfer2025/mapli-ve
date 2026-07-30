/**
 * Shaders dos filtros próprios do projeto.
 *
 * Brilho, sombra, contorno e aberração cromática são escritos aqui em vez de vir
 * de `pixi-filters`: são quatro shaders curtos, e tê-los no repositório significa
 * saber exatamente quantas amostras rodam por pixel — número que aparece no
 * orçamento de GPU da Fase 6. Desfoque e correção de cor usam o núcleo do Pixi,
 * que já resolve os dois com passes separáveis e matriz.
 *
 * Três convenções valem para todos:
 *
 * 1. **Alfa pré-multiplicado.** A textura de entrada do sistema de filtros do
 *    Pixi já vem com `rgb` multiplicado por `a`, e a saída precisa sair igual.
 *    Composição "por trás" é então `fonte + halo·(1 − fonte.a)`.
 * 2. **`uInputSize.zw` é o tamanho do texel.** Deslocamento em pixels vira
 *    deslocamento em coordenada de textura multiplicando por ele.
 * 3. **Contagem de amostras fixa.** Nenhum laço depende de uniform: o compilador
 *    desenrola, e o custo por pixel é o mesmo em qualquer parâmetro.
 */

/**
 * Vertex compartilhado, igual ao padrão do Pixi 8. Está copiado em vez de
 * importado porque o caminho interno do módulo não é API pública.
 */
export const FILTER_VERTEX_SHADER = `precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

void main() {
  gl_Position = filterVertexPosition();
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

/**
 * A primeira linha tem de ser a precisão, e `highp`.
 *
 * O Pixi injeta `precision highp float` no vertex e `mediump` no fragment quando o
 * código não declara nada — e como os dois estágios declaram `uInputSize`, o
 * programa **não liga**: "precisions of uniform differ between VERTEX and FRAGMENT".
 * O pré-processador só respeita a declaração se ela abrir o arquivo (ele testa os
 * nove primeiros caracteres), então nem um newline pode vir antes.
 */
const PREAMBLE = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
const float TAU = 6.28318530717958647692;
`;

/**
 * Brilho: 36 amostras do alfa em três anéis, tingidas e postas atrás da fonte.
 *
 * O halo mede alfa, não cor, então o brilho tem a forma do objeto e não a cor
 * dele — é o que se quer num símbolo militar sobre mapa escuro.
 */
export const GLOW_FRAGMENT_SHADER = `${PREAMBLE}
uniform vec3 uTint;
uniform float uRadius;
uniform float uStrength;

const int DIRECTIONS = 12;
const int RINGS = 3;
/**
 * Direções literais, não sin/cos no fragmento.
 *
 * Medido no Electron real: com as funções transcendentais avaliadas pelo driver,
 * duas pinturas do mesmo glow alternavam o verde em 2 níveis no canvas Pixi
 * (1 nível depois da composição), sempre nos primeiros frames após resize.
 * Fixar os doze vetores remove essa aproximação do caminho por pixel sem mudar
 * a geometria do kernel.
 */
const vec2 DIRECTION_VECTORS[DIRECTIONS] = vec2[DIRECTIONS](
  vec2(1.0, 0.0),
  vec2(0.8660254037844386, 0.5),
  vec2(0.5, 0.8660254037844386),
  vec2(0.0, 1.0),
  vec2(-0.5, 0.8660254037844386),
  vec2(-0.8660254037844386, 0.5),
  vec2(-1.0, 0.0),
  vec2(-0.8660254037844386, -0.5),
  vec2(-0.5, -0.8660254037844386),
  vec2(0.0, -1.0),
  vec2(0.5, -0.8660254037844386),
  vec2(0.8660254037844386, -0.5)
);

void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  float halo = 0.0;
  float total = 0.0;
  for (int ring = 1; ring <= RINGS; ring += 1) {
    float step = float(ring) / float(RINGS);
    float radius = uRadius * step;
    // Anel externo pesa menos: dá queda suave sem precisar de gaussiana.
    float weight = 1.0 - 0.75 * step;
    for (int direction = 0; direction < DIRECTIONS; direction += 1) {
      vec2 offset = DIRECTION_VECTORS[direction] * radius * uInputSize.zw;
      halo += texture(uTexture, vTextureCoord + offset).a * weight;
      total += weight;
    }
  }
  halo = total > 0.0 ? clamp(halo / total * uStrength, 0.0, 1.0) : 0.0;
  finalColor = source + vec4(uTint * halo, halo) * (1.0 - source.a);
}
`;

/** Sombra projetada: mesma ideia do brilho, com o centro deslocado. */
export const SHADOW_FRAGMENT_SHADER = `${PREAMBLE}
uniform vec3 uTint;
uniform vec2 uOffset;
uniform float uRadius;
uniform float uShadowOpacity;

const int DIRECTIONS = 8;
const int RINGS = 2;

void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  vec2 center = vTextureCoord - uOffset * uInputSize.zw;
  float shade = texture(uTexture, center).a;
  float total = 1.0;
  for (int ring = 1; ring <= RINGS; ring += 1) {
    float radius = uRadius * float(ring) / float(RINGS);
    float weight = 1.0 / float(ring + 1);
    for (int direction = 0; direction < DIRECTIONS; direction += 1) {
      float angle = TAU * float(direction) / float(DIRECTIONS);
      vec2 offset = vec2(cos(angle), sin(angle)) * radius * uInputSize.zw;
      shade += texture(uTexture, center + offset).a * weight;
      total += weight;
    }
  }
  shade = clamp(shade / total, 0.0, 1.0) * uShadowOpacity;
  finalColor = source + vec4(uTint * shade, shade) * (1.0 - source.a);
}
`;

/**
 * Contorno: o máximo do alfa num anel na espessura pedida, menos o alfa local.
 *
 * `max` em vez de média porque contorno é binário — a borda existe ou não; média
 * daria uma faixa desbotada em vez de linha.
 */
export const OUTLINE_FRAGMENT_SHADER = `${PREAMBLE}
uniform vec3 uTint;
uniform float uThickness;

const int DIRECTIONS = 16;

void main() {
  vec4 source = texture(uTexture, vTextureCoord);
  float ring = 0.0;
  for (int direction = 0; direction < DIRECTIONS; direction += 1) {
    float angle = TAU * float(direction) / float(DIRECTIONS);
    vec2 offset = vec2(cos(angle), sin(angle)) * uThickness * uInputSize.zw;
    ring = max(ring, texture(uTexture, vTextureCoord + offset).a);
  }
  float edge = clamp(ring - source.a, 0.0, 1.0);
  finalColor = source + vec4(uTint * edge, edge) * (1.0 - source.a);
}
`;

/**
 * Aberração cromática: vermelho e azul lidos em lados opostos do deslocamento.
 *
 * O alfa fica no maior dos três, senão a borda da separação sai recortada onde
 * um canal caiu fora do objeto.
 */
export const CHROMATIC_FRAGMENT_SHADER = `${PREAMBLE}
uniform vec2 uShift;

void main() {
  vec2 shift = uShift * uInputSize.zw;
  vec4 base = texture(uTexture, vTextureCoord);
  vec4 warm = texture(uTexture, vTextureCoord + shift);
  vec4 cool = texture(uTexture, vTextureCoord - shift);
  float alpha = max(base.a, max(warm.a, cool.a));
  finalColor = vec4(warm.r, base.g, cool.b, alpha);
}
`;

/** Componentes de `#rrggbb` em 0–1, para virar uniform `vec3`. */
export function hexToRgbTriple(color: string): readonly [number, number, number] {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  const value = Number.parseInt(hex.slice(0, 6).padEnd(6, "0"), 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}
