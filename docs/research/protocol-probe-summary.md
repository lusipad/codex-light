## initialize  (168 bytes)
{userAgent:"probe/0.159.0 (Windows 10.0.26200; x86_64) unknown (probe; 0…",codexHome:"C:\\Users\\lus\\.codex",platformFamily:"windows",platformOs:"windows"}

## account/read  (263 bytes)
{account:{type:"chatgpt",email:"lusipad163@gmail.com",planType:"plus"},requiresOpenaiAuth:true,workspaceRouting:{chatgptAccountId:"f99ab665-735a-40c2-a9ae-dcb0b6785054",backendOrigin:"https://chatgpt.com",accountRoutingOverride:"NO_CONSTRAINT"}}

## account/rateLimits/read  (1521 bytes)
{ordinaryUsageAllowed:true,rateLimits:{limitId:"codex",limitName:null,normalModelSlug:null,primary:{usedPercent:0,windowDurationMins:300,resetsAt:1792727265},secondary:{usedPercent:0,windowDurationMins:10080,resetsAt:1793314065},credits:{hasCredits:false,unlimited:false,balance:"0"},individualLimit:null,spendControlReached:false,planType:"plus",rateLimitReachedType:null},rateLimitsByLimitId:{codex:{limitId:"codex",limitName:null,normalModelSlug:null,primary:{...},secondary:{...},credits:{...},individualLimit:null,spendControlReached:false,planType:"plus",rateLimitReachedType:null}},rateLimitResetCredits:{availableCount:2,credits:[2x {...}]},accountId:"f99ab665-735a-40c2-a9ae-dcb0b6785054",rateLimitUpsell:null}

## account/usage/read  (4603 bytes)
{summary:{lifetimeTokens:26065805032,peakDailyTokens:1989011773,longestRunningTurnSec:81749,currentStreakDays:0,longestStreakDays:19},dailyUsageBuckets:[99x {startDate:"2026-03-05",tokens:1395332}],threadUsage:null}

## account/workspaceMessages/read  (38 bytes)
{featureEnabled:false,messages:[]}

## configRequirements/read  (21 bytes)
{requirements:null}

## experimentalFeature/list  (22968 bytes)
{data:[152x {name:"analytics_plan_history",stage:"beta",displayName:"Analytics plan history",description:"Preview five-hour and weekly allowance history for consumer …",announcement:"",enabled:false,defaultEnabled:false}],nextCursor:null}

## permissionProfile/list  (199 bytes)
{data:[3x {id:":read-only",description:null,allowed:true}],nextCursor:null}

## modelProvider/capabilities/read  (63 bytes)
{namespaceTools:true,imageGeneration:true,webSearch:true}

## collaborationMode/list  (154 bytes)
{data:[2x {name:"Plan",mode:"plan",model:null,reasoning_effort:"medium"}]}

## project/list  (2659 bytes)
{data:[13x {id:"01a06390-ee83-7e62-a2a3-dc642e4fd518",name:"searchlight",roots:[1x {...}],metadata:{...},position:0,createdAt:1788376837,updatedAt:1788376837,recencyAt:null}],nextCursor:null}

## threadSection/list  (108 bytes)
{data:[1x {id:"01984de2-8f74-7c91-a3b2-5c5e937cf318",name:"Pinned",appearance:null}],nextCursor:null}

## plugin/list  (17082778 bytes)
{marketplaces:[3x {name:"openai-primary-runtime",path:"C:\\Users\\lus\\.cache\\codex-runtimes\\codex-primary-runtime\\plu…",interface:null,plugins:[5x {...}]}],marketplaceLoadErrors:[],featuredPluginIds:[23x "teams@openai-curated-remote"]}

## plugin/installed  (33912 bytes)
{marketplaces:[3x {name:"openai-primary-runtime",path:"C:\\Users\\lus\\.cache\\codex-runtimes\\codex-primary-runtime\\plu…",interface:null,plugins:[5x {...}]}],marketplaceLoadErrors:[]}

## marketplace/list
ERROR: {"code":-32600,"message":"Invalid request: unknown variant `marketplace/list`, expected one of `initialize`, `server/diagnostics`, `userVerification/status`, `userVerification/enroll`, `userVerification/delete`, `userVerification/verify`, `userVerification/cancel`, `thread/start`, `thread/resume`, `thread/fork`, `thread/archive`, `thread/delete`, `thread/unsubscribe`, `thread/increment_elicitation`, `thread/decrement_elicitation`, `thread/name/set`, `thread/goal/set`, `thread/goal/get`, `thread/goal/clear`, `thread/queue/add`, `thread/queue/list`, `thread/queue/update`, `thread/queue/delete`, `thread/queue/reorder`, `thread/queue/start`, `thread/metadata/update`, `thread/attachment/add`, `thread/attachment/list`, `thread/attachment/remove`, `thread/section/move`, `thread/settings/update`, 

## hooks/list  (89 bytes)
{data:[1x {cwd:"D:\\Repos\\codex-desktop-native",hooks:[],warnings:[],errors:[]}]}

## skills/list  (46612 bytes)
{data:[1x {cwd:"D:\\Repos\\codex-desktop-native",skills:[70x {...}],errors:[]}]}

## memory/status  (43 bytes)
{v2ConsolidatedThreads:0,v2Ready:false}

## environment/status
ERROR: {"code":-32600,"message":"Invalid request: missing field `environmentId`"}

## remoteControl/status/read  (120 bytes)
{status:"disabled",serverName:"LUS-PC",installationId:"004ebaf1-976b-49d7-8520-33193ed1ca2a",environmentId:null}

## thread/list  (2882 bytes)
{data:[3x {id,environments,extra,sessionId,forkedFromId,parentThreadId,preview,ephemeral,section,sectionEnteredAt,projectId,historyMode,modelProvider,model,...32 keys}],nextCursor:"2026-09-30T03:17:19Z",backwardsCursor:"2026-10-19T23:06:21.471Z"}

## thread/search
ERROR: {"code":-32600,"message":"Invalid request: missing field `searchTerm`"}

## fuzzyFileSearch  (836 bytes)
{files:[5x {root:"D:\\Repos\\codex-desktop-native",path:".git\\hooks\\applypatch-msg.sample",match_type:"file",file_name:"applypatch-msg.sample",score:84,indices:[3x 11]}]}

## fs/readDirectory  (1092 bytes)
{entries:[18x {fileName:".cargo",isDirectory:true,isFile:false}]}

## fs/getMetadata  (110 bytes)
{isDirectory:false,isFile:true,isSymlink:false,createdAtMs:1792709037840,modifiedAtMs:1792709037841}

## getAuthStatus  (67 bytes)
{authMethod:"chatgpt",authToken:null,requiresOpenaiAuth:true}

## gitDiffToRemote  (257 bytes)
{sha:"fad91291353c79c583c1e41ac01defd7b0c7c366",diff:"diff --git a/.gitignore b/.gitignore\nindex b9579e3..7ee03ad …"}
