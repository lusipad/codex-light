import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const calls=[];let response;const service={readChatgptService:async(...args)=>{calls.push(args);return response;}};
const load=file=>{const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module.exports,require:id=>id==='./chatgptService'?service:id==='./workRunLocation'?load('src/workRunLocation.ts'):{},AbortSignal,Error,Map,Set});return module.exports;};
const m=load('src/workModelCatalog.ts');
const model=(slug,extra={})=>({slug,title:slug,description:null,...extra});
const base={models:[model('native-wm',{is_work_mode_model:true,default_thinking_effort:'extended',thinking_efforts:[{thinking_effort:'standard'},{thinking_effort:'extended'}]})],default_model_slug:'native-wm',categories:[],versions:[],internal_groups:[{model_ids:['native-wm']}],slider_settings:[{model_slug:'native-wm',thinking_effort:'standard'},{model_slug:'native-wm',thinking_effort:'extended'}]};
const catalog=m.parseWorkModelCatalog(base);
assert.equal(catalog.defaultModelSlug,'native-wm');assert.equal(catalog.modelConfigBySlug['native-wm'].isWorkModeModel,true);
const selected=m.selectWorkHomeModel(catalog,{homeSelection:null,lastSelection:null,plan:null});
assert.equal(selected.selection.slug,'native-wm');assert.equal(selected.selection.thinkingEffort,'extended');assert.equal(selected.isWorkModel,true);
assert.deepEqual(JSON.parse(JSON.stringify(m.adaptWorkModelSelection(selected.selection,[{model:'native'}]))),{model:'native',reasoningEffort:'high'});
assert.equal(m.adaptWorkModelSelection(selected.selection,[]).model,'native-wm');
assert.equal(m.adaptWorkModelSelection({slug:'native-wm',thinkingEffort:null},[{model:'native'},{model:'native-wm'}]).model,'native-wm');
const invalid=m.parseWorkModelCatalog({models:[{slug:''},null],default_model_slug:null});assert.equal(invalid.options.length,0);assert.equal(m.selectWorkHomeModel(invalid,{homeSelection:null,lastSelection:null,plan:null}).isWorkModel,false);
const policy=m.parseWorkModelCatalog({...base,models:[...base.models,model('other',{is_work_mode_model:true})],workspace_model_policy:{selection:{model:'native-wm',thinking_effort:'standard'},new_thread_precedence:'prefer_policy'}});
assert.equal(m.selectWorkHomeModel(policy,{homeSelection:{slug:'other',thinkingEffort:null},lastSelection:null,plan:null}).selection.slug,'native-wm');
const personal=m.selectWorkHomeModel(catalog,{homeSelection:{slug:'native-wm',thinkingEffort:'ultra'},lastSelection:null,plan:null});assert.equal(personal.hasExplicitSelection,false);
const noDefaultPower=m.parseWorkModelCatalog({...base,slider_settings:[{model_slug:'native-wm',thinking_effort:'standard'}]});assert.equal(m.selectWorkHomeModel(noDefaultPower,{homeSelection:null,lastSelection:null,plan:null}).selection.thinkingEffort,'standard');
const abort=new AbortController();abort.abort();await assert.rejects(()=>m.readWorkModelCatalog({accountId:'a',userId:'u',generation:1},abort.signal));assert.equal(calls.length,0);
response=base;const controller=new AbortController();await m.readWorkModelCatalog({accountId:'a',userId:'u',generation:1},controller.signal);assert.equal(calls[0][0],'work_models');assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{});assert.equal(calls[0][3],controller.signal);
console.log('PASS work models: production codec, directory/policy/default effort, native mapping, malformed input and abort/read wiring');

// Golden expectations come from HC01-16; these are not derived from this codec.
const enriched=m.parseWorkModelCatalog({...base,
  models:[...base.models,model('admin'),model('alpha',{tags:[]})],
  categories:[{default_model:'admin',supported_models:['admin'],disabled_by_admin:true},{default_model:'native-wm',supported_models:['native-wm'],model_lane:'thinking'}],
  versions:[{id:'retained',slugs:['native-wm'],enabled:false,intelligence_presets:[{model_slug:'native-wm',thinking_effort:'extended',subtitle:'kept subtitle',service_tier_options:[{service_tier:'fast',title:'Fast'}],future:{preserve:true}}]},
    {id:'disabled',slugs:['disabled-slug'],disabled:true,intelligence_presets:[{model_slug:'also-disabled'}]}],
  internal_groups:[{group:'alpha',model_ids:['alpha','native-wm']}],
  workspace_model_policy:{selection:{model:'native-wm',thinking_effort:'standard',speed_tier:'fast',future:'kept'},new_thread_precedence:'prefer_policy',future:{keep:true}},
});
assert.equal(enriched.modelConfigBySlug.admin.disabledByAdmin,true);
assert.equal(enriched.versionOptions[0].enabled,false);
assert.equal(enriched.versionOptions[0].options[0].subtitle,'kept subtitle');
assert.equal(enriched.versionOptions[0].options[0].service_tier_options[0].service_tier,'fast');
assert.equal(enriched.versionOptions[0].options[0].future.preserve,true);
assert.deepEqual(Array.from(enriched.disabledVersionSlugs),['disabled-slug','also-disabled']);
assert.deepEqual(enriched.chatAlphaOptions.map(option=>option.slug),['alpha']);
assert.equal(enriched.workspaceModelPolicy.selection.speedTier,'fast');assert.equal(enriched.workspaceModelPolicy.selection.future,'kept');
assert.equal(enriched.workspaceModelPolicy.future.keep,true);
const malformedPresets=m.parseWorkModelCatalog({...base,versions:[{id:'bad',slugs:['native-wm'],intelligence_presets:[{model_slug:'bogus',service_tier_options:'invalid'}]}]});
assert.equal(malformedPresets.options.some(option=>option.slug==='bogus'),false);
const malformedEfforts=m.parseWorkModelCatalog({...base,models:[model('native-wm',{is_work_mode_model:true,thinking_efforts:[{thinking_effort:'standard'},{thinking_effort:'not-real'}]})]});
assert.equal(malformedEfforts.modelConfigBySlug['native-wm'].thinkingEfforts,undefined);assert.equal(malformedEfforts.internalOptions.some(option=>option.thinkingEffort==='standard'),false);
const noC=m.parseWorkModelCatalog({...base,models:[...base.models,model('different')],internal_groups:[],versions:[{id:'different',slugs:['different'],intelligence_presets:[{model_slug:'different',thinking_effort:'standard'}]}],slider_settings:[{model_slug:'different',thinking_effort:'standard'}]});
assert.equal(m.selectWorkHomeModel(noC,{homeSelection:null,lastSelection:null,plan:null}).selection.thinkingEffort,'extended');
assert.equal(m.selectWorkHomeModel(catalog,{homeSelection:{slug:'invalid',thinkingEffort:null},lastSelection:{slug:'native-wm',thinkingEffort:'standard'},plan:null}).hasExplicitSelection,false);
const nullEffort=m.selectWorkHomeModel(catalog,{homeSelection:{slug:'native-wm',thinkingEffort:null},lastSelection:null,plan:'business'});
assert.equal(nullEffort.hasExplicitSelection,true);assert.equal(nullEffort.selection.thinkingEffort,null);
const lateAbort=new AbortController();response=base;service.readChatgptService=async()=>{lateAbort.abort();return response;};
await assert.rejects(()=>m.readWorkModelCatalog({accountId:'a',userId:'u',generation:1},lateAbort.signal));
console.log('PASS source goldens: admin, disabled/enabled-false versions, alpha, policy/raw fields, malformed presets/efforts, no-C/default and late cancellation');
// HC01: precedence has a field-level catch; invalid precedence retains selection.
const unknownPrecedence=m.parseWorkModelCatalog({...base,models:[...base.models,model('policy-only',{is_work_mode_model:true})],workspace_model_policy:{selection:{model:'policy-only'},new_thread_precedence:'future-policy'}});
assert.equal(unknownPrecedence.workspaceModelPolicy.selection.model,'policy-only');
assert.equal(unknownPrecedence.workspaceModelPolicy.newThreadPrecedence,null);
assert.equal(m.selectWorkHomeModel(unknownPrecedence,{homeSelection:null,lastSelection:null,plan:null}).selection.slug,'policy-only');
// HC01: tags is array(string), not the nullable/trimmed model-id codec.
const invalidTags=m.parseWorkModelCatalog({...base,models:[model('native-wm',{is_work_mode_model:true,tags:['hidden',null]})]});
assert.equal(invalidTags.internalOptions.some(option=>option.slug==='native-wm'),true);
const spacedTag=m.parseWorkModelCatalog({...base,models:[model('native-wm',{is_work_mode_model:true,tags:[' hidden ']})]});
assert.equal(spacedTag.internalOptions.some(option=>option.slug==='native-wm'),true);
console.log('PASS field-level codecs: unknown policy precedence and malformed/untrimmed tags');
const malformedGroup=m.parseWorkModelCatalog({...base,models:[...base.models,model('group-only-wm',{is_work_mode_model:true})],categories:[{default_model:'native-wm',supported_models:['native-wm']}],internal_groups:[{group:42,model_ids:['group-only-wm']}]});
assert.equal(malformedGroup.internalOptions.some(option=>option.slug==='group-only-wm'),false);
assert.equal(m.selectWorkHomeModel(malformedGroup,{homeSelection:{slug:'group-only-wm',thinkingEffort:null},lastSelection:null,plan:null}).selection.slug,'native-wm');
console.log('PASS invalid internal group entry is discarded before selection');
