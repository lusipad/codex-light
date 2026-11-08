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
let accountFailure = null, accountWait = null;
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
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText + "\nexports.TestMenu = ArchiveFilterMenu; exports.prepareArchiveRestoreFocus = prepareArchiveRestoreFocus;", {
  exports: output, console, Date, Intl, Set, Map, AbortController, document: { body: {} },
  require(name) {
    if (name === "react") return { ...React, default: React };
    if (name === "../config") return { accountRead: async () => { if(accountWait)await accountWait.promise; if(accountFailure)throw accountFailure; return { account: { type: "chatgpt" }, workspaceRouting: { chatgptAccountId: identity.accountId } }; } };
    if (name === "../chatgptService") return { serviceIdentity: async () => ({ ...identity }), unarchiveCloudItem: (source,id,current,signal) => { const request = defer(); pendingWrites.push({ source,id,current,signal,...request }); return request.promise; } };
    if (name === "../cloudRecentChats") return { applyCloudRecentAction: (chat, action, signal) => {
      assert.equal(action.kind, "unarchive");
      const request = defer();
      pendingWrites.push({ source: "durable", id: chat.session.threadId, current: chat.session.identity, signal, ...request });
      return request.promise;
    } };
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
{
  const active = [], frames = [], body = {};
  let onFocus;
  const doc = { body, activeElement: body, defaultView: { requestAnimationFrame: fn => frames.push(fn) },
    addEventListener: (_, fn, { signal }) => { onFocus = target => { if (!signal.aborted) fn({ target }); }; } };
  const target = name => ({ ownerDocument: doc, isConnected: true, disabled: false,
    focus(options) { assert.equal(options.preventScroll, true); active.push(name); doc.activeElement = this; } });
  const [prior, original, next, search, refresh, root] = ["prior", "original", "next", "search", "refresh", "root"].map(target);
  root.querySelectorAll = () => [prior, original, next];
  root.querySelector = selector => selector.includes("search") ? search.isConnected ? search : null : refresh;
  const start = () => { doc.activeElement = original; return output.prepareArchiveRestoreFocus(root, original); };
  const settleFocus = (finish, success, scopeCurrent = () => true) => { finish(success, scopeCurrent); frames.shift()?.(); };
  let finish = start(); doc.activeElement = body; settleFocus(finish, true); assert.equal(active.at(-1), "next");
  next.disabled = true; finish = start(); doc.activeElement = body; settleFocus(finish, true); assert.equal(active.at(-1), "prior");
  finish = start(); doc.activeElement = body; settleFocus(finish, false); assert.equal(active.at(-1), "original");
  prior.isConnected = false; finish = start(); doc.activeElement = body; settleFocus(finish, true); assert.equal(active.at(-1), "search");
  search.isConnected = false; finish = start(); doc.activeElement = body; settleFocus(finish, true); assert.equal(active.at(-1), "refresh");
  const count = active.length;
  finish = start(); onFocus(search); doc.activeElement = body; settleFocus(finish, true); assert.equal(active.length, count);
  finish = start(); doc.activeElement = body; settleFocus(finish, true, () => false); assert.equal(active.length, count);
  assert.equal(output.prepareArchiveRestoreFocus(root, original), undefined, "pointer action without retained focus does not move it");
}
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
 canUnarchive(id,current) { return this.status === "ready" && this.items.some(item=>item.id===id) && JSON.stringify(this.identity)===JSON.stringify(current); },
 forgetAccepted(id,current) { if(!this.isCurrentIdentity(current))return false; if(!this.items.some(item=>item.id===id))return true; this.items=this.items.filter(item=>item.id!==id); if(source==="cloud-task")props.cloudArchive={...this};else props.conversationArchive={...this}; return true; },
 reload(){if(source==="cloud-task")taskRefreshes++;else conversationRefreshes++;}, loadMore(){}, retryListeners(){} });
props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation");
let tree=render();
const row = (source,tree) => nodes(tree,n=>n.props?.key===source+":same" && cls("archive-row")(n))[0];
const restore = (source,tree) => nodes(row(source,tree),n=>n.type==="button" && text(n)==="取消归档")[0];
assert.ok(restore("cloud-task",tree),"UU01: trusted ready cloud rows expose real unarchive action");
restore("cloud-task",tree).props.onClick(); restore("cloud-task",tree).props.onClick();
const originalConversationClick = restore("chatgpt-conversation",tree).props.onClick; originalConversationClick(); await flush();
assert.deepEqual(pendingWrites.map(x=>x.source),["cloud-task","chatgpt-conversation"],"UU01: synchronous per source:id locks prevent duplicate writes, same id in another source remains independent");
tree=render(); assert.equal(text(restore("cloud-task",tree)),"取消归档","UU01: pending retains the sourced action label"); assert.equal(restore("cloud-task",tree).props["aria-busy"],true);
pendingWrites[0].resolve(); await flush(); tree=render();
assert.equal(row("cloud-task",tree),undefined); assert.ok(row("chatgpt-conversation",tree));
assert.equal(taskRefreshes,1); assert.ok(notices.some(([message,type])=>message==="聊天已取消归档"&&type==="info"));
pendingWrites[1].reject(Object.assign(Error("unknown delivery"),{code:"archive_write_unknown"})); await flush(); tree=render();
assert.ok(text(tree).includes("尚未确认"));
assert.equal(nodes(row("chatgpt-conversation",tree),n=>n.type==="button"&&n.props["aria-label"]==="取消归档")[0].props.disabled,true);
const readOnly=nodes(tree,n=>n.type==="button"&&text(n)==="刷新列表")[0]; readOnly.props.onClick(); assert.equal(conversationRefreshes,1);
assert.equal(pendingWrites.length,2,"UU02: read-only retry never replays unknown writes");
assert.deepEqual(writes,[],"UU03: cloud IDs never enter local mutations");
// Failed refresh cannot unlock unknown; an explicit fresh successful snapshot containing the target can.
originalConversationClick(); await flush(); assert.equal(pendingWrites.length,2,"UU04: stale same-context callbacks cannot bypass the unknown synchronous lock");
props.conversationArchive={...props.conversationArchive,status:"error",error:"refresh failed"}; tree=render();
assert.equal(nodes(row("chatgpt-conversation",tree),n=>n.type==="button"&&n.props["aria-label"]==="取消归档")[0].props.disabled,true);
props.conversationArchive={...props.conversationArchive,status:"ready",error:null,readVersion:1,items:[...props.conversationArchive.items]}; render(); tree=render();
assert.equal(restore("chatgpt-conversation",tree).props.disabled,false,"UU04: a real newer archived snapshot after explicit refresh permits another explicit user action");
assert.equal(pendingWrites.length,2,"UU04: unlocking never sends a mutation automatically");
props.cloudArchive={...props.cloudArchive,status:"error",error:"accepted refresh failed"}; tree=render();
const acceptedNotice=nodes(tree,n=>n.props?.role==="status"&&text(n).includes("列表刷新失败"))[0]; assert.ok(acceptedNotice,"UU05: accepted write fact survives a source read failure");
nodes(acceptedNotice,n=>n.type==="button")[0].props.onClick(); assert.equal(taskRefreshes,2); assert.equal(pendingWrites.length,2);
// A new unknown result can also be unlocked via the top-level refresh, without any direct replay.
tree=render(); restore("chatgpt-conversation",tree).props.onClick(); await flush(); pendingWrites.at(-1).reject(Object.assign(Error("unknown second result"),{code:"archive_write_unknown"})); await flush(); tree=render();
nodes(tree,n=>n.type==="button"&&n.props.className==="archive-refresh")[0].props.onClick(); await flush();
props.conversationArchive={...props.conversationArchive,readVersion:2,items:[...props.conversationArchive.items]}; render(); tree=render();
assert.equal(restore("chatgpt-conversation",tree).props.disabled,false,"UU04: top-level refresh also permits explicit retry after a successful newer archived snapshot");
const firstPhaseWrites=pendingWrites.length;
// New account scope cannot reuse old rendered handlers, even for the same source/id.
identity.generation=2; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation"); tree=render();
originalConversationClick(); await flush(); assert.equal(pendingWrites.length,firstPhaseWrites,"UU06: old row callback cannot borrow a new account generation");
for(const status of [403,404]) {
 tree=render(); restore("chatgpt-conversation",tree).props.onClick(); await flush();
 pendingWrites.at(-1).reject(Object.assign(Error("HTTP "+status),{code:"http_error"})); await flush(); tree=render();
 assert.equal(notices.at(-1)[0],"无法取消归档聊天"); assert.ok(row("chatgpt-conversation",tree)); assert.equal(restore("chatgpt-conversation",tree).props.disabled,false,"UU06: explicit HTTP failure retains row and releases retry lock");
}
accountFailure=Error("before write account read failed"); tree=render(); const beforePreflight=pendingWrites.length; restore("cloud-task",tree).props.onClick(); await flush(); accountFailure=null;
assert.equal(pendingWrites.length,beforePreflight,"UU06: preflight failure sends no mutation");
// A task GET HTTP-empty policy is not proof that an unknown mutation may be retried.
tree=render(); const unknownTaskClick=restore("cloud-task",tree).props.onClick; unknownTaskClick(); await flush(); pendingWrites.at(-1).reject(Object.assign(Error("unknown task"),{code:"archive_write_unknown"})); await flush(); tree=render();
nodes(tree,n=>n.type==="button"&&n.props.className==="archive-refresh")[0].props.onClick(); await flush();
const afterUnknownTaskWrites=pendingWrites.length;
props.cloudArchive={...props.cloudArchive,readVersion:1,status:"ready",items:[]}; render(); tree=render();
assert.ok(text(tree).includes("尚未确认"),"UU04: absence from a partial new page is not restoration confirmation"); unknownTaskClick(); await flush(); assert.equal(pendingWrites.length,afterUnknownTaskWrites);
props.cloudArchive={...props.cloudArchive,readVersion:2,httpEmptyStatus:403,items:[{source:"cloud-task",id:"same",title:"Task",createdAt:1,updatedAt:2,displayTime:2}]}; render(); tree=render();
assert.equal(restore("cloud-task",tree).props.disabled,true,"UU04: task HTTP-empty cannot unlock an unknown write");
props.cloudArchive={...props.cloudArchive,readVersion:3,httpEmptyStatus:null,items:[...props.cloudArchive.items]}; render(); tree=render(); assert.equal(restore("cloud-task",tree).props.disabled,false); assert.equal(pendingWrites.length,afterUnknownTaskWrites);
// Accepted post-validation failure is resolved by a later successful read, not by another write.
restore("cloud-task",tree).props.onClick(); await flush(); accountFailure=Error("post-accept account read failed"); pendingWrites.at(-1).resolve(); await flush(); accountFailure=null; tree=render();
assert.ok(text(tree).includes("列表刷新失败")); const acceptedWrites=pendingWrites.length;
const failurePanel=nodes(tree,n=>n.props?.role==="status"&&text(n).includes("列表刷新失败"))[0]; nodes(failurePanel,n=>n.type==="button")[0].props.onClick();
props.cloudArchive={...props.cloudArchive,status:"ready",readVersion:4,items:[...props.cloudArchive.items]}; render(); tree=render(); assert.ok(!text(tree).includes("列表刷新失败"),"UU05: a successful read clears resolved post-check details"); assert.equal(pendingWrites.length,acceptedWrites);
// Authentication preflight failures in a still-current account are visible and force a real reader refresh.
for(const [source,code] of [["cloud-task","auth_unavailable"],["chatgpt-conversation","auth_required"]]) {
 identity.generation++; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation");
 let authReloads=0; const target=source==="cloud-task"?props.cloudArchive:props.conversationArchive;
 target.reload=function(){authReloads++;this.status="loading";if(source==="cloud-task")props.cloudArchive={...this};else props.conversationArchive={...this};};
 render(); tree=render(); const writesBeforeAuth=pendingWrites.length; accountFailure=Object.assign(Error("preflight "+code),{code});
 restore(source,tree).props.onClick(); await flush(); accountFailure=null; tree=render();
 assert.equal(pendingWrites.length,writesBeforeAuth); assert.equal(notices.at(-1)[0],"无法取消归档聊天","UU10: current-account auth failure uses the official error, never raw transport detail");
 assert.equal(authReloads,1,"UU10: auth failure must actually refresh the affected reader"); assert.equal(restore(source,tree).props.disabled,true,"UU10: old ready snapshot cannot immediately authorize another write while recovery is loading");
 if(source==="cloud-task")props.cloudArchive={...props.cloudArchive,status:"ready",readVersion:1};else props.conversationArchive={...props.conversationArchive,status:"ready",readVersion:1};
 render(); tree=render(); assert.equal(restore(source,tree).props.disabled,false); assert.equal(pendingWrites.length,writesBeforeAuth);
}
// Two IDs in the same source remain concurrent while the first accepted operation refreshes the list.
identity.generation=3; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation");
props.cloudArchive.items=[{...props.cloudArchive.items[0],id:"x"},{...props.cloudArchive.items[0],id:"y"}];
props.cloudArchive.reload=function(){taskRefreshes++;this.status="loading";props.cloudArchive={...this};};
tree=render(); const rowById=(id,t)=>nodes(t,n=>n.props?.key==="cloud-task:"+id&&cls("archive-row")(n))[0];
const startAt=pendingWrites.length, successBefore=notices.filter(([,type])=>type==="info").length;
for(const id of ["x","y"])nodes(rowById(id,tree),n=>n.type==="button"&&text(n)==="取消归档")[0].props.onClick(); await flush();
assert.equal(pendingWrites.length,startAt+2);
pendingWrites[startAt].resolve(); await flush(); tree=render();
assert.equal(props.cloudArchive.status,"loading"); assert.equal(pendingWrites[startAt+1].signal.aborted,false,"UU07: ordinary same-account list refresh cannot abort another ID's in-flight write");
pendingWrites[startAt+1].resolve(); await flush(); tree=render();
assert.equal(rowById("x",tree),undefined); assert.equal(rowById("y",tree),undefined); assert.equal(notices.filter(([,type])=>type==="info").length,successBefore+2);
// An accepted page-two operation remains successful after another accepted operation refreshes only page one.
identity.generation++; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation");
props.cloudArchive.items=[{...props.cloudArchive.items[0],id:"front"},{...props.cloudArchive.items[0],id:"page-two"}];
props.cloudArchive.reload=function(){taskRefreshes++;this.items=[];this.status="ready";this.readVersion++;props.cloudArchive={...this};};
render(); tree=render(); const pageWriteStart=pendingWrites.length, pageSuccessStart=notices.filter(([,type])=>type==="info").length;
for(const id of ["front","page-two"])nodes(rowById(id,tree),n=>n.type==="button"&&text(n)==="取消归档")[0].props.onClick(); await flush();
pendingWrites[pageWriteStart].resolve(); await flush(); tree=render(); assert.equal(rowById("page-two",tree),undefined);
pendingWrites[pageWriteStart+1].resolve(); await flush(); tree=render();
assert.equal(notices.filter(([,type])=>type==="info").length,pageSuccessStart+2,"UU11: accepted page-two target absent from refreshed cache is still an accepted success");
assert.ok(!text(tree).includes("列表刷新失败"),"UU11: successful first-page reads cannot become a fabricated read error");
// A late A completion must never clear a newer B (or ABA) operation's busy state for the same key.
for(const aba of [false,true]) {
 identity.generation++; const firstGeneration=identity.generation; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation"); tree=render();
 restore("cloud-task",tree).props.onClick(); await flush(); const firstRequest=pendingWrites.at(-1);
 identity.generation++; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation"); render(); render();
 if(aba){identity.generation=firstGeneration;props.cloudArchive=createReader("cloud-task");props.conversationArchive=createReader("chatgpt-conversation");render();render();}
 tree=render(); restore("cloud-task",tree).props.onClick(); await flush(); const newerRequest=pendingWrites.at(-1);
 firstRequest.resolve(); await flush(); tree=render();
 assert.equal(restore("cloud-task",tree).props["aria-busy"],true,"UU09: late previous operation cannot clear a newer operation token, including ABA identity reuse");
 assert.equal(restore("cloud-task",tree).props.disabled,true); newerRequest.resolve(); await flush(); render();
}
// Listener invalidation, account replacement and unmount all reject late successful results.
for(const change of ["listener","account","unmount"]) {
 identity.generation++; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation"); tree=render();
 restore("cloud-task",tree).props.onClick(); await flush(); const request=pendingWrites.at(-1), oldReader=props.cloudArchive;
 const infoBefore=notices.filter(([,type])=>type==="info").length, refreshBefore=taskRefreshes;
 if(change==="listener"){props.cloudArchive={...props.cloudArchive,live:false,status:"error",error:"listener invalidated"}; render();}
 if(change==="account"){identity.generation++;props.cloudArchive=createReader("cloud-task");props.conversationArchive=createReader("chatgpt-conversation");render();}
 if(change==="unmount")for(const slot of slots)slot?.cleanup?.();
 assert.equal(request.signal.aborted,true,"UU08: scope invalidation aborts local waiting"); request.resolve(); await flush();
 assert.equal(notices.filter(([,type])=>type==="info").length,infoBefore); assert.equal(taskRefreshes,refreshBefore); assert.equal(oldReader.items.length,1,"UU08: late result cannot modify old/new cache");
}
// A new mounted view cancelled during preflight never submits a host write.
slots.length=0; effects.length=0; identity.generation++; props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation"); render(); await flush(); tree=render();
accountWait=defer(); const beforeCancelled=pendingWrites.length; restore("cloud-task",tree).props.onClick(); await flush();
for(const slot of slots)slot?.cleanup?.(); accountWait.resolve(); accountWait=null; await flush(); assert.equal(pendingWrites.length,beforeCancelled,"UU08: cancellation before preflight completion sends zero writes");
console.log("PASS UU01–UU11 production cloud unarchive UI: locks, accepted cache, independent source IDs, unknown no-replay and read-only retry");

slots.length=0; effects.length=0; identity.generation++;
props.cloudArchive=createReader("cloud-task"); props.conversationArchive=createReader("chatgpt-conversation");
reply=[...rows,{ id:"same", name:"同 ID 本地归档", cwd:"D:/One" }];
const durableChat = { id:"same", title:"普通云端归档", recency:42, createdAt:20, updatedAt:42, session: {
  threadId:"same", identity:{...identity}, binding:{...identity, conversation:true, name:"构建环境"},
} };
let durableReloads=0, recentReloads=0, openedChat=null;
props.onDurableRestored=()=>recentReloads++;
props.onOpenDurableChat=chat=>{openedChat=chat;};
props.durableArchive={...createReader("durable"), items:[durableChat],
  forgetAccepted(id,current){if(!this.isCurrentIdentity(current))return false; props.durableArchive={...this,items:this.items.filter(item=>item.id!==id)};return true;},
  reload(){durableReloads++;},
};
render(); await flush(); tree=render();
assert.ok(row("local",tree) && row("cloud-task",tree) && row("chatgpt-conversation",tree) && row("durable",tree));
assert.equal(nodes(row("durable",tree),n=>n.type==="button").length,1,"Durable rows cannot access legacy delete");
const durableWriteCount=pendingWrites.length;
restore("durable",tree).props.onClick(); restore("durable",tree).props.onClick(); await flush();
assert.equal(pendingWrites.length,durableWriteCount+1);
assert.equal(pendingWrites.at(-1).source,"durable");
pendingWrites.at(-1).reject(Error("write reply missing")); await flush(); tree=render();
assert.equal(restore("durable",tree).props.disabled,true);
nodes(tree,n=>n.type==="button"&&text(n)==="刷新列表")[0].props.onClick();
assert.equal(durableReloads,1); assert.equal(pendingWrites.length,durableWriteCount+1);
props.durableArchive={...props.durableArchive,readVersion:1}; render(); tree=render();
restore("durable",tree).props.onClick(); await flush();
pendingWrites.at(-1).resolve(true); await flush(); tree=render();
assert.equal(row("durable",tree),undefined);
assert.ok(row("local",tree) && row("cloud-task",tree) && row("chatgpt-conversation",tree));
assert.equal(recentReloads,1); assert.equal(durableReloads,2);
const viewAction=notices.at(-1)[2]; assert.equal(viewAction.label,"查看");
viewAction.onClick(); assert.equal(openedChat,durableChat);
openedChat=null; props.durableArchive={...props.durableArchive,live:false}; render();
viewAction.onClick(); assert.equal(openedChat,null);
console.log("PASS durable settings archive: same-ID isolation, no legacy delete, unknown read-only recovery and scoped View action");

slots.length=0; effects.length=0;
props.cloudArchive=createReader("cloud-task");
props.projectMembership={...props.projectMembership,threadProjectAssignments:{same:{projectKind:"local",projectId:"server-one"}}};
const projectDeletes=[];
props.onDeleteProject=async ids=>{projectDeletes.push(Array.from(ids));return {deletedThreadIds:[],error:null};};
render(); await flush(); tree=render();
const bulk = t=>nodes(t,n=>n.props?.["aria-label"]==="删除所有本地已归档聊天")[0];
const searchBox = t=>nodes(t,n=>n.type==="input"&&n.props?.type==="search")[0];
const projectMenu = t=>nodes(nodes(t,n=>n.props?.key==="project:local::one")[0],n=>n.type==="ThreadActionsMenu")[0];
const dialog = t=>nodes(t,n=>n.type?.name==="ArchiveDeleteDialog")[0];
assert.ok(!bulk(tree));
const menu=projectMenu(tree); assert.ok(menu);
menu.props.onSelect("delete-project"); tree=render();
assert.equal(dialog(tree).props.project.label,"Same");
assert.deepEqual(Array.from(dialog(tree).props.project.threadIds).sort(),["a","same"]);
dialog(tree).props.onDecision(false); await flush(); tree=render();
assert.equal(projectDeletes.length,0);
projectMenu(tree).props.onSelect("delete-project"); tree=render();
filter(tree).props.onKindFilterChange("cloud"); tree=render();
assert.ok(!bulk(tree) && !projectMenu(tree));
await dialog(tree).props.onDecision(true); tree=render();
assert.equal(projectDeletes.length,0,"changing the visible selection invalidates confirmation");
filter(tree).props.onKindFilterChange("local"); tree=render();
assert.ok(bulk(tree));
searchBox(tree).props.onChange({target:{value:"Zulu"}}); tree=render();
assert.ok(!bulk(tree));
projectMenu(tree).props.onSelect("delete-project"); tree=render();
assert.deepEqual(Array.from(dialog(tree).props.project.threadIds),["a"]);
await dialog(tree).props.onDecision(true); tree=render();
assert.deepEqual(projectDeletes,[["a"]]);
searchBox(tree).props.onChange({target:{value:""}}); tree=render();
project(tree).props.onChange("project:local::one"); tree=render();
assert.ok(!bulk(tree) && !projectMenu(tree));
console.log("PASS settings local archive deletion: host and filter gates, current project selection, cancel and stale confirmation");
