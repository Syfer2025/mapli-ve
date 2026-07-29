# ADR-016 — Ponto de interesse ancorado no objeto, em espaço normalizado do modelo

**Status:** aceito · **Data:** 2026-07-28 · **Revisar em:** quando chegar modelo com rig de verdade, ou quando alguém pedir POI cujo dono não seja um `model3d`

Emenda **uma** consequência do [ADR-015](ADR-015-studio-points-of-interest.md) — a
que manda o aviso de ponto órfão para a interface em vez de mexer no modelo de
dados. Não o substitui: o ponto de interesse continua nascendo de **clique na
superfície**, nunca de nó do arquivo 3D, e essa parte segue de pé com a medição
que a sustenta.

## Contexto

O veredito do dono: _"quando se coloca keys pontos de interesse no objeto eles não
ficam fixos no objeto, ficam fixos no espaço; se o avião mudar de escala os objetos
ficam travados no limbo e não no objeto."_

Medido no código, não suposto. O ponto e o objeto moram em lugares que não se
conhecem:

| Peça                  | Onde está                                                   |
| --------------------- | ----------------------------------------------------------- |
| Ponto do POI          | `props.pointX/pointY/pointZ`, **metros absolutos do palco** |
| Posição do modelo     | `props.stageX`, `props.altitudeMeters`, `props.stageZ`      |
| Rumo do modelo        | `props.headingOffset` **+** `transform.rotation`            |
| Vão do modelo         | `props.scaleMeters`, limitado a 500 m                       |
| Ligação entre os dois | **não existe**                                              |

São **quatro** props independentes que movem o objeto e deixam o ponto para trás.
Não é defeito num lugar: é a ausência de um vínculo. O ADR-015 previu isto e
aceitou — _"o aviso cabe na interface, não no modelo de dados"_ — porque o pedido
de então era levar a câmera até o míssil, e um ponto absoluto faz isso. O pedido
de agora é outro: o ponto tem de continuar no míssil quando o míssil se mexe.

A transformação que o palco aplica hoje, lida em `applyModelTransform`
(`studio-scene.ts:624`), é o que dá a resposta:

```
M = T(stageX, altitudeMeters − bottom·s, stageZ) · S(s) · Ry(180° − rumo)
```

sobre o GLB **normalizado** por `normalizeModel` (`three-assets.ts:72`):
`normalizer = 1 / maiorDimensão`, centro na origem. Ou seja, existe um espaço em
que o objeto está parado por construção, e `M` é a única coisa que o move. Guardar
o ponto lá é guardá-lo colado no objeto.

Uma restrição que não se negocia: o ponto entra na câmera, a câmera é função pura
de `(documento, frame)`, e é disso que o export byte-idêntico da Fase 8 vive
([ADR-003](ADR-003-determinism.md), `verify:phase8` 7/7). Qualquer forma que
introduza estado acumulado ou dependência de onde o playhead estava está fora
antes de ser avaliada.

## Alternativas

### A. Manter o ponto absoluto e só avisar quando parecer órfão

O que o ADR-015 decidiu.

✅ Risco zero, e o lugar na interface já foi identificado.
✅ Ponto solto continua possível sem nenhuma cerimônia.
❌ Não é o que foi pedido. O dono descreveu o sintoma como defeito, não como
limitação a documentar.
❌ **O aviso não tem como ser correto.** Sem dono declarado, "órfão" é heurística:
o ponto a dez metros do caça pode ser um ponto de enquadramento amplo, de
propósito, ou o resto de um objeto que encolheu. Avisar nos dois casos treina o
usuário a ignorar o aviso.

### B. Amarrar o POI a um nó do arquivo glTF

✅ No papel é o mais correto: seguiria rig, torre articulada, trem de pouso.
❌ **Medido e morto no ADR-015, e nada mudou desde então.** O 2S19M1 tem 51 nós
irmãos chamados `Object_2`…`Object_50`, agrupados por material, e 20 das 49 malhas
atravessam mais de 60% de um eixo do veículo. Não existe "o nó do míssil" para
apontar. É o que sai de qualquer pipeline OBJ → Sketchfab, que é de onde vem a
maior parte de modelo militar disponível.

### C. Usar o campo `parent` do nó, a hierarquia que já existe

✅ **Reaproveita o que existe de verdade:** `parent` está no schema
(`project-document.ts:167`), o avaliador já herda opacidade e visibilidade por ele
(`evaluate.ts:141-159`), e o painel de camadas já reparenta por arraste — mecanismo
que o dono conhece, em vez de um campo novo para aprender.
✅ Nenhuma prop nova no tipo de nó.
❌ **`parent` já significa outra coisa:** organização e herança de
opacidade/visibilidade. Arrastar um ponto para dentro de uma pasta é ação
puramente organizacional, e desanexaria o ponto do caça — o marcador saltaria
para outro lugar por causa de um gesto que não tinha nada a ver com geometria.
Falha silenciosa provocada por arrumação é exatamente a classe de defeito que este
projeto recusa.
❌ **A transformação herdada é 2D.** `TransformSchema` é `position: Vec2`,
`rotation: number`, `scale: Vec2` (`project-document.ts:59`). A colocação 3D do
modelo no palco não está no `transform`, está nas props; herdar a cadeia 2D não
moveria o ponto em 3D. Fazer `parent` carregar 3D é mudar o compositor inteiro.

### D. Dono explícito, ponto em metros a partir da origem do modelo

✅ O número no Inspector fica legível: "2,4 m à frente, 0,8 m acima".
✅ Segue posição, altitude e rumo.
❌ **Não resolve o caso que o dono nomeou.** Com o deslocamento fixo em metros,
dobrar `scaleMeters` faz o objeto crescer e o ponto ficar onde estava: o míssil vai
embora e o ponto não. É o mesmo limbo de hoje, só mais difícil de notar — porque
funciona enquanto ninguém mexe na escala.

### E. Dono explícito, ponto no espaço normalizado do modelo

✅ Segue as **quatro** props: posição, altitude, rumo e escala. É a única forma que
atende o caso da escala, que é o que foi pedido.
✅ A conversão é a inversa de uma matriz que o palco já monta a cada frame. Não há
matemática nova, há uma matriz invertida.
✅ **O dono já é conhecido no instante da marcação** e hoje é jogado fora:
`runtime.pick` devolve `{ point, modelId }` e o manipulador de clique usa o
`modelId` só para pegar o raio (`StudioViewport.tsx:410-419`).
✅ Trocar o GLB deixa o ponto na mesma posição **proporcional** — na silhueta do
modelo novo, não no vazio. Continua não sendo o míssil do modelo novo, mas falha
melhor do que hoje.
❌ O valor guardado é adimensional (fração do vão do modelo), então o Inspector
tem de converter para metros na exibição — uma conversão no meio, que é onde
defeito se esconde.
❌ Resolver o ponto exige o GLB carregado, o que empurra uma dependência para o
compilador do roteiro, hoje função pura sem acesso a template. Mitigação declarada
abaixo.

## Decisão

**Alternativa E.** O `studio.poi` ganha um dono explícito, e com dono o ponto passa
a ser lido no espaço normalizado do modelo desse dono.

O que decide é qual espaço tem o objeto parado. Em metros de palco o objeto se
move por quatro props diferentes e o ponto tem de perseguir todas as quatro; no
espaço normalizado do modelo o objeto **não se move nunca**, e a única coisa que
muda é a matriz que o palco já calcula. A alternativa D fracassa exatamente no
caso que motivou o pedido, e a C troca uma falha visível por uma silenciosa.

### Forma

- **Prop nova `ownerId`** no `studio.poi`. Vazia significa ponto solto em metros de
  palco — que é a leitura de hoje, e um uso legítimo: enquadramento amplo sem
  objeto. Preenchida, `pointX/pointY/pointZ` passam a ser espaço normalizado do
  dono.
- **Mundo a partir do local:** `p_mundo = M · p_local`, com o `M` de
  `applyModelTransform`. **Local a partir do mundo:** `M⁻¹ · p_mundo`, feito uma vez,
  no instante da marcação.
- **O clique guarda o dono** que o `pick` já devolve. Sem interface nova para
  isso: marcar na superfície do caça anexa ao caça.
- **O compilador do roteiro deixa de ler o ponto cru do documento** e recebe um
  resolvedor `(poi, frame) → mundo`, injetado pelo painel, que é quem tem os
  templates. O POI continua com **uma** fonte de verdade: nada de cópia do ponto
  em mundo guardada ao lado. É o precedente do ADR-015 quando ele recusou dois
  campos "nome" para a mesma coisa — dois divergem no primeiro rename.
- **Órfão ganha definição:** `ownerId` preenchido e o nó não existe, ou não é
  `model3d`, ou está sem asset. Aí o painel avisa e o compilador emite
  diagnóstico, no array `diagnostics` que `CompiledTour` já tem. É isto que fecha
  o item que o ADR-015 deixou em aberto — e ele fecha porque agora há o que
  afirmar, não porque ganhou uma heurística.
- **Ação "Anexar ao objeto"** para ponto que já existe: escolhe o dono e converte
  mundo → local uma vez.

## Consequências

- **O ponto de um objeto animado passa a variar no tempo.** O compilador resolve
  cada parada no **frame de chegada** dela. Isso é função pura de
  `(documento, tempos)` e não de onde o playhead estava — que é o que o `baseValue`
  de `documentStudioPois` protegia (`studio-tour.ts:84-103`). O determinismo
  continua de pé, e o export não sabe que algo mudou.
- **Limite declarado, não corrigido aqui:** durante a pausa da narração o objeto
  animado continua andando e o alvo da câmera é um par de keyframes parado, então
  a câmera escorrega do míssil enquanto o narrador fala dele. Corrigir exige alvo
  que acompanha, e isso é o bloco de transições. Vai para o roteiro em vez de
  virar surpresa.
- **Resolver o ponto exige geometria carregada.** Já era a regra para marcar
  (ADR-015): o clique barra por `runtime.status().pending`, a mesma contabilidade
  que `pendingModels()` entrega ao `settle` do export, que já tem o teto próprio de
  30 s para asset. O que muda é que agora o **compilador** também
  depende disso, e precisa falhar com mensagem em vez de gravar `NaN`.
- **Recompilar depois de trocar o asset dá keyframes de câmera diferentes**, porque
  `bottom` e o normalizador saem da geometria. É o comportamento certo: o
  alternativo é coordenada assada que continua igual enquanto o objeto embaixo
  dela mudou.
- **Nada precisa de migração.** Ponto marcado antes deste ADR não tem `ownerId`,
  logo é lido como metros de palco — exatamente o que ele sempre significou. O
  `.theatrum` antigo abre com o mesmo resultado na tela.
- **O Inspector mostra metros e guarda adimensional.** A conversão no meio é custo
  aceito, com teste de ida e volta travando os dois sentidos.
- **O número no arquivo fica menos legível:** quem abre o `.theatrum` vê `0.31` e
  não "2,4 m". Aceito na direção que importa — o arquivo é a fonte, o valor legível
  é o derivado, nunca o contrário.
- **Um dono, um `model3d`.** POI de grupo de modelos ou de `route3d` fica fora, e é
  um dos gatilhos de revisão.

## Prova

Na ordem que este projeto usa: reproduzir antes de corrigir.

1. **Reproduzir.** Marcar um ponto na superfície, dobrar `scaleMeters`, medir em
   pixel que o marcador saiu da superfície. Sem esse número, "consertado" é
   opinião.
2. **Critério novo no `verify:phase7e3`** (6/6 → 7/7): depois de mudar escala **e**
   rumo, projetar o ponto e fazer `pick` naquele pixel — tem de acertar o mesmo
   `modelId`, e as coordenadas locais recuperadas têm de bater com as guardadas
   dentro da tolerância. É afirmação em pixel sobre duas transformações
   independentes, a mesma família de prova da ida e volta do ADR-015.
3. **`verify:phase8` continua 7/7.** O marcador é chrome de autoria e está em
   `EXCLUDED_SURFACE_SELECTORS`, mas o roteiro escreve keyframes de câmera — o
   caminho de export é tocado de lado, e a regra do ADR-014 vale: rodar antes e
   depois.

## Nota de implementação (2026-07-28)

Implementado e provado: `verify:phase7e3` passou de 6/6 para **7/7**, `verify:phase8`
continua **7/7** e `verify:phase8-video` **6/6**. A suíte foi de 1.052 para 1.069
testes. Três coisas que a implementação mudou ou achou:

- **A prova do critério 7 é um A/B no mesmo run**, não um antes-e-depois entre
  commits. Dois pontos nascem no mesmo lugar do palco — um ancorado pelo clique, um
  solto, que é exatamente o comportamento de antes deste ADR — e então o objeto anda
  14 m, cresce de 18 para 30 m de vão e gira 55°. Medido: o **ancorado andou 19,94 m
  e o pixel dele continua acertando o objeto no raycast; o solto andou 0,00 m e o
  pixel dele acerta o vazio.** O limbo do relato, em número.
- **O critério 5 já estava vermelho nesta máquina antes deste ADR**, e a causa não
  era o código: ele clicava em duas coordenadas de mundo fixas — `[6,0,0]` e
  `[6,1.2,0]` — escolhidas para a silhueta do F/A-18, e a `library-roots.json` desta
  máquina serve um SA-3. O primeiro clique caía no vão sob o veículo, só um ponto
  nascia, e a ida e volta comparava esse ponto com o pixel do clique que **errou**:
  35,04 px de erro relatados como defeito de projeção. Agora os pixels de sondagem
  saem de uma **varredura** que pergunta ao raycast onde há geometria, e o critério
  vale para qualquer modelo. A ida e volta ficou em **0,00/0,00 px** e a centragem da
  visita em **0,00 px**. É a mesma classe de correção que o critério 2 recebeu ao
  ganhar recuo para o GLB do repositório: critério de fase não pode depender de
  configuração de máquina.
- **O `verify:phase8` não ativava aba nenhuma.** Ele presumia o Viewport na frente, e
  o layout é persistido — depois de rodar o 7e3, cinco critérios relatavam
  `.maplibregl-canvas ausente`. Era o sinal do painel errado pela quinta vez. Ele
  ganhou `activateViewportTab`, com `PointerEvent` no próprio elemento da aba, e os
  dois verificadores passaram a ser independentes de ordem.

E uma consequência que a implementação precisou resolver e este documento não
previa: **o Inspector não pode dizer "metros"**. A unidade de `pointX/Y/Z` depende de
`ownerId`, e um rótulo fixo mentiria na metade dos casos. As três props perderam o
`unit`, o `ownerId` entrou como primeira propriedade do nó, e o valor em metros
aparece na barra de estado do painel — que é onde ele é lido durante a marcação. A
promessa original de "o Inspector converte para metros" exigiria o editor de
propriedades genérico consultar a escala de **outro** nó, e isso é uma dependência
nova no lugar errado.

## Quando revisar

- Quando entrar modelo com **rig de verdade** — torre, trem de pouso articulado.
  Aí a alternativa B ganha significado e vale oferecer o nó do arquivo **além** do
  clique, com o dono do POI passando a ser o nó em vez do modelo. Mesmo gatilho do
  ADR-015.
- Quando alguém pedir ponto cujo dono **não seja** um `model3d`: grupo de modelos,
  `route3d`, ou o palco inteiro. A forma de hoje assume um dono e um modelo.
