# ADR-025 — Motion blur por acumulação de subframes no compositor

**Status:** aceito · **Data:** 2026-07-29 · **Revisar em:** quando o custo por
frame passar do orçamento de 250 ms em 4K, ou quando o mapa precisar borrar junto

## Contexto

O motion blur é o que mais separa "parece jogo" de "parece filmado", e é
pré-requisito declarado do palco de voo em
[11-VISAO-FUTURA § 2](../11-VISAO-FUTURA.md) — a estimativa de realismo lá é 6 de
10 **por falta dele**.

O desenho já está no roteiro, em
[06-RENDER-PIPELINE § 9](../06-RENDER-PIPELINE.md#9-motion-blur): N subframes por
frame, acumulados e divididos por N. E a fundação também já existe, o que torna
esta decisão pequena em código e grande em consequência:

- `evaluate(doc, id, frame: number)` aceita **frame fracionário** de propósito. O
  [ADR-004](ADR-004-time-in-frames.md) escolheu frame inteiro como unidade
  canônica e abriu essa exceção nomeando o motivo: motion blur.
- `subframe()` em `core-time` já marca um valor sem arredondar, e tem teste
  (`subframe(59.5)` não é inteiro).
- `exactFrames` já existe com um teste que diz, em voz alta, "base do motion blur
  subframe".

O que **não** existe é onde acumular. E é aí que está a decisão.

Uma restrição que o roteiro já declarou e que continua valendo: **o mapa base não
borra.** O MapLibre renderiza um estado por vez, e pedir N estados por frame dele
seria N carregamentos de tile por frame. Blur de câmera sobre o mapa é outro
problema — pós-processo direcional por vetor de velocidade — e não entra aqui.

## Alternativas

### A. Acumular no compositor, em canvas 2D, sobre as superfícies compostas

O `FrameComposer` já lê as três superfícies e compõe num canvas 2D reaproveitado.
Acumular seria: para cada subframe, mover o playhead, esperar `settle`, compor, e
somar num acumulador; ao fim, dividir por N.

✅ **Reaproveita o caminho inteiro que já é byte-idêntico**: pump, `settle`,
detecção de modo, `EXCLUDED_SURFACE_SELECTORS`. Nada de novo entre o documento e
os pixels.
✅ Funciona igual no mapa, no palco e no overlay, porque age depois deles.
✅ O acumulador é aritmética nossa — determinístico por construção, a mesma
propriedade que o [ADR-024](ADR-024-deterministic-supersampling.md) escolheu.
❌ **Custo N× no `settle`, não só no render.** O pump espera quietude a cada
subframe, e o `settle` é a parte cara: p99 medido de 77 a 112 ms. Oito subframes
por frame significam oito esperas.
❌ O mapa é re-renderizado N vezes por frame sem borrar nada útil — ele desenha o
mesmo estado quando só a cena 3D se move, e ainda assim paga o `settle`.
❌ Acumular em `Uint8ClampedArray` perde precisão; exige um acumulador em
`Float32Array` do tamanho do frame (8,29 MP × 4 canais × 4 bytes = **132 MB** em
4K).

### B. Acumular em render target de ponto flutuante, dentro de cada renderer

Cada superfície acumula os próprios subframes num alvo RGBA16F e entrega o
resultado já resolvido.

✅ Precisão e velocidade: a soma acontece na GPU, sem readback por subframe.
✅ O palco já tem alvo RGBA16F linear e o `finally` que restaura estado, do
[ADR-018](ADR-018-studio-planar-floor-reflection.md) — a máquina existe.
❌ **Cada superfície precisa da própria implementação**, e o mapa não pode ter uma.
Isso deixa o frame com blur no palco e sem blur no overlay, o que é pior que não
ter blur: as bordas discordam entre si.
❌ Duplica a política de acumulação em dois renderers, com duas verdades sobre o
que é um subframe.

### C. Blur direcional por vetor de velocidade, pós-processo

Um passe só, que borra na direção do movimento estimado por diferença de posição
entre frames vizinhos.

✅ Custo de um passe, não de N.
✅ É o que jogos fazem, e funciona para movimento de câmera.
❌ **Não é o efeito pedido.** Ele borra pela velocidade do centro do objeto e erra
rotação, deformação e oclusão — a hélice girando fica nítida, que é o caso em que
o olho mais espera borrão.
❌ Exige buffer de velocidade por pixel para acertar, e aí deixa de ser barato.

### D. Não fazer, e usar taxa de amostragem alta com redução temporal

Exportar a 240 fps e mesclar de quatro em quatro.

✅ Nenhum código novo no render.
✅ Determinístico.
❌ É a alternativa A com outro nome, e sem controle de ângulo de obturador.
❌ Quatro vezes o trabalho do pump, com quatro vezes o disco quando a etapa
intermediária é PNG.

## Decisão

**Alternativa A — acumulação no compositor — com três limites escritos desde
já.**

1. **Só em export.** Nunca no preview, como o roteiro já manda. O preview mostra o
   frame instantâneo, e a barra de estado diz que há blur no arquivo.
2. **O acumulador é `Float32Array`**, alocado uma vez por job e reaproveitado
   entre frames, pela mesma razão que o canvas do `FrameComposer` é reaproveitado:
   um alvo novo por frame é o caminho para o navegador começar a descartar o que
   ainda está em uso.
3. **`settle` por subframe é obrigatório e é o custo.** Afrouxá-lo para "esperar
   menos porque é só um subframe" é exatamente o erro que este projeto não comete
   — um subframe capturado cedo entra na média e contamina o frame inteiro.

Os parâmetros são do **job**, como a escala e o `outputFps`: `shutterAngle` em
graus (180° é o padrão de cinema, meia exposição) e `samples`. O intervalo
amostrado é `f ± (shutterAngle / 360) / 2`, em unidades de frame. A integração
usa o ponto médio de N estratos uniformes:

```text
exposure = shutterAngle / 360
sample(i) = f - exposure/2 + exposure × (i + 0,5) / N
```

Cada resultado vai para `subframe()` **sem arredondar**. Ponto médio, e não as
duas pontas inclusivas, evita dar peso inteiro às extremidades de uma integral
em que cada amostra representa uma faixa de tempo.

O contrato que fecha os demais graus de liberdade é:

1. **Bordas:** a amostra é limitada a `0 … durationFrames - 1`, os limites da
   composição — não ao trecho escolhido para exportar. Um trecho pode, portanto,
   receber luz temporal dos frames vizinhos que existem no documento; só o começo
   e o fim reais repetem a pose da borda.
2. **Cor e alfa:** a acumulação acontece nos bytes RGBA8 sRGB que o compositor
   entrega, em alfa pré-multiplicado. Os três canais guardam `canal × alfa` e o
   quarto guarda alfa; a resolução desfaz a pré-multiplicação e arredonda half-up.
   Um pixel totalmente transparente resolve para `[0,0,0,0]`. Isto evita halos de
   RGB invisível em PNG/ProRes com alfa. Não é integração fotometricamente linear;
   essa é uma consequência aceita em troca de repetir os mesmos bytes em todas as
   plataformas.
3. **Supersampling:** cada subframe percorre primeiro a composição e o box
   determinístico do ADR-024. A acumulação temporal recebe a resolução **final**.
   Assim, em UHD 3840×2160, o acumulador continua em 132 MB no tamanho final, em
   vez de 528 MB com SS 2×, e nenhum kernel do navegador entra entre as duas
   etapas.
4. **Desligado por padrão:** ausência de configuração equivale a
   `samples: 1, shutterAngle: 180`. Os valores admitidos são 0–360° e 1–64
   amostras inteiras. `samples: 1` ou ângulo 0 contorna inteiramente o acumulador;
   não é uma média de uma amostra disfarçada.
5. **Cancelamento:** o pump consulta cancelamento antes de cada subframe. Um frame
   parcialmente acumulado é descartado e nunca chega ao escritor.
6. **Estado visível:** depois de acumular, o playhead volta ao frame inteiro
   planejado. O relatório conta amostras realmente assentadas, frames resolvidos,
   alocações e bytes do acumulador; isto torna detectável a falsa implementação
   que pede oito amostras e captura oito vezes o mesmo frame inteiro.
7. **Modo fixo:** a primeira pilha composta do job — mapa ou palco — fica fixada.
   Trocar de aba no meio de uma exposição falha aquele frame em vez de misturar
   superfícies de dois painéis num único arquivo plausível.
8. **Taxa de saída:** o centro continua sendo o frame inteiro que `planExport`
   escolheu. Se uma taxa de saída maior repetir esse frame, repete também a mesma
   exposição. Preservar o instante cru entre dois frames e escalar a janela pela
   razão de taxas seria outro contrato e não entra nesta implementação.

## Consequências

- **O tempo de export multiplica por N**, e N vezes o `settle` é o termo dominante:
  com p99 de 100 ms, oito subframes são ~800 ms por frame só de espera. Um trecho
  de 300 frames sai de 30 s para 4 minutos. Isto tem de aparecer na estimativa do
  painel de fila **antes** de o usuário apertar Exportar, senão o job parece
  travado.
- **Memória de 132 MB em UHD 3840×2160** para o `Float32Array`, mais 33 MB do
  destino RGBA8. O teto atual é por eixo, não por área: uma composição
  4096×4096 é válida e chega a 256 MiB float + 64 MiB RGBA8 = **320 MiB** só
  nesses dois buffers. É a razão de ambos serem reaproveitados entre frames e de
  o relatório expor os bytes realmente alocados.
- **O mapa não ganha um caminho de blur próprio.** Com câmera estática, as N
  leituras do fundo são os mesmos pixels e ele fica nítido enquanto o objeto se
  move. Como a alternativa A lê o composto final, uma troca de estado do MapLibre
  dentro da janela do obturador também entraria na média; câmera rápida continua
  fora do caso suportado e é o gatilho para a alternativa C, com ADR próprio.
- **O verificador precisa de critério**, e ele tem duas metades: duas execuções com
  blur dão arquivos idênticos, **e** um objeto em movimento com blur produz frame
  diferente do mesmo objeto sem blur. A segunda existe porque a primeira passa
  sozinha quando o blur não faz nada — é a falsa aprovação que o critério 10 do
  `verify:phase7e3` já pagou uma vez.
- **`shutterAngle: 0` ou `samples: 1` desliga**, e o caminho tem de sair
  **byte-idêntico** ao de hoje. Sem isso, ligar o recurso muda todo export
  existente, e a Fase 8 perde a comparação com o que já foi provado.

## Quando revisar

1. Se o custo por frame com blur passar de 250 ms em 4K — o orçamento de
   [06-RENDER-PIPELINE § 10](../06-RENDER-PIPELINE.md#10-orçamentos-de-performance).
   A saída provável é reduzir `samples` por padrão, não afrouxar o `settle`.
2. Quando alguém animar a câmera do **mapa** depressa e reclamar de nitidez errada:
   aí a alternativa C entra, com medição e ADR próprio.
3. Se os 320 MiB do pior caso 4096×4096 estourarem memória numa máquina
   suportada. Nesse caso a revisão é adicionar um teto explícito de área ao job,
   não alocar por faixa nem reduzir silenciosamente (ver ADR-022).

## Nota de implementação

Pendente nesta revisão do ADR. A aceitação acima precede a mudança de código; ao
ligar o pump, esta seção recebe os arquivos, contadores e resultados medidos.
