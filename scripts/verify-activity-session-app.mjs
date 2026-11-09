import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ast=ts.createSourceFile('App.tsx',fs.readFileSync('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=new Map(); let removal, scheduledEffect;
function visit(n){
  if(ts.isVariableDeclaration(n))declarations.set(n.name.getText(ast),n.initializer);
  if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('await getSchedulerStatus()'))scheduledEffect=n.arguments[0];
  if(ts.isIfStatement(n)&&n.expression.getText(ast).includes('NOTIFICATION.THREAD_ARCHIVED')&&n.expression.getText(ast).includes('NOTIFICATION.THREAD_DELETED'))removal=n.thenStatement.getText(ast);
  ts.forEachChild(n,visit);
}
visit(ast);
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const protocol={exports:{}}; vm.runInNewContext(transpile(fs.readFileSync('src/protocol.ts','utf8')),{exports:protocol.exports});
const activity={exports:{}}; vm.runInNewContext(transpile(fs.readFileSync('src/threadActivity.ts','utf8')),{exports:activity.exports,require:()=>protocol.exports});
const run=(name,context)=>vm.runInNewContext(transpile(`(${declarations.get(name).arguments[0].getText(ast)})`),context);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const read={revision:'read',firstUnread:null};
const unread=revision=>({revision,firstUnread:{type:'threadStart'}});
const rows=Array.from({length:13},(_,i)=>({id:`t${i}`,readState:unread('list-old')}));
function mount(){
  const writes=[],errors=[];let state=null,refreshes=0;
  const context={...activity.exports,...protocol.exports,threadsRef:{current:rows},activitySessionRef:{current:null},activityGenerationRef:{current:0},activityScopeRef:{current:'local'},activityPriorityVisibleRef:{current:true},activityExclusionsRef:{current:new Set()},activityScheduleIdsRef:{current:null},activityScheduleUnreadRef:{current:null},personalizationNavigationGuardRef:{current:null},readStateWritesRef:{current:new Set()},Date,
    setActivitySession:value=>{state=typeof value==='function'?value(state):value;},refreshThreads:async()=>{refreshes++;},showAppToast:(...args)=>errors.push(args),callAppServer:async(method,args)=>{writes.push({method,args});return method==='thread/read'?{readState:unread('fresh-read')}:{readState:read};}};
  return {context,writes,errors,get state(){return state;},get refreshes(){return refreshes;},toggle:()=>run('toggleActivity',context)(),bulk:()=>run('markAllThreadsRead',context)(),more:()=>run('loadMoreActivity',context)(),clear:()=>run('clearReadActivity',context)()};
}
for (const outcome of ['success','error','account-changed']) {
  const view=mount(), ctx=view.context, pending=deferred(), receipts=[];
  let refreshes=0;
  ctx.threadsRef.current=[rows[0],rows[1],{id:'run-only',readState:read},{id:'hidden',readState:read}];
  ctx.activityScheduleIdsRef.current=new Set(['t1','run-only','hidden']);
  ctx.activityScheduleUnreadRef.current=new Set(['t1','run-only','hidden']);
  ctx.activityExclusionsRef.current.add('hidden');
  ctx.Date={now:()=>123};
  ctx.setActivityScheduleRevision=update=>{refreshes=update(refreshes);};
  ctx.markActivityRunsRead=(ids,through)=>{receipts.push([Array.from(ids),through]);return pending.promise;};
  ctx.markScheduledActivityRead=run('markScheduledActivityRead',ctx);
  view.toggle();
  assert.ok(view.state.threadIds.includes('run-only'),'run-only unread is a priority member');
  view.clear();
  assert.ok(view.state.threadIds.includes('run-only'),'clear keeps pending run unread');
  const bulk=view.bulk();await flush();
  assert.deepEqual(receipts,[[['t1','run-only'],123]]);
  assert.deepEqual(view.writes.map(call=>call.args.threadId),['t0','t0'],'ordinary chats are independent');
  if(outcome==='account-changed')ctx.activityScopeRef.current='other';
  if(outcome==='error')pending.reject(Error('disk rejected'));
  else pending.resolve(2);
  await bulk;
  assert.deepEqual(view.writes.map(call=>call.args.threadId),outcome==='success'?['t0','t0','t1','t1']:['t0','t0']);
  assert.equal(refreshes,outcome==='account-changed'?0:1);
  assert.equal(view.errors.length,outcome==='error'?1:0);
  if(outcome==='error')assert.match(view.errors[0][0],/disk rejected/);
}
{
  const {context:ctx}=mount(), receipts=[];
  let resume;
  ctx.markScheduledActivityRead=(...args)=>receipts.push(args);
  ctx.personalizationNavigationGuardRef.current=action=>{resume=action;return false;};
  ctx.worktreeCreationControllersRef={current:{keys:()=>{throw Error('navigation continued');}}};
  const select=ctx.selectThread=run('selectThread',ctx);
  await select('run',true);
  assert.deepEqual(receipts,[]);
  ctx.activityScopeRef.current='other';resume();
  assert.deepEqual(receipts,[],'stale guard does not write');
  ctx.personalizationNavigationGuardRef.current=null;
  await assert.rejects(select('run',true),/navigation continued/);
  assert.deepEqual(Array.from(receipts[0][0]),['run'],'the task entry does not wait for the Activity catalog');
  assert.equal(receipts[0][2],'other');
}
{
  const view=mount();
  view.toggle();
  let selected=null,started=0;
  const calls=[],toasts=[],undo=[];
  Object.assign(view.context,{
    setActivityArchive:value=>{selected=typeof value==='function'?value(selected):value;},
    archiveMutationPendingRef:{current:false},pinMutationPendingRef:{current:false},
    activeThreadIdRef:{current:'t0'},startNewThread:()=>started++,
    showAppToast:(...args)=>toasts.push(args),
    archiveLocalThread:async thread=>{
      calls.push(thread.id);
      if(thread.id==='t2')throw Error('archive rejected');
      return {pinPlacement:null,localStateError:false};
    },
    undoProjectArchive:async (archived,isCurrent)=>{if(isCurrent())undo.push(...archived.map(item=>item.thread.id));},
  });
  run('openActivityArchive',view.context)();
  assert.equal(selected.targets.length,13,'captures full priority set beyond page one');
  assert.deepEqual(calls,[],'opening confirmation does not write');
  const confirmation=selected;
  view.context.threadsRef.current=[...rows.map(row=>row.id==='t1'?{...row,status:{type:'active'}}:row),{id:'new'}];
  view.context.activitySessionRef.current.threadIds.push('new');
  await run('confirmActivityArchive',view.context)(confirmation);
  assert.equal(selected,null);
  assert.equal(started,1);
  assert.ok(calls.includes('t12')&&!calls.includes('t1')&&!calls.includes('new'));
  assert.equal(toasts[0][0],'已归档 11 个优先聊天；2 个无法归档');
  toasts[0][2].onClick();
  assert.deepEqual(undo,calls.filter(id=>id!=='t2'));
  view.context.activityScopeRef.current='other';
  await run('confirmActivityArchive',view.context)(confirmation);
  toasts[0][2].onClick();
  assert.equal(calls.length,12);
  assert.equal(undo.length,11,'stale account cannot undo');
}
{
  const view=mount();
  view.toggle();
  const pending=deferred(), calls=[];
  const selection={scope:'local',generation:view.context.activityGenerationRef.current,targets:rows.slice(0,2)};
  Object.assign(view.context,{
    archiveMutationPendingRef:{current:false},pinMutationPendingRef:{current:false},
    archiveLocalThread:async (thread,isCurrent)=>{
      calls.push(thread.id);await pending.promise;assert.equal(isCurrent(),false);
    },
    setActivityArchive:()=>assert.fail('stale response updated dialog'),
  });
  const confirm=run('confirmActivityArchive',view.context);
  const result=confirm(selection);
  await assert.rejects(confirm(selection),/正在进行/);
  view.context.activityScopeRef.current='other';
  pending.resolve();await result;
  assert.deepEqual(calls,['t0']);
  assert.equal(view.context.archiveMutationPendingRef.current,false);
}
for(const reopen of [false,true]){
  const view=mount(),readRow={...rows[0],readState:read};
  let selected=null,undo,restoredCalls=[];
  const ctx=view.context;
  ctx.threadsRef.current=rows.slice(0,3);
  view.toggle();
  ctx.threadsRef.current=[readRow,...rows.slice(1,3)];
  Object.assign(ctx,{
    setActivityArchive:value=>{selected=typeof value==='function'?value(selected):value;},
    archiveMutationPendingRef:{current:false},pinMutationPendingRef:{current:false},
    activeThreadIdRef:{current:null},startNewThread:()=>assert.fail('no active chat'),
    showAppToast:(_message,_kind,action)=>{if(action)undo=action.onClick;},
    archiveLocalThread:async thread=>{
      ctx.activitySessionRef.current=activity.exports.excludeActivityThreads(ctx.activitySessionRef.current,[thread.id]);
      return {pinPlacement:null,localStateError:false};
    },
    threadPinRevisionRef:{current:0},setPinnedThreadIds:()=>{},setArchiveRefreshTick:()=>{},
    tauriInvoke:async (_method,{thread})=>{
      restoredCalls.push(thread.id);
      if(thread.id==='t1')throw Error('restore rejected');
      return {pinnedThreadIds:[],localStateError:false};
    },
    refreshThreads:async onLoaded=>onLoaded?.([readRow,...rows.slice(1,3)]),
  });
  ctx.undoProjectArchive=run('undoProjectArchive',ctx);
  run('openActivityArchive',ctx)();
  await run('confirmActivityArchive',ctx)(selected);
  if(reopen){
    view.toggle();
    ctx.threadsRef.current=[];
    view.toggle();
  }
  undo();await flush();
  assert.deepEqual(restoredCalls,['t2','t1','t0']);
  assert.deepEqual(Array.from(ctx.activitySessionRef.current.threadIds),reopen?[]:['t0','t2'],
    'only confirmed restores return, including an idle read item, and only to the original session');
}
{
  const view=mount();view.toggle();
  view.context.threadsRef.current=rows.map(row=>row.id==='t0'?row:{...row,readState:read});
  const initial=view.state;
  view.context.activityScopeRef.current='other';view.clear();
  assert.equal(view.state,initial,'stale identity does not clear');
  view.context.activityScopeRef.current='local';view.clear();
  assert.deepEqual(Array.from(view.state.threadIds),['t0']);
  assert.equal(view.context.activitySessionRef.current,view.state);
  assert.equal(view.writes.length,0);
  assert.equal(view.refreshes,0);
}
{
  const view=mount(); view.toggle();
  assert.equal(view.state.threadIds.length,13); assert.equal(view.state.visibleCount,10);
  view.more(); assert.equal(view.state.visibleCount,20);
  view.toggle(); assert.equal(view.state,null); assert.equal(view.context.activitySessionRef.current,null);
  view.context.threadsRef.current=[]; view.toggle(); assert.equal(view.state.threadIds.length,0,'reopen recalculates');
}
{
  const view=mount();let continuation;
  view.context.personalizationNavigationGuardRef.current=apply=>{continuation=apply;return false;};
  view.toggle();assert.equal(view.state,null,'guard refusal creates no snapshot');
  view.context.activityScopeRef.current='other';continuation();assert.equal(view.state,null,'old guard cannot open another identity');
  view.context.activityScopeRef.current='local';view.toggle();const old=continuation;view.toggle();old();assert.equal(view.state,null,'superseded guard is single-generation');
  continuation();assert.ok(view.state);
}
{
  const view=mount();view.toggle();view.context.activitySessionRef.current.threadIds=rows.slice(0,12).map(t=>t.id);
  await view.bulk();
  assert.equal(view.writes.filter(x=>x.method==='thread/readState/update').length,12,'entire EP, including display page two');
  assert.ok(view.writes.every(x=>x.args.threadId!=='t12'),'outside session never written');
  assert.ok(view.writes.filter(x=>x.method==='thread/readState/update').every(x=>x.args.expectedRevision==='fresh-read'));
  assert.ok(view.writes.filter(x=>x.method==='thread/read').every(x=>x.args.includeTurns===false));
  assert.equal(rows[0].readState.revision,'list-old','no optimistic receipt overwrite');
}
for(const change of ['close','identity','hide-priority','independent-pin','scheduled','remove','already-read','notification-before-render']){
  const view=mount();view.context.threadsRef.current=[rows[0]];view.toggle();const pending=deferred();
  view.context.callAppServer=async(method,args)=>{view.writes.push({method,args});return pending.promise;};
  const first=view.bulk();await flush();await view.bulk();assert.equal(view.writes.length,1,'same-thread single flight');
  if(change==='close')view.toggle();
  if(change==='identity')view.context.activityScopeRef.current='other';
  if(change==='hide-priority')view.context.activityPriorityVisibleRef.current=false;
  if(change==='independent-pin')view.context.activityExclusionsRef.current.add('t0');
  if(change==='scheduled')view.context.activityScheduleIdsRef.current=new Set(['t0']);
  if(change==='remove')view.context.activitySessionRef.current.threadIds=[];
  if(change==='notification-before-render')vm.runInNewContext(transpile(`(()=>${removal})()`),{...view.context,params:{threadId:'t0'},refreshThreadsGenerationRef:{current:0},activeThreadIdRef:{current:'other'},setThreads:()=>{}});
  pending.resolve({readState:change==='already-read'?read:unread('late')});await first;
  assert.equal(view.writes.length,1,`no late write after ${change}`);
  assert.equal(view.context.readStateWritesRef.current.size,0);
  assert.equal(view.errors.length,0);
  if(change==='identity')assert.equal(view.refreshes,0,'old identity does not refresh new identity');
}
{
  const old=deferred(), latest=deferred(), unavailable=deferred(), late=deferred(), scope={current:'local'};
  const requests=[old,latest,unavailable,late], catalogs=[];
  let poll, cleared=false;
  const effect=vm.runInNewContext(transpile(`(${scheduledEffect.getText(ast)})`),{
    isTauriRuntime:()=>true,isQuickChatWindow:false,activityScope:'local',activityScopeRef:scope,
    getSchedulerStatus:()=>requests.shift().promise,
    setActivityScheduleCatalog:catalog=>catalogs.push(Array.from(catalog.ids)),
    window:{setInterval:(fn,ms)=>{assert.equal(ms,60_000);poll=fn;return 1;},clearInterval:()=>{cleared=true;}},
  });
  const cleanup=effect();poll();
  old.resolve({activityThreadIds:['old']});latest.resolve({activityThreadIds:['latest']});await flush();
  assert.deepEqual(catalogs,[['latest']]);
  poll();unavailable.reject(Error('temporary failure'));await flush();
  assert.deepEqual(catalogs,[['latest']]);
  poll();scope.current='different';late.resolve({activityThreadIds:[]});await flush();
  assert.deepEqual(catalogs,[['latest']]);
  cleanup();assert.equal(cleared,true);
}
{
  const view=mount();
  view.toggle();
  view.context.activityExclusionsRef.current=new Set(['t0','t12']);
  let targets;
  view.context.setActivityArchive=selection=>{targets=selection.targets;};
  run('openActivityArchive',view.context)();
  assert.equal(targets.length,11);
  assert.ok(targets.every(row=>!view.context.activityExclusionsRef.current.has(row.id)));
  await view.bulk();
  assert.equal(view.writes.filter(({method})=>method==='thread/readState/update').length,11);
  assert.ok(view.writes.every(({args})=>!view.context.activityExclusionsRef.current.has(args.threadId)));
}
{
  const view=mount(),ctx=view.context;
  const values=new Map();
  Object.assign(ctx,{ACTIVITY_PRIORITY_KEY:'test-priority',
    localStorage:{setItem:(key,value)=>values.set(key,value)},
    setActivityPriorityVisible:()=>{},setActivityArchive:()=>{}});
  ctx.updateActivityPriority=run('updateActivityPriority',ctx);
  const togglePriority=run('toggleActivityPriority',ctx);
  view.toggle();
  const before=view.state;
  togglePriority();
  assert.equal(values.get('test-priority'),'false');
  assert.equal(view.state,before);
  await view.bulk();view.clear();
  assert.deepEqual(view.writes,[]);
  togglePriority();
  assert.equal(values.get('test-priority'),'true');
  assert.equal(view.state,before);
}
{
  const view=mount();view.context.threadsRef.current=[rows[0]];view.toggle();
  view.context.callAppServer=async(method,args)=>{view.writes.push({method,args});if(method==='thread/read')return {readState:unread('fresh')};throw Error('revision conflict');};
  await view.bulk();assert.equal(view.writes.length,2,'conflict never automatically retried');assert.match(view.errors[0][0],/revision conflict/);assert.equal(view.refreshes,1);
  view.context.callAppServer=async(method,args)=>{view.writes.push({method,args});return method==='thread/read'?{readState:unread('next')}:{readState:read};};
  await view.bulk();assert.equal(view.writes.at(-1).args.expectedRevision,'next','new explicit gesture uses new authoritative revision');
}
{
  let threads=[{id:'archived'},{id:'keep'}],started=0,ticks=0,rpc=0;const errors=[],pending=deferred();
  const context={...activity.exports,activitySessionRef:{current:null},archiveMutationPendingRef:{current:false},pinMutationPendingRef:{current:false},threadPinRevisionRef:{current:0},setPinnedThreadIds:()=>{},activeThreadIdRef:{current:'archived'},refreshThreadsGenerationRef:{current:0},setThreads:update=>{threads=update(threads);},setArchiveRefreshTick:()=>ticks++,startNewThread:()=>started++,showAppToast:(...args)=>errors.push(args),tauriInvoke:async()=>{rpc++;return pending.promise;}};
  context.archiveLocalThread=run('archiveLocalThread',context);
  const archive=run('handleArchiveThread',context);const first=archive({id:'archived'});await archive({id:'archived'});assert.equal(rpc,1,'no-event and duplicate gestures reach one real boundary');
  context.activeThreadIdRef.current='new-thread';pending.resolve({pinnedThreadIds:[],pinPlacement:null,localStateError:false});await first;
  assert.deepEqual(threads,[{id:'keep'}]);assert.equal(started,0,'late archive never leaves a newer thread');assert.equal(ticks,1);
  context.tauriInvoke=async()=>{throw Error('service denied');};await archive({id:'keep'},{stopPropagation(){}});
  assert.deepEqual(threads,[{id:'keep'}]);assert.equal(context.refreshThreadsGenerationRef.current,1);assert.equal(ticks,1);assert.match(errors[0][0],/service denied/);assert.equal(context.archiveMutationPendingRef.current,false);
}
{
  const target={id:'target',projectId:'project',status:{type:'active'}}, placement={beforeThreadId:'next'};
  const invokes=[],toasts=[];
  let threads=[target],pins=['target','next'],schedules=[{targetThreadId:'target'}];
  const context={...activity.exports,activitySessionRef:{current:null},archiveMutationPendingRef:{current:false},pinMutationPendingRef:{current:false},
    threadPinRevisionRef:{current:0},threadsRef:{current:threads},activeThreadIdRef:{current:'target'},refreshThreadsGenerationRef:{current:0},
    setThreads:update=>{threads=update(threads);},setArchiveRefreshTick:()=>{},setPinnedThreadIds:ids=>{pins=ids;},
    refreshThreads:async()=>{threads=[target];},startNewThread:()=>assert.fail('project archive changed route'),
    showAppToast:(...args)=>toasts.push(args),tauriInvoke:async(method,args)=>{
      invokes.push([method,args]);
      if(method==='automations_list')return schedules;
      return {pinnedThreadIds:args.archive?['next']:['target','next'],pinPlacement:placement,localStateError:false};
    }};
  context.undoProjectArchive=run('undoProjectArchive',context);
  context.archiveLocalThread=run('archiveLocalThread',context);
  const archive=run('handleArchiveThread',context);
  await assert.rejects(archive(target,undefined,{allowRunning:true}),/计划任务/);
  schedules=[];
  await assert.rejects(archive(target,undefined,{allowRunning:false}),/正在运行/);
  assert.deepEqual(invokes.map(([method])=>method),['automations_list','automations_list']);
  await archive(target,undefined,{allowRunning:true});
  assert.deepEqual(Array.from(threads),[]);
  assert.deepEqual(pins,['next']);
  assert.equal(toasts.at(-1)[2].label,'撤销');
  toasts.at(-1)[2].onClick(); await flush();
  assert.equal(invokes.at(-1)[1].archive,false);
  assert.equal(invokes.at(-1)[1].restorePin,placement);
  assert.deepEqual(pins,['target','next']);
  assert.deepEqual(threads,[target]);
  const notification={...context,params:{threadId:'target'},activeRouteRef:{current:'projects'},
    threadRequestRef:{current:0},threadHistoryBufferRef:{current:{discard(){}}},finishedTurnIdsRef:{current:new Set()},
    setActiveThreadId:()=>{},setTurns:()=>{},setActiveRoute:()=>assert.fail('archive notification changed project route')};
  vm.runInNewContext(transpile(`(()=>${removal})()`),notification);
  assert.equal(notification.activeThreadIdRef.current,null);
}
{
  const targets=['a','b','failed','scheduled','moved','started'].map(id=>({id,projectId:'p'}));
  const latest=targets.map(thread=>thread.id==='moved'?{...thread,projectId:'other'}:
    thread.id==='started'?{...thread,status:{type:'active'}}:thread);
  let threads=[...latest],pins=['a','b','z'];
  const invokes=[],toasts=[],gate=deferred();
  const context={...activity.exports,activitySessionRef:{current:null},archiveMutationPendingRef:{current:false},pinMutationPendingRef:{current:false},
    threadPinRevisionRef:{current:0},threadsRef:{current:latest},refreshThreadsGenerationRef:{current:0},
    setThreads:update=>{threads=update(threads);},setArchiveRefreshTick:()=>{},setPinnedThreadIds:ids=>{pins=ids;},
    refreshThreads:async()=>{},showAppToast:(...args)=>toasts.push(args),tauriInvoke:async(method,args)=>{
      if(method==='automations_list')return gate.promise;
      const id=args.thread.id;
      invokes.push([id,args.archive,args.restorePin?.beforeThreadId]);
      if(id==='failed')throw Error('denied');
      return {pinnedThreadIds:args.archive?pins.filter(pin=>pin!==id):id==='b'?['b','z']:['a','b','z'],
        pinPlacement:{beforeThreadId:id==='a'?'b':'z'},localStateError:false};
    }};
  context.archiveLocalThread=run('archiveLocalThread',context);
  context.undoProjectArchive=run('undoProjectArchive',context);
  const archive=run('handleArchiveProjectThreads',context);
  const pending=archive('p','测试项目',targets);
  await assert.rejects(archive('p','测试项目',targets),/正在进行/);
  gate.resolve([{targetThreadId:'scheduled'}]); await pending;
  assert.deepEqual(invokes,[['a',true,undefined],['b',true,undefined],['failed',true,undefined]]);
  assert.deepEqual(Array.from(threads,item=>item.id),['failed','scheduled','moved','started']);
  assert.match(toasts.at(-1)[0],/2 个聊天；4 个未成功归档。.*1 个关联计划任务/);
  toasts.at(-1)[2].onClick(); await flush();
  assert.deepEqual(invokes.slice(3),[['b',false,'z'],['a',false,'b']]);
  assert.deepEqual(pins,['a','b','z']);
}
{
  const pending=deferred();const generation={current:0};let threads=[{id:'gone'},{id:'keep'}];
  const context={...activity.exports,activitySessionRef:{current:null},refreshThreadsGenerationRef:generation,callAppServer:async()=>pending.promise,setThreads:update=>{threads=typeof update==='function'?update(threads):update;},setChatHistoryReady:()=>assert.fail('stale catalog must not mark history ready'),console:{warn(error){throw error;}}};
  const refresh=run('refreshThreads',context)();await flush();
  vm.runInNewContext(transpile(`(()=>${removal})()`),{...context,params:{threadId:'gone'},activeThreadIdRef:{current:'different'}});
  pending.resolve({data:[{id:'gone'},{id:'keep'}],nextCursor:null});await refresh;
  assert.deepEqual(threads,[{id:'keep'}],'archive/delete notification invalidates older directory read');
}
{
  const old=deferred(), latest=deferred();
  const context={...activity.exports,...protocol.exports,refreshThreadsGenerationRef:{current:0},threadListRestoreRef:{current:null},
    callAppServer:()=>context.refreshThreadsGenerationRef.current===1?old.promise:latest.promise,
    setThreads:()=>{},setChatHistoryReady:()=>{}};
  const refresh=run('refreshThreads',context);
  const loaded=[];
  const undo=refresh(list=>loaded.push(...list.map(thread=>thread.id)));
  const notification=refresh();
  old.resolve({data:[{id:'stale'}]});
  await undo;
  assert.deepEqual(loaded,[]);
  latest.resolve({data:[{id:'restored'}]});
  await notification;
  assert.deepEqual(loaded,['restored'],'superseding refresh delivers authoritative catalog to pending undo');
}
console.log('PASS 09C App production callbacks: guard, pagination, full-session latest-revision receipts, single-flight, late cancellation, archive errors and stale-list exclusion');
