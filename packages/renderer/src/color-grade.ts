/**
 * Matriz de correção de cor.
 *
 * Quatro controles — exposição, contraste, saturação e temperatura — colapsam em
 * uma única matriz 4×5 antes de chegar à GPU. Isso importa por dois motivos: o
 * passe custa uma multiplicação por pixel em vez de quatro, e a matemática fica
 * verificável em Node, sem contexto gráfico. Os testes desta pasta comprovam a
 * identidade, o cinza total e a ordem de composição.
 *
 * O formato é o que o `ColorMatrixFilter` do Pixi espera: vinte números, quatro
 * linhas de cinco, cada linha `[r, g, b, a, offset]`. O offset é somado depois da
 * multiplicação e opera na escala 0–1.
 */

/** Coeficientes de luminância do Rec. 709 — o mesmo espaço em que o Pixi compõe. */
const LUMA = Object.freeze([0.2126, 0.7152, 0.0722] as const);

export interface ColorGradeParams {
  /** Paradas de exposição; o ganho é 2^exposure. */
  readonly exposure: number;
  /** −1 achata para o cinza médio, +1 dobra o contraste. */
  readonly contrast: number;
  /** −1 remove toda a cor, +1 dobra a saturação. */
  readonly saturation: number;
  /** Negativo esfria (mais azul), positivo esquenta (mais vermelho). */
  readonly temperature: number;
}

/**
 * Vinte números, não uma lista qualquer: o tipo é tupla de tamanho exato porque o
 * `ColorMatrixFilter` do Pixi exige `length: 20`, e assim o compilador cobra em
 * vez de o shader receber uma matriz truncada.
 */
export type ColorMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Fecha uma lista de vinte números na tupla. Lança se o tamanho não bater. */
export function toColorMatrix(values: readonly number[]): ColorMatrix {
  if (values.length !== 20) {
    throw new RangeError(`Matriz de cor precisa de 20 números, veio com ${values.length}.`);
  }
  const at = (index: number): number => values[index] ?? 0;
  return Object.freeze([
    at(0),
    at(1),
    at(2),
    at(3),
    at(4),
    at(5),
    at(6),
    at(7),
    at(8),
    at(9),
    at(10),
    at(11),
    at(12),
    at(13),
    at(14),
    at(15),
    at(16),
    at(17),
    at(18),
    at(19),
  ] as const);
}

export const IDENTITY_COLOR_MATRIX: ColorMatrix = toColorMatrix([
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
]);

/**
 * Compõe `outer` depois de `inner`: o resultado aplica `inner` primeiro.
 *
 * Cada matriz é afim, então a composição multiplica a parte linear e transporta
 * o offset de `inner` pela parte linear de `outer`.
 */
export function composeColorMatrices(outer: ColorMatrix, inner: ColorMatrix): ColorMatrix {
  const out = new Array<number>(20).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (outer[row * 5 + k] ?? 0) * (inner[k * 5 + column] ?? 0);
      }
      out[row * 5 + column] = sum;
    }
    let offset = outer[row * 5 + 4] ?? 0;
    for (let k = 0; k < 4; k += 1) {
      offset += (outer[row * 5 + k] ?? 0) * (inner[k * 5 + 4] ?? 0);
    }
    out[row * 5 + 4] = offset;
  }
  return toColorMatrix(out);
}

/** Ganho por canal, sem mexer no alfa. */
function gainMatrix(red: number, green: number, blue: number): ColorMatrix {
  return toColorMatrix([red, 0, 0, 0, 0, 0, green, 0, 0, 0, 0, 0, blue, 0, 0, 0, 0, 0, 1, 0]);
}

/** Contraste em torno do cinza médio: `(x − 0,5)·escala + 0,5`. */
function contrastMatrix(scale: number): ColorMatrix {
  const offset = 0.5 * (1 - scale);
  return toColorMatrix([
    scale,
    0,
    0,
    0,
    offset,
    0,
    scale,
    0,
    0,
    offset,
    0,
    0,
    scale,
    0,
    offset,
    0,
    0,
    0,
    1,
    0,
  ]);
}

/** Interpola entre a luminância e a cor original. */
function saturationMatrix(amount: number): ColorMatrix {
  const [lr, lg, lb] = LUMA;
  const inverse = 1 - amount;
  return toColorMatrix([
    lr * inverse + amount,
    lg * inverse,
    lb * inverse,
    0,
    0,
    lr * inverse,
    lg * inverse + amount,
    lb * inverse,
    0,
    0,
    lr * inverse,
    lg * inverse,
    lb * inverse + amount,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ]);
}

/**
 * Temperatura como balanço vermelho/azul.
 *
 * Não é conversão de corpo negro: é o ajuste que um colorista faz de olho, com
 * o verde parado para não puxar o tom de pele. ±15 % nos extremos.
 */
function temperatureMatrix(amount: number): ColorMatrix {
  return gainMatrix(1 + 0.15 * amount, 1, 1 - 0.15 * amount);
}

/**
 * A matriz final. A ordem é a da cadeia de um colorista: primeiro corrige a
 * exposição, depois o branco, então o contraste e por último a saturação — que
 * mede a luminância já corrigida, e não a original.
 */
export function colorGradeMatrix(params: ColorGradeParams): ColorMatrix {
  const gain = Math.pow(2, params.exposure);
  let matrix = gainMatrix(gain, gain, gain);
  if (params.temperature !== 0) {
    matrix = composeColorMatrices(temperatureMatrix(params.temperature), matrix);
  }
  if (params.contrast !== 0) {
    matrix = composeColorMatrices(contrastMatrix(1 + params.contrast), matrix);
  }
  if (params.saturation !== 0) {
    matrix = composeColorMatrices(saturationMatrix(1 + params.saturation), matrix);
  }
  return matrix;
}

/** `true` quando a matriz não muda pixel nenhum — o passe pode ser dispensado. */
export function isIdentityColorMatrix(matrix: ColorMatrix): boolean {
  for (let index = 0; index < 20; index += 1) {
    const expected = IDENTITY_COLOR_MATRIX[index] ?? 0;
    if (Math.abs((matrix[index] ?? 0) - expected) > 1e-9) return false;
  }
  return true;
}
