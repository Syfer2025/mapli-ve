# ADR-011 — Estradas agrupadas por país via junção espacial na compilação

**Status:** aceito · **Data:** 2026-07-27 · **Revisar em:** Fase 11

## Contexto

O [ADR-009](ADR-009-geo-layers-overlay.md) decidiu _onde_ as estradas são
desenhadas (overlay Pixi, herdado de países) e registou explicitamente que a
conta não estava fechada: "`geo.roads` exige medição própria antes de existir."

Duas perguntas precisavam de número, não de opinião:

1. **Qual a identidade de um nó `geo.roads`?** Rio é por nome (`r:Nile`), país
   por ISO (`c:UKR`). Estrada não tem nem um nem outro: só 18,6% dos 56.600
   segmentos do `ne_10m_roads` têm nome, e nenhum código de estrada é
   consistente fora da América do Norte.
2. **O custo de frame fecha?** A origem tem 48 MB e 709 mil vértices, contra
   13 MB e 259 mil dos países — e a densidade por área é outra.

Medição (script `scratchpad/measure-roads.ts`, caminho real de runtime, média
de 40 execuções, metodologia do ADR-009):

| Pergunta                                                            | Número                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Segmentos com `sov_a3` preenchido                                   | 9.321 de 56.645 linhas — **só América do Norte/Central** (15 valores) |
| Vértices sem soberano                                               | 605.285 de 709.166 (85,4%)                                            |
| Junção espacial (ponto médio do segmento → país), amostra de 5.254  | 178 ms → **~1,6 s** extrapolado; 99,1% atribuídos                     |
| Frame, Ucrânia inteira na tela (z6, 1.011 linhas, 15.780 vértices)  | **0,31 ms**                                                           |
| Frame, Alemanha inteira na tela (z6, 1.080 linhas, 12.840 vértices) | **0,30 ms**                                                           |
| Frame, zoom de cidade (z12–13, Kiev/Berlim)                         | 0,01–0,02 ms                                                          |

Orçamento de overlay: 8 ms, parcialmente consumido (06 § 10). O pior caso
plausível medido — país europeu denso inteiro na tela — gasta 4% dele.

## Alternativas

### A. Agrupar por `sov_a3`, como a origem vem

✅ Zero trabalho de compilação: a tabela `LAYERS` ganharia uma linha.
❌ **Inviável por construção, medido:** o Natural Earth só preenche soberania
na América do Norte e Central. Ucrânia, Brasil, Rússia — os casos do roteiro —
cairiam todos num balaio "(sem soberano)" de 605 mil vértices.

### B. Camada-mundo única, sem agrupamento (`roads:WORLD`)

✅ Nenhuma junção na compilação; o descarte por caixa de anel, que já existe,
faz o recorte geográfico por frame.
❌ Não existe "as estradas **da Ucrânia**": ligar o nó mostra as estradas de
tudo que estiver na vista, inclusive dos vizinhos. O critério 3 do bloco fala
em "estradas de um país inteiro" — o nó precisa ser por país.
❌ Todo frame paga a varredura de 56 mil caixas de anel, mesmo com o nó de um
só país na cena.

### C. Junção espacial na compilação: cada segmento vai para o país que contém

o seu ponto médio

✅ Identidade estável e buscável: `roads:UKR`, com nome de país — entra no
catálogo de território sem mecanismo novo.
✅ Custo de build medido em ~1,6 s, uma vez, determinístico (mesma malha de
países fixada por hash, ordem de candidatos estável).
✅ Custo de frame medido: 0,31 ms no pior caso plausível.
❌ Segmento que cruza fronteira é atribuído **inteiro** ao país do ponto
médio — a ponta estrangeira aparece junta. Cortar o segmento na fronteira seria
uma segunda geometria de interseção, muito mais complexa, para um erro visual
de quilômetros poucos.
❌ Enclave resolve pelo menor país candidato (Lesoto dentro da África do Sul):
regra determinística, mas é uma escolha, não um fato da origem.

## Decisão

**Alternativa C.** A malha de estradas é compilada agrupada pelo país que
contém o ponto médio de cada segmento, testando candidatos em ordem crescente
de área de caixa — o país mais local ganha, o que resolve enclave e mantém a
Rússia (caixa de −180 a 180, candidata a todo ponto da Terra) fora do caminho
quente.

Segmentos sem país (0,9% — rotas de ferry e trechos em água ou em disputa)
**não são descartados em silêncio**: vão para a feição `roads:--`, selecionável
como qualquer outra.

## Consequências

- O compilador deixa de ser um loop uniforme feição-a-feição: a camada de
  estradas declara agrupamento espacial e o `tools/build-geo.ts` ganha uma
  junção ponto-no-polígono, coberta por teste próprio.
- A compilação (`pnpm geo:build`, e o `--verify` do `pnpm check`) fica ~2 s
  mais lenta. Aceito: continua abaixo do ruído do check inteiro.
- A índice das estradas é o maior artefato de `data/geo` (~4 MB de JSON por
  causa das 56 mil caixas de anel). Carga sob demanda, como as outras camadas.
- A simplificação por zoom afina a **forma** de cada segmento, não a **rede**:
  Douglas–Peucker preserva os extremos, e o descarte de anel com menos de 3
  sobreviventes é o que faz a rede ralear em zoom baixo. O sinal correto para
  afinar a rede seria o `scalerank` da origem; não usá-lo é uma limitação
  declarada, revisável se uma prova ao vivo mostrar rede esparsa demais em
  zoom de país.
- Herdam-se do ADR-009 o lugar do desenho e do ADR-010 o formato binário.

## Quando revisar

Se o verificador do bloco 7B medir estradas de um país inteiro acima de **2 ms
de frame** em qualquer zoom, ou se uma cena real precisar de **mais de cinco
redes de estradas visíveis ao mesmo tempo** — nesse caso a alternativa B volta
à mesa como camada complementar de fundo, convivendo com os nós por país.
