# ADR-003 — Determinismo como invariante do motor

**Status:** aceito · **Data:** 2026-07-26 · **Revisar:** nunca

Este é o ADR mais importante do projeto. Toda a arquitetura decorre dele.

## Contexto

Renderizar 90 s a 60 fps em 4K são 5.400 frames. A ~250 ms por frame, são 22
minutos. O render **não roda em tempo real** — e não deve tentar.

Isso força uma propriedade sobre o motor: precisa ser possível avaliar e desenhar
um frame arbitrário `f` sem ter passado pelos anteriores. Se o estado do frame 900
depender de ter renderizado o 899, então:

- Scrub para trás mostra coisa errada
- Retomar um render interrompido é impossível
- Motion blur (que amostra frames fracionários) não funciona
- Renderizar em paralelo nunca será possível
- Dois exports do mesmo projeto produzem arquivos diferentes

## Decisão

**Renderização é função pura de `(documento, frame)`.**

```
render(documento, f) → imagem
```

Sem estado acumulado. Sem tempo real. Sem aleatoriedade não semeada. Em qualquer
lugar do motor.

## Regras derivadas

| #   | Regra                                                                    | Verificação                |
| --- | ------------------------------------------------------------------------ | -------------------------- |
| D1  | Proibido `Date.now()`, `performance.now()`, `new Date()` em `packages/*` | ESLint `no-nondeterminism` |
| D2  | Proibido `Math.random()` em todo o projeto                               | ESLint `no-nondeterminism` |
| D3  | Toda semente deriva de `hashSeed(comp.seed, nodeId, ...)`                | revisão + teste            |
| D4  | Sem estado entre frames em `evaluate()` ou em efeito                     | teste de ordem aleatória   |
| D5  | `map.fadeDuration = 0` no render                                         | asserção no frame pump     |
| D6  | Nenhuma media query ou `prefers-*` no caminho de render                  | ESLint                     |
| D7  | Ordem de iteração explícita, nunca ordem de chave de objeto              | revisão                    |
| D8  | Fontes carregadas antes do frame 0                                       | asserção no início do job  |

## Consequências

### Partículas precisam ser analíticas

Sistemas de partículas normais integram velocidade por frame — acumulativo por
natureza. Aqui, cada partícula é função fechada do tempo:

```
P(i, f) = origem(i) + v₀(i)·τ + ½·a·τ²      onde τ = f − nascimento(i)
```

Todos os termos derivam de `hashSeed(effectId, i)`. Calculado no vertex shader,
com `f` como uniform.

Isso não é apenas uma concessão ao determinismo — é **mais rápido**: zero custo de
CPU, um draw call para 5.000 partículas, e scrub para trás funciona de graça.

### Suavização de câmera precisa ser janela fixa

`damping` normalmente é `pos += (target − pos) × k` por frame — acumulativo. Aqui é
média ponderada de N frames de posição-alvo em torno de `f`, calculada do zero a
cada avaliação. Custa mais CPU. Mantém a pureza.

### Settle do mapa passa a ser obrigatório

O MapLibre é assíncrono. Sem esperar tiles, o mesmo frame renderizado duas vezes
dá resultado diferente. Ver
[06-RENDER-PIPELINE.md § 4](../06-RENDER-PIPELINE.md#4-determinismo-e-settle-do-mapa).

### Frame fracionário precisa ser válido

Motion blur amostra `f ± 0.25`. Logo `evaluate(doc, id, frame: number)` — não
`Frame` estrito. É a única exceção à regra de tempo inteiro.

## Custo

- Alguns efeitos ficam mais caros (damping por janela).
- Alguns efeitos ficam **impossíveis** sem mecanismo extra: colisão entre
  partículas, flocking, fluidos com histórico. Não estão no escopo. Se um dia
  entrarem, entram como _simulação de passo fixo com cache de estado_, mecanismo
  separado e explicitamente marcado.
- Exige disciplina permanente, por isso a verificação é automatizada.

## Ganho

- Export byte-idêntico entre execuções — critério de saída da Fase 8.
- Scrub instantâneo em qualquer direção.
- Retomada de render interrompido.
- Motion blur.
- Testabilidade: golden frames comparáveis.
- Paralelização futura de render, sem mudança de arquitetura.

## Verificação

Bloqueia merge:

```ts
it("avaliar frame 500 direto == sequencialmente até 500", () => {
  /* ... */
});
it("renderizar [0,137,900] == renderizar [900,0,137]", () => {
  /* ... */
});
it("mesmo seed → mesmo frame de explosão, hash exato", () => {
  /* ... */
});
```

## Por que "revisar: nunca"

Não é uma escolha entre alternativas com trade-off. É a propriedade que torna
possível exportar vídeo confiável a partir de um motor que não roda em tempo real.
Abandoná-la significaria abandonar o requisito de reprodutibilidade.
