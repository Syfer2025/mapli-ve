# ADR-008 — Mapa plano de nós em vez de árvore aninhada

**Status:** aceito · **Data:** 2026-07-26 · **Revisar:** improvável

## Contexto

O scene graph é hierárquico: grupos contêm nós, nós têm pais, a ordem de desenho
segue a árvore. Duas formas de representar isso em JSON.

### Aninhada (intuitiva)

```json
{
  "id": "nd_root",
  "type": "group",
  "children": [
    { "id": "nd_group1", "type": "group", "children": [{ "id": "nd_tank", "type": "unit.armor" }] }
  ]
}
```

### Plana com referências (escolhida)

```json
{
  "root": "nd_root",
  "nodes": {
    "nd_root": { "id": "nd_root", "parent": null, "children": ["nd_group1"] },
    "nd_group1": { "id": "nd_group1", "parent": "nd_root", "children": ["nd_tank"] },
    "nd_tank": { "id": "nd_tank", "parent": "nd_group1", "children": [] }
  }
}
```

## Decisão

**Mapa plano**, com `parent` e `children[]` redundantes para navegação nos dois
sentidos.

## Justificativa

### 1. Caminhos de JSON Patch estáveis

O histórico de undo usa JSON Patch. Com árvore aninhada:

```
/compositions/0/nodes/2/children/1/children/0/transform/position
```

Esse caminho **muda** se qualquer irmão anterior for inserido ou removido. Um
patch gravado no histórico pode passar a apontar para outro nó. Undo aplicado numa
árvore alterada corrompe o documento silenciosamente — o pior tipo de bug.

Com mapa plano:

```
/compositions/0/nodes/nd_tank/transform/position
```

Estável para sempre. Nenhuma operação em outro nó afeta este caminho.

Este argumento sozinho decide a questão.

### 2. Acesso O(1)

`nodes[id]` é imediato. Numa árvore, encontrar um nó por ID exige percurso —
e o editor faz isso constantemente: seleção, hit-test, inspector, timeline,
resolução de parentesco.

### 3. Reparentar é O(1)

Mover um nó entre grupos:

```ts
old.children.splice(idx, 1);
node.parent = newParentId;
newParent.children.splice(pos, 0, nodeId);
```

Três operações locais. Na árvore aninhada seria remover uma subárvore inteira,
inseri-la em outro lugar, e gerar patches que descrevem a movimentação de todos
os descendentes.

### 4. Patches pequenos

Mudar a opacidade de um nó gera um patch de um caminho. Na árvore aninhada, o
Immer pode produzir patches maiores por causa do compartilhamento estrutural ao
longo do caminho da raiz até o nó.

### 5. Ciclos são detectáveis

Com `parent` explícito, verificar ciclo é seguir a cadeia até `null`. Numa árvore
aninhada um ciclo é estruturalmente impossível de representar — o que parece
vantagem, mas na prática significa que uma operação de reparent inválida produz
uma árvore duplicada em vez de um erro detectável.

## Consequências

Positivas: as cinco acima.

Negativas e mitigações:

| Custo                                                        | Mitigação                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parent` e `children` podem divergir                         | Invariante validado; reparo automático reconstrói `children` a partir de `parent` ([04 § 5](../04-PROJECT-FORMAT.md#reparos-automáticos-permitidos)) |
| Menos legível para humano no JSON bruto                      | `select.descendants()` e a árvore da UI resolvem; o JSON é para máquina                                                                              |
| Percorrer a árvore exige lookup                              | `topologicalOrder()` memoizado por composição, invalidado por patch de hierarquia                                                                    |
| Não é possível copiar uma subárvore com um `structuredClone` | `extractSubtree(id)` / `insertSubtree()` no `scene-graph`, com remapeamento de IDs                                                                   |

A redundância `parent` + `children` é deliberada: `parent` dá navegação para cima
em O(1) e `children` dá a **ordem de desenho**, que a relação de pai sozinha não
expressa. A ordem é informação real e precisa estar em algum lugar.

## Precedente

Este é o modelo de: Figma (mapa de nós com IDs), Blender (coleções com
referências), Lottie/Bodymovin (`layers[]` plano com `ind`/`parent`), e do próprio
formato de projeto do After Effects. Editores de árvore aninhada — como a maioria
dos editores de SVG — não têm histórico baseado em patch nem seleção em grafo
grande, e por isso não sofrem o problema.

## Nota sobre a ordem em `children[]`

Índice 0 desenha **primeiro** (fica mais atrás). É o oposto da timeline do After
Effects, onde a camada de cima é a primeira da lista e desenha por último.

A UI inverte na apresentação; o dado segue a convenção de desenho, que é a que
importa para o renderer. Registrado aqui porque é exatamente o tipo de detalhe
que gera um bug de "as camadas estão invertidas" na Fase 4.
