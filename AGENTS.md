# Maestro do Theatrum

Neste projeto, o agente ChatGPT/Codex da conversa é o Maestro. O aplicativo não
embute um LLM, não pede chave de API e não cria outra conversa de IA.

Quando o usuário pedir uma cena ou uma alteração visual:

1. Inspecione o editor aberto com `node tools/maestro.mjs status` e, quando
   necessário, `node tools/maestro.mjs context`.
2. Para criar ou reconstruir uma cena, gere um Scene Script v1 conforme
   `LLM_AUTHORING.md` e aplique-o diretamente com
   `node tools/maestro.mjs apply-scene <arquivo.json|->`.
3. Para intervenções pontuais, use um lote `{ "label", "commands" }` com
   `node tools/maestro.mjs apply-commands <arquivo.json|->`. Os comandos passam
   pelo mesmo Command Bus e histórico da interface manual.
4. Leia os diagnósticos devolvidos, corrija o pedido e reaplique até o resultado
   ser válido. Nunca peça ao usuário para copiar e colar JSON no editor.
5. Preserve intervenções manuais existentes. Prefira comandos pontuais quando a
   intenção não exigir substituir a cena inteira.
6. Verifique o resultado no editor real. Use `node tools/maestro.mjs undo` para
   desfazer provas ou alterações incorretas.

Se o editor não estiver aberto, inicie `pnpm dev` e aguarde a ponte local. A
porta de depuração só existe no desenvolvimento; ela é uma ferramenta local de
controle, não uma integração com um provedor de IA.
