# ADR-007 — Nenhum Rust por enquanto

**Status:** aceito · **Data:** 2026-07-26 · **Revisar em:** Fase 8 e Fase 11

## Contexto

A orientação foi clara: "Rust apenas onde realmente trouxer ganho." Rust é a
escolha certa para trabalho pesado de CPU — mas cada módulo em Rust adiciona uma
fronteira FFI, um toolchain, um passo de build por plataforma e uma barreira de
depuração.

A pergunta correta não é "onde Rust seria mais rápido" (quase em todo lugar), mas
"onde a diferença de velocidade importa **e** o custo da fronteira se paga".

## Decisão

**Nada de Rust na Fase 1–11.** A decisão é reavaliada com **medição**, não com
intuição.

## Análise dos candidatos

| Candidato                      | Estimativa em TS   | Rust ajudaria?    | Veredito                                                                           |
| ------------------------------ | ------------------ | ----------------- | ---------------------------------------------------------------------------------- |
| `evaluate()` de 500 nós        | < 2 ms             | 5–10× mais rápido | **Não.** 2 ms já cabe no orçamento de 16,6 ms. Ganharia 1,8 ms num frame de 16 ms. |
| Simulação de partículas        | ~0 ms              | irrelevante       | **Não.** Roda no vertex shader. A GPU já ganha de qualquer CPU.                    |
| Encoding de vídeo              | —                  | sim               | **Não.** FFmpeg já é C, e WebCodecs já usa hardware. Rust não entra no meio.       |
| Leitura de PMTiles             | I/O bound          | não               | **Não.** Gargalo é disco.                                                          |
| Parse de tiles vetoriais       | —                  | sim               | **Não.** MapLibre já faz em Web Worker com WASM.                                   |
| Comprimento de arco de path    | < 0,5 ms           | 5×                | **Não.** Cacheado; calculado uma vez por path.                                     |
| Serialização de projeto        | ~100 ms para 50 MB | 3×                | **Não.** Acontece no save, não por frame.                                          |
| Composição de frame / readback | dominado por GPU   | não               | **Não.** O custo é `readPixels`, não aritmética.                                   |

Nenhum candidato passa o teste.

## Onde Rust entraria, se entrar

Três cenários concretos, com gatilho de medição:

### 1. Encoder nativo (Fase 8)

**Gatilho:** se `readPixels` + pipe para FFmpeg dominar o tempo de export
(> 60% do frame) e WebCodecs não cobrir os formatos necessários.
**Escopo:** um sidecar em Rust recebendo frames por memória compartilhada e
encodando com `ffmpeg-sys` ou `rav1e`. Fronteira estreita e bem definida.

### 2. Processamento de geometria em lote (Fase 10–11)

**Gatilho:** se importar um GeoJSON de fronteiras com 500.000 vértices travar a UI
por mais de 2 s.
**Escopo:** simplificação (Douglas-Peucker), triangulação e indexação espacial.
Poderia ser WASM em vez de FFI nativo — mais simples e sem toolchain por plataforma.

### 3. Cache de preview em disco (Fase 11)

**Gatilho:** se a compressão de frames de cache em TS não sustentar 60 fps de
leitura.
**Escopo:** compressão/descompressão rápida (LZ4, zstd) via WASM.

Note que 2 e 3 apontam para **WASM**, não FFI nativo. WASM não exige toolchain por
plataforma, roda no mesmo processo e não complica o build do Electron. É o degrau
intermediário certo antes de considerar Rust nativo.

## Consequências

Positivas:

- Um único toolchain (Node + TS). `pnpm install` e pronto.
- Build simples: sem cross-compilation, sem `node-gyp`, sem binário por plataforma.
- Depuração num só runtime, com um só debugger.
- Contribuição futura (inclusive por IA) sem barreira de linguagem.
- Iteração mais rápida — que é o que importa nas fases iniciais.

Negativas aceitas:

- Deixamos performance na mesa. Aceitável enquanto os orçamentos de
  [06 § 10](../06-RENDER-PIPELINE.md#10-orçamentos-de-performance) forem atendidos.

## Como a decisão será revista

Na Fase 8 e na Fase 11, com perfil real em mãos:

1. Medir com `pnpm test:perf` e com o profiler do Chromium.
2. Identificar o gargalo dominante — não o suspeito, o medido.
3. Verificar se um dos gatilhos acima disparou.
4. Se sim, protótipo isolado atrás de um **port** existente, com benchmark A/B.
5. Só então decidir.

A arquitetura de ports já deixa o caminho aberto: substituir `EncoderPort` por uma
implementação Rust não toca em nenhum motor. Foi projetada para isso.

## Nota

Esta decisão não é sobre preferência de linguagem. É sobre não pagar custo de
integração antes de ter medição que o justifique. "Rust é mais rápido" é
verdadeiro e insuficiente — o que decide é se o trecho lento está no caminho
crítico e se o ganho excede o custo permanente da fronteira.
