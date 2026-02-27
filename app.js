// ===============================
// CONFIG
// ===============================
// Replace this with your deployed worker base URL.
// Example: "https://codm-sentiment.YOURNAME.workers.dev"
const WORKER_BASE_URL = "https://codm-sentiment.shyamvishnu19.workers.dev/";

// If your GitHub Pages site is hosted at https://USERNAME.github.io/REPO/,
// this script is already relative-safe.
const API_PATH = "/api/sentiment";

// ===============================
// DOM
// ===============================
const els = {
  lastUpdated: document.getElementById("lastUpdated"),
  refreshBtn: document.getElementById("refreshBtn"),
  includeTextToggle: document.getElementById("includeTextToggle"),
  useOpenAIToggle: document.getElementById("useOpenAIToggle"),
  sortSelect: document.getElementById("sortSelect"),
  overallScore: document.getElementById("overallScore"),
  overallLabel: document.getElementById("overallLabel"),
  posBar: document.getElementById("posBar"),
  neuBar: document.getElementById("neuBar"),
  negBar: document.getElementById("negBar"),
  posVal: document.getElementById("posVal"),
  neuVal: document.getElementById("neuVal"),
  negVal: document.getElementById("negVal"),
  countsMeta: document.getElementById("countsMeta"),
  postsTbody: document.getElementById("postsTbody"),
  wordCloud: document.getElementById("wordCloud"),
};

function fmtPct(x){
  if (!isFinite(x)) return "—";
  return (x*100).toFixed(1) + "%";
}

function timeAgo(epochSeconds){
  const now = Date.now()/1000;
  const diff = Math.max(0, now - epochSeconds);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function labelFromScore(score){
  // score expected roughly -1..1
  if (!isFinite(score)) return "Unknown";
  if (score > 0.15) return "Positive";
  if (score < -0.15) return "Negative";
  return "Neutral";
}

function badgeClass(label){
  if (label === "Positive") return "pos";
  if (label === "Negative") return "neg";
  return "neu";
}

function clearWordCloud(){
  els.wordCloud.innerHTML = "";
}

function renderWordCloud(freqPairs){
  // freqPairs: [{term, count}]
  clearWordCloud();
  const box = els.wordCloud.getBoundingClientRect();
  const W = Math.max(320, box.width);
  const H = Math.max(240, box.height);

  const maxCount = Math.max(1, ...freqPairs.map(x => x.count));
  const placed = [];

  function overlaps(a,b){
    return !(a.x+a.w < b.x || b.x+b.w < a.x || a.y+a.h < b.y || b.y+b.h < a.y);
  }

  for (let i=0; i<freqPairs.length; i++){
    const {term, count} = freqPairs[i];
    const size = 12 + Math.round((count / maxCount) * 30); // 12..42
    const el = document.createElement("div");
    el.className = "word";
    el.textContent = term;
    el.style.fontSize = size + "px";

    // place with simple retry to reduce overlaps
    let placedBox = null;
    for (let attempt=0; attempt<120; attempt++){
      const x = Math.floor(Math.random()*(W-10));
      const y = Math.floor(Math.random()*(H-10));
      el.style.left = x + "px";
      el.style.top = y + "px";
      els.wordCloud.appendChild(el);
      const r = el.getBoundingClientRect();
      // compute relative box
      const b = {x, y, w: r.width, h: r.height};
      els.wordCloud.removeChild(el);

      let ok = true;
      for (const p of placed){
        if (overlaps(b,p)){ ok=false; break; }
      }
      if (ok){
        placedBox = b;
        el.style.left = x + "px";
        el.style.top = y + "px";
        break;
      }
    }

    if (!placedBox) continue;
    placed.push(placedBox);

    // subtle color variation via opacity only (no hard-coded colors)
    el.style.opacity = (0.65 + Math.random()*0.35).toFixed(2);

    els.wordCloud.appendChild(el);
  }
}

function renderPosts(posts){
  els.postsTbody.innerHTML = "";
  for (const p of posts){
    const tr = document.createElement("tr");

    const label = p.sentiment_label || labelFromScore(p.sentiment_score);
    const cls = badgeClass(label);

    tr.innerHTML = `
      <td>${p.subreddit}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td>${(isFinite(p.sentiment_score) ? p.sentiment_score.toFixed(2) : "—")}</td>
      <td>${escapeHtml(p.title || "")}</td>
      <td>${timeAgo(p.created_utc)}</td>
      <td><a href="${p.url}" target="_blank" rel="noopener">Open</a></td>
    `;
    els.postsTbody.appendChild(tr);
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderOverall(summary){
  const score = summary.overall_score;
  const label = labelFromScore(score);
  els.overallScore.textContent = isFinite(score) ? score.toFixed(2) : "—";
  els.overallLabel.textContent = label;

  const pos = summary.distribution.positive || 0;
  const neu = summary.distribution.neutral || 0;
  const neg = summary.distribution.negative || 0;
  const total = Math.max(1, pos + neu + neg);

  els.posBar.style.width = ((pos/total)*100).toFixed(1) + "%";
  els.neuBar.style.width = ((neu/total)*100).toFixed(1) + "%";
  els.negBar.style.width = ((neg/total)*100).toFixed(1) + "%";

  els.posVal.textContent = fmtPct(pos/total);
  els.neuVal.textContent = fmtPct(neu/total);
  els.negVal.textContent = fmtPct(neg/total);

  els.countsMeta.textContent = `Analyzed ${summary.posts_analyzed} posts • OpenAI: ${summary.used_openai ? "Yes" : "No (fallback)"}`;
}

async function fetchSentiment(){
  if (WORKER_BASE_URL.includes("YOUR-WORKER-URL")){
    els.lastUpdated.textContent = "Set WORKER_BASE_URL in app.js";
    throw new Error("Please set WORKER_BASE_URL in site/app.js to your deployed worker URL.");
  }

  const includeText = els.includeTextToggle.checked ? "1" : "0";
  const useOpenAI = els.useOpenAIToggle.checked ? "1" : "0";
  const sort = els.sortSelect.value;

  const url = `${WORKER_BASE_URL}${API_PATH}?includeText=${includeText}&useOpenAI=${useOpenAI}&sort=${encodeURIComponent(sort)}`;

  els.lastUpdated.textContent = "Loading…";
  const res = await fetch(url, { headers: { "Accept": "application/json" }});
  if (!res.ok){
    const msg = await res.text();
    throw new Error(`Worker error: ${res.status} ${res.statusText}\n${msg}`);
  }
  return await res.json();
}

async function refresh(){
  try{
    els.refreshBtn.disabled = true;
    const data = await fetchSentiment();

    const ts = new Date(data.generated_at).toLocaleString();
    els.lastUpdated.textContent = `Updated: ${ts}`;

    renderOverall(data.summary);
    renderPosts(data.posts);

    const topTerms = (data.wordcloud || []).slice(0, 45);
    renderWordCloud(topTerms);

  }catch(err){
    console.error(err);
    els.lastUpdated.textContent = "Error — check console";
    alert(err.message || String(err));
  }finally{
    els.refreshBtn.disabled = false;
  }
}

els.refreshBtn.addEventListener("click", refresh);
els.includeTextToggle.addEventListener("change", refresh);
els.useOpenAIToggle.addEventListener("change", refresh);
els.sortSelect.addEventListener("change", refresh);

refresh();
