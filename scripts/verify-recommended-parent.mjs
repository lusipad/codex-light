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
if(failures)process.exitCode=1;
