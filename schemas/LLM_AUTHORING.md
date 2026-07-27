# Autoria de Scene Script — Theatrum

Produza somente JSON válido no formato `theatrum-scene`, versão 1.
Os únicos campos obrigatórios na raiz são `format`, `version`, `meta` e `timeline`.
Tempo numérico significa segundos. Prefira strings como `4s`, `90f` ou `1m30s`.
Use coordenadas como `[longitude, latitude]`. Nunca invente uma cidade ambígua.
Campos desconhecidos são erro; use apenas os verbos e campos do catálogo abaixo.

## Estrutura mínima

```json
{
  "format": "theatrum-scene",
  "meta": {
    "duration": "10s",
    "fps": 60,
    "resolution": "1920x1080",
    "title": "Título da cena"
  },
  "timeline": [],
  "version": 1
}
```

## camera

### `camera.focus`

Move a câmera para um ponto.

Obrigatórios: `at`, `on`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.focus",
  "duration": "1s",
  "on": [
    0,
    0
  ]
}
```

### `camera.frame`

Enquadra vários pontos.

Obrigatórios: `at`, `on`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.frame",
  "duration": "1s",
  "on": [
    [
      0,
      0
    ],
    [
      10,
      10
    ]
  ]
}
```

### `camera.orbit`

Orbita ao redor de um ponto.

Obrigatórios: `at`, `on`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.orbit",
  "duration": "1s",
  "on": [
    0,
    0
  ]
}
```

### `camera.follow`

Segue uma unidade.

Obrigatórios: `at`, `unit`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.follow",
  "duration": "1s",
  "unit": "unit-1"
}
```

### `camera.shake`

Aplica tremor de impacto.

Obrigatórios: `at`, `intensity`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.shake",
  "duration": "1s",
  "intensity": 0.5
}
```

### `camera.reset`

Restaura o enquadramento inicial.

Obrigatórios: `at`, `duration`.

```json
{
  "at": "0s",
  "do": "camera.reset",
  "duration": "1s"
}
```

## combat

### `battle`

Cria batalha com efeitos.

Obrigatórios: `at`, `at_place`, `intensity`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "battle",
  "duration": "1s",
  "intensity": "medium"
}
```

### `bombard`

Cria bombardeio.

Obrigatórios: `at`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "bombard",
  "duration": "1s"
}
```

### `airstrike`

Cria ataque aéreo.

Obrigatórios: `at`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "airstrike",
  "duration": "1s"
}
```

### `missile.launch`

Lança míssil.

Obrigatórios: `at`, `from`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "missile.launch",
  "duration": "1s",
  "from": [
    0,
    0
  ],
  "to": [
    10,
    10
  ]
}
```

### `siege`

Cria cerco.

Obrigatórios: `at`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "siege",
  "duration": "1s"
}
```

### `amphibious.landing`

Cria desembarque.

Obrigatórios: `at`, `from`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "amphibious.landing",
  "duration": "1s",
  "from": [
    0,
    0
  ]
}
```

### `airdrop`

Lança paraquedistas.

Obrigatórios: `at`, `from`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "airdrop",
  "duration": "1s",
  "from": [
    0,
    0
  ]
}
```

### `naval.blockade`

Cria bloqueio naval.

Obrigatórios: `at`, `at_place`, `radius`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "naval.blockade",
  "duration": "1s",
  "radius": 25
}
```

## control

### `wait`

Cria um espaçador temporal.

Obrigatórios: `at`, `duration`.

```json
{
  "at": "0s",
  "do": "wait",
  "duration": "1s"
}
```

### `marker`

Cria marcador na timeline.

Obrigatórios: `at`, `label`.

```json
{
  "at": "0s",
  "do": "marker",
  "label": "Marcador"
}
```

### `group.begin`

Inicia um grupo.

Obrigatórios: `at`, `label`.

```json
{
  "at": "0s",
  "do": "group.begin",
  "label": "Marcador"
}
```

### `group.end`

Encerra um grupo.

Obrigatórios: `at`, `label`.

```json
{
  "at": "0s",
  "do": "group.end",
  "label": "Marcador"
}
```

## geography

### `area.highlight`

Destaca uma região.

Obrigatórios: `at`, `region`, `duration`.

```json
{
  "at": "0s",
  "do": "area.highlight",
  "duration": "1s",
  "region": "region-1"
}
```

### `area.transfer`

Transfere controle territorial.

Obrigatórios: `at`, `region`, `from`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "area.transfer",
  "duration": "1s",
  "from": "faction-a",
  "region": "region-1",
  "to": "faction-b"
}
```

### `frontline.set`

Desenha uma linha de frente.

Obrigatórios: `at`, `through`, `duration`.

```json
{
  "at": "0s",
  "do": "frontline.set",
  "duration": "1s",
  "through": [
    [
      0,
      0
    ],
    [
      10,
      10
    ]
  ]
}
```

### `frontline.shift`

Move uma linha de frente.

Obrigatórios: `at`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "frontline.shift",
  "duration": "1s",
  "to": [
    [
      0,
      0
    ],
    [
      10,
      10
    ]
  ]
}
```

### `border.show`

Mostra fronteiras de um dataset.

Obrigatórios: `at`, `dataset`, `duration`.

```json
{
  "at": "0s",
  "dataset": "borders.geojson",
  "do": "border.show",
  "duration": "1s"
}
```

### `encircle`

Anima um cerco.

Obrigatórios: `at`, `duration`.

```json
{
  "at": "0s",
  "do": "encircle",
  "duration": "1s"
}
```

### `supply.line`

Cria linha de suprimento.

Obrigatórios: `at`, `from`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "supply.line",
  "duration": "1s",
  "from": [
    0,
    0
  ],
  "to": [
    10,
    10
  ]
}
```

## text

### `text.title`

Mostra um título.

Obrigatórios: `at`, `text`, `duration`.

```json
{
  "at": "0s",
  "do": "text.title",
  "duration": "1s",
  "text": "Texto"
}
```

### `text.caption`

Mostra uma legenda.

Obrigatórios: `at`, `text`, `duration`.

```json
{
  "at": "0s",
  "do": "text.caption",
  "duration": "1s",
  "text": "Texto"
}
```

### `text.callout`

Mostra chamada ligada a um ponto.

Obrigatórios: `at`, `text`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "text.callout",
  "duration": "1s",
  "text": "Texto"
}
```

### `text.date`

Mostra uma data.

Obrigatórios: `at`, `date`, `duration`.

```json
{
  "at": "0s",
  "date": "1941-06-22",
  "do": "text.date",
  "duration": "1s"
}
```

### `text.counter`

Anima um contador.

Obrigatórios: `at`, `from`, `to`, `duration`.

```json
{
  "at": "0s",
  "do": "text.counter",
  "duration": "1s",
  "from": 0,
  "to": 100
}
```

### `label.place`

Rotula um lugar.

Obrigatórios: `at`, `place`, `duration`.

```json
{
  "at": "0s",
  "do": "label.place",
  "duration": "1s",
  "place": [
    0,
    0
  ]
}
```

### `arrow.draw`

Desenha uma seta.

Obrigatórios: `at`, `duration`.

```json
{
  "at": "0s",
  "do": "arrow.draw",
  "duration": "1s"
}
```

### `legend.show`

Mostra uma legenda de facções.

Obrigatórios: `at`, `items`, `duration`.

```json
{
  "at": "0s",
  "do": "legend.show",
  "duration": "1s",
  "items": [
    {
      "color": "#8b2635",
      "label": "Facção"
    }
  ]
}
```

## units

### `unit.spawn`

Faz uma unidade aparecer.

Obrigatórios: `at`, `unit`, `at_place`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "unit.spawn",
  "unit": "unit-1"
}
```

### `unit.advance`

Avança uma unidade por path ou destino.

Obrigatórios: `at`, `unit`.

```json
{
  "at": "0s",
  "do": "unit.advance",
  "unit": "unit-1"
}
```

### `unit.retreat`

Recua uma unidade.

Obrigatórios: `at`, `unit`.

```json
{
  "at": "0s",
  "do": "unit.retreat",
  "unit": "unit-1"
}
```

### `unit.patrol`

Patrulha um path.

Obrigatórios: `at`, `unit`, `along`, `duration`.

```json
{
  "along": "path-1",
  "at": "0s",
  "do": "unit.patrol",
  "duration": "1s",
  "unit": "unit-1"
}
```

### `unit.attack`

Avança e engaja um alvo.

Obrigatórios: `at`, `unit`, `target`.

```json
{
  "at": "0s",
  "do": "unit.attack",
  "target": "unit-2",
  "unit": "unit-1"
}
```

### `unit.intercept`

Traça curso de interceptação.

Obrigatórios: `at`, `unit`, `target`.

```json
{
  "at": "0s",
  "do": "unit.intercept",
  "target": "unit-2",
  "unit": "unit-1"
}
```

### `unit.dogfight`

Cria combate aéreo.

Obrigatórios: `at`, `units`, `at_place`, `duration`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "unit.dogfight",
  "duration": "1s",
  "units": [
    "unit-1",
    "unit-2"
  ]
}
```

### `unit.destroy`

Remove uma unidade.

Obrigatórios: `at`, `unit`.

```json
{
  "at": "0s",
  "do": "unit.destroy",
  "unit": "unit-1"
}
```

### `unit.split`

Divide uma unidade.

Obrigatórios: `at`, `unit`, `into`, `at_place`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "unit.split",
  "into": [
    "unit-a",
    "unit-b"
  ],
  "unit": "unit-1"
}
```

### `unit.merge`

Reúne unidades.

Obrigatórios: `at`, `units`, `into`, `at_place`.

```json
{
  "at": "0s",
  "at_place": [
    0,
    0
  ],
  "do": "unit.merge",
  "into": "unit-merged",
  "units": [
    "unit-1",
    "unit-2"
  ]
}
```
