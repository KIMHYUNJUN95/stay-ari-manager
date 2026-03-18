/**
 * 2월 객실별 플랫폼 편중 분석 시트 생성
 * - Occupancy(박/가동률) + Revenue(박당 배분) 결합
 * - 사용법: node generate_room_platform_analysis_feb.js
 */
const admin = require("firebase-admin");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");

dayjs.extend(utc);
dayjs.extend(timezone);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}
const db = admin.firestore();

const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "dGxlQyu47LbplLVCVXiV";
const DAIKYO_SOLD_DATE = "2026-01-26";
const EXCLUDED_BUILDINGS = new Set(["다이쿄초"]);

const BUILDING_ROOMS = {
  "아라키초A": ["201호", "202호", "301호", "302호", "401호", "402호", "501호", "502호", "602호", "701호", "702호"],
  "아라키초B": ["101호", "102호", "201호", "202호", "301호", "302호", "401호", "402호"],
  "다이쿄초": ["B01호", "B02호", "101호", "102호", "201호", "202호", "302호"],
  "가부키초": ["202호", "203호", "302호", "303호", "402호", "403호", "502호", "603호", "802호", "803호"],
  "다카다노바바": ["201호", "301호", "401호", "501호", "601호", "701호", "801호", "901호"],
  "오쿠보A동": ["오쿠보A"],
  "오쿠보B동": ["오쿠보B"],
  "오쿠보C동": ["오쿠보C"],
  "사노시": ["사노"]
};

const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const formatDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const normalizePlatform = (doc) => {
  const source = String(doc.referer || doc.referrer || doc.apiSource || doc.platform || "").toLowerCase();
  if (source.includes("airbnb")) return "Airbnb";
  if (source.includes("booking")) return "Booking.com";
  return "기타";
};

const percent = (part, total) => (total > 0 ? (part / total) * 100 : 0);
const PLATFORM_STYLE_LOCK = Object.freeze({
  rowHeights: Object.freeze({ title: 40, subtitle: 28, header: 36, body: 24, section: 26, spacer: 10 }),
  colWidths: Object.freeze([136, 104, 96, 116, 116, 116, 142, 142, 140, 140, 140, 148, 148, 118, 118, 118, 240]),
});

async function run() {
  if (!Array.isArray(PLATFORM_STYLE_LOCK.colWidths) || PLATFORM_STYLE_LOCK.colWidths.length !== 17) {
    throw new Error("PLATFORM_STYLE_LOCK 누락: colWidths");
  }
  const targetYear = 2026;
  const targetMonth = 2;
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const monthStart = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
  const monthEnd = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const sheetTitle = `Platform_Analysis_${targetYear}_${String(targetMonth).padStart(2, "0")}`;

  console.log(`📊 분석 시작: ${sheetTitle} (${monthStart} ~ ${monthEnd})`);

  const q = db.collection("reservations")
    .where("companyId", "==", COMPANY_ID)
    .where("status", "==", "confirmed")
    .where("arrival", "<=", monthEnd);
  const snap = await q.get();
  const docs = snap.docs.map((d) => d.data());

  const stats = {};
  const buildingEntries = Object.entries(BUILDING_ROOMS).filter(([building, rooms]) => !EXCLUDED_BUILDINGS.has(building) && Array.isArray(rooms) && rooms.length > 0);
  buildingEntries.forEach(([building, rooms], bIdx) => {
    if (EXCLUDED_BUILDINGS.has(building)) return;
    stats[building] = {};
    rooms.forEach((room) => {
      stats[building][room] = {
        occAll: new Set(),
        occAirbnb: new Set(),
        occBooking: new Set(),
        revenueAll: 0,
        revenueAirbnb: 0,
        revenueBooking: 0,
        bookingAll: 0,
        bookingAirbnb: 0,
        bookingBooking: 0,
      };
    });
  });

  const periodStart = parseLocalDate(monthStart);
  const periodEnd = parseLocalDate(monthEnd);

  docs.forEach((doc) => {
    const building = doc.building;
    const room = doc.room;
    if (!stats[building] || !stats[building][room]) return;
    if (EXCLUDED_BUILDINGS.has(building)) return;

    const bookDate = doc.bookDate || doc.arrival;
    if (building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE) return;

    const arrival = parseLocalDate(doc.arrival);
    const departure = parseLocalDate(doc.departure);
    if (!arrival || !departure) return;

    // 기간 겹침
    if (!(departure > periodStart && arrival <= periodEnd)) return;

    const totalNights = Math.floor((departure - arrival) / (1000 * 60 * 60 * 24));
    if (totalNights <= 0) return;

    const overlapStart = new Date(Math.max(arrival, periodStart));
    const depMinusOne = new Date(departure);
    depMinusOne.setDate(depMinusOne.getDate() - 1);
    const overlapEnd = new Date(Math.min(depMinusOne, periodEnd));
    if (overlapStart > overlapEnd) return;

    const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
    const totalPrice = Number(doc.totalPrice || doc.price) || 0;
    const pricePerNight = totalPrice / totalNights;
    const overlapRevenue = pricePerNight * overlapNights;
    const platform = normalizePlatform(doc);
    if (platform !== "Airbnb" && platform !== "Booking.com") return;

    const slot = stats[building][room];
    slot.bookingAll += 1;
    if (platform === "Airbnb") slot.bookingAirbnb += 1;
    if (platform === "Booking.com") slot.bookingBooking += 1;

    slot.revenueAll += overlapRevenue;
    if (platform === "Airbnb") slot.revenueAirbnb += overlapRevenue;
    if (platform === "Booking.com") slot.revenueBooking += overlapRevenue;

    const cursor = new Date(overlapStart);
    while (cursor <= overlapEnd) {
      const key = formatDate(cursor);
      slot.occAll.add(key);
      if (platform === "Airbnb") slot.occAirbnb.add(key);
      if (platform === "Booking.com") slot.occBooking.add(key);
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  const updatedAtLabel = `최신업데이트: ${dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD HH:mm")}`;
  const values = [
    [`${targetYear}년 ${targetMonth}월 플랫폼별 매출 및 점유율 분석`, "", "", "", "", "", "", "", "", "", "", "", "", "", updatedAtLabel, "", ""],
    ["객실단위 플랫폼 편중 리스크 모니터링 리포트 (A=Airbnb, B=Booking.com, 목표 5:5)", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["건물", "객실", "가동률", "점유박(AB합)", "점유박(Airbnb)", "점유박(Booking)", "점유비중 A%(Airbnb)", "점유비중 B%(Booking)", "매출(AB합)", "매출(Airbnb)", "매출(Booking)", "매출비중 A%(Airbnb)", "매출비중 B%(Booking)", "예약건수(AB합)", "예약건수(A)", "예약건수(B)", "점검플래그"]
  ];

  const sectionRowIdx = [];
  const spacerRowIdx = [];
  buildingEntries.forEach(([building, rooms], bIdx) => {
    if (EXCLUDED_BUILDINGS.has(building)) return;
    const buildingRooms = rooms.filter((room) => stats[building] && stats[building][room]);
    const occBuildingTotal = buildingRooms.reduce((sum, room) => sum + stats[building][room].occAirbnb.size + stats[building][room].occBooking.size, 0);
    const revBuildingTotal = buildingRooms.reduce((sum, room) => sum + stats[building][room].revenueAirbnb + stats[building][room].revenueBooking, 0);
    const revBuildingAirbnb = buildingRooms.reduce((sum, room) => sum + stats[building][room].revenueAirbnb, 0);
    const revBuildingBooking = buildingRooms.reduce((sum, room) => sum + stats[building][room].revenueBooking, 0);
    const aOccBuilding = buildingRooms.reduce((sum, room) => sum + stats[building][room].occAirbnb.size, 0);
    const bOccBuilding = buildingRooms.reduce((sum, room) => sum + stats[building][room].occBooking.size, 0);
    const aOccPctBuilding = percent(aOccBuilding, occBuildingTotal);
    const bOccPctBuilding = percent(bOccBuilding, occBuildingTotal);

    sectionRowIdx.push(values.length);
    values.push([
      `■ ${building}`,
      `${buildingRooms.length}개 객실`,
      "",
      occBuildingTotal,
      aOccBuilding,
      bOccBuilding,
      `${aOccPctBuilding.toFixed(1)}%`,
      `${bOccPctBuilding.toFixed(1)}%`,
      Math.round(revBuildingTotal),
      Math.round(revBuildingAirbnb),
      Math.round(revBuildingBooking),
      `${percent(revBuildingAirbnb, revBuildingTotal).toFixed(1)}%`,
      `${percent(revBuildingBooking, revBuildingTotal).toFixed(1)}%`,
      "",
      "",
      "",
      "건물 섹션"
    ]);

    rooms.forEach((room) => {
      const s = stats[building][room];
      const occTotal = s.occAirbnb.size + s.occBooking.size;
      const occA = s.occAirbnb.size;
      const occB = s.occBooking.size;
      const occRate = percent(occTotal, daysInMonth);
      const aOccPct = percent(occA, occTotal);
      const bOccPct = percent(occB, occTotal);
      const revAB = s.revenueAirbnb + s.revenueBooking;
      const aRevPct = percent(s.revenueAirbnb, revAB);
      const bRevPct = percent(s.revenueBooking, revAB);
      const bookingAB = s.bookingAirbnb + s.bookingBooking;

      let flag = "정상";
      if (occTotal === 0) flag = "무예약";
      else if (occA === 0 && occB > 0) flag = "Airbnb 점검 필요 (0:100)";
      else if (occB === 0 && occA > 0) flag = "Booking.com 점검 필요 (100:0)";
      else if (Math.abs(aOccPct - 50) <= 10 && occTotal >= 5) flag = "허용범위(6:4~4:6)";
      else if (aOccPct < 40 && occTotal >= 5) flag = "Airbnb 비중 낮음(기준밖)";
      else if (aOccPct > 60 && occTotal >= 5) flag = "Booking.com 비중 낮음(기준밖)";

      values.push([
        building,
        room,
        occRate / 100,
        occTotal,
        occA,
        occB,
        aOccPct / 100,
        bOccPct / 100,
        Math.round(revAB),
        Math.round(s.revenueAirbnb),
        Math.round(s.revenueBooking),
        aRevPct / 100,
        bRevPct / 100,
        bookingAB,
        s.bookingAirbnb,
        s.bookingBooking,
        flag
      ]);
    });
    if (bIdx < buildingEntries.length - 1) {
      spacerRowIdx.push(values.length);
      values.push(Array(17).fill(""));
    }
  });

  const dataStartRow = 4;

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  let sh = meta.data.sheets.find((s) => s.properties.title === sheetTitle);
  let sheetId = sh ? sh.properties.sheetId : null;
  if (!sh) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] }
    });
    sheetId = res.data.replies[0].addSheet.properties.sheetId;
  } else {
    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${sheetTitle}!A1:Z3000` });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetTitle}!A1`,
    valueInputOption: "USER_ENTERED",
    resource: { values }
  });

  const lastRow = values.length;
  const conditionalRules = (meta.data.sheets || [])
    .find((s) => s.properties.title === sheetTitle)?.conditionalFormats || [];
  const deleteRulesReq = [];
  for (let i = conditionalRules.length - 1; i >= 0; i--) {
    deleteRulesReq.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [
        ...deleteRulesReq,
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 3, rowCount: Math.max(lastRow + 2, 40), columnCount: 17 } }, fields: "gridProperties.frozenRowCount,gridProperties.rowCount,gridProperties.columnCount" } },
        { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 17 } } },
        { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 14 }, mergeType: "MERGE_ALL" } },
        { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 14, endColumnIndex: 17 }, mergeType: "MERGE_ALL" } },
        { mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 17 }, mergeType: "MERGE_ALL" } },

        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: PLATFORM_STYLE_LOCK.rowHeights.title }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: PLATFORM_STYLE_LOCK.rowHeights.subtitle }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: PLATFORM_STYLE_LOCK.rowHeights.header }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 3, endIndex: lastRow }, properties: { pixelSize: PLATFORM_STYLE_LOCK.rowHeights.body }, fields: "pixelSize" } },

        ...PLATFORM_STYLE_LOCK.colWidths.map((w, idx) => ({
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: idx, endIndex: idx + 1 },
            properties: { pixelSize: w },
            fields: "pixelSize"
          }
        })),

        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { textFormat: { fontFamily: "Noto Sans KR" }, verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,verticalAlignment)" } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 14 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.04, green: 0.11, blue: 0.28 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 18 }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 14, endColumnIndex: 17 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.04, green: 0.11, blue: 0.28 }, textFormat: { foregroundColor: { red: 0.90, green: 0.94, blue: 1.0 }, bold: false, fontSize: 11 }, horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
        { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.10, green: 0.22, blue: 0.44 }, textFormat: { foregroundColor: { red: 0.90, green: 0.94, blue: 1.0 }, bold: true, fontSize: 11 }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
        { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.05, green: 0.20, blue: 0.40 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 }, horizontalAlignment: "CENTER", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)" } },

        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { fontSize: 10, foregroundColor: { red: 0.10, green: 0.12, blue: 0.16 } }, horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 17 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } }, fields: "userEnteredFormat.numberFormat" } },
        ...Array.from({ length: Math.max(0, lastRow - dataStartRow + 1) }, (_, i) => i).map(i => (i % 2 === 1 ? {
          repeatCell: {
            range: { sheetId, startRowIndex: dataStartRow - 1 + i, endRowIndex: dataStartRow + i, startColumnIndex: 0, endColumnIndex: 17 },
            cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.98, blue: 1.0 } } },
            fields: "userEnteredFormat.backgroundColor"
          }
        } : null)).filter(Boolean),

        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 2 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat.horizontalAlignment" } },
        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 2, endColumnIndex: 16 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat.horizontalAlignment" } },
        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, textFormat: { bold: true, foregroundColor: { red: 0.05, green: 0.20, blue: 0.55 } } } }, fields: "userEnteredFormat(numberFormat,textFormat)" } },
        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 6, endColumnIndex: 8 }, cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } }, fields: "userEnteredFormat.numberFormat" } },
        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 8, endColumnIndex: 11 }, cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "¥#,##0" }, textFormat: { bold: true, foregroundColor: { red: 0.00, green: 0.42, blue: 0.15 } } } }, fields: "userEnteredFormat(numberFormat,textFormat)" } },
        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 11, endColumnIndex: 13 }, cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } }, fields: "userEnteredFormat.numberFormat" } },
        { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", horizontalAlignment: "LEFT", textFormat: { bold: true } } }, fields: "userEnteredFormat(wrapStrategy,horizontalAlignment,textFormat)" } },

        ...sectionRowIdx.map((idx0) => ({
          repeatCell: {
            range: { sheetId, startRowIndex: idx0, endRowIndex: idx0 + 1, startColumnIndex: 0, endColumnIndex: 17 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.92, green: 0.95, blue: 1.0 },
                textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.08, green: 0.22, blue: 0.45 } },
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)"
          }
        })),
        ...sectionRowIdx.map((idx0) => ({
          repeatCell: {
            range: { sheetId, startRowIndex: idx0, endRowIndex: idx0 + 1, startColumnIndex: 0, endColumnIndex: 2 },
            cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } },
            fields: "userEnteredFormat.horizontalAlignment"
          }
        })),
        ...spacerRowIdx.map((idx0) => ({
          repeatCell: {
            range: { sheetId, startRowIndex: idx0, endRowIndex: idx0 + 1, startColumnIndex: 0, endColumnIndex: 17 },
            cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
            fields: "userEnteredFormat.backgroundColor"
          }
        })),
        ...sectionRowIdx.map((idx0) => ({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: idx0, endIndex: idx0 + 1 }, properties: { pixelSize: PLATFORM_STYLE_LOCK.rowHeights.section }, fields: "pixelSize" } })),
        ...spacerRowIdx.map((idx0) => ({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: idx0, endIndex: idx0 + 1 }, properties: { pixelSize: PLATFORM_STYLE_LOCK.rowHeights.spacer }, fields: "pixelSize" } })),

        { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 17 }, top: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } }, bottom: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } }, left: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } }, right: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } }, innerHorizontal: { style: "SOLID", color: { red: 0.82, green: 0.86, blue: 0.94 } }, innerVertical: { style: "SOLID", color: { red: 0.82, green: 0.86, blue: 0.94 } } } },

        { addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
            booleanRule: {
              condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Airbnb 점검 필요" }] },
              format: { backgroundColor: { red: 1.0, green: 0.91, blue: 0.91 }, textFormat: { bold: true, foregroundColor: { red: 0.74, green: 0.15, blue: 0.19 } } }
            }
          }
        }},
        { addConditionalFormatRule: {
          index: 1,
          rule: {
            ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
            booleanRule: {
              condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Booking.com 점검 필요" }] },
              format: { backgroundColor: { red: 0.90, green: 0.94, blue: 1.0 }, textFormat: { bold: true, foregroundColor: { red: 0.12, green: 0.26, blue: 0.56 } } }
            }
          }
        }},
        { addConditionalFormatRule: {
          index: 2,
          rule: {
            ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
            booleanRule: {
              condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Airbnb 비중 낮음(기준밖)" }] },
              format: { backgroundColor: { red: 1.0, green: 0.96, blue: 0.86 }, textFormat: { bold: true, foregroundColor: { red: 0.72, green: 0.36, blue: 0.02 } } }
            }
          }
        }},
        { addConditionalFormatRule: {
          index: 3,
          rule: {
            ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
            booleanRule: {
              condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Booking.com 비중 낮음(기준밖)" }] },
              format: { backgroundColor: { red: 0.93, green: 0.96, blue: 1.0 }, textFormat: { bold: true, foregroundColor: { red: 0.12, green: 0.34, blue: 0.62 } } }
            }
          }
        }}
      ]
    }
  });

  console.log(`✅ 완료: ${sheetTitle} (${lastRow - 2}개 행, 건물 섹션 ${sectionRowIdx.length}개)`);
}

run().catch((e) => {
  console.error("❌ 실패:", e.message);
  process.exit(1);
});
