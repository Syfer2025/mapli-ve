# Guia rápido de uso

Este guia é para operar o Theatrum. A documentação 00–09 explica arquitetura e
decisões internas.

## 1. Abrir esta versão

Este ciclo não reconstruiu nem revalidou um instalador do Windows. Se você já
recebeu uma compilação interna validada separadamente, abra-a normalmente. Para
usar o repositório em desenvolvimento:

```powershell
pnpm install
pnpm data:fetch
pnpm geo:build
pnpm dev
```

`data:fetch` é o passo que usa rede para preparar os dados. Depois de preparados,
mapas, gazetteer e recursos locais funcionam offline. Satélite e cartografia
detalhada são pacotes regionais opcionais e só aparecem quando seus arquivos
estão presentes.

## 2. Navegar e salvar a vista do mapa

- Arraste para mover.
- Use a roda para aproximar e afastar.
- No seletor do viewport, escolha:
  - **Relevo escuro**, **Pergaminho** ou **Político** para o mapa mundial;
  - **Detalhado Irã–Hormuz** para províncias, cidades, ruas, edifícios e POIs;
  - **Satélite** para imagem;
  - **Satélite híbrido** para imagem com ruas e rótulos.
- A caixa de busca aceita nomes de lugares.

Estilo e câmera pertencem à composição. Ao terminar um gesto, o editor grava a
vista pelo mesmo histórico das demais alterações. Se a câmera já estiver
animada, o gesto cria valores no playhead. Salvar/reabrir e desfazer/refazer
preservam a vista.

Se um pacote detalhado ou satélite escolhido não estiver no disco, o viewport
mostra um fallback e informa a ausência. A escolha original continua salva; o
editor não a troca silenciosamente.

## 3. Animar

1. Selecione um objeto no mapa ou no painel **Projeto**.
2. Arraste o indicador de tempo na timeline.
3. Edite as propriedades no **Inspector**.
4. Use o painel **Ações** para movimentos e eventos prontos.

As ações podem ficar **ao vivo**, fáceis de parametrizar, ou ser convertidas em
keyframes para ajuste individual. `Ctrl+Z` desfaz a conversão inteira.

### Expressões

Propriedades animáveis mostram o botão **ƒx**:

1. clique em **ƒx** para selecionar a propriedade e abrir o texto;
2. escreva usando `value` (valor após os keyframes) e `frame`;
3. clique em **Aplicar** ou use `Ctrl+Enter`;
4. use **Remover** para voltar a `expression: null`.

Aplicar e remover entram no histórico normal. Se o texto tiver erro, o Inspector
mostra a causa e informa que o valor base continua sendo usado; corrija o texto
sem perder o restante da cena.

Atalhos principais:

| Ação                | Atalho                    |
| ------------------- | ------------------------- |
| Salvar              | `Ctrl+S`                  |
| Abrir               | `Ctrl+O`                  |
| Desfazer / refazer  | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Reproduzir / pausar | `Espaço`                  |
| Duplicar seleção    | `Ctrl+D`                  |
| Excluir seleção     | `Delete`                  |

Use **Atalhos…** na barra superior para trocar ou remover combinações. Conflitos
são informados e não disparam dois comandos. As preferências ficam nesta máquina
e não sujam o projeto.

O seletor de workspace oferece **Edição**, **Mapa em foco**, **Animação** e
**Palco 3D**. Depois de aplicar um preset, você ainda pode mover os painéis
livremente; **Restaurar layout** não apaga seus atalhos.

## 4. Criar com o Maestro

1. Deixe o Theatrum aberto em desenvolvimento com `pnpm dev`.
2. Nesta própria conversa do ChatGPT/Codex, descreva a cena ou a alteração em
   linguagem comum.
3. O agente desta conversa inspeciona o projeto aberto, monta a cena, aplica no
   editor e lê os diagnósticos.
4. Se houver erro, o agente corrige e reaplica; você não precisa copiar e colar
   JSON nem configurar chave no aplicativo.

Uma cena nova é aplicada como um Scene Script completo. Mudanças pontuais usam o
mesmo Command Bus das ferramentas manuais, preservando o restante do documento.
Cada operação confirmada pode ser desfeita com `Ctrl+Z`.

A ponte local sempre lê o estado atual do projeto, portanto uma intervenção
manual feita entre dois pedidos passa a fazer parte do contexto seguinte. O
Theatrum não embute outro modelo nem faz chamadas de IA.

## 5. Importar Scene Script manualmente

1. Clique em **Scene Script…** na barra superior.
2. Cole o JSON declarativo.
3. Clique em **Importar**.
4. Se houver erro, use os diagnósticos com caminho do campo, dica e sugestões
   para corrigir o JSON.

A importação inteira é uma única entrada no histórico; `Ctrl+Z` restaura o
documento anterior. O compilador funciona offline e não chama IA. O arquivo
`LLM_AUTHORING.md` na raiz do repositório contém o contrato gerado para entregar
a um modelo externo.

A exportação inversa é parcial: uma cena importada preserva sua fonte original,
mas edições feitas depois no documento não são reconstruídas como Scene Script.
O editor deve avisar quando isso acontecer.

## 6. Exportar

Abra **Fila de render** e escolha formato, escala, supersampling e intervalo.
Você pode iniciar uma exportação direta ou usar **Adicionar à fila** e depois
**Iniciar fila**.

| Formato              | Quando usar                                     |
| -------------------- | ----------------------------------------------- |
| MP4 · H.264          | Reprodução, envio e publicação                  |
| GIF animado          | Preview curto e incorporação em páginas         |
| ProRes 4444 · alfa   | Composição profissional em Premiere/Resolve/NLE |
| Sequência PNG        | Máxima qualidade, um arquivo por frame          |
| Sequência PNG · alfa | Composição por frame com mapa removido          |

O modo alfa exclui o mapa base e mantém palco/overlay. A resolução parte do
tamanho da composição, não do painel. Escala muda o arquivo final; supersampling
renderiza maior e reduz para suavizar. Pedidos que ultrapassam 8192 px no render
interno ou o limite real da GPU são recusados, nunca reduzidos silenciosamente.

O export espera mapa, assets, superfícies e frame estabilizarem. Se não
estabilizarem, a política padrão interrompe o job antes de escrever o quadro
problemático. Arquivos MP4/GIF/MOV só recebem o nome final ao concluir.

### Fila e retomada

- A fila é executada em série no viewport atual.
- Ao reiniciar o aplicativo, um job que estava rodando volta **pausado**.
- PNG continua a partir dos frames já gravados.
- GIF e ProRes reutilizam os PNGs de staging e refazem a finalização.
- MP4 H.264 direto reinicia desde o começo ao retomar.
- O projeto e a composição precisam continuar disponíveis depois do reinício.
- A fila ainda não congela uma cópia imutável do documento. Editar durante o job
  ativo o interrompe.

## 7. Salvar e recuperar

- Projetos usam a extensão `.theatrum`.
- Um exemplo nunca deve ser sobrescrito: salve com outro nome.
- Se o processo fechar de forma inesperada, a próxima abertura oferece a sessão
  recuperável.
- O asterisco ao lado do nome indica alterações ainda não salvas.

## Limites conhecidos desta versão

- O ensaio de 90 s em 4K/60 e a prova 8K na máquina-alvo ainda não foram
  executados nesta árvore.
- Retomada de MP4 H.264 reinicia o stream.
- Plugins arbitrários ainda não têm instalação/gestão pela UI.
- Cache de preview e waveform de áudio possuem núcleo implementado, mas ainda não
  aparecem como pré-render/trilha na interface.
- Áudio é apenas referência: sem reprodução, scrub sonoro, mixagem ou export.
- O onboarding completo ainda falta.
- O soak de quatro horas não foi executado.
- Não há instalador atual prometido por este ciclo.
