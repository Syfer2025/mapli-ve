# ADR-020 — Marcação no objeto é decalque projetado, não textura reescrita

**Status:** proposto · **Data:** 2026-07-29 · **Revisar em:** quando alguém pedir marcação que precise sobreviver fora do Theatrum (exportar o GLB alterado para outra ferramenta)

## Contexto

O dono pediu: _"quero apagar um texto que tá na malha"_ e _"criar uma imagem para
sobrepor uma escrita ou uma logo"_.

**Medi antes de decidir.** O F/A-18F do repositório tem **40 imagens, 40 texturas
e 20 materiais**, e nenhuma imagem tem nome — saída típica de OBJ → Sketchfab, que
é de onde vem a maior parte do acervo militar disponível. Das 63 texturas
extraídas, **13 são pintura** (`baseColor`); o resto descreve relevo e brilho.

Três consequências dessa medição, e elas decidem o ADR:

1. A escrita **não está na malha**. Está pintada numa das 13 imagens de cor.
2. Achar em qual delas é trabalho humano: os materiais se chamam
   `ccf7a0a8-afba-49fa-b09e-…` e cobrem `Object_31, Object_32, Object_33`.
3. Um objeto tem **20 materiais**, então uma marcação que atravesse a divisa de
   dois materiais precisaria editar duas imagens em registro perfeito.

A ferramenta `pnpm models:textures` já resolve o passo 2 — ela extrai organizado,
com índice, para o dono editar no Photoshop. Este ADR decide o passo seguinte:
**como a marcação entra no palco**.

## Alternativas

### A. Reescrever a textura dentro do GLB

Extrair a imagem, o dono pinta, reempacotar o arquivo.

✅ Roda em qualquer ferramenta depois: o GLB alterado leva a pintura consigo.
✅ Custo zero de render — é a mesma textura de sempre.
❌ **Destrutivo.** O arquivo original de 49 MB é substituído. Errar significa
baixar de novo.
❌ **Não desfaz.** Fica fora do Command Bus e do `.theatrum`; `Ctrl+Z` não alcança.
❌ **Não anima.** Uma marcação que aparece no frame 200 exigiria dois GLBs.
❌ Marcação que cruza materiais exige editar duas imagens alinhadas à mão.

### B. Decalque projetado na superfície

O dono clica no ponto; uma imagem é projetada ali, recortando a superfície do
modelo e gerando uma casca que acompanha a curvatura (`DecalGeometry`, do three).

✅ **Não-destrutivo.** O GLB não é tocado. O decalque mora no documento, versiona,
desfaz e viaja no `.theatrum`.
✅ **Reaproveita o que já está provado.** Clique → raycast → ponto é exatamente o
[ADR-015](ADR-015-studio-points-of-interest.md), e a ancoragem ao objeto é o
[ADR-016](ADR-016-poi-anchored-to-object.md). Falta pedir ao `pick` a **normal**.
✅ **Anima.** Opacidade, escala e giro são props como quaisquer outras, então uma
insígnia pode surgir no meio da apresentação.
✅ **Atravessa material sem saber disso**: a projeção é geométrica, não por UV.
❌ Custo de geometria por decalque, uma vez, na criação.
❌ Precisa de `polygonOffset`, senão briga em profundidade com a fuselagem.
❌ **Não sai do Theatrum.** Exportar o GLB para outra ferramenta perde a marcação.

### C. Exigir modelo já marcado

✅ Zero código.
❌ Joga o problema no dono, que precisaria de Blender — **verificado que não existe
nesta máquina**, o mesmo bloqueio do VFX volumétrico.

## Decisão

**Alternativa B, e a A continua disponível como ferramenta.** As duas resolvem
problemas diferentes e não competem:

- **Decalque** é para marcação que pertence à _apresentação_: a logo do cliente, a
  seta que aponta o tanque, o retalho que tapa a matrícula errada. Reversível,
  animável, e some quando o projeto muda.
- **Reescrever textura** é para correção que pertence ao _acervo_: a camuflagem
  errada do modelo inteiro. Continua sendo o caminho, feita fora com
  `pnpm models:textures` e um editor de imagem de verdade.

O que decide é **onde a informação pertence**. "Este avião é cinza-escuro" é
propriedade do modelo. "Nesta apresentação, a logo entra aos 12 segundos" é
propriedade do documento — e guardar isso num arquivo binário de 49 MB seria pôr
decisão de edição num lugar que não desfaz, não versiona e não anima.

### Forma

- Tipo de nó **`studio.decal`**: ponto e normal na superfície (no espaço do objeto,
  como o `studio.poi`), `ownerId` do `model3d`, imagem, tamanho em metros, giro,
  opacidade e profundidade de projeção.
- O **`pick` passa a devolver a normal** além do ponto. É uma linha: o raycast do
  three já a traz em `intersection.face.normal`, e ela é hoje descartada.
- Botão **Colar decalque** na barra do palco, irmão de _Marcar pontos_: ligado, o
  clique na superfície cria o decalque com a imagem selecionada na Biblioteca.
- Desenho por `DecalGeometry`, com `polygonOffset` e `depthWrite: false`.

## Consequências

- **Decalque não sai no GLB.** Quem exportar o modelo para outra ferramenta perde
  a marcação. Aceito: é o preço de não ser destrutivo, e o caminho da textura
  existe para quem precisar do contrário.
- **Exige a geometria carregada**, como o POI: não há superfície para projetar
  enquanto o GLB está em parse. `pendingModels()` já responde isso.
- **Trocar o GLB estraga o decalque.** Mesma consequência do ADR-016, e pelo mesmo
  motivo: a marcação é do objeto, não do arquivo.
- **Geometria por decalque tem custo.** Dezenas de decalques num modelo pesado
  cobram na criação. O limite prático deve ser medido antes de virar promessa, e
  o número entra no roteiro quando for.
- **Superfície muito curva deforma a imagem.** Projeção é projeção: uma logo
  colada sobre uma quina vai dobrar. É o comportamento correto, e precisa de aviso
  na interface em vez de conserto no modelo de dados.

## Quando revisar

Quando alguém precisar levar a marcação para fora do Theatrum. Aí "assar" o
decalque na textura passa a ter significado, e vale oferecer **além** do decalque
— nunca em vez dele.
