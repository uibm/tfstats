const $=(s)=>document.querySelector(s);
const charts={top:echarts.init(document.getElementById("chartTop")),movers:echarts.init(document.getElementById("chartMovers"))};
let PROVIDERS=null, METRICS=null, CURRENT_WINDOW="last_24h";
function fmt(n){if(n==null)return"—";const x=Number(n);if(x>=1_000_000_000)return(x/1_000_000_000).toFixed(1)+"B";if(x>=1_000_000)return(x/1_000_000).toFixed(1)+"M";if(x>=1_000)return(x/1_000).toFixed(1)+"k";return String(x)}
function linkify(src){if(!src)return"—";const url=src, pretty=src.replace(/^https?:\/\//,"").replace(/\/$/,"");return `<a href="${url}" target="_blank" rel="noopener">${pretty}</a>`}
function colorAccent(i=0){const p=["#a737ff","#911ced","#0c56e9","#0046d1","#1060ff"];return p[i%p.length]}
async function loadJSON(p){const res=await fetch(p,{cache:"no-store"});if(!res.ok)throw new Error(`Failed ${p}: ${res.status}`);return res.json()}
function pickWindowData(key){const w=METRICS.windows[key];return w&&w.available?w:null}
function buildTopChart(rows){const topN=rows.slice(0,20);const names=topN.map(r=>r.fullName);const vals=topN.map(r=>r.periodDownloads);
  charts.top.setOption({backgroundColor:"transparent",tooltip:{trigger:"axis",axisPointer:{type:"shadow"},formatter:(p)=>`${p[0].name}<br/>Downloads: <b>${fmt(p[0].value)}</b>`},
  grid:{left:8,right:16,bottom:10,top:20,containLabel:true},xAxis:{type:"value",axisLabel:{formatter:fmt}},yAxis:{type:"category",data:names},
  series:[{type:"bar",data:vals.map((v,i)=>({value:v,itemStyle:{color:colorAccent(i)}})),barMaxWidth:16,showBackground:true,backgroundStyle:{color:"#f1f2f3"}}]});}
function buildMoversChart(moversUp,moversDown){const up=moversUp.slice(0,10),down=moversDown.slice(0,10);const names=[...up.map(x=>x.fullName),...down.map(x=>x.fullName)];
  const deltas=[...up.map(x=>x.change),...down.map(x=>-x.change)];const colors=names.map((_,i)=>i<up.length?"#008a22":"#e52228");
  charts.movers.setOption({backgroundColor:"transparent",tooltip:{trigger:"axis",axisPointer:{type:"shadow"},
  formatter:(p)=>{const a=p[0],dir=a.value>=0?"▲":"▼";return `${a.name}<br/>Rank change: <b>${dir} ${Math.abs(a.value)}</b>`}},
  grid:{left:8,right:16,bottom:10,top:20,containLabel:true},xAxis:{type:"value",axisLabel:{formatter:(v)=>(v>=0?"+":"−")+Math.abs(v)}},
  yAxis:{type:"category",data:names},series:[{type:"bar",data:deltas.map((v,i)=>({value:v,itemStyle:{color:colors[i]}})),barMaxWidth:16,showBackground:true,backgroundStyle:{color:"#f1f2f3"}}]});}
function rebuildTable(windowKey){const w=pickWindowData(windowKey),tbody=document.querySelector("#providersTable tbody");tbody.innerHTML="";const q=(document.querySelector("#searchBox").value||"").toLowerCase();
  const rankMapNow=new Map();PROVIDERS.providers.slice().sort((a,b)=>b.totalDownloads-a.totalDownloads).forEach((p,i)=>rankMapNow.set(p.fullName,i+1));
  let rows=PROVIDERS.providers.map((p,i)=>{const periodDownloads=w?(w.top.find(x=>x.fullName===p.fullName)?.periodDownloads??0):0;
    const before=w&&w.moversUp.concat(w.moversDown).find(x=>x.fullName===p.fullName)?.before;const now=rankMapNow.get(p.fullName);
    const delta=(before&&now)?(before-now):0;return{idx:i+1,...p,periodDownloads,delta};});
  if(q)rows=rows.filter(r=>r.fullName.toLowerCase().includes(q));
  document.querySelector("#catalogCountTag").textContent=`${rows.length} shown`;document.querySelector("#thPeriod").textContent=w?`Period downloads (${windowKey.replace("last_","")})`:"Period downloads";
  const frag=document.createDocumentFragment();rows.slice(0,1000).forEach((r,i)=>{const tr=document.createElement("tr");const rankClass=r.delta>0?"rank-up":(r.delta<0?"rank-down":"");
    tr.innerHTML=`<td>${i+1}</td><td><strong>${r.fullName}</strong></td><td><span class="badge">${r.tier}</span></td><td>${fmt(r.totalDownloads)}</td>
    <td>${w?fmt(r.periodDownloads):"—"}</td><td class="${rankClass}">${r.delta===0?"—":(r.delta>0?"▲ ":"▼ ")}${r.delta===0?"":Math.abs(r.delta)}</td><td>${linkify(r.source)}</td>`;frag.appendChild(tr);});
  tbody.appendChild(frag);}
async function boot(){PROVIDERS=await loadJSON("./data/providers-latest.json");METRICS=await loadJSON("./data/metrics-latest.json");
  document.querySelector("#windowSelect").addEventListener("change",e=>{CURRENT_WINDOW=e.target.value;syncWindowUI()});
  document.querySelector("#searchBox").addEventListener("input",e=>rebuildTable(CURRENT_WINDOW));syncWindowUI();}
function syncWindowUI(){const w=pickWindowData(CURRENT_WINDOW);const ref=w&&w.refDate?`ref: ${w.refDate}`:"ref: N/A";document.querySelector("#refDateTag").textContent=ref;
  if(w){buildTopChart(w.top);buildMoversChart(w.moversUp,w.moversDown);document.querySelector("#topCountTag").textContent=`${w.top.length} items`;}
  else{charts.top.clear();charts.movers.clear();document.querySelector("#topCountTag").textContent=`0 items`;}rebuildTable(CURRENT_WINDOW);}
boot().catch(err=>{console.error(err);alert("Failed to load data. See console.")});