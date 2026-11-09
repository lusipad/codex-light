import assert from "node:assert/strict";
import { mountSkillsDirectory } from "./verify-skill-preview-ui.mjs";
const local={id:"demo",name:"Demo",description:"",path:"C:/home/skills/demo/SKILL.md",installed:true,content:"# Demo"};
let failures=0;
for(const failure of ["local","remote"]){
 let active=false;
 const h=mountSkillsDirectory({bridge:{tauriInvoke:async method=>{if(method==="skills_list_local"){if(active&&failure==="local")throw Error("local read denied");return [local];}return {};}},
 plugins:{listSkills:async()=>{if(active&&failure==="remote")throw Error("remote read denied");return {data:[{skills:[],errors:[]}]};}}});
 h.props.manageOnly=false;h.props.initialTab="skills";h.render();await h.tick();
 const panel=()=>h.nodes(h.tree).find(n=>n.type==="RecommendedSkillsPanel");
 try{
  assert.equal(panel().props.installedSkills.length,0,"RP06 disk-only records must not masquerade as app-server discovered metadata");
  active=true;
  await assert.rejects(panel().props.onInstalled(),/read denied/,"RP08 real parent readback failure must reach the visible preview");
  console.log(`PASS actual recommendation parent ${failure} readback failure`);
 }catch(error){failures++;console.error(error.stack);}finally{h.unmount();}
}
{
 const remote={...local,scope:"user",enabled:true};
 const h=mountSkillsDirectory({bridge:{tauriInvoke:async method=>method==="skills_list_local"?[local]:{}},plugins:{listSkills:async()=>({data:[{skills:[remote],errors:[]}]})}});
 h.props.manageOnly=false;h.props.initialTab="skills";h.render();await h.tick();
 const panel=()=>h.nodes(h.tree).find(n=>n.type==="RecommendedSkillsPanel");
 assert.equal(panel().props.installedSkills[0].key,local.path);
 panel().props.onInstalledCardKeysChange([local.path]);h.render();
 assert.equal(h.nodes(h.tree).filter(n=>n.props.className?.includes("skill-list-row")).length,0,"RP06 actual overview removes the card rendered in recommendations");
 const card=panel().props.renderInstalledSkill(local.path);card.props.onClick();h.render();
 assert.equal(h.nodes(h.tree).find(n=>n.type==="SkillPreviewDialog").props.path,local.path,"RP06 mapped card opens the existing real installed preview");
 panel().props.onInstalledCardKeysChange([]);h.render();
 assert.equal(h.nodes(h.tree).filter(n=>n.props.className?.includes("skill-list-row")).length,1);
 h.unmount();console.log("PASS actual recommendation parent maps real metadata, removes/restores duplicate overview and reuses installed preview");
}
{
  const remote = { ...local, scope: "user", enabled: true };
  const h = mountSkillsDirectory({ plugins: { listSkills: async () => ({ data: [{ skills: [remote], errors: [] }] }) } });
  h.props.manageOnly = false; h.props.initialTab = "skills"; h.render(); await h.tick();
  const input = () => h.nodes(h.tree).find(n => n.props["aria-label"] === "搜索技能");
  const panel = () => h.nodes(h.tree).find(n => n.type === "RecommendedSkillsPanel");
  const installed = () => h.nodes(h.tree).find(n => n.props.className?.includes("skill-list-row"));
  input().props.onChange({ target: { value: "demo" } }); h.render();
  assert.equal(installed().props["data-skill-search-result"], "true", "SK01 first installed result starts active");
  panel().props.onSearchResultCountChange(1); h.render();
  let recommendedOpens = 0;
  const scrolls = [];
  let results = [
    { click: () => installed().props.onClick(), scrollIntoView: options => scrolls.push([0, options]) },
    { click: () => { recommendedOpens++; }, scrollIntoView: options => scrolls.push([1, options]) },
  ];
  function press(key, extra = {}) {
    const page = h.nodes(h.tree).find(n => n.props.className?.includes("pm-directory-page"));
    page.props.ref.current = { querySelectorAll: selector => {
      assert.equal(selector, "[data-skill-search-result]");
      return results;
    } };
    let prevented = false;
    input().props.onKeyDown({ key, nativeEvent: {}, preventDefault() { prevented = true; }, ...extra });
    h.render();
    return prevented;
  }
  assert.equal(press("ArrowDown"), true);
  assert.equal(panel().props.activeSearchResultIndex, 0, "SK02 moves from installed to first recommended result");
  assert.equal(installed().props["data-skill-search-result"], "false");
  press("ArrowDown");
  assert.deepEqual(scrolls.map(([index, options]) => [index, options.block]), [[1, "nearest"], [1, "nearest"]]);
  assert.equal(press("Enter", { nativeEvent: { isComposing: true } }), false);
  assert.equal(press("Enter", { keyCode: 229 }), false);
  assert.equal(recommendedOpens, 0);
  assert.equal(press("Enter"), true);
  assert.equal(recommendedOpens, 1);
  input().props.onChange({ target: { value: "Demo" } }); h.render();
  assert.equal(installed().props["data-skill-search-result"], "true", "SK03 query edits reset selection even if matching cards stay");
  press("ArrowDown");
  results = results.slice(0, 1);
  panel().props.onSearchResultCountChange(0); h.render();
  assert.equal(installed().props["data-skill-search-result"], "true", "SK03 an asynchronous shrink clamps the active row");
  press("ArrowUp"); press("Enter");
  assert.equal(h.nodes(h.tree).find(n => n.type === "SkillPreviewDialog").props.path, local.path);
  results = [];
  input().props.onChange({ target: { value: "absent" } }); h.render();
  assert.equal(press("Enter"), false, "SK04 empty results do not consume Enter");
  input().props.onChange({ target: { value: " " } }); h.render();
  assert.equal(press("ArrowDown"), false, "SK04 empty query does not consume arrows");
  h.unmount();
  console.log("PASS skill search default selection, cross-group arrows, scoped activation, IME and shrinking results");
}
if(failures)process.exitCode=1;
