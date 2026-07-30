# ADR-026 — Vista do mapa é estado do documento

**Status:** aceito · **Data:** 2026-07-30 · **Revisar em:** quando uma composição
precisar de mais de uma vista simultânea do mapa

## Contexto

A composição já possui duas estruturas canônicas para descrever o mapa:
`composition.map.styleId` e `composition.camera`. Apesar disso, o viewport ainda
mantém estilo, câmera, tempo e reprodução próprios. Uma trilha demonstrativa
Varsóvia–Leningrado é aplicada diretamente ao MapLibre, fora do documento.

Isso cria três resultados possíveis para o mesmo projeto: o que foi salvo, o que
o viewport mostra e o que o export captura. Trocar para satélite, navegar, fechar
e reabrir pode perder a vista. Um basemap regional ausente ainda é substituído
visualmente por outro estilo sem deixar claro que o documento continua apontando
para o recurso indisponível.

As restrições são:

- toda alteração persistente passa pelo Command Bus, com undo/redo;
- câmera é animável e deve ser avaliada no playhead, inclusive em subframes de
  export;
- aplicar uma câmera do documento no MapLibre produz eventos de movimento, que
  não podem voltar ao documento como um novo comando;
- pacotes detalhados e imagens de satélite são recursos locais opcionais. A
  ausência não autoriza reescrever o projeto;
- preview e export usam as mesmas superfícies vivas.

## Alternativas

### A. Manter o viewport como preferência local e copiar seu estado ao salvar

✅ Exige pouca mudança no componente atual.

❌ Salvar passa a ter um efeito colateral especial e fácil de esquecer em
autosave, Save As, recuperação e export.

❌ O estado continua divergindo durante toda a sessão, inclusive no instante em
que o export captura um frame.

### B. Persistir somente o estilo e deixar a câmera demonstrativa/local

✅ Resolve a escolha entre vetorial, detalhado e satélite.

❌ O enquadramento ainda muda entre abertura, reprodução e export; é justamente a
parte animável da vista.

### C. Documento como única verdade; viewport como adaptador

✅ A avaliação de `composition.camera` no playhead serve igualmente a scrub,
playback e export.

✅ Estilo e gestos passam pelo histórico existente, portanto salvar, autosave,
undo e redo funcionam sem caminho paralelo.

✅ Um recurso local ausente pode ser mostrado como indisponível sem alterar o
arquivo silenciosamente.

❌ Um gesto contínuo do MapLibre precisa ser consolidado em comando no fim do
gesto, e movimentos programáticos precisam de uma trava contra realimentação.

❌ Abrir um projeto que referencia um pacote ausente não reproduz os mesmos
pixels naquela máquina. O erro, porém, fica explícito e o documento permanece
íntegro para voltar a reproduzir quando o pacote reaparecer.

## Decisão

**Alternativa C.** `composition.map.styleId` e a câmera avaliada de
`composition.camera` são a única verdade da vista do mapa.

O viewport:

1. lê a composição selecionada e o playhead da sessão;
2. resolve o estilo persistido para um recurso local concreto;
3. aplica a câmera avaliada ao MapLibre com movimento instantâneo;
4. consolida cada gesto de usuário em uma transação do Command Bus;
5. ignora eventos de movimento causados pela própria sincronização;
6. mostra um fallback visual explícito quando o estilo persistido não está
   disponível, sem emitir comando e sem trocar o valor no documento.

A troca manual de estilo grava `composition.map.styleId`. Enquadramentos
automáticos disparados por seleção de basemap ou busca também terminam como gesto
de câmera e são gravados. A trilha demonstrativa deixa de participar do runtime.
Os controles de transporte usam a sessão compartilhada.

## Consequências

- Salvar e reabrir preserva estilo e câmera; undo/redo cobre ambos.
- Scrub, playback e amostras fracionárias de motion blur aplicam a mesma câmera
  que o avaliador entrega ao overlay.
- O export continua capturando o viewport vivo, mas agora esse viewport é
  derivado do mesmo documento e playhead usados pelo restante do frame.
- Uma interação de câmera grava os quatro valores controlados pelo mapa como uma única entrada
  de histórico. Se já houver keyframes, o gesto grava keyframes no playhead em
  vez de apagar a animação.
- Durante um gesto, o MapLibre é responsivo e o documento só muda em `moveend`;
  uma falha antes desse evento deixa a última pose persistida.
- Um pacote ausente usa o mapa mundial escuro como substituto apenas visual. A
  barra de estado identifica o `styleId` ausente e o seletor mantém uma opção
  marcada como indisponível.

## Quando revisar

Revisar quando uma única composição precisar mostrar duas vistas simultâneas do
mapa, pois `composition.camera` deixará de identificar uma câmera única.
