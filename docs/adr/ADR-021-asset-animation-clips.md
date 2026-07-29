# ADR-021 — O clipe mora no asset; o tempo dele mora no documento

**Status:** proposto · **Data:** 2026-07-29 · **Revisar em:** quando entrar mistura de clipes (andar + apontar ao mesmo tempo), que é onde uma prop de tempo só deixa de bastar

## Contexto

O dono declarou um objetivo maior que o de hoje: além do palco de apresentação,
quer um **palco de voo** (aeronave em movimento, com superfícies móveis) e um
**simulador de combate por turnos** — invasão de edificação, com soldados que
andam, agacham, apontam e caem.

Os dois esbarram na mesma linha: `apps/editor/src/panels/viewport/three-assets.ts:59`
guarda apenas `gltf.scene` e **descarta `gltf.animations` e os esqueletos na porta
de entrada**. Modelo é geometria parada, por construção.

Isso já apareceu três vezes nesta sessão, cada vez com roupa diferente:

| Pedido                    | Resposta hoje                            |
| ------------------------- | ---------------------------------------- |
| Girar a torre do obuseiro | Impossível — 0 animações, 0 skins        |
| Abrir o trem de pouso     | Impossível — 0 animações, 0 skins        |
| Soldado que anda e agacha | Impossível — a animação seria descartada |

**E o descarte foi atalho, não princípio.** A regra central do projeto é que
render é função pura de `(documento, frame)`, e **amostrar um clipe de glTF no
tempo `t` é função pura**: mesma entrada, mesma pose, sempre. Não existe conflito
entre animação de asset e o export byte-idêntico provado em `verify:phase8` 7/7.

O que existe é uma armadilha na implementação, e ela decide este ADR — está na
seção Consequências.

## Alternativas

### A. Continuar descartando; animar peça separando o modelo

O dono abriria o GLB, separaria trem de pouso e torre em nós próprios, e o
Theatrum animaria a transformação de cada nó como já anima qualquer coisa.

✅ Zero mudança no carregador.
❌ Exige **Blender**, verificado ausente nesta máquina — o mesmo bloqueio do VFX
volumétrico. Transformaria "apresentar equipamento" em "aprender modelagem".
❌ Não resolve soldado: personagem precisa de **esqueleto**, não de peças soltas.

### B. Carregar os clipes; o documento diz qual e em que tempo

O asset traz as poses; o `model3d` ganha props que escolhem o clipe e o instante.

✅ Funciona com qualquer modelo já animado, sem ferramenta externa.
✅ **Uma peça resolve os três pedidos** — trem de pouso, torre e soldado são o
mesmo mecanismo.
✅ Cabe no que já existe: o tempo do clipe é prop animável como qualquer outra, com
timeline, editor de curvas e desfazer de graça.
❌ Memória: clipes e malhas com esqueleto custam mais que geometria estática.
❌ Malha com esqueleto não compartilha instância como geometria estática.

### C. Assar o clipe em keyframes do documento na importação

Converter as poses do glTF em keyframes normais, como o roteiro do palco faz.

✅ Coerente com o precedente do `studio-tour`.
❌ **Mede mal.** Um ciclo de caminhada de 2 s a 30 fps com 60 ossos dá ~3.600
keyframes por clipe, e um personagem tem dezenas de clipes. O documento inchava
para guardar dado que já está no arquivo, e o `.theatrum` deixaria de ser legível.
❌ Perde a compressão de curva que o glTF já traz.

## Decisão

**Alternativa B.** O clipe mora no asset; **qual clipe e em que tempo** mora no
documento.

O que decide é onde o dado já existe. As poses são propriedade do arquivo 3D e não
mudam por projeto; "no frame 300 o trem está aberto" é decisão de edição. Copiar as
poses para o documento seria duplicar dado imutável no lugar que versiona.

### Forma

- `three-assets.ts` passa a guardar `gltf.animations` no template, junto da cena.
- `model3d` ganha:
  - `clipName` — texto, **não animável**. Trocar de clipe no meio do vídeo é corte,
    não interpolação, e interpolar entre dois clipes é o assunto que este ADR manda
    revisar depois.
  - `clipTime` — segundos dentro do clipe, **animável**. É por ele que o trem abre
    entre o frame 100 e o 160.
  - `clipLoop` — quando ligado, `clipTime` dá a volta em vez de parar no fim.
- A camada 3D aplica a pose por `AnimationMixer.setTime(clipTime)`.

## Consequências

- **`setTime`, nunca `update(delta)`.** É a armadilha, e ela é silenciosa: o
  `update` do three avança o mixer pelo tempo decorrido de **relógio de parede**,
  acumulando estado entre chamadas. O preview pareceria certo e o export divergiria
  entre execuções — exatamente o defeito que o critério 2 da Fase 8 existe para
  pegar, e que custaria uma sessão inteira para diagnosticar. `setTime` reposiciona
  de forma absoluta e é função pura do argumento.
- **Modelo sem clipe não muda em nada.** `clipName` vazio é o padrão, e o caminho
  atual continua byte a byte onde está.
- **O `settle` do export não precisa mudar.** A pose é aplicada no mesmo passe do
  frame; não há carregamento assíncrono novo depois do GLB.
- **Malha com esqueleto pesa mais.** Skinning roda no vertex shader por instância,
  então dez soldados custam dez vezes. O limite prático deve ser **medido** antes
  de virar promessa, e o número entra no roteiro quando for.
- **Isto não resolve o acervo.** Destrava o Theatrum, não os arquivos do dono: o
  F/A-18 e o 2S19 continuam com 0 animações. Soldado animado exige **encontrar
  modelo com rig**, e isso é problema de acervo, não de código.
- **Mistura de clipes fica fora.** Andar e apontar ao mesmo tempo exige duas
  trilhas com peso, e uma prop de tempo não descreve isso. É o gatilho de revisão
  declarado no topo.

## Quando revisar

Quando o simulador de combate pedir dois clipes simultâneos no mesmo personagem.
Aí `clipTime` vira uma lista de trilhas com peso, e este ADR é emendado — não
substituído, porque a decisão de onde o clipe mora continua valendo.
