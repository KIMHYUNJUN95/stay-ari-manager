import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const firebaseRc = JSON.parse(fs.readFileSync(path.join(repoRoot, ".firebaserc"), "utf8"));
const projectId = firebaseRc?.projects?.default;
if (!projectId) throw new Error("Firebase default project is not configured.");

function getFirebaseAccessToken() {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "firebase";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "firebase login:list --json"]
    : ["login:list", "--json"];
  const raw = execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const parsed = JSON.parse(raw);
  const account = parsed?.result?.[0];
  const token = account?.tokens?.access_token;
  if (!token) throw new Error("Firebase login token is unavailable. Run firebase login --reauth.");
  return token;
}

function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function getRoomLinks(roomData) {
  if (typeof roomData === "string") {
    return { guest: normalizeUrl(roomData), host: "" };
  }
  if (!roomData || typeof roomData !== "object") return { guest: "", host: "" };
  const guest = normalizeUrl(
    roomData.guest || roomData.guestUrl || roomData.public || roomData.publicUrl || roomData.url || roomData.link
  );
  const host = normalizeUrl(
    roomData.host || roomData.hostUrl || roomData.admin || roomData.adminUrl || roomData.manage || roomData.manageUrl
  );
  return { guest, host };
}

function roomNumber(value) {
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function normalizeOrder(order, platformData) {
  const keys = Object.keys(platformData || {});
  const preferred = Array.isArray(order) ? order.filter((key) => keys.includes(key)) : [];
  const seen = new Set(preferred);
  return [...preferred, ...keys.filter((key) => !seen.has(key)).sort((a, b) => a.localeCompare(b, "ko"))];
}

function buildRows(platform, data) {
  const platformData = data?.[platform] || {};
  const order = normalizeOrder(data?.buildingOrder?.[platform], platformData);
  const rows = [];
  order.forEach((building, buildingIndex) => {
    const rooms = Object.entries(platformData[building] || {})
      .sort(([a], [b]) => roomNumber(a) - roomNumber(b) || a.localeCompare(b, "ko"));
    rooms.forEach(([room, roomData], roomIndex) => {
      const links = getRoomLinks(roomData);
      if (!links.guest && !links.host) return;
      rows.push({
        id: `${platform}-${buildingIndex}-${roomIndex}`,
        platform,
        building,
        room,
        guest: links.guest,
        host: links.host
      });
    });
  });
  return rows;
}

function safeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createHtml(rows, updatedAt) {
  const generatedAt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
  const safeRows = safeJsonForHtml(rows);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>STAY ARI 객실 링크</title>
  <style>
    :root{--navy:#0f2748;--navy2:#173d70;--ink:#15243a;--muted:#66758a;--line:#dce5f0;--bg:#eef3f9;--card:#fff;--air:#ff385c;--book:#003580;--green:#087f5b;--shadow:0 12px 32px rgba(25,54,93,.1)}
    *{box-sizing:border-box} html{scroll-behavior:smooth} body{margin:0;background:linear-gradient(150deg,#f7faff 0%,var(--bg) 52%,#e7eef7 100%);color:var(--ink);font-family:Inter,"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",Arial,sans-serif;min-height:100vh}
    button,input{font:inherit}.shell{max-width:1220px;margin:auto;padding:28px 22px 56px}.hero{position:relative;overflow:hidden;border-radius:28px;padding:30px;background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;box-shadow:0 18px 44px rgba(15,39,72,.22)}
    .hero:after{content:"";position:absolute;width:360px;height:360px;border-radius:50%;right:-120px;top:-210px;background:radial-gradient(circle,rgba(255,255,255,.24),rgba(255,255,255,0) 66%)}
    .brand{display:flex;align-items:center;gap:12px}.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);font-size:21px}.eyebrow{font-size:12px;letter-spacing:.14em;font-weight:800;opacity:.72}.hero h1{margin:4px 0 0;font-size:clamp(25px,4vw,38px);letter-spacing:-.045em}.hero p{margin:15px 0 0;max-width:690px;line-height:1.65;color:rgba(255,255,255,.78);font-size:14px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.meta span{padding:7px 11px;border:1px solid rgba(255,255,255,.17);border-radius:999px;background:rgba(255,255,255,.08);font-size:12px}
    .toolbar{position:sticky;top:0;z-index:10;margin:18px 0 14px;padding:14px;border:1px solid rgba(205,218,233,.9);border-radius:20px;background:rgba(248,251,255,.92);backdrop-filter:blur(16px);box-shadow:0 8px 22px rgba(30,59,94,.08)}.toolbar-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.tabs{display:flex;padding:4px;border-radius:14px;background:#e7edf5}.tab{border:0;border-radius:10px;padding:10px 15px;background:transparent;color:#53647b;font-weight:800;cursor:pointer;transition:.18s}.tab.active{background:#fff;color:var(--navy);box-shadow:0 4px 12px rgba(23,61,112,.12)}.tab[data-platform=airbnb].active{color:var(--air)}.tab[data-platform=booking].active{color:var(--book)}
    .search-wrap{position:relative;flex:1;min-width:220px}.search{width:100%;height:44px;padding:0 42px 0 42px;border:1px solid #cfdae7;border-radius:13px;background:#fff;color:var(--ink);outline:0;transition:.18s}.search:focus{border-color:#6388bc;box-shadow:0 0 0 4px rgba(50,100,165,.1)}.search-icon{position:absolute;left:15px;top:12px;color:#728197}.clear{position:absolute;right:7px;top:6px;width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:#748398;cursor:pointer}.action{height:44px;border:1px solid #cbd7e5;border-radius:13px;padding:0 14px;background:#fff;color:#34465e;font-weight:750;cursor:pointer;transition:.18s}.action:hover{transform:translateY(-1px);border-color:#9fb3cb}.building-strip{display:flex;gap:8px;overflow:auto;padding:12px 1px 2px;scrollbar-width:thin}.building-chip{white-space:nowrap;border:1px solid #d4dfeb;border-radius:999px;padding:8px 12px;background:#fff;color:#52647b;font-size:12px;font-weight:750;cursor:pointer}.building-chip.active{background:var(--navy);border-color:var(--navy);color:#fff}
    .summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}.stat{padding:16px 18px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.86);box-shadow:0 8px 20px rgba(25,54,93,.05)}.stat-label{font-size:12px;color:var(--muted);font-weight:700}.stat-value{margin-top:4px;font-size:23px;font-weight:900;letter-spacing:-.04em}
    .content{display:grid;gap:18px}.building-card{overflow:hidden;border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:var(--shadow)}.building-head{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e8eef5;background:linear-gradient(90deg,#fbfdff,#f4f8fc)}.building-title{font-size:18px;font-weight:900;letter-spacing:-.025em}.count{padding:6px 10px;border-radius:999px;background:#eaf0f7;color:#53667f;font-size:11px;font-weight:800}.table-wrap{overflow-x:auto}.link-table{width:100%;border-collapse:collapse;min-width:720px}.link-table th{padding:11px 16px;background:#f8fafc;color:#718096;font-size:11px;text-align:left;letter-spacing:.04em;text-transform:uppercase}.link-table td{padding:13px 16px;border-top:1px solid #edf1f6;vertical-align:middle}.room{font-size:15px;font-weight:900;color:#223957}.platform-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:850}.platform-dot{width:8px;height:8px;border-radius:50%}.url-text{display:block;max-width:370px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b7c91;font-size:12px}.button-group{display:flex;justify-content:flex-end;gap:7px}.link-button{display:inline-flex;align-items:center;justify-content:center;min-width:70px;height:36px;padding:0 11px;border-radius:10px;border:1px solid #cfdbe8;background:#fff;color:#334a67;text-decoration:none;font-size:12px;font-weight:800;cursor:pointer;transition:.18s}.link-button:hover{transform:translateY(-1px);box-shadow:0 6px 12px rgba(32,62,98,.1)}.link-button.primary{border-color:var(--navy);background:var(--navy);color:#fff}.muted{color:#9aa7b8;font-size:12px}.empty{padding:70px 20px;text-align:center;border:1px dashed #c9d6e4;border-radius:22px;background:rgba(255,255,255,.65);color:#718096}.toast{position:fixed;left:50%;bottom:26px;z-index:40;transform:translate(-50%,24px);opacity:0;pointer-events:none;padding:12px 18px;border-radius:12px;background:#152b49;color:#fff;font-size:13px;font-weight:800;box-shadow:0 12px 30px rgba(15,39,72,.28);transition:.2s}.toast.show{transform:translate(-50%,0);opacity:1}.footer{text-align:center;padding-top:22px;color:#8190a4;font-size:11px}
    @media(max-width:720px){.shell{padding:14px 12px 38px}.hero{padding:22px 19px;border-radius:22px}.hero p{font-size:13px}.toolbar{margin-top:12px;padding:10px;border-radius:16px}.toolbar-row{align-items:stretch}.tabs{width:100%}.tab{flex:1}.search-wrap{order:2;width:100%}.action{flex:1}.summary{grid-template-columns:1fr 1fr}.summary .stat:last-child{grid-column:1/-1}.building-card{border-radius:18px}.building-head{padding:15px}.table-wrap{overflow:visible}.link-table,.link-table tbody{display:block;min-width:0}.link-table thead{display:none}.link-table tr{display:grid;grid-template-columns:1fr auto;gap:8px;padding:14px 15px;border-top:1px solid #edf1f6}.link-table tr:first-child{border-top:0}.link-table td{display:block;padding:0;border:0}.link-table td:nth-child(3){grid-column:1/-1}.link-table td:nth-child(4){grid-column:1/-1}.url-text{max-width:100%;font-size:11px}.button-group{justify-content:flex-start}.link-button{flex:1}.platform-badge{justify-content:flex-end}.building-title{font-size:16px}}
    @media print{body{background:#fff}.shell{max-width:none;padding:0}.hero{box-shadow:none;border-radius:0}.toolbar,.button-group,.toast,.footer{display:none!important}.summary{grid-template-columns:repeat(3,1fr)}.building-card{break-inside:avoid;box-shadow:none;margin-bottom:12px}.link-table{min-width:0}.url-text{white-space:normal;word-break:break-all}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="brand"><div class="mark">↗</div><div><div class="eyebrow">HARU TOKYO · STAY ARI</div><h1>객실 바로가기 링크</h1></div></div>
      <p>건물과 객실을 검색한 뒤 원하는 플랫폼 링크를 열거나 복사하세요. 관리자 링크는 해당 플랫폼 계정으로 로그인한 직원만 접근할 수 있습니다.</p>
      <div class="meta"><span>파일 생성: ${escapeHtml(generatedAt)} JST</span><span>원본 갱신: ${escapeHtml(updatedAt || "확인 불가")}</span><span>직원용</span></div>
    </section>

    <section class="toolbar">
      <div class="toolbar-row">
        <div class="tabs" role="tablist">
          <button class="tab active" data-platform="all">전체</button>
          <button class="tab" data-platform="airbnb">Airbnb</button>
          <button class="tab" data-platform="booking">Booking.com</button>
        </div>
        <div class="search-wrap"><span class="search-icon">⌕</span><input id="search" class="search" type="search" placeholder="건물명 또는 객실번호 검색" autocomplete="off"><button id="clear" class="clear" title="검색어 지우기">×</button></div>
        <button id="copyVisible" class="action">보이는 링크 복사</button>
        <button class="action" onclick="window.print()">인쇄 / PDF</button>
      </div>
      <div id="buildingStrip" class="building-strip"></div>
    </section>

    <section id="summary" class="summary"></section>
    <section id="content" class="content"></section>
    <div class="footer">STAY ARI Room Links · 링크가 열리지 않으면 주소 복사 버튼을 사용하세요.</div>
  </main>
  <div id="toast" class="toast" role="status"></div>

  <script>
    const ROWS = ${safeRows};
    const state = { platform: "all", building: "all", query: "" };
    const platformLabel = { airbnb: "Airbnb", booking: "Booking.com" };
    const search = document.getElementById("search");
    const content = document.getElementById("content");
    const strip = document.getElementById("buildingStrip");
    const summary = document.getElementById("summary");
    const toast = document.getElementById("toast");

    function esc(value) { const node = document.createElement("div"); node.textContent = String(value || ""); return node.innerHTML; }
    function filteredRows() {
      const query = state.query.trim().toLocaleLowerCase("ko");
      return ROWS.filter(row => (state.platform === "all" || row.platform === state.platform)
        && (state.building === "all" || row.building === state.building)
        && (!query || (row.building + " " + row.room + " " + platformLabel[row.platform]).toLocaleLowerCase("ko").includes(query)));
    }
    function availableBuildings() {
      const seen = new Set();
      return ROWS.filter(row => state.platform === "all" || row.platform === state.platform).map(row => row.building).filter(name => !seen.has(name) && seen.add(name));
    }
    function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800); }
    async function copyText(text) {
      try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); } else { const area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.focus(); area.select(); document.execCommand("copy"); area.remove(); } showToast("링크를 복사했습니다."); }
      catch { window.prompt("아래 링크를 복사하세요.", text); }
    }
    function renderBuildings() {
      const names = availableBuildings();
      if (state.building !== "all" && !names.includes(state.building)) state.building = "all";
      strip.innerHTML = ["all", ...names].map(name => '<button class="building-chip ' + (state.building === name ? "active" : "") + '" data-building="' + esc(name) + '">' + (name === "all" ? "모든 건물" : esc(name)) + '</button>').join("");
      strip.querySelectorAll("button").forEach(button => button.addEventListener("click", () => { state.building = button.dataset.building; render(); }));
    }
    function renderSummary(rows) {
      const buildings = new Set(rows.map(row => row.building)).size;
      const roomKeys = new Set(rows.map(row => row.building + "::" + row.room)).size;
      summary.innerHTML = '<div class="stat"><div class="stat-label">표시 건물</div><div class="stat-value">' + buildings + '</div></div><div class="stat"><div class="stat-label">고유 객실</div><div class="stat-value">' + roomKeys + '</div></div><div class="stat"><div class="stat-label">사용 가능한 링크</div><div class="stat-value">' + rows.reduce((n,r)=>n+(r.guest?1:0)+(r.host?1:0),0) + '</div></div>';
    }
    function actionButtons(row) {
      const buttons = [];
      if (row.guest) buttons.push('<a class="link-button primary" href="' + esc(row.guest) + '" target="_blank" rel="noopener noreferrer">공개 링크 열기</a><button class="link-button" data-copy="' + esc(row.guest) + '">복사</button>');
      if (row.host) buttons.push('<a class="link-button" href="' + esc(row.host) + '" target="_blank" rel="noopener noreferrer">관리자 열기</a><button class="link-button" data-copy="' + esc(row.host) + '">복사</button>');
      return buttons.join("");
    }
    function renderContent(rows) {
      if (!rows.length) { content.innerHTML = '<div class="empty"><strong>검색 결과가 없습니다.</strong><br><span>건물명이나 객실번호를 다시 확인해 주세요.</span></div>'; return; }
      const groups = new Map(); rows.forEach(row => { if (!groups.has(row.building)) groups.set(row.building, []); groups.get(row.building).push(row); });
      content.innerHTML = [...groups.entries()].map(([building, items]) => '<article class="building-card"><header class="building-head"><div class="building-title">' + esc(building) + '</div><div class="count">' + new Set(items.map(item=>item.room)).size + '개 객실 · ' + items.length + '개 항목</div></header><div class="table-wrap"><table class="link-table"><thead><tr><th>객실</th><th>플랫폼</th><th>링크</th><th style="text-align:right">바로가기</th></tr></thead><tbody>' + items.map(row => '<tr><td class="room">' + esc(row.room) + '</td><td><span class="platform-badge" style="color:' + (row.platform === "airbnb" ? "var(--air)" : "var(--book)") + '"><span class="platform-dot" style="background:currentColor"></span>' + platformLabel[row.platform] + '</span></td><td><span class="url-text">' + esc(row.guest || row.host) + '</span></td><td><div class="button-group">' + actionButtons(row) + '</div></td></tr>').join("") + '</tbody></table></div></article>').join("");
      content.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", () => copyText(button.dataset.copy)));
    }
    function render() { renderBuildings(); const rows = filteredRows(); renderSummary(rows); renderContent(rows); }
    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab").forEach(x => x.classList.remove("active")); tab.classList.add("active"); state.platform = tab.dataset.platform; state.building = "all"; render(); }));
    search.addEventListener("input", () => { state.query = search.value; render(); });
    document.getElementById("clear").addEventListener("click", () => { search.value = ""; state.query = ""; search.focus(); render(); });
    document.getElementById("copyVisible").addEventListener("click", () => { const rows = filteredRows(); const text = rows.map(row => [row.building, row.room, platformLabel[row.platform], row.guest || "", row.host || ""].filter(Boolean).join(" | ")).join("\\n"); if (text) copyText(text); });
    render();
  </script>
</body>
</html>`;
}

async function main() {
  const token = getFirebaseAccessToken();
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/roomLinks?pageSize=100`;
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}).`);
  const payload = await response.json();
  const documents = payload.documents || [];
  if (!documents.length) throw new Error("No roomLinks document was found in Firestore.");

  const requestedCompanyId = process.argv.find((value) => value.startsWith("--company-id="))?.split("=")[1];
  const selected = requestedCompanyId
    ? documents.find((document) => document.name.endsWith(`/roomLinks/${requestedCompanyId}`))
    : documents.length === 1
      ? documents[0]
      : documents.find((document) => document.name.endsWith("/roomLinks/dGxlQyu47LbplLVCVXiV"));
  if (!selected) throw new Error("Multiple roomLinks documents exist. Pass --company-id=<id>.");

  const data = decodeFields(selected.fields || {});
  const rows = [...buildRows("airbnb", data), ...buildRows("booking", data)];
  if (!rows.length) throw new Error("The selected roomLinks document contains no usable links.");

  const outputArg = process.argv.find((value) => value.startsWith("--output="))?.slice("--output=".length);
  const outputPath = outputArg
    ? path.resolve(repoRoot, outputArg)
    : path.join(repoRoot, "exports", "STAY_ARI_직원용_객실_링크.html");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, createHtml(rows, data.updatedAt), "utf8");

  const buildingCount = new Set(rows.map((row) => row.building)).size;
  const platformCounts = rows.reduce((acc, row) => ({ ...acc, [row.platform]: (acc[row.platform] || 0) + 1 }), {});
  const sourceRoomCounts = Object.fromEntries(["airbnb", "booking"].map((platform) => [
    platform,
    Object.values(data?.[platform] || {}).reduce((count, rooms) => count + Object.keys(rooms || {}).length, 0)
  ]));
  console.log(JSON.stringify({ outputPath, buildingCount, rowCount: rows.length, platformCounts, sourceRoomCounts }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
