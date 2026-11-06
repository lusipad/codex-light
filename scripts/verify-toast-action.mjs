import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const file=ts.createSourceFile('App.tsx',fs.readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback,toast;
function visit(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='showAppToast')callback=node.initializer.arguments[0];
  if(ts.isJsxElement(node)&&node.openingElement.getText(file).includes('app-global-toast'))toast=node;
  ts.forEachChild(node,visit);
}
visit(file);assert.ok(callback&&toast);
let current=null;const timers=[],seen=[];
const env={appToastSequenceRef:{current:0},setAppToast:value=>{current=typeof value==='function'?value(current):value;},
  setTimeout:fn=>timers.push(fn),Date:{now:()=>1}};
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const show=vm.runInNewContext(compile(`(${callback.getText(file)})`),env);
show('failure','error',{label:'Retry',onClick:()=>seen.push(current)});
assert.equal(current.action?.label,'Retry','TA01 action is retained for the rendered toast');
const first=current;first.action.onClick();first.action.onClick();
assert.equal(seen.length,1,'TA02 rapid activation invokes an action once');assert.equal(seen[0],null,'toast closes before retry');
show('old','info');const old=current;show('new','info');assert.notEqual(current.id,old.id);
timers.at(-2)();assert.equal(current.message,'new','TA03 an older timer cannot clear a newer toast in the same tick');
show('retry','error',{label:'Retry',onClick:()=>seen.push('latest')});
const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};
const node=vm.runInNewContext(compile(`(${toast.getText(file)})`),{React,appToast:current,setAppToast:env.setAppToast});
const button=node.props.children.find(child=>child?.type==='button');assert.ok(button,'TA04 action is a real keyboard-accessible button');
assert.equal(button.props.type,'button');button.props.onClick();assert.equal(seen.at(-1),'latest');
console.log('PASS TA01–04: rendered action, close-before-retry, one-shot activation and timer ownership');
