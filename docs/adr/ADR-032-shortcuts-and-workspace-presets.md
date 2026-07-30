# ADR-032 — Atalhos e presets são preferências locais com falha segura

**Status:** aceito · **Data:** 2026-07-30 · **Revisar em:** suporte a múltiplos
perfis de usuário ou sincronização entre máquinas

## Contexto

O layout do editor já é estado local: o Dockview produz uma serialização opaca,
gravada fora do projeto e descartada quando incompatível. A Fase 11 acrescenta
dois estados relacionados, mas com ciclos de vida diferentes:

- o preset é apenas a origem do layout atual; depois de aplicado, o usuário pode
  mover painéis livremente;
- atalhos são preferências duráveis e não devem desaparecer ao restaurar o
  layout padrão.

Há ainda dois riscos. Um arquivo editado ou truncado externamente não pode
impedir o aplicativo de abrir, e dois comandos não podem executar
silenciosamente para a mesma combinação de teclas. Presets também não podem
deixar o Dockview vazio se uma versão futura remover um painel.

## Alternativas

### A. Guardar tudo no documento

❌ Sujaria o projeto ao mover um painel ou trocar um atalho.

❌ Compartilharia preferências pessoais com quem abrisse o mesmo arquivo.

### B. Guardar atalhos dentro de `workspace.json`

✅ Usa a persistência existente.

❌ “Restaurar layout” apagaria também a memória muscular do operador.

❌ A versão opaca do Dockview passaria a governar dados que não dependem dele.

### C. Separar layout e atalhos, validar na fronteira e aplicar presets com

rollback

✅ O layout continua descartável e pode ser restaurado sem apagar atalhos.

✅ Preferências inválidas caem para defaults conhecidos.

✅ Conflitos são explícitos e combinações ambíguas não executam comando algum.

✅ Um preset que falha restaura o snapshot anterior; se até ele for inválido,
recua para o layout padrão.

❌ São dois arquivos locais pequenos em vez de um.

## Decisão

**Alternativa C.**

1. `workspace.json` continua contendo a serialização opaca do Dockview e passa a
   registrar, de forma aditiva, o id do último preset aplicado. Uma alteração
   manual de painéis marca o layout como personalizado.
2. `preferences.json` contém somente preferências versionadas de atalhos. O
   processo principal limita tamanho e valida toda a estrutura antes de ler ou
   escrever.
3. O renderer mantém um registry fechado de comandos. Overrides desconhecidos
   são ignorados; conflitos são reportados e uma combinação ambígua não é
   despachada.
4. O renderer é a única origem dos aceleradores configuráveis. O menu nativo
   continua disparando ações quando clicado, mas não registra aceleradores fixos
   que poderiam contornar um override do usuário.
5. Aplicar um preset captura `toJSON()`, limpa e reconstrói o arranjo. Qualquer
   falha tenta `fromJSON()` com o snapshot anterior e, como último recuo, monta o
   padrão.

Nenhum desses estados entra no undo, no autosave do projeto ou no resultado de
render.

## Consequências

- Restaurar layout e restaurar atalhos são ações independentes.
- Preferências truncadas, grandes demais ou com versão desconhecida são
  ignoradas sem diálogo bloqueante.
- Defaults precisam permanecer sem conflito, verificado por teste.
- Teclas em campos de texto continuam pertencendo ao controle nativo; somente
  comandos marcados como globais podem atravessar essa fronteira.
- Presets usam todos os painéis registrados e mudam topologia ativa/proporções,
  evitando que a adoção de painéis ausentes desfaça o preset na próxima abertura.

## Quando revisar

Revisar se surgirem perfis nomeados, sincronização entre máquinas ou comandos
carregados por plugins. Nesse caso, ids, migrações e resolução de conflitos
deixarão de ser um catálogo fechado do editor.
