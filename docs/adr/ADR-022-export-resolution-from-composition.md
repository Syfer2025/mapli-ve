# ADR-022 — A resolução do export vem da composição, não da janela

**Status:** aceito · **Data:** 2026-07-29 · **Revisar em:** quando alguém precisar
editar durante um export, ou pedir 8K

> Emenda o [ADR-013](ADR-013-export-frame-composition.md) no ponto exato em que
> ele mandou ser emendado: _"Quando alguém pedir export acima do tamanho da
> janela. Aí a alternativa A deixa de ser andaime desnecessário e passa a ser o
> requisito."_ O gatilho disparou. A alternativa A **não** passou a ser o
> requisito, e o motivo está na medição.
>
> A decisão de compor as superfícies ao vivo, que é o coração do ADR-013,
> continua valendo. O que muda é de onde sai o **tamanho** dessas superfícies.

## Contexto

Medido nesta máquina, no aplicativo em execução:

| O quê                                      | Valor           |
| ------------------------------------------ | --------------- |
| Janela (`innerWidth` × `innerHeight`)      | 1920 × 991      |
| `devicePixelRatio`                         | 1               |
| Canvas do mapa, e portanto o frame         | **1248 × 566**  |
| `composition.width` × `composition.height` | **1920 × 1080** |

O documento **já declara** a resolução da obra, e o export a ignora. O frame sai
do tamanho do painel — que depende de qual aba está aberta, de onde o usuário
arrastou o divisor do dockview e do tamanho da janela.

Isso não é um detalhe de conveniência. A regra central deste projeto é que **o
render é função pura de (documento, frame)** e que **o documento é a única
verdade**. O tamanho da janela não é nenhum dos dois. Um frame cujas dimensões
vêm do divisor de um painel é um buraco nessa regra, e é o buraco que o
`evenSize()` do `video-encoder.ts` já vinha remendando na saída: 1227 × 643 vira
1226 × 642 porque o H.264 exige dimensão par. A paridade era o sintoma; a
resolução é a causa.

## Medição

Máquina: Windows 10, Electron 43, ANGLE/D3D11, NVIDIA RTX 3060 Ti,
`devicePixelRatio` 1. Sondas em `tools/probes/`.

### Teto

| O quê                                                  | Medido                                            |
| ------------------------------------------------------ | ------------------------------------------------- |
| `MAX_TEXTURE_SIZE` e `MAX_RENDERBUFFER_SIZE`           | **16384**                                         |
| `MAX_VIEWPORT_DIMS`                                    | 32767 × 32767                                     |
| Canvas WebGL2 cru alocado, desenhado e lido no canto   | 3840×2160, 7680×4320, 16384×8640 — todos corretos |
| `maxCanvasSize` do MapLibre (opção de **construção**)  | **[4096, 4096]**, padrão dele                     |
| `_getClampedPixelRatio(3840, 2160)` com ratio 2 pedido | devolveu **1**, em silêncio                       |

O teto não é a janela nem a GPU: é uma opção do MapLibre que **baixa o pixel
ratio sem avisar**. Pedi 7680 × 4320 e recebi 4096 × 2304 sem erro nenhum. É a
mesma família da armadilha do `preserveDrawingBuffer` que o ADR-013 registrou —
chave ignorada em silêncio.

### A superfície pode ficar maior que a janela

Container do mapa em 3840 × 2160 px de CSS → canvas do mapa 3840 × 2160, canvas
Pixi 3840 × 2160, os dois legíveis. Container do palco em 3840 × 2160 → palco
3840 × 2160 e o Pixi dele igual. A janela continuou em 1920 × 991.

### Custo por frame

Canvas 2D **reaproveitado**, melhor e mediana de cinco voltas depois de uma de
aquecimento. A primeira versão da sonda criava um canvas novo por medição e
relatou 180 ms em 0,7 MP — assinatura de aquecimento, não de custo.

| Tamanho     | MP   | `drawImage` ×2 | `getImageData` |
| ----------- | ---- | -------------- | -------------- |
| 1248 × 566  | 0,71 | ~0 ms          | 4,0 / 4,4 ms   |
| 1920 × 1080 | 2,07 | ~0 ms          | 9,6 / 9,6 ms   |
| 2560 × 1440 | 3,69 | ~0 ms          | 15,1 / 16,7 ms |
| 3840 × 2160 | 8,29 | ~0 ms          | 27,8 / 29,2 ms |

Cerca de **3,5 ms por megapixel**, contra o orçamento de **250 ms por frame de
export 4K** de [06-RENDER-PIPELINE § 10](../06-RENDER-PIPELINE.md#10-orçamentos-de-performance).
O `drawImage` marca zero porque ele enfileira; o custo aparece no readback.

### Bit-exatidão, que é o que decide

Repintura forçada do **mesmo estado**, hashes SHA-256 do canvas:

| Tamanho     | Mapa        | Palco (Three) | Overlay Pixi |
| ----------- | ----------- | ------------- | ------------ |
| 1248 × 566  | idêntico    | idêntico      | idêntico     |
| 1920 × 1080 | idêntico    | idêntico      | idêntico     |
| 2560 × 1440 | **diverge** | **diverge**   | idêntico     |
| 3840 × 2160 | **diverge** | **diverge**   | idêntico     |

A causa não é o tamanho: é o **MSAA**, e está isolada e resolvida no
[ADR-023](ADR-023-no-msaa-on-composed-surfaces.md). Com `antialias: false` o mapa
repete bit a bit em todos os tamanhos medidos, inclusive 3840 × 2160. Registrado
aqui porque **esta decisão depende daquela** acima de 2 MP: exportar em 4K sem o
ADR-023 seria escolher a resolução e perder o critério 2 da Fase 8.

Em 3840 × 2160 com MSAA ligado a divergência era de **42 pixels em 8.294.400**
(0,0005%), delta máximo 6 por canal, sobre preenchimento de terra. Amplitude de
resolve, não de estado errado — e foi isso que apontou para o MSAA.

### O pump de verdade, que é a prova que fecha

As medições acima compõem o frame à mão, com espera escrita na sonda. O pump do
export é mais estrito: exige `observed.frame === alvo`, contador de repinturas
estável por 60 ms, mapa sem tile pendente e nenhum asset em parse. Rodando o
`exportPngSequence` **real** duas vezes em cada tamanho, com o mecanismo desta
decisão — layout no tamanho da composição, `pixelRatio` igual à escala:

| Alvo                                      | Canvas      | MP   | Duas execuções | `settleFailed` | p99 de settle |
| ----------------------------------------- | ----------- | ---- | -------------- | -------------- | ------------- |
| painel, como era antes                    | 1082 × 529  | 0,57 | **idênticas**  | 0              | 82 ms         |
| composição, escala 1                      | 1920 × 1080 | 2,07 | **idênticas**  | 0              | 85 ms         |
| composição, escala 2 (`setPixelRatio(2)`) | 3840 × 2160 | 8,29 | **idênticas**  | 0              | 79 ms         |

Cinco hashes distintos entre os cinco frames em todas as linhas, então não é
export congelado. Sonda em `tools/probes/probe-export-real-pump.mjs`. É o critério 2
da Fase 8 valendo em 4K, pelo caminho que esta decisão escolheu, com o
[ADR-023](ADR-023-no-msaa-on-composed-surfaces.md) em vigor.

## Alternativas

### A. Janela de render oculta, com `engine` em `mode: "render"`

O que o roteiro original e o ADR-013 previam.

✅ Resolução totalmente independente da janela, por construção.
✅ Permite continuar editando durante o export.
✅ É a **única** alternativa que deixaria o MSAA ligado no preview e desligado no
export, porque `antialias` é atributo de contexto e se fixa na criação.
✅ Força `createEngine`, e com isso fecha a divergência de `packages/engine`
contra [02-MODULES](../02-MODULES.md) por implementação em vez de por registro.
❌ **Cache frio a cada export**, e este projeto já mediu o que isso faz: antes do
conserto do `settle` 3D, o primeiro export com template frio divergiu do segundo
em **8 de 9 frames** (09-CONTINUIDADE, "O `settle` 3D foi fechado e provado"). A
janela oculta transforma esse cenário no caso normal, todo export.
❌ Andaime alto: segunda janela, segunda carga do documento, IPC de frames, ciclo
de vida de tiles próprio — e **duas** pilhas de painel, porque
`detectExportMode` decide o modo pela pilha montada e o palco é aba irmã.
❌ Contextos WebGL adicionais sobre o teto de dezesseis que o ADR-012 mediu.

### B. Conduzir as superfícies ao vivo ao tamanho da composição

✅ Reaproveita inteiro o pump, o `settle` e o compositor que já são provados
byte-idênticos há sessões.
✅ Tiles quentes: o `settle` mede o que interessa em vez de esperar disco.
✅ Qualquer resolução e qualquer proporção, exatamente — medido até 3840 × 2160.
✅ Custo de 3,5 ms/MP, dentro do orçamento com folga de 8×.
❌ **O preview deixa de ser o enquadramento** quando a proporção do painel difere
da da composição.
❌ Bloqueia a edição durante o export, e agora as superfícies também mudam de
tamanho na tela.
❌ Herda o teto de `maxCanvasSize` do MapLibre: 4K passa, 8K não, sem tocar na
construção do mapa.

### C. Só `pixelRatio` sobre o tamanho do painel

✅ Uma linha: `map.setPixelRatio(k)` e o Pixi acompanha.
✅ Preserva o enquadramento do preview **exatamente** — é para isso que
`pixelRatio` existe.
❌ Não atende o pedido. A saída fica na **proporção do painel**: de 1248 × 566
sai 2496 × 1132, nunca 1920 × 1080. "Independente do tamanho da janela" é
justamente o que ela não é.

### D. Segundo conjunto de contextos offscreen, na mesma janela

✅ Sem segunda janela e sem IPC.
❌ Paga o cache frio da alternativa A sem ganhar o isolamento dela: mapa novo,
estilo novo, tiles do zero.
❌ Duplica o laço de render do `SceneOverlay` e do `StudioViewport`, que é o
código mais denso do editor, e cria duas verdades sobre o mesmo frame.
❌ Dobra os contextos WebGL vivos.

## Decisão

**Alternativa B: o frame de export mede `composition.width × composition.height`,
multiplicado por uma escala do job.**

As superfícies ao vivo são conduzidas a esse tamanho pela duração do export —
layout em pixels de CSS igual ao tamanho da composição, `pixelRatio` igual à
escala — e devolvidas ao tamanho medido no fim, em `finally`.

O que decide é a regra do projeto, não o conforto. O tamanho da saída é
propriedade da **obra**, e a obra mora no documento. A janela é mobília.

## Consequências

- **`compToScreen` passa a ser exatamente a escala** e, na escala 1, a
  identidade. Um nó autorado em espaço de composição sai no tamanho em que foi
  autorado. Hoje ele sai a 52% porque o painel é menor que a composição, e nada
  na tela diz isso.
- **O preview não é o enquadramento quando as proporções diferem.** O mapa cobre
  o que um viewport do tamanho da composição cobre, e o painel de 1248 × 566
  mostra outra área. Mitigação: guia de moldura da composição no canvas de
  gizmos — que a `EXCLUDED_SURFACE_SELECTORS` já mantém fora do frame por
  construção — e a resolução de saída escrita no painel de fila. Fazer preview e
  export coincidirem **exatamente** exige encaixotar o viewport na proporção da
  composição, que é mudança de produto maior; vai para o roteiro, não para cá.
- **Redimensionar é transação.** O tamanho medido volta em `finally`, como os
  passes offscreen do [ADR-018](ADR-018-studio-planar-floor-reflection.md) já
  fazem com target, viewport e máscaras. Export que estoura no meio não pode
  deixar o painel em 4K.
- **O teto é o `maxCanvasSize` do MapLibre, e ele mente baixo.** 4K passa com a
  construção atual; 8K exige subir a opção, que só existe na criação do mapa e
  cuja única restrição documentada é não passar de `MAX_TEXTURE_SIZE` — medido em 16384. Fica declarado, não implementado: subir o teto muda também o mapa ao
  vivo em tela HiDPI, e isso pede medição própria.
- **Viewport maior pede mais tiles.** Medido: o `settle` depois de redimensionar
  para 4K levou de 40 ms (tiles quentes) a 957 ms (primeira vez). O pump já
  espera por `areTilesLoaded()`, então o custo aparece no relatório de settle em
  vez de virar frame incompleto.
- **`packages/engine` continua esqueleto, e esta decisão fecha a pergunta nessa
  direção.** A divergência contra [02-MODULES](../02-MODULES.md) estava em aberto
  esperando "a janela de render isolada da continuação da Fase 8". A janela foi
  medida e recusada, então o que fecha a pergunta é o registro: o caminho de
  export não precisa da indireção de L5, e introduzi-la agora seria refatorar o
  único caminho do projeto que já mediu byte-idêntico. `createEngine` volta à
  mesa junto com o gatilho de revisão abaixo, não antes.
- **A escala produz dimensão par por construção**, para todos os formatos. O
  `evenSize()` do `video-encoder.ts` continua como última guarda, e passa a ser
  no-op no caminho normal em vez de a única defesa.

## Nota de implementação (2026-07-29)

A ligação entrou como `apps/editor/src/export/surface-override.ts` e
`useExportSurface.ts`. Um desvio da letra desta página, e ele vale registrar:

**A transação espera um predicado de estado, não uma confirmação de evento.** A
decisão acima diz "conduzidas a esse tamanho pela duração do export", e a primeira
implementação leu isso como "aplique e siga". Não serve: o mapa redimensiona
síncrono em `map.resize()`, mas o overlay Pixi só chega ao tamanho novo depois de
`ResizeObserver` → `setState` → efeito de render. Cada superfície agora responde
_"estou no tamanho?"_, e a transação só solta o export quando todas respondem que
sim.

Isso ainda deixava um buraco, e ele custou uma regressão medida: a **restauração**
do export anterior também chega tarde e cai dentro do export seguinte. Por isso o
`ExportHost` ganhou `surfacesBusy`, ao lado de `mapBusy` e `assetsBusy` — superfície
fora de medida é trabalho pendente como tile pendente, e o pump espera por ela.
Sem essa condição o `frame-composer` **escala** a superfície atrasada dentro do
frame planejado, o arquivo sai plausível, e o critério 6 do `verify:phase8` oscila
entre 5/7 e 7/7 com o mesmo código.

E uma superfície que o compositor **ignora** não pode travar o export: o palco sem
nó `studio.stage` fica nos 300×150 de fábrica para sempre. A pergunta "entra no
frame?" tem um dono só, `isComposableSurface` no `frame-composer`, lido pela
transação em vez de reimplementado.

Medido depois: `verify:phase8` **7/7 em quatro rodadas**, PNG **1920×1080**;
`verify:phase8-video` **6/6**, MP4 **1920×1080**; `verify:phase7e3` **14/14**.
Antes, os dois arquivos saíam em 2032×800 — o tamanho do dockview desta máquina.

## Quando revisar

1. Quando alguém precisar **editar durante um export**, ou exportar duas
   composições em paralelo. Nenhum dos dois cabe numa superfície só, e aí a
   segunda instância de motor — e portanto `createEngine` e a janela oculta —
   deixa de ser andaime e passa a ser o requisito.
2. Quando **8K** for pedido: `maxCanvasSize` tem de subir na construção do mapa,
   e o efeito disso no mapa ao vivo em tela HiDPI tem de ser medido antes.
3. Se o custo por megapixel passar de **30 ms**, o que poria um frame 4K perto do
   orçamento de 250 ms.
