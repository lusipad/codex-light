import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS};
const registry={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/shortcuts.ts','utf8'),{compilerOptions}).outputText,{exports:registry.exports});
const ast=ts.createSourceFile('App.tsx',fs.readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const nodes=new Map();let handlers,effect;
function visit(node){
 if(ts.isVariableDeclaration(node))nodes.set(node.name.getText(ast),node.initializer);
 if(ts.isBinaryExpression(node)&&node.left.getText(ast)==='shortcutHandlersRef.current')handlers=node.right;
 if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('const matcher = createShortcutMatcher'))effect=node.arguments[0];
 ts.forEachChild(node,visit);
}visit(ast);
assert.ok(handlers&&effect);
const events=[],windowListeners=new Map();let now=1000,renderedCollapsed=false,modal=false,componentHandles=true;
const rows=[['b',true],['hidden',false],['a',true],['b',true]].map(([id,visible])=>({dataset:{threadId:id},isConnected:true,getClientRects:()=>visible?[{}]:[],closest:()=>null}));
const context={...registry.exports,Date:{now:()=>now},
 environmentActionRunner:{current:null},
 shortcutHandlersRef:{current:{}},shortcutTimestampsRef:{current:{}},keyboardBindingsRef:{current:[]},keyboardNumberTargetRef:{current:'tabs'},
 keyboardState:{capturing:{current:false}},keyboardContextRef:{current:{activeThreadId:'a',activeRoute:'thread',hasWorkspace:true}},
 isQuickChatWindow:false,activeThreadId:'a',activeThreadObj:{id:'a',readState:{revision:'r',firstUnread:null}},activeRoute:'thread',activeWorkspace:{path:'A'},
 showRightDrawer:true,initialWorkbenchTab:'changes',sidebarCollapsed:false,workbenchShortcutSequence:{current:0},
 threadsRef:{current:[{id:'a'},{id:'b'}]},pinnedThreadIds:[],turns:[],
 gitContextCwd:'A',gitStatus:{branch:'main'},
 getComputedStyle:()=>({visibility:'visible'}),flushSync:fn=>fn(),
 setSidebarCollapsed:value=>{renderedCollapsed=value;events.push(['collapsed',value]);},
 setShowRightDrawer:value=>events.push(['drawer',value]),setInitialWorkbenchTab:value=>events.push(['initialTab',value]),
 setWorkbenchShortcutRequest:value=>events.push(['request',value]),
 selectThread:async id=>events.push(['select',id]),handleThreadMenuAction:async id=>events.push(['thread-menu',id]),
 handleSetThreadReadState:async(...args)=>events.push(['receipt',...args]),isThreadReadState:value=>!!value,
 handleDeleteThread:async thread=>events.push(['delete',thread.id]),handleCreateBranch:async name=>events.push(['branch',name]),
 startNewThread:()=>events.push(['new']),handleOpenQuickChat:()=>{},
 requestTerminalPanel:action=>events.push(['terminal',action]),
 CustomEvent:class {constructor(type,options){this.type=type;Object.assign(this,options);this.defaultPrevented=false;}preventDefault(){this.defaultPrevented=true;}},
 window:{addEventListener:(type,fn,capture)=>windowListeners.set(capture?`${type}:capture`:type,fn),
  removeEventListener:(type,fn,capture)=>windowListeners.delete(capture?`${type}:capture`:type),
  dispatchEvent:event=>{events.push(['component',event.detail.id]);if(componentHandles)event.preventDefault();return !event.defaultPrevented;},prompt:()=>null},
 document:{querySelector:selector=>selector.includes('aria-modal')||selector.includes('dialog[')?(modal?{}:null):selector==='.diff-drawer'?{}:null,
  querySelectorAll:()=>renderedCollapsed?[]:rows},
};
vm.createContext(context);
const evaluate=source=>vm.runInContext(ts.transpileModule(source,{compilerOptions}).outputText,context);
for(const name of ['dispatchComponentShortcut','requestWorkbenchShortcut','sidebarShortcutThreadIds','selectAdjacentThread'])evaluate(`var ${name}=${nodes.get(name).getText(ast)};`);
evaluate(`shortcutHandlersRef.current=${handlers.getText(ast)};`);
evaluate(`var runShortcutAction=${nodes.get('runShortcutAction').arguments[0].getText(ast)};`);
evaluate(`var cleanup=(${effect.getText(ast)})();`);
const target=kind=>({value:'text',selectionStart:0,selectionEnd:0,closest:selector=>{
 if(kind==='composer'&&(selector.includes('.codex-two-tier-composer')||selector.startsWith('input,')))return {};
 if(kind==='approval'&&selector.includes('[data-keyboard-approval]'))return {};
 if(kind==='input'&&selector.startsWith('input,'))return {};
 if(kind==='terminal'&&selector==='.xterm')return {};
 return null;
}});
function key(key,extra={}){
 now+=300;let prevented=false,stopped=false;
 const event={key,code:'',keyCode:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false,defaultPrevented:false,target:target('body'),
  preventDefault(){prevented=true;this.defaultPrevented=true;},stopPropagation(){stopped=true;},...extra};
 windowListeners.get('keydown:capture')(event);
 if(!stopped) windowListeners.get('keydown')(event);
 return prevented;
}
context.keyboardBindingsRef.current=[{command:'composer.submit',key:'Enter'}];
assert.equal(key('Enter',{target:target('composer')}),true);assert.equal(events.at(-1)[1],'composer-submit');
componentHandles=false;assert.equal(key('Enter',{target:target('composer')}),false,'unhandled local command must not swallow native input');componentHandles=true;
assert.equal(key('Enter',{target:target('approval')}),true);assert.equal(events.at(-1)[1],'approval-approve');
assert.equal(key('Enter',{target:target('input')}),false);
context.keyboardBindingsRef.current=[{command:'newTask',key:'G H'}];
const count=events.length;assert.equal(key('g',{target:target('composer')}),false);assert.equal(key('h',{target:target('composer')}),false);assert.equal(events.length,count,'global plain-letter sequence cannot steal composer text');
assert.equal(key('g'),true);assert.equal(key('h'),true);assert.equal(events.at(-1)[0],'new');
context.keyboardBindingsRef.current=[{command:'composer.submit',key:'Enter'}];
assert.equal(key('Enter',{target:target('composer'),isComposing:true}),false);
assert.equal(key('Enter',{target:target('composer'),repeat:true}),true);
modal=true;const beforeModal=events.length;assert.equal(key('n',{ctrlKey:true}),false);assert.equal(events.length,beforeModal);modal=false;
context.keyboardState.capturing.current=true;assert.equal(key('n',{ctrlKey:true}),false);context.keyboardState.capturing.current=false;
context.keyboardBindingsRef.current=[];
const terminal=target('terminal');
const captureResults=[];
assert.equal(key('j',{ctrlKey:true,target:terminal,stopPropagation(){captureResults.push('stopped');}}),true);
assert.deepEqual(captureResults,['stopped'],'terminal shortcut must stop before xterm input processing');
assert.deepEqual(events.at(-1),['terminal','toggle-bottom']);
assert.equal(key('`',{code:'Backquote',ctrlKey:true,target:terminal}),true);
assert.deepEqual(events.at(-1),['terminal','open-terminal']);
assert.equal(key('j',{target:terminal}),false,'ordinary terminal input remains available');
assert.equal(key('j',{ctrlKey:true,isComposing:true,target:terminal}),false);
context.keyboardBindingsRef.current=[{command:'toggleBottomPanel',key:null}];
assert.equal(key('j',{ctrlKey:true,target:terminal}),false,'disabled binding reaches the terminal');
// Body selection follows visible DOM order, ignores hidden/duplicates, does not wrap.
context.shortcutHandlersRef.current['previous-thread']();assert.deepEqual(events.at(-1),['select','b']);
context.activeThreadId='b';assert.equal(context.shortcutHandlersRef.current['previous-thread'](),false);
context.sidebarCollapsed=true;renderedCollapsed=true;
context.shortcutHandlersRef.current['sidebar-thread-2']();assert.deepEqual(events.slice(-3),[['collapsed',false],['collapsed',true],['select','a']]);assert.equal(renderedCollapsed,true,'temporary sidebar mount restores collapsed shell');
context.sidebarCollapsed=false;renderedCollapsed=false;
context.shortcutHandlersRef.current['mark-thread-unread']();assert.deepEqual(events.at(-1),['receipt','b','r',true]);
context.shortcutHandlersRef.current['copy-conversation-markdown']();assert.deepEqual(events.at(-1),['thread-menu','copy_markdown']);
context.shortcutHandlersRef.current['open-thread-new-window']();assert.deepEqual(events.at(-1),['thread-menu','open_new_window']);
context.shortcutHandlersRef.current['delete-chat']();assert.deepEqual(events.at(-1),['delete','a']);
context.showRightDrawer=false;assert.equal(context.requestWorkbenchShortcut('next-tab'),false);
context.requestWorkbenchShortcut('git-commit');let request=events.at(-1)[1];assert.equal(request.cwd,'A');assert.equal(request.wasOpen,false);
context.showRightDrawer=true;context.initialWorkbenchTab='files';context.requestWorkbenchShortcut('toggle-file-tree');assert.equal(events.at(-1)[0],'request','actual Files toggle belongs to Drawer, not stale initialTab');
context.activeWorkspace=null;context.requestWorkbenchShortcut('next-tab');assert.equal(events.at(-1)[1].cwd,'','existing tabs do not require a workspace');assert.equal(context.requestWorkbenchShortcut('git-commit'),false);
// Native and webview paths share the actual production dedup dispatcher.
const duplicateBefore=events.filter(item=>item[0]==='new').length;
now+=300;context.runShortcutAction('new-chat');context.runShortcutAction('new-chat');
assert.equal(events.filter(item=>item[0]==='new').length,duplicateBefore+1);
const native=nodes.get('handleAppCommand').arguments[0].getText(ast);assert.match(native,/runShortcutAction\(command, payload\)/);
context.keyboardContextRef.current.activeRoute='cloud-draft';
const beforeCloud=events.length;
for(const action of ['delete-chat','git-commit','toggle-terminal','open-side-chat','composer-submit']) assert.equal(context.runShortcutAction(action),false);
assert.equal(events.length,beforeCloud,'cloud route cannot act on the previous local thread');
now+=300;assert.equal(context.runShortcutAction('new-chat'),true);
context.cleanup();assert.equal(windowListeners.size,0);
console.log('PASS production App keyboard routing: local Enter scopes, input/IME/repeat/modal/capture guards, visible sidebar order/collapsed restoration, shared thread actions, workbench requests and native dedup');
