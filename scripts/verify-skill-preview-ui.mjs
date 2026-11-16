import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const helper = {};
vm.runInNewContext(compile(fs.readFileSync("src/skillPreview.ts", "utf8")), { exports: helper });
const original = "---\r\nname: sample\r\n---\r\n\r\n# Different title\r\n\r\nUseful body\r\n";
assert.equal(helper.skillPreviewMarkdown(original, "C:/sample/SKILL.md", "sample"), "Useful body\n");
assert.equal(helper.skillPreviewMarkdown("# Keep\n\nbody", "", ""), "# Keep\n\nbody");
assert.equal(helper.skillPreviewMarkdown("---\nunterminated\n# Keep", "path", "name"), "---\nunterminated\n# Keep");
assert.equal(helper.skillPreviewMarkdown("\n # Other\n\ntext", "path", "name"), "text");
assert.equal(helper.skillPreviewMarkdown("## Keep\nbody", "path", "name"), "## Keep\nbody");
assert.equal(helper.skillPreviewMarkdown("", "path", "name"), "");
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise, resolve, reject}; };
function previewHarness() {
  let cursor=0, slots=[], effects=[], pending=[], changed=false, tree, updates=0;
  const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
  const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
  const react = { createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
    useState(value){const i=cursor++; if(!(i in slots)) slots[i]=typeof value === "function"?value():value; return [slots[i],next=>{next=typeof next === "function"?next(slots[i]):next;if(!Object.is(slots[i],next)){changed=true;updates++;}slots[i]=next;}];},
    useRef(value){return slots[cursor++] ||= {current:value};},
    useEffect(fn,deps){const i=cursor++, old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
  };
  const copies=[], reads=[], revealed=[]; let close=0, opened=0, tried=0, returnFocus=0;
  const props={ identity:"A", name:"Sample", rawName:"sample", path:"C:/isolated/SKILL.md", description:"Description", enabled:true, busy:false, localHost:true,
    loadContents:()=>{const d=defer();reads.push(d);return d.promise;}, onClose:()=>close++, onToggle:()=>{}, onOpen:()=>{opened++;return false;}, onTry:()=>{tried++;return false;}, onUninstall:()=>{},
  };
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}, contains:()=>true, querySelector:()=>null};
  class FocusElement { isConnected=true; focus(){returnFocus++;} }
  const exports={};
  vm.runInNewContext(compile(fs.readFileSync("src/components/SkillPreviewDialog.tsx","utf8")),{exports,require:name=>name==="react"?react:name==="lucide-react"?new Proxy({}, {get:(_,key)=>String(key)}):name.endsWith(".css")?{}:name==="../skillPreview"?helper:name==="./MarkdownView"?{MarkdownView:"MarkdownView"}:name==="../clipboard"?{copyTextToClipboard:async value=>{copies.push(value);return true;}}:name==="../bridge"?{tauriInvoke:async(method,args)=>revealed.push([method,args])}:undefined,HTMLElement: FocusElement, document:{activeElement:new FocusElement()},console});
  function render(){let loops=0;do{assert.ok(loops++<15);cursor=0;changed=false;tree=exports.SkillPreviewDialog(props);for(const n of nodes(tree))if(n.props.ref)n.props.ref.current=n.type==="dialog"?dialog:{focus(){},contains:()=>false};pending.splice(0).forEach(fn=>fn());}while(changed);return tree;}
  const h={props,reads,copies,revealed,nodes,text,render,get tree(){return tree;},get close(){return close;},get opened(){return opened;},get tried(){return tried;},get updates(){return updates;},get returnFocus(){return returnFocus;},dialog,
    async tick(){for(let i=0;i<20;i++)await Promise.resolve();render();},button(label){const n=nodes(tree).find(n=>n.type==="button"&&(text(n).trim()===label||n.props["aria-label"]===label));assert.ok(n,`button ${label}`);return n;},unmount(){effects.forEach(e=>e?.cleanup?.());}};
  render();return h;
}
const p=previewHarness();
assert.ok(p.text(p.tree).includes("正在加载技能内容…"));assert.equal(p.nodes(p.tree).filter(n=>n.type==="textarea").length,0);
p.button("更多操作").props.onClick({stopPropagation(){}});p.render();assert.equal(p.button("复制 Markdown").props.disabled,true);
p.reads[0].resolve(original);await p.tick();
assert.equal(p.nodes(p.tree).find(n=>n.type==="MarkdownView").props.content,"Useful body\n");
assert.equal(p.nodes(p.tree).find(n=>n.type==="MarkdownView").props.onOpenFile,undefined,"markdown links do not open the side panel");
await p.button("复制 Markdown").props.onClick();await p.tick();assert.deepEqual(p.copies,[original]);assert.ok(p.text(p.tree).includes("已复制 SKILL.md"));
p.button("更多操作").props.onClick({stopPropagation(){}});p.render();await p.button("打开").props.onClick();assert.equal(p.opened,1);assert.equal(p.close,0,"cancelled file navigation keeps preview");
await p.button("立即试用").props.onClick();assert.equal(p.tried,1);assert.equal(p.close,0,"cancelled draft navigation keeps preview");
p.props.onTry=()=>true;p.render();await p.button("立即试用").props.onClick();assert.equal(p.close,1);
p.props.enabled=false;p.render();assert.equal(p.button("立即试用").props.disabled,true);
p.props.enabled=true;p.props.busy=true;p.render();assert.equal(p.button("禁用技能").props.disabled,true);assert.equal(p.button("立即试用").props.disabled,true);assert.equal(p.button("关闭").props.disabled,undefined);
p.unmount();
const empty=previewHarness();empty.reads[0].resolve("");await empty.tick();assert.ok(empty.text(empty.tree).includes("暂无说明"));empty.button("更多操作").props.onClick({stopPropagation(){}});empty.render();assert.equal(empty.button("复制 Markdown").props.disabled,false);await empty.button("复制 Markdown").props.onClick();assert.deepEqual(empty.copies,[""]);empty.unmount();
const failed=previewHarness();failed.reads[0].reject(Error("read denied"));await failed.tick();assert.ok(failed.text(failed.tree).includes("无法加载技能内容。"));failed.button("重试").props.onClick();failed.render();assert.equal(failed.reads.length,2);failed.unmount();const count=failed.updates;failed.reads[1].resolve("late");for(let i=0;i<10;i++)await Promise.resolve();assert.equal(failed.updates,count,"closed preview ignores late reads");
console.log("PASS SD03/04/05/07/09: preview states, original clipboard including empty, cleanup, late reads and host acceptance");

// Render the production directory with its existing isolated hook fixture. Children
// are inspected as component contracts; the actual dialog is exercised above.
const existing=fs.readFileSync("scripts/verify-plugin-management-ui-b.mjs","utf8");
const ast=ts.createSourceFile("fixture.mjs",existing,ts.ScriptTarget.Latest,true);
let fixture=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="harness").getText(ast).replace("export function","function");
fixture=fixture.replace('"./RecommendedSkillsPanel": {}','"./RecommendedSkillsPanel": { RecommendedSkillsPanel: "RecommendedSkillsPanel" }');
const make=new Function("assert","fs","vm","ts","market","plugin","deferred",`${fixture};return harness;`)(assert,fs,vm,ts,{name:"m",path:"C:/isolated/market.json",plugins:[]},{},defer);
const h=make();h.props.manageOnly=false;h.props.initialTab="skills";h.render();await h.tick();
let row=h.nodes(h.tree).find(n=>n.props.className?.includes("skill-list-row"));assert.ok(row);assert.equal(h.nodes(row).filter(n=>n.props.role==="switch").length,0,"default directory check cannot become a toggle card");
row.props.onClick();h.render();assert.equal(h.nodes(h.tree).filter(n=>n.type==="textarea").length,0,"installed card opens preview instead of editor");let preview=h.nodes(h.tree).find(n=>n.type==="SkillPreviewDialog");assert.ok(preview);assert.equal(preview.props.path,"C:/isolated/skill");
preview.props.onClose();h.render();h.button("本地模版").props.onClick();h.render();h.nodes(h.tree).find(n=>n.type==="textarea").props.onChange({target:{value:"preserved draft"}});h.render();row=h.nodes(h.tree).find(n=>n.props.className?.includes("skill-list-row"));row.props.onClick();h.render();assert.equal(h.nodes(h.tree).find(n=>n.type==="textarea").props.value,"preserved draft");
h.props.connectionIdentity="local:changed";h.render();await h.tick();assert.ok(!h.nodes(h.tree).some(n=>n.type==="SkillPreviewDialog"),"context change dismisses preview");h.unmount();
console.log("PASS SD01/05/12: actual directory uses preview, check state, isolated template draft and connection dismissal");
// Production preview loading must not guess a remote identity after file errors.
const reads=[], rpc=[];
const source=make({fs:{readFileText:async path=>{reads.push(path);throw Error("denied");}},bridge:{callAppServer:async(...args)=>{rpc.push(args);return {};}}});
source.props.manageOnly=false;source.props.initialTab="skills";source.render();await source.tick();source.nodes(source.tree).find(n=>n.props.className?.includes("skill-list-row")).props.onClick();source.render();
await assert.rejects(source.nodes(source.tree).find(n=>n.type==="SkillPreviewDialog").props.loadContents(),/denied/);assert.deepEqual(reads,["C:/isolated/skill"]);assert.equal(rpc.length,0);source.unmount();
const pathless=make({plugins:{listSkills:async()=>({data:[{skills:[{name:"plugin:demo",path:"",pluginId:"guess@market",scope:"user",enabled:true,description:"remote"}],errors:[]}]})},bridge:{callAppServer:async(...args)=>{rpc.push(args);return {};}}});pathless.props.manageOnly=false;pathless.props.initialTab="skills";pathless.props.onTrySkill=()=>true;pathless.render();await pathless.tick();pathless.nodes(pathless.tree).find(n=>n.props.className?.includes("skill-list-row")).props.onClick();pathless.render();const missing=pathless.nodes(pathless.tree).find(n=>n.type==="SkillPreviewDialog");assert.equal(missing.props.canRetry,false);await assert.rejects(missing.props.loadContents(),/没有可读取/);assert.equal(rpc.length,0);assert.equal(await missing.props.onTry(),true);pathless.unmount();
const localA={id:"a",name:"A",path:"C:/isolated/a/SKILL.md",content:"A",installed:true,description:"A"};const localB={...localA,id:"b",name:"B",path:"C:/isolated/b/SKILL.md"};
const remoteRows=[localA,localB].map(item=>({...item,scope:"user",enabled:true}));const writes=[];let enabled=true;let pendingDelete=defer();let pendingToggle=defer();
const action=make({plugins:{listSkills:async()=>({data:[{skills:remoteRows.map(item=>({...item,enabled})),errors:[]}]}),setSkillEnabled:async args=>{writes.push(["toggle",args]);await pendingToggle.promise;enabled=false;}},bridge:{tauriInvoke:async(method,args)=>{if(method==="skills_list_local")return [localA,localB];if(method==="skill_delete"){writes.push(["delete",args]);return pendingDelete.promise;}return {};}}});
action.props.manageOnly=false;action.props.initialTab="skills";action.render();await action.tick();const getPreview=()=>action.nodes(action.tree).find(n=>n.type==="SkillPreviewDialog");const getRows=()=>action.nodes(action.tree).filter(n=>n.props.className?.includes("skill-list-row"));getRows()[0].props.onClick();action.render();getPreview().props.onToggle();getPreview().props.onToggle();action.render();assert.equal(writes.length,1);assert.equal(writes[0][1].name,"A","name stays available for colon selector");assert.equal(getPreview().props.busy,true);pendingToggle.resolve();await action.tick();assert.equal(getPreview().props.enabled,false,"header reads refreshed actual enabled state");
getPreview().props.onUninstall();action.render();getPreview().props.onClose();action.render();getRows()[1].props.onClick();action.render();assert.equal(getPreview().props.name,"B");pendingDelete.resolve({});await action.tick();assert.equal(getPreview().props.name,"B","late A deletion cannot close B");
pendingDelete=defer();getPreview().props.onUninstall();action.render();pendingDelete.reject(Error("delete denied"));await action.tick();assert.match(getPreview().props.actionFeedback.text,/delete denied/);assert.equal(getPreview().props.actionFeedback.kind,"error");action.unmount();
let cancelledDeletes=0;const cancelled=make({confirm:()=>false,plugins:{listSkills:async()=>({data:[{skills:[remoteRows[0]],errors:[]}]})},bridge:{tauriInvoke:async method=>{if(method==="skills_list_local")return [localA];if(method==="skill_delete")cancelledDeletes++;return {};}}});cancelled.props.manageOnly=false;cancelled.props.initialTab="skills";cancelled.render();await cancelled.tick();cancelled.nodes(cancelled.tree).find(n=>n.props.className?.includes("skill-list-row")).props.onClick();cancelled.render();cancelled.nodes(cancelled.tree).find(n=>n.type==="SkillPreviewDialog").props.onUninstall();await cancelled.tick();assert.equal(cancelledDeletes,0);assert.ok(cancelled.nodes(cancelled.tree).some(n=>n.type==="SkillPreviewDialog"));cancelled.unmount();
const contentsOnly=previewHarness(); contentsOnly.props.footer=null; contentsOnly.props.onTry=undefined; contentsOnly.render();
assert.equal(contentsOnly.nodes(contentsOnly.tree).some(node=>node.type==="footer"),false,"management contents preview omits the action footer, including a disabled Try button");
assert.equal(contentsOnly.text(contentsOnly.tree).includes("立即试用"),false); contentsOnly.unmount();
const asyncHost=previewHarness();const guarded=defer();let hostCalls=0;asyncHost.props.onOpen=()=>{hostCalls++;return guarded.promise;};asyncHost.button("更多操作").props.onClick({stopPropagation(){}});asyncHost.render();const nav1=asyncHost.button("打开").props.onClick();const nav2=asyncHost.button("打开").props.onClick();asyncHost.render();assert.equal(hostCalls,1);assert.equal(asyncHost.button("打开").props.disabled,true);guarded.resolve(false);await Promise.all([nav1,nav2]);await asyncHost.tick();assert.equal(asyncHost.close,0);assert.match(asyncHost.text(asyncHost.tree),/未保存修改/);asyncHost.props.path="";asyncHost.render();assert.equal(asyncHost.button("立即试用").props.disabled,false,"path is not a Try now qualification");asyncHost.unmount();
console.log("PASS SD03/06/07/09/10: no guessed RPC, refreshed enable state, single-flight writes, late uninstall isolation, cancelled/failed removal and asynchronous navigation guard");
// Browser revision: native Tab had escaped to body after the final enabled control.
const keyboard=previewHarness();let focused=null;const first={tabIndex:0,getClientRects:()=>[{}],matches:()=>false,focus(){focused=first;}};const middle={tabIndex:0,getClientRects:()=>[{}],matches:()=>false,focus(){focused=middle;}};const last={tabIndex:0,getClientRects:()=>[{}],matches:()=>false,focus(){focused=last;}};const hidden={tabIndex:0,getClientRects:()=>[],matches:()=>false,focus(){assert.fail("hidden control focused");}};
const documentFixture={activeElement:last};const target={ownerDocument:documentFixture,contains:value=>[first,middle,last].includes(value),querySelectorAll:()=>[hidden,first,middle,last]};
let prevented=false;const keyEvent=(key,extra={})=>({key,currentTarget:target,nativeEvent:{isComposing:false},preventDefault(){prevented=true;},stopPropagation(){},...extra});
keyboard.tree.props.onKeyDown(keyEvent("Tab"));assert.equal(prevented,true,"SD11: final Tab must wrap inside the dialog");assert.equal(focused,first);
prevented=false;documentFixture.activeElement=first;keyboard.tree.props.onKeyDown(keyEvent("Tab",{shiftKey:true}));assert.equal(prevented,true);assert.equal(focused,last);
prevented=false;documentFixture.activeElement=middle;keyboard.tree.props.onKeyDown(keyEvent("Tab"));assert.equal(prevented,false,"middle Tab retains normal browser movement");
prevented=false;keyboard.tree.props.onKeyDown(keyEvent("Escape",{nativeEvent:{isComposing:true}}));assert.equal(prevented,true);assert.equal(keyboard.close,0);keyboard.unmount();
const feedbackRevision=previewHarness();feedbackRevision.props.actionFeedback={kind:"success",text:"old toggle success"};feedbackRevision.render();await feedbackRevision.button("立即试用").props.onClick();await feedbackRevision.tick();assert.match(feedbackRevision.text(feedbackRevision.tree),/未保存修改/);feedbackRevision.props.actionFeedback={kind:"error",text:"new write failed"};feedbackRevision.render();assert.match(feedbackRevision.text(feedbackRevision.tree),/new write failed/);assert.doesNotMatch(feedbackRevision.text(feedbackRevision.tree),/未保存修改/);feedbackRevision.unmount();
console.log("PASS SD11 browser revision: boundary Tab wraps visible controls, middle Tab stays native, composition Escape blocked, newest feedback wins");
// 13G reuses the reading shell, while its caller supplies installation only.
const recommendedShell=previewHarness();let installClicks=0;
Object.assign(recommendedShell.props,{enabled:undefined,onToggle:undefined,onUninstall:undefined,onTry:undefined,showMoreActions:false,
  footer:{type:"button",props:{type:"button",className:"primary-btn-sm",onClick(){installClicks++;}},children:["安装技能"]}});
recommendedShell.render();
assert.equal(recommendedShell.nodes(recommendedShell.tree).filter(n=>n.props["aria-label"]==="更多操作").length,0,"RP04: recommended preview has no installed More menu");
assert.equal(recommendedShell.nodes(recommendedShell.tree).filter(n=>n.props.role==="switch").length,0);
assert.doesNotMatch(recommendedShell.text(recommendedShell.tree),/卸载|立即试用|复制 Markdown|在文件资源管理器中显示/);
assert.ok(recommendedShell.text(recommendedShell.tree).includes("正在加载技能内容…"));
recommendedShell.button("安装技能").props.onClick();assert.equal(installClicks,1);assert.equal(recommendedShell.close,0,"custom installation cannot implicitly close the reading shell");
recommendedShell.reads[0].reject(Error("source unavailable"));await recommendedShell.tick();assert.match(recommendedShell.text(recommendedShell.tree),/无法加载技能内容。/);recommendedShell.button("重试").props.onClick();recommendedShell.render();recommendedShell.reads[1].resolve("");await recommendedShell.tick();assert.match(recommendedShell.text(recommendedShell.tree),/暂无说明/);assert.ok(recommendedShell.button("安装技能"));
recommendedShell.tree.props.onCancel({preventDefault(){}});assert.equal(recommendedShell.close,1);recommendedShell.unmount();assert.equal(recommendedShell.dialog.open,false);assert.equal(recommendedShell.returnFocus,1,"recommended close restores the original connected focus");
const defaultShell=previewHarness();assert.ok(defaultShell.button("更多操作"));assert.ok(defaultShell.button("卸载"));assert.ok(defaultShell.button("立即试用"));defaultShell.unmount();assert.equal(defaultShell.returnFocus,1,"default close focus is unchanged");
console.log("PASS RP04 shared shell: custom install footer, no More or installed actions, shared loading/error/retry/empty states, default actions and close focus preserved");

export { make as mountSkillsDirectory };

const changingSource=previewHarness();changingSource.props.path="C:/updated/SKILL.md";changingSource.render();
assert.equal(changingSource.reads.length,2,"RP02 source path changes must start the current source read");
changingSource.reads[1].resolve("# Current\n\ncurrent body");await changingSource.tick();
changingSource.reads[0].resolve("# Old\n\nold body");await changingSource.tick();
assert.equal(changingSource.nodes(changingSource.tree).find(n=>n.type==="MarkdownView").props.content,"current body","RP02 late old source cannot overwrite the current body");changingSource.unmount();
console.log("PASS RP02 shared preview follows current source and rejects an old source read");
