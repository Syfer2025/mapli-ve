# Theatrum

> Plataforma profissional de animação geopolítica e militar.
> Projeto, render e dados locais. ChatGPT/Codex como Maestro. Uso interno.

Theatrum é um editor de animação no estilo Adobe After Effects, especializado em
mapas históricos, geopolítica, história militar e estratégia. Produz animações
controladas por keyframes, câmera cinematográfica e efeitos GPU, com export para
vídeo, GIF e sequências PNG. A implementação aceita saídas de até 8192 px por
dimensão quando a superfície gráfica concreta comporta o pedido.

O nome vem de _Theatrum Orbis Terrarum_ (o primeiro atlas moderno, 1570) e de
_theatrum belli_ — teatro de operações.

---

## Estado atual

**Estado em 2026-07-30:** as Fases 8–10 têm suas fundações de produto
implementadas e a Fase 11 está parcial. O mapa salvo no projeto é a fonte de
verdade para estilo e câmera; o export falha fechado por padrão, publica arquivos
únicos por renomeação atômica e oferece fila persistente e checkpoints; o Scene
Script v1 compila e importa de forma transacional; e o catálogo empacotado de
unidades aparece na Biblioteca. O agente ChatGPT/Codex desta conversa pode
controlar o editor aberto pela ponte local do Maestro, aplicando Scene Script ou
comandos pontuais validados e lendo os diagnósticos de volta. O aplicativo não
embute um modelo e não pede chave de API. A Fase 11 já possui expressões seguras e os
núcleos determinísticos de cache de preview e waveform de referência.**

Ainda faltam as provas integradas finais, inclusive o ensaio de 90 s em
4K/60 e a sessão contínua de quatro horas. A retomada de MP4 H.264 reinicia o
stream; checkpoints reutilizam frames apenas nos formatos baseados em sequência.
O Inspector já permite editar/remover expressões e mostra falhas recuperáveis;
cache de preview e waveform ainda não têm a integração visual completa.
Atalhos configuráveis e presets locais de workspace também estão ligados ao
editor. O instalador não fez parte deste ciclo e não é tratado aqui como
artefato pronto. O estado detalhado está em
[docs/09-CONTINUIDADE.md](docs/09-CONTINUIDADE.md).

Antes disso, o bloco 7A++ tirou o 3D do chão: a camada Three.js renderiza modelos
GLB/glTF **com volume** e rotas como tubo volumétrico em altitude. Três defeitos
somados faziam tudo parecer adesivo colado no mapa — ver "O que era o 3D chapado"
abaixo. Replanejamento vigente: explosões, tanques e elementos 3D entram como
assets importados, não procedurais.

O monorepo, os guardrails arquiteturais, o núcleo matemático/temporal, o shell
Electron e o workspace dockável estão implementados. O viewport já é um painel
real: MapLibre + PMTiles offline, quatro estilos mundiais, mapa regional detalhado
Irã–Hormuz, satélite local, busca geográfica e câmera animável com transporte.
`composition.map.styleId` e `composition.camera` persistem no documento; gestos
do mapa passam pelo Command Bus e salvar, reabrir, desfazer e refazer preservam a
vista. Se um estilo regional opcional não estiver no disco, a UI mostra fallback
explícito sem reescrever a escolha salva. O documento possui schemas Zod, Command Bus com
undo/redo, projeto `.theatrum` determinístico, escrita atômica, autosave com
recuperação de crash e painéis reais de Projeto e Histórico. Agora há objetos de
verdade sobre o mapa: 22 tipos de nó no registry, overlay Pixi com âncoras geo
e comp, seleção por clique/marquee, gizmos de mover/rotacionar/escalar, timeline
em canvas com trilhas, keyframes, marcadores, zoom e snap, e um Inspector gerado
a partir de `PropertyDescriptor[]`. A Fase 5 acrescentou caminhos compartilhados no
projeto com ferramenta de caneta no mapa, cinco comportamentos declarativos
(caminho com velocidade uniforme no terreno, auto-orientação, inclinação em
curva, seguir com damping determinístico e oscilar), editor de curvas em canvas
com valor e velocidade, assistentes de keyframe e pré-composições aninhadas com
`timeRemap`. A Fase 6 entregou o sistema de partículas determinístico em GPU,
filtros com pilha por nó, presets e o painel de Efeitos com parâmetros
animáveis — e foi congelada aí: pelo replanejamento, explosões e elementos
visuais de cena serão assets importados pelo usuário, e o esforço segue para a
Biblioteca de ativos e os sistemas de mapa (rotas, setas, textos, contornos,
estradas). O bloco 7A entregou a Biblioteca: import de PNG/JPG/WebP/SVG/GLB com
endereçamento por hash de conteúdo, thumbnails, busca e tags, aplicação na cena
com as dimensões reais da imagem, tudo embutido no `.theatrum` — sem nenhum
caminho de arquivo externo. O bloco 7A+ ligou os modelos 3D ao mapa: tipo de nó
`model3d`, camada custom do MapLibre com Three.js no mesmo canvas (posição e
rumo vindos da cena avaliada, incluindo `motion-path` em `geo-bearing`), GLTF
carregado por `parse` de buffer com texturas embutidas (a CSP libera `blob:` em
`connect-src` para o decodificador do three), iluminação por environment map
(`RoomEnvironment` + tone mapping ACES) e a prova de conceito com o F/A-18F do
usuário voando de Kiev a Moscou em rota curva com marcadores de passagem. O bloco
7A++ consertou o que estava errado nesse caminho e acrescentou o tipo de nó
`route3d`: rota traçada a partir do mesmo caminho compartilhado que o
`motion-path` percorre, como tubo com raio em metros, perfil de altitude com
ápice senoidal (voo de cruzeiro é ápice zero; míssil balístico é ápice grande),
desenho progressivo animável por `progressStart`/`progressEnd` e cortina vertical
até o terreno.

### O que era o 3D chapado

Três defeitos somados, do mais grave ao menos:

1. **Matriz errada — o modelo era literalmente prensado.** A camada usava
   `args.modelViewProjectionMatrix` supondo que o z dela fosse "pixels mercator".
   Não é: o `_calcMatrices` do MapLibre monta essa matriz com
   `scale(m, m, [1, 1, _pixelPerMeter])`, ou seja o **z de entrada é em metros**.
   Passar `coordinate.z * worldSize` fazia `pixelsPerMeter` entrar duas vezes e a
   escala vertical sair ~2000× menor que a horizontal. O GLB virava um plano e
   90 km de altitude viravam centímetros. A saída certa é
   `args.defaultProjectionData.mainMatrix`, que a própria doc do MapLibre garante
   ser conformal em z: "uma caixa com x, y e z iguais em unidades mercator
   renderiza como um cubo". Espaço isotrópico traz de brinde matriz de normais
   correta (logo iluminação correta) e geometria independente do zoom.
2. **Depth test desligado — sem auto-oclusão.** Os materiais recebiam
   `depthTest = false` para não perder a metade de baixo contra o depth buffer do
   mapa. O efeito colateral era pintar todos os triângulos na ordem do buffer: a
   asa de trás cobria a fuselagem, o bocal do motor cobria a asa. O correto é
   manter o teste ligado e **limpar a profundidade** no início do render da
   camada — a cena 3D fica com o buffer inteiro, continua por cima do mapa, e
   cada fragmento é testado contra os outros dela. Modelo e rota compartilham o
   buffer, então se ocluem entre si.
3. **Iluminação lavada.** `RoomEnvironment` em intensidade cheia é um estúdio
   branco, e a luz chave era quase zenital — num objeto horizontal visto de cima,
   N·L igual em toda a superfície. Agora o environment entra a 0,4 e a chave é
   rasante, com preenchimento frio do lado oposto.

As rotas, por sua vez, não eram 3D em nenhum sentido: eram traçadas com
`map.project()` num canvas 2D, no nível do terreno. Passaram para a camada 3D. A
polilinha 2D continua existindo como **guia de autoria** — tracejada, e só para
caminho que ainda não tem `route3d` montado.

| Fase | Escopo                                    | Estado                                     |
| ---: | ----------------------------------------- | ------------------------------------------ |
|    0 | Arquitetura e especificações              | ✅ concluída                               |
|    1 | Fundação (monorepo, shell, tooling)       | ✅ concluída                               |
|    2 | Mapa + Câmera                             | ✅ concluída                               |
|    3 | Documento + Comandos + Undo               | ✅ concluída                               |
|    4 | Objetos + Timeline                        | ✅ concluída                               |
|    5 | Animação avançada (bezier, graph, paths)  | ✅ concluída                               |
|    6 | Efeitos e partículas (congelada)          | ✅ concluída                               |
|   7A | Biblioteca de ativos (import)             | ✅ concluída                               |
|  7A+ | Preview 3D no viewport (model3d)          | ✅ concluída                               |
| 7A++ | 3D com volume + rotas 3D (route3d)        | ✅ concluída                               |
|   7B | Camadas geo: contornos, estados, estradas | ✅ concluída                               |
|   7C | Rotas e setas de avanço                   | ✅ concluída                               |
|   7D | Textos e rótulos no mapa                  | ✅ concluída                               |
|   7E | Satélite, rótulo com guia, modo estúdio   | ✅ 3 de 4                                  |
|    7 | Ações / simulações                        | ✅ concluída                               |
|    8 | Exportação (PNG, MP4, GIF, ProRes 4444)   | 🟨 implementação; aceite final pendente    |
|    9 | Scene Script + Maestro                    | 🟨 implementação; prova visual pendente    |
|   10 | Plugins + conteúdo empacotado             | 🟨 fundação e catálogo; integração parcial |
|   11 | Polimento e performance                   | 🟨 fundações parciais                      |

Roteiro detalhado com critérios de saída: [docs/08-ROADMAP.md](docs/08-ROADMAP.md).

---

## Documentação

Leia nesta ordem.

| Documento                                           | Conteúdo                                                  |
| --------------------------------------------------- | --------------------------------------------------------- |
| [00-VISION.md](docs/00-VISION.md)                   | O que o software é, o que **não** é, e por quê            |
| [01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md)       | Camadas, módulos, diagramas, comunicação, fluxo de dados  |
| [02-MODULES.md](docs/02-MODULES.md)                 | Cada módulo: responsabilidade, API pública, invariantes   |
| [03-DATA-MODEL.md](docs/03-DATA-MODEL.md)           | Documento, scene graph, espaço geo/comp, tempo, keyframes |
| [04-PROJECT-FORMAT.md](docs/04-PROJECT-FORMAT.md)   | Formato `.theatrum` e schema do `project.json`            |
| [05-SCENE-SCRIPT.md](docs/05-SCENE-SCRIPT.md)       | Formato de alto nível para autoria por IA                 |
| [06-RENDER-PIPELINE.md](docs/06-RENDER-PIPELINE.md) | Ciclo do frame, compositor, determinismo, exportação      |
| [07-CONVENTIONS.md](docs/07-CONVENTIONS.md)         | Padrões de código, pastas, nomes, testes, performance     |
| [08-ROADMAP.md](docs/08-ROADMAP.md)                 | Fases de implementação com critérios de saída             |
| [09-CONTINUIDADE.md](docs/09-CONTINUIDADE.md)       | Estado técnico e passagem de bastão                       |
| [10-GUIA-DE-USO.md](docs/10-GUIA-DE-USO.md)         | Instalação e operação para o usuário                      |
| [adr/](docs/adr/)                                   | Decisões de arquitetura registradas (ADRs)                |

---

## Stack

| Camada                | Tecnologia                          | Motivo                                                                                                           |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Shell desktop         | Electron                            | Chromium fixo → WebGL/WebGPU previsível; pipe direto para FFmpeg ([ADR-001](docs/adr/ADR-001-shell-electron.md)) |
| UI                    | React 19 + TypeScript 6 + Vite 7    | Padrão, rápido, tipado                                                                                           |
| Layout de painéis     | dockview                            | Docking estilo AE, mantido                                                                                       |
| Mapa                  | MapLibre GL JS 5                    | Vetorial, offline, pitch/bearing/globo, sem licença ([ADR-006](docs/adr/ADR-006-maplibre.md))                    |
| Dados geo offline     | PMTiles 3 + Natural Earth + OSM     | Mundo leve e pacotes regionais detalhados, todos locais                                                          |
| Renderer de overlay   | PixiJS 8 (WebGL2 / WebGPU)          | Maduro, shaders customizados, batching                                                                           |
| Estado de UI          | Zustand 5                           | Simples, sem boilerplate                                                                                         |
| Documento / histórico | Immer + JSON Patch                  | Undo barato, invalidação dirigida por patch                                                                      |
| Schemas               | Zod 4 → JSON Schema                 | Validação em runtime **e** contrato para IA                                                                      |
| Encoding              | WebCodecs (HW) + FFmpeg sidecar     | HW quando possível, ProRes/alpha via FFmpeg                                                                      |
| Testes                | Vitest + Playwright + golden frames | Matemática pura + regressão visual                                                                               |
| Rust                  | _nenhum, por ora_                   | Só entra se um gargalo medido justificar ([ADR-007](docs/adr/ADR-007-no-rust-yet.md))                            |

---

## Princípios não negociáveis

1. **Renderização é função pura de `(documento, frame)`.** Sem `Date.now()`,
   sem `Math.random()`, sem estado acumulado. Sem isso não existe exportação
   confiável. Ver [ADR-003](docs/adr/ADR-003-determinism.md).
2. **O documento é a única verdade.** Toda mutação passa pelo Command Bus.
   Nada escreve no documento direto.
3. **Dependência forma um DAG.** Um módulo nunca importa de uma camada acima;
   arestas laterais só existem quando declaradas na matriz normativa. Verificado
   por lint, não por disciplina.
4. **Data-driven de ponta a ponta.** Se a UI consegue criar, um JSON consegue
   criar. A UI é apenas um gerador de comandos.
5. **Offline é requisito, não modo degradado.** Nada de rede no caminho crítico.

---

## Desenvolvimento

Pré-requisitos:

- Node.js 22 ou mais recente
- pnpm 11 ou mais recente
- Windows 10/11 para o shell Electron atual
- FFmpeg 8.1.2 fixado, apenas para testar/empacotar GIF e ProRes em desenvolvimento

Instale as dependências e abra o editor:

```powershell
pnpm install
pnpm data:fetch
pnpm dev
```

`data:fetch` é o único comando que usa rede. Depois dele, `dev`, os três estilos,
o gazetteer e a animação de câmera funcionam somente com arquivos locais.

Execute todas as verificações:

```powershell
pnpm check
```

O comando valida tipagem, formatação, lint, DAG de dependências e testes.

## Instalador do Windows

O repositório mantém a receita de empacotamento:

```powershell
pnpm dist:win
```

Este ciclo não reconstruiu nem revalidou um instalador, portanto a documentação
não promete um executável atual em `release/`. Antes de qualquer distribuição,
é preciso preparar os dados e o sidecar, executar o empacotamento e validar o
artefato resultante em uma instalação limpa.

Com `pnpm dev` aberto em outro terminal, a prova integrada da Fase 2 é:

```powershell
pnpm verify:phase2
```

Ela dirige o renderer Electron real e verifica Range, estilos offline, projeção,
gazetteer, playback, latência de settle e timeout por PMTiles ausente.

No mesmo ambiente, a prova integrada da Fase 3 é:

```powershell
pnpm verify:phase3
```

Ela verifica o Command Bus e o painel Histórico no Electron real, além do
determinismo do container, reabertura, schema futuro, migração e recuperação
simulada. A prova de recuperação após encerramento abrupto é dividida em duas
etapas seguras:

```powershell
pnpm verify:phase3 -- --prepare-recovery
# encerre o Electron abruptamente e inicie `pnpm dev` novamente
pnpm verify:phase3 -- --verify-recovery
```

E a prova integrada da Fase 4:

```powershell
pnpm verify:phase4
```

Ela coloca um blindado em Kursk e um título em espaço `comp`, varre cinco estados
de câmera comparando com `map.project()`, mede opacidade e escala com keyframes
durante um `play` real, monta 300 trilhas com 3.120 keyframes para medir o redraw
da timeline, cria um `shape.circle` pelo menu gerado do registry e confere o
Inspector. No fim desfaz tudo e compara o documento com o estado inicial.

E a prova integrada da Fase 5:

```powershell
pnpm verify:phase5
```

Ela desenha um caminho com a caneta e mede velocidade uniforme no terreno, aplica
ease e arrasta um handle bezier no editor de curvas, verifica banking em rota
geodésica, prova que o seguidor com damping é idêntico avaliando frames fora de
ordem e que uma pré-composição aninhada aceita `timeRemap`. No fim desfaz tudo e
compara o documento com o estado inicial.

E a prova integrada do bloco 7A:

```powershell
pnpm verify:phase7a
```

Ela importa um PNG gerado em canvas e verifica o thumbnail no painel Biblioteca,
a aplicação na cena com textura no cache do Pixi e animação por propriedade, o
round-trip do container com SHA-256 dos bytes preservado, a remoção de um asset
em uso com aviso dos nós afetados (nó preservado, imagem fora da cena) e um lote
de 200 assets com thumbnails lazy. No fim desfaz tudo e compara o documento com
o estado inicial.
