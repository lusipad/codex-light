import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/components/DiffDrawer.tsx', 'utf8');
const ast = ts.createSourceFile('drawer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['WorkspaceDirectoryEntry', 'toDirectoryEntryItems', 'compareDirectoryEntries'];
const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(declarations.length, names.length);
const code = ts.transpileModule(declarations.map(n => n.getText(ast)).join('\n') + '\nWorkspaceDirectoryEntry', {compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((r,j) => {resolve=r;reject=j;}); return {promise,resolve,reject}; };
const plain = x => JSON.parse(JSON.stringify(x));
function mount() {
  const values=[], dependencies=[], cleanups=[], jobs=[], reads=[], fallbacks=[], watches=[], stops=[];
  let cursor=0, toggle, tree;
  const props={item:{name:'src',path:'D:/root/src',isDirectory:true},depth:0,refreshToken:[],renderRow:(item,depth,expanded,fn)=>{toggle=fn;return {type:'row',props:{item,depth,expanded}};}};
  const context = {
    React:{useId:()=> 'tree-group',Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props??{},children})},
    useState:initial=>{const slot=cursor++;if(!(slot in values))values[slot]=initial;return [values[slot],value=>{values[slot]=typeof value==='function'?value(values[slot]):value;}];},
    useEffect:(fn,deps)=>{const slot=cursor++;if(!dependencies[slot]||deps.some((v,i)=>v!==dependencies[slot][i])){dependencies[slot]=deps;jobs.push(()=>{cleanups[slot]?.();cleanups[slot]=fn();});}},
    fsReadDirectory:path=>{const d=deferred();reads.push({path,...d});return d.promise;},
    invoke:(command,args)=>{const d=deferred();fallbacks.push({command,args,...d});return d.promise;},
    fsWatchPath:(path,callback)=>{const d=deferred();watches.push({path,callback,...d});return d.promise;},
    joinFsPath:(root,name)=>root+'/'+name,
  };
  const Component=vm.runInNewContext(code,context);
  const render=()=>{cursor=0;tree=Component(props);while(jobs.length)jobs.shift()();return tree;};
  const settle=async()=>{await new Promise(resolve => setImmediate(resolve));render();};
  render();
  return {values,props,reads,fallbacks,watches,stops,render,settle,get tree(){return tree;},expand:value=>{toggle(value);render();},dispose:()=>cleanups.forEach(fn=>fn?.())};
}
{
 const view=mount();assert.equal(view.reads.length,0,'collapsed tree does not traverse disk');
 view.expand(true);assert.equal(view.reads.length,1);
 view.reads[0].resolve([{fileName:'nested',isDirectory:true},{fileName:'.config',isDirectory:false},{fileName:'a.ts',isDirectory:false}]);await view.settle();
 assert.deepEqual(plain(view.values[1]).map(e=>e.name),['nested','.config','a.ts'],'directories first and hidden entries retained');
 const group=view.tree.children[1];const childNodes=group.children[1];
 assert.equal(childNodes.length,3);assert.equal(childNodes[0].props.depth,1);assert.equal(view.reads.length,1,'children are lazy independent nodes');
 view.watches[0].resolve(()=>view.stops.push('stopped'));await view.settle();view.expand(false);assert.equal(view.stops.length,1,'collapse releases watcher');
 const previous=view.values[1];view.watches[0].callback();assert.equal(view.reads.length,1,'late watcher callback ignored');
 view.expand(true);view.expand(false);view.reads[1].resolve([{fileName:'stale',isFile:true}]);await view.settle();assert.equal(view.values[1],previous,'late read after collapse discarded');
 view.dispose();
}
{
 const view=mount();view.expand(true);view.reads[0].reject(new Error('protocol offline'));await view.settle();
 assert.equal(view.fallbacks[0].command,'fs_list_dir');assert.equal(view.fallbacks[0].args.showHidden,true);
 view.fallbacks[0].reject(new Error('denied'));await view.settle();assert.match(view.values[3],/denied/,'local error retained on failing node');
 const alert=view.tree.children[1].children[1];assert.equal(alert.props.role,'alert');
 alert.children[1].props.onClick();view.render();assert.equal(view.reads.length,2,'retry issues a real directory read');
 view.reads[1].resolve([]);await view.settle();assert.equal(view.values[3],null);assert.equal(view.values[1].length,0);
 view.dispose();
}
{
 const view=mount();view.expand(true);view.props.item={...view.props.item,path:'E:/other/src'};view.render();
 view.reads[0].resolve([{fileName:'wrong-root',isFile:true}]);await view.settle();assert.equal(view.values[1].length,0,'old root completion cannot populate new root');
 view.reads[1].resolve([{fileName:'right-root',isFile:true}]);await view.settle();assert.equal(view.values[1][0].name,'right-root');
 view.watches[0].resolve(()=>view.stops.push('old'));await view.settle();assert.equal(view.stops.length,1,'late watch registration immediately released');
 view.dispose();
}
console.log('PASS actual recursive tree: lazy children, hidden entries, local fallback/error/retry, collapse cleanup, stale root/read/watch isolation; native pointer/pixels unverified');

// Production root selector and filter effects: no file writes or editor replacement.
let rootChange, searchEffect, nestedWatchEffect;
function visit(node) {
 if(ts.isJsxOpeningElement(node)){
  const attrs=node.attributes.properties;const attr=name=>attrs.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)===name)?.initializer;
  if(attr('aria-label')?.getText(ast)==='"选择文件树根目录"')rootChange=attr('onChange')?.expression;
 }
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'){
  const text=node.arguments[0]?.getText(ast)??'';
  if(text.includes('fs_search_files'))searchEffect=node.arguments[0];
  if(text.includes('fsWatchPath(path')&&text.includes('filePreviewRef'))nestedWatchEffect=node.arguments[0];
 }
 ts.forEachChild(node,visit);
}
visit(ast);assert.ok(rootChange&&searchEffect&&nestedWatchEffect);
const expression=node=>ts.transpileModule('('+node.getText(ast)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
{
 const events=[],seq={current:3};const context={dirLoadSeqRef:seq};
 for(const name of ['setDirEntries','setDirError','setFileSearchHits','setExplorerDraft','setCurrentDir'])context[name]=value=>events.push([name,plain(value)]);
 vm.runInNewContext(expression(rootChange),context)({target:{value:'E:/project'}});
 assert.equal(seq.current,4);assert.deepEqual(events.at(-1),['setCurrentDir','E:/project']);
 assert.equal(events.some(([name])=>/Preview|Dirty|Content/.test(name)),false,'root switching must leave editor intact');
}
{
 const pending=[],events=[];const context={open:true,activeTab:'files',currentDir:'E:/project',fileFilterQuery:'name',
  invoke:(command,args)=>{const d=deferred();pending.push({command,args,...d});return d.promise;},
  setFileSearchHits:value=>events.push(['hits',plain(value)]),setFileSearchLoading:value=>events.push(['loading',value]),setFileSearchError:value=>events.push(['error',value])};
 const effect=vm.runInNewContext(expression(searchEffect),context);const cleanup=effect();
 assert.equal(pending[0].args.cwd,'E:/project','search uses chosen root without changing chat cwd');
 cleanup();pending[0].resolve([{absPath:'E:/project/stale'}]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(events.some(([name,value])=>name==='hits'&&value.length),false,'obsolete root/filter response cannot replace hits');
}
{
 let notify,unwatch;const events=[],preview={current:{path:'D:/root/src/a.ts'}},dirty={current:true};
 const context={open:true,activeTab:'files',filePreview:preview.current,currentDir:'D:/root',filePreviewRef:preview,isDirtyRef:dirty,
  parentFsPath:path=>path.slice(0,path.lastIndexOf('/')),fsWatchPath:(path,callback)=>{notify=callback;return Promise.resolve(()=>events.push(['stop']));},
  openFilePreview:(path,options)=>events.push(['preview',path,options.silent])};
 unwatch=vm.runInNewContext(expression(nestedWatchEffect),context)();await Promise.resolve();notify();assert.equal(events.length,0,'external changes preserve dirty nested draft');
 dirty.current=false;notify();assert.deepEqual(events[0],['preview','D:/root/src/a.ts',true]);
 unwatch();notify();assert.equal(events.length,2,'closed nested watcher cannot refresh editor');
}
console.log('PASS production root/filter/watch callbacks: selected-root scope, editor preservation, stale filter isolation, nested clean refresh and dirty protection');
