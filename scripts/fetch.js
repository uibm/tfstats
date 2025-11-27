import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const HIST = path.join(DATA, "history");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(HIST, { recursive: true });

const TZ = "Asia/Kolkata";
const todayIST = () => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(
    new Date()
  );
  return `${y}-${m}-${d}`;
};
const TODAY = todayIST();

const BASE =
  "https://registry.terraform.io/v2/providers?filter%5Btier%5D=official%2Cpartner%2Ccommunity&sort=-downloads%2Ctier%2Cname&page%5Bsize%5D=150";

const LATEST_PROVIDERS = path.join(DATA, "providers-latest.min.json");
const LATEST_METRICS = path.join(DATA, "metrics-latest.min.json");
const HIST_SNAP = (tag) => path.join(HIST, `providers-${tag}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAllProviders() {
  let url = BASE + "&page%5Bnumber%5D=1";
  const all = [];
  while (url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok)
      throw new Error(`Registry fetch failed ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const items = (j.data || []).map((row) => ({
      id: row.id,
      ...row.attributes,
      self: row.links?.self ?? null
    }));
    all.push(...items);
    const next = j.links?.next;
    url = next ? `https://registry.terraform.io${next}` : null;
    await sleep(150);
  }
  return all;
}

const toFull = (p) => ({
  id: p.id,
  fullName: p["full-name"] || `${p.namespace}/${p.name}`,
  namespace: p.namespace,
  name: p.name,
  alias: p.alias || null,
  tier: p.tier,
  featured: !!p.featured,
  totalDownloads: Number(p.downloads || 0),
  description: p.description || "",
  source: p.source || null,
  logoUrl: p["logo-url"] || null,
  robotsNoIndex: !!p["robots-noindex"],
  unlisted: !!p.unlisted,
  warning: p.warning || ""
});

const toCompact = (list) => {
  const o = {};
  for (const p of list) o[p.fullName] = p.totalDownloads;
  return o;
};

const readSnap = (tag) => {
  const p = HIST_SNAP(tag);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

function findSnapshotNDaysAgo(tagToday, n, grace = 5) {
  const base = new Date(tagToday);
  for (let k = n; k <= n + grace; k++) {
    const d = new Date(base);
    d.setDate(d.getDate() - k);
    const tag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
    const snap = readSnap(tag);
    if (snap) return { tag, snap };
  }
  return null;
}

const rankBy = (arr, fn) => {
  const list = arr.map((x) => ({ key: x.fullName, val: fn(x) }));
  list.sort((a, b) => b.val - a.val);
  const map = new Map();
  list.forEach((x, i) => map.set(x.key, i + 1));
  return map;
};

const computeDeltas = (current, prior = {}) => {
  const out = new Map();
  // Handle case where prior might be undefined or not an object
  const priorTotals = prior && typeof prior === 'object' ? prior : {};

  for (const p of current) {
    const prev = Number(priorTotals[p.fullName] ?? 0);
    const delta = Math.max(0, p.totalDownloads - prev);
    out.set(p.fullName, delta);
  }
  return out;
};

const minify = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj));

async function main() {
  console.log(`[fetch] IST date ${TODAY}`);
  const providers = await fetchAllProviders();
  providers.sort((a, b) => Number(b.downloads || 0) - Number(a.downloads || 0));
  const full = providers.map(toFull);

  minify(LATEST_PROVIDERS, { date: TODAY, providers: full });
  minify(HIST_SNAP(TODAY), { date: TODAY, totals: toCompact(full) });

  const windows = [
    { label: "last_24h", days: 1 },
    { label: "last_7d", days: 7 },
    { label: "last_30d", days: 30 },
    { label: "last_365d", days: 365 }
  ];

  const metrics = { date: TODAY, windows: {}, notes: [] };
  const rankToday = rankBy(full, (p) => p.totalDownloads);

  for (const w of windows) {
    const ref = findSnapshotNDaysAgo(TODAY, w.days);
    if (!ref || !ref.snap || !ref.snap.totals) {
      metrics.windows[w.label] = {
        available: false,
        top: [],
        moversUp: [],
        moversDown: []
      };
      metrics.notes.push(`Insufficient history to compute ${w.label}.`);
      continue;
    }
    const deltas = computeDeltas(full, ref.snap.totals);
    const withPeriod = full.map((p) => ({
      ...p,
      periodDownloads: deltas.get(p.fullName) || 0
    }));
    // Only store essential fields to reduce file size
    const top = withPeriod
      .filter((x) => x.periodDownloads > 0)
      .sort((a, b) => b.periodDownloads - a.periodDownloads)
      .slice(0, 100)
      .map(p => ({
        fullName: p.fullName,
        periodDownloads: p.periodDownloads
      }));

    const priorList = Object.entries(ref.snap.totals).map(([k, v]) => ({
      fullName: k,
      totalDownloads: Number(v)
    }));
    const rankRef = rankBy(priorList, (x) => x.totalDownloads);

    const moversAll = withPeriod
      .map((p) => {
        const before = rankRef.get(p.fullName) || null;
        const now = rankToday.get(p.fullName) || null;
        const change = before && now ? before - now : 0;
        return { fullName: p.fullName, before, now, change };
      })
      .filter((x) => x.before && x.now);

    metrics.windows[w.label] = {
      available: true,
      refDate: ref.tag,
      top,
      moversUp: moversAll
        .slice()
        .sort((a, b) => b.change - a.change)
        .slice(0, 100),
      moversDown: moversAll
        .slice()
        .sort((a, b) => a.change - b.change)
        .slice(0, 100)
    };
  }

  minify(LATEST_METRICS, metrics);

  // Cleanup old history files - keep only last 400 days (more than 365 for yearly comparisons)
  const files = fs
    .readdirSync(HIST)
    .filter((n) => n.startsWith("providers-") && n.endsWith(".json"))
    .sort();
  const keep = 400; // Keep ~13 months of history
  if (files.length > keep) {
    const toDelete = files.slice(0, files.length - keep);
    console.log(`[cleanup] Removing ${toDelete.length} old history files`);
    for (const f of toDelete) fs.unlinkSync(path.join(HIST, f));
  }
  console.log("[done]");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
