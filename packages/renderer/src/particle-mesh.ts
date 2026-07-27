/**
 * Malha de partículas para o backend Pixi: **um draw call** para a nuvem inteira.
 *
 * Cada partícula ocupa quatro vértices e seis índices, e todos os atributos de
 * nascimento são repetidos por vértice. O buffer sobe uma vez e nunca muda; o
 * `frame` entra como uniform e o vertex shader resolve
 *
 *     p = origem + v₀·τ + ½·a·τ²
 *
 * Quatro vértices em vez de instancing: WebGL2 puro, sem depender de extensão
 * nem da forma exata da API de instâncias do Pixi 8, e ainda assim uma única
 * chamada de desenho. O custo é memória — 5.000 partículas dão ~1,4 MB de
 * atributos, montados uma vez por explosão.
 *
 * A partícula morta colapsa no vertex shader (posição fora do clip e tamanho
 * zero) em vez de ser removida do buffer, porque remover exigiria reconstruir o
 * buffer a cada frame e devolveria o custo de CPU que a forma fechada elimina.
 */

import type { ParticlesPrimitive } from "./contracts.js";

/** Atributos por vértice, na ordem em que o shader os declara. */
export interface ParticleGeometryData {
  /** 4 vértices por partícula: canto do quad em [-0.5, 0.5]. */
  readonly corner: Float32Array;
  readonly birth: Float32Array;
  readonly motion: Float32Array;
  readonly shape: Float32Array;
  readonly tint: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly indexCount: number;
}

const CORNERS: readonly (readonly [number, number])[] = Object.freeze([
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
]);

/**
 * Expande o buffer de partículas em atributos de vértice. Chamado uma vez por
 * `bufferId`; o resultado é cacheado pelo backend.
 */
export function buildParticleGeometryData(visual: ParticlesPrimitive): ParticleGeometryData {
  const count = visual.count;
  const vertexCount = count * 4;
  const corner = new Float32Array(vertexCount * 2);
  // birth: birthFrame, lifetime, variation, (reservado)
  const birth = new Float32Array(vertexCount * 4);
  // motion: originX, originY, velocityX, velocityY
  const motion = new Float32Array(vertexCount * 4);
  // shape: accelerationX, accelerationY, size, sizeEnd
  const shape = new Float32Array(vertexCount * 4);
  // tint: r, g, b, spin — cor já resolvida da paleta, para o shader não indexar.
  const tint = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(count * 6);

  for (let index = 0; index < count; index += 1) {
    const source = index * visual.stride;
    const birthFrame = visual.data[source] ?? 0;
    const lifetime = visual.data[source + 1] ?? 1;
    const originX = visual.data[source + 2] ?? 0;
    const originY = visual.data[source + 3] ?? 0;
    const velocityX = visual.data[source + 4] ?? 0;
    const velocityY = visual.data[source + 5] ?? 0;
    const accelerationX = visual.data[source + 6] ?? 0;
    const accelerationY = visual.data[source + 7] ?? 0;
    const size = visual.data[source + 8] ?? 1;
    const sizeEnd = visual.data[source + 9] ?? 0;
    const rotation = visual.data[source + 10] ?? 0;
    const spin = visual.data[source + 11] ?? 0;
    const variation = visual.data[source + 12] ?? 0;
    const color = parseHexColor(
      visual.palette[visual.colors[index] ?? 0] ?? visual.palette[0] ?? "#ffffff",
    );

    for (let vertex = 0; vertex < 4; vertex += 1) {
      const at = index * 4 + vertex;
      const cornerValue = CORNERS[vertex] ?? [0, 0];
      corner[at * 2] = cornerValue[0];
      corner[at * 2 + 1] = cornerValue[1];

      birth[at * 4] = birthFrame;
      birth[at * 4 + 1] = lifetime;
      birth[at * 4 + 2] = variation;
      birth[at * 4 + 3] = rotation;

      motion[at * 4] = originX;
      motion[at * 4 + 1] = originY;
      motion[at * 4 + 2] = velocityX;
      motion[at * 4 + 3] = velocityY;

      shape[at * 4] = accelerationX;
      shape[at * 4 + 1] = accelerationY;
      shape[at * 4 + 2] = size;
      shape[at * 4 + 3] = sizeEnd;

      tint[at * 4] = color[0];
      tint[at * 4 + 1] = color[1];
      tint[at * 4 + 2] = color[2];
      tint[at * 4 + 3] = spin;
    }

    const base = index * 4;
    const target = index * 6;
    indices[target] = base;
    indices[target + 1] = base + 1;
    indices[target + 2] = base + 2;
    indices[target + 3] = base;
    indices[target + 4] = base + 2;
    indices[target + 5] = base + 3;
  }

  return Object.freeze({
    corner,
    birth,
    motion,
    shape,
    tint,
    indices,
    vertexCount,
    indexCount: indices.length,
  });
}

/**
 * Vertex shader: a forma fechada, escrita uma vez. Mantido em sincronia com
 * `sampleParticle` de `@theatrum/effects` — as duas implementações existem para
 * poder comparar GPU contra referência de CPU.
 */
export const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 aCorner;
in vec4 aBirth;   // birthFrame, lifetime, variation, rotation
in vec4 aMotion;  // originX, originY, velocityX, velocityY
in vec4 aShape;   // accelX, accelY, size, sizeEnd
in vec4 aTint;    // r, g, b, spin

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uFrame;
uniform float uOpacity;
uniform int uFade;
uniform float uWobble;
uniform float uWobbleOmega;
uniform int uDrift;

out vec2 vLocal;
out vec4 vColor;

float fadeCurve(int mode, float t, float variation) {
  if (mode == 0) return 1.0 - t * t;
  if (mode == 1) return min(1.0, t * 6.0) * pow(1.0 - t, 1.5);
  if (mode == 2) return pow(1.0 - t, 4.0) * (0.7 + 0.3 * sin(variation * 31.0 + t * 40.0));
  return t > 0.92 ? (1.0 - t) / 0.08 : 1.0;
}

void main() {
  float tau = uFrame - aBirth.x;
  float lifetime = max(aBirth.y, 0.0001);
  float progress = tau / lifetime;

  if (tau < 0.0 || progress > 1.0) {
    // Partícula fora da vida: colapsa o quad e sai do clip.
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vLocal = vec2(0.0);
    vColor = vec4(0.0);
    return;
  }

  vec2 center = aMotion.xy + aMotion.zw * tau + 0.5 * aShape.xy * tau * tau;
  if (uDrift == 1 && uWobble > 0.0) {
    float phase = aBirth.z * 6.2831853;
    center.x += sin(phase + uWobbleOmega * tau) * uWobble;
    center.y += cos(phase * 1.7 + uWobbleOmega * 0.6 * tau) * uWobble * 0.35;
  }

  float size = aShape.z * (1.0 + (aShape.w - 1.0) * progress);
  float angle = radians(aBirth.w + aTint.w * tau);
  float cosine = cos(angle);
  float sine = sin(angle);
  vec2 offset = vec2(
    aCorner.x * cosine - aCorner.y * sine,
    aCorner.x * sine + aCorner.y * cosine
  ) * size;

  vec3 position = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix *
    vec3(center + offset, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);

  vLocal = aCorner * 2.0;
  float alpha = clamp(fadeCurve(uFade, progress, aBirth.z), 0.0, 1.0) * uOpacity;
  vColor = vec4(aTint.rgb, alpha);
}
`;

/**
 * Fragment shader: disco com borda suave. Sem textura — evita carregar asset e
 * mantém a nuvem inteira num único material.
 */
export const PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vLocal;
in vec4 vColor;
out vec4 fragColor;

void main() {
  float distance = length(vLocal);
  // Borda suave de dentro para fora; 1.0 é o raio do disco.
  float mask = 1.0 - smoothstep(0.55, 1.0, distance);
  if (mask <= 0.0) discard;
  fragColor = vec4(vColor.rgb, vColor.a * mask);
}
`;

function parseHexColor(hex: string): readonly [number, number, number] {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  if (clean.length < 6) return [1, 1, 1];
  const red = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const green = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(clean.slice(4, 6), 16) / 255;
  if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) return [1, 1, 1];
  return [red, green, blue];
}
