import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = tree => walk(tree).flatMap(node => (node.children ?? []).filter(child => typeof child === "string")).join(" ");
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
export function imagesHarness(listenerError = null) {
  const contexts = new Map(), effects = [], accesses = [], catalogs = [], histories = [], assets = [], observers = [];
  let context, used, listener, writes = 0, onCommit;
  const events = new Map();
  const renderComponent = (type, props) => {
    const before = context, key = `${type.name}:${props?.key ?? "single"}`;
    if (!contexts.has(key)) contexts.set(key, { hooks: [], cursor: 0 });
    context = contexts.get(key); context.cursor=0; used.add(key); const result=type(props); context=before; return result;
  };
  const React = {
    createElement(type,props,...children) {
      if (type===React.Fragment) return children.flat(Infinity);
      if (typeof type === "function") return renderComponent(type,{...props,children:children.flat(Infinity)});
      const node={type,props:props??{},children:children.flat(Infinity)};
      if (props?.["data-library-pagination"] !== undefined && props.ref) props.ref.current=node;
      return node;
    },
    useState(initial) { const owner=context,i=owner.cursor++; if (!(i in owner.hooks)) owner.hooks[i]=typeof initial==="function"?initial():initial; return [owner.hooks[i],value=>{ writes++; owner.hooks[i]=typeof value==="function"?value(owner.hooks[i]):value; }]; },
    useRef(initial) { const owner=context,i=owner.cursor++; return owner.hooks[i]??(owner.hooks[i]={current:initial}); },
    useCallback(fn,deps) { const owner=context,i=owner.cursor++,old=owner.hooks[i]; if (!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))) owner.hooks[i]={fn,deps}; return owner.hooks[i].fn; },
    useEffect(effect,deps) { const owner=context,i=owner.cursor++,old=owner.hooks[i]; if (!old||!deps||deps.some((v,j)=>!Object.is(v,old.deps?.[j]))) { owner.hooks[i]={deps,cleanup:old?.cleanup}; effects.push(()=>{owner.hooks[i].cleanup?.();owner.hooks[i].cleanup=effect();}); } },
  }; React.default=React; React.Fragment=Symbol("fragment"); React.useLayoutEffect=React.useEffect;
  const modules = new Map();
  const load = file => {
    if (modules.has(file)) return modules.get(file); const exports={}; modules.set(file,exports);
    vm.runInNewContext(compile(file), {exports, AbortController, Map, Set, JSON, Number,
      IntersectionObserver: class { constructor(callback){this.callback=callback;observers.push(this);} observe(target){this.target=target;} disconnect(){this.disconnected=true;} },
      ResizeObserver:class {observe(){} disconnect(){}}, getComputedStyle:()=>({getPropertyValue:()=>"1",rowGap:"12px"}),
      requestAnimationFrame:()=>0,cancelAnimationFrame(){},
      document:{body:{},getElementById:()=>null,addEventListener(name,callback){events.set(name,callback);},removeEventListener(name,callback){if(events.get(name)===callback)events.delete(name);}},
      window:{addEventListener(){},removeEventListener(){},setInterval:()=>1,clearInterval(){},},
      require:name=>{
        if(name==="react")return React; if(name==="react-dom")return {createPortal:node=>node};
        if(name==="lucide-react")return new Proxy({},{get:(_,key)=>String(key)});
        if(name.endsWith(".css"))return {};
        if(name==="../bridge")return {tauriListen:(_,callback)=>{listener=callback;return listenerError?Promise.reject(listenerError):Promise.resolve(()=>{});}};
        if(name==="../chatgptService")return {serviceErrorMessage:error=>error.message};
        if(name==="../imagesData"||name==="./imagesData")return load("src/imagesData.ts");
        if(name==="../imagesAssets")return load("src/imagesAssets.ts");
        if(name==="../imagesClient")return {
          readImagesAccess:signal=>{const d=deferred();accesses.push({signal,...d});return d.promise;},
          readImagesCatalog:(access,signal)=>{const d=deferred();catalogs.push({access,signal,...d});return d.promise;},
          readImagesHistory:(access,cursor,signal)=>{const d=deferred();histories.push({access,cursor,signal,...d});return d.promise;},
          readImagesAsset:(ref,access,signal)=>{const d=deferred();assets.push({ref,access,signal,...d});return d.promise;},
        };
        if(name==="./ImagesHistoryMasonry")return {ImagesHistoryMasonry:({items})=>React.createElement("masonry",null,...items.map(item=>React.createElement("masonry-item",{key:item.id},item.content)))};
        if(name==="./LibraryPagination")return load("src/components/LibraryPagination.tsx");
        throw Error(name);
      }});return exports;
  };
  const view=load("src/components/ImagesView.tsx");
  return {accesses,catalogs,histories,assets,observers,events,setCommit(callback){onCommit=callback;},render(){used=new Set();const tree=renderComponent(view.ImagesView,{}); for(const[key,owner]of contexts)if(!used.has(key)){owner.hooks.forEach(h=>h?.cleanup?.());contexts.delete(key);}onCommit?.(tree);while(effects.length)effects.shift()();return tree;},invalidate(){listener();},unmount(){for(const owner of contexts.values())owner.hooks.forEach(h=>h?.cleanup?.());},get writes(){return writes;}};
}
const button = (h,label) => { const found=walk(h.render()).find(node=>node.type==="button"&&(node.props["aria-label"]===label||text(node)===label));assert.ok(found,label);return found; };
const access={available:true,identity:{accountId:"a",userId:"u",generation:1}};
const catalog={catalog:{groups:[{id:"group",presentation:"image_card",items:[{id:"prompt",title:"真实模板",prompt_text:"草稿内容",section:""}]}]},errors:[],catalogAssets:[{id:"prompt",role:"init_group",groupId:"group",assetKey:"prompt-key",sourceRequestId:"catalog-request"}],stylesAssets:[]};
const page=(items=[],cursor=null)=>({items,cursor,assets:items.filter(item=>!item.output_blocked&&!item.is_archived).map(item=>({id:item.id,role:"recent",assetKey:`key-${item.id}`,sourceRequestId:"history-request"}))});
async function ready(options={}) {const h=imagesHarness();h.render();await flush();assert.equal(h.accesses.length,1,"read after successful listener");h.accesses[0].resolve({...access,...options});await flush();h.catalogs[0].resolve(catalog);h.histories[0].resolve(page([{id:"image",title:"真实图像",url:"https://example.invalid/1"}],"next"));await flush();h.render();await flush();return h;}
{
  const h=imagesHarness(Error("listener unavailable"));h.render();await flush();assert.equal(h.accesses.length,0);assert.match(text(h.render()),/listener unavailable/);h.unmount();
}
{
  const h=await ready();h.assets.find(item=>item.ref.id==="image").resolve("data:image/png;base64,AAAA");await flush();h.render();
  h.observers.find(observer=>!observer.disconnected).callback([{isIntersecting:true}]);await flush();h.histories.at(-1).reject(Error("registry limit"));await flush();h.render();
  const readsBefore=h.accesses.length;button(h,"重试加载图像").props.onClick();h.render();await flush();
  assert.equal(h.accesses.length,readsBefore+1,"revoked-grant retry revalidates access and rereads first-page metadata rather than permanently disabling earlier pages");
  assert.ok(walk(h.render()).some(node=>node.props["data-image-history"]==="image"),"refresh retains metadata text until new snapshot arrives");
  h.accesses.at(-1).resolve(access);await flush();assert.equal(h.histories.at(-1).cursor,null,"recovery resets to the fresh first-page snapshot");
  h.catalogs.at(-1).resolve(catalog);const recovered=page([{id:"image",title:"恢复的图像",url:"https://example.invalid/fresh"}],"fresh-next");recovered.assets[0].assetKey="new-key-image";recovered.assets[0].sourceRequestId="fresh-history-request";
  h.histories.at(-1).resolve(recovered);await flush();const restored=button(h,"恢复的图像");assert.equal(restored.props.disabled,false);
  const grant=h.assets.find(item=>item.ref.assetKey==="new-key-image");assert.ok(grant,"recovery requests the new opaque grant");grant.resolve("data:image/png;base64,BBBB");await flush();assert.ok(walk(h.render()).some(node=>node.type==="img"&&node.props.src==="data:image/png;base64,BBBB"));h.unmount();
}
{
  const h=await ready();assert.match(text(h.render()),/真实模板|我的图像/);assert.equal(h.histories[0].cursor,null);
  button(h,"真实模板").props.onClick();assert.equal(walk(h.render()).find(node=>node.type==="textarea").props.value,"草稿内容");
  assert.equal(button(h,"生成图像尚未连接").props.disabled,true);
  const observer=h.observers.find(o=>!o.disconnected);assert.ok(observer);observer.callback([{isIntersecting:true}]);h.render();await flush();assert.equal(h.histories.length,2);assert.equal(h.histories[1].cursor,"next");
  h.histories[1].reject(Error("page unavailable"));await flush();assert.match(text(h.render()),/page unavailable/);assert.ok(walk(h.render()).some(node=>node.props["data-image-history"]==="image"));
  button(h,"重试加载图像").props.onClick();h.render();await flush();h.accesses.at(-1).resolve(access);await flush();h.catalogs.at(-1).resolve(catalog);h.histories.at(-1).resolve(page([{id:"image",output_blocked:true}],"next"));await flush();h.render();
  h.observers.find(observer=>!observer.disconnected).callback([{isIntersecting:true}]);await flush();h.histories.at(-1).resolve(page([{id:"image",output_blocked:true}],"next"));await flush();assert.match(text(h.render()),/重复分页/);assert.match(text(h.render()),/无法显示此图像/);
  const pending=h.assets.filter(asset=>!asset.signal.aborted);h.invalidate();assert.ok(pending.every(asset=>asset.signal.aborted));h.render();await flush();assert.doesNotMatch(text(h.render()),/真实模板/);
  const old=h.histories[0];old.resolve(page([{id:"late",title:"late"}]));await flush();assert.doesNotMatch(text(h.render()),/late/);h.unmount();
}
{
  const h=await ready({myImagesTabEnabled:true});assert.ok(button(h,"我的图像"));assert.equal(walk(h.render()).filter(node=>node.type==="h2"&&text(node)==="我的图像").length,0);button(h,"我的图像").props.onClick();assert.equal(walk(h.render()).filter(node=>node.type==="h2"&&text(node)==="我的图像").length,1);h.unmount();
}
{
  const h=imagesHarness();h.render();await flush();h.accesses[0].resolve({...access,available:false});await flush();assert.equal(h.catalogs.length,0);assert.equal(h.histories.length,0);assert.match(text(h.render()),/暂不支持/);h.unmount();
}
{
  const h=await ready();const asset=h.assets.at(-1);asset.resolve("data:image/png;base64,AAAA");await flush();const img=walk(h.render()).find(node=>node.type==="img");assert.ok(img,"only successful controlled bytes become an img");assert.match(img.props.src,/^data:image\//);
  const oldAssets=h.assets.slice();button(h,"刷新").props.onClick();assert.ok(oldAssets.every(item=>item.signal.aborted));assert.match(text(h.render()),/真实模板/,"metadata refresh retains text while revoking images");await flush();h.accesses.at(-1).resolve(access);await flush();h.catalogs.at(-1).resolve(catalog);h.histories.at(-1).resolve(page([{id:"image",url:"x"}]));await flush();h.render();assert.ok(h.assets.length>oldAssets.length,"new metadata permits fresh downloads");h.unmount();
}
{
  const h=await ready();const historyAsset=h.assets.find(item=>item.ref.id==="image");historyAsset.resolve("data:image/png;base64,AAAA");await flush();const img=walk(h.render()).find(node=>node.type==="img");img.props.onError();assert.equal(walk(h.render()).some(node=>node.props["data-image-history"]==="image"),false,"decode failure hides this snapshot's history item");
  button(h,"刷新").props.onClick();h.render();await flush();h.accesses.at(-1).resolve(access);await flush();h.catalogs.at(-1).resolve(catalog);h.histories.at(-1).resolve(page([{id:"image",url:"x"}]));await flush();assert.ok(walk(h.render()).some(node=>node.props["data-image-history"]==="image"),"new snapshot restores failed id");h.unmount();
}
{
  const h=await ready();const oldAsset=h.assets.find(item=>item.ref.id==="image");oldAsset.resolve("data:image/png;base64,AAAA");await flush();
  assert.ok(walk(h.render()).some(node=>node.type==="img"&&node.props.src==="data:image/png;base64,AAAA"));
  const pending=h.assets.filter(item=>item.ref.id==="image"&&!item.signal.aborted);
  h.observers.find(observer=>!observer.disconnected).callback([{isIntersecting:true}]);await flush();
  h.histories.at(-1).reject(Error("asset_limit after newest deny"));await flush();
  const failedTree=h.render();assert.match(text(failedTree),/asset_limit after newest deny/);
  assert.ok(pending.every(item=>item.signal.aborted),"metadata failure revokes history downloads: host may already have applied a deny before rejecting asset registration");
  assert.equal(walk(failedTree).some(node=>node.type==="img"),false,"rejected metadata cannot leave previously decoded history bytes visible");
  const retained=walk(failedTree).find(node=>node.props["data-image-history"]==="image");assert.ok(retained,"failed page preserves old metadata entry");assert.equal(retained.props.disabled,true,"revoked old grants cannot reopen a preview");
  button(h,"重试加载图像").props.onClick();h.render();await flush();h.accesses.at(-1).resolve(access);await flush();assert.equal(h.histories.at(-1).cursor,null);
  h.catalogs.at(-1).resolve(catalog);h.histories.at(-1).resolve(page([{id:"image",title:"重新授权的图像",url:"https://example.invalid/fresh"},{id:"new",title:"新图像",url:"https://example.invalid/2"}]));await flush();assert.ok(button(h,"新图像"));assert.equal(button(h,"重新授权的图像").props.disabled,false);h.unmount();
}
{
  const h=await ready();const oldAsset=h.assets.find(item=>item.ref.id==="image");oldAsset.resolve("data:image/png;base64,AAAA");await flush();assert.ok(walk(h.render()).some(node=>node.type==="img"));
  button(h,"刷新").props.onClick();h.render();assert.equal(oldAsset.signal.aborted,true);assert.equal(walk(h.render()).some(node=>node.type==="img"),false,"full refresh revokes bytes before any metadata response");await flush();
  h.accesses.at(-1).resolve(access);await flush();h.catalogs.at(-1).resolve(catalog);h.histories.at(-1).reject(Error("first metadata registration rejected"));await flush();
  const failed=h.render();assert.match(text(failed),/first metadata registration rejected/);assert.ok(walk(failed).some(node=>node.props["data-image-history"]==="image"));assert.equal(walk(failed).some(node=>node.type==="img"),false,"failed first-page refresh does not resurrect old history bytes when catalog succeeds");h.unmount();
}
{
  const h=await ready();button(h,"真实图像").props.onClick({currentTarget:{isConnected:true,focus(){}}});assert.ok(walk(h.render()).some(node=>node.props.role==="dialog"));assert.match(text(h.render()),/缩略图预览/);h.events.get("keydown")({key:"Escape",preventDefault(){},stopPropagation(){}});assert.equal(walk(h.render()).some(node=>node.props.role==="dialog"),false);h.unmount();
}
{
  const h=await ready();let inert=false, restored=0;
  h.setCommit(tree=>{inert=walk(tree).some(node=>node.props.className==="images-scroll"&&node.props.inert===true);});
  const trigger={isConnected:true,disabled:false,focus(){if(!inert)restored++;}};
  button(h,"真实图像").props.onClick({currentTarget:trigger});h.render();assert.equal(inert,true);
  h.events.get("keydown")({key:"Escape",preventDefault(){},stopPropagation(){}});assert.equal(restored,0,"browser ignores focus() while the trigger's committed ancestor is inert");h.render();
  assert.equal(inert,false);assert.equal(restored,1,"restore trigger focus only after the DOM commit removes inert");h.unmount();
}
{
  const h=imagesHarness();h.render();await flush();const late=h.accesses[0];h.unmount();const writes=h.writes;late.resolve(access);await flush();assert.equal(h.writes,writes);assert.equal(h.histories.length,0);
}
{
  const h=imagesHarness();h.render();await flush();h.accesses[0].resolve(access);await flush();h.catalogs[0].resolve(catalog);
  h.histories[0].resolve(page([{id:"selected",title:"预览中的图像",url:"x"},{id:"other",title:"其他图像",url:"y"}]));await flush();h.render();await flush();
  const selectedDownload=h.assets.find(asset=>asset.ref.id==="selected"), otherDownload=h.assets.find(asset=>asset.ref.id==="other");
  button(h,"预览中的图像").props.onClick({currentTarget:{isConnected:false,disabled:false,focus(){}}});h.render();await flush();
  otherDownload.reject(Error("other background thumbnail failed"));await flush();
  assert.ok(walk(h.render()).some(node=>node.props.role==="dialog"),"an unrelated failed card must not close the selected preview");
  selectedDownload.reject(Error("selected background thumbnail failed"));await flush();const tree=h.render();
  assert.equal(walk(tree).some(node=>node.props.role==="dialog"),false,"a selected card failure removes the unavailable preview");
  assert.equal(walk(tree).some(node=>node.props.inert===true),false,"removing a preview after a background failure must release the page and composer");
  assert.equal(h.events.has("keydown"),false,"removed preview releases its keyboard listener");h.unmount();
}
{
  const h=imagesHarness();h.render();await flush();h.accesses[0].resolve(access);await flush();
  assert.equal(walk(h.render()).filter(node=>node.props.className==="images-skeleton").length,15);
  h.histories[0].resolve(page([{id:"first",title:"先到的图像",url:"https://example.invalid/1"}]));await flush();
  assert.ok(button(h,"先到的图像"),"history renders while catalog stays pending");
  assert.equal(walk(h.render()).filter(node=>node.props.className==="images-skeleton").length,15);
  const currentAsset=h.assets.at(-1);button(h,"先到的图像").props.onClick({currentTarget:{isConnected:true,focus(){}}});h.render();
  h.catalogs[0].resolve(catalog);await flush();assert.ok(button(h,"真实模板"));assert.ok(walk(h.render()).some(node=>node.props.role==="dialog"),"catalog completion does not close unrelated history preview");assert.equal(currentAsset.signal.aborted,false);h.unmount();
}
{
  const h=imagesHarness();h.render();await flush();h.accesses[0].resolve(access);await flush();h.catalogs[0].resolve(catalog);await flush();
  assert.ok(button(h,"真实模板"),"catalog renders while history stays pending");assert.equal(button(h,"真实模板").props.disabled,false);assert.match(text(h.render()),/正在加载图像/);h.unmount();
}
{
  const h=await ready();button(h,"真实模板").props.onClick();button(h,"刷新").props.onClick();h.render();await flush();
  h.accesses.at(-1).resolve({...access,identity:{accountId:"other",userId:"other-user",generation:2}});await flush();
  assert.doesNotMatch(text(h.render()),/真实模板/);assert.equal(walk(h.render()).find(node=>node.type==="textarea").props.value,"");assert.equal(walk(h.render()).some(node=>node.props["data-image-history"]==="image"),false,"confirmed account switch clears old text even if invalidation event was delayed");h.unmount();
}
{
  // Actual masonry implementation with controlled geometry, not a CSS grid substitute.
  const children=[100,40,70].map((height,index)=>({dataset:{masonryItem:String(index)},offsetHeight:height,style:{}}));
  let columns=2, cleanup, observer, hooks=[],cursor=0,effects=[];
  const element={clientWidth:600,style:{},querySelectorAll:()=>children};
  const React={createElement(type,props,...children){if(props?.className==="images-masonry")props.ref.current=element;return{type,props,children};},useRef(initial){const i=cursor++;return hooks[i]??(hooks[i]={current:initial});},useLayoutEffect(effect){effects.push(effect);}};React.default=React;
  const exports={};vm.runInNewContext(compile("src/components/ImagesHistoryMasonry.tsx"),{exports,Map,JSON,Number,parseFloat,Math,
    getComputedStyle:()=>({getPropertyValue:()=>String(columns),rowGap:"12px"}),requestAnimationFrame:callback=>{callback();return 1;},cancelAnimationFrame(){},
    ResizeObserver:class{constructor(callback){observer=this;this.callback=callback;}observe(){}disconnect(){this.disconnected=true;}},require:name=>name==="react"?React:{}});
  const render=()=>{cursor=0;cleanup?.();exports.ImagesHistoryMasonry({items:children.map(child=>({id:child.dataset.masonryItem,content:null}))});while(effects.length)cleanup=effects.shift()();};
  render();assert.equal(children[2].style.gridColumn,"2");assert.equal(children[2].style.transform,"translateY(52px)");assert.equal(element.style.height,"122px");
  children[0].offsetHeight=20;children[1].offsetHeight=150;observer.callback();assert.equal(children[2].style.gridColumn,"2","prefix assignments remain stable after card resize");assert.equal(children[2].style.transform,"translateY(162px)");
  columns=3;observer.callback();assert.equal(children[2].style.gridColumn,"3");assert.equal(children[2].style.transform,"translateY(0px)");cleanup();assert.equal(observer.disconnected,true);
}
console.log("PASS 19E production Images JSX + selectors: independent pending queries, listener gate, readonly draft, layout branches, pagination/error/deny, asset revoke/decode recovery, limited preview/Escape, late results; actual masonry measured shortest column/prefix/resize/cleanup (offline hooks geometry; browser/native separate)");
