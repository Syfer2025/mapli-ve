# ADR-014 — Palco 3D em painel próprio, com pilha de superfícies própria

**Status:** aceito · **Data:** 2026-07-28 · **Revisar em:** Fase 9, se o Scene Script precisar de mais de um palco por projeto

Emenda o [ADR-012](ADR-012-studio-own-canvas.md) (que decidiu o canvas próprio,
e continua válido nisso) e altera o contrato de composição do
[ADR-013](ADR-013-export-frame-composition.md).

## Contexto

O ADR-012 deu ao palco canvas e contexto WebGL próprios, mas o deixou **dentro do
painel Viewport**, como um irmão do overlay Pixi, com o canvas do mapa escondido
por CSS:

```css
.map-viewport__stage:has(.scene-overlay--studio) .map-viewport__map {
  visibility: hidden;
}
```

A decisão comprou uma coisa de graça e o ADR-012 disse isso explicitamente: o
overlay Pixi fica por cima, então `label.callout`, efeitos e filtros da Fase 6
funcionam no palco sem código novo.

O dono achou o preço dessa escolha mexendo no Inspector: **baixar a opacidade do
nó do palco trazia o mapa de volta ao fundo.** O mecanismo é o avaliador —

```ts
// packages/animation/src/evaluate.ts:151
const visible =
  source.enabled && inTimeRange && selectedBySolo && (parent?.visible ?? true) && opacity > 0;
```

— e o veredito dele foi direto: _"quero que esse palco seja um ambiente à parte,
numa aba à parte do projeto, e não uma sobreposição."_

O sintoma imediato já foi corrigido tirando as `COMMON_PROPERTIES` do
`studio.stage` (palco é câmera e ambiente, não objeto desenhável, e um controle
que só pode causar dano não deve existir). Mas o sintoma não era a doença. Um
modo que existe como CSS sobre outro painel vai continuar vazando: qualquer coisa
que torne o nó do palco invisível — `enabled`, faixa de tempo, solo em outro nó,
opacidade de um pai — reacende o mapa por baixo.

## O que está realmente acoplado hoje

Medido lendo o código, não suposto:

| Peça                       | Estado                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Canvas e contexto do palco | **Já independentes** (ADR-012). `StudioSceneRuntime` cria e descarta o seu.                             |
| Overlay Pixi               | **Um só**, no Viewport, servindo mapa e palco.                                                          |
| Projeção dos rótulos       | `withStudioLayout` **pós-processa** o layout, trocando a entrada dos `model3d` pela câmera orbital.     |
| Layout dos outros nós      | Vem de `createMapLibreProjectorPort(map)` — no palco, **ainda depende do mapa vivo** para projetar geo. |
| Superfícies do export      | Lista fixa de três: `.maplibregl-canvas`, `.scene-overlay__studio`, `.scene-overlay__pixi`.             |
| Verificador 7E.3           | Afirma "o palco substitui o mapa" **medindo a visibilidade do canvas do mapa**.                         |

Duas leituras importantes:

1. **O acoplamento do layout é menor do que parece.** Num palco, nó ancorado em
   `geo` não significa nada — não há terreno. Quem importa é `comp` (títulos,
   rótulos), que usa `compToScreen` e não o mapa. Então o painel do palco pode
   rodar o mesmo pipeline com um projetor geo que **descarta**, em vez de precisar
   de um MapLibre escondido só para responder projeções que ninguém usa.
2. **O que custa de verdade é o overlay Pixi.** É ele que desenha os rótulos, e é
   dele que a Fase 8 depende para compor o frame.

## Alternativas

### A. Reparentar o canvas do palco para o painel novo, mantendo um Pixi só

✅ Sem contexto WebGL novo.
❌ Mover um `<canvas>` WebGL entre árvores do React é frágil: dockview desmonta e
remonta grupos, e o ADR-012 já registrou que `loseContext()` é definitivo.
❌ Não resolve os rótulos: o Pixi continuaria no Viewport, desenhando sobre o
mapa, enquanto o palco está em outra aba.

### B. Painel do palco com pilha de superfícies própria

Palco, Pixi e UI, os três dentro do painel novo.

✅ **Ambiente à parte de verdade**, que é o pedido. Nenhum estado do documento
pode reacender o mapa: ele está em outro painel.
✅ Rótulos, efeitos e filtros voltam a funcionar no palco — pelo mesmo mecanismo
de antes, só noutro lugar.
✅ Cada painel compõe as suas superfícies: o export pergunta ao modo ativo, em vez
de carregar uma lista fixa que mistura os dois mundos.
❌ Um quarto contexto WebGL. O ADR-012 mediu: **2 vivos hoje, teto de 16 no
Chromium, 3,6 ms para criar** — cabe, e o custo é único, na abertura.
❌ Duplica o encanamento de avaliar → comportamentos → layout → render. Mitigação
declarada abaixo.
❌ O verificador 7E.3 precisa ser reescrito: o critério "substitui o mapa" deixa
de existir como conceito.

### C. Deixar como está e só remover os controles perigosos

✅ Zero risco, e já foi feito para o sintoma imediato.
❌ Não é o que foi pedido, e a próxima propriedade que zerar `visible` reabre o
mesmo buraco. Tratar sintoma de decisão errada é como este projeto acumula dívida.

## Decisão

**Alternativa B.** O palco vira painel `studio`, aba irmã do Viewport no mesmo
grupo, com as três superfícies dentro dele.

O que decide não é o custo do contexto — o ADR-012 já mostrou que há folga de 14.
É que **modo não pode ser um efeito colateral de CSS sobre outro painel**. Um
palco de apresentação e um mapa geopolítico são dois ambientes com câmeras,
unidades e interações diferentes; empilhá-los no mesmo painel foi o que produziu
um vazamento que o dono encontrou em minutos, e produziria outros.

### Mitigação da duplicação

O encanamento não é copiado: é **extraído**. O trecho de `SceneOverlay` que faz
avaliar → comportamentos → layout → compor → render vira uma peça parametrizada
por modo, e os dois painéis a usam com projetores diferentes:

- **mapa**: projetor MapLibre, mais gizmos, marquee, caneta e as interações de mapa.
- **palco**: projetor da câmera orbital, sem nenhuma delas — no palco não se
  desenha caminho com caneta nem se arrasta nó pelo terreno.

O painel do palco é, portanto, **menor** que o do mapa, não uma cópia dele.

### Contrato de composição do export

`EXPORT_SURFACE_SELECTORS` deixa de ser lista fixa e passa a ser **função do modo
ativo**:

| Modo  | Ordem de composição                                  |
| ----- | ---------------------------------------------------- |
| mapa  | `.maplibregl-canvas` → `.scene-overlay__pixi`        |
| palco | `.studio-viewport__stage` → `.studio-viewport__pixi` |

Isto **substitui** a tabela de três superfícies do ADR-013. A razão de lá segue
de pé — compor ao vivo é mais barato e mais determinístico que uma janela de
render oculta —; o que muda é que a lista de superfícies não é mais universal.

O ADR-013 dizia que a ordem é contrato e não detalhe. Continua sendo: agora são
**dois** contratos, um por modo, e o teste tem de afirmar os dois.

## Consequências

- **`transform.opacity` do palco não volta.** A remoção das `COMMON_PROPERTIES`
  fica, mesmo com o palco isolado: elas nunca significaram nada nele.
- **Dois overlays Pixi vivos ao mesmo tempo.** Aceito e medido em orçamento de
  contexto, mas é estado novo: cada um tem o seu `acquireController`, e um
  vazamento agora custa dois contextos, não um.
- **O verificador 7E.3 muda de critério.** Sai "o palco substitui o mapa"; entra
  "o painel do palco pinta chão e modelo sem o mapa existir no painel". O
  critério antigo não é afrouxado, é substituído por um mais forte: antes o mapa
  estava lá, escondido; agora não está.
- **`withStudioLayout` deixa de ser remendo.** Com o palco tendo o seu próprio
  passe de layout, a projeção orbital entra como o projetor do painel, não como
  pós-processamento que corrige entradas erradas.
- **Um palco por projeto continua sendo o limite.** `collectStudioStage` devolve o
  primeiro `studio.stage` da ordem de avaliação. Com painel próprio a pergunta
  "e se eu quiser dois palcos?" fica natural, e a resposta hoje é não. Se o Scene
  Script (Fase 9) precisar de mais de um, é aqui que se revisa.
- **Risco declarado:** a extração do encanamento de `SceneOverlay` toca o arquivo
  que dirige o export. Ela deve ser feita **sem mudar o comportamento do modo
  mapa**, e `verify:phase8` mais `verify:phase8-video` são o que prova isso —
  rodar os dois antes e depois é obrigatório, não opcional.

## Execução em etapas

Em blocos, como manda o estilo de trabalho combinado, cada um com prova própria:

1. **Painel e pilha de superfícies.** Painel `studio` registrado, aba irmã do
   Viewport, com o palco 3D pintando nele. O mapa deixa de ser escondido por CSS.
2. **Overlay Pixi do palco.** Rótulos, efeitos e filtros de volta, agora no
   painel certo.
3. **Contrato de export por modo**, com `verify:phase8` e `verify:phase8-video`
   verdes nos dois modos.
4. **Verificador 7E.3 reescrito** no critério novo.

Entre a etapa 1 e a 2 os rótulos técnicos **não funcionam no palco**. É regressão
temporária conhecida, e está aqui em vez de virar surpresa.
