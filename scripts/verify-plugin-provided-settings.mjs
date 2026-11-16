import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/pluginProvidedSettings.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const { discoverPluginProvidedSettings: discover, parsePluginSettingsDefinition: parse,
  isPluginSettingValue: valid, pluginSettingsGroups: groups, parsePluginSettingsUpdate: update } = exports;
const plain = value => JSON.parse(JSON.stringify(value));
const detail = {summary:{id:"plugin-A",installed:true},mcpServers:["mcp_Example"]};
const read = {name:"read_settings",inputSchema:{type:"object",properties:{}},annotations:{readOnlyHint:false}};
const write = {name:"write_settings",inputSchema:{type:"object",properties:{set:{type:"object"}}}};
const capability = {readTool:read.name,updateTool:write.name};
const status = {name:"Example",pluginId:"plugin-A",serverInfo:{title:"真实设置"},
  serverCapabilities:{extensions:{"openai/settings":capability}},tools:{read,write}};
assert.equal(discover(detail,[status],"local").length,1);
let view=discover(detail,[status],"local")[0];
assert.deepEqual(plain(view),{hostId:"local",server:"Example",pluginId:"plugin-A",title:"真实设置",readTool:"read_settings",updateTool:"write_settings",tools:[read,write]});
assert.equal(view.tools[0],read,"preserve trusted actual tool metadata");
assert.equal(discover({...detail,summary:{...detail.summary,installed:false}},[status],"local").length,0);
assert.equal(discover(detail,[{...status,pluginId:"plugin-B"}],"local").length,0,"same server name does not override explicit owner");
assert.equal(discover(detail,[{...status,pluginId:""}],"local").length,0,"empty explicit owner must not fall back");
assert.equal(discover(detail,[{...status,pluginId:null}],"local").length,1,"null owner uses server mapping");
assert.equal(discover({...detail,mcpServers:["other"]},[{...status,pluginId:null}],"local").length,0);
assert.equal(discover(detail,[{...status,pluginId:null,name:"connector_mcp_Example"}],"host-2")[0].hostId,"host-2");
assert.equal(discover(detail,[{...status,pluginId:null,name:"mcp_connector_Example"}],"local").length,0,"normalization prefix order is not recursive");
assert.equal(discover({...detail,mcpServers:["codex_apps"]},[{...status,name:"codex_apps"}],"local").length,0,"codex_apps requires its distinct trusted scope contract");
const experimental={experimental:{"openai/settings":capability}};
assert.equal(discover(detail,[{...status,serverCapabilities:experimental}],"local").length,1);
for(const declaration of [null,{}, {readTool:" ",updateTool:"write_settings"}, {...capability,updateTool:read.name}]) {
  assert.equal(discover(detail,[{...status,serverCapabilities:{extensions:{"openai/settings":declaration},...experimental}}],"local").length,0,"present invalid extension never falls through");
}
for (const capabilities of [{extensions:null,...experimental},{extensions:[],...experimental},{...status.serverCapabilities,experimental:1}])assert.equal(discover(detail,[{...status,serverCapabilities:capabilities}],"local").length,0,"malformed capability containers do not silently fall through");
assert.equal(discover(detail,[{...status,tools:{read}}],"local").length,0);
assert.equal(discover(detail,[{...status,tools:{write}}],"local").length,0);
assert.equal(discover(detail,[{...status,toolsError:"failed"}],"local").length,1,"available cached catalog is not discarded by invented toolsError gate");
assert.equal(discover(detail,[{...status,serverInfo:{name:"actual"}}],"local")[0].title,"actual");
assert.equal(discover(detail,[{...status,serverInfo:null}],"local")[0].title,"Example");
const definition={schema:{type:"object",properties:{
  enabled:{title:"开关",type:"boolean"},mode:{title:"模式",type:"string",enum:["a","b"]},
  text:{title:"文本",type:"string",minLength:1,maxLength:2,pattern:"^.+$"},
  count:{title:"整数",type:"integer",minimum:0,maximum:5},ratio:{title:"小数",type:"number",multipleOf:0.1},
}},values:{enabled:true,mode:"a",text:"😀",count:2,ratio:0.3},layout:[{kind:"group",title:"基础",items:[{kind:"property",property:"mode"},{kind:"tool",tool:"check",description:"实际动作"}]}]};
const parsed=parse(definition);
assert.deepEqual(plain(groups(parsed)).map(g=>[g.title,g.other,g.items.map(i=>i.kind==="property"?i.property:i.tool)]),[["基础",false,["mode","check"]],[undefined,true,["enabled","text","count","ratio"]]]);
assert.deepEqual(plain(groups(parse({...definition,layout:undefined}))).map(g=>[g.title,g.other]),[[undefined,false]]);
assert.equal(valid(parsed.schema.properties.text,"😀😀"),true,"read values use Unicode codepoints");
assert.equal(valid(parsed.schema.properties.text,"😀😀😀"),false);
assert.equal(valid(parsed.schema.properties.enabled,1),false);
assert.equal(valid(parsed.schema.properties.mode,"c"),false);
assert.equal(valid(parsed.schema.properties.count,1.5),false);
assert.equal(valid(parsed.schema.properties.count,-1),false);
assert.equal(valid(parsed.schema.properties.ratio,0.31),false);
assert.equal(valid(parsed.schema.properties.ratio,0.30000000000000004),false,"do not silently round an invalid setting");
assert.equal(valid({...parsed.schema.properties.ratio,multipleOf:1e-7},3e-7),true);
assert.equal(valid({...parsed.schema.properties.text,pattern:"["},"a"),false);
assert.equal(valid({...parsed.schema.properties.text,pattern:"^.$"},"😀"),true,"read pattern uses Unicode flag");
for(const value of [null,{}, {...definition,values:{...definition.values,count:undefined}}, {...definition,values:{...definition.values,count:Infinity}}, {...definition,schema:{...definition.schema,properties:{x:{type:"array",title:"No"}}}}, {...definition,schema:{...definition.schema,properties:{x:{type:"string",title:" "}}}}])assert.throws(()=>parse(value));
for(const key of ["$ref","anyOf","oneOf","allOf"])assert.throws(()=>parse({schema:{type:"object",properties:{x:{type:"string",title:"X",[key]:{}}}},values:{x:"a"}}));
for(const key of ["$ref","anyOf","oneOf","allOf"]){const result=parse({...definition,schema:{...definition.schema,[key]:{ignored:true}}});assert.equal(Object.hasOwn(result.schema,key),false,"official root h.object strips unknown composites; property q alone forbids them");assert.equal(result.values.enabled,true);}
for(const field of [{type:"boolean",enum:["x"]},{type:"string",enum:[]},{type:"number",multipleOf:0},{type:"number",minimum:NaN},{type:"string",minLength:0.5},{type:"string",maxLength:-1}])assert.throws(()=>parse({schema:{type:"object",properties:{x:{title:"X",...field}}},values:{x:"a"}}));
for(const items of [[{kind:"property",property:"missing"}],[{kind:"property",property:"mode"},{kind:"property",property:"mode"}],[{kind:"property",property:"mode",extra:true}],[{kind:"tool",tool:" "}]])assert.throws(()=>parse({...definition,layout:[{kind:"group",title:"G",items}]}));
assert.throws(()=>parse({...definition,layout:[...definition.layout,{kind:"group",title:"Again",items:[{kind:"property",property:"mode"}]}]}));
assert.equal(parse({...definition,schema:{...definition.schema,required:["not_present"]}}).schema.required[0],"not_present","do not invent a required-membership restriction absent from official parser");
assert.throws(()=>parse({schema:{type:"object",properties:{}},values:{extra:{a:true}},layout:[]}));
assert.deepEqual(plain(parse({schema:{type:"object",properties:{}},values:{extra:true},layout:[]})).values,{extra:true},"extra scalar values remain valid but are not rendered");
const prototypeKey=JSON.parse('{"schema":{"type":"object","properties":{"__proto__":{"title":"Own key","type":"boolean"}}},"values":{"__proto__":true}}');
assert.equal(parse(prototypeKey).schema.properties.__proto__.title,"Own key");
assert.equal(parse(prototypeKey).values.__proto__,true);
assert.throws(()=>parse({...definition,values:Object.create({enabled:true})}),"inherited effective value does not establish a declared own setting");
assert.deepEqual(plain(update({values:{x:1},other:"ignored"})),{values:{x:1}});
assert.throws(()=>update({}));
assert.throws(()=>update({values:[]}));
console.log("Plugin provided settings: actual capability precedence and ownership, read/write tool identity, scalar constraints, Unicode, layout ordering and readback DTO passed.");
