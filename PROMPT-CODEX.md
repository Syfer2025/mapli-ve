# Prompt de continuação — Theatrum

Você está retomando o Theatrum em uma árvore de trabalho que pode conter mudanças
locais ainda não consolidadas. Preserve tudo que já existe: antes de editar, leia
`git status --short` e o diff dos arquivos que tocar. Não use `reset`, não apague
mudanças alheias e não trate arquivo novo como descartável.

## Leia antes de agir

Nesta ordem:

1. [README.md](README.md)
2. [docs/09-CONTINUIDADE.md](docs/09-CONTINUIDADE.md)
3. [docs/08-ROADMAP.md](docs/08-ROADMAP.md), Fases 8–11
4. [docs/02-MODULES.md](docs/02-MODULES.md)
5. [docs/05-SCENE-SCRIPT.md](docs/05-SCENE-SCRIPT.md)
6. [docs/06-RENDER-PIPELINE.md](docs/06-RENDER-PIPELINE.md)
7. ADRs
   [026](docs/adr/ADR-026-map-view-is-document-state.md),
   [027](docs/adr/ADR-027-fail-closed-and-atomic-export.md),
   [028](docs/adr/ADR-028-scene-script-compiler.md),
   [029](docs/adr/ADR-029-versioned-disposable-plugin-boundary.md),
   [030](docs/adr/ADR-030-safe-property-expressions.md) e
   [031](docs/adr/ADR-031-preview-cache-and-reference-audio.md),
   [032](docs/adr/ADR-032-shortcuts-and-workspace-presets.md),
   [033](docs/adr/ADR-033-durable-render-queue-checkpoints.md) e
   [034](docs/adr/ADR-034-direct-8k-with-conformance-guard.md)

## Bootstrap

Depois de atualizar a árvore, links de workspace ou dados compilados podem estar
ausentes. A sequência completa é:

```powershell
pnpm install
pnpm data:fetch
pnpm geo:build
```

`data:fetch` usa rede. Não o rode sem necessidade quando os dados já estiverem
presentes. O conteúdo empacotado e o documento de autoria do Scene Script têm
verificações próprias:

```powershell
pnpm content:verify
pnpm scene:authoring:verify
```

## Estado funcional em 2026-07-30

### Mapa e documento

- `composition.map.styleId` e `composition.camera` são a verdade persistida.
- Gestos consolidados do mapa passam pelo Command Bus; propriedades animadas
  recebem keyframe no playhead.
- Salvar, reabrir, desfazer e refazer preservam estilo e câmera.
- A ausência de basemap detalhado ou satélite opcional produz fallback visível,
  mas não altera a escolha gravada no projeto.

### Exportação

- MP4 H.264, GIF, ProRes 4444 e PNG normal/alfa estão implementados.
- O `settle` padrão é `fail`: um frame não estabilizado não é composto nem
  escrito. `continue` existe apenas como opção diagnóstica explícita.
- MP4, GIF e MOV são escritos em temporário no mesmo diretório e só ganham o nome
  final por renomeação atômica depois da conclusão.
- A fila persiste no renderer e executa serialmente no viewport vivo. Não existe
  uma Render Window oculta.
- Checkpoints são gravados durante o job. PNG, GIF e ProRes podem reutilizar a
  sequência já concluída; MP4 H.264 direto reinicia o stream.
- A resolução lógica, a escala de saída e o supersampling são controles
  separados. O teto padrão é 8192 px por dimensão, sempre sujeito à capacidade
  real da superfície/GPU.
- A fila referencia a composição disponível no documento no momento de executar;
  não congela ainda um snapshot imutável do projeto. Editar durante o job em
  andamento o interrompe.

### Scene Script

- `compileScene` é assíncrono, determinístico e offline.
- Estrutura, tempo relativo, lugares, registro de verbos, validação semântica,
  emissão do documento e diagnósticos com JSON Pointer estão implementados.
- Erro impede documento parcial. A importação substitui o documento por um único
  comando, portanto um `Ctrl+Z` desfaz a operação inteira.
- A UI **Scene Script…** recebe JSON e mostra diagnósticos.
- [LLM_AUTHORING.md](LLM_AUTHORING.md) é gerado a partir do registro; o exemplo
  [examples/alexandre.scene.json](examples/alexandre.scene.json) acompanha o
  contrato.
- O caminho inverso é deliberadamente parcial: para uma cena importada e ainda
  equivalente, devolve a fonte normalizada preservada. Edições posteriores geram
  aviso e não são reconstruídas nem embrulhadas em um bloco `raw`.

### Plugins e conteúdo

- `packages/plugin-host` implementa validação de manifest, descoberta por porta
  de filesystem, host com escopos descartáveis, registries nomeados e preservação
  de nós desconhecidos.
- O host ainda não está ligado a um carregador de plugins do shell/editor. Não
  afirme que plugins arbitrários já podem ser instalados pela UI.
- O conteúdo gerado inclui catálogo de unidades, sprites, bandeiras, paletas e
  presets. O catálogo de unidades é carregado e pesquisável na Biblioteca; os
  demais conteúdos ainda não estão todos ligados à UI.

### Fase 11

- Expressões de propriedade usam parser e intérprete próprios, sem `eval` ou
  `new Function`. Recebem `value` e `frame`, rodam depois dos keyframes e falham
  para o valor base com diagnóstico estruturado.
- O botão **ƒx** do Inspector permite visualizar, editar e remover a expressão
  da propriedade. Aplicar/remover passa pelo Command Bus e participa de
  undo/redo; expressão inválida continua armazenável para correção e mostra que
  o valor base está sendo usado.
- Cache de preview em RAM/disco e análise PCM de áudio de referência possuem
  núcleos determinísticos e limitados por orçamento.
- Presets de workspace e atalhos configuráveis são preferências locais
  fail-safe, separadas do documento.
- O pré-render/cache visível e a trilha de waveform ainda precisam de integração
  no editor.
- Áudio de referência não reproduz, não faz scrub sonoro, ganho, fades, mixagem
  nem entra no export.

## Próximo trabalho

1. Executar a validação final proporcional ao escopo e corrigir somente falhas
   causadas pelas mudanças atuais.
2. Demonstrar os critérios integrados ainda sem evidência atual, em especial:
   export de 90 s em 4K/60, caminho 8K na máquina-alvo, retirada de PMTiles
   durante o export e retomada real após reinício.
3. Integrar ao editor, em blocos separados, o cache de preview e a waveform de
   referência.
4. Completar os itens de polimento ainda ausentes, em especial o onboarding.
5. Só declarar a Fase 11 concluída depois do soak de quatro horas com memória
   estável. Esse soak **não foi executado**.

O instalador está fora do escopo desta retomada. A receita `pnpm dist:win` existe,
mas não há autorização para prometer, reconstruir ou publicar um artefato.

## Regras que continuam valendo

- Render é função do documento e do frame. Sem relógio de parede, aleatoriedade
  não semeada ou estado acumulado no motor.
- Toda mutação persistida passa pelo Command Bus.
- Offline é requisito; ausência de dado opcional deve ser explícita e não pode
  corromper a escolha salva.
- Um timeout de settle nunca pode publicar silenciosamente um frame contaminado.
- Medição final deve distinguir implementação existente de critério efetivamente
  demonstrado. Não registre contagens ou resultados como atuais antes de executar
  a validação correspondente nesta árvore.
