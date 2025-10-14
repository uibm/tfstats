import fs from "fs";import path from "path";import { fileURLToPath } from "url";
const __filename=fileURLToPath(import.meta.url);const __dirname=path.dirname(__filename);
const ROOT_DIR=path.join(__dirname,"..");const DATA_DIR=path.join(ROOT_DIR,"data");const HIST_DIR=path.join(DATA_DIR,"history");
fs.mkdirSync(DATA_DIR,{recursive:true});fs.mkdirSync(HIST_DIR,{recursive:true});
function todayIST(){const tz="Asia/Kolkata";const now=new Date();const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"});
const[{value:y},,{value:m},,{value:d}]=fmt.formatToParts(now);return `${y}-${m}-${d}`;}
const TODAY=todayIST();const SNAP_PATH=path.join(HIST_DIR,`providers-${TODAY}.json`);const LATEST_PROVIDERS=path.join(DATA_DIR,"providers-latest.json");const LATEST_METRICS=path.join(DATA_DIR,"metrics-latest.json");
const BASE="https://registry.terraform.io";const Q="filter%5Btier%5D=official%2Cpartner%2Ccommunity&sort=-downloads%2Ctier%2Cname&page%5Bsize%5D=150";
async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function fetchAllProviders(){let url=`${BASE}/v2/providers?${Q}&page%5Bnumber%5D=1`;const all=[];while(url){const res=await fetch(url,{headers:{"Accept":"application/json"}});
if(!res.ok)throw new Error(`Registry fetch failed ${res.status}: ${await res.text()}`);const j=await res.json();const items=(j.data||[]).map(row=>({id:row.id,...row.attributes,self:row.links?.self||null}));
all.push(...items);const next=j.links?.next;url=next?`${BASE}${next}`:null;await sleep(150);}return all;}
function loadSnap(tag){const p=path.join(HIST_DIR,`providers-${tag}.json`);if(!fs.existsSync(p))return null;return JSON.parse(fs.readFileSync(p,"utf8"));}
function findSnapshotNDaysAgo(n,grace=5){const base=new Date(TODAY);for(let k=n;k<=n+grace;k++){const d=new Date(base);d.setDate(d.getDate()-k);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,"0");const day=String(d.getDate()).padStart(2,"0");
const tag=`${y}-${m}-${day}`;const snap=loadSnap(tag);if(snap)return{tag,snap};}return null;}
function indexByFullName(list){const map=new Map();for(const p of list){const key=p["full-name"]||`${p.namespace}/${p.name}`;map.set(key,p);}return map;}
function computeDiffs(current,prior){const A=indexByFullName(current);const B=indexByFullName(prior);const out=new Map();for(const [name,a] of A.entries()){const b=B.get(name);const curr=Number(a.downloads||0);const prev=Number(b?.downloads||0);const delta=Math.max(0,curr-prev);out.set(name,delta);}return out;}
function rank(list,keyFn){const arr=list.map(p=>({key:(p["full-name"]||`${p.namespace}/${p.name}`),val:keyFn(p)}));arr.sort((x,y)=>y.val-x.val);const pos=new Map();arr.forEach((row,i)=>pos.set(row.key,i+1));return pos;}
function toPlain(list){return list.map(p=>({id:p.id,fullName:p["full-name"]||`${p.namespace}/${p.name}`,namespace:p.namespace,name:p.name,alias:p.alias||null,tier:p.tier,featured:!!p.featured,totalDownloads:Number(p.downloads||0),description:p.description||"",source:p.source||null,logoUrl:p["logo-url"]||null,robotsNoIndex:!!p["robots-noindex"],unlisted:!!p.unlisted,warning:p.warning||""}));}
async function main(){console.log(`[fetch] IST date ${TODAY}`);const providers=await fetchAllProviders();providers.sort((a,b)=>Number(b.downloads||0)-Number(a.downloads||0));
const plain=toPlain(providers);fs.writeFileSync(SNAP_PATH,JSON.stringify({date:TODAY,providers:plain},null,2));fs.writeFileSync(LATEST_PROVIDERS,JSON.stringify({date:TODAY,providers:plain},null,2));
const windows=[{label:"last_24h",days:1},{label:"last_7d",days:7},{label:"last_30d",days:30},{label:"last_365d",days:365}];
const metrics={date:TODAY,windows:{},notes:[]};const rankToday=rank(plain,p=>p.totalDownloads);
for(const w of windows){const ref=findSnapshotNDaysAgo(w.days);if(!ref){metrics.windows[w.label]={available:false,top:[],moversUp:[],moversDown:[]};metrics.notes.push(`Insufficient history to compute ${w.label}.`);continue;}
const deltas=computeDiffs(plain,ref.snap.providers);const arr=plain.map(p=>({...p,periodDownloads:deltas.get(p.fullName)||0}));
const top=arr.filter(x=>x.periodDownloads>0).sort((a,b)=>b.periodDownloads-a.periodDownloads).slice(0,100);
const rankRef=rank(ref.snap.providers,x=>x.totalDownloads);const moversAll=arr.map(p=>{const before=rankRef.get(p.fullName)||null;const now=rankToday.get(p.fullName)||null;const change=(before&&now)?(before-now):0;return{fullName:p.fullName,before,now,change};}).filter(x=>x.before&&x.now);
const moversUp=moversAll.slice().sort((a,b)=>b.change-a.change).slice(0,100);const moversDown=moversAll.slice().sort((a,b)=>a.change-b.change).slice(0,100);
metrics.windows[w.label]={available:true,refDate:ref.tag,top,moversUp,moversDown};}
fs.writeFileSync(LATEST_METRICS,JSON.stringify(metrics,null,2));
const files=fs.readdirSync(HIST_DIR).filter(n=>n.startsWith("providers-")&&n.endsWith(".json")).sort();if(files.length>800){const toDelete=files.slice(0,files.length-730);for(const f of toDelete)fs.unlinkSync(path.join(HIST_DIR,f));}
console.log("[done]");}
main().catch(err=>{console.error(err);process.exit(1);});