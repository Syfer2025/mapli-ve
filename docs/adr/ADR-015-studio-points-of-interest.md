# ADR-015 — Pontos de interesse do palco vêm de clique, não do arquivo 3D

**Status:** aceito · **Data:** 2026-07-28 · **Revisar em:** quando alguém pedir POI em modelo com hierarquia real (rig de torre, trem de pouso articulado)

## Contexto

A apresentação de equipamento pedida pelo dono precisa que a câmera vá até uma
parte do objeto e fale dela: _"quero falar sobre os mísseis, aí a câmera tem que ir
até o míssil; falar da cabine, a câmera tem que mirar para a cabine."_

O caminho óbvio era ler os nós do glTF: o arquivo tem hierarquia, então basta
oferecer "Turret", "Barrel", "Cockpit" numa lista. **Medi antes de construir, e a
premissa morreu.**

O obuseiro 2S19M1 que o dono baixou (49 MB, Sketchfab) tem:

| O quê       | Medido                                     |
| ----------- | ------------------------------------------ |
| Animações   | **0**                                      |
| Skins (rig) | **0**                                      |
| Nós         | 51, todos irmãos planos sob um pai         |
| Nomes       | `Object_2` … `Object_50` — zero informação |
| Origem      | `2S19M1.obj.cleaner.materialmerger.gles`   |

O nome do nó pai conta a história: veio de um **OBJ**, formato sem hierarquia
alguma, e a Sketchfab agrupou triângulos **por material**. Confirmei medindo a
caixa de cada malha pelos `min`/`max` obrigatórios do accessor de POSITION: **20
das 49 malhas ocupam mais de 60% de um eixo do veículo**, várias em 100%, 96%,
92%. Nenhuma peça mecânica de um obuseiro atravessa o veículo inteiro. São grupos
de material — `Object_30` é "todo o metal pintado", casco e torre no mesmo objeto.

Ou seja: **não existe "o nó da torre" para oferecer numa lista**, e isso não é
particularidade de um arquivo. É o que sai de qualquer pipeline OBJ → Sketchfab,
que é de onde vem a maior parte de modelo militar disponível.

## Alternativas

### A. Lista de nós do glTF

✅ Zero interface nova: um `<select>` com os nomes.
❌ Os nomes não significam nada nos modelos que o dono tem. A lista ofereceria
`Object_31` e o usuário teria de descobrir por tentativa qual é a cabine.
❌ Falha em silêncio: parece funcionar, e a câmera vai para o lugar errado.

### B. Exigir modelo com hierarquia nomeada

✅ Tecnicamente o mais limpo.
❌ Joga o problema no dono, que precisaria de Blender — **verificado que não existe
nesta máquina** ([09-CONTINUIDADE § 2](../09-CONTINUIDADE.md)), o mesmo bloqueio do
VFX. Transformaria "apresentar equipamento" em "aprender modelagem".

### C. Clique no palco, com os candidatos revelados por um botão

O que o dono pediu: _"crie um botão de filtro que eu possa clicar e aparecer os
pontos, aí eu seleciono os pontos que eu quero."_

✅ **Independe por completo de como o arquivo foi nomeado.** Funciona no 2S19 de
grupos de material, no F/A-18 e em qualquer coisa importada depois.
✅ O ponto é onde o dono **vê** que é o míssil, não onde um exportador achou que
era. Para apresentação, é a definição certa.
✅ Reaproveita o que já existe: raycast do three contra a cena do palco, e a
projeção inversa que `__theatrumStudio.project()` já provou no verificador 5/5.
❌ Interface nova: modo de marcação, revelação de candidatos, marcador visível.
❌ Ponto fica preso ao espaço local do objeto — se o modelo for trocado por outro
GLB, os pontos não migram. Consequência declarada abaixo.

## Decisão

**Alternativa C.** O ponto de interesse nasce de um clique do dono na superfície do
modelo, e mora no documento — não no arquivo 3D.

O que decide é onde a informação existe. O nome de um nó de glTF é um acidente do
exportador; "aqui é a cabine" é conhecimento do dono. Guardar o segundo e depender
do primeiro seria escolher a fonte menos confiável das duas por conveniência de
implementação.

### Forma

- Tipo de nó **`studio.poi`**: nome, ponto em metros no espaço do palco, e o
  enquadramento que a câmera assume ao visitá-lo (distância, azimute, elevação
  relativos ou absolutos). É nó do documento, então versiona, desfaz e viaja no
  `.theatrum` como qualquer outra coisa.
- Botão **Marcar pontos** no painel do palco. Ligado, o clique na superfície do
  modelo faz raycast e cria o POI ali; os pontos existentes aparecem como
  marcadores numeráveis. Desligado, o palco volta a ser só câmera.
- O **roteiro** é uma sequência de visitas a POIs, e ele **compila para keyframes**
  nas props de câmera que o `studio.stage` já tem — não vira um player paralelo.
  Isso mantém a câmera função pura de `(documento, frame)`, preserva o export
  determinístico provado em `verify:phase8` 7/7, e dá o editor de curvas de graça
  para ajustar a chegada da câmera.

## Consequências

- **POI é do objeto, não do asset.** Trocar o GLB de um `model3d` mantém os POIs
  onde estavam em metros, e eles podem cair no vazio. Aceito: a alternativa —
  amarrar POI a nó do arquivo — é justamente o que esta decisão rejeita. O aviso
  cabe na interface, não no modelo de dados.
- **Raycast exige a geometria carregada.** POI não pode ser criado enquanto o GLB
  está em parse. O painel já sabe disso: `pendingModels()` é o mesmo número que o
  `settle` do export usa.
- **Um clique, um ponto.** Sem seleção múltipla por marquee no primeiro corte. O
  dono pediu "seleciono os pontos que eu quero", e clicar um por um é o que
  corresponde a marcar cabine, míssil e escapamento — três, não trinta.
- **O roteiro compilado sobrescreve keyframes de câmera.** Quem ajustou a curva à
  mão e recompila perde o ajuste. Precisa de aviso explícito, e é o mesmo problema
  que a Fase 7 já resolveu para ações live → keyframes: seguir o precedente dela
  em vez de inventar outro.
- **Animação de parte continua fora.** Girar a torre exige o modelo ter a torre
  como nó separado, e o 2S19 não tem. POI resolve levar a câmera até a torre;
  não resolve girá-la. São problemas diferentes e não devem ser confundidos —
  ver [09-CONTINUIDADE](../09-CONTINUIDADE.md) sobre `gltf.animations`.

## Nota de implementação (2026-07-28)

Implementado e provado: `verify:phase7e3` passou de 5/5 para **6/6**, e
`verify:phase8` continua **7/7**. Três desvios da letra deste ADR, todos medidos:

- **O marcador não vai no overlay Pixi do palco.** Este documento sugeria
  reaproveitá-lo, e o argumento estava certo quanto ao custo — mas aquele overlay
  (`.studio-viewport__pixi`) **é composto no frame de export**. Um marcador ali
  apareceria no vídeo sempre que alguém esquecesse o modo de marcação ligado, e o
  critério 8 da Fase 8 (nenhum elemento de UI em nenhum frame) está escrito para
  ser atendido por construção. Os marcadores ganharam superfície própria,
  `.studio-viewport__markers`, declarada em `EXCLUDED_SURFACE_SELECTORS` — o mesmo
  arranjo do canvas de gizmos do Viewport. Provado nos dois sentidos: 3.032 px de
  tinta com o modo ligado, **0** depois de desligar.
- **O nome do ponto é o nome do nó**, não uma `props.name`. Todo nó já tem `name`,
  o painel de camadas já o edita e o avaliador já o entrega. Dois campos "nome"
  para a mesma coisa divergiriam no primeiro rename.
- **O roteiro não virou `ActionTemplate` em `packages/behaviors`.** A ordem das
  visitas é a ordem das camadas, e quem sabe calculá-la é `topologicalOrder`, de
  `@theatrum/scene-graph` — que `behaviors` não tem entre as dependências.
  Duplicar a travessia lá deixaria a numeração do marcador e a ordem da visita
  livres para divergir em silêncio. O compilador é função pura em
  `apps/editor/src/panels/viewport/studio-tour.ts`, e grava por
  `keyframe.replace-all` pelo Command Bus: o precedente da Fase 7 no que importa
  — compila para keyframes, sem player paralelo, com aviso de substituição.

E uma armadilha que a implementação achou e este ADR não previa: **azimute
atravessa a costura 0/360**. Duas paradas em 350° e 10° estão a vinte graus uma da
outra, e a interpolação linear dos keyframes percorre 340 pelo lado errado — a
câmera dá uma volta quase completa em torno do objeto no meio da narração. Os
azimutes são **desenrolados** antes de virar keyframe (`unwrapAzimuths`), com o
valor de cada parada trocado pelo representante mais próximo do anterior. É a
mesma família de defeito de 09-CONTINUIDADE § 4.17: régua linear sobre grandeza
modular.

## Quando revisar

Quando entrar um modelo com hierarquia de verdade — rig de torre, trem de pouso
articulado. Aí "POI colado num nó do arquivo" passa a ter significado e vale
oferecer **além** do clique, nunca em vez dele.
