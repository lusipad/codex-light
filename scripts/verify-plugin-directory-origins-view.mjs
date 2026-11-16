import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('src/components/PluginDirectoryOriginsView.tsx', 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const entry = (id, extra = {}) => ({rawId:id, listing:{id,displayName:id}, sources:['workspace'], ...extra});
const ready = {kind:'ready',structure:'workspace',name:'Actual workspace',identity:{accountId:'a',userId:'u',generation:1}};
function fixture(api = {}, initial = {}) {
  let cursor = 0, dirty = true, effects = [], tree;
  const slots = [], calls = [], changes = [], categories = [];
  let props = {tab:'openai',contextKey:'host:a',enabled:true,onTabChange:value=>changes.push(value),onCategory:value=>categories.push(value),renderListing:row=>({type:'listing',props:{id:row.id}}),children:{type:'public',props:{}},...initial};
  const react = {
    useState(value) {const i=cursor++; if (!(i in slots)) slots[i]=value; return [slots[i], update=>{const next=typeof update==='function'?update(slots[i]):update;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
    useRef(value) {const i=cursor++;return slots[i]??={current:value};},
    useEffect(run,deps) {const i=cursor++,prev=slots[i];if(!prev||deps.some((v,n)=>!Object.is(v,prev.deps[n])))effects.push(()=>{prev?.cleanup?.();slots[i]={deps,cleanup:run()};});},
  };
  const clients = {loadPluginDirectoryAccount:async()=>ready,loadPluginDirectoryPersonalSummary:async()=>({created:[],shared:null}),
    readPluginDirectoryOriginPage:async(a,kind,token,signal)=>{calls.push({kind,token,signal});return {entries:[],nextCursor:null};},
    readPluginDirectoryCreatedPage:async()=>({entries:[],nextCursor:null}),
    mergePluginDirectoryOriginPages:pages=>{const refs=new Set(pages.flat().map(row=>row.templatePluginId));return pages.flat().filter(row=>!row.isTemplate||!refs.has(row.rawId));},...api};
  const exports={};vm.runInNewContext(source,{exports,AbortController,Set,JSON,getComputedStyle:target=>({direction:target.direction??'ltr'}),require(name){
    if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
    if(name==='../pluginDirectoryOrigins')return clients;return {};
  }});
  function render(){for(let turn=0;dirty;turn++){assert.ok(turn<30);dirty=false;cursor=0;tree=exports.PluginDirectoryOriginsView(props);const pending=effects;effects=[];pending.forEach(run=>run());}return tree;}
  return {calls,changes,categories,get tree(){return render();},async settle(){render();for(let i=0;i<12;i++){await Promise.resolve();render();}return tree;},update(patch){props={...props,...patch};dirty=true;return render();},unmount(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const tabs = f => nodes(f.tree).filter(node=>node.props?.role==='tab');
const listings = f => nodes(f.tree).filter(node=>node.type==='listing').map(node=>node.props.id);
{
 const f=fixture();assert.deepEqual(tabs(f).map(n=>n.props.children),['公开','个人'],'unknown account does not invent workspace');await f.settle();
 assert.deepEqual(tabs(f).map(n=>n.props.children),['公开','Actual workspace']);
 const publicTab=tabs(f)[0];publicTab.props.onClick();assert.equal(f.changes.length,0);
 f.update({tab:'personal'});assert.equal(tabs(f).at(-1).props.children,'个人','explicit empty personal remains reachable');
 f.update({category:'public-category'});assert.equal(tabs(f).length,0);assert.ok(nodes(f.tree).some(n=>n.type==='public'),'public categories delegate to parent');f.unmount();
}
{
 const f=fixture({}, {tab:'personal',localGroups:[{id:'plugins-created-by-you',title:'ignored duplicate heading',count:8,content:{type:'full',props:{}},summaryContent:{type:'preview',props:{}}}]});await f.settle();
 assert.equal(nodes(f.tree).filter(n=>n.type==='h3').length,1);assert.ok(nodes(f.tree).some(n=>n.type==='preview'));assert.ok(!nodes(f.tree).some(n=>n.type==='full'));
 nodes(f.tree).find(n=>n.type==='button'&&n.props.children==='查看更多').props.onClick();assert.equal(f.categories[0],'plugins-created-by-you');
 f.update({category:'plugins-created-by-you'});await f.settle();assert.ok(nodes(f.tree).some(n=>n.type==='full'));f.unmount();
}
{
 let resolve; const pending = new Promise(r=>resolve=r);
 const f=fixture({readPluginDirectoryOriginPage:async(a,kind,token,signal)=>{f.calls.push({kind,token,signal});return token===null?{entries:[entry('template',{isTemplate:true})],nextCursor:'next'}:pending;}},{tab:'workspace'});
 await f.settle();assert.deepEqual(listings(f),['template']);
 let more=nodes(f.tree).find(n=>n.type==='button'&&n.props.children==='加载更多');more.props.onClick();more.props.onClick();assert.equal(f.calls.length,2,'next page is single flight');
 resolve({entries:[entry('instance',{templatePluginId:'template'})],nextCursor:null});await f.settle();assert.deepEqual(listings(f),['instance'],'later instances suppress previous-page templates');f.unmount();
}
{
 let resolve;const pending=new Promise(r=>resolve=r);
 const f=fixture({readPluginDirectoryOriginPage:async(a,kind,token,signal)=>{f.calls.push({signal});return pending;}},{tab:'workspace'});await f.settle();
 f.update({tab:'openai'});assert.ok(f.calls[0].signal.aborted);resolve({entries:[entry('late')],nextCursor:null});await f.settle();assert.deepEqual(listings(f),[]);f.unmount();
}
{
 const f=fixture({loadPluginDirectoryPersonalSummary:async()=>({created:[entry('mine')],shared:null})});await f.settle();const list=nodes(f.tree).find(n=>n.props?.role==='tablist');
 const buttons=tabs(f).map((node,index)=>({index,focus(){this.focused=true;},scrollIntoView(){}}));
 let prevented=0, stopped=0;const target={direction:'rtl',querySelectorAll:()=>buttons};
 list.props.onKeyDown({key:'ArrowRight',target:buttons[0],currentTarget:target,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 assert.equal(f.changes.at(-1),'personal');assert.equal(prevented,1);assert.equal(stopped,1);assert.ok(buttons.at(-1).focused);
 f.update({tab:'personal'});nodes(f.tree).find(n=>n.props?.role==='tablist').props.onKeyDown({key:'Home',target:buttons.at(-1),currentTarget:target,preventDefault(){},stopPropagation(){}});assert.equal(f.changes.at(-1),'openai');
 const count=f.changes.length;list.props.onKeyDown({key:'ArrowRight',ctrlKey:true,target:buttons[0],currentTarget:target});assert.equal(f.changes.length,count);f.unmount();
}
{
 let fail=true;
 const f=fixture({readPluginDirectoryOriginPage:async(a,kind,token)=>{f.calls.push(token);if(token && fail){fail=false;throw Error('page unavailable');}return {entries:[entry(token?'second':'first')],nextCursor:token?null:'page-2'};}},{tab:'workspace'});
 await f.settle();nodes(f.tree).find(n=>n.type==='button'&&n.props.children==='加载更多').props.onClick();await f.settle();
 assert.deepEqual(listings(f),['first'],'page failure preserves earlier rows');assert.ok(nodes(f.tree).some(n=>n.props?.role==='alert'));
 nodes(f.tree).find(n=>n.type==='button'&&n.props.children==='重试').props.onClick();await f.settle();
 assert.deepEqual(listings(f),['first','second']);assert.deepEqual(f.calls,[null,'page-2','page-2']);f.unmount();
}
{
 const cursor={userPageToken:null,workspaceCreatedPageToken:'workspace-only'};
 const f=fixture({readPluginDirectoryCreatedPage:async(a,token)=>{f.calls.push(token);return {entries:[entry(token?'created-2':'created-1')],nextCursor:token?null:cursor};}},{tab:'personal',category:'plugins-created-by-you'});
 await f.settle();nodes(f.tree).find(n=>n.type==='button'&&n.props.children==='加载更多').props.onClick();await f.settle();
 assert.equal(f.calls[1],cursor,'Created keeps the client dual cursor object intact');assert.deepEqual(listings(f),['created-1','created-2']);f.unmount();
}
{
 const local={id:'plugins-created-by-you',title:'由你创建',count:1,content:{type:'local-card',props:{}}};
 for(const category of [null,'plugins-created-by-you']) {
  const f=fixture({loadPluginDirectoryAccount:async()=>{throw Error('account unavailable');}},{tab:'personal',category,localGroups:[local]});await f.settle();
  assert.equal(nodes(f.tree).filter(n=>n.type==='local-card').length,1,'account errors cannot suppress real local Personal cards');
  assert.ok(nodes(f.tree).some(n=>n.props?.role==='alert'));f.unmount();
 }
 const loading=fixture({loadPluginDirectoryAccount:()=>new Promise(()=>{})},{tab:'personal',localGroups:[local]});await loading.settle();
 assert.equal(nodes(loading.tree).filter(n=>n.type==='local-card').length,1,'account loading cannot suppress local cards');loading.unmount();
}
{
 for(const category of ['public-category','plugins-marketplace-real']) {
  const f=fixture({}, {tab:'workspace',category,localGroups:[{id:'plugins-marketplace-real',title:'Market',count:1,content:{type:'market-card',props:{}}}]});await f.settle();
  assert.equal(f.calls.length,0,'category does not accidentally load Workspace directory');
  assert.ok(nodes(f.tree).some(n=>n.type===(category==='public-category'?'public':'market-card')));f.unmount();
 }
 const f=fixture({}, {category:'public-category',children:{type:'button',props:{className:'pm-catalog-back',children:'全部插件'}}});await f.settle();
 assert.equal(nodes(f.tree).filter(n=>n.props?.className==='pm-catalog-back').length,1,'Public category owns its existing back link');f.unmount();
}
{
 let localRetries=0, accountReads=0;
 const f=fixture({loadPluginDirectoryAccount:async()=>{accountReads++;return ready;}},{tab:'personal',category:'plugins-marketplace-real',localLoading:true,onRetryLocal:()=>localRetries++});await f.settle();
 assert.ok(nodes(f.tree).some(n=>n.props?.role==='status'));assert.ok(!nodes(f.tree).some(n=>n.props?.children==='未找到插件'));
 f.update({localLoading:false,localError:'disk unavailable'});assert.ok(nodes(f.tree).some(n=>n.props?.role==='alert'));
 nodes(f.tree).find(n=>n.type==='button'&&n.props.children==='重试').props.onClick();await f.settle();
 assert.equal(localRetries,1);assert.equal(accountReads,1,'local retry must not reread remote account');f.unmount();
}
console.log('Plugin directory origins view: source qualification, local independence/retry, category delegation, paging/retry, dual cursors, late results and keyboard passed.');
