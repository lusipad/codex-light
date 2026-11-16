import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
const baseline = process.argv.includes('--baseline');
const read = path => baseline ? execFileSync('git', ['show', `1f83d77227b924bb0190b814ea382c00c930dfc0:${path}`], {encoding:'utf8'}) : fs.readFileSync(path,'utf8');
const parse = path => ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app = parse('src/App.tsx'), settings = parse('src/components/SettingsView.tsx');
function code(ast,name) {
  let found;
  function walk(node) {
    if(ts.isVariableDeclaration(node) && node.name.getText(ast)===name && ts.isCallExpression(node.initializer)) found=node.initializer.arguments[0];
    ts.forEachChild(node,walk);
  }
  walk(ast);
  assert.ok(found && (ts.isArrowFunction(found)||ts.isFunctionExpression(found)),`${name} must be a production guarded callback`);
  return ts.transpileModule(`(${found.getText(ast)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const routeCommits=[], sectionCommits=[], forwarded=[];
const management = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/pluginManagementLocation.ts','utf8'), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText,{exports:management,URL,URLSearchParams});
let pending, dirty=true, guards=0;
const guard = action => {guards++; if(!dirty)return true; pending=action;return false};
const context = {
  parsePluginManagementLocation:management.parsePluginManagementLocation,
  pluginManagementNavigationRef:{current:null},
  window:{location:{href:'https://codex.invalid/'},history:{state:null,replaceState(){}}},
  URL,
  activeRouteRef:{current:'settings'},personalizationNavigationGuardRef:{current:guard},
  commitActiveRoute:route=>routeCommits.push(route),
  activeSectionRef:{current:'personalization'},commitActiveSection:section=>sectionCommits.push(section),
  onNavigationGuardChange:value=>forwarded.push(value),
  settingsGuardsRef:{current:{personalization:null,account:null,profile:null,mcp:null,plugins:null}},
};
context.setActiveRoute=vm.runInNewContext(code(app,'setActiveRoute'),context);
context.setActiveRoute('thread');
assert.deepEqual(routeCommits,[],'dirty route must not commit');
assert.equal(context.activeRouteRef.current,'settings');
assert.equal(typeof pending,'function');
dirty=false;pending();assert.deepEqual(routeCommits,['thread']);
context.setActiveRoute(current=>current==='thread'?'settings':'home');
assert.equal(context.activeRouteRef.current,'settings','functional toggles use the latest committed route');
const before=guards;context.setActiveRoute('settings');assert.equal(guards,before,'same route does not ask to discard');
context.setActiveSection=vm.runInNewContext(code(settings,'setActiveSection'),context);
dirty=true;context.setActiveSection('agent');assert.deepEqual(sectionCommits,[]);assert.equal(context.activeSectionRef.current,'personalization');
dirty=false;pending();assert.deepEqual(sectionCommits,['agent']);
const register=vm.runInNewContext(code(settings,'registerPersonalizationNavigationGuard'),context);
context.publishSettingsGuard=vm.runInNewContext(code(settings,'publishSettingsGuard'),context);
register(guard);assert.equal(forwarded.at(-1),guard);register(null);assert.equal(forwarded.at(-1),null);assert.equal(context.personalizationNavigationGuardRef.current,null);
const registerProfile=vm.runInNewContext(code(settings,'registerProfileNavigationGuard'),context);
const registerAccount=vm.runInNewContext(code(settings,'registerAccountNavigationGuard'),context);
register(guard);registerProfile(()=>true);registerProfile(null);
assert.equal(forwarded.at(-1),guard,'profile cleanup must not erase the active instruction guard');
register(null);
const registerMcp=vm.runInNewContext(code(settings,'registerMcpNavigationGuard'),context);
registerMcp(guard);registerAccount(()=>true);registerAccount(null);
assert.equal(forwarded.at(-1),guard,'account cleanup must not erase an active MCP draft guard');
dirty=true;context.setActiveSection('account');
assert.equal(context.activeSectionRef.current,'agent','MCP draft defers navigation to another settings section');
dirty=false;pending();assert.equal(context.activeSectionRef.current,'account');
registerMcp(null);assert.equal(forwarded.at(-1),null);
let profilePending, profileDirty=true;
const profileGuard=action=>{if(!profileDirty)return true;profilePending=action;return false};
registerProfile(profileGuard);registerAccount(()=>true);registerAccount(null);
assert.equal(forwarded.at(-1),profileGuard,'account cleanup must not erase the active public profile guard');
context.setActiveSection('profile');assert.deepEqual(sectionCommits,['agent','account']);
profileDirty=false;profilePending();assert.deepEqual(sectionCommits,['agent','account','profile']);
registerProfile(null);assert.equal(forwarded.at(-1),null);
const registerPlugins=vm.runInNewContext(code(settings,'registerPluginNavigationGuard'),context);
registerPlugins(guard);registerMcp(()=>true);registerMcp(null);
assert.equal(forwarded.at(-1),guard,'MCP cleanup must not erase the nested management draft guard');
registerPlugins(null);assert.equal(forwarded.at(-1),null);
context.personalizationNavigationGuardRef.current=guard;
context.routeHistoryRef={current:{entries:['home','thread','settings'],index:2}};
context.navigatingRouteHistoryRef={current:false};context.setRouteHistoryVersion=()=>{};
context.navigateRouteHistory=vm.runInNewContext(code(app,'navigateRouteHistory'),context);
dirty=true;context.navigateRouteHistory(-1);assert.equal(context.routeHistoryRef.current.index,2,'history index stays put before confirmation');assert.equal(context.navigatingRouteHistoryRef.current,false);
dirty=false;pending();assert.equal(context.routeHistoryRef.current.index,1);assert.equal(context.activeRouteRef.current,'thread');
for(const name of ['startNewThread','selectThread']){
  let action;
  const ref={current:next=>{action=next;return false}};
  const nav={personalizationNavigationGuardRef:ref};
  nav[name]=vm.runInNewContext(code(app,name),nav);
  await nav[name]('target');
  assert.equal(typeof action,'function',`${name} defers before project/thread reads or any other side effects`);
}
const appSource=app.getFullText(), settingsSource=settings.getFullText();
assert.ok(appSource.includes('onNavigationGuardChange={setPersonalizationNavigationGuard}'));
assert.ok(settingsSource.includes('onNavigationGuardChange={registerPersonalizationNavigationGuard}'));
assert.ok(settingsSource.includes('accountIdentity={accountIdentity}')&&settingsSource.includes('connectionIdentity='));
console.log('PASS PI-B03 production App/Settings navigation: route, history, section, new-thread and select-thread defer before effects; confirm resumes; same route and cleanup are stable');
