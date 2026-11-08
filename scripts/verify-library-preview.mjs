import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load=(file,require=()=>({}))=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require,AbortController,Uint8Array,ArrayBuffer,TextDecoder,atob,Intl,navigator:{userAgent:'Fixture Chrome/140',userAgentData:{platform:'Windows',brands:[{brand:'Chromium',version:'140'}]}},localStorage:{getItem:()=> 'fixture-device'},crypto:{randomUUID:()=> 'preview-request'}});return exports;};
const model=load('src/libraryPreview.ts');
// Oracle: official kind::s plus WP/KP/Spr original functions, fixed Store26.1027.3384.0.
for(const [input,kind]of[
 [{file_name:'report.pdf',mime_type:'application/pdf'},'pdf'],[{file_name:'photo.bin',mime_type:'image/png'},'image'],
 [{file_name:'guide.MD'},'markdown'],[{file_name:'view.html'},'html'],[{file_name:'plain.txt'},'text'],
 [{file_name:'data.json',mime_type:'application/json'},'text'],[{file_name:'table.csv'},'artifact'],
 [{file_name:'report.docx'},'artifact'],[{file_name:'sheet.xlsm'},'artifact'],[{file_name:'deck.pptx'},'artifact'],
 [{file_name:'analysis.ipynb'},'artifact'],[{file_name:'a.txt',library_artifact_type:'deep_research_report'},'deep-research'],
 [{file_name:'clip.mp4',mime_type:'video/mp4'},'unsupported'],[{file_name:'unknown.bin'},'unsupported'],
 [{file_name:'image.pdf',mime_type:'image/png'},'image'],[{file_name:'table.csv',mime_type:'text/plain'},'artifact'],
 [{file_name:'a.csv',file_extension:'pdf'},'unsupported'],[{file_name:'C:/dir.name/.json'},'unsupported'],
 [{file_name:'C:\\dir\\data.JSONL'},'text'],[{file_name:'a.MDX'},'markdown'],
])assert.equal(model.libraryPreviewKind(input),kind,JSON.stringify(input));
assert.equal(model.LIBRARY_PREVIEW_MAX_BYTES,41943040);
const original={id:'file-a',file_name:'A',mime_type:'text/plain',future:{yes:true}};
assert.equal(model.parseLibraryFile({requestedFileId:'file-a',file:original},'file-a').future,original.future);
assert.equal(model.parseLibraryFile({requestedFileId:'a',file:{id:'a',name:'node-name',kind:'file'}},'a').file_name,'node-name');
const shared={id:'libfile_fde1_canonical',canonical_file_id:'libfile_fde1_canonical',access_kind:'shared',kind:'file',name:'Shared'};
assert.equal(model.parseLibraryFile({requestedFileId:'libfile-old',file:shared},'libfile-old').id,shared.id);
for(const value of [null,{}, {requestedFileId:'wrong',file:original},{requestedFileId:'file-a',file:{...original,id:'other'}},{requestedFileId:'file-a',file:{...original,file_name:3}},{requestedFileId:'file-a',file:{...original,kind:'directory'}},{requestedFileId:'file-a',file:{...original,file_size_bytes:-1}},{requestedFileId:'file-a',file:{...shared,access_kind:'owned'}}])assert.throws(()=>model.parseLibraryFile(value,'file-a'));
const identity={accountId:'a',userId:'u',generation:1},access={identity,available:true,onedrive:false};
const calls=[];let respond=async request=>({requestId:request.requestId,identity,body:{requestedFileId:'file-a',file:original}});
const bridge={tauriInvoke:async(command,args)=>{calls.push({command,args});if(command==='chatgpt_service_cancel')return;assert.equal(command,'chatgpt_service_read');return respond(args.request);}};
const service=load('src/chatgptService.ts',name=>name==='./bridge'?bridge:{});
const library=load('src/libraryClient.ts',name=>({'./bridge':bridge,'./chatgptService':service,'./libraryData':load('src/libraryData.ts'),'./libraryPreview':model,'./serviceAccounts':load('src/serviceAccounts.ts')})[name]);
assert.equal((await library.readLibraryFile(access,'file-a',new AbortController().signal)).file_name,'A');
assert.equal(calls[0].args.request.operation,'library_file');assert.equal(JSON.stringify(calls[0].args.request.params),'{"library_file_id":"file-a"}');
assert.equal(calls[0].args.request.expectedIdentity,identity);
respond=async request=>({requestId:request.requestId,identity,body:{bytesBase64:'5Lit5paH',mimeType:'text/plain'}});
respond=async request=>({requestId:request.requestId,identity,body:{bytesBase64:'5Lit5paH',mimeType:'text/plain; charset=utf-8'}});
const content=await library.readLibraryFileContent(access,original,new AbortController().signal);
assert.equal(new TextDecoder().decode(content.bytes),'中文');assert.equal(content.mimeType,'text/plain');
assert.equal(calls[1].args.request.operation,'library_file_content');assert.equal(JSON.stringify(calls[1].args.request.params),'{"library_file_id":"file-a"}');
await library.readLibraryFileContent(access,original,new AbortController().signal,'download');
assert.equal(JSON.stringify(calls.at(-1).args.request.params),'{"library_file_id":"file-a","download":true}');
respond=async request=>({requestId:request.requestId,identity,body:{bytesBase64:'AQEB'.repeat(3*1024*1024),mimeType:'application/octet-stream'}});
assert.equal((await library.readLibraryFileContent(access,original,new AbortController().signal)).bytes.byteLength,9*1024*1024,'valid binary above the old 8MiB image limit must survive the frontend decoder');
respond=async request=>({requestId:request.requestId,identity,body:{bytesBase64:'',mimeType:'text/plain'}});
assert.equal((await library.readLibraryFileContent(access,original,new AbortController().signal)).bytes.byteLength,0,'empty file is actual content');
for(const body of [{bytesBase64:'!!!',mimeType:'text/plain'},{bytesBase64:'AQ==',mimeType:'x\r\nHeader:bad'},{}]){respond=async request=>({requestId:request.requestId,identity,body});await assert.rejects(library.readLibraryFileContent(access,original,new AbortController().signal));}
respond=async request=>({requestId:request.requestId,identity:{...identity,generation:2},body:{requestedFileId:'file-a',file:original}});
await assert.rejects(library.readLibraryFile(access,'file-a',new AbortController().signal),/账号发生变化/);
let resolve;respond=()=>new Promise(r=>{resolve=r});const abort=new AbortController();const pending=library.readLibraryFile(access,'file-a',abort.signal);abort.abort();resolve({requestId:'preview-request',identity,body:{requestedFileId:'file-a',file:original}});await assert.rejects(pending,/取消/);assert.ok(calls.some(x=>x.command==='chatgpt_service_cancel'));
const before=calls.length;await assert.rejects(library.readLibraryFile({...access,available:false},'file-a',new AbortController().signal),/不支持/);assert.equal(calls.length,before);
console.log('PASS official-order preview kind, two metadata shapes/canonical identity, actual empty and Unicode bytes, fixed operations, access/identity/cancellation');
