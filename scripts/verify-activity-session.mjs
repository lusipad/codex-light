import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const protocol={exports:{}};
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(compile('src/protocol.ts'),{exports:protocol.exports});
const activity={exports:{}};
vm.runInNewContext(compile('src/threadActivity.ts'),{exports:activity.exports,require:()=>protocol.exports});
const {beginActivitySession,mergeActivitySession,clearReadActivityThreads,restoreActivityThreads,activityRecentGroups,threadNeedsAttention}=activity.exports;
assert.equal(typeof beginActivitySession,'function','09C: session must have an explicit opening snapshot');
const at=1793952000500;
const unread={revision:'r1',firstUnread:{type:'threadStart'}};
const read={revision:'r2',firstUnread:null};
const data=[{id:'running',status:{type:'active'},updatedAt:20},{id:'unread',readState:unread,updatedAt:10},{id:'approval',status:{type:'active',activeFlags:['waitingOnApproval']},updatedAt:3},{id:'idle',status:{type:'idle'},createdAt:1}];
let session=beginActivitySession(data,'local',at);
assert.deepEqual(Array.from(session.threadIds),['approval','unread','running']);
assert.equal(session.visibleCount,10);
assert.equal(threadNeedsAttention({id:'error',status:{type:'systemError'}}),true);
assert.equal(threadNeedsAttention({id:'unknown',status:{type:'notLoaded'}}),false);
let current=data.map(t=>({...t,status:{type:'idle'},readState:read}));
session=mergeActivitySession(session,current);
assert.deepEqual(Array.from(session.threadIds),['approval','unread','running'],'09C-I01: read and completed entries remain in session');
assert.deepEqual(Array.from(beginActivitySession(current,'local',at+1).threadIds),[],'closing/reopening samples current eligibility');
assert.equal(mergeActivitySession(session,current),session,'unchanged merge preserves identity');
current=[...current,{id:'new-idle',createdAt:Math.floor(at/1000),status:{type:'idle'}},{id:'old-idle',createdAt:1,status:{type:'idle'}},{id:'new-unread',readState:unread,createdAt:1}];
session=mergeActivitySession(session,current);
assert.deepEqual(Array.from(session.threadIds),['new-idle','approval','unread','running','new-unread'],'newly created local first; retained members before newly eligible existing items');
session=mergeActivitySession(session,current.filter(t=>t.id!=='unread'));
assert.ok(!session.threadIds.includes('unread'),'authoritative removal cannot leave ghost row');
session=mergeActivitySession(session,[...current.filter(t=>t.id!=='unread'),{id:'unread',createdAt:Math.floor(at/1000),readState:read}]);
assert.ok(!session.threadIds.includes('unread'),'previously seen id is not mistaken for a new local creation');
const next=mergeActivitySession(session,[...current,{id:'new-idle',name:'renamed',createdAt:Math.floor(at/1000)}]);
assert.equal(new Set(next.threadIds).size,next.threadIds.length,'catalog duplicates are idempotent');
assert.equal(next.scope,'local');
assert.equal(next.activatedAt,at);
const beforeClear={...next,visibleCount:20};
const cleared=clearReadActivityThreads(beforeClear,current);
assert.deepEqual(Array.from(cleared.threadIds),['new-unread']);
assert.equal(cleared.visibleCount,20);
assert.equal(cleared.activatedAt,at);
assert.equal(cleared.knownThreadIds,beforeClear.knownThreadIds);
assert.equal(mergeActivitySession(cleared,current),cleared,'cleared rows do not reappear on unchanged refresh');
assert.ok(mergeActivitySession(cleared,current.map(t=>t.id==='new-idle'?{...t,status:{type:'active'}}:t)).threadIds.includes('new-idle'));
assert.equal(clearReadActivityThreads(cleared,current),cleared,'repeated clear is a no-op');
const mixed=mergeActivitySession(beginActivitySession(data,'local',at),data.map(t=>t.id==='unread'?{...t,readState:read}:t));
assert.deepEqual(Array.from(clearReadActivityThreads(mixed,data.map(t=>t.id==='unread'?{...t,readState:read}:t)).threadIds),['approval','running']);
const undoSession={...session,threadIds:['new-unread','running','approval']};
const originalOrder=['approval','unread','running','old-idle'];
const restored=restoreActivityThreads(undoSession,originalOrder,['approval','unread','old-idle'],current.filter(t=>t.id!=='old-idle'));
assert.deepEqual(Array.from(restored.threadIds),['approval','unread','new-unread','running'],'confirmed idle rows return in order without duplicates; missing row stays out');
assert.equal(restored.visibleCount,undoSession.visibleCount);
assert.equal(restoreActivityThreads(restored,originalOrder,['approval','unread','old-idle'],current.filter(t=>t.id!=='old-idle')),restored);
const opened=new Date(2026,10,9,12).getTime();
const seconds=(day,hour=0)=>new Date(2026,10,day,hour).getTime()/1000;
const history=[
  {id:'priority',updatedAt:seconds(9,11),readState:unread},
  {id:'today',updatedAt:seconds(9,10),readState:read},
  {id:'yesterday',updatedAt:seconds(8,10),readState:read},
  {id:'boundary',updatedAt:seconds(3),readState:read},
  {id:'too-old',updatedAt:seconds(3)-1,readState:read},
];
const snapshot=beginActivitySession(history,'local',opened);
const groupIds=groups=>Array.from(groups,group=>[group.label,Array.from(group.threads,t=>t.id)]);
assert.deepEqual(groupIds(activityRecentGroups(snapshot,history,opened)),[
  ['今天',['today']],['昨天',['yesterday']],['星期二',['boundary']],
]);
const refreshed=history.map(t=>t.id==='yesterday'?{...t,updatedAt:seconds(9,11)}:t);
assert.deepEqual(groupIds(activityRecentGroups(mergeActivitySession(snapshot,refreshed),refreshed,opened)),
  groupIds(activityRecentGroups(snapshot,history,opened)),'recent bucket is frozen while snapshot stays open');
const finished=history.map(t=>t.id==='priority'?{...t,readState:read}:t);
const clearedRecent=clearReadActivityThreads(mergeActivitySession(snapshot,finished),finished);
assert.deepEqual(groupIds(activityRecentGroups(clearedRecent,finished,opened))[0],['今天',['priority','today']]);
const oldPriority={id:'old-priority',updatedAt:seconds(1),readState:unread};
const withOld=[...refreshed,oldPriority];
const chronological=mergeActivitySession(snapshot,withOld);
assert.deepEqual(groupIds(activityRecentGroups(chronological,withOld,opened,false))[0],
  ['今天',['priority','yesterday','today']],'without Priority, use live recency and include former Priority in the date list');
assert.ok(groupIds(activityRecentGroups(chronological,withOld,opened,false)).some(([,ids])=>ids.includes('old-priority')));
assert.ok(!groupIds(activityRecentGroups(chronological,withOld,opened,false)).some(([,ids])=>ids.includes('too-old')));
assert.ok(!groupIds(activityRecentGroups(chronological,withOld,opened)).some(([,ids])=>ids.includes('old-priority')));
const pinned=new Set(['today','old-priority']);
assert.ok(!groupIds(activityRecentGroups(chronological,withOld,opened,false,pinned))
  .some(([,ids])=>ids.some(id=>pinned.has(id))),'date list must exclude independent pins, including Priority when that section is hidden');
console.log('PASS 09C activity session: source-derived priority, retention, creation seconds, membership, removal and reopening');
