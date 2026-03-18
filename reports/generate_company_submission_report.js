const fs = require("fs");

const inputPath = "c:/-stay-ari-manager-main/reports/pax_report_2025-12_to_2026-02_room_details.csv";
const outputPath = "c:/-stay-ari-manager-main/reports/company_submission_pax_report_2025-12_to_2026-02.txt";

const raw = fs.readFileSync(inputPath, "utf8").trim().split(/\r?\n/);
const header = raw.shift().split(",");
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const buildings = ["아라키초A", "아라키초B", "가부키초", "다카다노바바"];
const data = {};
for (const b of buildings) {
  data[b] = {
    rooms: {},
    tot: { total: 0, one: 0, two: 0, three: 0, four: 0, fivep: 0 },
  };
}

for (const line of raw) {
  const c = line.split(",");
  const building = c[idx.building];
  if (!data[building]) continue;
  const room = c[idx.room];

  const total = Number(c[idx.total] || 0);
  const one = Number(c[idx["1"]] || 0);
  const two = Number(c[idx["2"]] || 0);
  const three = Number(c[idx["3"]] || 0);
  const four = Number(c[idx["4"]] || 0);
  const fivep =
    Number(c[idx["5"]] || 0) +
    Number(c[idx["6"]] || 0) +
    Number(c[idx["7"]] || 0) +
    Number(c[idx["8"]] || 0) +
    Number(c[idx["9plus"]] || 0);

  if (!data[building].rooms[room]) {
    data[building].rooms[room] = { total: 0, one: 0, two: 0, three: 0, four: 0, fivep: 0 };
  }
  const r = data[building].rooms[room];
  r.total += total;
  r.one += one;
  r.two += two;
  r.three += three;
  r.four += four;
  r.fivep += fivep;
}

for (const b of buildings) {
  for (const r of Object.values(data[b].rooms)) {
    data[b].tot.total += r.total;
    data[b].tot.one += r.one;
    data[b].tot.two += r.two;
    data[b].tot.three += r.three;
    data[b].tot.four += r.four;
    data[b].tot.fivep += r.fivep;
  }
}

const pct = (n, d) => (d ? ((n * 100) / d).toFixed(1) : "0.0");
const pad = (s, n) => {
  const text = String(s);
  return text.length >= n ? text : text + " ".repeat(n - text.length);
};

let out = "";
for (const b of buildings) {
  const rooms = Object.entries(data[b].rooms).sort((a, z) => a[0].localeCompare(z[0], "ko"));
  const t = data[b].tot;

  out += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
  out += `${b} 객실별 인원 예약 분석 보고서\n`;
  out += "분석 기간: 2025-12-01 ~ 2026-02-28\n";
  out += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

  out += "【1】 인원별 예약 통계\n";
  out += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
  out += `│ ${pad("방", 8)} │ ${pad("총 예약", 8)} │ ${pad("1인", 6)} │ ${pad("2인", 6)} │ ${pad("3인", 6)} │ ${pad("4인", 6)} │ ${pad("5인+", 7)} │\n`;
  for (const [room, r] of rooms) {
    out += `│ ${pad(room, 8)} │ ${pad(r.total + "건", 8)} │ ${pad(r.one + "건", 6)} │ ${pad(r.two + "건", 6)} │ ${pad(r.three + "건", 6)} │ ${pad(r.four + "건", 6)} │ ${pad(r.fivep + "건", 7)} │\n`;
  }
  out += `│ ${pad("합계", 8)} │ ${pad(t.total + "건", 8)} │ ${pad(t.one + "건", 6)} │ ${pad(t.two + "건", 6)} │ ${pad(t.three + "건", 6)} │ ${pad(t.four + "건", 6)} │ ${pad(t.fivep + "건", 7)} │\n\n`;

  out += "【2】 저활용 분석 (1~2인 숙박)\n";
  out += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
  out += `│ ${pad("방", 8)} │ ${pad("저활용 (1~2인)", 18)} │ ${pad("비율", 8)} │\n`;
  let lowTotal = 0;
  for (const [room, r] of rooms) {
    const low = r.one + r.two;
    lowTotal += low;
    out += `│ ${pad(room, 8)} │ ${pad(`${low}건/${r.total}건`, 18)} │ ${pad(pct(low, r.total) + "%", 8)} │\n`;
  }
  out += `│ ${pad("합계", 8)} │ ${pad(`${lowTotal}건/${t.total}건`, 18)} │ ${pad(pct(lowTotal, t.total) + "%", 8)} │\n\n`;

  out += "▶ 전체 통계\n";
  out += `  • 총 예약: ${t.total}건\n`;
  out += `  • 1인 예약: ${t.one}건 (${pct(t.one, t.total)}%)\n`;
  out += `  • 2인 예약: ${t.two}건 (${pct(t.two, t.total)}%)\n`;
  out += `  • 3인 예약: ${t.three}건 (${pct(t.three, t.total)}%)\n`;
  out += `  • 4인 예약: ${t.four}건 (${pct(t.four, t.total)}%)\n`;
  out += `  • 5인+ 예약: ${t.fivep}건 (${pct(t.fivep, t.total)}%)\n\n\n`;
}

fs.writeFileSync(outputPath, out, "utf8");
console.log("written:", outputPath);
