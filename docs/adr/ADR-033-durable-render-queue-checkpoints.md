# ADR-033 — A fila persiste checkpoints contíguos e retoma somente sequências

**Status:** aceito
**Data:** 2026-07-30
**Revisar em:** necessidade de retomar fluxo H.264 ou mover jobs entre máquinas

## Contexto

Exports longos precisam sobreviver a interrupção do aplicativo. Um checkpoint
não pode afirmar que um frame existe antes da escrita ter terminado, nem avançar
se o próprio estado durável não puder ser salvo.
Também não pode reaproveitar pixels depois que o documento mudou: isso misturaria
o prefixo de uma versão da cena com o restante de outra.

PNG, GIF e ProRes têm uma sequência de PNGs endereçada por índice. O MP4 direto,
por outro lado, é um fluxo fragmentado produzido pelo encoder e não possui nesta
versão um estado serializável capaz de continuar no meio.

## Alternativas

### A. Reiniciar todos os formatos

✅ Estado mínimo.

❌ Desperdiça horas de render já concluído.

### B. Salvar somente o número exibido pela barra de progresso

✅ Fácil de persistir.

❌ O número pode incluir uma amostra em andamento ou um frame cuja escrita
falhou; retomar daí cria lacuna silenciosa.

### C. Persistir o prefixo contíguo confirmado

✅ Um índice só avança depois de `writeFrame` confirmar o arquivo.

✅ O plano original conserva nomes, frames e taxa; a retomada apenas corta o
prefixo já confirmado.

✅ Falha ao persistir o checkpoint interrompe o pump e aparece no relatório.

❌ O MP4 direto precisa reiniciar do zero.

## Decisão

Adotar a alternativa C. A fila é serializada no perfil local do Electron. Jobs
que estavam `running` voltam como `paused` depois de uma nova abertura. O pump
oferece checkpoint a cada 300 frames e no fim; o callback precisa terminar com
sucesso antes de o job continuar.

Cada job guarda o fingerprint canônico do documento. Uma retomada só reutiliza
o prefixo quando o fingerprint atual coincide; caso contrário, a UI exige
reiniciar e descarta o checkpoint antes de produzir novos pixels.

Sequências PNG retomam diretamente. GIF e ProRes preservam a pasta privada de
PNGs e retomam o prefixo antes da codificação final. MP4 direto declara que não é
retomável e reinicia do frame zero.

## Consequências

- A interface distingue frames renderizados dos reaproveitados.
- Checkpoint inválido é recusado antes de `seek`, composição ou escrita.
- Alterar o documento ou remover a composição faz o job falhar sem misturar
  documentos; reiniciar atualiza o fingerprint e começa do frame zero.
- A fila é local ao perfil da máquina; não é um formato portátil de projeto.
- Arquivos únicos só recebem o nome final por renomeação depois do encoder,
  muxer e hash terminarem.

## Quando revisar

Revisar se o produto precisar retomar MP4 sem reencodar. Isso exige persistir
estado do muxer/encoder ou trocar o caminho direto por segmentos completos com
uma etapa determinística de concatenação. Revisar também antes de sincronizar
jobs entre máquinas.
