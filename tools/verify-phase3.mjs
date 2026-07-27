/**
 * Prova automatizada dos critérios seguros da Fase 3.
 *
 * Requer `pnpm dev` rodando para as provas no renderer Electron real. O fluxo
 * de crash é deliberadamente dividido em duas execuções: este script prepara e
 * verifica a recuperação, mas nunca encerra processos do usuário.
 *
 *   node tools/verify-phase3.mjs --prepare-recovery
 *   # encerre o Electron abruptamente e inicie `pnpm dev` outra vez
 *   node tools/verify-phase3.mjs --verify-recovery
 */

import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEBUG_URL = "http://localhost:9222/json/list";
const REQUEST_TIMEOUT_MS = 30_000;
const RESULT_PREFIX = "THEATRUM_PHASE3_NODE_RESULT ";
const RECOVERY_STATE_PATH = path.join(tmpdir(), "theatrum-phase3-recovery-proof.json");
const RECOVERY_NODE_ID = "nd_phase3_recovery_probe";
const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pageTarget() {
  let response;
  try {
    response = await fetch(DEBUG_URL);
  } catch {
    throw new Error("Electron de desenvolvimento não encontrado. Inicie `pnpm dev`.");
  }
  if (!response.ok) throw new Error(`CDP respondeu ${response.status}`);
  const targets = await response.json();
  const page = targets.find(
    (target) => target.type === "page" && !target.url.startsWith("devtools://"),
  );
  if (page === undefined) throw new Error("renderer Electron não encontrado na porta CDP");
  return page;
}

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();

  constructor(webSocketDebuggerUrl) {
    this.#socket = new WebSocket(webSocketDebuggerUrl);
  }

  async connect() {
    if (this.#socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener("open", resolve, { once: true });
      this.#socket.addEventListener("error", () => reject(new Error("falha no WebSocket CDP")), {
        once: true,
      });
    });
    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new Error(`CDP: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  request(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timeout CDP em ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails !== undefined) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "erro desconhecido";
      throw new Error(`renderer: ${detail}`);
    }
    return response.result.value;
  }

  close() {
    this.#socket.close();
  }
}

async function waitForRenderer(client) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const ready = await client.evaluate(`Boolean(
        window.theatrum &&
        window.__theatrumPhase3?.getSnapshot().ready &&
        document.querySelector('.project-tree')
      )`);
      if (ready) return;
    } catch {
      // O contexto pode ser substituído durante o carregamento do Vite.
    }
    await delay(100);
  }
  throw new Error("superfície de debug da Fase 3 não ficou pronta em 20 s");
}

async function activateHistoryPanel(client) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const visible = await client.evaluate(`(()=>{
      if(document.querySelector('.history-list')) return true;
      const tab=Array.from(document.querySelectorAll('[role="tab"],.dv-tab'))
        .find(element=>element.textContent?.trim()==='Histórico');
      if(tab instanceof HTMLElement) tab.click();
      return Boolean(document.querySelector('.history-list'));
    })()`);
    if (visible) return;
    await delay(50);
  }
  throw new Error("painel Histórico não pôde ser ativado");
}

async function runNodeProofs() {
  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const helper = path.join(ROOT, "tools", "fixtures", "phase3-node-check.ts");
  const { stdout } = await execFileAsync(process.execPath, [tsxCli, helper], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(RESULT_PREFIX));
  assert(line !== undefined, "helper Node não devolveu o resultado esperado");
  return JSON.parse(line.slice(RESULT_PREFIX.length));
}

async function verifyRendererCommands(client) {
  await activateHistoryPanel(client);
  const result = await client.evaluate(`(async()=>{
    const debug=window.__theatrumPhase3;
    if(!debug) throw new Error('debug surface ausente');
    const before=debug.getSnapshot();
    if(before.recoveryCandidate!==null){
      throw new Error('há recuperação pendente; recupere ou descarte antes da prova');
    }
    const baseline=structuredClone(before.document);
    const composition=baseline.compositions.find(
      item=>item.id===before.selectedCompositionId
    )??baseline.compositions[0];
    if(!composition) throw new Error('composição ausente');
    const root=composition.nodes[composition.root];
    if(!root) throw new Error('nó raiz ausente');
    const startCursor=before.history.cursor;
    const prefix='nd_phase3_verify_'+String(startCursor+1)+'_';
    let persistentParent=root.id;
    const deletable=[];
    let deleted=0;
    let reparented=0;

    const dispatch=(command)=>{
      const dispatched=debug.commandBus.dispatch(command);
      if(!dispatched.ok) throw new Error(dispatched.error.message);
    };

    for(let index=0;index<50;index+=1){
      const id=prefix+String(index).padStart(2,'0');
      const remove=index%10===9;
      const removeId=remove?deletable.shift():undefined;
      const transaction=debug.commandBus.transaction(
        'Verificação nó '+String(index+1).padStart(2,'0'),
        ()=>{
          const node=structuredClone(root);
          Object.assign(node,{
            id,
            name:'Temporário '+String(index+1),
            parent:root.id,
            children:[]
          });
          dispatch({
            type:'node.create',
            payload:{compositionId:composition.id,parentId:root.id,node},
            source:'system'
          });
          dispatch({
            type:'node.rename',
            payload:{compositionId:composition.id,nodeId:id,name:'Nó verificado '+String(index+1)},
            source:'system'
          });
          if(index>0){
            dispatch({
              type:'node.reparent',
              payload:{compositionId:composition.id,nodeId:id,parentId:persistentParent},
              source:'system'
            });
            reparented+=1;
          }
          if(removeId!==undefined){
            dispatch({
              type:'node.delete',
              payload:{compositionId:composition.id,nodeId:removeId},
              source:'system'
            });
            deleted+=1;
          }
        }
      );
      if(!transaction.ok) throw new Error(transaction.error.message);
      if(index===0) persistentParent=id;
      else deletable.push(id);
    }

    const edited=debug.getSnapshot();
    const editedComposition=edited.document.compositions.find(item=>item.id===composition.id);
    const addedNodes=Object.keys(editedComposition.nodes).length-Object.keys(composition.nodes).length;
    if(addedNodes!==45) throw new Error('contagem após create/delete: '+String(addedNodes));
    if(edited.history.cursor!==startCursor+50){
      throw new Error('histórico não recebeu 50 transações');
    }

    for(let index=0;index<50;index+=1) debug.actions.undo();
    await new Promise(resolve=>setTimeout(resolve,120));
    const restored=debug.getSnapshot();
    const canonical=(value)=>{
      if(Array.isArray(value)) return value.map(canonical);
      if(value===null||typeof value!=='object') return value;
      return Object.fromEntries(
        Object.keys(value).sort().map(key=>[key,canonical(value[key])])
      );
    };
    const deepEqual=
      JSON.stringify(canonical(restored.document))===JSON.stringify(canonical(baseline));
    if(!deepEqual) throw new Error('50 undo não restauraram o documento inicial');
    if(restored.history.cursor!==startCursor){
      throw new Error('cursor após undo divergiu');
    }

    const historyRows=document.querySelectorAll('.history-list__entry').length;
    const expectedRows=restored.history.entries.length+1;
    const initialCurrent=Boolean(
      document.querySelector('.history-list__entry[data-current="true"]')
    );
    if(historyRows!==expectedRows){
      throw new Error('UI do histórico mostra '+historyRows+' de '+expectedRows+' linhas');
    }
    if(startCursor===-1&&!initialCurrent){
      throw new Error('UI não marcou o estado inicial após undo');
    }

    // Deixa o debounce transitório terminar e então reinicializa a mesma
    // sessão. Assim não sobra timer capaz de marcar a sessão limpa como dirty.
    await new Promise(resolve=>setTimeout(resolve,500));
    const recoveryReset=await window.theatrum.recovery.start({
      document:restored.document,
      projectPath:restored.file?.path??null
    });
    if(!recoveryReset.ok) throw new Error(recoveryReset.message);

    const info=await window.theatrum.app.info();
    return {
      electron:info.electronVersion,
      debugSurfaceReady:true,
      created:50,
      renamed:50,
      reparented,
      deleted,
      undo:50,
      deepEqual,
      history:{rows:historyRows,cursor:restored.history.cursor,uiVerified:true},
      projectTreeVisible:Boolean(document.querySelector('.project-tree'))
    };
  })()`);

  assert(result.debugSurfaceReady, "superfície de debug ausente");
  assert(result.created === 50 && result.undo === 50, "prova de 50 operações incompleta");
  assert(result.deepEqual, "documento não voltou ao estado inicial");
  assert(result.history.uiVerified, "painel Histórico não refletiu o Command Bus");
  return result;
}

async function prepareRecovery(client) {
  const prepared = await client.evaluate(`(async()=>{
    const debug=window.__theatrumPhase3;
    const before=debug.getSnapshot();
    if(before.recoveryCandidate!==null) throw new Error('já existe recuperação pendente');
    const composition=before.document.compositions.find(
      item=>item.id===before.selectedCompositionId
    )??before.document.compositions[0];
    const root=composition?.nodes[composition.root];
    if(!composition||!root) throw new Error('documento sem raiz');
    if(composition.nodes[${JSON.stringify(RECOVERY_NODE_ID)}]){
      throw new Error('marcador de recovery já existe');
    }
    const node=structuredClone(root);
    Object.assign(node,{
      id:${JSON.stringify(RECOVERY_NODE_ID)},
      name:'RECOVERY_SENTINEL_F3',
      parent:root.id,
      children:[]
    });
    const created=debug.commandBus.dispatch({
      type:'node.create',
      payload:{compositionId:composition.id,parentId:root.id,node},
      source:'system'
    });
    if(!created.ok) throw new Error(created.error.message);
    const after=debug.getSnapshot();
    const recorded=await window.theatrum.recovery.record({
      document:after.document,
      commands:20,
      force:true
    });
    if(!recorded.ok) throw new Error(recorded.message);
    return {
      baselineJson:JSON.stringify(before.document),
      projectId:before.document.id,
      compositionId:composition.id,
      nodeId:${JSON.stringify(RECOVERY_NODE_ID)}
    };
  })()`);
  await writeFile(RECOVERY_STATE_PATH, `${JSON.stringify(prepared)}\n`, "utf8");
  return {
    prepared: true,
    projectId: prepared.projectId,
    sentinel: RECOVERY_NODE_ID,
    stateFile: RECOVERY_STATE_PATH,
    next: "Encerre o Electron abruptamente, inicie `pnpm dev` de novo e rode `node tools/verify-phase3.mjs --verify-recovery`.",
  };
}

async function verifyRecoveryAfterRestart(client) {
  const state = JSON.parse(await readFile(RECOVERY_STATE_PATH, "utf8"));
  const result = await client.evaluate(`(async()=>{
    const expected=${JSON.stringify(state)};
    const debug=window.__theatrumPhase3;
    const offered=debug.getSnapshot().recoveryCandidate;
    if(!offered||offered.projectId!==expected.projectId){
      throw new Error('candidato de recuperação esperado não foi oferecido');
    }
    const banner=Boolean(document.querySelector('.app__notice[data-kind="recovery"]'));
    if(!banner) throw new Error('banner de recuperação não está visível');
    await debug.actions.recover(offered);
    const recovered=debug.getSnapshot();
    const composition=recovered.document.compositions.find(
      item=>item.id===expected.compositionId
    );
    const sentinel=composition?.nodes[expected.nodeId];
    if(sentinel?.name!=='RECOVERY_SENTINEL_F3'){
      throw new Error('sentinela não foi recuperado');
    }
    debug.actions.deleteNode(expected.nodeId);
    await new Promise(resolve=>setTimeout(resolve,650));
    const restored=debug.getSnapshot();
    const baseline=JSON.parse(expected.baselineJson);
    const deepEqual=JSON.stringify(restored.document)===JSON.stringify(baseline);
    if(!deepEqual) throw new Error('limpeza da sentinela não restaurou o documento-base');
    const reset=await window.theatrum.recovery.start({
      document:restored.document,
      projectPath:restored.file?.path??null
    });
    if(!reset.ok) throw new Error(reset.message);
    return {
      offered:true,
      banner,
      recovered:true,
      sentinel:'RECOVERY_SENTINEL_F3',
      restoredBaseline:deepEqual
    };
  })()`);
  await rm(RECOVERY_STATE_PATH, { force: true });
  return result;
}

async function withRenderer(callback) {
  const page = await pageTarget();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  try {
    await waitForRenderer(client);
    return await callback(client);
  } finally {
    client.close();
  }
}

async function main() {
  const prepare = process.argv.includes("--prepare-recovery");
  const verify = process.argv.includes("--verify-recovery");
  assert(!(prepare && verify), "escolha somente um modo de recovery");

  if (prepare) {
    const recovery = await withRenderer(prepareRecovery);
    console.log(JSON.stringify({ ok: true, mode: "prepare-recovery", recovery }, null, 2));
    return;
  }
  if (verify) {
    const recovery = await withRenderer(verifyRecoveryAfterRestart);
    console.log(JSON.stringify({ ok: true, mode: "verify-recovery", recovery }, null, 2));
    return;
  }

  const node = await runNodeProofs();
  const renderer = await withRenderer(verifyRendererCommands);
  console.log(
    JSON.stringify(
      {
        ok: true,
        node,
        renderer,
        crashRecovery: {
          safeSimulationVerified: node.recovery,
          realRestartRequired: true,
          prepare: "node tools/verify-phase3.mjs --prepare-recovery",
          verify: "node tools/verify-phase3.mjs --verify-recovery",
          processTermination: "manual; este verificador nunca executa taskkill",
        },
      },
      null,
      2,
    ),
  );
}

await main();
