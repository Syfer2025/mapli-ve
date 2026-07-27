# ADR-004 — Frame inteiro como unidade canônica de tempo

**Status:** aceito · **Data:** 2026-07-26 · **Revisar:** nunca

## Contexto

Tempo pode ser representado em segundos (`number`, contínuo), em frames (`number`,
discreto), ou em timecode (string). Precisamos escolher **um** para persistência e
para toda a lógica interna.

## Decisão

**Frames inteiros.** Segundos são apresentação e entrada; nunca armazenamento de
tempo de keyframe.

```ts
type Frame = number & { readonly __unit: "frame" };
type Seconds = number & { readonly __unit: "seconds" };
```

## Alternativas

### Segundos como canônico

- ✅ Independente de fps; mudar a fps preserva o tempo automaticamente
- ❌ **Um keyframe em 1.0166666666666666 s não cai exatamente no frame 61 a 60 fps.**
  Erro de ponto flutuante acumula: um keyframe que deveria coincidir com o corte
  fica 1 frame antes ou depois. Em vídeo isso é visível.
- ❌ Comparar dois tempos exige epsilon. `kf.time === playhead` nunca é confiável.
- ❌ "Este keyframe está no frame atual?" — a pergunta mais frequente do editor —
  fica ambígua.
- ❌ Snap de keyframe a frame exige arredondamento em toda leitura.

### Timecode como canônico

- ❌ Aritmética em string. Cada operação precisa parse e format.
- ❌ Drop-frame (29,97) transforma soma em caso especial.

### Racional (numerador/denominador)

- ✅ Exato
- ❌ Complexidade desproporcional; JSON verboso; ilegível para humano e para LLM

## Consequências

Positivas:

- Igualdade exata: `kf.frame === playhead` funciona sem epsilon.
- Snap grátis — não existe estado "entre frames" a corrigir.
- JSON legível: `"frame": 90`.
- Sem acúmulo de erro de ponto flutuante em nenhuma operação de tempo.
- Comparação, ordenação e busca binária de keyframes são triviais e exatas.

Negativas aceitas:

- Mudar a fps de uma composição exige decisão explícita. Duas opções na UI:
  - **Remapear** — preserva o tempo em segundos, recalcula os frames
  - **Reinterpretar** — preserva os números dos frames, muda a duração
    Nunca implícito. Um diálogo aparece.
- Um asset importado a 24 fps numa composição de 60 fps precisa de remapeamento
  explícito. Correto — o comportamento silencioso seria pior.

## Exceção documentada

**Motion blur** amostra frames fracionários (`f ± 0.25`). Portanto:

```ts
function evaluate(doc: ProjectDocument, compId: string, frame: number): EvaluatedScene;
//                                                            ^^^^^^ number, não Frame
```

Frames fracionários são válidos na **avaliação** e nunca em **persistência**.
Nenhum keyframe é gravado com frame fracionário.

## Entrada do usuário e de IA

O parser aceita tudo e converte na entrada:

```
"90" → 90 frames        "1.5s" → 90 @60fps       "1m30s" → 5400 @60fps
"90f" → 90 frames       "0:01.5" → 90 @60fps     "00:00:01:30" → 90 @60fps
```

Regra de arredondamento: **half-up**. `"1.008s"` a 60 fps = frame 60,48 → 60.
Documentada, testada, e o Scene Script emite `warning` quando o arredondamento
desloca o tempo em mais de meio frame.
