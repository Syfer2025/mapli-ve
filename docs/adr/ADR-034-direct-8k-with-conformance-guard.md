# ADR-034 — 8K usa superfície direta com guarda de conformidade

**Status:** aceito
**Data:** 2026-07-30
**Revisar em:** pedido acima de 8192 px por eixo ou falha recorrente em GPUs suportadas

## Contexto

O plano de export já conduz mapa, Pixi e Three pelo tamanho da composição e pela
escala do job. O teto anterior de 4096 px por eixo recusava UHD-2
`7680×4320`, embora a construção atual do MapLibre e GPUs compatíveis possam
alcançar 8192 px.

Reduzir silenciosamente o backing store é inaceitável: um job pedido em 8K não
pode terminar em 4K com aparência plausível.

## Alternativas

### A. Manter o teto de 4096 px

✅ É conservador para hardware antigo.

❌ Torna o critério de 8K impossível mesmo quando a GPU o suporta.

### B. Aumentar o teto para 8192 px e medir as superfícies reais

✅ Cobre `7680×4320` diretamente e mantém um único enquadramento do MapLibre.

✅ A guarda já existente compara o tamanho físico de cada superfície antes do
primeiro frame.

❌ A opção aparecer na interface mesmo em uma máquina cuja GPU não consiga
alocar a superfície; nesse caso o job é recusado com diagnóstico.

### C. Renderizar o mapa em ladrilhos

✅ Pode ultrapassar o limite de textura da GPU.

❌ A colocação de rótulos do MapLibre depende do viewport; ladrilhos podem
duplicar ou omitir rótulos nas costuras.

## Decisão

Adotar a alternativa B. `DEFAULT_MAX_DIMENSION` e `maxCanvasSize` compartilham o
teto de 8192 px. A interface oferece escala 4×, suficiente para 8K numa
composição HD. Antes de compor, mapa, Pixi e Three precisam confirmar exatamente
o backing solicitado; ausência de conformidade falha o job em vez de reduzir a
resolução.

Supersampling continua multiplicando o tamanho físico. Portanto, 8K com SS2
ultrapassa o teto e é recusado por construção.

## Consequências

- UHD-2 direto entra no plano e conserva a mesma câmera e o mesmo layout.
- Hardware abaixo do teto recebe erro nomeando a superfície que não convergiu.
- Nenhum fallback muda a resolução ou o enquadramento silenciosamente.
- A pressão de memória cresce quadraticamente. Só a acumulação de motion blur
  em `7680×4320` consome cerca de 506 MiB em `Float32`, além do frame RGBA e das
  superfícies do mapa/overlay; 8K não implica que todo hardware suportará todas
  as combinações de efeitos e amostragem.
- Saídas maiores que 8192 px por eixo continuam fora do caminho direto.

## Quando revisar

Revisar se as GPUs oficialmente suportadas recusarem 8K de forma recorrente ou
quando houver demanda por saída acima de 8192 px. Uma solução em ladrilhos só
pode entrar depois de provar continuidade e colocação de rótulos do mapa.
