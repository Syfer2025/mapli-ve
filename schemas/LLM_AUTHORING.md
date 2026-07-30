# LLM Authoring — Scene Script v1

<!-- GERADO por tools/gen-scene-script-authoring.ts. NÃO EDITE À MÃO. -->

Escreva somente JSON válido. O compilador rejeita campos desconhecidos e
devolve todos os erros com JSON Pointer e sugestões `didYouMean`.

## Envelope mínimo

```json
{
  "format": "theatrum-scene",
  "version": 1,
  "meta": {
    "title": "Título",
    "fps": 60,
    "resolution": "1920x1080",
    "duration": "30s"
  },
  "timeline": []
}
```

Tempos aceitos: `4s`, `500ms`, `90f`, `1m30s`, `1:30`,
`00:01:30:15`, `after:id`, `after:id+2s`, `with:id` e `end-4s`.
Números puros significam segundos. Tempos relativos são permitidos em `at`;
`duration` e `delay` devem ser absolutos.

Lugares aceitam `[lng, lat]`, `{ "lng": 0, "lat": 0 }`, uma chave de
`places` ou uma consulta qualificada do gazetteer, como `"Kursk, RU"`.
Nunca invente coordenadas para resolver ambiguidade: qualifique cidade/estado/país.

## Registry de verbos

### Câmera

#### `camera.focus`

Move a câmera para um ponto.

Campos obrigatórios: `at`, `on`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `on`, `zoom`, `bearing`, `pitch`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.focus",
  "on": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `camera.frame`

Enquadra vários pontos.

Campos obrigatórios: `at`, `on`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `on`, `padding`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.frame",
  "on": [
    [
      0,
      0
    ],
    [
      10,
      10
    ]
  ],
  "duration": "1s"
}
```

#### `camera.orbit`

Orbita ao redor de um ponto.

Campos obrigatórios: `at`, `on`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `on`, `revolutions`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.orbit",
  "on": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `camera.follow`

Segue uma unidade.

Campos obrigatórios: `at`, `unit`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `damping`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.follow",
  "unit": "unit-1",
  "duration": "1s"
}
```

#### `camera.shake`

Aplica tremor de impacto.

Campos obrigatórios: `at`, `intensity`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `intensity`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.shake",
  "intensity": 0.5,
  "duration": "1s"
}
```

#### `camera.reset`

Restaura o enquadramento inicial.

Campos obrigatórios: `at`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.reset",
  "duration": "1s"
}
```

### Unidades

#### `unit.spawn`

Faz uma unidade aparecer.

Campos obrigatórios: `at`, `unit`, `at_place`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `at_place`, `fade`.

```json
{
  "at": "0s",
  "do": "unit.spawn",
  "unit": "unit-1",
  "at_place": [
    0,
    0
  ]
}
```

#### `unit.advance`

Avança uma unidade por path ou destino.

Campos obrigatórios: `at`, `unit`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `along`, `to`, `duration`, `trail`.

```json
{
  "at": "0s",
  "do": "unit.advance",
  "unit": "unit-1"
}
```

#### `unit.retreat`

Recua uma unidade.

Campos obrigatórios: `at`, `unit`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `along`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "unit.retreat",
  "unit": "unit-1"
}
```

#### `unit.patrol`

Patrulha um path.

Campos obrigatórios: `at`, `unit`, `along`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `along`, `cycles`, `duration`.

```json
{
  "at": "0s",
  "do": "unit.patrol",
  "unit": "unit-1",
  "along": "path-1",
  "duration": "1s"
}
```

#### `unit.attack`

Avança e engaja um alvo.

Campos obrigatórios: `at`, `unit`, `target`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `target`, `duration`.

```json
{
  "at": "0s",
  "do": "unit.attack",
  "unit": "unit-1",
  "target": "unit-2"
}
```

#### `unit.intercept`

Traça curso de interceptação.

Campos obrigatórios: `at`, `unit`, `target`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `target`, `duration`.

```json
{
  "at": "0s",
  "do": "unit.intercept",
  "unit": "unit-1",
  "target": "unit-2"
}
```

#### `unit.dogfight`

Cria combate aéreo.

Campos obrigatórios: `at`, `units`, `at_place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `units`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "do": "unit.dogfight",
  "units": [
    "unit-1",
    "unit-2"
  ],
  "at_place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `unit.destroy`

Remove uma unidade.

Campos obrigatórios: `at`, `unit`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `explosion`.

```json
{
  "at": "0s",
  "do": "unit.destroy",
  "unit": "unit-1"
}
```

#### `unit.split`

Divide uma unidade.

Campos obrigatórios: `at`, `unit`, `into`, `at_place`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `into`, `at_place`.

```json
{
  "at": "0s",
  "do": "unit.split",
  "unit": "unit-1",
  "into": [
    "unit-a",
    "unit-b"
  ],
  "at_place": [
    0,
    0
  ]
}
```

#### `unit.merge`

Reúne unidades.

Campos obrigatórios: `at`, `units`, `into`, `at_place`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `units`, `into`, `at_place`.

```json
{
  "at": "0s",
  "do": "unit.merge",
  "units": [
    "unit-1",
    "unit-2"
  ],
  "into": "unit-merged",
  "at_place": [
    0,
    0
  ]
}
```

### Combate

#### `battle`

Cria batalha com efeitos.

Campos obrigatórios: `at`, `at_place`, `intensity`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `at_place`, `intensity`, `duration`, `label`.

```json
{
  "at": "0s",
  "do": "battle",
  "at_place": [
    0,
    0
  ],
  "intensity": "medium",
  "duration": "1s"
}
```

#### `bombard`

Cria bombardeio.

Campos obrigatórios: `at`, `at_place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `from`, `at_place`, `count`, `duration`.

```json
{
  "at": "0s",
  "do": "bombard",
  "at_place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `airstrike`

Cria ataque aéreo.

Campos obrigatórios: `at`, `at_place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `unit`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "do": "airstrike",
  "at_place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `missile.launch`

Lança míssil.

Campos obrigatórios: `at`, `from`, `to`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `from`, `to`, `duration`, `trail`.

```json
{
  "at": "0s",
  "do": "missile.launch",
  "from": [
    0,
    0
  ],
  "to": [
    10,
    10
  ],
  "duration": "1s"
}
```

#### `siege`

Cria cerco.

Campos obrigatórios: `at`, `at_place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `at_place`, `duration`, `label`.

```json
{
  "at": "0s",
  "do": "siege",
  "at_place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `amphibious.landing`

Cria desembarque.

Campos obrigatórios: `at`, `from`, `at_place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `from`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "do": "amphibious.landing",
  "from": [
    0,
    0
  ],
  "at_place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `airdrop`

Lança paraquedistas.

Campos obrigatórios: `at`, `from`, `at_place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `from`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "do": "airdrop",
  "from": [
    0,
    0
  ],
  "at_place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `naval.blockade`

Cria bloqueio naval.

Campos obrigatórios: `at`, `at_place`, `radius`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `at_place`, `radius`, `duration`.

```json
{
  "at": "0s",
  "do": "naval.blockade",
  "at_place": [
    0,
    0
  ],
  "radius": 25,
  "duration": "1s"
}
```

### Geografia

#### `area.highlight`

Destaca uma região.

Campos obrigatórios: `at`, `region`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `region`, `faction`, `duration`, `fade`.

```json
{
  "at": "0s",
  "do": "area.highlight",
  "region": "region-1",
  "duration": "1s"
}
```

#### `area.transfer`

Transfere controle territorial.

Campos obrigatórios: `at`, `region`, `from`, `to`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `region`, `from`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "area.transfer",
  "region": "region-1",
  "from": "faction-a",
  "to": "faction-b",
  "duration": "1s"
}
```

#### `frontline.set`

Desenha uma linha de frente.

Campos obrigatórios: `at`, `through`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `through`, `duration`.

```json
{
  "at": "0s",
  "do": "frontline.set",
  "through": [
    [
      0,
      0
    ],
    [
      10,
      10
    ]
  ],
  "duration": "1s"
}
```

#### `frontline.shift`

Move uma linha de frente.

Campos obrigatórios: `at`, `to`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "frontline.shift",
  "to": [
    [
      0,
      0
    ],
    [
      10,
      10
    ]
  ],
  "duration": "1s"
}
```

#### `border.show`

Mostra fronteiras de um dataset.

Campos obrigatórios: `at`, `dataset`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `dataset`, `duration`.

```json
{
  "at": "0s",
  "do": "border.show",
  "dataset": "borders.geojson",
  "duration": "1s"
}
```

#### `encircle`

Anima um cerco.

Campos obrigatórios: `at`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `region`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "do": "encircle",
  "duration": "1s"
}
```

#### `supply.line`

Cria linha de suprimento.

Campos obrigatórios: `at`, `from`, `to`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `from`, `to`, `duration`, `flow`.

```json
{
  "at": "0s",
  "do": "supply.line",
  "from": [
    0,
    0
  ],
  "to": [
    10,
    10
  ],
  "duration": "1s"
}
```

### Texto e gráficos

#### `text.title`

Mostra um título.

Campos obrigatórios: `at`, `text`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `text`, `subtitle`, `position`, `duration`, `reveal`.

```json
{
  "at": "0s",
  "do": "text.title",
  "text": "Texto",
  "duration": "1s"
}
```

#### `text.caption`

Mostra uma legenda.

Campos obrigatórios: `at`, `text`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `text`, `position`, `duration`.

```json
{
  "at": "0s",
  "do": "text.caption",
  "text": "Texto",
  "duration": "1s"
}
```

#### `text.callout`

Mostra chamada ligada a um ponto.

Campos obrigatórios: `at`, `text`, `at_place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `text`, `at_place`, `duration`, `leader`.

```json
{
  "at": "0s",
  "do": "text.callout",
  "text": "Texto",
  "at_place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `text.date`

Mostra uma data.

Campos obrigatórios: `at`, `date`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `date`, `position`, `duration`.

```json
{
  "at": "0s",
  "do": "text.date",
  "date": "1941-06-22",
  "duration": "1s"
}
```

#### `text.counter`

Anima um contador.

Campos obrigatórios: `at`, `from`, `to`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `from`, `to`, `label`, `duration`.

```json
{
  "at": "0s",
  "do": "text.counter",
  "from": 0,
  "to": 100,
  "duration": "1s"
}
```

#### `label.place`

Rotula um lugar.

Campos obrigatórios: `at`, `place`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `place`, `duration`, `style`.

```json
{
  "at": "0s",
  "do": "label.place",
  "place": [
    0,
    0
  ],
  "duration": "1s"
}
```

#### `arrow.draw`

Desenha uma seta.

Campos obrigatórios: `at`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `along`, `from`, `to`, `duration`, `style`.

```json
{
  "at": "0s",
  "do": "arrow.draw",
  "duration": "1s"
}
```

#### `legend.show`

Mostra uma legenda de facções.

Campos obrigatórios: `at`, `items`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `items`, `position`, `duration`.

```json
{
  "at": "0s",
  "do": "legend.show",
  "items": [
    {
      "label": "Facção",
      "color": "#8b2635"
    }
  ],
  "duration": "1s"
}
```

### Controle

#### `wait`

Cria um espaçador temporal.

Campos obrigatórios: `at`, `duration`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `duration`.

```json
{
  "at": "0s",
  "do": "wait",
  "duration": "1s"
}
```

#### `marker`

Cria marcador na timeline.

Campos obrigatórios: `at`, `label`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `label`, `color`.

```json
{
  "at": "0s",
  "do": "marker",
  "label": "Marcador"
}
```

#### `group.begin`

Inicia um grupo.

Campos obrigatórios: `at`, `label`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `label`.

```json
{
  "at": "0s",
  "do": "group.begin",
  "label": "Marcador"
}
```

#### `group.end`

Encerra um grupo.

Campos obrigatórios: `at`, `label`.

Campos aceitos: `at`, `id`, `ease`, `delay`, `comment`, `label`.

```json
{
  "at": "0s",
  "do": "group.end",
  "label": "Marcador"
}
```

## Ciclo de correção

Se a compilação falhar, corrija cada item de `diagnostics`. Use `path` para
localizar o campo exato e prefira a primeira opção de `didYouMean` quando ela
corresponder à intenção. Não remova entradas corretas para esconder erros.
