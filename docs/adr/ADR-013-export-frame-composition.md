# ADR-013 — Composição do frame de export

**Status:** aceito · **Data:** 2026-07-28 · **Revisar em:** Fase 8, ao entrar codec

## Contexto

A [Fase 8](../08-ROADMAP.md#fase-8--exportação) tem o critério mais importante do
projeto: **exportar o mesmo projeto duas vezes produz arquivos byte a byte
idênticos.** Antes de qualquer codec, é preciso saber de onde vem o frame.

Hoje o editor desenha em **três superfícies** empilhadas, e cada uma tem dono
diferente:

| Superfície               | Quem desenha                                       | Contexto |
| ------------------------ | -------------------------------------------------- | -------- |
| `.maplibregl-canvas`     | MapLibre (e a camada 3D)                           | WebGL2   |
| `.scene-overlay__studio` | Palco 3D ([ADR-012](ADR-012-studio-own-canvas.md)) | WebGL2   |
| `.scene-overlay__pixi`   | Overlay: nós, rótulos, efeitos                     | WebGL2   |

E `captureExport()` captura **só a terceira**. Medido no aplicativo em execução
com uma cena de rotas e rótulos: 37,4% dos pixels totalmente transparentes,
0,4% totalmente opacos. Ou seja, um export hoje sairia sem terreno — overlay
flutuando em nada.

## Medição

No aplicativo em execução:

| O quê                                                 | Medido            |
| ----------------------------------------------------- | ----------------- |
| Captura do overlay, mesmo frame em 3 voltas distintas | **byte-idêntica** |
| `readPixels` de 1887×965                              | **0,80 ms**       |
| `drawImage` + `getImageData` de 1887×965              | **1,80 ms**       |
| Compor 3 superfícies num canvas 2D e ler              | **2,30 ms**       |
| 5400 frames (90 s a 60 fps) só de composição          | **12 s**          |
| Tempo entre frames, 40 mil triângulos, sem preserve   | 13,40 ms          |
| Tempo entre frames, os mesmos, com preserve           | 13,40 ms          |

Duas leituras importantes desses números:

1. **O determinismo do overlay já está de pé.** Revisitar o frame 12 depois de
   varrer 0–50, três vezes, deu o mesmo SHA-256. O caminho existente não é o
   problema; o problema é o que ele não inclui.
2. **A composição é barata.** 2,3 ms por frame, doze segundos num vídeo de
   noventa — irrelevante ao lado da codificação. Não há razão para arquitetar em
   volta desse custo.

O custo de `preserveDrawingBuffer` **não apareceu**: as duas medianas ficaram em
13,40 ms, presas ao vsync. Isso não prova que ele é grátis — prova que ele não é
o gargalo nesta carga, e é o suficiente para a decisão.

## O que quase deu errado, e é armadilha

O canvas do MapLibre **não pode ser lido** por padrão: `drawImage` dele devolve
zero em todos os canais quando o mapa está ocioso, que é exatamente a condição do
export (o pump avança o frame, o mapa não repinta). Um canvas WebGL comum ocioso
continua legível, então o comportamento é específico do mapa.

A correção é a flag documentada — mas **no lugar novo**. O MapLibre 5 moveu
`MapOptions.preserveDrawingBuffer` para `canvasContextAttributes`, e a chave
antiga é ignorada **em silêncio**: o mapa sobe normal, o contexto continua sem
preservar, e só `getContextAttributes()` conta a verdade. Passei por isso: a
primeira tentativa parecia certa, recarregou sem erro, e a leitura continuou zero.

## Alternativas

### A. Janela de render oculta, com o motor em `mode: "render"`

O que o roteiro original previa.

✅ Isola o export do viewport: resolução de saída independente do tamanho da
janela, e nenhum gizmo pode vazar por construção.
✅ Permite exportar enquanto o usuário continua editando.
❌ Custo alto de andaime: outra janela, outro carregamento de documento, IPC de
frames, ciclo de vida de tiles próprio.
❌ Um mapa novo recomeça o carregamento de tiles do zero — o `settle` por frame
passa a esperar rede/disco em vez de só GPU.

### B. Compor as três superfícies do viewport ao vivo

✅ Reaproveita o pipeline inteiro que já é provado determinístico.
✅ Custo medido: 2,3 ms por frame.
✅ Os tiles já estão carregados e quentes — o `settle` mede o que interessa.
❌ Resolução amarrada ao tamanho do viewport; 4K exige a janela em 4K ou
`pixelRatio`.
❌ Bloqueia a edição durante o export.
❌ Exige `preserveDrawingBuffer` no mapa ao vivo, não só no de export.

## Decisão

**Alternativa B agora, alternativa A quando a resolução exigir.**

O que decide é o que está em risco. O critério byte-idêntico é o mais importante
do projeto e o mais fácil de perder: qualquer coisa que dependa de tempo de
chegada de rede, de ordem de callback ou de estado acumulado o quebra. O caminho
B roda sobre o pipeline que **já mediu byte-idêntico três vezes**; o caminho A
introduz um carregamento de tiles novo por export, que é a fonte de
não-determinismo mais provável que existe aqui.

Resolução é um problema depois, e tem resposta conhecida (`pixelRatio`, e no
limite a janela oculta). Determinismo perdido é um problema que não aparece em
teste e só se manifesta como dois arquivos diferentes na mão do usuário.

## Consequências

- **A ordem de composição é contrato**, não detalhe: mapa (com a camada 3D
  dentro), palco 3D, overlay Pixi. Quando o palco está ativo o mapa não pinta, e
  compor os dois é desperdício mas não erro — o palco é opaco.
- **O `preserveDrawingBuffer` no mapa ao vivo é permanente**, e a razão dele tem
  de estar no código onde ele é ligado. Alguém vai tentar removê-lo por
  desempenho, e o custo medido de zero precisa estar à mão.
- **Nenhum gizmo pode vazar.** No caminho B a garantia não é estrutural — vem de
  `EXPORT_SLOT_ORDER` excluir `ui-overlay`, e do canvas de gizmos ser 2D e
  separado. Isso pede prova, não confiança (critério 8 da Fase 8).
- A escrita em disco fica no **processo principal**, com o `zlib` do Node: um PNG
  escrito por nós é byte-determinístico para a mesma entrada, e `canvas.toBlob`
  depende do codificador do Chromium.

## Quando revisar

Quando alguém pedir export acima do tamanho da janela — 4K numa janela de 1080p.
Aí a alternativa A deixa de ser andaime desnecessário e passa a ser o requisito.
