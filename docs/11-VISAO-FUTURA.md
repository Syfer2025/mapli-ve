# 11 — Visão futura

Planos **decididos em conversa e estacionados de propósito**, para não se
perderem e para não virarem trabalho antes da hora.

O dono foi explícito ao criar este documento: _"vamos tentar finalizar o que já
temos antes de criar mais e mais módulos"_. Nada aqui deve ser implementado antes
de a lista de fechamento em [09-CONTINUIDADE § 3](09-CONTINUIDADE.md) estar
zerada.

---

## 1. Animação de asset — ADR-021, escrito e pronto para implementar

**Único item desta página que já tem ADR aceito.** Ver
[ADR-021](adr/ADR-021-asset-animation-clips.md).

`three-assets.ts` descarta `gltf.animations` na entrada. Isso bloqueou três
pedidos diferentes numa sessão só: girar a torre do obuseiro, abrir o trem de
pouso do F/A-18, animar um soldado.

**É o pré-requisito de tudo o mais nesta página.** Sem ele, palco de voo e
simulador de combate não saem do papel.

## 2. Palco de voo

Aeronave em movimento com céu por horário, nuvens em camadas com paralaxe, e
takes dinâmicos — passagem, de frente, de costas.

Reaproveita quase tudo: o roteiro de paradas vira roteiro de takes, com a mesma
compilação para keyframes. O que é novo é o céu, as nuvens e o horário.

**Realismo estimado: 6 de 10.** Vai parecer cutscene de jogo bom, não filme. O
que segura: sem ray tracing, sem nuvem volumétrica (bloqueio de ferramenta, o
mesmo do VFX), textura de 1024 px e **sem motion blur** — que é justamente o item
que já está na lista de fechamento. Com motion blur, correção de cor e
profundidade de campo, chegaria a 8.

## 3. Simulador de combate por turnos

Invasão de edificação, estilo _Breach & Clear_: planta baixa que vira paredes,
soldados que andam, agacham e apontam, e a cena resolvida em turnos.

Três blocos, e só um é difícil:

| Bloco                  | Dificuldade                          |
| ---------------------- | ------------------------------------ |
| Construir o edifício   | Média — parede é caixa extrudada     |
| Turnos e movimento     | Média                                |
| **Personagem animado** | **Depende do acervo, não do código** |

## 4. Editor de personagem modular

Ideia do dono, e é a leitura certa de como um pacote modular funciona: as peças
(cabeça, corpo, colete, capacete) são _skeletal meshes_ que **dividem o mesmo
esqueleto**. Não se colam — penduram-se no mesmo esqueleto e deformam juntas.

Encaixa bem aqui: o documento guarda **quais módulos**, que é dado pequeno e
versionável, e montar é função pura dos módulos escolhidos.

**O risco real é nome de osso.** Animação e personagem se casam por nome. Pacote
de animação de Epic skeleton casa direto; Mixamo usa outra convenção
(`mixamorig:Hips` contra `pelvis`) e exige uma tabela de tradução — chata, mas
finita e escrita uma vez.

## 5. Decalque no objeto — ADR-020, escrito

Ver [ADR-020](adr/ADR-020-studio-decals.md). Marcação projetada na superfície,
não destrutiva, reaproveitando o clique-com-raycast do ADR-015. Resolve "tapar a
matrícula" e "pôr a logo" sem tocar no GLB.

Independe do ADR-021 e pode entrar antes, se o dono priorizar.

---

## O que o acervo bloqueia, e código nenhum resolve

Medido três vezes nesta sessão, sempre com a mesma assinatura no nome do nó pai —
`*.obj.cleaner.materialmerger.gles`:

| Modelo      | Animações | Skins | Nós                  |
| ----------- | --------- | ----- | -------------------- |
| F/A-18F     | 0         | 0     | 66, todos `Object_N` |
| 2S19M1      | 0         | 0     | 51, todos `Object_N` |
| RGF Assault | 0         | 0     | 23, todos `Object_N` |

**Passou por OBJ, perdeu o esqueleto.** OBJ não guarda rig, e a conversão é
irreversível. É por isso que a busca por asset deve filtrar por _rigged_ **e**
_animated_, e fugir de qualquer arquivo com `.obj` no nome.

**FBX é caminho válido**: `FBXLoader.js` já está instalado ao lado do
`GLTFLoader` que o projeto usa, e FBX preserva esqueleto e animação. Asset de
Unity costuma trazer FBX no pacote.

**Formato que não serve:** `.uasset` e `.pak` da Unreal. O pacote em
`D:\New folder\Modular military 2 - Demo` é um **demo executável** — os modelos
estão cozidos dentro do `.pak`, e não há caminho honesto de volta.
