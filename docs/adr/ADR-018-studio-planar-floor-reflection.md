# ADR-018 — O reflexo do piso do palco é um espelho planar derivado do frame

**Status:** aceito, condicionado à prova de orçamento · **Data:** 2026-07-28 ·
**Revisar em:** quando houver mais de um plano refletor, piso fora de `y = 0`,
preview típico 1080p acima de 16,6 ms ou frame de export 4K acima de 250 ms

## Contexto

O pedido do dono em 7F.8 foi melhorar luz, sombra e reflexos. A sombra direcional
fechou o 7F.6; o pedaço que falta é o reflexo do equipamento no piso.

O piso do palco não é geometria no mundo. `studio-grid.ts` desenha um quad de tela
cheia, sem teste nem escrita de profundidade, e cada fragmento desprojeta o raio da
câmera para descobrir onde ele cruza `y = 0`. Foi essa construção que eliminou a
borda de um plano finito, estabilizou a grade em pixel e dissolveu o horizonte.
Trocar o piso por um plano só para obter reflexão reabriria três defeitos já
medidos.

Também não existe imagem pronta para refletir:

- o canvas final não traz profundidade nem normais;
- o modelo e o piso são desenhados na mesma cena Three;
- rótulos e marcadores vivem em superfícies separadas, depois do palco;
- a sombra já prova o padrão de um passe derivado: render target próprio,
  consumidor no shader do piso, descarte explícito.

O reflexo tem de preservar os invariantes do projeto:

1. o frame continua função pura de `(documento, frame)`;
2. nenhum estado do frame anterior participa do resultado;
3. a grade infinita continua sendo o piso;
4. desligar o reflexo remove tanto o passe quanto seu custo;
5. o export captura exatamente o mesmo canvas que o preview.

## Alternativas

### A. Mancha espelhada a partir da caixa ou da silhueta

Duplicar a máscara de sombra, inverter e tingir sob o objeto.

✅ Um canal, um passe que já existe e custo pequeno.
✅ Não exige outra câmera.

❌ Não é reflexo: perde cor, material, partes iluminadas e o que fica oculto para
a luz. Repetiria o erro da primeira sombra elíptica — uma aproximação plausível
até o primeiro caça com asa, deriva e tanque externo.
❌ Uma máscara projetada pela luz não contém a vista que a câmera deveria enxergar
no espelho.

### B. Trocar o quad infinito por um plano geométrico refletor

Usar `Reflector` do Three ou um material de espelho num plano grande.

✅ Implementação conhecida e recorte oblíquo já resolvido pelo Three.
✅ Coordenadas de textura vêm do próprio plano.

❌ O plano volta a ter borda. Fazê-lo enorme reduz precisão de profundidade e não
resolve o horizonte; fazê-lo acompanhar a câmera transforma o mundo durante o
render.
❌ Reabre o cintilar que o shader atual resolveu por derivadas e filtro de
Nyquist.
❌ O `Reflector` depende de `onBeforeRender` numa malha do mundo. Nosso piso é um
passe de fundo em espaço de recorte, portanto a abstração não encaixa.

### C. Reflexo em espaço de tela a partir do frame já desenhado

Marchar no buffer de profundidade e amostrar a cor da tela, como SSR.

✅ Evita desenhar o modelo pela segunda vez.
✅ Permite rugosidade variável em tela.

❌ O palco não mantém G-buffer nem textura de profundidade amostrável. Criá-los
só para SSR é mais infraestrutura que o reflexo planar.
❌ SSR perde tudo que sai da tela e falha em ângulos rasos — exatamente onde o
reflexo do piso é mais visível.
❌ O piso é desenhado antes do modelo. Inverter a ordem ou copiar o framebuffer
criaria uma dependência circular entre piso e cena.

### D. Render target com câmera espelhada no plano do piso

Refletir posição, direção e vetor `up` da câmera em `y = 0`, recortar o lado
errado do plano por projeção oblíqua, desenhar a cena sem o grid e projetar essa
textura sobre o ponto de mundo reconstruído pelo shader atual.

✅ É um espelho planar de verdade: cor, material, iluminação e oclusão vêm do
mesmo modelo do frame.
✅ Reaproveita a máquina já provada pela sombra: render target explícito, passe
antes do frame principal, textura consumida pelo piso e `dispose`.
✅ O grid continua infinito e sem profundidade.
✅ Esconder o grid no passe impede recursão por construção.
✅ A textura é sobrescrita por completo em cada frame; não existe história.

❌ Desenha a geometria uma segunda vez em todo frame com reflexo visível. Esse é
o custo central, não um detalhe.

## Decisão

**Alternativa D.** Um `StudioReflectionProjector` próprio adapta a matemática de
`Reflector.js` ao piso em espaço de tela:

1. copia a projeção da câmera efetiva do palco;
2. espelha posição, direção e `up` no plano `y = 0`;
3. calcula a matriz de amostragem antes do recorte, e depois aplica o plano como
   near plane oblíquo para cortar geometria do lado errado sem deformar o UV;
4. oculta o grid e desenha os modelos num target RGBA transparente;
5. restaura target, clear color/alpha, XR, atualização de shadow map e visibilidade
   em `finally`;
6. entrega ao grid a textura, a matriz `bias × projection × view` e o tamanho de
   texel;
7. o shader projeta o ponto do piso nessa textura, aplica um filtro curto de
   rugosidade, Fresnel e queda por distância, e só então recoloca grade e sombra.

O target acompanha o aspecto do canvas, usa metade da resolução física e limita o
maior lado a 1.024 px. É uma escolha reversível para conter o segundo passe; o
critério ao vivo registra a resolução efetiva e o custo observado. Não há cache
por pose: câmera, modelo, material, luz e animação podem mudar a cada frame, e uma
assinatura incompleta produziria reflexo atrasado com aparência plausível.

`studio.stage` ganha `reflectionStrength`, animável e limitada a `0..1`. Zero
desliga o passe, não apenas a mistura no shader. Nó antigo sem a prop usa fallback
zero e abre pixel-idêntico; o padrão de nó novo é discreto, para assentar o objeto
sem transformar a vitrine em espelho.

## Consequências

- **Custo aceito:** com reflexo ativo há duas renderizações coloridas da geometria
  (espelho e frame principal), além da máscara de sombra quando ligada. A
  resolução reduzida, o teto de 1.024 px e o caminho de força zero são as
  mitigações. Se a medição ultrapassar o orçamento, reduz-se resolução ou
  frequência; não se afrouxa a prova.
- **Uma reflexão, um plano.** Só `y = 0` reflete. Plataforma elevada, parede
  espelhada ou vários pisos disparam revisão.
- **Um único bounce.** O grid fica oculto no target, então o reflexo não reflete
  a si mesmo, a grade nem a sombra projetada. Isso evita recursão e mantém a
  leitura: reflexo mostra o equipamento; sombra continua sendo contato com o
  piso.
- **Chrome não reflete.** Marcadores 2D, callouts Pixi e controles continuam fora,
  porque não são objetos físicos da cena e já são excluídos do export quando
  apropriado.
- **Rugosidade é aproximação em tela.** O filtro curto não é BRDF microfacet nem
  reflexão ray traced. É suficiente para um piso de apresentação; pedido de
  materiais de piso diferentes dispara revisão.
- **Geometria sob o piso é cortada.** O clip oblíquo evita refletir a metade
  enterrada do modelo. Câmera no lado de baixo do piso desliga o passe, pois não
  existe superfície refletora visível nessa configuração.
- **Determinismo preservado.** Target, câmera espelhada e mistura são derivados do
  frame corrente. Tamanho vem apenas do canvas capturado, como o restante do
  palco; não há relógio, aleatoriedade nem acumulação temporal.
- **O precedente da sombra é ciclo de vida, não código para copiar literalmente.**
  O projetor atual não restaura `clearColor`/alfa e não protege toda a mutação em
  `finally`. Este bloco corrige essa fuga antes de adicionar o segundo passe
  offscreen; target, override, viewport, scissor e visibilidade sempre voltam ao
  estado de entrada, inclusive quando o render lança.

## Prova

### Unidade

- câmera e direção são o espelho exato em `y = 0`;
- um ponto do próprio piso cai nas mesmas coordenadas de tela na câmera real e na
  câmera espelhada;
- a projeção oblíqua permanece finita e corta o lado errado;
- o tamanho do target preserva aspecto, respeita DPR, escala de 50% e teto de
  1.024 px.

### Electron real

O critério 13 do `verify:phase7e3` faz um A/B no mesmo frame:

1. zera sombra, textura e grade para isolar o sinal;
2. captura o modelo com `reflectionStrength = 0` e `1`;
3. exige tinta nova apenas na região do piso, abaixo da base projetada;
4. oculta o modelo e exige que ligar o reflexo sozinho não tinja o piso — prova
   contra um brilho genérico ou target velho;
5. restaura o modelo e visita o mesmo frame novamente, exigindo pixels idênticos;
6. registra tamanho do target e número de passes.

Depois, `verify:phase8` e `verify:phase8-video` continuam verdes para provar que o
novo passe não contaminou determinismo, composição nem arquivo.

A prova registra o custo com reflexo desligado/ligado. O limite de aceitação vem
de `docs/06-RENDER-PIPELINE.md`: menos de 16,6 ms no preview típico 1080p e menos
de 250 ms por frame de export 4K. Nesta máquina a resolução de export ainda
acompanha a janela; a medição 4K fica obrigatória quando o gatilho do ADR-013
abrir a janela de render dedicada, em vez de ser inventada por extrapolação.
