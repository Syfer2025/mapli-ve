# ADR-012 — Modo estúdio em canvas próprio

**Status:** aceito, **parcialmente emendado** pelo
[ADR-014](ADR-014-studio-own-panel.md) · **Data:** 2026-07-28 · **Revisar em:** Fase 8

> A decisão central deste ADR — canvas e contexto WebGL próprios para o palco —
> **continua valendo**. O que o ADR-014 mudou foi o lugar: o palco deixou de ser
> uma superfície empilhada dentro do painel Viewport e passou a ter painel
> próprio. Em consequência, a vantagem "o overlay Pixi continua por cima, então
> rótulos e filtros funcionam sem código novo", registrada aqui, deixou de ser
> de graça: o painel do palco precisa do seu próprio overlay.

## Contexto

O bloco 7E.3 pede um palco para apresentar equipamento: chão infinito com grade,
câmera orbital animável, iluminação de estúdio. Sem mapa — é o oposto do resto do
editor, que existe para ancorar coisas em coordenada geográfica.

Hoje o `model3d` desenha numa **camada custom do MapLibre**
([7A+](../08-ROADMAP.md#7a--preview-3d-no-viewport-model3d)): a cena Three.js
compartilha o contexto WebGL do mapa, recebe a matriz dele e repinta quando o
mapa repinta. Isso é certo para preview sobre o terreno e errado para estúdio,
onde não há mapa para dar matriz nem para disparar repintura.

A [Fase 6](../08-ROADMAP.md#fase-6--efeitos) registrou que contexto WebGL "custa
caro", mas nunca mediu quantos já existem nem qual é o teto. Sem esse número,
escolher entre reaproveitar o contexto do mapa e abrir um próprio é chute.

## Medição

No aplicativo em execução, com projeto carregado:

| O quê                                      | Medido                       |
| ------------------------------------------ | ---------------------------- |
| Contextos WebGL vivos hoje                 | **2** (MapLibre e Pixi)      |
| Canvases 2D (não contam)                   | 2 (gizmos e timeline)        |
| Contextos extras até o navegador descartar | **16** — o teto do Chromium  |
| Criar um contexto 1280×720                 | **3,6 ms** mediana, 4,0 pior |

O número que decide é o terceiro: o teto não é 2 nem 3, é dezesseis. E o custo de
criação é de milissegundos **uma vez**, na entrada do modo — não por frame.

## Alternativas

### A. Segunda cena Three no contexto do MapLibre

✅ Zero contexto novo; o orçamento de 16 nem é tocado.
✅ Reaproveita o `scene3d-layer` inteiro, incluindo carga de GLB e iluminação.
❌ O modo estúdio passaria a **depender de um mapa que não é exibido**: matriz de
projeção, disparo de repintura e ciclo de vida viriam de um componente escondido.
❌ A câmera do estúdio é orbital e a do mapa é geográfica. Conviver as duas no
mesmo `Transform` do MapLibre significa lutar contra a biblioteca a cada frame.
❌ Um defeito no mapa passa a derrubar o estúdio, que não tem nada com isso.

### B. Canvas próprio, com renderer Three dedicado

✅ O estúdio não conhece MapLibre. Câmera, laço de render e ciclo de vida são
dele — e a câmera orbital fica sendo o que é, sem tradução.
✅ Custo medido: um contexto a mais, de dezesseis disponíveis, criado em 3,6 ms.
✅ Só um dos dois modos está visível por vez, então nada de dois laços de render
competindo.
❌ Duplica a montagem de iluminação e a carga de GLB, a menos que sejam extraídas
para um módulo comum — e devem ser.
❌ Trocar de modo tem custo de criação e descarte de contexto.

## Decisão

**Canvas próprio** (alternativa B), com a montagem de cena, a iluminação e a carga
de GLB extraídas do `scene3d-layer` para um módulo compartilhado pelos dois modos.

O que decide não é o custo — a medição mostra folga confortável — é a **direção da
dependência**. Fazer o estúdio depender de um mapa escondido acopla dois modos que
não têm nada em comum além de desenhar triângulos, e paga isso em todo frame, para
sempre. Um contexto a mais custa 3,6 ms uma vez.

## Consequências

- A extração do que é comum é **parte da entrega**, não uma limpeza futura. Duas
  cópias da iluminação divergem na primeira vez que alguém ajusta uma delas.
- **O contexto do estúdio vive enquanto o painel do viewport vive**, não enquanto
  o modo está ativo. A primeira versão criava e destruía por modo, e a destruição
  chamava `WEBGL_lose_context.loseContext()` para "devolver o contexto" —
  exatamente o que este documento parecia pedir. Errado, e de um jeito que só
  aparece na segunda montagem: `loseContext` é definitivo para aquele canvas, e
  como o elemento é reaproveitado, a montagem seguinte recebia o contexto morto.
  O three aceitava e quebrava adiante, lendo `precision` de null. Quem devolve o
  contexto é o navegador, ao coletar o elemento; `dispose()` cobre o que o three
  controla. Um contexto ocioso não custa GPU — sem palco na cena, o render sai na
  primeira linha.
- O overlay Pixi continua por cima nos dois modos, então rótulos, efeitos e
  filtros da Fase 6 funcionam no estúdio sem código novo.
- O export da Fase 8 ganha um caminho a mais para cobrir. A câmera orbital é
  função pura de keyframes, então o determinismo do
  [ADR-003](ADR-003-determinism.md) se mantém — mas isso precisa de prova, não de
  confiança.

## Quando revisar

Se a contagem de contextos vivos passar de **oito** — metade do teto medido. Aí a
folga deixa de ser confortável e reaproveitar contexto volta à mesa. O gatilho é
contável: `document.querySelectorAll("canvas")` com contexto WebGL.
