# 00 — Visão

## O produto

Theatrum é um **editor de animação temporal sobre mapas reais**.

Não é um editor de mapas com animação bolada por cima. É um motor de animação
(no modelo do After Effects) cujo sistema de coordenadas primário é geográfico.
Essa inversão é a decisão de produto mais importante do projeto e define quase
tudo na arquitetura.

Consequência prática: um tanque colocado em Kursk **fica** em Kursk. Se a câmera
faz zoom, gira ou inclina, o tanque acompanha o terreno — porque sua posição é
`[36.19, 51.73]`, não `[840, 512]`. Ao mesmo tempo, um título de tela precisa
ficar preso ao quadro, indiferente à câmera. As duas coisas coexistem no mesmo
scene graph, com o mesmo sistema de keyframes. Ver
[03-DATA-MODEL.md § Espaços de coordenadas](03-DATA-MODEL.md#3-espaços-de-coordenadas).

## Para quem

Um único operador, em uma máquina, produzindo vídeos de YouTube sobre guerras,
geopolítica e história militar. Nenhum outro público.

Isso permite decisões que um SaaS não poderia tomar: acesso direto ao disco,
processos nativos, bibliotecas de assets locais gigantes, cache sem limite,
render em janela dedicada, e zero código de autenticação, cobrança, tenancy,
rate limit ou telemetria.

## Objetivos

1. **Qualidade visual de broadcast.** 4K/60 mínimo, alpha channel, sem artefato
   de compressão intermediária, sem tearing, sem "cheiro de web".
2. **Fluxo de trabalho familiar.** Quem sabe After Effects deve produzir algo em
   15 minutos: timeline, layers, keyframes, inspector, graph editor.
3. **Velocidade de produção.** Ações prontas ("bombardear", "avançar",
   "interceptar") transformam 40 keyframes manuais em um clique — mas geram
   keyframes reais e editáveis, não caixas-pretas.
4. **Autoria dirigida por IA.** O agente ChatGPT/Codex desta conversa é o
   Maestro: recebe a intenção do operador, planeja uma cena realizável, opera o
   editor pela ponte local, valida o resultado e corrige diagnósticos. O
   aplicativo não embute outro modelo. Ver
   [05-SCENE-SCRIPT.md](05-SCENE-SCRIPT.md).
5. **Longevidade.** O formato de projeto é versionado e migrável. Módulos são
   substituíveis. Nenhuma dependência não substituível.

## Não-objetivos (explícitos)

Registrados para impedir escopo se alargando por conta própria.

| Não faremos                                        | Motivo                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| Autenticação, contas, multiusuário                 | Uso interno, uma máquina                                            |
| Sincronização em nuvem, colaboração                | Idem                                                                |
| Cobrança, licenciamento, SaaS                      | Idem                                                                |
| Telemetria, analytics                              | Idem                                                                |
| LLM embutido ou credencial de IA no aplicativo     | O Maestro é o agente ChatGPT/Codex externo que já conduz a conversa |
| Física real (balística, fluidos, colisão)          | Animação é dirigida por keyframe e efeito, não simulada             |
| Edição de áudio além de referência                 | Áudio entra no NLE depois; aqui serve só de guia de tempo           |
| Edição de vídeo geral (corte, transição de clipes) | Não é um NLE; é um gerador de camadas                               |
| Build para web / mobile                            | Desktop Windows, offline                                            |
| Suporte a navegador arbitrário                     | Chromium do Electron, versão fixa                                   |

**Áudio:** uma trilha de referência importável (waveform na timeline, para
sincronizar animação com narração) _está_ no escopo, na Fase 11. Mixagem,
efeitos de áudio e exportação de áudio não estão.

## Restrições que moldam a arquitetura

Estas não são preferências. São restrições físicas do problema.

1. **Exportação não pode depender de tempo real.** Renderizar 90 s a 60 fps em
   4K não roda a 60 fps. Logo o motor precisa avaliar um frame arbitrário `f`
   sem passar pelos anteriores. Isso proíbe qualquer estado acumulado.
   → [ADR-003](adr/ADR-003-determinism.md)

2. **O mapa é assíncrono.** MapLibre carrega tiles, glyphs e sprites por rede
   (aqui, disco) e desenha o que tem. Em preview isso é aceitável; em export é
   inaceitável — um frame com tile faltando é um frame perdido. Logo o pipeline
   de export precisa de um passo explícito de _settle_.
   → [06-RENDER-PIPELINE.md § 4](06-RENDER-PIPELINE.md#4-determinismo-e-settle-do-mapa)

3. **Projeção geo→tela é do mapa, não nossa.** Se reimplementarmos Web Mercator,
   o overlay desalinha do mapa em pitch alto, em latitudes extremas e em terreno
   3D. Logo toda projeção passa pelo `transform` do MapLibre.
   → invariante em [02-MODULES.md § gis](02-MODULES.md#gis)

4. **Contagem de objetos é alta.** Uma cena de frente oriental pode ter 300
   unidades, 40 setas, 2000 partículas por explosão. Logo avaliação e render
   precisam ser O(mudança), não O(cena), e partículas precisam viver na GPU.

5. **A timeline é dado denso.** 200 layers × 30 keyframes = 6000 elementos
   visíveis. DOM não sustenta isso com scrub a 60 fps. Logo a timeline e o graph
   editor são desenhados em canvas.
   → [ADR-005](adr/ADR-005-canvas-timeline.md)

## Critério de sucesso

O projeto é bem-sucedido quando:

- Uma animação de 90 s sobre uma campanha militar é produzida do zero em menos
  de 2 horas de trabalho.
- Exportar o mesmo projeto duas vezes produz arquivos **idênticos byte a byte**.
- Um JSON escrito por um LLM, sem revisão humana, importa e roda.
- Adicionar um novo tipo de unidade não exige tocar em nada além do registro de
  tipos e dos assets.
