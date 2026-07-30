# 08 — Roteiro de implementação

Uma fase por vez. Cada fase tem **critério de saída verificável** — não "está
pronto", mas "faz X, comprovadamente". Nenhuma fase começa antes da anterior
passar em `pnpm check`.

A ordem não é arbitrária. Ela segue o risco: o que é difícil de retrofitar vem
primeiro, o que é aditivo vem depois.

```mermaid
gantt
    dateFormat X
    axisFormat %s
    title Sequência de fases (unidade: peso relativo)

    section Base
    F1 Fundação            :f1, 0, 2
    F2 Mapa e Câmera       :f2, after f1, 3
    F3 Documento e Undo    :f3, after f2, 3

    section Editor
    F4 Objetos e Timeline  :f4, after f3, 4
    F5 Animação avançada   :f5, after f4, 4

    section Conteúdo
    F6 Efeitos             :f6, after f5, 4
    F7A Biblioteca assets  :f7a, after f6, 2
    F7B Camadas geo        :f7b, after f7a, 3
    F7C Rotas e setas      :f7c, after f7b, 2
    F7D Textos no mapa     :f7d, after f7c, 1
    F7 Ações               :f7, after f7d, 3

    section Saída
    F8 Exportação          :f8, after f7, 4
    F9 Scene Script / IA   :f9, after f8, 2

    section Extensão
    F10 Plugins e assets   :f10, after f9, 2
    F11 Polimento          :f11, after f10, 3
```

Por que esta ordem:

- **Mapa antes de documento** (F2 antes de F3): a projeção geo↔tela contamina o
  modelo de dados. Descobrir na F3 que `anchor` precisa de `altitude` é barato;
  descobrir na F8 não é.
- **Undo antes de objetos** (F3 antes de F4): se os primeiros 20 comandos forem
  escritos sem o Command Bus, serão reescritos.
- **Exportação antes de Scene Script** (F8 antes de F9): a exportação é o que
  valida o determinismo. Gerar cenas por IA sobre um motor não determinístico é
  construir sobre areia.

---

## Replanejamento — 2026-07-27 · assets importados, não efeitos procedurais

**Decisão do dono do projeto.** Elementos visuais de cena — explosões, tanques,
veículos, elementos 3D — **não são gerados proceduralmente**. O usuário importa
assets prontos (PNG, sprites, modelos). O sistema de partículas da Fase 6 fica
congelado como está: implementado e determinístico, mas **nenhum emissor ou
filtro novo será adicionado**. O que a ferramenta precisa entregar agora é a
biblioteca que recebe esses assets e os sistemas de autoria geopolítica: rotas,
setas, textos, contornos de países e estados, estradas.

As fases antigas mantêm a numeração para não quebrar referências cruzadas nos
outros documentos. Quatro blocos novos entram **antes** da Fase 7 original, na
sequência abaixo. Cada um continua com critério de saída verificável.

### 7A — Biblioteca de ativos (import)

> ✅ **Concluído em 2026-07-27.** Os cinco critérios passam em
> `pnpm verify:phase7a` (Electron real): import com thumbnail na hora, aplicar
> renderiza e anima, round-trip do container preserva o SHA-256 dos bytes,
> remoção em uso avisa os nós afetados e os preserva, 200 assets com thumbnails
> lazy.

**Objetivo.** O usuário traz os próprios assets; a ferramenta guarda, organiza e
aplica. Sai do escopo da Fase 10 e vira o primeiro bloco a ser feito.

Escopo:

- `packages/assets` sai do stub: AssetStore content-addressed (hash do
  conteúdo, como previsto em [04](04-PROJECT-FORMAT.md)), thumbnails, metadados
  (nome, tags livres, dimensões)
- Import de PNG/JPG/WebP/SVG pelo painel Biblioteca (picker e arrastar
  arquivo); GLB/glTF registrado como `kind` para uso futuro no viewport 3D
- Painel Biblioteca real: grid com thumbnails, busca, filtro por tag,
  renomear/remover, contagem de usos
- Aplicar asset → cria nó `image`/`svg` ancorado no centro da vista, via
  Command Bus (desfeito por `Ctrl+Z`)
- Assets persistem dentro do `.theatrum`; reabrir nunca pede caminho de arquivo

**Critério de saída.**

1. Importar um PNG de tanque → thumbnail no painel na hora.
2. Aplicar → nó na cena renderiza a imagem; mover/rotacionar/escalar com os
   gizmos existentes; todas as propriedades animáveis por keyframes.
3. Salvar e reabrir o projeto → imagem idêntica, sem arquivo externo.
4. Remover um asset em uso → aviso lista os nós afetados; confirmar troca o
   visual por placeholder `unresolved` sem perder o nó.
5. Importar 200 assets não degrada a abertura do painel (thumbnails lazy).

### 7A+ — Preview 3D no viewport (model3d)

> ✅ **Concluído em 2026-07-27.** Demo end-to-end em `tools/demo-f18.mjs`
> (Electron real): GLB do usuário importado pela Biblioteca, nó `model3d` com
> `motion-path` em rota catmull-rom Kiev→Moscou, marcadores de passagem
> temporizados e destaque de contorno UA/RU — com screenshots de prova em
> `demo-f18/`.
>
> ⚠️ **Três afirmações desta seção foram derrubadas por medição no 7A++**, e uma
> delas estava marcada como "provado". Estão riscadas abaixo, no lugar onde
> foram feitas, em vez de apagadas — quem lê o roteiro precisa ver que a
> conclusão mudou e por quê. Leia o [7A++](#7a--3d-com-volume-e-rotas-3d-route3d)
> antes de tocar na camada 3D.

**Objetivo.** Modelos GLB/glTF da Biblioteca aparecem no mapa e seguem os
sistemas existentes (caminhos, keyframes, comportamentos).

Escopo entregue:

- Tipo de nó `model3d` (categoria media): `assetId`, `scaleMeters` (tamanho
  visual em metros de terreno), `altitudeMeters`, `headingOffset` (correção do
  eixo do nariz). `applyAsset` de um `model` cria esse nó
- Camada custom do MapLibre com Three.js (`scene3d-layer.ts` — chamava-se
  `model3d-layer.ts` até o 7A++ passar a desenhar rotas nela também), mesmo
  canvas e contexto WebGL do mapa; posição e rumo vêm da cena avaliada (inclusive
  a contribuição do `motion-path` em `geo-bearing`), com sync por frame dirigido
  pelo `SceneOverlay` e repaint sob demanda
- GLTFLoader via `parse` de buffer com **texturas embutidas**: a CSP libera
  `blob:` em `connect-src` (o decodificador do three faz fetch de object URLs);
  sem isso o modelo carrega sem textura nenhuma (malha branca). Modelo
  normalizado para dimensão máxima 1 e reescalado por `scaleMeters`
- ~~Mundo = **pixels mercator no zoom atual**: o `modelViewProjectionMatrix` do
  MapLibre v5 não usa mercator 0..1 (provado pelo `_calcMatrices` do Transform
  e por diagnóstico NDC na camada)~~ **ERRADO, e o "provado" era falso.** O x e o
  y são pixels mercator, mas o **z do `modelViewProjectionMatrix` é em metros** —
  a própria matriz aplica `scale(m, m, [1, 1, _pixelPerMeter])`. O diagnóstico
  NDC não pegou porque olhava a origem do modelo, e a origem projeta no lugar
  certo mesmo com a escala vertical errada. Ver 7A++
- Iluminação: environment map via `PMREMGenerator` + `RoomEnvironment` (volume
  e reflexos sem HDR externo), tone mapping ACES, preenchimento
  hemisphere+directional moderados; metalness limitado a 0,6. O traverse de
  ajustes (`frustumCulled=false`, clamps, ~~`depthTest=false`~~) roda DEPOIS do
  `wrapper.add(model)` — rodar antes aplicava tudo no grupo vazio. O
  `depthTest=false` foi revertido no 7A++: era ele que matava a auto-oclusão
- Renderer builtins: `model3d` registrado com `noVisual` (o Pixi não desenha)
- ~~**Volume 3D exige `altitudeMeters` + câmera baixa**: com altitude 0 o modelo
  fica colado no terreno e vira "recorte plano" em qualquer pitch~~ **Diagnóstico
  errado.** O modelo parecia plano porque a matriz o achatava, não por causa da
  altitude — e a altitude era quase um no-op pelo mesmo defeito (260 km
  deslocavam 0,1 px na tela; medido). Câmera baixa ajuda a ver o volume, mas
  nunca foi requisito para existir volume. `calculateCameraOptionsFromTo` é útil
  e a nota sobre não haver `FreeCameraOptions` no MapLibre v5 continua válida

Limitações honestas:

- ~~O export determinístico (Fase 8) ainda não captura o 3D — é visual de
  viewport~~ **Superado pela Fase 8:** o [ADR-013](adr/ADR-013-export-frame-composition.md)
  compõe `.maplibregl-canvas`, e a camada 3D desenha lá dentro. O `settle` agora
  espera também o parse do GLB por sinal não-DEV; `verify:phase8`, critério 6,
  prova `model3d` + `route3d` com cache frio e 9/9 hashes idênticos à execução
  quente. Ver [09-CONTINUIDADE § 3](09-CONTINUIDADE.md#o-settle-3d-foi-fechado-e-provado)
- Opacidade hierárquica e `visible` por keyframe não se aplicam ao modelo;
  contorno de país do demo é camada de estilo em runtime (a versão documental
  é o bloco 7B)
- Sem projeção globo

### 7A++ — 3D com volume e rotas 3D (route3d)

> ✅ **Concluído em 2026-07-27.** O dono relatou que os modelos apareciam "flat,
> parecendo um adesivo colado em cima do mapa", e que as rotas de aviões e
> mísseis tinham o mesmo problema. Eram **três** defeitos somados, não um.
> Provado no Electron real; capturas em `demo-f18/verif-*.png`.

**Objetivo.** Fazer o 3D do 7A+ ser 3D de verdade, e tirar as rotas do chão.

Os três defeitos, do mais grave ao menos:

1. **A matriz achatava o modelo — causa raiz.** A camada usava
   `args.modelViewProjectionMatrix` supondo z em "pixels mercator". O
   `_calcMatrices` do MapLibre monta essa matriz com
   `scale(m, m, [1, 1, _pixelPerMeter])`: **o z de entrada é em metros.** Passar
   `coordinate.z * worldSize` fazia `pixelsPerMeter` entrar duas vezes, e a escala
   vertical saía ~2000× menor que a horizontal (no zoom do demo,
   `pixelsPerMeter` ≈ 5e-4). O GLB era prensado num plano e 90 km de altitude
   viravam centímetros. **Medido antes de trocar: 260 km deslocavam 0,1 px.**
   A saída certa é `args.defaultProjectionData.mainMatrix`, e o contrato é da
   própria doc do MapLibre: com `renderingMode: "3d"`, "a coordenada z é
   conformal — uma caixa com x, y e z iguais em unidades mercator renderiza como
   um cubo". Espaço isotrópico traz dois ganhos de graça: escala uniforme (matriz
   de normais correta, logo iluminação correta) e geometria independente do zoom
2. **`depthTest = false` matava a auto-oclusão.** Resolvia o conflito com o depth
   buffer do mapa e cobrava o preço inteiro: triângulos pintados na ordem do
   buffer, asa de trás sobre a fuselagem, bocal do motor sobre a asa. Agora o
   teste fica ligado e a camada **limpa a profundidade** no início do render — a
   cena 3D fica com o buffer inteiro, continua por cima do mapa, e cada fragmento
   é testado contra os outros dela. Modelo e rota compartilham o buffer, então se
   ocluem entre si
3. **Iluminação lavada.** `RoomEnvironment` em intensidade cheia é um estúdio
   branco, e a chave era quase zenital — num objeto horizontal visto de cima, N·L
   igual em toda a superfície. Environment a 0,4, chave rasante (~22° de
   elevação), preenchimento frio do lado oposto

Escopo entregue além das correções:

- Tipo de nó `route3d` (categoria geo, `noVisual` no renderer): traça o **mesmo**
  caminho compartilhado que o `motion-path` percorre — a rota desenhada é a
  trajetória de verdade, não uma cópia parecida. Props: `pathId`, `color`,
  `widthMeters`, `altitudeMeters`, `arcMeters`, `progressStart`, `progressEnd`,
  `curtainOpacity`. Perfil de altura é `altitudeMeters` mais ápice senoidal de
  `arcMeters` no meio do caminho — cruzeiro é ápice zero, balístico é ápice
  grande. `progressStart`/`progressEnd` animáveis dão desenho progressivo e rastro
- Tubo construído à mão, não `TubeGeometry`: o raio em metros é reconvertido **por
  amostra**, porque um metro em unidades mercator cresce com a latitude e uma rota
  transcontinental afinaria ao norte com raio fixo
- Geometria em unidades mercator **relativas à origem da rota**: invariante ao
  zoom (só a matriz do grupo muda) e com a precisão do float32 preservada para a
  forma — as coordenadas absolutas ficam perto de 0,5 e o raio do tubo é da ordem
  de 1e-4, quatro ordens de grandeza abaixo
- Cortina vertical translúcida da rota até o terreno, com alfa em rampa por
  vertex color: é ela que amarra a altitude ao mapa e faz a trajetória ler como
  3D em vez de linha flutuante
- `#RRGGBBAA` do `ColorSchema` é separado em hex de 6 dígitos mais alfa antes de
  chegar no `THREE.Color`: com o par de alfa anexado o three reclama no console e
  devolve **branco** — foi assim que um míssil vermelho renderizou cinza
- A polilinha 2D de caminho passa a ser **guia de autoria**: tracejada, e só para
  caminho que ainda não tem `route3d` montado. Era ela o "adesivo" laranja
  permanente que o dono via
- `model3d-layer.ts` → `scene3d-layer.ts`: a camada desenha modelos e rotas no
  mesmo depth buffer, e o nome tinha de dizer isso
- Teste no registry afirma os caminhos de props do `route3d` por nome, porque são
  contrato com a camada 3D — renomear uma prop e esquecer a camada não quebra
  tipagem, só faz a rota sumir da tela

Limite conhecido, declarado:

- **Limpar a profundidade significa que terreno não vai ocluir aeronave.** Hoje
  não custa nada, porque a base é PMTiles 2D sem relevo. No dia em que entrar
  terreno 3D no MapLibre, a correção certa é **ler a profundidade do mapa** e
  testar contra ela — não voltar a desligar o teste, que é o caminho que já
  custou o volume do modelo uma vez. A razão está no comentário do `render` em
  `scene3d-layer.ts`, onde a limpeza acontece
- `route3d` em espaço `comp` é ignorado de propósito: sem terreno e sem altitude,
  rota é desenho 2D, e o lugar dela é o overlay Pixi — que é exatamente o que o
  [7C](#7c--rotas-e-setas-) entregou com o tipo `route`
- Altitude por vértice (`PathVertex.altitude` existe no schema e continua sem
  uso) daria perfil de subida/cruzeiro/descida. `altitudeMeters` + `arcMeters`
  cobrem os dois casos pedidos; o perfil por vértice pede mapear vértice para
  `progress` por comprimento de arco acumulado

### 7B — Camadas geográficas: contornos, estados, estradas

> ✅ **Concluído.** Malha compilada (ADR-009 e ADR-010), leitor, catálogo de
> busca, tipos de nó `geo.region`, `geo.rivers` e `geo.roads`, o passe que
> projeta a geometria por frame, e o recorte contra a vista.
>
> Verificado no Electron real: o contorno da Ucrânia cai sobre as fronteiras do
> basemap; o nível de detalhe sobe com o zoom; território fora da vista não é
> projetado; e o preenchimento acerta em quatorze pixels medidos em cidades
> conhecidas — Kiev, Lviv, Smolensk e Moscou pintados; Minsk, Vilnius, Varsóvia,
> Bucareste e o Báltico limpos.
>
> **Orçamento resolvido.** Zoom de cidade com um país inteiro na cena custava
> ~16 ms de 16,6. O recorte em graus antes da projeção derrubou para 1,4 ms: a
> Rússia em z13 sobre Kiev sai como quatro cantos da vista em vez de 25 mil
> vértices que ninguém veria. Pior frame medido em qualquer zoom: 5,9 ms.
>
> **`geo.roads` entregue.** A premissa óbvia — agrupar estradas pelo soberano
> declarado na fonte — morreu na medição: `sov_a3` só existe em 15 valores e
> 85,4% dos vértices ficariam órfãos. O ADR-011 registra a alternativa: junção
> espacial por ponto médio na compilação, candidatos em ordem crescente de área
> de caixa (enclave resolvido, Rússia fora do caminho quente), 99,1% atribuídos
> e o restante na feição explícita `roads:--` — nada some em silêncio. Prova ao
> vivo (`scratchpad/probe-roads.mjs`): o traço passa pelo vértice projetado com
> distância 0 e 30 de 30 vértices amostrados casados; 696 vértices em zoom de
> país e 39 em zoom de cidade; o nó custa 0,5 ms por frame (total do overlay
> 0,7 ms, contra os 8 ms do orçamento). A prova ainda pegou um defeito real do
> passe: o layout calculava a matriz com o pivot do tamanho padrão (32 px de 64)
> e os anéis são medidos a partir da âncora — todo território era pintado
> deslocado. O remendo devolve a origem local à âncora (`matriz ×
translate(pivot)`), com teste unitário e medida ao vivo. Também entregue:
> busca de território no Inspector filtrada pelo tipo do nó, carregando só a
> camada necessária.
>
> **`area.transfer` em OkLab entregue.** A interpolação mora no avaliador de
> keyframes (`interpolateValue`): se os dois lados são strings que leem como
> hex, a cor cruza em OkLab; as demais strings seguem discretas, como antes.
> Os extremos saem bit-idênticos ao documento — o valor de um keyframe não
> passa por roundtrip. Cobre o `fill` de qualquer nó e as tonalidades de
> efeito, que recebem o valor já avaliado. Prova ao vivo
> (`scratchpad/probe-fill-oklab.mjs`): vermelho→azul cruza por roxo (meio em
> 137, 88, 168; o lerp sRGB daria o #800080 morto), e o SHA-256 do frame 30 é
> idêntico na visita direta, depois de varrer 0→60 e depois de varrer 60→0.
>
> **Os quatro critérios, verificados** (`tools/verify-phase7b.mjs`, duas
> rodadas consecutivas idênticas):
>
> 1. Ucrânia adicionada: Kiev e Kharkiv pintados, Minsk e Varsóvia limpos em
>    vista de país; em z6,5 com pitch 55 e bearing 45, o traço casa **154 de
>    154** vértices reais da malha num raio de 3 px; em z8 com pitch 60 e
>    bearing −30, **31 de 31**.
> 2. `fill` de `geo.region` keyframado vermelho→azul: extremos bit-exatos,
>    intermediários na família roxa e todos distintos, hash do frame 30
>    idêntico nas três visitas (direto, ida 0→60, volta 60→0).
> 3. Estradas da Ucrânia inteira na cena em zoom de país: 974 vértices, o nó
>    custa 0,4–0,5 ms e o overlay total fica em 1,1 ms — longe dos 8 ms do
>    orçamento.
> 4. `geo.region` aparece no Inspector gerado (controle de território,
>    preenchimento, contorno) e aceita outline e glow pelo caminho real do
>    editor: os dois mudam o frame e o glow abre halo fora do contorno
>    (+20% de pixels pintados).

**Objetivo.** País, estado, rio e estrada viram nós animáveis, não decoração do
basemap.

Escopo:

- `tools/fetch-data.ts` passa a baixar também `admin_1` (estados/províncias) e
  `roads` do Natural Earth; countries/lakes/rivers/places já estão locais
- Tipos de nó novos: `geo.region` (país ou estado, por nome/ISO), `geo.roads`,
  `geo.rivers` — propriedades `fill`, `fillAlpha`, `stroke`, `strokeWidth`,
  `highlight`
- Renderização no overlay Pixi como polígonos (GeoJSON convertido no avaliador,
  com cache por `(geoId, versão)`). Se a malha 10m estourar o orçamento de
  frame, a alternativa declarada é camada MapLibre com `feature-state`
  dirigido pelo engine — decisão medida, não chutada
- Seleção do território por dropdown com busca (gazetteer administrativo)
- `area.transfer` (transição de cor de território em OkLab) sai da Fase 7 e
  entra aqui — é o uso real: mostrar avanço de front

**Critério de saída.**

1. Adicionar "Ucrânia" → contorno correto em qualquer zoom, pitch e bearing.
2. Animar `fill` de um `geo.region` por keyframes → transição suave e
   determinística: scrub para trás produz hash de frame idêntico ao scrub para
   frente.
3. Estradas de um país inteiro na tela sem violar o orçamento de frame do
   overlay.
4. Um `geo.region` aparece no Inspector gerado e aceita os filtros existentes
   (outline, glow).

### 7F — Os nove pedidos do palco (2026-07-28)

> 🚧 **Em curso.** Segunda rodada de pedidos do dono sobre o Palco 3D, depois de
> usar o que o ADR-015 entregou. Atacados em blocos, cada um com prova própria.

Estado medido de cada um no momento do pedido, para a ordem não ser palpite:

| #   | Pedido                                      | Estado quando foi pedido                                                                       | Bloco          |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| 1   | Navegação livre tipo _street view_ no palco | **Nenhum handler de pointer/wheel existia**; a câmera vinha só das props do `studio.stage`     | **✅ ADR-017** |
| 2   | Timeline própria do modo palco              | `TimelinePanel`/`timeline-model` não têm nenhuma referência a studio/stage                     | a fazer        |
| 3   | Transições fluidas, enquadramento melhor    | interpolação linear das seis props, handles fixos, distância = raio do modelo **inteiro**      | **✅ 7F.4**    |
| 4   | Integração com qualquer IA                  | é a **Fase 9**; `packages/scripting` é stub de 9 linhas                                        | Fase 9         |
| 5   | Bolinha + eixo + balão de texto animado     | `label.callout` já faz caixa + guia; falta a bolinha, a revelação animada e mirar um **ponto** | **✅ 7F.5**    |
| 6   | Complementos sempre virados para a câmera   | callout é Pixi em tela, já encara; o buraco é `withStudioProjection` projetar **só** `model3d` | **✅ 7F.5**    |
| 7   | POI travado no espaço, não no objeto        | confirmado: `pointX/Y/Z` absolutos, sem vínculo com as quatro props que movem o modelo         | **✅ ADR-016** |
| 8   | Luz e sombra melhores                       | a sombra era projetada com a luz assumida **vertical** — mancha embaixo, não sombra            | **✅ 7F.6**    |
| 8b  | Reflexo no piso                             | espelho planar por render target sobre o quad de fundo, conforme o ADR-018                     | **✅ 7F.8**    |
| 9   | Névoa clara ao fundo, nunca sobre o objeto  | não existe. `THREE.Fog` é por profundidade e lavaria o objeto — tem de ser elemento de fundo   | **✅ 7F.3**    |

#### 7F.1 — POI ancorado no objeto ✅

Entregue e provado pelo [ADR-016](adr/ADR-016-poi-anchored-to-object.md):
`verify:phase7e3` de 6/6 para **7/7**, com o critério novo medindo em pixel que o
ponto ancorado acompanha mover, girar e escalar o objeto, enquanto um ponto solto de
controle fica no lugar e o pixel dele passa a acertar o vazio.

**Limite declarado, não corrigido aqui.** Com o objeto **animado**, a câmera escorrega
do ponto durante a pausa da narração: o objeto continua andando e o alvo da câmera é
um par de keyframes parado. Corrigir exige alvo que acompanha, e isso pertence ao
bloco de transições (pedido 3). Está aqui em vez de virar surpresa.

#### 7F.2 — Câmera de autoria livre no palco ✅

Entregue e provado pelo [ADR-017](adr/ADR-017-studio-authoring-camera.md):
`verify:phase7e3` de 7/7 para **8/8**. Arrastar orbita, Shift ou botão do meio desloca o
alvo, roda aproxima, e clique continua marcando — separados por 4 px de deslocamento,
que é o que faz "mover o cenário livremente **ao ativar o marcar pontos**" caber num
botão só.

Medido no critério 8: o arrasto girou o azimute de 35,0° para −37,0°, a imagem mudou, as
seis props do palco ficaram **intactas**, o ponto marcado gravou o ângulo da câmera
solta (−37,0°) e não o do documento, e "Gravar enquadramento" levou as seis props
exatamente para os valores compostos.

**Custo declarado:** enquanto a câmera está solta, o preview não é o enquadramento do
vídeo. Dito na barra de estado, desfeito por um botão, e sem efeito algum no export —
`verify:phase8` continua 7/7.

**Fica fora, e dispara a revisão do ADR-017 se alguém pedir:** _roll_ e olhar fora do
eixo. A câmera do documento não os representa, e oferecer no painel o que o documento
não guarda transformaria gravar em aproximar.

#### 7F.3 — Horizonte, névoa de fundo e o caminho do modelo até o palco ✅

Três coisas que o dono encontrou usando o palco, e uma delas era um defeito de contrato
que estava no código desde a Fase 7A.

**`props.assetId` guarda o `src`, não o `id`.** O `select` do Inspector gravava o id e o
validador de documento comparava contra ids, enquanto todos os leitores e o `applyAsset`
usam o src. Escolher um modelo no Inspector deixava o palco vazio com
`asset ausente: ast_…`. **Não havia teste em nenhuma das duas direções** — agora há.

**Arrastar e soltar.** Modelo da biblioteca, do disco ou já no projeto, vira nó onde foi
solto — o raio do cursor cruza o plano do piso. Soltar assume 18 m de vão em vez do padrão
de 30 000 m de terreno, que o teto do palco cortaria em 500 m com a câmera dentro do
objeto.

**Horizonte e névoa.** O céu era uma cor lisa e o piso nunca a alcançava (sobrava 8% de cor
de chão no infinito): era a "linha esquisita". Os dois lados passaram a pedir a cor à mesma
função. `verify:phase7e3` de 8/8 para **9/9**, com o critério medindo o maior salto entre
pixels vizinhos numa coluna que cruza o horizonte: **12,1 → 6,8**, amplitude 66,9.

A névoa cumpre "nunca sobrepondo o objeto" **por construção**: ela vive no passe do piso,
que desenha antes de toda geometria com teste de profundidade desligado. É por isso que a
resposta não foi `THREE.Fog`.

#### 7F.4 — Transições fluidas, enquadramento pela lente e alvo que acompanha ✅

`verify:phase7e3` de 9/9 para **10/10**. Três mudanças:

**O enquadramento passou a considerar a lente.** Era `raio × 0,9`, e essa conta dá o mesmo
número com campo de visão de 20° e de 60° — o enquadramento "certo" mudava sozinho quando
alguém tocava no `fovDeg`. Agora sai de `orbitDistanceToFit` sobre 35% do raio do objeto:
a visita mostra a peça com contexto, não o veículo inteiro nem um close sem referência.

**As alças de aceleração abriram** de `0,42/0,58` para `0,25/0,75`: rampa mais longa,
partida e chegada sem arranque. É o "passagens mais suaves" do pedido.

**O alvo acompanha objeto animado durante a pausa**, o que fecha o limite declarado no
7F.1. A pausa é amostrada e ganha keyframe **só onde a reta entre os vizinhos já não
descreve o caminho**, com tolerância de 20 cm. Medido: objeto indo e voltando 40 m,
**um único** keyframe inserido, no vértice do movimento, e o ponto a **0,00 px do centro**
na chegada, no meio e na partida.

Duas propriedades que valem por si: **objeto parado não gera keyframe nenhum** — cena
estática sai idêntica à de antes — e **movimento em linha reta também não**, porque
interpolar o alvo entre os extremos reproduz reta exatamente. A câmera já acompanhava
movimento linear de graça.

#### 7F.5 — Bolinha, eixo e balão de texto animado ✅

`verify:phase7e3` de 10/10 para **11/11**. O desbloqueio foi de um lado só: o passe de
projeção do palco passou a pôr os **POIs** no layout, e aí `label.callout` — que procura o
alvo por id desde o 7E.2 — encontra o míssil em vez do avião inteiro. **Zero linha nova do
lado do rótulo.**

A primitiva de rótulo ganhou a bolinha no alvo (`dotRadius`, `dotColor`), a guia que cresce
**a partir do alvo** (`leaderProgress`) e a revelação do texto por caractere
(`textReveal`). Um botão **Anotar ponto** cria a anotação e compila a revelação em três
fases: bolinha, caixa se afastando com a guia, texto digitado.

**Sobre "os complementos virados para a câmera" (pedido 6):** o rótulo é Pixi em espaço de
tela, então ele já encarava a câmera por construção. O que faltava não era orientação, era
**o alvo** — e é o mesmo conserto.

**Um defeito de produto que só a medição ao vivo pegou.** A caixa é dimensionada pelo texto
**completo** em qualquer valor de `textReveal`, de propósito: medir pelo pedaço visível a
faria crescer letra a letra e arrastar a borda de onde a guia sai. A consequência não
prevista era uma **caixa vazia em tamanho final já na tela no primeiro frame** — o balão
aparecendo antes da bolinha que ele explica. O critério 11 mediu tinta que não crescia
(2122 → 2103 → 2122) e obrigou a revelação a animar também `backgroundAlpha` e
`borderWidth`. Depois: **0 → 2096 → 2122**.

#### 7F.6 — Sombra direcional, aimada pelo documento ✅

`verify:phase7e3` de 11/11 para **12/12**. A sombra do palco já era a silhueta real do
objeto projetada numa textura — mas projetada **de cima**, com a luz assumida vertical. Isso
dá uma mancha simétrica embaixo do objeto, não uma sombra.

Agora a silhueta é renderizada **da direção da luz**, e o retângulo da textura se ajusta aos
oito cantos da caixa **vistos da luz** em vez da pegada — com luz a 23° a sombra vai a 2,3
alturas de distância, e ajustar pela pegada a cortaria ao meio. Duas props novas
(`keyAzimuthDeg`, `keyElevationDeg`) aimam luz e sombra **juntas**: antes o rig tinha a
direção fixa no código e o projetor assumia vertical — duas verdades diferentes sobre onde
estava a luz.

Medido no critério 12: girar a luz meia volta desloca o centroide da sombra em **93 px**.
Luz rente ao horizonte recua para a projeção vertical, porque a sombra tenderia ao infinito
e a silhueta sairia com um texel de altura.

**Decisão de teste tomada por omissão que virou decisão explícita num arquivo só.**
`studio-anchor.test.ts` usa `fc.assert` com `{ seed: 20260728 }`, porque o assunto
dele é uma inversa e propriedade de ida e volta com semente livre é a receita do
vermelho intermitente de [§ 4.17](09-CONTINUIDADE.md). A decisão para o **resto** da
suíte continua aberta — ver a lista de pendências por omissão.

#### 7F.8 — Reflexo planar do piso, com orçamento medido ✅

Entregue conforme o [ADR-018](adr/ADR-018-studio-planar-floor-reflection.md).
O piso continua sendo o quad infinito em espaço de tela; um passe próprio desenha a
geometria pela câmera espelhada em `y = 0`, com recorte oblíquo, e o shader do piso
projeta o resultado. Não é uma máscara: cor, material, iluminação e oclusão vêm do
modelo real.

O target é **RGBA16F linear**, metade da resolução física e com maior lado limitado
a 1.024 px. Depois do blur curto, o shader desfaz a pré-multiplicação pelo alfa e
aplica a mesma ACES Filmic do Three com exposição 1. Projetos antigos resolvem
`reflectionStrength` ausente como **0** e podem editá-la pelo Command Bus, com undo;
nós novos começam em **0,3**.

O passe também fechou uma dívida da sombra: ambos devolvem todo o estado mutado do
renderer em `finally`, inclusive máscaras de escrita, background, XR, atualização
automática da sombra, viewport, scissor, face e mip do target. A sombra não usa
mais assinatura incompleta de cache: repinta em todo frame, preservando a pureza
quando modelo, luz ou material mudam.

`verify:phase7e3` passou de 12/12 para **14/14**, em **duas rodadas consecutivas**.
Além da prova visual — reflexo abaixo do contato, movimento espelhado, resposta à
luz, target velho ausente e ON/OFF repetíveis — o critério 13b mediu 40 frames com
o reflexo desligado e 40 com ele ligado, em ordem ABBA. Num canvas físico
**1951×1129**, target **976×565**, ANGLE/RTX 4090 e zero `GPU_DISJOINT`, o p95 ON
foi:

| Rodada | CPU, `evaluate` → submissão Pixi | GPU do canvas Three |
| ------ | -------------------------------- | ------------------- |
| 1      | 1,20 ms                          | 0,35 ms             |
| 2      | 1,00 ms                          | 0,37 ms             |

A GPU vem de `EXT_disjoint_timer_query_webgl2`, consultada de forma assíncrona.
Ela **não** inclui Pixi nem o compositor do Chromium, que vivem fora do contexto
Three. A CPU inclui avaliação, Three, marcadores e submissão Pixi. Assim, a medição
prova o risco incremental do reflexo em preview 1080p; não se apresenta como tempo
GPU completo do frame.

`verify:phase8` permaneceu **7/7** e `verify:phase8-video`, **6/6**. A prova de
formatos ficou bloqueada por `ffmpeg` ausente (`ENOENT`), sem baixar dependência.
A medição 4K continua ligada à janela de render dedicada do ADR-013, sem
extrapolação.

**Próximo bloco real:** timeline própria do modo palco (pedido 2). O ponto de
partida medido continua o da tabela: `TimelinePanel` e `timeline-model` não sabem
que `studio.stage` existe. A decisão deve ser documentada antes do código; o mesmo
painel com modelo ciente do modo é a direção mais consistente com o editor.

### 7E — Apresentação e contexto visual

> 🚧 **Em curso.** Pedido do dono do projeto a partir de capturas do canal
> AiTelly: satélite ao fundo, rótulos que grudam nos objetos, palco de estúdio
> para apresentar equipamento, e VFX volumétrico.

**Objetivo.** Sair do mapa esquemático e chegar no vocabulário visual de
documentário: contexto de terreno, anotação que acompanha o que nomeia, e um
palco para falar de um equipamento fora do mapa.

#### 7E.1 — Camada de satélite ✅

Entregue. A imagem **não vem embutida**, e isso é decisão, não omissão: o projeto
é offline e fixa origem por hash ([ADR-006](adr/ADR-006-maplibre.md)), e satélite
de resolução útil não é redistribuível — a do Natural Earth para em ~500 m/pixel e
o que presta tem licença que proíbe. Chamar servidor de tiles em runtime quebraria
as duas coisas que sustentam o editor: funcionar sem rede e exportar de forma
determinística.

A imagem é do usuário, declarada como raiz nomeada em `data/library-roots.json`, o
mesmo mecanismo da biblioteca 3D. Aceita PMTiles raster ou pirâmide de tiles. Dois
estilos por imagem — satélite puro e satélite com rótulos, reaproveitando as
camadas de rótulo do estilo vetorial. Máquina sem imagem não vê as opções.

#### 7E.2 — Rótulo com guia ✅

Entregue. Nó `label.callout` que gruda em outro nó por `targetId`, ou num ponto de
caminho por `pathId` mais `progress` animável — a anotação que corre sobre o
tracejado da rota.

Primitiva única em vez de três nós, porque caixa, texto e guia têm de ficar
coerentes: a caixa dimensiona pelo texto **medido**, e a guia sai da **borda**, não
do centro. O passe resolve **depois do layout**, no mesmo frame — o alvo pode ser
um `model3d` movido por comportamento, e a resposta depende da câmera daquele
frame. Rótulo que arrasta atrás do objeto nasce de ler estado velho; há teste
contra isso.

#### 7E.3 — Cenário de estúdio ✅

Entregue. Um nó `studio.stage` na composição troca o mapa por um palco: chão
infinito, iluminação de três pontos e câmera orbital animável por keyframe.

**A decisão pendente foi medida e virou o [ADR-012](adr/ADR-012-studio-own-canvas.md).**
No aplicativo em execução são **2** contextos WebGL vivos (MapLibre e Pixi), o
teto do Chromium é **16**, e criar um contexto 1280×720 custa **3,6 ms** — uma
vez, na abertura, não por frame. Com essa folga, o que decide não é o custo e sim
a direção da dependência: canvas próprio, para o estúdio não depender de um mapa
escondido só para receber matriz e repintura.

Peças, e por que estão onde estão:

- **`orbitCameraPosition` em L0** (`packages/core-math/src/orbit.ts`). A câmera é
  função pura de alvo, distância, azimute e elevação, longe do Three.js, porque o
  export da Fase 8 precisa reproduzi-la. A elevação é limitada a ±89° **dentro**
  da função: um keyframe em 88° e outro em 92° passa por 90° no meio, onde a
  matriz de observação degenera, e a interpolação não pergunta a ninguém.
- **Chão infinito em shader** (`studio-grid.ts`), não geometria. Um quad de tela
  cheia que o fragment desprojeta até o plano y = 0; a espessura da linha é medida
  em pixels via `fwidth`, então uma linha a 5 m e outra a 5 km têm a mesma nitidez.
  Um `GridHelper` N × N mostraria a borda ao recuar e cintilaria à distância.
- **`three-assets.ts`** carrega e normaliza o GLB para os dois modos. A extração
  era parte da entrega, não limpeza futura: duas cópias da iluminação divergem no
  primeiro ajuste feito em uma delas.
- **Os rótulos técnicos não ganharam código.** `label.callout` procura o alvo em
  `layout.layouts`; no palco quem preenche essa entrada é a projeção da câmera
  orbital em vez do MapLibre. Modelo atrás da câmera vira `culled`, não uma
  posição inventada — projeção com w negativo devolve coordenada espelhada.

Três defeitos que só a medição em pixel encontrou, todos silenciosos:

1. `RawShaderMaterial` **não injeta nada** — nem precisão, nem os atributos
   padrão. Sem `in vec3 position;` declarado à mão o programa não linka, e o three
   engole a falha: o chão simplesmente não aparecia, sem erro.
2. As cores chegam **convertidas para linear** (`THREE.Color` converte ao ler um
   hex), e um raw shader escreve no framebuffer sem a conversão de volta. O chão
   `#141a22` saía como 2/3/4 em vez de 20/26/34, e a grade — uma mistura entre
   duas cores já escuras — sumia junto. Nenhum erro, só ilegível.
3. `WEBGL_lose_context.loseContext()` no descarte parecia certo e envenenava o
   canvas: é definitivo, o elemento é reaproveitado entre montagens, e a montagem
   seguinte pegava o contexto morto. O three só quebrava adiante, lendo
   `precision` de null.

Verificado em Electron real: `node tools/verify-phase7e3.mjs` — **6/6** (o sexto é
o do ADR-015, abaixo). O palco
substitui o mapa e desenha grade (7/7/6 transições de luminância em três linhas);
um GLB da Biblioteca local pinta 6,64% da tela e some sem resíduo com opacidade 0;
azimute animado de 0° a 180° mantém o raio em 40,000 m com dispersão de 0,0000 m e
muda 13–15% dos pixels a cada amostra; o rótulo mantém o afastamento exato de
(140, −90) px enquanto o modelo percorre 334 px de tela. Desfazer devolve o
documento byte a byte e traz o mapa de volta.

#### 7E.5 — Pontos de interesse do palco ✅

O último pedido do dono: _"quero falar sobre os mísseis, aí a câmera tem que ir até
o míssil; falar da cabine, a câmera tem que mirar para a cabine."_ Decidido no
[ADR-015](adr/ADR-015-studio-points-of-interest.md) depois de a premissa óbvia
morrer na medição — o obuseiro 2S19M1 do dono tem 0 animações, 0 skins e 51 nós
irmãos chamados `Object_2`…`Object_50`, agrupados por **material**: não existe "o
nó da torre" para oferecer numa lista. O ponto nasce de **clique na superfície**.

Quatro peças:

1. **`studio.poi`** — nome (o do nó), ponto em metros do palco e o enquadramento
   **absoluto** da visita. Sem `COMMON_PROPERTIES`, pelo mesmo motivo do palco:
   `transform.opacity` num nó que não desenha só pode fazê-lo sumir.
2. **Marcar pontos** — `StudioSceneRuntime.pick()` faz raycast contra os modelos
   (nunca o chão: ele é infinito, e um clique errado acertaria "alguma coisa" e
   criaria um ponto plausível no lugar errado). Modelo em parse não é alvo, e o
   painel diz isso em vez de tratar o `null` como vazio.
3. **Marcadores numerados** em superfície própria, fora da composição do export.
4. **Compilar roteiro** — a sequência vira keyframes das seis props de câmera do
   `studio.stage`, por `keyframe.replace-all`. Não é player paralelo: a câmera
   continua função pura de `(documento, frame)`, e o export byte-idêntico continua
   valendo.

Critério 5 do verificador, com **dois cliques de mouse de verdade**: 2 pontos
criados, ida e volta do raycast em **0,60 / 0,30 px**, pontos a 7,0 e 4,8 m do
centro de um modelo de 18 m de vão (superfície, não chão), 2 marcadores com
3.032 px de tinta e **0** depois de desligar o modo, 4 keyframes em cada uma das 6
trilhas de câmera, e o ponto da segunda parada projetando a **0,00 px do centro**
da tela no frame de chegada. `verify:phase8` seguiu **7/7**.

**Limite conhecido:** o ponto guarda metros absolutos do palco. Mover o `model3d`
em `stageX`/`stageZ` — ou trocar o GLB dele — deixa os pontos onde estavam, e eles
podem cair no vazio. É a consequência declarada no ADR-015; o aviso cabe na
interface, e ainda não existe.

#### 7E.4 — VFX volumétrico ⛔ bloqueado por ferramenta

O dono deixou 7,6 GB de VFX da JangaFX/EmberGen, licença CC0, na pasta
`explosoes` da Área de Trabalho: uma sequência de 131 arquivos VDB extraída, uma
segunda pasta só com preview em vídeo, e dois arquivos comprimidos somando 4,2 GB
ainda fechados.

**VDB não roda em WebGL.** É formato de volume esparso para renderizador offline —
Blender, Houdini, Octane. O caminho correto é converter cada sequência num
flipbook (atlas de quadros em textura) num passo de bootstrap, e no runtime usar
billboard voltado para a câmera com shader de flipbook. O sistema de partículas da
Fase 6 resolve o **espalhamento**; o flipbook resolve o **volume** — são
complementares, não concorrentes.

**O bloqueio é concreto e foi verificado:** a conversão exige Blender, Houdini ou
uma biblioteca OpenVDB, e nenhum está nesta máquina — não há `blender`, `ffmpeg`,
`magick` nem Python real no PATH. Sem uma dessas ferramentas não há como
transformar VDB em textura, e fingir que há seria pior do que registrar o
bloqueio.

Alternativa declarada, custo quase zero e qualidade menor: usar o vídeo de preview
como textura. Serve para validar o caminho de billboard e mistura enquanto a
conversão não existe.

Seja qual for o caminho, vale a invariante do [ADR-003](adr/ADR-003-determinism.md):
o quadro do flipbook tem de ser **função pura do frame**, senão o export deixa de
ser determinístico.

**Critério de saída do bloco.**

1. Trocar para satélite muda o fundo sem recarregar o mapa, e os nós `geo.*`
   continuam alinhados sobre ele.
2. Um rótulo preso a um `model3d` em movimento acompanha o objeto sem atraso de um
   frame; um rótulo de rota no meio do caminho cai no meio do caminho.
3. Importar um GLB, entrar em estúdio, orbitar 360° por keyframe e exportar: o
   modelo fica legível em todos os ângulos e as anotações seguem os pontos dele.
4. Uma explosão sobre o mapa e outra no estúdio, com o quadro certo em cada frame,
   scrub para trás idêntico, e custo dentro do orçamento de 8 ms do overlay.

### 7C — Rotas e setas ✅

**Entregue.** O tipo `route` referencia um caminho do projeto — o mesmo que o
`motion-path` percorre e que o `route3d` vira tubo — e o desenha no overlay:
linha sólida ou tracejada com deslocamento animável, ponta de seta, seta de
avanço preenchida, e revelação por `trimStart`/`trimEnd`.

A geometria toda é função pura em L0 (`packages/core-math/src/polyline.ts`),
testável sem GPU: recorte por **comprimento de arco** (medir por índice de
vértice faria a revelação andar aos trancos num caminho de vértices desiguais),
tracejado, triângulo de ponta e o polígono da seta gorda. O passe do viewport
(`route-nodes.ts`) só projeta, ordena as operações e decide o que desenhar.

Três decisões que a medição impôs:

- **A ponta nasce no fim do trecho revelado, não no fim do caminho.** Recortar
  primeiro e medir depois; a ordem inversa deixa a seta parada no destino
  enquanto a linha cresce por baixo.
- **Amostragem adaptativa, não 128 fixos.** A primeira versão amostrava 128
  pontos sempre e gastava 8,9 ms de um teto de 8 só projetando. Um vértice a
  cada 12 px, medido por um passe grosseiro de oito amostras.
- **Um `stroke()` por rota, não por traço.** Um `moveTo` abre sub-caminho e o
  traçado cobre todos: 50 rotas tracejadas caíram de 16,4 ms para 7,9. E um memo
  do caminho projetado por frame — várias rotas sobre o mesmo caminho é o caso
  normal — levou a 3300 chamadas de `map.project()` para 66.

Uma armadilha que só a medição em pixel pega: a rota relatava `drawn: 1` sobre
uma imagem **vazia**. O layout genérico decide visibilidade pela caixa padrão do
nó (64 px na âncora), e a âncora de uma rota não diz nada sobre onde ela passa —
nasce em (0°, 20°), no golfo da Guiné, e desenha Kursk→Belgorod. O passe agora
marca o nó como visível e devolve a caixa real, como o passe geográfico faz.

Verificado no Electron real: seta de avanço pintando 11 550 px sobre
Kursk→Belgorod, revelação crescendo monotonicamente (320 → 3466 → 5617 → 8841 →
11 550 px nos frames 0/15/30/45/60), e o hash do frame 30 **idêntico** na visita
direta, depois de varrer 0→60 e depois de varrer 60→0. Cinquenta rotas: mediana
**6,1 ms** no orçamento de 8 (pior frame 9,8 ms — o benchmark empilha 50 rotas
sobre o mesmo caminho, que é o pior caso de contenção, não o uso típico).

**Objetivo original.** O instrumento clássico de mapa de guerra: a seta de avanço.

Escopo:

- Tipo de nó `route` que referencia um `path` do projeto (F5) e renderiza a
  linha no overlay: sólida ou tracejada, `dashOffset` animável, largura, cor
- Arrowhead na ponta: tamanho e ângulo seguem o vetor tangente do path no
  ponto final avaliado
- Seta de avanço preenchida ("fat arrow"): polígono ao longo do path, corpo e
  cabeça proporcionais, gerado deterministicamente a partir do path
- Revelação animada: `trim` de 0→1 ao longo do path, com easing normal do
  editor de curvas
- Desenho com a caneta da F5; criar `route` sem path abre a caneta na hora

**Critério de saída.**

1. Desenhar Kursk→Belgorod com a caneta, aplicar seta de avanço e revelar em
   2 s → a cabeça acompanha a ponta da revelação frame a frame.
2. Scrub para trás desfaz a revelação de forma bit-idêntica (hash de frame).
3. Editar um vértice do path atualiza a seta sem recriar o nó.
4. 50 rotas simultâneas dentro do orçamento de frame do overlay.

### 7D — Textos e rótulos no mapa ✅ (com uma pendência declarada)

**Entregue.** Duplo clique no vazio do mapa cria um `text.label` ancorado no
ponto geográfico e já o seleciona, com o campo de texto à mão no Inspector. O
texto ganhou **halo** e **quebra de linha** por `maxWidth`, ambos animáveis.

- O halo nasce ligado nos dois tipos de texto. Um topônimo sobre imagem de
  satélite não tem fundo previsível — a mesma palavra cruza campo claro e
  floresta escura — e nenhuma escolha de cor funciona nos dois casos. A largura
  pedida é dobrada ao aplicar: o Pixi centra o traço na borda do glifo, e metade
  dele comeria o interior da letra; o que o autor pede é a espessura **visível**.
- O duplo clique tem duas guardas: a caneta tem prioridade (em modo de desenho o
  duplo clique fecha o caminho), e um duplo clique sobre um objeto é edição do
  que existe, não criação de mais um. E ele para a propagação, senão o MapLibre
  daria zoom junto.

Verificado no Electron real (`pnpm verify:phase7d`), **4/4**: a âncora criada
bate exatamente com o ponto clicado, e o centro dos **pixels desenhados** fica a
1,00 / 0,76 / 1,15 px do ponto projetado em três enquadramentos (zoom 6 plano,
zoom 7,4 com 42° de inclinação e 33° de giro, zoom 5,2 girado −70°); o halo sai
de 0 para 3483 pixels da cor pedida; `maxWidth` de 260 px leva a caixa de
844×44 para 240×193.

Um detalhe de método que vale guardar: a primeira medição comparava a translação
da **matriz do nó** com o ponto projetado e acusava 122,78 px de desvio — o mesmo
valor nos três enquadramentos. Desvio constante sob mudança de câmera não é erro
de projeção, é o pivot `anchorPoint × tamanho` deslocando a caixa do nó. Quem
responde "o texto ficou no lugar do terreno?" é o pixel, não a matriz.

**Pendente:** rótulo nomeado pelo gazetteer ao clicar. Exige busca **reversa**
(por coordenada) e o índice atual só busca por nome. A busca por nome já
funciona na caixa do viewport, que é o outro caminho do mesmo critério.

**Objetivo original.** Topônimos, datas e anotações ancorados no terreno.

Escopo:

- `text.title`/`text.label` com âncora geo (a F4 já ancora unidades; aqui é
  ligar o mesmo caminho nos tipos de texto e na UI)
- Criação direta no canvas: duplo clique no mapa → label nasce ancorado no
  ponto, com edição inline
- "Rótulo de lugar": digitar um nome resolve pelo gazetteer (F2) e ancora nas
  coordenadas resolvidas
- Propriedades novas: `halo` para legibilidade sobre o basemap, `maxWidth` com
  quebra de linha

**Critério de saída.**

1. Duplo clique em Kiev → label ancorado; zoom, pitch e rotação mantêm o texto
   no ponto geográfico.
2. Rótulo criado pelo gazetteer aponta para as coordenadas exatas do lugar.
3. Texto com halo continua legível sobre qualquer um dos três estilos de mapa.

**Impacto nas fases antigas.** A Fase 7 (Ações) passa a usar assets importados
da 7A nos templates — `bombard` e `airstrike` referenciam um sprite importado
ou os emissores já implementados, nunca um efeito procedural novo. A Fase 10
perde a biblioteca (virou 7A) e fica com `plugin-host`, símbolos NATO,
bandeiras e paletas. Fases 8, 9 e 11 não mudam.

---

## Fase 1 — Fundação

**Objetivo.** Esqueleto que compila, roda e já impõe as regras de arquitetura.

**Estado: concluída em 2026-07-26.**

**Emenda de 2026-07-30 — verdade do documento.** O viewport não mantém mais uma
câmera/estilo demo paralelos. `composition.map.styleId` e
`composition.camera` são persistidos, avaliados no playhead e alterados pelo
Command Bus. Gestos consolidados criam valor ou keyframe conforme a propriedade;
salvar, reabrir, undo e redo preservam a vista. Recurso regional/satélite ausente
produz fallback visual explícito sem reescrever a escolha salva
([ADR-026](adr/ADR-026-map-view-is-document-state.md)).

Escopo:

- pnpm workspace com todos os pacotes vazios (só `index.ts` e `package.json`)
- `tsconfig.base.json` estrito, project references
- ESLint flat config + Prettier + as 4 regras customizadas de `tools/eslint-rules/`
- `dependency-cruiser` configurado a partir da matriz de dependências
- Electron shell: janela do editor, menu, `contextBridge` tipado
- `dockview` com painéis vazios no layout do After Effects
- Design tokens e primitivos de UI (`Button`, `Panel`, `Field`, `NumberDrag`)
- `core-math`, `core-time`, `core-utils` **completos e testados** (são pequenos e
  não mudam depois)
- Vitest rodando

**Critério de saída.**

1. `pnpm dev` abre a janela com os painéis dockáveis, arrastáveis, com layout
   persistido entre sessões.
2. `pnpm check` verde.
3. Um import proibido (ex.: `document` importando `renderer`) **falha o lint**.
   Testado de propósito.
4. `core-math` e `core-time` com cobertura > 90%, incluindo testes de propriedade
   de arc-length e round-trip de parsing de tempo.

O item 3 é o que garante que a arquitetura sobreviva. Sem verificação automática,
as camadas vazam em duas semanas.

### Evidências de saída

1. No Electron real, o divisor esquerdo foi movido de 264 px para 498 px. A
   janela foi fechada 50 ms depois — antes do debounce normal de 400 ms — e uma
   nova sessão restaurou o divisor em 498 px, os oito painéis e a timeline
   full-width. O layout padrão foi restaurado após o teste.
2. `pnpm check` passa: TypeScript, ESLint, Prettier, dependency-cruiser e 334
   testes.
3. `tools/eslint-rules/rules.test.ts` prova que imports para cima, arestas
   laterais não declaradas, acesso a internals e mutação direta do documento
   falham na configuração real do ESLint.
4. Cobertura V8: 97,78% de linhas no total; `core-math` 97,74%, `core-time`
   97,88% e `core-utils` 97,77%. Inclui propriedades de arc-length e round-trip
   de timecode, inclusive drop-frame.
5. `pnpm build` gera com sucesso main ESM, preload CommonJS sandboxed e renderer.

---

## Fase 2 — Mapa e Câmera

**Objetivo.** Mapa real, offline, navegável, com câmera animável por keyframe.

**Estado: concluída em 2026-07-26.**

Escopo:

- `tools/fetch-data.ts`: baixa e verifica PMTiles Natural Earth, GeoJSON e glyphs
- `pmtiles://` no renderer sobre `theatrum-data://` no main do Electron
- 3 estilos: `dark-relief`, `historical-parchment`, `minimal-political`
- `gis`: `ProjectorPort` sobre o transform do MapLibre, geodesia, gazetteer
- `camera`: modelo, `apply`, `settle`, helpers de enquadramento
- Painel de viewport: pan, zoom, rotação (bearing), inclinação (pitch)
- Keyframes de câmera com interpolação linear (bezier vem na F5)
- Playback simples: play/pause/stop, scrub, loop

**Critério de saída.**

1. Mapa navega com fluidez a 60 fps, **com o cabo de rede desconectado**.
2. Dois keyframes de câmera → animação suave de Varsóvia a Leningrado com
   pan+zoom+pitch simultâneos.
3. `ProjectorPort.project()` de um lng/lat conhecido bate com `map.project()`
   em pitch 0, 45 e 70 — teste automatizado.
4. `settle()` resolve em < 100 ms (p50) com tiles em SSD, e reporta timeout
   corretamente quando o arquivo PMTiles é removido no meio.
5. Gazetteer resolve "Kursk, RU" e reporta ambiguidade em "Springfield".

### Evidências de saída

1. Os três estilos carregaram no Electron real apenas de
   `theatrum-data://local`; a auditoria de Resource Timing encontrou zero URL
   externa durante carga e troca de estilo. O playback mediu 75 fps no monitor
   de teste, acima do orçamento de 60 fps.
2. A trilha de 360 frames chegou exatamente de Varsóvia
   `[21.0122, 52.2297] / z6.15 / pitch 18` a Leningrado
   `[30.3158, 59.9391] / z7.05 / pitch 56`. Play, pause, stop, scrub e loop
   foram exercitados no renderer real.
3. O adapter `ProjectorPort` produziu delta de **0 px** contra `map.project()`
   para Kursk em pitch 0, 45 e 70.
4. Dez mudanças de vista com tiles locais deram p50 de **66,4 ms** para
   `settle()` (máximo 121,1 ms). Ao retirar o PMTiles durante uma nova carga,
   `settle(300)` devolveu `{ settled: false, reason: "timeout" }` em 300,2 ms.
5. O protocolo respondeu Range com `206`, `Content-Range:
bytes 0-126/3829650` e 127 bytes exatos; range impossível respondeu `416`.
   Traversal, host incorreto e método de escrita também foram rejeitados.
6. O gazetteer Natural Earth 10m carregou 7.342 lugares. `"Kursk, RU"` resolveu
   para `[36.190028, 51.73998]`; `"Springfield"` devolveu cinco escolhas
   (Massachusetts, Missouri, Illinois, Ohio e Oregon).
7. `pnpm check` passa com 468 testes. Cobertura V8 total: > 97,3% de linhas;
   `gis` 96,94%, `camera` 94,28% e adapters do viewport 100%.

### Limite deliberado da base inicial — e primeiro pacote regional

O bootstrap mundial é Natural Earth z0–6 (3,83 MB), adequado para composição
geopolítica global. OpenMapTiles/OSM detalhado, sprites de POI e terreno são
assets incrementais por região; incluí-los no bootstrap global transformaria um
download reprodutível pequeno em dezenas ou centenas de gigabytes. As portas e
o formato PMTiles já permitem adicioná-los sem mudar o motor.

Em 2026-07-28 essa extensão regional foi exercitada de ponta a ponta. O pacote
`iran-hormuz-20260728-z15.pmtiles` (1.562.903.814 bytes, SHA-256
`c56fa5daacf51aabf90b6bfcf4c64f27f23ee69e00c6d96dfda1b2a602d489bf`)
cobre `43,22,65,41` até z15. O estilo Protomaps claro usa exclusivamente o
protocolo local, com glifos e sprites fixados por hash, e expõe províncias,
cidades, ruas, edifícios, água, uso do solo e POIs. Selecioná-lo enquadra
automaticamente o Estreito de Hormuz.

O mesmo recorte ganhou satélite offline à parte: EOxCloudless Sentinel-2 2016,
CC BY 4.0, sobre `54,24.2,58.8,28.1` até z13. A variante híbrida reaproveita os
rótulos Protomaps detalhados; versões EOX recentes não foram usadas porque sua
licença é não comercial.

---

## Fase 3 — Documento, Comandos, Undo

**Objetivo.** Fundação de dados. Nada visual, tudo estrutural.

**Estado: concluída em 2026-07-26.**

Escopo:

- `schema`: todos os schemas Zod da v1 + `tools/gen-schema.ts`
- `document`: store com Immer, patches, seletores memoizados, validação, migração
- `commands`: bus, handlers, transações, histórico
- ~30 comandos base: `node.*`, `property.*`, `keyframe.*`, `composition.*`
- `project-io`: `.theatrum` (ZIP), assets por conteúdo, escrita atômica
- Autosave incremental + recuperação de crash
- Painel de projeto (árvore de composições, assets, pastas)
- Painel de histórico estilo After Effects

**Critério de saída.**

1. Criar 50 nós, renomear, reparentar, deletar. `Ctrl+Z` 50 vezes → documento
   idêntico ao inicial (comparação profunda automatizada).
2. Salvar, fechar, reabrir → documento idêntico byte a byte.
3. Salvar o mesmo documento duas vezes → arquivos idênticos byte a byte.
4. Matar o processo com `taskkill` durante edição → ao reabrir, oferece
   recuperação e recupera corretamente.
5. Abrir um projeto com `schemaVersion: 99` → erro claro, sem crash.
6. Uma migração v1→v2 fictícia implementada e testada com fixture.

O item 3 é o que torna o formato versionável e o diff útil.

### Evidências de saída

1. O teste do Command Bus cria 50 nós com rename, reparent e delete em
   transações, desfaz as 50 entradas e compara profundamente o documento com o
   estado inicial. A mesma prova no Electron real levou a árvore de 1 para 51
   nós e de volta a 1, com igualdade exata e painel Histórico sincronizado.
2. A prova em disco salva, reabre e salva novamente um container de 4.264 bytes:
   `project.json` e os dois `.theatrum` são idênticos byte a byte. O gerador de
   schemas também produziu os quatro artefatos duas vezes com SHA-256 idêntico.
3. Após um `taskkill /T /F` durante uma edição real, a nova sessão ofereceu
   recuperação e restaurou o nó `RECOVERY_SENTINEL_F3`, sem alterar o projeto
   original.
4. `schemaVersion: 99` é rejeitado como `future-schema`, com a orientação para
   atualizar o aplicativo, sem derrubar o renderer.
5. A fixture de migração fictícia v1→v2 converte o campo legado, preserva campos
   `$` e payloads opacos e não modifica a entrada.
6. Assets, thumbnails e notas sobrevivem ao ciclo abrir→editar→salvar e também
   ficam protegidos no sidecar da recuperação. Referências `assets/` sem binário
   correspondente são rejeitadas.
7. Autosave, heartbeat, troca de projeto e fechamento limpo são serializados;
   uma edição que chega durante um save continua marcada como não salva e
   recuperável.
8. `pnpm check` passa com 46 arquivos de teste e 535 testes. O
   dependency-cruiser validou 169 módulos e 353 dependências; o build de
   produção gerou main, preload e renderer com sucesso.

---

## Fase 4 — Objetos e Timeline

**Objetivo.** Colocar coisas no mapa e animá-las no tempo.

**Estado: concluída em 2026-07-26.**

Escopo:

- `scene-graph`: registry de tipos, resolução de anchor/size, hierarquia
- `renderer`: Pixi, compositor de slots, ciclo de vida de renderables
- Tipos de nó: `group`, `null`, `text.title`, `text.label`, `image`, `svg`,
  `shape.line`, `shape.polygon`, `symbol.icon`, `unit.armor`, `unit.infantry`
- Transform completo nos dois espaços de coordenadas
- **Painel de timeline em canvas:** trilhas, barras de duração, keyframes,
  playhead, marcadores, zoom, snap
- **Painel de Inspector gerado** a partir de `PropertyDescriptor[]`
- Seleção (clique, marquee, shift), gizmos de transformação no viewport
- Copiar/colar/duplicar, agrupar/desagrupar, pastas

**Critério de saída.**

1. Colocar um tanque em Kursk. Zoom, rotação, pitch → o tanque permanece sobre a
   mesma coordenada, com tamanho de tela constante e apontando para o norte
   correto.
2. Colocar um título em espaço `comp` → não se move com a câmera.
3. Keyframe de opacidade + escala, `play` → animação correta a 60 fps.
4. Timeline com 200 trilhas e 3000 keyframes: scrub a 30 fps, redraw < 4 ms.
5. Adicionar um tipo de nó novo toca **um** arquivo de registro e **um** de
   renderable — comprovado escrevendo `shape.circle` do zero.
6. Inspector mostra as propriedades corretas do tipo novo **sem código de UI**.

O item 5 é o teste real da arquitetura de registry.

### Evidências de saída

Reproduzível com `pnpm dev` em uma janela e `pnpm verify:phase4` em outra. Todas
as medidas abaixo saíram do Electron real, não de jsdom.

1. Um `unit.armor` ancorado em Kursk `[36.190028, 51.73998]` atravessou cinco
   estados de câmera (z5.2 pitch 0; z8.4; bearing 47°; pitch 45° com bearing
   −23°; pitch 70° com bearing 128°). O erro máximo contra `map.project()` foi de
   **2,8 × 10⁻¹⁴ px**, o tamanho de tela ficou constante em 64 × 64 px e o ângulo
   de norte bateu com `bearingToScreenAngle` com erro **0°** — a rotação na tela
   acompanhou o bearing (−47°, 23°, −128°).
2. Um `text.title` em espaço `comp` manteve os mesmos bounds
   (`x 110,22 · y 47,76 · 720 × 120`) nos cinco estados: **0 px** de deslocamento.
3. Keyframes lineares de opacidade (1 → 0,2) e escala (1 → 2) entre os frames 0 e
   60 foram amostrados em 0/15/30/45/60: 1,00/0,80/0,60/0,40/0,20 e
   1,00/1,25/1,50/1,75/2,00, com erro de 5,6 × 10⁻¹⁷ na opacidade e 0 na escala.
   O `play` real rodou a **59,0 fps** de playhead e **59,0 fps de frames de
   overlay efetivamente renderizados** (60 Hz de tela), com custo de frame de
   0,7 ms no p95.
4. Um documento de **300 trilhas e 3.120 keyframes** foi montado por comandos.
   Num painel de 1440 × 900 (tela cheia em 1080p) rolado até a região densa e com
   a duração inteira visível, cada redraw desenhou 41 trilhas e **455 keyframes**
   em **0,2 ms de p50 e 0,4 ms de p95** (máximo de 10,2 ms em uma amostra) — bem
   dentro do orçamento de 4 ms e de 30 fps. O painel real da sessão (222 px de
   altura) ficou em 0,2 ms de p95 com 117 keyframes desenhados. Como teto
   informativo, desenhar as 300 trilhas de uma vez num canvas de 6.624 px de
   altura — altura que nenhuma tela mostra — custa 2,1 ms de p50 e 26,2 ms de
   p95. O culling é o que mantém o custo ligado à área visível, não ao volume de
   dados; o teste unitário mede o mesmo redraw lógico fora do Electron.
5. `shape.circle` foi escrito depois de toda a fase e é citado em exatamente
   **dois arquivos de produção** — `packages/scene-graph/src/builtin-node-types.ts`
   e `packages/renderer/src/builtins.ts` — entre os 135 arquivos varridos em
   `packages/*/src` e `apps/*/src`. O teste
   `tools/node-type-extensibility.test.ts` falha se um terceiro arquivo passar a
   citá-lo. O nó foi criado por **clique no menu de objetos**, que enumera os 12
   tipos do registry, e apareceu no overlay com `visible: true`.
6. O Inspector mostrou `Círculo` com os grupos Layout, Transformação, Aparência e
   Conteúdo e os campos Âncora, Tamanho, Posição, Rotação, Escala, Ponto de
   ancoragem, Inclinação, Opacidade, Preenchimento, Traço, Espessura e **Raio**,
   sem nenhuma linha de UI específica do tipo e sem aviso de tipo desconhecido.
7. `pnpm check` passa com 60 arquivos de teste e **626 testes**; o
   dependency-cruiser validou 211 módulos e 493 dependências e o build de
   produção gerou main, preload e renderer.
8. O verificador desfaz tudo o que cria: ao final, o documento é **idêntico ao
   inicial** por comparação profunda canônica, o cursor do histórico volta ao
   ponto de partida e o sidecar de recuperação é reiniciado.

### Ressalvas registradas

- O flag `dirty` da sessão continua marcado depois da verificação: houve edição,
  mesmo desfeita. O documento em si volta a ser idêntico ao inicial.
- Pastas de projeto e um catálogo de assets navegável seguem mínimos; o painel
  tem árvore de composições, nós e assets, mas hierarquia de pastas de usuário
  entra junto com o gerenciador de mídia.
- A medição de fps depende da janela visível: o Chromium limita
  `requestAnimationFrame` em janela oculta, e por isso o verificador chama
  `Page.bringToFront` antes das provas.
- **Os nós de texto caem em fonte serifada.** `text.title` e `text.label` pedem
  `Open Sans` por padrão, mas o repositório só traz os glifos PBF do MapLibre, e
  não um arquivo de fonte para o renderer: medido no Electron, `48px "Open Sans"`
  dá exatamente a mesma largura de `48px serif` (538,7 px). O layout, o tamanho e
  os keyframes estão corretos; só o desenho da fonte está errado. A correção é
  registrar um `@font-face` com um arquivo verificado por checksum em
  `tools/fetch-data.ts`, junto do gerenciador de assets.

---

## Fase 5 — Animação avançada

**Objetivo.** Controle de animação em nível de After Effects.

**Estado: concluída em 2026-07-26.**

Escopo:

- Bezier temporal completo com solver Newton-Raphson
- Handles espaciais em propriedades de posição
- **Graph editor em canvas:** curvas de valor e de velocidade, edição de handles
- Presets de easing, keyframe assistant (easy ease, roving)
- `behaviors`: motion-path com arc-length, auto-orient, banking, follow, wiggle
- Ferramenta de caneta: desenhar paths no mapa, editar vértices e handles
- Paths compartilhados no projeto, reutilizáveis
- Parenting completo, objetos nulos, pré-composições
- `timeRemap`

**Critério de saída.**

1. Desenhar um path de Varsóvia a Leningrado. Atribuir um tanque. O tanque percorre
   com **velocidade uniforme** (verificado por gráfico de velocidade constante) e
   orientado à direção de marcha.
2. Aplicar ease-in/out no `progress` → parte e freia suavemente, sem tranco nas
   curvas.
3. Graph editor: arrastar handle bezier muda a curva e a animação em tempo real.
4. Um avião percorre path geodésico com banking em curva.
5. Um caça segue outro objeto com `follow` + damping — e o resultado é idêntico ao
   avaliar frames fora de ordem (prova de que o damping por janela fixa funciona).
6. Pré-composição aninhada renderiza e aceita `timeRemap`.

O item 5 é a validação do único ponto onde suavização e determinismo colidem.

### Evidências de saída

Reproduzível com `pnpm dev` em uma janela e `pnpm verify:phase5` em outra. O
verificador desenha, mede, e no fim desfaz tudo o que criou.

1. Três cliques da caneta no mapa gravaram um caminho de Varsóvia a Leningrado
   (`Criar caminho` no histórico), com o arrasto do primeiro vértice virando
   handle de **2,331° / 0,688°** — deslocamento em graus, convertido ponto a ponto.
   Um blindado atribuído ao caminho percorreu 21 amostras com **52,2 km por passo
   e desvio máximo de 0,45%** na distância geodésica; os extremos caíram
   exatamente sobre as duas cidades (**0 m** de erro) e a rotação acompanhou a
   curva em 43,5° de variação, com referência `geo-bearing`.
2. Easy ease nos dois keyframes de `progress`, pelo botão do painel: o primeiro
   passo caiu de **69,2 km para 13,2 km**, o do meio foi a **104,3 km** e o
   último voltou a **13,3 km** — parte e freia. A maior variação entre passos
   vizinhos ficou em **23%**, sem degrau.
3. Arrastar o handle bezier no editor de curvas levou `[0,333, 0]` para
   `[0,693, 0,194]` e moveu o blindado **45,9 km** no frame 75. Duas entradas
   `Alterar easing` no histórico: a curva, a animação e o undo andam juntos.
4. Um caça em caminho geodésico Lisboa→Moscou (**3.905,9 km** de grande-círculo)
   inclinou **−0,91°, −1,17°, −1,41°, −1,59°, −1,74°** ao longo da rota, com o
   rumo saindo de 47,6° para 75,8°. A inclinação cresce de forma contínua, como
   deve ser numa curva de grande-círculo.
5. Um seguidor com `damping 0,8` e janela de 14 frames ficou entre **5,1 km e
   22 km** atrás do alvo, e as posições em `[40, 220, 120, 20, 219, 121]` são
   **idênticas bit a bit** avaliando na ordem inversa.
6. Uma pré-composição aninhada expandiu o conteúdo interno (7 nós na cena) e o
   rótulo interno caminhou de **438,22 → 638,22 → 838,22 px**. Com
   `timeRemap = 25` o conteúdo congelou em **538,22 px** nos frames 0 e 100 —
   **0 px de deriva** e 0 px de erro contra o frame esperado.
7. Parenting com objeto nulo: mover o nulo em `[160, −90]` px deslocou o filho
   exatamente `[160, −90]` px, sem alterar a posição própria dele.
8. `pnpm check` passa com 71 arquivos de teste e **701 testes**; o
   dependency-cruiser validou 239 módulos e 604 dependências e o build de
   produção gerou main, preload e renderer.
9. Ao final o verificador desfaz as 25 transações que criou, e o documento volta
   a ser **idêntico ao inicial** por comparação profunda canônica.

### Defeitos encontrados e corrigidos durante a fase

- **`damping` invertido** no `follow`: `1 - damping` como decaimento fazia
  `0,9` suavizar menos que `0,5`.
- **Recursão infinita** no passe de comportamentos: cada passe aninhado recriava
  o contexto e zerava o guarda de profundidade. Profundidade e cache agora
  atravessam os passes, com teto de 2 níveis e custo documentado.
- **`setPointerCapture` matando a interação** no viewport e no editor de curvas:
  ele lança quando o `pointerId` não é de um ponteiro ativo, e a exceção abortava
  o handler inteiro. Captura é otimização de arrasto, não requisito.
- **Rumo geográfico calculado como `atan2` da tangente em graus.** Um grau de
  longitude encurta com o cosseno da latitude: a 52° o erro passava de 20°. Agora
  o rumo vem de `initialBearing`.
- **Banking zerado no meio das cordas** de um caminho geodésico: a poligonal tem
  tangente constante dentro de cada corda, então a derivada do rumo saía zero com
  degrau nas junções. O rumo geodésico agora é analítico, do ponto atual para o
  fim do trecho de grande-círculo.
- **Status de erro grudado** no overlay: enquanto o mapa inicializa o canvas tem
  0 px e a porta de projeção recusa a snapshot; o painel marcava "Falha ao
  renderizar" e nunca limpava.

### Ressalvas registradas

- **Keyframes roving são quantizados em frames inteiros**, porque `FrameSchema` é
  inteiro. Em trilhas curtas sobra resíduo de variação; velocidade contínua de
  verdade vem do motion path com tabela de arco.
- **A pré-composição é expandida, não renderizada em buffer.** Transform, tempo,
  opacidade e visibilidade atravessam corretamente, mas efeitos e modos de blend
  aplicados ao nó de pré-composição só valerão sobre o conteúdo quando existir
  render para textura — isso é Fase 6.
- **O CDP do Electron não sintetiza `pointerdown`** (só `click`), então os gestos
  do verificador usam `PointerEvent` DOM despachado no elemento real. Handler,
  máquina de estados, matemática e comandos são de produção; só a origem do
  evento é sintética.
- Depois de um `location.reload()` disparado por script, o mapa pode ficar com o
  framebuffer parado até algo forçar repintura. Não reproduzido em abertura normal
  do aplicativo.
- `apps/editor` importa pacotes L2/L3 direto (`animation`, `behaviors`,
  `renderer`, `camera`, `gis`), enquanto a matriz de `docs/02-MODULES.md` prevê
  comportamento só via `engine`. A divergência começou na Fase 2 e continua: ou a
  matriz muda, ou o `engine` deixa de ser stub. Decisão pendente.

---

## Fase 6 — Efeitos

> ✅ **Concluída em 2026-07-27 — congelada pelo replanejamento.** O sistema de
> partículas e filtros funciona e é determinístico; não receberá emissores
> novos. Elementos visuais de cena entram como assets importados (bloco 7A).
> Pendência conhecida: o critério 4 da prova (restaurar seed → frame idêntico)
> apresenta delta mínimo de blend sob investigação de tolerância — não bloqueia
> os blocos 7A–7D.

**Objetivo.** Explosões, fumaça, fogo — determinísticos.

Escopo:

- `effects`: registry, pipeline de filtro, contexto de shader
- Sistema de partículas analítico em GPU (vertex shader, structure of arrays)
- Emissores: `explosion`, `smoke`, `fire`, `trail`, `contrail`, `shockwave`,
  `sparks`, `water`, `dust`
- Filtros: `glow`, `blur`, `drop-shadow`, `color-grade`, `outline`, `chromatic`
- Modos de blend, mattes de transparência, track mattes
- Painel de efeitos com stack por nó, parâmetros animáveis
- Presets de efeito

**Critério de saída.**

1. Explosão de 5.000 partículas: **um** draw call, < 2 ms de CPU.
2. Scrub para trás sobre uma explosão → idêntico ao scrub para frente
   (comparação de hash de frame).
3. Renderizar o frame 400 direto == renderizar 0..400 sequencialmente
   (teste de golden frame).
4. Mudar `composition.seed` → todas as explosões variam; voltar o seed → estado
   idêntico anterior.
5. Cena de bombardeio com 5 tipos de efeito simultâneos mantém 60 fps em 1080p.
6. `pnpm lint` rejeita um `Math.random()` inserido de propósito num efeito.

---

## Fase 7 — Ações e simulações

> ✅ **Concluída em 2026-07-28.** As 16 Actions usam um registry único e a mesma
> expansão para preview live e bake. `advance` calculou duração geodésica a
> partir de `defaultSpeedKmh`; `bombard` gerou 15 nós e 75 keyframes para cinco
> trajetórias, com impactos, fumaça e tremor visível de câmera. A prova no editor
> confirmou atualização de parâmetro sem perder uma renomeação independente,
> bake editável e restauração completa com um único Desfazer. Os testes puros
> também comparam a cena avaliada live e materializada.

**Objetivo.** Um clique produz 40 keyframes editáveis.

Escopo:

- `behaviors`: registry de Action Templates, expansão live/baked
- Ações: `advance`, `retreat`, `attack`, `patrol`, `intercept`, `dogfight`,
  `missile-launch`, `bombard`, `airstrike`, `siege`, `amphibious-landing`,
  `airdrop`, `encircle`, `frontline-shift`, `naval-blockade`, `supply-line`
- Cálculo de duração a partir de distância geodésica e `defaultSpeed` da unidade
- Nó `geo.frontline` com dados de GeoJSON (`geo.region` e `area.transfer`
  saíram para o bloco 7B, junto com contornos e estradas)
- Comando "Converter em keyframes" (bake)
- Painel de ações com preview de parâmetros

**Critério de saída.**

1. Selecionar unidade + path, clicar "Avançar" → animação completa com duração
   plausível calculada automaticamente.
2. "Bombardear" sobre uma cidade → trajetórias de artilharia, impactos, tremor de
   câmera, fumaça residual. Um clique.
3. Ajustar parâmetro de uma Action live → animação atualiza sem perder outras edições.
4. "Converter em keyframes" produz resultado **visualmente idêntico** ao modo live
   (comparação de golden frame), e os keyframes são editáveis individualmente.
5. `Ctrl+Z` desfaz o bake completamente.
6. Adicionar uma Action nova toca **um** arquivo.

---

## Fase 8 — Exportação

**Estado: implementação principal presente; aceite integrado final pendente
(2026-07-30).**

O editor oferece MP4 H.264, GIF, ProRes 4444 e sequências PNG normal/alfa.
Motion blur temporal, supersampling determinístico, seleção de escala, fila
persistente e checkpoints também estão implementados. Isso não substitui os
ensaios longos listados nos critérios de saída.

Decisões vigentes:

- a saída deriva de `composition.width/height`, não do tamanho do painel
  ([ADR-022](adr/ADR-022-export-resolution-from-composition.md));
- escala de saída e supersampling são independentes. O render interno deve caber
  no teto de 8192 px por dimensão e na superfície real da GPU; nada é reduzido
  silenciosamente
  ([ADR-034](adr/ADR-034-direct-8k-with-conformance-guard.md));
- o export usa o viewport vivo e restaura a composição anterior. Não há Render
  Window oculta;
- settle observa frame, repaints, mapa, assets e redimensionamento de superfícies.
  A política padrão `fail` não compõe nem escreve o frame contaminado;
- MP4, GIF e MOV só ganham o nome final por `rename` depois da conclusão
  ([ADR-027](adr/ADR-027-fail-closed-and-atomic-export.md));
- a fila persiste no renderer e volta com jobs interrompidos como `paused`.
  Ela referencia a composição corrente e ainda não congela snapshot imutável;
- checkpoints preservam/reutilizam sequências de PNG, GIF e ProRes. MP4 H.264
  direto reinicia o stream ao retomar
  ([ADR-033](adr/ADR-033-durable-render-queue-checkpoints.md)).

**Objetivo original.** Arquivo de vídeo. A fase que prova o determinismo.

Escopo:

- `export`: fila, frame pump, settle fail-closed e checkpointing
- `WebCodecsEncoder` com detecção de capacidade
- `FFmpegPipeEncoder` com sidecar empacotado
- PNG sequence, GIF (2 passos)
- 4K direto; 8K quando escala, SS, teto e hardware permitirem
- Alpha channel (modo matte) com ProRes 4444 e PNG
- Motion blur por sampling temporal
- Painel de fila de render com progresso, ETA, relatório
- Modo proxy de preview com indicador visível

**Critério de saída.**

1. ⏳ Exportar 90 s / 4K / 60 fps em H.264 — ensaio ainda não executado nesta
   árvore.
2. ⏳ **Exportar o mesmo projeto duas vezes → arquivos idênticos byte a byte.**
   O caminho determinístico existe; repetir a prova integrada final.
3. ⏳ Exportar 8K sem estourar limite de textura — planejamento/preflight
   implementados; falta validar na máquina-alvo.
4. ⏳ ProRes 4444 com alpha → implementação presente; repetir importação no NLE.
5. ⏳ Remover um PMTiles no meio do export → comportamento fail-closed
   implementado; falta a prova integrada com a fonte real.
6. ⏳ Interromper e retomar → implementação presente para sequências; provar
   reinício do aplicativo e registrar que MP4 recomeça.
7. ⏳ Relatório e p99 existem; orçamento depende do ensaio final.
8. ⏳ Gizmos são excluídos estruturalmente; confirmar na captura integrada final.

---

## Fase 9 — Scene Script (autoria por IA)

**Estado: compilador/importador v1 implementado; aceite final pendente
(2026-07-30).**

**Objetivo.** JSON de LLM → animação completa.

Entregue:

- compilador assíncrono, determinístico e offline;
- estrutura estrita, registro de verbos, tempo absoluto/relativo e gazetteer com
  ausência/ambiguidade explícitas;
- diagnósticos estáveis com severidade, código, JSON Pointer, hint e
  `didYouMean`;
- validações de referências, bounds, sobreposição de movimentos, grupos e
  velocidade plausível;
- emissor de câmera, unidades, paths, ações, texto, geografia e visuais
  determinísticos;
- modal **Scene Script…** e importação como um único
  `project.replace-document`, desfeita por um `Ctrl+Z`;
- `LLM_AUTHORING.md` gerado do registro e verificado por
  `pnpm scene:authoring:verify`;
- exemplo `examples/alexandre.scene.json`;
- exportação inversa parcial baseada na fonte normalizada preservada. Edições
  posteriores são omitidas com warning; não existe bloco `raw`.
- ponte local `window.__theatrumMaestro` + `tools/maestro.mjs`, pela qual o agente
  ChatGPT/Codex desta conversa inspeciona e opera o editor aberto;
- duas operações validadas: Scene Script para criação total e lotes do Command
  Bus para edição pontual;
- diagnósticos devolvidos diretamente ao agente para correção;
- contexto atualizado do documento e uma única entrada de undo por operação
  confirmada;
- nenhum modelo, painel de chat ou chave de API embutido no aplicativo.

Alguns verbos compartilham visuais/actions genéricos em vez de terem arte final
especializada própria.

**Critério de saída.**

1. ⏳ Confirmar visualmente a animação produzida pelo exemplo de Alexandre.
2. ⏳ Repetir a prova integrada do conjunto de diagnósticos propositais.
3. ✅ O Maestro usa o contrato gerado e recebe diagnósticos pela ponte local,
   sem credencial de IA no aplicativo.
4. ✅ A autoria é gerada do registro e possui verificador de divergência.
5. ✅ A importação usa um único comando reversível.
6. ⏳ Medir a cena de 200 entradas no ambiente final.

---

## Fase 10 — Plugins e conteúdo empacotado

> A biblioteca de ativos com import saiu daqui e virou o bloco 7A. Esta fase
> fica com o `plugin-host` e o conteúdo pronto distribuído com o app.

**Objetivo.** Extensível sem tocar no núcleo.

**Estado: núcleo do host e conteúdo gerado presentes; integração de plugins
arbitrários com shell/editor ainda pendente (2026-07-30).**

Entregue:

- manifest v1 estrito, descoberta por porta de filesystem, registries nomeados,
  host com carga injetada e `unload` completo;
- Pontos de extensão: tipos de nó, efeitos, ações, verbos, exporters, painéis,
  estilos de mapa e comandos;
- placeholder que preserva o payload validado de nó desconhecido;
- catálogo de 150 unidades com era, nação, categoria, anos de serviço, aliases,
  tags e código APP-6, além de sprite SVG;
- bandeiras, paletas e presets de cena/efeito gerados em
  `data/plugin-content`;
- busca do catálogo e inserção de unidades pela Biblioteca do editor.

Pendente:

- adapter de filesystem e loader de módulos no shell;
- tela de descoberta, ativação e descarregamento de plugins;
- ligação do placeholder `unresolved` ao fluxo completo de abrir/salvar na UI;
- exposição de paletas, bandeiras e presets em seus painéis finais.

**Critério de saída.**

1. ⏳ O host aceita contribuições injetadas; falta a prova com plugin local
   carregado pelo aplicativo.
2. ✅ O escopo de registro e o `unload` estão implementados.
3. ⏳ Preservação do payload existe no domínio; falta o fluxo visual completo.
4. ✅ A busca por texto, sinônimos e ano está implementada no catálogo.
5. ✅ O gerador produz catálogo e sprites sem editar o núcleo; validar a inclusão
   de uma unidade nova no fluxo de conteúdo antes do aceite final.

---

## Fase 11 — Polimento e performance

**Estado: parcial (2026-07-30). Não há soak de quatro horas executado.**

Entregue no núcleo:

- expressões de propriedades com parser/AST/intérprete próprios, contexto fechado
  `value`/`frame`, limites de recursos e fallback com diagnóstico
  ([ADR-030](adr/ADR-030-safe-property-expressions.md));
- autoria de expressões pelo botão **ƒx** do Inspector, com aplicar/remover via
  Command Bus, undo/redo e diagnóstico recuperável;
- cache de preview em RAM e disco com orçamento por bytes, LRU, chave canônica e
  CRC32;
- análise PCM determinística para uma amostra de waveform por frame
  ([ADR-031](adr/ADR-031-preview-cache-and-reference-audio.md));
- quatro presets de workspace e atalhos configuráveis persistidos como
  preferências locais fail-safe
  ([ADR-032](adr/ADR-032-shortcuts-and-workspace-presets.md));
- modo satélite local, entregue anteriormente no bloco 7E.

Pendente:

- ligação do cache ao preview/pré-render e barra de faixa;
- importação/exibição da waveform e sincronização no editor;
- onboarding completo;
- validação atual de todos os orçamentos e sessão contínua de quatro horas.

Áudio continua somente referência: sem reprodução, scrub sonoro, ganho, fades,
mixagem ou inclusão no export. O instalador foi excluído deste ciclo e não é
critério de conclusão desta fase.

**Objetivo.** Ferramenta que se usa por 8 horas sem irritar.

Escopo:

- Perfilamento e otimização contra todos os orçamentos de [06 § 10](06-RENDER-PIPELINE.md#10-orçamentos-de-performance)
- Cache de preview em RAM/disco, pré-render de faixas (barra verde estilo AE)
- Presets de workspace, atalhos configuráveis
- Trilha de áudio de referência com waveform (sincronizar narração)
- Modo satélite (raster tiles offline, se houver fonte)
- Slot `below-labels` via `CustomLayer` — **se** o risco se mostrar aceitável
- Expressões em propriedades (subconjunto seguro, sem `eval`)
- Onboarding: projetos de exemplo, tour dos painéis
- Documentação de uso (distinta desta, que é de arquitetura)

**Critério de saída.**

1. ⏳ Todos os orçamentos de performance atendidos em validação atual.
2. ⏳ Sessão de 4 horas sem crescimento de memória — **não executada**.
3. ⏳ Waveform ligada à timeline e sincronizada com precisão de frame; a análise
   de domínio existe, a UI não.
4. ⏳ Projetos de exemplo completos e revisados para estudo.

---

## O que fica fora

Registrado para não voltar como surpresa. Nenhum destes está planejado:

| Item                               | Por quê                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Colaboração, nuvem, contas         | Não-objetivo declarado em [00](00-VISION.md)                               |
| LLM/API de IA dentro do aplicativo | O Maestro é o agente ChatGPT/Codex externo à aplicação                     |
| Física real                        | Animação é dirigida por keyframe                                           |
| Mixagem de áudio                   | O NLE faz isso melhor                                                      |
| Edição de vídeo (corte de clipes)  | Não é NLE                                                                  |
| Versão web ou mobile               | Desktop offline                                                            |
| Rust                               | Só se um gargalo medido justificar — [ADR-007](adr/ADR-007-no-rust-yet.md) |

---

## Regra de execução

Ao fim de cada fase:

1. `pnpm check` verde (typecheck + lint + arch + testes).
2. Critérios de saída demonstrados, um por um, por escrito.
3. ADR novo se alguma decisão de arquitetura mudou.
4. Documentação atualizada se o modelo de dados mudou.
5. Tag de git `fase-N`.

Nenhuma fase avança com critério pendente. "Depois eu arrumo" é a origem de todo
débito técnico que este roteiro existe para evitar.
