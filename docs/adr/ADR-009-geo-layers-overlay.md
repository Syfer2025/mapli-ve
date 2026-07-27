# ADR-009 — Camadas geográficas desenhadas no overlay

**Status:** aceito · **Data:** 2026-07-27 · **Revisar em:** Fase 11

## Contexto

O bloco 7B transforma país, estado, rio e estrada em **nós animáveis do
documento**, não em decoração do basemap. O
[08-ROADMAP](../08-ROADMAP.md#7b--camadas-geográficas-contornos-estados-estradas)
deixou o lugar do desenho explicitamente em aberto, com a instrução de resolver
por medição: "Se a malha 10m estourar o orçamento de frame, a alternativa
declarada é camada MapLibre com `feature-state` dirigido pelo engine — decisão
medida, não chutada."

O orçamento é o de
[06 § 10](../06-RENDER-PIPELINE.md#10-orçamentos-de-performance): render de
overlay em **8 ms**, já consumido em parte pelos objetos de cena.

Um contorno de país não é um sprite: é um polígono de milhares de vértices que
precisa ser reprojetado sempre que a câmera se move.

## Medição

Projeção mercator + transformação afim, malha 10m completa, média de 40
execuções:

| País     | Coordenadas | ms/frame | % de 8 ms |
| -------- | ----------- | -------- | --------- |
| Ucrânia  | 2.659       | 0,28     | 3,5 %     |
| Alemanha | 3.027       | 0,14     | 1,8 %     |
| Brasil   | 11.121      | 0,32     | 4,0 %     |
| Rússia   | 36.756      | 1,40     | 17,5 %    |
| Canadá   | 68.193      | 2,73     | 34,1 %    |

Douglas–Peucker por nível de zoom, pontos restantes:

| País    | completo | z4    | z6    | z8     | z10    | z12    |
| ------- | -------- | ----- | ----- | ------ | ------ | ------ |
| Ucrânia | 2.659    | 69    | 268   | 788    | 1.716  | 2.492  |
| Rússia  | 36.756   | 1.553 | 4.803 | 13.263 | 26.408 | 35.081 |
| Canadá  | 68.193   | 2.548 | 7.816 | 22.865 | 47.053 | 64.698 |

## Alternativas

### A. Overlay Pixi, projetando por frame

✅ O nó tem contêiner Pixi próprio, então **aceita a cadeia de filtros da
Fase 6** — `outline` e `glow` funcionam sem nenhum código novo.
✅ Mesmo caminho de composição dos outros nós: `blendMode`, opacidade
hierárquica, track matte e ordem de desenho valem sem exceção.
✅ Determinismo por construção: a geometria projetada é função do frame, e o
export usa exatamente o mesmo código do preview.
❌ Custo de CPU por frame cresce com o número de vértices visíveis.
❌ Exige simplificação própria; o MapLibre já teria isso de graça.

### B. Camada MapLibre com `feature-state`

✅ Custo de projeção zero para nós: o MapLibre já tesselou e projeta na GPU.
✅ Simplificação por zoom vem de graça, embutida nos tiles vetoriais.
✅ Escala para o mapa-múndi temático — cinquenta países pintados sem suar.
❌ **Não tem onde pendurar os filtros.** Não existe contêiner Pixi, então
`outline` e `glow` ficariam de fora — e o critério de saída 4 do bloco exige
justamente que um `geo.region` aceite os filtros existentes.
❌ Blend, matte e ordem de desenho passariam a ter duas implementações
divergentes: uma no Pixi, outra em expressões de estilo do MapLibre.
❌ Animar cor por keyframe viraria `setFeatureState` por frame, fora do caminho
determinístico do avaliador.

## Decisão

**Overlay Pixi**, com a malha 10m simplificada por nível de zoom.

O que decide não é o custo: é o critério 4. A alternativa B falha por
construção, qualquer que fosse a medição. E o custo não obriga a nada — o **pior
país do planeta** consome um terço do orçamento com a malha inteira e sem
simplificação, enquanto uma cena geopolítica típica destaca de duas a cinco
regiões.

A malha 110m que já estava local é descartada para este uso: 93 pontos para a
Ucrânia inteira dão contorno visivelmente poligonal em zoom de cidade, e o
critério 1 pede contorno correto **em qualquer zoom**.

## Consequências

- A simplificação por zoom passa a ser responsabilidade do projeto. Ela acontece
  na compilação da malha ([ADR-010](ADR-010-precompiled-geo-mesh.md)), não por
  frame.
- A escolha do nível **não pode depender do frame anterior**, senão quebra o
  [ADR-003](ADR-003-determinism.md): o nível é função pura do zoom da câmera
  avaliada naquele frame.
- Cena com muitas regiões vai custar. O modo proxy de
  [06 § 10](../06-RENDER-PIPELINE.md#modo-proxy-preview) ganha um degrau novo:
  cair um nível de simplificação. Degradação visível na UI, como os outros.
- Estradas herdam a decisão de _onde_ desenhar, mas **não** a de que a conta
  fecha: o arquivo de origem é quatro vezes o de países e a densidade por área é
  outra. `geo.roads` exige medição própria antes de existir.

## Quando revisar

Se uma cena real precisar de **mais de 20 `geo.region` visíveis no mesmo frame** —
o caso do mapa-múndi temático. Aí o custo passa a mandar, os filtros deixam de
fazer sentido nesse uso, e a alternativa B volta à mesa para esse cenário
específico, convivendo com o overlay em vez de substituí-lo.
