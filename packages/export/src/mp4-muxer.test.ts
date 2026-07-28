/**
 * Provas do muxer MP4. Um contêiner errado abre no player e mostra tela verde,
 * ou nada — nunca uma mensagem útil. Então o que se testa aqui é a **estrutura**:
 * as caixas existem, estão aninhadas certo, e os campos que o decodificador lê
 * têm o valor que ele espera.
 */

import { describe, expect, it } from "vitest";
import { box, concat, fixed1616, u32, u64, type Bytes } from "./mp4-boxes.js";
import {
  VIDEO_TIMESCALE,
  mp4Fragment,
  mp4Header,
  toTimescale,
  type EncodedSample,
} from "./mp4-muxer.js";

const CONFIG = {
  width: 1920,
  height: 1080,
  timescale: VIDEO_TIMESCALE,
  // avcC de mentira: o muxer não interpreta, só embute.
  description: new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 1, 2, 3]),
};

function sample(overrides: Partial<EncodedSample> = {}): EncodedSample {
  return {
    keyFrame: false,
    timestamp: 0,
    duration: 3000,
    data: new Uint8Array([9, 9, 9, 9]),
    ...overrides,
  };
}

/** Percorre as caixas de um nível e devolve tipo e conteúdo de cada uma. */
function parseBoxes(bytes: Bytes): { type: string; size: number; body: Bytes }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { type: string; size: number; body: Bytes }[] = [];
  let at = 0;
  while (at + 8 <= bytes.byteLength) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > bytes.byteLength) break;
    let type = "";
    for (let i = 0; i < 4; i += 1) type += String.fromCharCode(bytes[at + 4 + i] as number);
    out.push({ type, size, body: bytes.subarray(at + 8, at + size) });
    at += size;
  }
  return out;
}

/**
 * Preâmbulo a saltar antes de as caixas-filhas começarem, por tipo de pai.
 *
 * `stsd` é uma caixa completa **com contagem**: versão(1) + flags(3) +
 * entry_count(4) antes da primeira entrada. Ler o corpo dele como se fosse
 * caixa direto faz o parser interpretar a contagem como tamanho — que é
 * exatamente o tipo de erro que este arquivo de teste existe para pegar, e caiu
 * primeiro no próprio helper.
 */
const CHILD_OFFSET: Readonly<Record<string, number>> = {
  stsd: 8,
  // `avc1` é um VisualSampleEntry: 8 bytes de SampleEntry mais 70 de campos
  // fixos (dimensões, resolução, nome do compressor de 32 bytes, profundidade)
  // antes de o `avcC` começar. Setenta e oito, e não é negociável — errar aqui
  // faz o decodificador não encontrar o SPS.
  avc1: 78,
};

/** Busca uma caixa por caminho, ex.: `moov/trak/mdia`. */
function find(bytes: Bytes, path: string): Bytes | null {
  let current = bytes;
  for (const step of path.split("/")) {
    const found = parseBoxes(current).find((entry) => entry.type === step);
    if (found === undefined) return null;
    current = found.body.subarray(CHILD_OFFSET[step] ?? 0);
  }
  return current;
}

describe("mp4Header", () => {
  const header = mp4Header(CONFIG);

  it("abre com ftyp e traz moov", () => {
    const top = parseBoxes(header).map((entry) => entry.type);
    expect(top[0]).toBe("ftyp");
    expect(top).toContain("moov");
  });

  it("declara iso6 — é o que anuncia fragmentos ao player", () => {
    const ftyp = find(header, "ftyp");
    expect(ftyp).not.toBeNull();
    const marcas = new TextDecoder().decode(ftyp as Bytes);
    expect(marcas).toContain("iso6");
    expect(marcas).toContain("avc1");
  });

  it("tem mvex — sem ele o player ignora os fragmentos", () => {
    // Um moov sem mvex descreve um arquivo clássico. Com tabela de amostras
    // vazia, o player conclui que o vídeo tem zero frames e mostra nada.
    expect(find(header, "moov/mvex/trex")).not.toBeNull();
  });

  it("a tabela de amostras está vazia e o stsd preenchido", () => {
    const stbl = find(header, "moov/trak/mdia/minf/stbl");
    expect(stbl).not.toBeNull();
    const caixas = parseBoxes(stbl as Bytes);
    const contagem = (type: string): number => {
      const entry = caixas.find((c) => c.type === type);
      if (entry === undefined) return -1;
      // Depois de versão(1) + flags(3) vem a contagem de entradas.
      return new DataView(entry.body.buffer, entry.body.byteOffset).getUint32(4);
    };
    expect(contagem("stts")).toBe(0);
    expect(contagem("stsc")).toBe(0);
    expect(contagem("stco")).toBe(0);
    // Mas há exatamente uma descrição de amostra.
    expect(contagem("stsd")).toBe(1);
  });

  it("embute o avcC recebido, byte a byte", () => {
    const avcC = find(header, "moov/trak/mdia/minf/stbl/stsd/avc1/avcC");
    expect(avcC).not.toBeNull();
    expect([...(avcC as Bytes)]).toEqual([...CONFIG.description]);
  });

  it("as dimensões aparecem em pixels no avc1 e em 16.16 no tkhd", () => {
    // Corpo **cru** do avc1, sem o salto de 78 bytes: as dimensões vivem dentro
    // do preâmbulo, não depois dele.
    const stsd = find(header, "moov/trak/mdia/minf/stbl/stsd") as Bytes;
    const avc1 = parseBoxes(stsd).find((entry) => entry.type === "avc1")?.body as Bytes;
    const view = new DataView(avc1.buffer, avc1.byteOffset);
    // 24 bytes de preâmbulo de VisualSampleEntry antes de largura/altura.
    expect(view.getUint16(24)).toBe(1920);
    expect(view.getUint16(26)).toBe(1080);

    const tkhd = find(header, "moov/trak/tkhd") as Bytes;
    const largura = tkhd.subarray(tkhd.byteLength - 8, tkhd.byteLength - 4);
    expect([...largura]).toEqual([...fixed1616(1920)]);
  });

  it("o tkhd tem exatamente 80 bytes de corpo — a contagem da especificação", () => {
    // Este número é o teste mais valioso do arquivo. A primeira versão omitiu
    // `duration` e metade do `reserved`, doze bytes a menos, e **nada** acusou:
    // as caixas continuavam íntegras, os tamanhos batiam, o parser não reclamava.
    // Só o Chromium recusava o arquivo, sem dizer por quê. Se este número mudar,
    // a matriz e as dimensões estão sendo lidas do lugar errado.
    const tkhd = find(header, "moov/trak/tkhd") as Bytes;
    expect(tkhd.byteLength).toBe(4 + 80);
  });

  it("o mvhd tem exatamente 96 bytes de corpo", () => {
    const mvhd = find(header, "moov/mvhd") as Bytes;
    expect(mvhd.byteLength).toBe(4 + 96);
  });

  it("não carrega timestamp nenhum — dois exports não podem diferir pela hora", () => {
    const mvhd = find(header, "moov/mvhd") as Bytes;
    const view = new DataView(mvhd.buffer, mvhd.byteOffset);
    // Depois de versão+flags: criação e modificação.
    expect(view.getUint32(4)).toBe(0);
    expect(view.getUint32(8)).toBe(0);
  });

  it("é determinístico: duas chamadas dão os mesmos bytes", () => {
    expect([...mp4Header(CONFIG)]).toEqual([...mp4Header(CONFIG)]);
  });
});

describe("mp4Fragment", () => {
  it("devolve null sem amostras — fragmento vazio é arquivo corrompido", () => {
    expect(mp4Fragment([], 1, 0)).toBeNull();
  });

  it("monta moof seguido de mdat", () => {
    const fragment = mp4Fragment([sample({ keyFrame: true })], 1, 0);
    expect(fragment).not.toBeNull();
    const top = parseBoxes((fragment as { bytes: Bytes }).bytes).map((entry) => entry.type);
    expect(top).toEqual(["moof", "mdat"]);
  });

  it("o data_offset do trun aponta exatamente para o primeiro byte de amostra", () => {
    // É o campo mais fácil de errar do fMP4, e errado ele produz um arquivo que
    // abre e não decodifica. Aqui o valor é conferido contra a posição real.
    const dados = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x11]);
    const fragment = mp4Fragment([sample({ keyFrame: true, data: dados })], 1, 0);
    const bytes = (fragment as { bytes: Bytes }).bytes;
    const trun = find(bytes, "moof/traf/trun") as Bytes;
    const view = new DataView(trun.buffer, trun.byteOffset);
    // versão(1) + flags(3) + sample_count(4) → data_offset
    const dataOffset = view.getUint32(8);
    expect([...bytes.subarray(dataOffset, dataOffset + dados.byteLength)]).toEqual([...dados]);
  });

  it("o mdat contém as amostras concatenadas na ordem", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const fragment = mp4Fragment([sample({ keyFrame: true, data: a }), sample({ data: b })], 1, 0);
    const mdat = find((fragment as { bytes: Bytes }).bytes, "mdat") as Bytes;
    expect([...mdat]).toEqual([1, 2, 3, 4, 5]);
  });

  it("cada amostra leva a própria duração e o próprio tamanho", () => {
    // Duração e tamanho fixos no `trex` não servem: um codificador produz
    // quadro-chave grande e delta pequeno, e a duração varia com taxa fracionária.
    const fragment = mp4Fragment(
      [
        sample({ keyFrame: true, duration: 3000, data: new Uint8Array(120) }),
        sample({ duration: 3750, data: new Uint8Array(7) }),
      ],
      1,
      0,
    );
    const trun = find((fragment as { bytes: Bytes }).bytes, "moof/traf/trun") as Bytes;
    const view = new DataView(trun.buffer, trun.byteOffset);
    // Depois de versão+flags(4) + count(4) + data_offset(4), as linhas de 12 bytes.
    expect(view.getUint32(12)).toBe(3000);
    expect(view.getUint32(16)).toBe(120);
    expect(view.getUint32(24)).toBe(3750);
    expect(view.getUint32(28)).toBe(7);
  });

  it("marca sincronismo só no quadro-chave", () => {
    const fragment = mp4Fragment([sample({ keyFrame: true }), sample({ keyFrame: false })], 1, 0);
    const trun = find((fragment as { bytes: Bytes }).bytes, "moof/traf/trun") as Bytes;
    const view = new DataView(trun.buffer, trun.byteOffset);
    // 0x02000000 = é ponto de sincronismo; 0x01010000 = não é.
    expect(view.getUint32(20)).toBe(0x02000000);
    expect(view.getUint32(32)).toBe(0x01010000);
  });

  it("o tempo de decodificação em 64 bits sobrevive a vídeo longo", () => {
    // 32 bits a 90 kHz estouram em 13 horas. O `tfdt` versão 1 evita isso, e este
    // teste falharia se alguém voltasse para a versão 0.
    const grande = 5_000_000_000;
    const fragment = mp4Fragment([sample({ keyFrame: true })], 7, grande);
    const tfdt = find((fragment as { bytes: Bytes }).bytes, "moof/traf/tfdt") as Bytes;
    expect(tfdt[0]).toBe(1);
    expect([...tfdt.subarray(4)]).toEqual([...u64(grande)]);
  });

  it("avança o tempo de decodificação pela soma das durações", () => {
    const fragment = mp4Fragment(
      [sample({ keyFrame: true, duration: 3000 }), sample({ duration: 3000 })],
      1,
      9000,
    );
    expect((fragment as { nextDecodeTime: number }).nextDecodeTime).toBe(15_000);
    expect((fragment as { sequence: number }).sequence).toBe(2);
  });

  it("é determinístico", () => {
    const args = [[sample({ keyFrame: true })], 3, 12_000] as const;
    const a = mp4Fragment(...args) as { bytes: Bytes };
    const b = mp4Fragment(...args) as { bytes: Bytes };
    expect([...a.bytes]).toEqual([...b.bytes]);
  });
});

describe("toTimescale", () => {
  it("converte microssegundos para a escala da trilha", () => {
    // Um frame a 30 fps é 33 333,33 µs; a 90 kHz, exatamente 3000 unidades.
    expect(toTimescale(1_000_000 / 30, VIDEO_TIMESCALE)).toBe(3000);
    expect(toTimescale(1_000_000, VIDEO_TIMESCALE)).toBe(90_000);
  });

  it("arredonda em vez de truncar", () => {
    // Truncar sistematicamente adianta o vídeo em relação ao áudio, e o desvio
    // cresce com a duração.
    expect(toTimescale(1_000_000 / 24, VIDEO_TIMESCALE)).toBe(3750);
    expect(toTimescale(1_000_000 / 23.976, VIDEO_TIMESCALE)).toBe(3754);
  });

  it("não acumula: o frame 10 mil cai onde a multiplicação manda", () => {
    const um = 1_000_000 / 30;
    expect(toTimescale(um * 10_000, VIDEO_TIMESCALE)).toBe(30_000_000);
  });
});

describe("escritor de caixas", () => {
  it("recusa tipo que não tem quatro caracteres", () => {
    // Três bytes desalinham o arquivo inteiro, e o player só diz "corrompido".
    expect(() => box("abc", u32(0))).toThrow();
    expect(() => box("abcde", u32(0))).toThrow();
  });

  it("u64 não usa deslocamento bit a bit, que truncaria em 32 bits", () => {
    // `x >>> 32` em JS devolve x. Um u64 escrito assim daria metade alta errada
    // em qualquer valor acima de 2^32 — 71 minutos de linha de tempo em µs.
    expect([...u64(2 ** 32)]).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    expect([...u64(2 ** 32 + 5)]).toEqual([0, 0, 0, 1, 0, 0, 0, 5]);
  });

  it("concat preserva ordem e tamanho", () => {
    expect([...concat([new Uint8Array([1]), new Uint8Array([2, 3])])]).toEqual([1, 2, 3]);
    expect(concat([]).byteLength).toBe(0);
  });
});
