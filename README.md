# Theatrum

> Plataforma profissional de animação geopolítica e militar.
> 100% local. 100% offline. Uso interno.

Theatrum é um editor de animação no estilo Adobe After Effects, especializado em
mapas históricos, geopolítica, história militar e estratégia. Produz animações de
alta qualidade para vídeo (4K/60, 8K, alpha channel), controladas por keyframes,
câmera cinematográfica e um sistema de efeitos GPU.

O nome vem de _Theatrum Orbis Terrarum_ (o primeiro atlas moderno, 1570) e de
_theatrum belli_ — teatro de operações.

---

## Estado atual

**Fase 5 — Animação avançada concluída. Próxima: Fase 6 — Efeitos.**

O monorepo, os guardrails arquiteturais, o núcleo matemático/temporal, o shell
Electron e o workspace dockável estão implementados. O viewport já é um painel
real: MapLibre + PMTiles offline, três estilos, busca geográfica e câmera
animável com transporte. O documento possui schemas Zod, Command Bus com
undo/redo, projeto `.theatrum` determinístico, escrita atômica, autosave com
recuperação de crash e painéis reais de Projeto e Histórico. Agora há objetos de
verdade sobre o mapa: treze tipos de nó no registry, overlay Pixi com âncoras geo
e comp, seleção por clique/marquee, gizmos de mover/rotacionar/escalar, timeline
em canvas com trilhas, keyframes, marcadores, zoom e snap, e um Inspector gerado
a partir de `PropertyDescriptor[]`. Os painéis das fases seguintes continuam como
placeholders intencionais. A Fase 5 acrescentou caminhos compartilhados no
projeto com ferramenta de caneta no mapa, cinco comportamentos declarativos
(caminho com velocidade uniforme no terreno, auto-orientação, inclinação em
curva, seguir com damping determinístico e oscilar), editor de curvas em canvas
com valor e velocidade, assistentes de keyframe e pré-composições aninhadas com
`timeRemap`.

| Fase | Escopo                                   | Estado       |
| ---: | ---------------------------------------- | ------------ |
|    0 | Arquitetura e especificações             | ✅ concluída |
|    1 | Fundação (monorepo, shell, tooling)      | ✅ concluída |
|    2 | Mapa + Câmera                            | ✅ concluída |
|    3 | Documento + Comandos + Undo              | ✅ concluída |
|    4 | Objetos + Timeline                       | ✅ concluída |
|    5 | Animação avançada (bezier, graph, paths) | ✅ concluída |
|    6 | Efeitos e partículas                     | ⏭️ próxima   |
|    7 | Ações / simulações                       | ⬜           |
|    8 | Exportação                               | ⬜           |
|    9 | Scene Script (autoria por IA)            | ⬜           |
|   10 | Plugins + biblioteca de assets           | ⬜           |
|   11 | Polimento e performance                  | ⬜           |

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
| [adr/](docs/adr/)                                   | Decisões de arquitetura registradas (ADRs)                |

---

## Stack

| Camada                | Tecnologia                          | Motivo                                                                                                           |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Shell desktop         | Electron                            | Chromium fixo → WebGL/WebGPU previsível; pipe direto para FFmpeg ([ADR-001](docs/adr/ADR-001-shell-electron.md)) |
| UI                    | React 19 + TypeScript 6 + Vite 7    | Padrão, rápido, tipado                                                                                           |
| Layout de painéis     | dockview                            | Docking estilo AE, mantido                                                                                       |
| Mapa                  | MapLibre GL JS 5                    | Vetorial, offline, pitch/bearing/globo, sem licença ([ADR-006](docs/adr/ADR-006-maplibre.md))                    |
| Dados geo offline     | PMTiles 3 + Natural Earth           | Arquivos locais verificados, zero servidor                                                                       |
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

O comando valida tipagem, formatação, lint, DAG de dependências e testes. O
FFmpeg será distribuído como sidecar na Fase 8; não exige instalação global.

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
