# ADR-017 — Câmera de autoria do palco é local ao painel, no mesmo espaço de parâmetros do documento

**Status:** aceito · **Data:** 2026-07-28 · **Revisar em:** quando alguém pedir _roll_ ou câmera fora do eixo no palco, ou quando o Scene Script (Fase 9) precisar de mais de um ponto de vista salvo

## Contexto

O pedido do dono: _"preciso de uma espécie de street view livre para poder marcar os
pontos nos objetos... preciso poder movimentar todo o cenário livremente ao ativar o
marcar pontos, podendo marcá-los."_

Medido antes de projetar: **não existe interação de câmera no palco.** Nenhum
`onPointerDown`, nenhum `onWheel`, nenhum ouvinte de roda em
`StudioViewport.tsx` nem em `studio-scene.ts`. O único manipulador é o `onClick` que
marca ponto. A câmera vem inteiramente das props do `studio.stage` lidas do documento
por `collectStudioStage`, e o único jeito de girar o palco hoje é digitar número no
Inspector ou arrastar keyframe.

Isso explica um desconforto que estava escondido no [ADR-015](ADR-015-studio-points-of-interest.md).
O `poiFraming` grava _"os ângulos que a câmera tinha no instante da marcação"_, com o
comentário _"o dono girou o palco até ver a cabine, clicou nela"_ — descrevendo um
gesto que o produto não oferece.

Duas restrições que não se negociam:

1. **A câmera de render é função pura de `(documento, frame)`.** É disso que o export
   byte-idêntico vive ([ADR-003](ADR-003-determinism.md), `verify:phase8` 7/7). Nada
   que introduza estado acumulado no caminho da câmera de render pode entrar.
2. **Depois de "Compilar roteiro" a câmera está animada.** O
   [ADR-015](ADR-015-studio-points-of-interest.md) compila as visitas para keyframes
   das seis props de câmera. Qualquer solução que trate essas props como um lugar
   onde se escreve ao arrastar o mouse tem de responder o que faz com os keyframes.

E uma peça que já existe: `packages/core-math/src/orbit.ts` tem
`orbitCameraPosition`, `orbitStateFromPosition` — cujo docstring diz _"é o que
transforma arrastar o mouse em keyframe"_ — e `orbitDistanceToFit`, cujo docstring diz
_"serve o botão enquadrar"_. **Nenhuma das duas últimas tem chamador.** A matemática
foi escrita antecipando esta interação; falta a interação.

## Alternativas

### A. Arrastar escreve direto nas props do `studio.stage`

✅ O que se vê **é** o documento: nada para gravar depois, nada que possa divergir.
✅ Zero estado novo, e o enquadramento da marcação sai de graça.
❌ Um arrasto de dois segundos vira dezenas de comandos no histórico. `Ctrl+Z` deixaria
de significar "desfaz o que eu fiz" e passaria a significar "recua um quadro de mouse".
❌ **Decisivo: não funciona depois de compilar um roteiro.** Com keyframes nas props,
`setPropertyValue` grava keyframe no playhead (`keyframeWhenAnimated`) e **destrói a
visita**, ou — se gravar o valor base — o avaliador o sobrepõe e o arrasto parece não
fazer nada. Uma câmera que para de girar justamente depois de o dono montar o roteiro é
o oposto do que foi pedido.

### B. Câmera de voo livre, com matriz própria, local ao painel

Uma câmera de verdade em primeira pessoa, com posição e orientação livres.

✅ É o "street view" mais literal: olhar para qualquer lado de qualquer lugar.
✅ Documento intocado enquanto se navega.
❌ **As seis props do documento não representam uma matriz arbitrária.** _Roll_ e olhar
fora do eixo não têm onde morar em `(target, distância, azimute, elevação)`. Então
"gravar enquadramento" gravaria **outra coisa** que não o que o dono compôs — e a
câmera saltaria no instante de gravar. Perda silenciosa na hora de salvar é a classe de
falha que este projeto recusa.
❌ Marcar ponto ficaria bom e a visita ficaria errada: o POI guarda enquadramento
orbital, e ele viria de uma câmera que não é orbital.

### C. Câmera de autoria no mesmo espaço de parâmetros, local ao painel

Um `OrbitState` opcional que, enquanto existe, **substitui** o do documento na hora de
desenhar. Arrastar altera esse estado; um botão o gravava nas props.

✅ **Gravar é exato por construção.** O que se compôs é `(target, distância, azimute,
elevação)`, e é isso que vai para o documento: não há conversão, não há salto.
✅ Funciona com a câmera animada: olhar em volta não toca em keyframe nenhum.
✅ `pick`, `project` e os marcadores acompanham de graça, porque todos leem a câmera do
runtime — e é a câmera efetiva que o runtime recebe.
✅ Reaproveita `orbitCameraPosition`, `orbitStateFromPosition` e `orbitDistanceToFit`,
que já estão em L0, já são puros e já foram escritos para isto.
✅ O enquadramento que o POI grava passa a ser o que o dono **está vendo**, fechando a
lacuna que o ADR-015 descrevia sem poder cumprir.
❌ Estado novo que pode discordar do documento: enquanto a câmera está solta, **o
preview não mostra o que o export vai mostrar**. Custo real, e a mitigação é ser
visível e reversível, nunca silencioso.
❌ Sem _roll_ e sem olhar fora do eixo. Aceito: a câmera do documento também não tem, e
oferecer no painel o que o documento não guarda é a armadilha da alternativa B.

### D. Ponto de vista como nó do documento

✅ Persiste entre sessões e viaja no `.theatrum`.
❌ Duas câmeras no documento convidam exatamente a pergunta "qual delas o export usa?",
que é a confusão que o [ADR-014](ADR-014-studio-own-panel.md) gastou quatro etapas para
desfazer.
❌ Some com o problema real: o dono não pediu para **salvar** pontos de vista, pediu
para **mexer** no cenário.

## Decisão

**Alternativa C.** A câmera de autoria é um `OrbitState` local ao painel do palco, no
mesmo espaço de parâmetros da câmera do documento, e substitui a do documento enquanto
está ativa.

O que decide é o que "gravar" significa. Uma câmera de autoria que vive num espaço
maior que o do documento transforma salvar em aproximar — e o dono descobriria isso
vendo a câmera saltar depois de compor o enquadramento com cuidado. Manter os dois no
mesmo espaço custa _roll_, que ninguém pediu, e paga com gravação exata, que é a
operação inteira.

### Forma

- **Estado:** `OrbitState | null` no painel. `null` significa "a câmera é a do
  documento", que é o padrão e o estado depois de reiniciar.
- **Gestos**, todos convertidos por funções puras em `studio-camera.ts`:
  - arrastar com o botão esquerdo → orbitar (azimute e elevação);
  - arrastar com **Shift** ou com o botão do meio → deslocar o alvo no plano da tela;
  - roda → distância, **multiplicativa**, porque zoom é linear em escala logarítmica;
  - o primeiro gesto solta a câmera a partir do enquadramento do documento, então nunca
    há salto ao começar.
- **Marcar e mover convivem no mesmo modo**, que é literalmente o pedido: o botão
  esquerdo decide pelo **deslocamento** — abaixo de 4 px é clique e marca ponto, acima
  é órbita. Sem isso, "movimentar livremente ao ativar o marcar pontos" exigiria
  desligar um para usar o outro.
- **`poiFraming` passa a ler a câmera efetiva.** É o ponto do exercício: o ângulo
  gravado no POI é o ângulo de onde o dono estava olhando.
- **Barra do palco** ganha "Gravar enquadramento" (escreve as seis props, com o mesmo
  aviso de substituição que o roteiro usa quando há keyframe) e "Câmera do documento"
  (descarta o desvio). O estado solto aparece na barra de estado — nunca implícito.
- **Enquadrar o objeto** usa `orbitDistanceToFit`, que estava sem chamador.

## Consequências

- **Enquanto a câmera está solta, preview ≠ export.** É o custo central. Mitigado por
  ser dito na barra de estado e desfeito por um botão; e o export não é afetado de
  forma alguma, porque ele lê o documento, não o painel.
- **O desvio não é salvo.** Fechar o app volta para a câmera do documento. Aceito: é um
  ponto de vista de trabalho, não conteúdo — e salvá-lo reabriria a alternativa D.
- **Navegação livre sai do deslocamento do alvo**, não de uma câmera livre. Na prática
  cobre "andar pelo cenário": alvo mais distância mais dois ângulos alcançam qualquer
  vista sem _roll_. Quem quiser _roll_ dispara a revisão deste ADR.
- **Um gesto trêmulo pode orbitar em vez de marcar.** O limiar de 4 px é a fronteira, e
  ela é declarada aqui em vez de descoberta na prática. Marcar continua exigindo
  acertar a superfície, então o pior caso é um ponto não criado, não um ponto errado.
- **`transform.opacity` do palco continua fora** e nada aqui a devolve: seguem valendo
  as consequências do ADR-014.
- **A câmera de autoria não anima.** Ela é um estado, não uma trilha. Animar é o que o
  documento faz, e para lá se grava.

## Prova

- **Testes de unidade** sobre as três funções puras de gesto e sobre a câmera efetiva,
  incluindo os limites de elevação e distância que `orbitCameraPosition` já impõe.
- **Critério novo no `verify:phase7e3`** (7/7 → 8/8), medido em pixel e no documento:
  arrastar no palco **muda a imagem** e **não muda uma vírgula** das props do
  `studio.stage`; marcar um ponto com a câmera solta grava o azimute da câmera solta, e
  não o do documento; "Gravar enquadramento" leva as seis props exatamente para os
  valores compostos.
- **`verify:phase8` continua 7/7**, que é a afirmação de que a câmera de autoria não
  vazou para o caminho de export.
