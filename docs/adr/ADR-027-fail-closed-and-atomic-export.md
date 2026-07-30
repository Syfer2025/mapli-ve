# ADR-027 — Export falha fechado e publica arquivos únicos atomicamente

- Status: aceito
- Data: 2026-07-30
- Escopo: pump de frames, MP4, GIF e ProRes 4444

## Contexto

O `settle` informa que mapa, assets, superfícies e frame observado convergiram.
Antes desta decisão, atingir o timeout incrementava `settleFailed`, mas o pump
ainda compunha e escrevia o que estivesse visível. Assim um PMTiles indisponível,
uma câmera presa ou uma superfície atrasada podiam produzir um arquivo plausível
e incompleto. A velocidade da máquina decidia quais pixels entravam no quadro.

Arquivos únicos tinham um segundo risco. O MP4 era anexado diretamente ao nome
final, e o FFmpeg recebia diretamente o nome final de GIF/MOV. Cancelamento,
falha do codec ou falta de disco deixavam um arquivo parcial com o mesmo nome que
um resultado concluído.

## Decisão

### Política de settle

O pump recebe uma política explícita:

- `fail` — padrão e única escolha dos exports finais. No primeiro timeout, registra
  frame, amostra e causa, não chama `compose` para aquela amostra, não chama
  `writeFrame` para aquele frame e encerra o pump como falha de settle;
- `continue` — opção deliberada de diagnóstico. Captura o quadro mesmo assim,
  preservando os contadores e traces de falha. Nunca é inferida por ausência.

As causas registradas são `map-busy`, `assets-busy`, `surfaces-busy`,
`frame-mismatch` e `repaint-timeout`. A distinção permite dizer se um PMTiles
continuou pendente ou se o overlay simplesmente não apresentou o frame pedido.

### Publicação de arquivo único

MP4, GIF e ProRes escrevem primeiro para um arquivo reservado
`.theatrum-<id>-<nome-final>` no mesmo diretório do resultado. O nome final só é
publicado depois de todas as etapas:

1. todos os frames passaram por settle;
2. encoder/muxer foi drenado;
3. todas as escritas enfileiradas terminaram;
4. o arquivo temporário foi renomeado para o nome final.

O `rename` ocorre no mesmo sistema de arquivos. Portanto a aparição do nome final
é atômica: consumidores não observam um prefixo parcial do arquivo novo.

### Cancelamento e falha

| Situação                           | Arquivo final novo | Temporário de vídeo                                                          | PNGs de staging                      |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------------------- | ------------------------------------ |
| settle falha / usuário cancela MP4 | não aparece        | removido; preservado somente se a remoção falhar, com caminho no diagnóstico | não se aplica                        |
| FFmpeg falha                       | não aparece        | removido; falha de remoção é diagnosticada                                   | preservados para inspeção/reexecução |
| publicação falha                   | não substituído    | preservado e seu caminho é informado                                         | preservados para GIF/ProRes          |
| sucesso                            | aparece por rename | consumido pelo rename                                                        | removidos                            |

Um append já enviado pelo renderer não pode ressuscitar o temporário depois do
cancelamento: a sessão de WebCodecs fecha o codec e espera a cadeia de escritas
antes de pedir a remoção ao processo principal.

## Consequências

- Um job pode terminar com PNGs válidos anteriores ao frame que falhou; nunca
  grava o frame contaminado. Arquivos únicos não são publicados em jobs parciais.
- O nome final deixa de ser um indicador ambíguo: se o arquivo novo existe, sua
  finalização terminou.
- Temporários usam UUID e não afetam os bytes do resultado publicado.
- `continue` preserva uma ferramenta útil de diagnóstico sem ser o padrão
  perigoso do produto.

## Provas

- `run-export.test.ts` mantém `mapBusy` preso além do orçamento e prova:
  política padrão `fail`, causa `map-busy`, zero chamadas a `writeFrame` e zero
  frames escritos;
- o mesmo teste pede `continue` explicitamente e prova o comportamento de
  diagnóstico;
- `export-publication.test.ts` prova publicação por rename, descarte de parcial,
  preservação diagnosticada quando o rename falha e rejeição de nomes fora da
  reserva;
- `export-writer.test.ts` prova o caminho MP4 append temporário → publicação, e
  `ffmpeg-export.test.ts` prova que GIF/ProRes não ganham o nome final antes do
  último passe e que uma falha do codec remove o vídeo parcial.

## Fora de escopo

Fila persistente, checkpoint entre frames e retomada depois de reiniciar o
aplicativo exigem identidade imutável do snapshot, manifesto de hashes e
revalidação de assets. Elas serão uma decisão separada; não são simuladas por
reutilizar uma pasta parcial.
