const fs = require("fs");
const admin = require("firebase-admin");
const dayjs = require("dayjs");
const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const TARGET_SHEET_TITLE = "임시_객실인원리포트_0304_1457";
const START_DATE = "2025-12-01";
const END_DATE = "2026-02-28";
const BUILDINGS = ["아라키초A", "아라키초B", "가부키초", "다카다노바바"];

const OUT_TXT = "c:/-stay-ari-manager-main/reports/company_submission_pax_report_2025-12_to_2026-02_bookDate.txt";

const pct = (n, d) => (d ? ((n * 100) / d).toFixed(1) : "0.0");
const pad = (s, n) => {
  const text = String(s);
  return text.length >= n ? text : text + " ".repeat(n - text.length);
};

function makeEmptyAgg() {
  return { total: 0, one: 0, two: 0, three: 0, four: 0, fivep: 0 };
}

function parseCellLine(line) {
  return line
    .split("│")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseReport(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] || "";
    if (!line.includes("객실별 인원 예약 분석 보고서")) {
      i++;
      continue;
    }
    const block = {
      buildingTitle: line.trim(),
      periodLine: (lines[i + 1] || "").trim(),
      headers: [],
      rows: [],
      bullets: [],
    };

    let j = i;
    while (j < lines.length && !lines[j].includes("│ 방")) j++;
    if (j < lines.length) {
      block.headers = parseCellLine(lines[j]);
      j++;
      while (j < lines.length) {
        const rowLine = lines[j] || "";
        if (!rowLine.trim().startsWith("│")) break;
        const cells = parseCellLine(rowLine);
        if (cells.length > 0) block.rows.push(cells);
        j++;
      }
    }

    while (j < lines.length && !(lines[j] || "").includes("▶ 전체 통계")) j++;
    if (j < lines.length) {
      j++;
      while (j < lines.length) {
        const bl = (lines[j] || "").trim();
        if (!bl.startsWith("•")) break;
        block.bullets.push(bl.replace(/^•\s*/, ""));
        j++;
      }
    }
    blocks.push(block);
    i = j;
  }
  return blocks;
}

async function buildTextFromFirestore() {
  const snap = await db.collection("reservations")
    .where("bookDate", ">=", START_DATE)
    .where("bookDate", "<=", END_DATE)
    .get();

  const data = {};
  for (const b of BUILDINGS) data[b] = { rooms: {}, tot: makeEmptyAgg() };

  for (const doc of snap.docs) {
    const r = doc.data();
    if (!BUILDINGS.includes(r.building)) continue;
    if (r.status !== "confirmed") continue;
    if (!(r.referer === "Airbnb" || r.referer === "Booking.com")) continue;

    const room = r.room || "-";
    const pax = (parseInt(r.numAdult, 10) || 0) + (parseInt(r.numChild, 10) || 0);
    const bucket = pax <= 1 ? "one" : pax === 2 ? "two" : pax === 3 ? "three" : pax === 4 ? "four" : "fivep";

    if (!data[r.building].rooms[room]) data[r.building].rooms[room] = makeEmptyAgg();
    data[r.building].rooms[room].total += 1;
    data[r.building].rooms[room][bucket] += 1;
  }

  for (const b of BUILDINGS) {
    for (const roomAgg of Object.values(data[b].rooms)) {
      data[b].tot.total += roomAgg.total;
      data[b].tot.one += roomAgg.one;
      data[b].tot.two += roomAgg.two;
      data[b].tot.three += roomAgg.three;
      data[b].tot.four += roomAgg.four;
      data[b].tot.fivep += roomAgg.fivep;
    }
  }

  let out = "";
  for (const b of BUILDINGS) {
    const rooms = Object.entries(data[b].rooms).sort((a, z) => a[0].localeCompare(z[0], "ko"));
    const t = data[b].tot;

    out += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    out += `${b} 객실별 인원 예약 분석 보고서\n`;
    out += `분석 기간: ${START_DATE} ~ ${END_DATE} (bookDate 기준, confirmed, OTA만)\n`;
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

  fs.writeFileSync(OUT_TXT, out, "utf8");
  return out;
}

async function uploadToSheet(text) {
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const target = (meta.data.sheets || []).find((s) => s.properties.title === TARGET_SHEET_TITLE);
  if (!target) throw new Error(`시트를 찾을 수 없음: ${TARGET_SHEET_TITLE}`);
  const sheetId = target.properties.sheetId;

  const blocks = parseReport(text);
  const width = 7;
  const padRow = (arr) => {
    const row = [...arr];
    while (row.length < width) row.push("");
    return row.slice(0, width);
  };

  const values = [];
  const styleTargets = [];
  for (const block of blocks) {
    const start = values.length;
    values.push(padRow([block.buildingTitle]));
    values.push(padRow([block.periodLine]));
    values.push(padRow([]));
    values.push(padRow(["인원별 예약 통계"]));
    values.push(padRow(block.headers));
    const dataStart = values.length;
    for (const r of block.rows) values.push(padRow(r));
    const dataEnd = values.length;
    values.push(padRow([]));
    const summaryTitleRow = values.length;
    values.push(padRow(["전체 통계"]));
    const bulletStart = values.length;
    for (const b of block.bullets) values.push(padRow([b]));
    const bulletEnd = values.length;
    values.push(padRow([]));
    values.push(padRow([]));

    styleTargets.push({
      titleRow: start,
      periodRow: start + 1,
      sectionRow: start + 3,
      headerRow: start + 4,
      dataStart,
      dataEnd,
      summaryTitleRow,
      bulletStart,
      bulletEnd,
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [
        { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 10 } } },
        { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 10 }, top: { style: "NONE" }, bottom: { style: "NONE" }, left: { style: "NONE" }, right: { style: "NONE" }, innerHorizontal: { style: "NONE" }, innerVertical: { style: "NONE" } } },
      ],
    },
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TARGET_SHEET_TITLE}!A1:K2000`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TARGET_SHEET_TITLE}!A1`,
    valueInputOption: "USER_ENTERED",
    resource: { values },
  });

  const NAVY = { red: 0.10, green: 0.22, blue: 0.43 };
  const LIGHT_BLUE = { red: 0.89, green: 0.94, blue: 0.99 };
  const VERY_LIGHT = { red: 0.97, green: 0.98, blue: 1.0 };
  const WHITE = { red: 1, green: 1, blue: 1 };
  const DARK = { red: 0.1, green: 0.1, blue: 0.1 };

  const reqs = [
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 160 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 7 }, properties: { pixelSize: 98 }, fields: "pixelSize" } },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: 7 },
        cell: { userEnteredFormat: { textFormat: { fontFamily: "Noto Sans KR", fontSize: 10, foregroundColor: DARK }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "OVERFLOW_CELL", backgroundColor: WHITE } },
        fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,backgroundColor)",
      },
    },
  ];

  for (const t of styleTargets) {
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: t.titleRow, endRowIndex: t.titleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } });
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: t.periodRow, endRowIndex: t.periodRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } });
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: t.sectionRow, endRowIndex: t.sectionRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } });
    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: t.summaryTitleRow, endRowIndex: t.summaryTitleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: t.titleRow, endRowIndex: t.titleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 14 }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: t.periodRow, endRowIndex: t.periodRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: VERY_LIGHT, textFormat: { foregroundColor: DARK, bold: true, fontSize: 10 }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: t.sectionRow, endRowIndex: t.sectionRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { bold: true, fontSize: 11 }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: t.headerRow, endRowIndex: t.headerRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: t.dataEnd - 1, endRowIndex: t.dataEnd, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: VERY_LIGHT, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } });
    reqs.push({ updateBorders: { range: { sheetId, startRowIndex: t.headerRow, endRowIndex: t.dataEnd, startColumnIndex: 0, endColumnIndex: 7 }, top: { style: "SOLID" }, bottom: { style: "SOLID" }, left: { style: "SOLID" }, right: { style: "SOLID" }, innerHorizontal: { style: "SOLID" }, innerVertical: { style: "SOLID" } } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: t.summaryTitleRow, endRowIndex: t.summaryTitleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { bold: true }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: t.bulletStart, endRowIndex: t.bulletEnd, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat.horizontalAlignment" } });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests: reqs },
  });
}

async function main() {
  const text = await buildTextFromFirestore();
  await uploadToSheet(text);
  console.log("updated_sheet_title=", TARGET_SHEET_TITLE);
  console.log("saved_text_file=", OUT_TXT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
