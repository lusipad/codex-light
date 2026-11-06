import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/components/ArchiveView.tsx", "utf8");
const rows = [
  { id: "a", name: "Zulu", updatedAt: 20, createdAt: 40, cwd: "D:/One" },
  { id: "b", name: "Alpha", updatedAt: 20, createdAt: 30, cwd: "D:/Two" },
  { id: "c", name: "Alpha", updatedAt: 10, createdAt: 50, cwd: "D:/One/child" },
  { id: "d", name: "Delta", updatedAt: 0, createdAt: 60, cwd: "D:/One" },
];
let reply = rows, reads = 0;
const identity = { accountId: "account-a", userId: "user-a", generation: 1 };
const pendingWrites = [], notices = [];
let accountFailure = null, accountWait = null, accountRevision=0;
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
const writes = [], slots = [], effects = [];
let cursor = 0, mounted = false;
const React = {
  createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } }; },
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef(initial) { return slots[cursor++] ??= { current: initial }; },
  useMemo(fn, dependencies) { const i = cursor++, previous = slots[i]; if (!previous || dependencies.some((v,j) => !Object.is(v, previous.dependencies[j]))) slots[i] = { dependencies, value: fn() }; return slots[i].value; },
  useCallback(fn, dependencies) { return React.useMemo(() => fn, dependencies); },
  useDeferredValue(value) { return value; },
  useEffect(fn, dependencies = []) {
    const index=cursor++, previous=slots[index];
    if(!previous || dependencies.some((value,i)=>!Object.is(value,previous.dependencies[i]))) effects.push(()=>{ previous?.cleanup?.(); slots[index]={ dependencies, cleanup:fn() }; });
  }, useLayoutEffect() {},
};
const output = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText + "\nexports.TestMenu = ArchiveFilterMenu; exports.TestDeleteDialog = CloudArchiveDeleteDialog;", {
  exports: output, console, Date, Intl, Set, Map, AbortController, document: { body: {} },
  require(name) {
    if (name === "react") return { ...React, default: React };
    if (name === "../config") return { accountRead: async () => { if(accountWait)await accountWait.promise; if(accountFailure)throw accountFailure; return { revision: accountRevision, account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: identity.accountId } }; } };
    if (name === "../chatgptService") return { serviceIdentity: async () => ({ ...identity }), unarchiveCloudItem: (source,id,current,signal) => { const request = defer(); pendingWrites.push({ action:"restore",source,id,current,signal,...request }); return request.promise; }, deleteCloudArchiveItem: (source,id,current,signal) => { const request=defer(); pendingWrites.push({ action:"delete",source,id,current,signal,...request }); return request.promise; } };
    if (name === "../bridge") return { callAppServer: async (method, params) => { assert.equal(method, "thread/list"); assert.equal(params.archived, true); reads++; return { data: reply, nextCursor: null }; } };
    if (name.endsWith(".css")) return {};
    if (name === "../sidebarProjects") {
      const module = {};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/sidebarProjects.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: module });
      return module;
    }
    if (name === "react-dom") return { createPortal: node => node };
    return new Proxy({}, { get: (_, key) => key });
  },
});
const props = {
  surface: "settings", workspaces: [], workspaceHints: {},
  projectMembership: { localProjects: [
    { id: "one", name: "Same", rootPaths: ["D:/One", "D:/Extra"], createdAt: 1, serverProjectId: "server-one" },
    { id: "two", name: "Same", rootPaths: ["D:/Two"], createdAt: 2 },
  ], threadProjectAssignments: {}, projectlessThreadIds: ["d"], workspaceProjectAssignments: {} },
  onSelectThread() {}, onUnarchive: async thread => { writes.push(["restore", thread.id]); reply = reply.filter(t => t.id !== thread.id); },
  onDelete: async () => ({ deletedThreadIds: [], error: null }), onDeleteAll: async () => ({ deletedThreadIds: [], error: null }),
};
const render = () => { cursor = 0; const tree=output.ArchiveView(props); while(effects.length)effects.shift()(); return tree; };
const nodes = (tree, predicate) => { const list = []; const walk = n => { if (!n || typeof n !== "object") return; if (predicate(n)) list.push(n); for (const child of n.props?.children || []) walk(child); }; walk(tree); return list; };
const cls = value => node => node.props?.className?.split(" ").includes(value);
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : (node?.props?.children || []).map(text).join("");
const ids = tree => nodes(tree, cls("archive-row")).map(node => node.props.key);
const filter = tree => nodes(tree, node => node.type?.name === "ArchiveFilterMenu")[0];
const project = tree => nodes(tree, node => node.props?.id === "archive-project-filter")[0];
render(); for (const effect of effects) effect(); mounted = true;
for (let i=0;i<8;i++) await Promise.resolve();
props.onShowToast = (...args) => notices.push(args);
let taskRefreshes=0, conversationRefreshes=0;
const createReader = source => ({ readVersion: 0, items: [{ source, id: "same", title: source, createdAt: 1, updatedAt: 2, displayTime: 2, environmentLabel: null, gizmoId: null }], identity: { ...identity }, status: "ready", error: null, loadingMore: false, pageError: null,
 nextCursor: null, nextOffset: null, httpEmptyStatus: null, includeWorkCloud: false,
 isCurrentIdentity(current) { return this.live!==false && JSON.stringify(this.identity)===JSON.stringify(current); },
 canUnarchive(id,current) { return this.status === "ready" && this.items.some(item=>item.id===id) && this.isCurrentIdentity(current); },
 forgetAccepted(id,current) { if(!this.isCurrentIdentity(current))return false; if(!this.items.some(item=>item.id===id))return true; this.items=this.items.filter(item=>item.id!==id); if(source==="cloud-task")props.cloudArchive={...this};else props.conversationArchive={...this}; return true; },
 reload(){if(source==="cloud-task")taskRefreshes++;else conversationRefreshes++;}, loadMore(){}, retryListeners(){} });
props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation");
let tree=render();
const row=(source,t)=>nodes(t,n=>n.props?.key===source+":same"&&cls("archive-row")(n))[0];
const deletion=(source,t)=>nodes(row(source,t),n=>n.type==="button"&&text(n)==="删除")[0];
const dialog=t=>nodes(t,n=>n.type?.name==="CloudArchiveDeleteDialog")[0];
assert.ok(deletion("cloud-task",tree),"DU01: trusted settings cloud row has the real delete entry");
deletion("cloud-task",tree).props.onClick(); tree=render(); assert.ok(dialog(tree)); assert.equal(pendingWrites.length,0,"DU01: opening/cancelling confirmation sends zero delete");
dialog(tree).props.onCancel(); tree=render(); assert.equal(dialog(tree),undefined); assert.equal(pendingWrites.length,0);
deletion("cloud-task",tree).props.onClick(); tree=render(); dialog(tree).props.onConfirm(); tree=render(); assert.equal(dialog(tree),undefined,"DU02: task confirmation closes immediately"); await flush(); assert.equal(pendingWrites[0].action,"delete");
deletion("chatgpt-conversation",tree).props.onClick(); tree=render(); dialog(tree).props.onConfirm(); await flush(); tree=render(); assert.ok(dialog(tree)); assert.equal(dialog(tree).props.busy,true,"DU02: conversation confirmation remains busy");
pendingWrites[1].reject(Object.assign(Error("HTTP 403"),{code:"http_error"})); await flush(); tree=render(); assert.ok(dialog(tree)); assert.equal(dialog(tree).props.busy,false); assert.equal(notices.at(-1)[0],"无法删除已归档的聊天"); assert.equal(notices.at(-1)[2],undefined,"DU03: conversation failure has no task Retry action");
dialog(tree).props.onConfirm(); await flush(); pendingWrites.at(-1).resolve("already-absent"); await flush(); tree=render(); assert.equal(dialog(tree),undefined); assert.equal(row("chatgpt-conversation",tree),undefined); assert.ok(row("cloud-task",tree),"DU03: deleting one source never removes same ID from the other source");
pendingWrites[0].reject(Object.assign(Error("HTTP 403"),{code:"http_error"})); await flush(); tree=render(); assert.ok(row("cloud-task",tree)); const retry=notices.at(-1)[2]; assert.equal(notices.at(-1)[0],"无法删除聊天。请重试。"); assert.equal(retry.label,"Retry");
retry.onClick(); await flush(); const retryRequest=pendingWrites.at(-1); assert.equal(dialog(render()),undefined,"DU04: task Retry does not reopen confirmation"); retryRequest.resolve("accepted"); await flush(); tree=render(); assert.equal(row("cloud-task",tree),undefined);
assert.equal(notices.filter(([,type])=>type!=="error").length,0,"DU04: deletion never invents a success toast"); assert.deepEqual(writes,[],"DU04: cloud delete never enters local delete callbacks");
// A cancelled confirmation must not remain a callable mutation capability.
identity.generation++; props.cloudArchive=createReader("cloud-task"); tree=render(); tree=render(); deletion("cloud-task",tree).props.onClick(); tree=render(); const cancelled=dialog(tree); cancelled.props.onCancel(); tree=render();
const beforeStale=pendingWrites.length; cancelled.props.onConfirm(); await flush(); assert.equal(pendingWrites.length,beforeStale,"DU05: cancelled confirmation cannot later delete");

const fresh = () => { identity.generation++; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation"); render(); return render(); };
const confirm = source => { tree=render(); deletion(source,tree).props.onClick(); tree=render(); const view=dialog(tree); view.props.onConfirm(); return view; };
// Unknown is a held mutation until an explicit read returns a fresh, still-archived target.
tree=fresh(); confirm("chatgpt-conversation"); await flush(); pendingWrites.at(-1).reject(Object.assign(Error("lost response"),{code:"archive_write_unknown"})); await flush(); tree=render();
assert.equal(dialog(tree).props.unknown,true); assert.equal(dialog(tree).props.blocked,true); const unknownCount=pendingWrites.length;
dialog(tree).props.onConfirm(); await flush(); assert.equal(pendingWrites.length,unknownCount,"DU06: unknown does not blind replay");
dialog(tree).props.onRefresh(); props.conversationArchive={...props.conversationArchive,status:"error",error:"read failed"}; render(); tree=render(); assert.equal(dialog(tree).props.blocked,true,"DU06: failed refresh cannot release unknown");
props.conversationArchive={...props.conversationArchive,status:"ready",error:null,readVersion:1}; render(); tree=render(); assert.equal(dialog(tree).props.blocked,false,"DU06: successful fresh snapshot containing target permits explicit reconfirm"); assert.equal(pendingWrites.length,unknownCount);
dialog(tree).props.onConfirm(); await flush(); assert.equal(pendingWrites.length,unknownCount+1); pendingWrites.at(-1).resolve("accepted"); await flush(); render();
// Same source/id shares its restore lock; the other source with equal ID is independent.
tree=fresh(); confirm("cloud-task"); await flush(); tree=render(); const restore=nodes(row("cloud-task",tree),n=>n.type==="button"&&n.props["aria-label"]==="取消归档")[0]; const mutualCount=pendingWrites.length; restore.props.onClick(); await flush(); assert.equal(pendingWrites.length,mutualCount,"DU07: delete locks restore for same source/id");
confirm("chatgpt-conversation"); await flush(); assert.equal(pendingWrites.length,mutualCount+1,"DU07: same ID across sources can mutate independently"); pendingWrites.at(-1).resolve("accepted"); pendingWrites.at(-2).resolve("accepted"); await flush(); render();
// A cancelled stale dialog cannot act on a new dialog. Old task Retry cannot bypass it.
tree=fresh(); confirm("cloud-task"); await flush(); pendingWrites.at(-1).reject(Object.assign(Error("403"),{code:"http_error"})); await flush(); const oldRetry=notices.at(-1)[2];
tree=render(); deletion("chatgpt-conversation",tree).props.onClick(); tree=render(); const newDialog=dialog(tree); const blockedRetryCount=pendingWrites.length; oldRetry.onClick(); await flush(); assert.equal(pendingWrites.length,blockedRetryCount,"DU08: old Retry cannot write through another confirmation"); assert.equal(dialog(render()).props.title,newDialog.props.title); newDialog.props.onCancel(); render();
const oldReader=props.cloudArchive; oldReader.live=false; tree=fresh(); const abaCount=pendingWrites.length; oldRetry.onClick(); await flush(); assert.equal(pendingWrites.length,abaCount,"DU08: old task Retry has no capability in a new reader epoch");
// Old pending operation cannot close/delete the same ID's new-account dialog/result.
confirm("chatgpt-conversation"); await flush(); const oldRequest=pendingWrites.at(-1); tree=fresh(); confirm("chatgpt-conversation"); await flush(); const newRequest=pendingWrites.at(-1); assert.notEqual(oldRequest,newRequest); assert.equal(oldRequest.signal.aborted,true);
oldRequest.resolve("accepted"); await flush(); tree=render(); assert.equal(dialog(tree).props.busy,true,"DU09: old finally cannot clear new pending dialog"); assert.ok(row("chatgpt-conversation",tree)); newRequest.resolve("accepted"); await flush(); tree=render(); assert.equal(dialog(tree),undefined); assert.equal(row("chatgpt-conversation",tree),undefined);
// Accepted with a failed post-check stays accepted, and only reading is offered.
tree=fresh(); confirm("cloud-task"); await flush(); const acceptedRequest=pendingWrites.at(-1); accountFailure=Object.assign(Error("auth temporarily unavailable"),{code:"auth_unavailable"}); acceptedRequest.resolve("accepted"); await flush(); accountFailure=null; tree=render(); assert.ok(text(tree).includes("聊天已删除，但列表刷新失败。")); const acceptedWrites=pendingWrites.length;
nodes(tree,n=>n.type==="button"&&text(n)==="刷新列表")[0].props.onClick(); props.cloudArchive={...props.cloudArchive,readVersion:1}; render(); tree=render(); assert.equal(pendingWrites.length,acceptedWrites,"DU10: accepted refresh is read-only"); assert.ok(!text(tree).includes("聊天已删除，但列表刷新失败。")); assert.equal(deletion("cloud-task",tree).props.disabled,true,"DU10: accepted cannot be resent even if snapshot still contains target");
// A post-write account snapshot change still preserves accepted fact and permits read recovery.
tree=fresh(); confirm("cloud-task"); await flush(); accountRevision++; pendingWrites.at(-1).resolve("accepted"); await flush(); tree=render(); assert.ok(text(tree).includes("聊天已删除，但列表刷新失败。"));
props.cloudArchive={...props.cloudArchive,readVersion:1}; render(); tree=render(); assert.ok(!text(tree).includes("聊天已删除，但列表刷新失败。"),"DU12: accepted post-check failure detail clears on a newer successful read");
// Execute the real modal component, not a substitute dialog implementation.
slots.length=0; effects.length=0; let cancelledModal=0, submittedModal=0, refreshedModal=0; const modalWait=defer();
const modalProps={title:'<script>literal title</script>',busy:false,blocked:false,unknown:false,fallbackRef:{current:null},onCancel(){cancelledModal++;},onConfirm(){submittedModal++;return modalWait.promise;},onRefresh(){refreshedModal++;}};
const renderModal=()=>{cursor=0;return output.TestDeleteDialog(modalProps);}; const evt=()=>({preventDefault(){this.prevented=true;},stopPropagation(){},nativeEvent:{}});
let modal=renderModal(); assert.ok(text(modal).includes('“<script>literal title</script>”')); assert.equal(nodes(modal,n=>n.type==='script').length,0,"DU11: title remains escaped React text");
modal.props.onCompositionStart(); const ime=Object.assign(evt(),{key:'Enter'}); modal.props.onKeyDown(ime); assert.equal(ime.prevented,true); await nodes(modal,n=>n.type==='form')[0].props.onSubmit(evt()); assert.equal(submittedModal,0); modal.props.onCancel(evt()); assert.equal(cancelledModal,0); modal.props.onCompositionEnd();
const form=nodes(modal,n=>n.type==='form')[0]; const firstSubmit=form.props.onSubmit(evt()); form.props.onSubmit(evt()); assert.equal(submittedModal,1,"DU11: same-tick modal submit is synchronous single-flight"); modal.props.onCancel(evt()); assert.equal(cancelledModal,0); modalWait.resolve(); await firstSubmit;
modalProps.busy=true; modal=renderModal(); modal.props.onCancel(evt()); const backdrop={getBoundingClientRect:()=>({left:0,right:10,top:0,bottom:10})}; modal.props.onMouseDown({target:backdrop,currentTarget:backdrop,clientX:-1,clientY:-1}); assert.equal(cancelledModal,0,"DU11: busy conversation cannot cancel through Escape/backdrop"); const submit=nodes(modal,n=>n.type==='button'&&n.props.type==='submit')[0]; assert.equal(submit.props.disabled,true); assert.equal(text(submit),'删除聊天'); assert.equal(submit.props['aria-busy'],true);
modalProps.busy=false; modalProps.blocked=true; modalProps.unknown=true; modal=renderModal(); await nodes(modal,n=>n.type==='form')[0].props.onSubmit(evt()); assert.equal(submittedModal,1); nodes(modal,n=>n.type==='button'&&text(n)==='刷新列表')[0].props.onClick(); assert.equal(refreshedModal,1); modal.props.onCancel(evt()); assert.equal(cancelledModal,1,"DU11: unknown can cancel while confirmation remains blocked");
const firstFocus={focus(){this.focused=true;}},lastFocus={focus(){this.focused=true;}};
const tabEvent=Object.assign(evt(),{key:'Tab',shiftKey:false,currentTarget:{querySelectorAll:()=>[firstFocus,lastFocus],ownerDocument:{activeElement:lastFocus}}});
modal.props.onKeyDown(tabEvent); assert.equal(firstFocus.focused,true,'DU13: Tab from final control loops to first inside dialog');
const backTab=Object.assign(evt(),{key:'Tab',shiftKey:true,currentTarget:{querySelectorAll:()=>[firstFocus,lastFocus],ownerDocument:{activeElement:firstFocus}}});
modal.props.onKeyDown(backTab); assert.equal(lastFocus.focused,true,'DU13: Shift+Tab loops inside dialog');
const noControls=Object.assign(evt(),{key:'Tab',currentTarget:{querySelectorAll:()=>[],ownerDocument:{activeElement:null}}});
modal.props.onKeyDown(noControls);assert.equal(noControls.prevented,true,'DU13: pending without enabled controls cannot tab outside');
console.log("PASS DU01–DU13 production cloud deletion, modal ownership, source locks, unknown recovery, reader epochs and focus loop");
