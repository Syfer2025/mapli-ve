# ADR-029 — Plugins entram por uma API versionada e descartável

**Status:** aceito
**Data:** 2026-07-30
**Revisar em:** quando plugins de terceiros não confiáveis forem distribuídos

## Contexto

A Fase 10 precisa permitir que um módulo local acrescente tipos de nó, efeitos,
ações, verbos, exporters, painéis, estilos de mapa e comandos sem criar imports
do plugin no núcleo. Recarregar durante o desenvolvimento também não pode deixar
registros antigos acumulados.

Há ainda dois contratos de compatibilidade:

- um manifest incompatível deve ser recusado antes da ativação;
- um projeto com nó de plugin ausente deve continuar salvável sem perder o
  payload desconhecido.

## Alternativas

### A. Imports diretos e condicionais no aplicativo

✅ Usa somente o sistema de módulos já existente.

❌ Cada plugin altera o núcleo, e remover um import não desfaz registros criados
em outros subsistemas.

### B. Eventos globais sem escopo de vida

✅ Permite contribuições sem dependência direta.

❌ Não existe maneira confiável de saber o que pertence a cada plugin nem de
reverter uma ativação parcial.

### C. Host em processo com manifest v1 e registries descartáveis

✅ O manifest valida versão, entrada e pontos de extensão antes da carga.

✅ Cada registro devolve um `Disposable`; o host reúne todos num escopo e os
remove em ordem inversa no `unload`.

✅ Uma exceção durante `activate` reverte as contribuições já registradas.

✅ Nós desconhecidos permanecem opacos e atravessam carga e salvamento.

❌ Código de plugin executa no mesmo processo e com as permissões do host. Esta
fronteira organiza extensibilidade; não é uma sandbox de segurança.

### D. Processo isolado por plugin

✅ Isola falhas e cria uma fronteira de segurança mais forte.

❌ Exige serialização de todas as extensões e IPC para renderização e painéis
antes de existir distribuição de plugins não confiáveis.

## Decisão

Adotar a alternativa C. A API pública começa em `apiVersion: 1`; descoberta e
carga dependem de portas injetadas para sistema de arquivos e módulos. Todos os
pontos de extensão passam por registries nomeados e por um escopo descartável do
plugin.

O conteúdo que acompanha o aplicativo usa formatos de dados validados. A
biblioteca inicial contém 150 unidades e referências a sprites SVG, além de
bandeiras, paletas e presets. Acrescentar uma unidade não exige alterar o
TypeScript.

## Consequências

- Carga, rollback e `unload` são testáveis sem Electron.
- Recarregar um plugin não deixa contribuições residuais.
- O manifest não pode escapar do próprio diretório por `entry`.
- Conteúdo de nó desconhecido é preservado, mas não ganha comportamento até o
  plugin correspondente estar disponível.
- Somente plugins locais confiáveis devem ser carregados nesta versão.

## Quando revisar

Substituir esta decisão antes de aceitar plugins obtidos de terceiros sem
revisão. Nesse momento, medir o custo de um processo isolado e definir
capabilities explícitas para I/O, rede, UI e renderização.
