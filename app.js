const $ = (s) => document.querySelector(s);

// Initialize charts with dark theme
const charts = {
  top: echarts.init(document.getElementById("chartTop"), 'dark'),
  movers: echarts.init(document.getElementById("chartMovers"), 'dark'),
};

let PROVIDERS = null, METRICS = null, CURRENT_WINDOW = "last_24h";

// Number formatting
function fmt(n){
  if(n==null) return "—";
  const x = Number(n);
  if (x >= 1_000_000_000) return (x/1_000_000_000).toFixed(2)+"B";
  if (x >= 1_000_000) return (x/1_000_000).toFixed(2)+"M";
  if (x >= 1_000) return (x/1_000).toFixed(1)+"k";
  return String(x);
}

const linkify = (src) => src ? `<a href="${src}" target="_blank" rel="noopener" class="text-green-500 hover:text-green-400 transition">source</a>` : "—";

// Modern color palette for dark theme
const colorAccent = (i=0) => ["#45ffbc","#10b981","#0ea5e9","#6366f1","#f59e0b","#ec4899"][i%6];

async function loadJSON(p){
  const r = await fetch(p,{cache:"no-store"});
  if(!r.ok) throw new Error(p);
  return r.json();
}

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
  $("#headerDate").textContent = PROVIDERS.date;

  const w = pickWindowData(CURRENT_WINDOW);
  $("#kpiWindow").textContent = w ? `ref ${w.refDate}` : "no history";
  $("#kpiMovers").textContent = w ? (w.moversUp.length + w.moversDown.length) : "0";
}

// Update starred provider (IBM-Cloud/ibm)
function updateStarredProvider(){
  const ibm = PROVIDERS.providers.find(p => p.fullName === 'IBM-Cloud/ibm');
  if (!ibm) {
    $("#starredProvider").style.display = "none";
    return;
  }

  const w = pickWindowData(CURRENT_WINDOW);
  const rankNow = PROVIDERS.providers.slice().sort((a,b)=>b.totalDownloads-a.totalDownloads)
                   .findIndex(x=>x.fullName===ibm.fullName)+1;
  const pd = w ? (w.top.find(x=>x.fullName===ibm.fullName)?.periodDownloads ?? 0) : 0;
  const before = w ? (w.moversUp.concat(w.moversDown).find(x=>x.fullName===ibm.fullName)?.before) : null;
  const delta = (before && rankNow) ? (before - rankNow) : 0;

  $("#starredTier").textContent = ibm.tier;
  $("#starredDownloads").textContent = fmt(ibm.totalDownloads);
  $("#starredRank").textContent = rankNow || "—";
  $("#starredPeriod").textContent = w ? fmt(pd) : "—";

  const deltaEl = $("#starredDelta");
  if (delta > 0) {
    deltaEl.className = "text-lg font-bold text-green-500";
    deltaEl.textContent = `▲ ${delta}`;
  } else if (delta < 0) {
    deltaEl.className = "text-lg font-bold text-red-500";
    deltaEl.textContent = `▼ ${Math.abs(delta)}`;
  } else {
    deltaEl.className = "text-lg font-bold text-gray-400";
    deltaEl.textContent = "—";
  }

  $("#starredProvider").style.display = "block";
}

// Charts with dark theme
function buildTopChart(rows){
  const topN = rows.slice(0, 12);
  const names = topN.map(r=>r.fullName);
  const vals  = topN.map(r=>r.periodDownloads);

  charts.top.setOption({
    backgroundColor:"transparent",
    tooltip:{
      trigger:"axis",
      axisPointer:{type:"shadow"},
      backgroundColor: 'rgba(30, 30, 30, 0.9)',
      borderColor: '#45ffbc',
      borderWidth: 1,
      textStyle: { color: '#f1f1f1' },
      formatter:(p)=>`<strong>${p[0].name}</strong><br/>Downloads: <b>${fmt(p[0].value)}</b>`
    },
    grid:{left:8,right:16,bottom:10,top:20,containLabel:true},
    xAxis:{
      type:"value",
      axisLabel:{formatter:fmt, color: '#969593'},
      axisLine:{ lineStyle: { color: '#313131' } },
      splitLine:{ lineStyle: { color: '#313131' } }
    },
    yAxis:{
      type:"category",
      data:names,
      axisLabel:{ color: '#969593' },
      axisLine:{ lineStyle: { color: '#313131' } }
    },
    series:[{
      type:"bar",
      data:vals.map((v,i)=>({value:v,itemStyle:{color:colorAccent(i)}})),
      barMaxWidth:22,
      showBackground:true,
      backgroundStyle:{color:"#2e2e2e"}
    }]
  });
}

function buildMoversChart(moversUp, moversDown){
  const up = moversUp.slice(0,8), down = moversDown.slice(0,8);
  const names = [...up.map(x=>x.fullName), ...down.map(x=>x.fullName)];
  const deltas = [...up.map(x=>x.change), ...down.map(x=>-x.change)];
  const colors = names.map((_,i)=> i<up.length ? "#45ffbc" : "#dc2626");

  charts.movers.setOption({
    backgroundColor:"transparent",
    tooltip:{
      trigger:"axis",
      axisPointer:{type:"shadow"},
      backgroundColor: 'rgba(30, 30, 30, 0.9)',
      borderColor: '#45ffbc',
      borderWidth: 1,
      textStyle: { color: '#f1f1f1' },
      formatter:(p)=>{
        const a=p[0],dir=a.value>=0?"▲":"▼";
        return `<strong>${a.name}</strong><br/>Rank change: <b>${dir} ${Math.abs(a.value)}</b>`;
      }
    },
    grid:{left:8,right:16,bottom:10,top:20,containLabel:true},
    xAxis:{
      type:"value",
      axisLabel:{formatter:(v)=>(v>=0?"+":"−")+Math.abs(v), color: '#969593'},
      axisLine:{ lineStyle: { color: '#313131' } },
      splitLine:{ lineStyle: { color: '#313131' } }
    },
    yAxis:{
      type:"category",
      data:names,
      axisLabel:{ color: '#969593' },
      axisLine:{ lineStyle: { color: '#313131' } }
    },
    series:[{
      type:"bar",
      data:deltas.map((v,i)=>({value:v,itemStyle:{color:colors[i]}})),
      barMaxWidth:22,
      showBackground:true,
      backgroundStyle:{color:"#2e2e2e"}
    }]
  });
}

// Table + modal
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
  $("#thPeriod").textContent = w ? `Period Downloads (${windowKey.replace("last_","")})` : "Period Downloads";

  const frag = document.createDocumentFragment();
  rows.slice(0, 1000).forEach((r,i)=>{
    const tr = document.createElement("tr");
    tr.className = "hover:bg-gray-700 transition cursor-pointer";

    const rankColorClass = r.delta>0 ? "text-green-500" : (r.delta<0 ? "text-red-500" : "text-gray-400");
    const tierBadge = `<span class="inline-block px-2 py-1 text-xs rounded-full ${
      r.tier === 'official' ? 'bg-green-500 bg-opacity-20 text-green-500 border border-green-500' :
      r.tier === 'partner' ? 'bg-blue-500 bg-opacity-20 text-blue-500 border border-blue-500' :
      'bg-gray-600 text-gray-300 border border-gray-600'
    }">${r.tier}</span>`;

    tr.innerHTML = `
      <td class="px-4 py-3 text-gray-300">${i+1}</td>
      <td class="px-4 py-3"><button class="linklike text-green-500 hover:text-green-400 font-semibold transition text-left" data-name="${r.fullName}">${r.fullName}</button></td>
      <td class="px-4 py-3">${tierBadge}</td>
      <td class="px-4 py-3 text-gray-300">${fmt(r.totalDownloads)}</td>
      <td class="px-4 py-3 text-gray-300">${w?fmt(r.periodDownloads):"—"}</td>
      <td class="px-4 py-3 ${rankColorClass} font-semibold">${r.delta===0?"—":(r.delta>0?"▲ ":"▼ ")}${r.delta===0?"":Math.abs(r.delta)}</td>
      <td class="px-4 py-3">${linkify(r.source)}</td>`;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  // bind row buttons
  tbody.querySelectorAll("button.linklike").forEach(btn=>{
    btn.addEventListener("click",(e)=>{
      e.stopPropagation();
      openModal(btn.dataset.name);
    });
  });
}

// Make openModal globally accessible
window.openModal = function(fullName){
  const p = PROVIDERS.providers.find(x=>x.fullName===fullName);
  if(!p) return;
  const w = pickWindowData(CURRENT_WINDOW) || { top:[], moversUp:[], moversDown:[] };
  const pd = w.top ? (w.top.find(x=>x.fullName===fullName)?.periodDownloads ?? 0) : 0;

  $("#modalTitle").textContent = p.fullName;
  $("#modalTier").textContent = p.tier;
  $("#modalRegistry").href = `https://registry.terraform.io/providers/${p.fullName}`;
  $("#modalSource").href = p.source || "#";
  $("#modalSource").style.display = p.source ? "inline-flex" : "none";
  $("#modalDesc").textContent = p.description || "No description available.";
  $("#mTotal").textContent = fmt(p.totalDownloads);

  const rankNow = PROVIDERS.providers.slice().sort((a,b)=>b.totalDownloads-a.totalDownloads)
                   .findIndex(x=>x.fullName===p.fullName)+1;
  const before = w.moversUp ? (w.moversUp.concat(w.moversDown).find(x=>x.fullName===p.fullName)?.before) : null;
  const delta = (before && rankNow) ? (before - rankNow) : 0;

  $("#mRankNow").textContent = rankNow || "—";
  const deltaClass = delta > 0 ? "text-green-500" : (delta < 0 ? "text-red-500" : "text-gray-300");
  $("#mRankDelta").className = `text-xl font-bold ${deltaClass}`;
  $("#mRankDelta").textContent = delta===0?"—":(delta>0?`▲ ${delta}`:`▼ ${Math.abs(delta)}`);
  $("#mPeriod").textContent = w && w.available ? fmt(pd) : "—";

  // Build 4-window mini chart
  const series = [];
  const labels = ["last_24h","last_7d","last_30d","last_365d"];
  const x = ["24h","7d","30d","365d"];
  for(const key of labels){
    const ww = pickWindowData(key);
    if(!ww || !ww.top){ series.push(0); continue; }
    const v = ww.top.find(x=>x.fullName===fullName)?.periodDownloads ?? 0;
    series.push(v);
  }

  const mchart = echarts.init(document.getElementById("modalChart"), 'dark');
  mchart.setOption({
    backgroundColor:"transparent",
    tooltip:{
      trigger:"axis",
      backgroundColor: 'rgba(30, 30, 30, 0.9)',
      borderColor: '#45ffbc',
      borderWidth: 1,
      textStyle: { color: '#f1f1f1' }
    },
    grid:{left:8,right:8,top:12,bottom:32,containLabel:true},
    xAxis:{
      type:"category",
      data:x,
      axisLabel:{ color: '#969593' },
      axisLine:{ lineStyle: { color: '#313131' } }
    },
    yAxis:{
      type:"value",
      axisLabel:{formatter:fmt, color: '#969593'},
      axisLine:{ lineStyle: { color: '#313131' } },
      splitLine:{ lineStyle: { color: '#313131' } }
    },
    series:[{
      type:"bar",
      barMaxWidth:28,
      data:series.map((v,i)=>({value:v,itemStyle:{color:colorAccent(i)}}))
    }]
  });

  document.getElementById("modal").classList.remove("hidden");
  document.getElementById("modal").classList.add("flex");
}

function closeModal(){
  document.getElementById("modal").classList.add("hidden");
  document.getElementById("modal").classList.remove("flex");
}

async function boot(){
  try {
    // Load data files (try .min.json first, fallback to .json)
    try {
      PROVIDERS = await loadJSON("./data/providers-latest.min.json");
    } catch(e) {
      PROVIDERS = await loadJSON("./data/providers-latest.json");
    }

    try {
      METRICS = await loadJSON("./data/metrics-latest.min.json");
    } catch(e) {
      METRICS = await loadJSON("./data/metrics-latest.json");
    }

    // Event listeners
    document.getElementById("windowSelect").addEventListener("change",(e)=>{
      CURRENT_WINDOW = e.target.value;
      syncWindowUI();
    });
    document.getElementById("searchBox").addEventListener("input",()=>rebuildTable(CURRENT_WINDOW));
    document.getElementById("modalClose").addEventListener("click", closeModal);
    document.getElementById("modal").addEventListener("click",(e)=>{
      if(e.target.id==="modal") closeModal();
    });

    // Handle responsive chart resizing
    window.addEventListener('resize', () => {
      charts.top.resize();
      charts.movers.resize();
    });

    // Initial render
    computeKpis();
    syncWindowUI();
  } catch(err) {
    console.error("Failed to load data:", err);
    alert("Failed to load data. Please ensure data files exist in ./data/ directory.");
  }
}

function syncWindowUI(){
  const w = pickWindowData(CURRENT_WINDOW);
  const ref = w && w.refDate ? `ref: ${w.refDate}` : "ref: N/A";
  document.getElementById("refDateTag").textContent = ref;

  if(w && w.top){
    buildTopChart(w.top);
    buildMoversChart(w.moversUp || [], w.moversDown || []);
    document.getElementById("topCountTag").textContent = `${w.top.length} items`;
  } else {
    charts.top.clear();
    charts.movers.clear();
    document.getElementById("topCountTag").textContent = `0 items`;
  }

  computeKpis();
  updateStarredProvider();
  rebuildTable(CURRENT_WINDOW);
}

// Initialize on load
boot();
