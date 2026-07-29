# ADR-019 — A mesma Timeline projeta o contexto do Mapa ou do Palco

**Status:** aceito · **Data:** 2026-07-29 · **Revisar em:** quando houver mais de
um palco por composição, quando Mapa e Palco puderem ficar visíveis ao mesmo
tempo ou quando uma parada individual ganhar duração própria

## Contexto

O pedido 2 do dono na rodada 7F é uma Timeline própria do modo Palco. A Timeline
atual é uma projeção genérica da árvore inteira:

- `TimelinePanel.tsx` sempre chama `buildTimelineModel` sobre a composição;
- `timeline-model.ts` não conhece `studio.stage` nem `studio.poi`;
- camadas geográficas, rótulos, palco, modelos e pontos aparecem juntos;
- o estado de zoom, rolagem e expansão mora no componente;
- o dockview desmonta a aba inferior inativa, então esse estado não atravessa
  uma ida ao Histórico ou ao Editor de curvas.

Isso é tecnicamente consistente e semanticamente errado. No Mapa interessam as
camadas da composição. No Palco interessam:

1. as seis propriedades reais da câmera do `studio.stage`;
2. os `studio.poi`, na mesma ordem topológica usada pelo roteiro;
3. quando cada parada acontece, a partir de `tourStartFrame`,
   `tourTravelFrames` e `tourHoldFrames`.

O roteiro não é um segundo player. O ADR-015 decidiu que ele compila para
keyframes da câmera, e `studio-tour.ts` já contém a aritmética. A Timeline não
pode criar outra fórmula parecida: duas fórmulas para a mesma chegada divergiriam
sem erro de tipo.

Também há duas noções diferentes de painel ativo:

- `DockviewApi.activePanel` é o painel que recebeu foco por último em toda a
  janela. Clicar Timeline, Inspector ou Histórico tira Viewport/Palco dali;
- o contexto visual que o usuário está editando é a última superfície de
  conteúdo ativada: `viewport` ou `studio`.

Usar a primeira no lugar da segunda faria a Timeline trocar de significado
quando o usuário clicasse nela.

## Alternativas

### A. Segundo painel dockview, `Studio Timeline`

✅ Isola completamente estado, cabeçalhos e modelo.
✅ Mapa e Palco podem ter zoom e expansão diferentes sem infraestrutura nova.

❌ Duplica toolbar, acessibilidade, hit-test, arraste, snap, profiler e correções.
❌ Adiciona outra aba inferior a todo layout salvo e exige migração visual.
❌ Duas Timelines editariam os mesmos keyframes pelo mesmo Command Bus; o nome do
painel, não o conteúdo, seria a única diferença.

### B. Uma Timeline que lê `DockviewApi.activePanel`

✅ Uma condição decide o modelo, sem estado de contexto próprio.
✅ Acompanharia automaticamente qualquer painel que recebesse foco.

❌ É justamente o sinal errado. Depois de clicar na própria Timeline, o painel
ativo passa a ser `timeline`; depois de abrir o Inspector, passa a ser
`inspector`. Nenhum dos dois diz se o usuário veio do Mapa ou do Palco.
❌ Um fallback para Mapa faria o Palco desaparecer da Timeline no primeiro
ajuste de keyframe.

### C. Uma Timeline com projeções semânticas e contexto de sessão

Existe uma noção explícita `map | studio`, atualizada **somente** quando
`viewport` ou `studio` é ativado. Todo outro painel é ignorado.

✅ Mantém uma única implementação de desenho, hit-test, acessibilidade e edição.
✅ O contexto não muda quando o usuário vai da superfície à Timeline para
trabalhar.
✅ O modelo do Mapa pode permanecer byte por byte no caminho atual.
✅ Zoom, rolagem e expansão podem ser preservados separadamente por contexto,
mesmo quando o dockview desmonta o painel.

❌ Cria estado de sessão novo que não mora no documento.
❌ A Timeline deixa de ser uma tradução literal da árvore inteira no Palco; ela
passa a ser uma vista curada.
❌ Reiniciar o aplicativo descarta zoom e expansão. Persisti-los exigiria mudar o
contrato de workspace, custo que este pedido não justifica.

### D. Guardar o modo ativo no documento

✅ Reabre no mesmo contexto em outra máquina.
✅ O Command Bus e o autosave já transportariam a escolha.

❌ Mapa versus Palco é estado de interface, não conteúdo renderizado. Colocá-lo
no `.theatrum` sujaria o projeto ao trocar de aba, entraria no undo e faria duas
pessoas produzirem diffs por terem olhado painéis diferentes.
❌ Violaria a fronteira de sessão registrada em `docs/01-ARCHITECTURE.md`.

## Decisão

**Alternativa C.** Continua existindo um único `TimelinePanel`, alimentado por
uma de duas projeções imutáveis.

### Contexto da superfície

`WorkspaceContentMode` é estado de sessão em memória:

- começa pela aba ativa do grupo Viewport/Palco depois de restaurar o layout;
- se isso for ambíguo, começa em `map`;
- muda quando o evento de ativação traz `viewport` ou `studio`, seja a origem
  usuário ou API;
- ignora Timeline, Inspector, Histórico, Curvas, Fila e todos os demais;
- nunca entra no documento, no histórico, no export nem no workspace salvo.

O estado de visualização da Timeline — `startFrame`, `pixelsPerFrame`, `scrollY`
e nós expandidos — é guardado separadamente para `map` e `studio` num store de
sessão. Ele atravessa desmontagens do dockview, mas não reinícios do aplicativo.

### Projeção do Mapa

É o `buildTimelineModel` atual, sem filtro e sem mudança de ordenação. Esta é uma
restrição, não uma intenção vaga: o bloco não pode esconder nem reordenar uma
camada do Mapa.

### Projeção do Palco

A composição continua sendo a única entrada. A projeção contém:

1. o primeiro `studio.stage` da ordem topológica;
2. somente as seis props de câmera:
   `targetX/Y/Z`, `distanceMeters`, `azimuthDeg` e `elevationDeg`;
3. todos os `studio.poi`, em ordem topológica, inclusive os desligados para que
   possam ser reativados;
4. as props animáveis de posição e enquadramento dos POIs;
5. uma faixa sintética **Roteiro previsto**, formada pelas paradas ligadas.

Sem `studio.stage`, a projeção fica vazia e mostra diagnóstico explícito. Ela
nunca recua para as camadas do Mapa: isso esconderia a ausência do palco sob
conteúdo plausível.

A aritmética das paradas é extraída do compilador e compartilhada. Para a parada
de índice `i`:

```text
chegada = início + i × (pausa + voo)
partida = chegada + pausa
```

O compilador aplica a fórmula depois de descartar POIs cuja geometria não
resolveu; a Timeline mostra o roteiro **previsto pelo documento**. Quando um
asset ainda não carregou ou um dono está ausente, compilar pode omitir a parada
e já relata isso na barra do Palco. A Timeline não passa a depender do estado de
parse de um GLB, porque uma vista do documento não deve piscar conforme I/O.
Esse limite fica visível no nome “previsto” e é custo aceito.

A faixa sintética não contém ids de keyframe e não entra no índice de hit-test.
Clique ou arraste nela só move o playhead. Apenas losangos que correspondem a
keyframes reais podem emitir `keyframe.move`, sempre pelo Command Bus. As linhas
de POI continuam associadas a ids reais de nó, portanto seleção, ligar/desligar e
undo não precisam de comandos especiais.

### Superfície de diagnóstico

`__theatrumPhase4Timeline` passa a existir em desenvolvimento **ou** no build
estático com `VITE_THEATRUM_VERIFY=1`, como as outras superfícies de prova. O
build normal deve ser reconstruído sem a flag e inspecionado para exigir zero
ocorrência de `__theatrumPhase4Timeline`, das demais `__theatrum*` e do nome da
flag.

## Consequências

- **Uma implementação, dois modelos.** Correções de canvas, snap e
  acessibilidade valem para os dois contextos.
- **O modelo do Palco é deliberadamente menor.** Aparência do piso, luz e névoa
  continuam no Inspector; a Timeline própria mostra câmera, POIs e roteiro. Se o
  dono pedir animação de look no mesmo painel, o filtro é o ponto único a revisar.
- **`model3d` não entra no primeiro corte.** O pedido foi câmera, POIs e roteiro,
  e misturar toda propriedade do equipamento recriaria a árvore genérica com outro
  nome. Movimento do modelo continua editável no Mapa/Timeline geral e seus
  keyframes continuam dirigindo POIs ancorados.
- **A faixa prevista não edita duração.** Arrastar uma pausa isolada exigiria
  tempo por POI no modelo de dados. Hoje a duração é uniforme no `studio.stage`;
  fingir edição por parada faria a UI prometer uma estrutura que não existe.
- **O contexto é local à janela.** Duas janelas podem olhar modos diferentes sem
  sujar o projeto. O custo é perder o contexto ao reiniciar quando o layout não
  permite inferi-lo.
- **Mais um store de sessão.** Ele precisa de snapshot referencialmente estável
  para `useSyncExternalStore` e testes de desmontagem; objeto novo a cada leitura
  causaria render infinito.

## Prova

### Unidade

- ativar `studio`, depois Timeline/Inspector, mantém `studio`; ativar `viewport`
  muda para `map`;
- restauração escolhe a aba ativa do grupo e cai para `map` quando ambígua;
- trocar de modo restaura exatamente zoom, rolagem e expansão anteriores;
- a projeção `map` permanece igual à atual;
- a projeção `studio` não contém nós geográficos nem rótulos;
- palco produz exatamente seis trilhas de câmera;
- POIs aparecem em ordem topológica; desligar um o mantém editável e o remove da
  faixa prevista;
- chegada e partida usam a mesma função pura que o compilador;
- sem palco, a projeção é vazia e diagnosticada;
- faixa prevista nunca cria `TimelineHit`.

### Electron real

O `verify:phase7e3` ganha dois critérios, em build estático e perfil descartável:

1. Mapa → Palco troca a mesma Timeline, mostra câmera/POIs/roteiro e não mostra
   camada geográfica; focar Timeline e Inspector não troca o contexto; voltar ao
   Mapa restaura o modelo e o estado visual anterior.
2. Arrastar um keyframe real da câmera em Palco passa pelo Command Bus, e undo
   devolve o documento byte por byte; arrastar a faixa prevista não cria comando.
   O profiler repete o cenário de 200 trilhas/3.000 keyframes e mantém p95 de
   redraw abaixo de 4 ms.

Depois, `verify:phase8` e `verify:phase8-video` continuam verdes. A recuperação
do dono é comparada por hash antes e depois; nenhuma prova usa o perfil padrão.

## Quando revisar

- Dois palcos por composição exigem escolher qual deles dirige a projeção.
- Mapa e Palco visíveis simultaneamente eliminam a ideia de “última superfície”
  e pedem contexto por instância de Timeline.
- Duração ou ordem própria por POI transforma a faixa prevista em conteúdo
  editável e exige novo modelo de dados.
