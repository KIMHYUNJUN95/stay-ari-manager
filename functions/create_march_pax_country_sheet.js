const admin = require("firebase-admin");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");
dayjs.extend(utc);
dayjs.extend(timezone);

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();
const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "dGxlQyu47LbplLVCVXiV";
// 데이터가 없어도 항상 표시할 전 건물 목록
const ALL_BUILDINGS = [
  "아라키초A",
  "아라키초B",
  "가부키초",
  "오쿠보A동",
  "오쿠보B동",
  "오쿠보C동",
  "다카다노바바",
];
let START = "";
let END = "";
let SHEET_TITLE = "";

const pct = (n, d) => (d > 0 ? ((n * 100) / d).toFixed(1) : "0.0");
const makeAgg = () => ({ total: 0, one: 0, two: 0, three: 0, four: 0, fivep: 0 });

function toBucket(pax) {
  if (pax <= 1) return "one";
  if (pax === 2) return "two";
  if (pax === 3) return "three";
  if (pax === 4) return "four";
  return "fivep";
}

function normalizeCountry(r) {
  const c1 = String(r.guestCountry || "").trim();
  const c2 = String(r.guestCountry2 || "").trim();
  const raw = (c1 || c2).toUpperCase();
  if (!raw) return "신원미상";

  const countryMap = {
    KR: "대한민국", KOREA: "대한민국", "SOUTH KOREA": "대한민국", KOR: "대한민국",
    JP: "일본", JAPAN: "일본", JPN: "일본",
    CN: "중국", CHINA: "중국", CHN: "중국",
    TW: "대만", TAIWAN: "대만",
    HK: "홍콩", "HONG KONG": "홍콩",
    MO: "마카오", MACAU: "마카오",
    US: "미국", USA: "미국", "UNITED STATES": "미국",
    CA: "캐나다", CANADA: "캐나다",
    AU: "호주", AUSTRALIA: "호주",
    GB: "영국", UK: "영국", "UNITED KINGDOM": "영국",
    FR: "프랑스", FRANCE: "프랑스",
    DE: "독일", GERMANY: "독일",
    IT: "이탈리아", ITALY: "이탈리아",
    ES: "스페인", SPAIN: "스페인",
    NL: "네덜란드", NETHERLANDS: "네덜란드",
    BE: "벨기에", BELGIUM: "벨기에",
    CH: "스위스", SWITZERLAND: "스위스",
    AT: "오스트리아", AUSTRIA: "오스트리아",
    SE: "스웨덴", SWEDEN: "스웨덴",
    NO: "노르웨이", NORWAY: "노르웨이",
    DK: "덴마크", DENMARK: "덴마크",
    FI: "핀란드", FINLAND: "핀란드",
    SG: "싱가포르", SINGAPORE: "싱가포르",
    MY: "말레이시아", MALAYSIA: "말레이시아",
    TH: "태국", THAILAND: "태국",
    VN: "베트남", VIETNAM: "베트남",
    PH: "필리핀", PHILIPPINES: "필리핀",
    ID: "인도네시아", INDONESIA: "인도네시아",
    IN: "인도", INDIA: "인도",
    AE: "아랍에미리트", UAE: "아랍에미리트",
    RU: "러시아", RUSSIA: "러시아",
    BR: "브라질", BRAZIL: "브라질",
    MX: "멕시코", MEXICO: "멕시코",
    NZ: "뉴질랜드", "NEW ZEALAND": "뉴질랜드",
  };

  if (countryMap[raw]) return countryMap[raw];

  // ISO 2자리 국가코드는 Intl로 한국어 국가명 변환
  if (/^[A-Z]{2}$/.test(raw)) {
    try {
      const dn = new Intl.DisplayNames(["ko"], { type: "region" });
      const name = dn.of(raw);
      if (name && name !== raw) return name;
    } catch (_) {
      // noop
    }
  }

  return raw;
}

function otaConfirmedFilter(rows) {
  return rows
    .filter((r) => (r.companyId || DEFAULT_COMPANY_ID) === DEFAULT_COMPANY_ID)
    .filter((r) => r.status === "confirmed")
    .filter((r) => r.referer === "Airbnb" || r.referer === "Booking.com");
}

async function fetchRows(start, end) {
  const snap = await db
    .collection("reservations")
    .where("bookDate", ">=", start)
    .where("bookDate", "<=", end)
    .get();

  return otaConfirmedFilter(snap.docs.map((d) => d.data()));
}

function buildAgg(rows, buildings) {
  const buildingData = {};
  for (const b of buildings) {
    buildingData[b] = { rooms: {}, total: makeAgg(), countries: {} };
  }

  for (const r of rows) {
    const b = r.building;
    const room = r.room || "-";
    const pax = (parseInt(r.numAdult, 10) || 0) + (parseInt(r.numChild, 10) || 0);
    const bucket = toBucket(pax);
    const country = normalizeCountry(r);

    if (!buildingData[b]) continue;
    if (!buildingData[b].rooms[room]) {
      buildingData[b].rooms[room] = makeAgg();
    }
    buildingData[b].rooms[room].total += 1;
    buildingData[b].rooms[room][bucket] += 1;

    buildingData[b].total.total += 1;
    buildingData[b].total[bucket] += 1;

    buildingData[b].countries[country] = (buildingData[b].countries[country] || 0) + 1;
  }

  return buildingData;
}

async function createOrReplaceSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = (meta.data.sheets || []).find((s) => s.properties.title === SHEET_TITLE);

  if (existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }] },
    });
  }

  const add = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests: [{ addSheet: { properties: { title: SHEET_TITLE } } }] },
  });
  return add.data.replies[0].addSheet.properties.sheetId;
}

async function uploadSheet(buildingData) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const sheetId = await createOrReplaceSheet(sheets);
  const values = [];
  const sections = [];
  const nowJst = dayjs().format("YYYY-MM-DD HH:mm");
  const reportTitle = `PAX OCCUPANCY REPORT (${START.slice(0, 7)})`;
  const reportMeta = `Period: ${START} ~ ${END} | Criteria: bookDate + confirmed + OTA(Airbnb/Booking.com) | Refresh Cycle: Daily 08:50 JST | Updated: ${nowJst} JST`;

  values.push([reportTitle, "", "", "", "", "", "", "", "", "", "", ""]);
  values.push([reportMeta, "", "", "", "", "", "", "", "", "", "", ""]);
  values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);

  const buildingNames = Object.keys(buildingData)
    .filter((k) => buildingData[k] && typeof buildingData[k] === "object" && buildingData[k].rooms)
    .sort((a, z) => a.localeCompare(z, "ko"));
  const past3 = Array.isArray(buildingData.__past3) ? buildingData.__past3 : [];
  for (const b of buildingNames) {
    const startRow = values.length;
    const rooms = Object.entries(buildingData[b].rooms).sort((a, z) => a[0].localeCompare(z[0], "ko"));
    const total = buildingData[b].total;
    const countries = Object.entries(buildingData[b].countries).sort((a, z) => z[1] - a[1] || a[0].localeCompare(z[0], "ko"));

    // 0: title, 1: period, 2: blank, 3: section title, 4: header, ...
    values.push([`${b} 객실별 인원 예약 분석 보고서`, "", "", "", "", "", "", "", "COUNTRY TOP10", "", "", ""]);
    values.push([`분석 기간: ${START} ~ ${END} (bookDate 기준, confirmed, OTA만)`, "", "", "", "", "", "", "", "", "", "", ""]);
    values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    values.push(["인원별 예약 통계", "", "", "", "", "", "", "", "국가명", "예약건수", "점유율", "순위/메모"]);
    values.push(["방", "총 예약", "1인", "2인", "3인", "4인", "5인+", "", "", "", "", ""]);

    const dataStart = values.length;
    const maxRows = Math.max(rooms.length + 1, countries.length + 1);
    for (let i = 0; i < maxRows; i++) {
      const left = rooms[i];
      const right = countries[i];
      const l = left
        ? [left[0], `${left[1].total}건`, `${left[1].one}건`, `${left[1].two}건`, `${left[1].three}건`, `${left[1].four}건`, `${left[1].fivep}건`]
        : ["", "", "", "", "", "", ""];
      const r = right
        ? [
          right[0],
          `${right[1]}건`,
          `${pct(right[1], total.total)}%`,
          right[0] === "신원미상" ? "국적 정보 없음" : `TOP ${i + 1}`,
        ]
        : ["", "", "", ""];
      values.push([...l, "", ...r]);
    }

    const sumLeft = ["합계", `${total.total}건`, `${total.one}건`, `${total.two}건`, `${total.three}건`, `${total.four}건`, `${total.fivep}건`];
    const unknown = buildingData[b].countries["신원미상"] || 0;
    const sumRight = ["합계", `${total.total}건`, "100.0%", `신원미상 ${unknown}건`];
    values.push([...sumLeft, "", ...sumRight]);

    values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    values.push(["전체 통계", "", "", "", "", "", "", "", "", "", "", ""]);
    values.push([`• 총 예약: ${total.total}건`, "", "", "", "", "", "", "", "", "", "", ""]);
    values.push([`• 1인 예약: ${total.one}건 (${pct(total.one, total.total)}%)`, "", "", "", "", "", "", "", "", "", "", ""]);
    values.push([`• 2인 예약: ${total.two}건 (${pct(total.two, total.total)}%)`, "", "", "", "", "", "", "", "", "", "", ""]);
    values.push([`• 3인 예약: ${total.three}건 (${pct(total.three, total.total)}%)`, "", "", "", "", "", "", "", "", "", "", ""]);
    values.push([`• 4인 예약: ${total.four}건 (${pct(total.four, total.total)}%)`, "", "", "", "", "", "", "", "", "", "", ""]);
    values.push([`• 5인+ 예약: ${total.fivep}건 (${pct(total.fivep, total.total)}%)`, "", "", "", "", "", "", "", "", "", "", ""]);
    values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);

    sections.push({
      startRow,
      titleRow: startRow,
      periodRow: startRow + 1,
      leftSectionRow: startRow + 3,
      leftHeaderRow: startRow + 4,
      rightTitleRow: startRow + 3,
      dataStart,
      dataEnd: dataStart + maxRows + 1, // + 합계
      summaryTitleRow: dataStart + maxRows + 3,
      summaryStart: dataStart + maxRows + 4,
      summaryEnd: dataStart + maxRows + 9,
    });
  }

  // 맨 아래 전체 통계 (전 건물 합산)
  const grand = makeAgg();
  const allCountries = {};
  for (const b of buildingNames) {
    const t = buildingData[b].total;
    grand.total += t.total;
    grand.one += t.one;
    grand.two += t.two;
    grand.three += t.three;
    grand.four += t.four;
    grand.fivep += t.fivep;
    for (const [c, n] of Object.entries(buildingData[b].countries)) {
      allCountries[c] = (allCountries[c] || 0) + n;
    }
  }
  const countryTop = Object.entries(allCountries).sort((a, z) => z[1] - a[1]).slice(0, 10);
  const overallStart = values.length;
  values.push(["전 건물 전체 통계 (3월)", "", "", "", "", "", "", "", "", "", "", ""]);
  values.push([`분석 기간: ${START} ~ ${END} (bookDate 기준, confirmed, OTA만)`, "", "", "", "", "", "", "", "", "", "", ""]);
  values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
  values.push(["총 예약", `${grand.total}건`, "1인", `${grand.one}건`, "2인", `${grand.two}건`, "3인", "", "", "", "", ""]);
  values.push(["4인", `${grand.four}건`, "5인+", `${grand.fivep}건`, "", "", "", "", "", "", "", ""]);
  values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
  values.push(["국가명", "예약건수", "점유율", "", "", "", "", "", "", "", "", ""]);
  for (const [country, cnt] of countryTop) {
    values.push([country, `${cnt}건`, `${pct(cnt, grand.total)}%`, "", "", "", "", "", "", "", "", ""]);
  }
  values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
  // 과거 3개월 전체 요약(인원수별) - 별도 공간
  const pastSummaryStart = values.length;
  values.push(["과거 3개월 전체 요약 (인원수별)", "", "", "", "", "", "", "", "", "", "", ""]);
  values.push(["기준: bookDate + confirmed + OTA", "", "", "", "", "", "", "", "", "", "", ""]);
  values.push(["월", "총예약", "1인", "2인", "3인", "4인", "5인+", "", "", "", "", ""]);
  for (const row of past3) {
    values.push([row.month, `${row.total}건`, `${row.one}건`, `${row.two}건`, `${row.three}건`, `${row.four}건`, `${row.fivep}건`, "", "", "", "", ""]);
  }
  const pSum = makeAgg();
  for (const row of past3) {
    pSum.total += row.total;
    pSum.one += row.one;
    pSum.two += row.two;
    pSum.three += row.three;
    pSum.four += row.four;
    pSum.fivep += row.fivep;
  }
  values.push(["합계", `${pSum.total}건`, `${pSum.one}건`, `${pSum.two}건`, `${pSum.three}건`, `${pSum.four}건`, `${pSum.fivep}건`, "", "", "", "", ""]);
  values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);

  const overallSection = {
    titleRow: overallStart,
    periodRow: overallStart + 1,
    kvHeaderRow: overallStart + 3,
    countryHeaderRow: overallStart + 6,
    countryStart: overallStart + 7,
    countryEnd: overallStart + 7 + countryTop.length,
    pastSummaryStart,
    pastSummaryEnd: pastSummaryStart + 4 + past3.length,
  };

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_TITLE}!A1`,
    valueInputOption: "USER_ENTERED",
    resource: { values },
  });

  const NAVY = { red: 0.09, green: 0.2, blue: 0.4 };
  const SKY = { red: 0.9, green: 0.95, blue: 1.0 };
  const SOFT = { red: 0.97, green: 0.98, blue: 1.0 };
  const WHITE = { red: 1, green: 1, blue: 1 };

  const reqs = [
    // 컬럼 폭: H열 좁게
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 130 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 7 }, properties: { pixelSize: 88 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 36 }, fields: "pixelSize" } }, // H
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: 150 }, fields: "pixelSize" } }, // I 국가
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: 100 }, fields: "pixelSize" } }, // J
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 10, endIndex: 11 }, properties: { pixelSize: 96 }, fields: "pixelSize" } }, // K
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 11, endIndex: 12 }, properties: { pixelSize: 140 }, fields: "pixelSize" } }, // L
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: 12 },
        cell: { userEnteredFormat: { backgroundColor: WHITE, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { fontFamily: "Noto Sans KR", fontSize: 10 } } },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
      },
    },
  ];

  for (const s of sections) {
    reqs.push(
      { mergeCells: { range: { sheetId, startRowIndex: s.titleRow, endRowIndex: s.titleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
      { mergeCells: { range: { sheetId, startRowIndex: s.periodRow, endRowIndex: s.periodRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
      { mergeCells: { range: { sheetId, startRowIndex: s.summaryTitleRow, endRowIndex: s.summaryTitleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
      { mergeCells: { range: { sheetId, startRowIndex: s.rightTitleRow, endRowIndex: s.rightTitleRow + 1, startColumnIndex: 8, endColumnIndex: 12 }, mergeType: "MERGE_ALL" } },
      { repeatCell: { range: { sheetId, startRowIndex: s.titleRow, endRowIndex: s.titleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 13, foregroundColor: WHITE }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: s.periodRow, endRowIndex: s.periodRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: SOFT, textFormat: { bold: true }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: s.leftSectionRow, endRowIndex: s.leftSectionRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: SKY, textFormat: { bold: true }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: s.leftHeaderRow, endRowIndex: s.leftHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: SKY, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { repeatCell: { range: { sheetId, startRowIndex: s.rightTitleRow, endRowIndex: s.rightTitleRow + 1, startColumnIndex: 8, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 }, horizontalAlignment: "CENTER", wrapStrategy: "CLIP" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)" } },
      { updateBorders: { range: { sheetId, startRowIndex: s.leftHeaderRow, endRowIndex: s.dataEnd, startColumnIndex: 0, endColumnIndex: 7 }, top: { style: "SOLID" }, bottom: { style: "SOLID" }, left: { style: "SOLID" }, right: { style: "SOLID" }, innerHorizontal: { style: "SOLID" }, innerVertical: { style: "SOLID" } } },
      { updateBorders: { range: { sheetId, startRowIndex: s.rightTitleRow, endRowIndex: s.dataEnd, startColumnIndex: 8, endColumnIndex: 12 }, top: { style: "SOLID" }, bottom: { style: "SOLID" }, left: { style: "SOLID" }, right: { style: "SOLID" }, innerHorizontal: { style: "SOLID" }, innerVertical: { style: "SOLID" } } },
      { repeatCell: { range: { sheetId, startRowIndex: s.dataEnd - 1, endRowIndex: s.dataEnd, startColumnIndex: 0, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: SOFT, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
      { repeatCell: { range: { sheetId, startRowIndex: s.summaryTitleRow, endRowIndex: s.summaryTitleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: SKY, textFormat: { bold: true }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: s.summaryStart, endRowIndex: s.summaryEnd, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat.horizontalAlignment" } },
      // 국가 테이블 가독성 강화: 홀짝 줄 배경
      { repeatCell: { range: { sheetId, startRowIndex: s.dataStart, endRowIndex: s.dataEnd, startColumnIndex: 8, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: WHITE } }, fields: "userEnteredFormat.backgroundColor" } },
    );
  }

  // 전체 통계 하단 섹션 스타일
  reqs.push(
    { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 }, mergeType: "MERGE_ALL" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 15, foregroundColor: WHITE }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: SOFT, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
    { mergeCells: { range: { sheetId, startRowIndex: overallSection.titleRow, endRowIndex: overallSection.titleRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId, startRowIndex: overallSection.periodRow, endRowIndex: overallSection.periodRow + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
    { repeatCell: { range: { sheetId, startRowIndex: overallSection.titleRow, endRowIndex: overallSection.titleRow + 1, startColumnIndex: 0, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 13, foregroundColor: WHITE }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
    { repeatCell: { range: { sheetId, startRowIndex: overallSection.periodRow, endRowIndex: overallSection.periodRow + 1, startColumnIndex: 0, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: SOFT, textFormat: { bold: true }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
    { repeatCell: { range: { sheetId, startRowIndex: overallSection.kvHeaderRow, endRowIndex: overallSection.kvHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 12 }, cell: { userEnteredFormat: { backgroundColor: SKY, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    { repeatCell: { range: { sheetId, startRowIndex: overallSection.countryHeaderRow, endRowIndex: overallSection.countryHeaderRow + 1, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: SKY, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    { updateBorders: { range: { sheetId, startRowIndex: overallSection.countryHeaderRow, endRowIndex: overallSection.countryEnd, startColumnIndex: 0, endColumnIndex: 3 }, top: { style: "SOLID" }, bottom: { style: "SOLID" }, left: { style: "SOLID" }, right: { style: "SOLID" }, innerHorizontal: { style: "SOLID" }, innerVertical: { style: "SOLID" } } },
    { mergeCells: { range: { sheetId, startRowIndex: overallSection.pastSummaryStart, endRowIndex: overallSection.pastSummaryStart + 1, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
    { mergeCells: { range: { sheetId, startRowIndex: overallSection.pastSummaryStart + 1, endRowIndex: overallSection.pastSummaryStart + 2, startColumnIndex: 0, endColumnIndex: 7 }, mergeType: "MERGE_ALL" } },
    { repeatCell: { range: { sheetId, startRowIndex: overallSection.pastSummaryStart, endRowIndex: overallSection.pastSummaryStart + 1, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
    { repeatCell: { range: { sheetId, startRowIndex: overallSection.pastSummaryStart + 1, endRowIndex: overallSection.pastSummaryStart + 2, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: SOFT, textFormat: { bold: true }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)" } },
    { repeatCell: { range: { sheetId, startRowIndex: overallSection.pastSummaryStart + 2, endRowIndex: overallSection.pastSummaryStart + 3, startColumnIndex: 0, endColumnIndex: 7 }, cell: { userEnteredFormat: { backgroundColor: SKY, textFormat: { bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
    { updateBorders: { range: { sheetId, startRowIndex: overallSection.pastSummaryStart + 2, endRowIndex: overallSection.pastSummaryEnd, startColumnIndex: 0, endColumnIndex: 7 }, top: { style: "SOLID" }, bottom: { style: "SOLID" }, left: { style: "SOLID" }, right: { style: "SOLID" }, innerHorizontal: { style: "SOLID" }, innerVertical: { style: "SOLID" } } }
  );

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests: reqs },
  });
}

async function main() {
  const nowJst = dayjs().tz("Asia/Tokyo");
  START = nowJst.startOf("month").format("YYYY-MM-DD");
  END = nowJst.endOf("month").format("YYYY-MM-DD");
  SHEET_TITLE = `PAX_OCCUPANCY_${START.slice(0, 7).replace("-", "")}`;

  const rows = await fetchRows(START, END);
  // 데이터가 0건인 건물도 포함
  const buildings = [...ALL_BUILDINGS];
  const agg = buildAgg(rows, buildings);

  // 과거 3개월 전체요약 (현재월 제외 직전 3개월)
  const cur = dayjs(START);
  const past3 = [];
  for (let i = 3; i >= 1; i--) {
    const m = cur.subtract(i, "month");
    const s = m.startOf("month").format("YYYY-MM-DD");
    const e = m.endOf("month").format("YYYY-MM-DD");
    const mRows = await fetchRows(s, e);
    const stats = makeAgg();
    for (const r of mRows) {
      stats.total += 1;
      const pax = (parseInt(r.numAdult, 10) || 0) + (parseInt(r.numChild, 10) || 0);
      stats[toBucket(pax)] += 1;
    }
    past3.push({
      month: m.format("YYYY-MM"),
      total: stats.total,
      one: stats.one,
      two: stats.two,
      three: stats.three,
      four: stats.four,
      fivep: stats.fivep,
    });
  }

  // uploadSheet 내부 우측 요약 영역 채우기 위해 임시 전달
  agg.__past3 = past3;
  await uploadSheet(agg);
  console.log(`updated_sheet_title=${SHEET_TITLE}`);
  console.log(`row_count_source=${rows.length}`);
}

async function runPaxOccupancyReport(options = {}) {
  const yearMonth = options.yearMonth || dayjs().tz("Asia/Tokyo").format("YYYY-MM");
  const base = dayjs.tz(`${yearMonth}-01`, "Asia/Tokyo");
  START = base.startOf("month").format("YYYY-MM-DD");
  END = base.endOf("month").format("YYYY-MM-DD");
  SHEET_TITLE = `PAX_OCCUPANCY_${yearMonth.replace("-", "")}`;

  const rows = await fetchRows(START, END);
  const buildings = [...ALL_BUILDINGS];
  const agg = buildAgg(rows, buildings);

  const cur = dayjs(START);
  const past3 = [];
  for (let i = 3; i >= 1; i--) {
    const m = cur.subtract(i, "month");
    const s = m.startOf("month").format("YYYY-MM-DD");
    const e = m.endOf("month").format("YYYY-MM-DD");
    const mRows = await fetchRows(s, e);
    const stats = makeAgg();
    for (const r of mRows) {
      stats.total += 1;
      const pax = (parseInt(r.numAdult, 10) || 0) + (parseInt(r.numChild, 10) || 0);
      stats[toBucket(pax)] += 1;
    }
    past3.push({
      month: m.format("YYYY-MM"),
      total: stats.total,
      one: stats.one,
      two: stats.two,
      three: stats.three,
      four: stats.four,
      fivep: stats.fivep,
    });
  }
  agg.__past3 = past3;
  await uploadSheet(agg);

  return { sheetTitle: SHEET_TITLE, rowCount: rows.length, start: START, end: END };
}

module.exports = { runPaxOccupancyReport };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
