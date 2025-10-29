const $ = (s) => document.querySelector(s);

// charts
const charts = {
  top: echarts.init(document.getElementById("chartTop")),
  movers: echarts.init(document.getElementById("chartMovers")),
};
let PROVIDERS = null, METRICS = null, CURRENT_WINDOW = "last_24h";

function fmt(n){
  if(n==null) return "—";
  const x = Number(n);
  if (x >= 1_000_000_000) return (x/1_000_000_000).toFixed(2)+"B";
  if (x >= 1_000_000) return (x/1_000_000).toFixed(2)+"M";
  if (x >= 1_000) return (x/1_000).toFixed(1)+"k";
  return String(x);
}
const linkify = (src) => src ? `<a href="${src}" target="_blank" rel="noopener">source</a>` : "—";
const colorAccent = (i=0) => ["#00b686","#10b981","#0ea5e9","#6366f1","#f59e0b"][i%5];

async function loadJSON(p){ const r = await fetch(p,{cache:"no-store"}); if(!r.ok) throw new Error(p); return r.json(); }
const pickWindowData = (key) => (METRICS.windows[key] && METRICS.windows[key].available) ? METRICS.windows[key] : null;

// KPI builders
function computeKpis(){
  const list = PROVIDERS.providers;
  const totalProviders = list.length;
  const totalDownloads = list.reduce((s,p)=>s+Number(p.totalDownloads||0),0);
  const tierCount = (t)=>list.filter(p=>p.tier===t).length;
  $("#kpiProviders").textContent = totalProviders.toLocaleString();
  $("#kpiDownloads").textContent = fmt(totalDownloads);
  $("#kpiTierSplit").textContent = `${tierCount("official")} / ${tierCount("partner")} / ${tierCount("community")}`;
  $("#kpiDate").textContent = `as of ${PROVIDERS.date}`;
  const w = pickWindowData(CURRENT_WINDOW);
  $("#kpiWindow").textContent = w ? `ref ${w.refDate}` : "no history";
  $("#kpiMovers").textContent = w ? (w.moversUp.length + w.moversDown.length) : "0";
}

// charts
function buildTopChart(rows){
  const topN = rows.slice(0, 12);
  const names = topN.map(r=>r.fullName);
  const vals  = topN.map(r=>r.periodDownloads);
  charts.top.setOption({
    backgroundColor:"transparent",
    tooltip:{ trigger:"axis", axisPointer:{type:"shadow"},
      formatter:(p)=>`${p[0].name}<br/>Downloads: <b>${fmt(p[0].value)}</b>` },
    grid:{left:8,right:16,bottom:10,top:20,containLabel:true},
    xAxis:{type:"value",axisLabel:{formatter:fmt}},
    yAxis:{type:"category",data:names},
    series:[{type:"bar",data:vals.map((v,i)=>({value:v,itemStyle:{color:colorAccent(i)}})),
             barMaxWidth:18,showBackground:true,backgroundStyle:{color:"#eef2f7"}}]
  });
}

function buildMoversChart(moversUp, moversDown){
  const up = moversUp.slice(0,8), down = moversDown.slice(0,8);
  const names = [...up.map(x=>x.fullName), ...down.map(x=>x.fullName)];
  const deltas = [...up.map(x=>x.change), ...down.map(x=>-x.change)];
  const colors = names.map((_,i)=> i<up.length ? "#16a34a" : "#dc2626");
  charts.movers.setOption({
    backgroundColor:"transparent",
    tooltip:{ trigger:"axis", axisPointer:{type:"shadow"},
      formatter:(p)=>{ const a=p[0],dir=a.value>=0?"▲":"▼"; return `${a.name}<br/>Rank change: <b>${dir} ${Math.abs(a.value)}</b>`; } },
    grid:{left:8,right:16,bottom:10,top:20,containLabel:true},
    xAxis:{type:"value",axisLabel:{formatter:(v)=>(v>=0?"+":"−")+Math.abs(v)}},
    yAxis:{type:"category",data:names},
    series:[{type:"bar",data:deltas.map((v,i)=>({value:v,itemStyle:{color:colors[i]}})),
             barMaxWidth:18,showBackground:true,backgroundStyle:{color:"#eef2f7"}}]
  });
}

// table + click -> modal
function rebuildTable(windowKey){
  const tbody = document.querySelector("#providersTable tbody");
  tbody.innerHTML = "";
  const w = pickWindowData(windowKey);
  const q = ($("#searchBox").value||"").toLowerCase();

  const rankNow = new Map();
  PROVIDERS.providers.slice().sort((a,b)=>b.totalDownloads-a.totalDownloads).forEach((p,i)=>rankNow.set(p.fullName,i+1));

  let rows = PROVIDERS.providers.map((p,i)=>{
    const pd = w ? (w.top.find(x=>x.fullName===p.fullName)?.periodDownloads ?? 0) : 0;
    const before = w && w.moversUp.concat(w.moversDown).find(x=>x.fullName===p.fullName)?.before;
    const now = rankNow.get(p.fullName);
    const delta = (before && now) ? (before - now) : 0;
    return { idx:i+1, ...p, periodDownloads:pd, delta, rankNow: now, rankBefore: before };
  });
  if(q) rows = rows.filter(r=>r.fullName.toLowerCase().includes(q));

  $("#catalogCountTag").textContent = `${rows.length} shown`;
  $("#thPeriod").textContent = w ? `Period downloads (${windowKey.replace("last_","")})` : "Period downloads";

  const frag = document.createDocumentFragment();
  rows.slice(0, 1000).forEach((r,i)=>{
    const tr = document.createElement("tr");
    const rankClass = r.delta>0 ? "rank-up" : (r.delta<0 ? "rank-down" : "");
    tr.innerHTML = `
      <td>${i+1}</td>
      <td><button class="linklike" data-name="${r.fullName}"><strong>${r.fullName}</strong></button></td>
      <td><span class="badge">${r.tier}</span></td>
      <td>${fmt(r.totalDownloads)}</td>
      <td>${w?fmt(r.periodDownloads):"—"}</td>
      <td class="${rankClass}">${r.delta===0?"—":(r.delta>0?"▲ ":"▼ ")}${r.delta===0?"":Math.abs(r.delta)}</td>
      <td>${linkify(r.source)}</td>`;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  // bind row buttons
  tbody.querySelectorAll("button.linklike").forEach(btn=>{
    btn.addEventListener("click",()=>openModal(btn.dataset.name));
  });
}

function openModal(fullName){
  const p = PROVIDERS.providers.find(x=>x.fullName===fullName);
  if(!p) return;
  const w = pickWindowData(CURRENT_WINDOW) || { top:[], moversUp:[], moversDown:[] };
  const pd = w.top.find(x=>x.fullName===fullName)?.periodDownloads ?? 0;

  $("#modalTitle").textContent = p.fullName;
  $("#modalTier").textContent = p.tier;
  $("#modalRegistry").href = `https://registry.terraform.io/providers/${p.fullName}`;
  $("#modalSource").href = p.source || "#";
  $("#modalDesc").textContent = p.description || "No description.";
  $("#mTotal").textContent = fmt(p.totalDownloads);
  const rankNow = PROVIDERS.providers.slice().sort((a,b)=>b.totalDownloads-a.totalDownloads)
                   .findIndex(x=>x.fullName===p.fullName)+1;
  const before = (w.moversUp.concat(w.moversDown).find(x=>x.fullName===p.fullName)?.before) || null;
  const delta = (before && rankNow) ? (before - rankNow) : 0;
  $("#mRankNow").textContent = rankNow || "—";
  $("#mRankDelta").textContent = delta===0?"—":(delta>0?`▲ ${delta}`:`▼ ${Math.abs(delta)}`);
  $("#mPeriod").textContent = w && w.available ? fmt(pd) : "—";

  // build 4-window mini chart
  const series = [];
  const labels = ["last_24h","last_7d","last_30d","last_365d"];
  const x = ["24h","7d","30d","365d"];
  for(const key of labels){
    const ww = pickWindowData(key);
    if(!ww){ series.push(0); continue; }
    const v = ww.top.find(x=>x.fullName===fullName)?.periodDownloads ?? 0;
    series.push(v);
  }
  const mchart = echarts.init(document.getElementById("modalChart"));
  mchart.setOption({
    tooltip:{trigger:"axis"},
    grid:{left:8,right:8,top:12,bottom:18,containLabel:true},
    xAxis:{type:"category",data:x},
    yAxis:{type:"value",axisLabel:{formatter:fmt}},
    series:[{type:"bar",barMaxWidth:22,data:series.map((v,i)=>({value:v,itemStyle:{color:colorAccent(i)}}))}]
  });

  document.getElementById("modal").classList.remove("hidden");
}

function closeModal(){
  document.getElementById("modal").classList.add("hidden");
}

async function boot(){
  // keep your existing file names
  PROVIDERS = await loadJSON("./data/providers-latest.json");
  METRICS   = await loadJSON("./data/metrics-latest.json");

  document.getElementById("windowSelect").addEventListener("change",(e)=>{
    CURRENT_WINDOW = e.target.value; syncWindowUI();
  });
  document.getElementById("searchBox").addEventListener("input",()=>rebuildTable(CURRENT_WINDOW));
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modal").addEventListener("click",(e)=>{ if(e.target.id==="modal") closeModal(); });

  computeKpis();
  syncWindowUI();
}

function syncWindowUI(){
  const w = pickWindowData(CURRENT_WINDOW);
  const ref = w && w.refDate ? `ref: ${w.refDate}` : "ref: N/A";
  document.getElementById("refDateTag").textContent = ref;

  if(w){
    buildTopChart(w.top);
    buildMoversChart(w.moversUp, w.moversDown);
    document.getElementById("topCountTag").textContent = `${w.top.length} items`;
  } else {
    charts.top.clear(); charts.movers.clear();
    document.getElementById("topCountTag").textContent = `0 items`;
  }
  computeKpis();
  rebuildTable(CURRENT_WINDOW);
}

boot().catch(err=>{ console.error(err); alert("Failed to load data. See console."); });
