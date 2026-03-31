const { google } = require("googleapis");
const serviceAccount = require("../serviceAccountKey.json");
const { runPaxOccupancyReport } = require("./paxOccupancyReport");
const { NOTION_PAGES, syncNotionDailyLog, syncNotionCancelLog, syncNotionSalesLog, syncNotionPlatformAnalysis, syncNotionPaxOccupancy } = require("./notionReportSync");
const { updateFutureTargetGoalsSheet } = require("./targetGoalsSheet");

// ── 브리핑 시트 디자인 요청 빌더 ────────────────────────────────────────────
function buildBriefingDesignRequests(sheetId, titleText, subtitleText, buttons) {
    const BTN_START_COL = 1, BTN_COLS = 6, GAP_COLS = 1, HEADER_END_COL = 29;
    const HEADER_ROW = 0, SUB_ROW = 1, SPACER1_ROW = 2, BTN_ROW = 3, SPACER2_ROW = 4;
    const C = {
        darkSlate: { red: 0.075, green: 0.110, blue: 0.200 },
        lightBg:   { red: 0.945, green: 0.961, blue: 0.980 },
        subText:   { red: 0.620, green: 0.710, blue: 0.800 },
        white:     { red: 1, green: 1, blue: 1 },
    };
    const reqs = [];

    reqs.push({ appendDimension: { sheetId, dimension: "COLUMNS", length: 4 } });
    reqs.push({ updateCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 20, startColumnIndex: 0, endColumnIndex: 30 }, fields: "userEnteredValue,userEnteredFormat" } });

    [{ row: HEADER_ROW, px: 54 }, { row: SUB_ROW, px: 26 }, { row: SPACER1_ROW, px: 16 }, { row: BTN_ROW, px: 54 }, { row: SPACER2_ROW, px: 16 }]
        .forEach(({ row, px }) => reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: row, endIndex: row + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } }));

    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 20 }, fields: "pixelSize" } });
    for (let i = 0; i < 4; i++) {
        const s = BTN_START_COL + i * (BTN_COLS + GAP_COLS);
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: s, endIndex: s + BTN_COLS }, properties: { pixelSize: 30 }, fields: "pixelSize" } });
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: s + BTN_COLS, endIndex: s + BTN_COLS + 1 }, properties: { pixelSize: 14 }, fields: "pixelSize" } });
    }
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 28, endIndex: 29 }, properties: { pixelSize: 20 }, fields: "pixelSize" } });

    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: HEADER_ROW, endRowIndex: HEADER_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL }, mergeType: "MERGE_ALL" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: HEADER_ROW, endRowIndex: HEADER_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL }, cell: { userEnteredValue: { stringValue: titleText }, userEnteredFormat: { backgroundColor: C.darkSlate, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", padding: { left: 24 }, textFormat: { foregroundColor: C.white, bold: true, fontSize: 16, fontFamily: "Arial" } } }, fields: "userEnteredValue,userEnteredFormat" } });

    reqs.push({ mergeCells: { range: { sheetId, startRowIndex: SUB_ROW, endRowIndex: SUB_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL }, mergeType: "MERGE_ALL" } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: SUB_ROW, endRowIndex: SUB_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL }, cell: { userEnteredValue: { stringValue: subtitleText }, userEnteredFormat: { backgroundColor: C.darkSlate, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", padding: { left: 26 }, textFormat: { foregroundColor: C.subText, bold: false, fontSize: 10, fontFamily: "Arial" } } }, fields: "userEnteredValue,userEnteredFormat" } });

    [SPACER1_ROW, SPACER2_ROW].forEach(row => reqs.push({ repeatCell: { range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL }, cell: { userEnteredFormat: { backgroundColor: C.lightBg } }, fields: "userEnteredFormat" } }));
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: BTN_ROW, endRowIndex: BTN_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL }, cell: { userEnteredFormat: { backgroundColor: C.lightBg } }, fields: "userEnteredFormat" } });

    buttons.forEach(({ label, color }, i) => {
        const s = BTN_START_COL + i * (BTN_COLS + GAP_COLS), e = s + BTN_COLS;
        reqs.push({ mergeCells: { range: { sheetId, startRowIndex: BTN_ROW, endRowIndex: BTN_ROW + 1, startColumnIndex: s, endColumnIndex: e }, mergeType: "MERGE_ALL" } });
        reqs.push({ repeatCell: { range: { sheetId, startRowIndex: BTN_ROW, endRowIndex: BTN_ROW + 1, startColumnIndex: s, endColumnIndex: e }, cell: { userEnteredValue: { stringValue: label }, userEnteredFormat: { backgroundColor: color, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { foregroundColor: C.white, bold: true, fontSize: 11, fontFamily: "Arial" } } }, fields: "userEnteredValue,userEnteredFormat" } });
    });
    return reqs;
}

function createGoogleSheetReportModule({
    onSchedule,
    admin,
    dayjs,
    DEFAULT_COMPANY_ID,
    filterDocsToCompany,
    getBookingAmount,
    assertReservationDataReady,
    sendSyncAlert,
    BUILDING_ROOMS
}) {
    async function generatePlatformAnalysisTab(sheets, SPREADSHEET_ID, year, month, allDocs, options = {}) {
        const { reportEndDate } = options; // 일일로그 기준: 전일까지 집계 (없으면 해당 월 말일)
        const SHEET_TITLE = `플랫폼분석_${year}_${String(month).padStart(2, "0")}`;
        const DAIKYO_SOLD_DATE = "2026-01-26";
        const EXCLUDED_BUILDINGS = new Set(["다이쿄초"]);
        const BUILDING_ORDER = ["아라키초A", "아라키초B", "가부키초", "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동", "사노시"];
        const parseLocalDate = (dateStr) => {
            if (!dateStr) return null;
            const [y, m, d] = dateStr.split("-").map(Number);
            return new Date(y, m - 1, d);
        };
        const normalizePlatform = (doc) => {
            const source = String(doc.referer || doc.referrer || doc.apiSource || doc.platform || "").toLowerCase();
            if (source.includes("airbnb")) return "Airbnb";
            if (source.includes("booking")) return "Booking.com";
            return "기타";
        };
        const isInflowRatioExcludedBuilding = (buildingName, roomCount) => {
            if (Number(roomCount) !== 1) return false;
            const normalized = String(buildingName || "").replace(/\s+/g, "").toLowerCase();
            return normalized.includes("오쿠보a")
                || normalized.includes("오쿠보b")
                || normalized.includes("오쿠보c")
                || normalized.includes("사노");
        };
        const percent = (part, total) => (total > 0 ? (part / total) * 100 : 0);
        const PLATFORM_STYLE_LOCK = Object.freeze({
            rowHeights: Object.freeze({ title: 40, subtitle: 28, header: 36, body: 24, section: 26, spacer: 10 }),
            colWidths: Object.freeze([136, 104, 96, 116, 116, 116, 142, 142, 140, 140, 140, 148, 148, 118, 118, 118, 240])
        });
        const assertPlatformStyleLock = () => {
            if (!Array.isArray(PLATFORM_STYLE_LOCK.colWidths) || PLATFORM_STYLE_LOCK.colWidths.length !== 17) {
                throw new Error("PLATFORM_STYLE_LOCK 누락: colWidths");
            }
            if (!PLATFORM_STYLE_LOCK.rowHeights?.header) {
                throw new Error("PLATFORM_STYLE_LOCK 누락: rowHeights");
            }
        };
        assertPlatformStyleLock();

        const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
        const monthEnd = dayjs(monthStart).endOf("month").format("YYYY-MM-DD");
        const effectiveEnd = reportEndDate || monthEnd;
        console.log(`📊 [Platform Analysis] ${year}-${month} 객실단위 리뉴얼 리포트 생성 시작 (집계기간: ${monthStart} ~ ${effectiveEnd}${reportEndDate ? " · 일일로그 기준" : ""})...`);

        const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        let targetSheet = meta.data.sheets.find((s) => s.properties.title === SHEET_TITLE);
        let sheetId = targetSheet ? targetSheet.properties.sheetId : null;
        if (!targetSheet) {
            const res = await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { requests: [{ addSheet: { properties: { title: SHEET_TITLE, tabColorStyle: { rgbColor: { red: 0.60, green: 0.20, blue: 0.80 } } } } }] }
            });
            sheetId = res.data.replies[0].addSheet.properties.sheetId;
        } else {
            await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_TITLE}!A1:Z3000` });
        }

        const daysInMonth = dayjs(monthStart).daysInMonth();
        const effectiveDays = reportEndDate
            ? Math.max(1, dayjs(reportEndDate).diff(dayjs(monthStart), "day") + 1)
            : daysInMonth;

        const roomNamesByBuilding = {};
        Object.entries(BUILDING_ROOMS).forEach(([building, infos]) => {
            if (EXCLUDED_BUILDINGS.has(building)) return;
            const names = [...new Set((infos || []).map((r) => r.name).filter(Boolean))];
            roomNamesByBuilding[building] = names;
        });

        const stats = {};
        Object.entries(roomNamesByBuilding).forEach(([building, rooms]) => {
            stats[building] = {};
            rooms.forEach((room) => {
                stats[building][room] = {
                    occAll: 0,
                    occAirbnb: 0,
                    occBooking: 0,
                    revenueAll: 0,
                    revenueAirbnb: 0,
                    revenueBooking: 0,
                    bookingAll: 0,
                    bookingAirbnb: 0,
                    bookingBooking: 0
                };
            });
        });

        allDocs.forEach((doc) => {
            const building = doc.building;
            const room = doc.room;
            if (!stats[building] || !stats[building][room]) return;
            if (EXCLUDED_BUILDINGS.has(building)) return;
            if (doc.status !== "confirmed") return;
            const bookDate = doc.bookDate || "";
            if (bookDate < monthStart || bookDate > effectiveEnd) return;
            if (building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE) return;

            const arrival = parseLocalDate(doc.arrival);
            const departure = parseLocalDate(doc.departure);
            const totalNights = (arrival && departure && departure > arrival)
                ? Math.floor((departure - arrival) / (1000 * 60 * 60 * 24))
                : 0;
            const amount = getBookingAmount(doc);
            const platform = normalizePlatform(doc);
            if (platform !== "Airbnb" && platform !== "Booking.com") return;

            const slot = stats[building][room];
            slot.bookingAll += 1;
            if (platform === "Airbnb") slot.bookingAirbnb += 1;
            if (platform === "Booking.com") slot.bookingBooking += 1;

            slot.revenueAll += amount;
            if (platform === "Airbnb") slot.revenueAirbnb += amount;
            if (platform === "Booking.com") slot.revenueBooking += amount;

            slot.occAll += totalNights;
            if (platform === "Airbnb") slot.occAirbnb += totalNights;
            if (platform === "Booking.com") slot.occBooking += totalNights;
        });

        const updatedAtLabel = `최신업데이트: ${dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD HH:mm")} | 갱신주기: 1시간`;
        const periodNote = reportEndDate ? ` | 집계: ${monthStart} ~ ${effectiveEnd} (예약일 기준)` : "";
        const values = [
            [`${year}년 ${month}월 플랫폼별 매출 및 예약 유입 분석`, "", "", "", "", "", "", "", "", "", "", "", "", "", updatedAtLabel, "", ""],
            ["객실단위 플랫폼 편중 리스크 모니터링 (유입 비중: 건물 내 100% 기준, A=Airbnb, B=Booking.com, 목표 5:5)" + periodNote, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
            ["건물", "객실", "유입 비중(%)", "유입박(AB합)", "유입박(Airbnb)", "유입박(Booking)", "유입비중 A%(Airbnb)", "유입비중 B%(Booking)", "매출(AB합)", "매출(Airbnb)", "매출(Booking)", "매출비중 A%(Airbnb)", "매출비중 B%(Booking)", "예약건수(AB합)", "예약건수(A)", "예약건수(B)", "점검플래그"]
        ];
        const sectionRowIdx = [];
        const spacerRowIdx = [];

        const extraBuildings = Object.keys(roomNamesByBuilding).filter((b) => !BUILDING_ORDER.includes(b));
        const orderedBuildings = [...BUILDING_ORDER, ...extraBuildings];
        const activeBuildings = orderedBuildings.filter((building) => {
            if (!stats[building]) return false;
            const rooms = roomNamesByBuilding[building] || [];
            return rooms.length > 0;
        });

        activeBuildings.forEach((building, buildingIdx) => {
            const rooms = roomNamesByBuilding[building] || [];
            const suppressInflowRatio = isInflowRatioExcludedBuilding(building, rooms.length);
            const occBuildingTotal = rooms.reduce((sum, room) => sum + stats[building][room].occAirbnb + stats[building][room].occBooking, 0);
            const revBuildingTotal = rooms.reduce((sum, room) => sum + stats[building][room].revenueAirbnb + stats[building][room].revenueBooking, 0);
            const revBuildingAirbnb = rooms.reduce((sum, room) => sum + stats[building][room].revenueAirbnb, 0);
            const revBuildingBooking = rooms.reduce((sum, room) => sum + stats[building][room].revenueBooking, 0);
            const aOccBuilding = rooms.reduce((sum, room) => sum + stats[building][room].occAirbnb, 0);
            const bOccBuilding = rooms.reduce((sum, room) => sum + stats[building][room].occBooking, 0);
            sectionRowIdx.push(values.length);
            values.push([
                `■ ${building}`,
                `${rooms.length}개 객실`,
                "—",
                occBuildingTotal,
                aOccBuilding,
                bOccBuilding,
                `${percent(aOccBuilding, occBuildingTotal).toFixed(1)}%`,
                `${percent(bOccBuilding, occBuildingTotal).toFixed(1)}%`,
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
                const occTotal = s.occAirbnb + s.occBooking;
                const occA = s.occAirbnb;
                const occB = s.occBooking;
                const sharePct = occBuildingTotal > 0 ? percent(occTotal, occBuildingTotal) : 0;
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
                    suppressInflowRatio ? "" : sharePct / 100,
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

            if (buildingIdx < activeBuildings.length - 1) {
                spacerRowIdx.push(values.length);
                values.push(Array(17).fill(""));
            }
        });

        const platformDataForNotion = (() => {
            let totalRev = 0, totalRevA = 0, totalRevB = 0, totalOccA = 0, totalOccB = 0, totalBookA = 0, totalBookB = 0;
            const buildings = activeBuildings.map((building) => {
                const rooms = roomNamesByBuilding[building] || [];
                const occBuildingTotal = rooms.reduce((sum, room) => sum + stats[building][room].occAirbnb + stats[building][room].occBooking, 0);
                const roomList = rooms.map((room) => {
                    const s = stats[building][room];
                    const occTotal = s.occAirbnb + s.occBooking;
                    const occA = s.occAirbnb;
                    const occB = s.occBooking;
                    const sharePct = occBuildingTotal > 0 ? percent(occTotal, occBuildingTotal) : 0;
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
                    totalRev += revAB;
                    totalRevA += s.revenueAirbnb;
                    totalRevB += s.revenueBooking;
                    totalOccA += occA;
                    totalOccB += occB;
                    totalBookA += s.bookingAirbnb;
                    totalBookB += s.bookingBooking;
                    return { room, sharePct, occTotal, occA, occB, aOccPct, bOccPct, revAB, revA: s.revenueAirbnb, revB: s.revenueBooking, aRevPct, bRevPct, bookingAB, bookingA: s.bookingAirbnb, bookingB: s.bookingBooking, flag };
                });
                const revTotal = roomList.reduce((s, r) => s + r.revAB, 0);
                const revA = roomList.reduce((s, r) => s + r.revA, 0);
                const revB = roomList.reduce((s, r) => s + r.revB, 0);
                const occA = roomList.reduce((s, r) => s + r.occA, 0);
                const occB = roomList.reduce((s, r) => s + r.occB, 0);
                return {
                    name: building,
                    roomCount: rooms.length,
                    revTotal, revA, revB,
                    aRevPct: percent(revA, revTotal),
                    bRevPct: percent(revB, revTotal),
                    occA, occB,
                    aOccPct: percent(occA, occA + occB),
                    bOccPct: percent(occB, occA + occB),
                    rooms: roomList
                };
            });
            const attentionRooms = [];
            buildings.forEach((b) => {
                b.rooms.forEach((r) => {
                    if (r.flag !== "정상" && r.flag !== "허용범위(6:4~4:6)" && r.flag !== "무예약") {
                        attentionRooms.push({ building: b.name, room: r.room, flag: r.flag });
                    }
                });
            });
            return {
                year,
                month,
                reportEndDate: reportEndDate || null,
                totalRev,
                totalRevA,
                totalRevB,
                totalBookA,
                totalBookB,
                totalOccA,
                totalOccB,
                aRevPct: percent(totalRevA, totalRev),
                bRevPct: percent(totalRevB, totalRev),
                aOccPct: percent(totalOccA, totalOccA + totalOccB),
                bOccPct: percent(totalOccB, totalOccA + totalOccB),
                buildings,
                attentionRooms
            };
        })();

        const dataStartRow = 4;
        const lastRow = values.length;

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A1`,
            valueInputOption: "USER_ENTERED",
            resource: { values }
        });

        const refreshedMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        const existingRules = (refreshedMeta.data.sheets || []).find((s) => s.properties.title === SHEET_TITLE)?.conditionalFormats || [];
        const deleteRulesReq = [];
        for (let i = existingRules.length - 1; i >= 0; i--) {
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
                    ...Array.from({ length: Math.max(0, lastRow - dataStartRow + 1) }, (_, i) => i).map((i) => (i % 2 === 1 ? {
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
                                    textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.08, green: 0.22, blue: 0.45 } }
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
                    {
                        updateBorders: {
                            range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 17 },
                            top: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } },
                            bottom: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } },
                            left: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } },
                            right: { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } },
                            innerHorizontal: { style: "SOLID", color: { red: 0.82, green: 0.86, blue: 0.94 } },
                            innerVertical: { style: "SOLID", color: { red: 0.82, green: 0.86, blue: 0.94 } }
                        }
                    },
                    {
                        addConditionalFormatRule: {
                            index: 0,
                            rule: {
                                ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
                                booleanRule: {
                                    condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Airbnb 점검 필요" }] },
                                    format: {
                                        backgroundColor: { red: 1.0, green: 0.91, blue: 0.91 },
                                        textFormat: { bold: true, foregroundColor: { red: 0.74, green: 0.15, blue: 0.19 } }
                                    }
                                }
                            }
                        }
                    },
                    {
                        addConditionalFormatRule: {
                            index: 1,
                            rule: {
                                ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
                                booleanRule: {
                                    condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Booking.com 점검 필요" }] },
                                    format: {
                                        backgroundColor: { red: 0.90, green: 0.94, blue: 1.0 },
                                        textFormat: { bold: true, foregroundColor: { red: 0.12, green: 0.26, blue: 0.56 } }
                                    }
                                }
                            }
                        }
                    },
                    {
                        addConditionalFormatRule: {
                            index: 2,
                            rule: {
                                ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
                                booleanRule: {
                                    condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Airbnb 비중 낮음(기준밖)" }] },
                                    format: {
                                        backgroundColor: { red: 1.0, green: 0.96, blue: 0.86 },
                                        textFormat: { bold: true, foregroundColor: { red: 0.72, green: 0.36, blue: 0.02 } }
                                    }
                                }
                            }
                        }
                    },
                    {
                        addConditionalFormatRule: {
                            index: 3,
                            rule: {
                                ranges: [{ sheetId, startRowIndex: 3, endRowIndex: lastRow, startColumnIndex: 16, endColumnIndex: 17 }],
                                booleanRule: {
                                    condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Booking.com 비중 낮음(기준밖)" }] },
                                    format: {
                                        backgroundColor: { red: 0.93, green: 0.96, blue: 1.0 },
                                        textFormat: { bold: true, foregroundColor: { red: 0.12, green: 0.34, blue: 0.62 } }
                                    }
                                }
                            }
                        }
                    }
                ]
            }
        });

        console.log(`✅ [Platform Analysis] 리뉴얼 리포트 생성 완료 (${lastRow - 2}행).`);
        return platformDataForNotion;
    }

    function buildScheduledDailyReportData({
        companyDocs,
        loopStart,
        yesterday
    }) {
        const rows = [];
        const cancelRows = [];
        const totalCancelByArrivalMonth = {};
        let mtdNew = 0;
        let mtdCancel = 0;
        let mtdRevenue = 0;

        const isIncludedReportDoc = (data) => {
            if (data.building === "다이쿄초") return false;
            if (data.referer !== "Airbnb" && data.referer !== "Booking.com") return false;
            return true;
        };

        for (let d = dayjs(loopStart); d.isBefore(yesterday) || d.isSame(yesterday, "day"); d = d.add(1, "day")) {
            const dateStr = d.format("YYYY-MM-DD");
            const newBookings = [];
            const cancelledBookings = [];

            companyDocs.forEach((data) => {
                if (!isIncludedReportDoc(data)) return;

                if (data.status === "confirmed" && data.bookDate === dateStr && getBookingAmount(data) > 0) {
                    newBookings.push(data);
                }

                const rawCancelTime = data.status === "cancelled" ? (data.cancelTime || data.modified || "") : "";
                if (!rawCancelTime) return;

                const jstCancelDate = dayjs(rawCancelTime).tz("Asia/Tokyo").format("YYYY-MM-DD");
                if (jstCancelDate !== dateStr) return;

                if (data.arrival) {
                    const arrDate = dayjs(data.arrival);
                    const rptDate = dayjs(dateStr);
                    if (!(arrDate.isAfter(rptDate.subtract(6, "month")) && arrDate.isBefore(rptDate.add(6, "month")))) {
                        return;
                    }
                }
                cancelledBookings.push(data);
            });

            const dailyRevenue = newBookings.reduce((sum, b) => sum + getBookingAmount(b), 0);

            const monthlyBreakdown = {};
            newBookings.forEach((b) => {
                const arrMonth = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
                monthlyBreakdown[arrMonth] = (monthlyBreakdown[arrMonth] || 0) + 1;
            });
            const breakdownStr = Object.entries(monthlyBreakdown)
                .sort((a, b) => {
                    if (a[0] === "미정") return 1;
                    if (b[0] === "미정") return -1;
                    return parseInt(a[0], 10) - parseInt(b[0], 10);
                })
                .map(([m, count]) => `${m}  ${count}건`)
                .join("\n");

            const buildingMap = {};
            newBookings.forEach((b) => {
                const bd = b.building || "기타";
                if (!buildingMap[bd]) buildingMap[bd] = { count: 0, rev: 0 };
                buildingMap[bd].count += 1;
                buildingMap[bd].rev += getBookingAmount(b);
            });

            const detailLines = [];
            if (newBookings.length > 0) {
                detailLines.push(`[신규] ${Object.entries(buildingMap).map(([bd, info]) => `${bd} ${info.count}건(${info.rev.toLocaleString()})`).join(", ")}`);
            }
            if (cancelledBookings.length > 0) {
                const cMap = {};
                cancelledBookings.forEach((b) => {
                    cMap[b.building || "기타"] = (cMap[b.building || "기타"] || 0) + 1;
                });
                detailLines.push(`[취소] ${Object.entries(cMap).map(([bd, cnt]) => `${bd} ${cnt}건`).join(", ")}`);
            }

            rows.push([dateStr, newBookings.length, cancelledBookings.length, dailyRevenue, breakdownStr || "-", detailLines.join("\n") || "-"]);
            mtdNew += newBookings.length;
            mtdCancel += cancelledBookings.length;
            mtdRevenue += dailyRevenue;

            const cancelMonthlyBreakdown = {};
            cancelledBookings.forEach((b) => {
                const m = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
                cancelMonthlyBreakdown[m] = (cancelMonthlyBreakdown[m] || 0) + 1;
            });
            const cancelBreakdownStr = Object.entries(cancelMonthlyBreakdown)
                .sort((a, b) => {
                    if (a[0] === "미정") return 1;
                    if (b[0] === "미정") return -1;
                    return parseInt(a[0], 10) - parseInt(b[0], 10);
                })
                .map(([m, count]) => `${m} - ${count}건`)
                .join("\n") || "-";

            const cancelDetailMap = {};
            cancelledBookings.forEach((b) => {
                const bd = b.building || "기타";
                const rm = b.room || "-";
                if (!cancelDetailMap[bd]) cancelDetailMap[bd] = {};
                cancelDetailMap[bd][rm] = (cancelDetailMap[bd][rm] || 0) + 1;
            });
            const cancelDetailStr = Object.entries(cancelDetailMap)
                .map(([bd, rooms]) => `${bd}(${Object.entries(rooms).map(([r, n]) => `${r} ${n}건`).join(", ")})`)
                .join(" / ");
            cancelRows.push([dateStr, cancelledBookings.length, cancelBreakdownStr, cancelDetailStr ? `[취소] ${cancelDetailStr}` : "-"]);

            cancelledBookings.forEach((b) => {
                const arrMonth = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
                totalCancelByArrivalMonth[arrMonth] = (totalCancelByArrivalMonth[arrMonth] || 0) + 1;
            });
        }

        const totalMonthly = {};
        const totalMonthlyRevenue = {};
        companyDocs.forEach((data) => {
            if (!isIncludedReportDoc(data)) return;
            if (data.status === "confirmed" &&
                data.bookDate >= loopStart.format("YYYY-MM-DD") &&
                data.bookDate <= yesterday.format("YYYY-MM-DD") &&
                getBookingAmount(data) > 0) {
                const key = data.arrival ? dayjs(data.arrival).tz("Asia/Tokyo").format("M월") : "미정";
                totalMonthly[key] = (totalMonthly[key] || 0) + 1;
                totalMonthlyRevenue[key] = (totalMonthlyRevenue[key] || 0) + getBookingAmount(data);
            }
        });
        const totalMonthlyCount = Object.values(totalMonthly).reduce((s, c) => s + c, 0);
        const totalMonthlyRevenueAmount = Object.values(totalMonthlyRevenue).reduce((s, v) => s + (Number(v) || 0), 0);
        const observedMonthNums = Object.keys(totalMonthly)
            .filter((k) => /^\d+월$/.test(k))
            .map((k) => parseInt(k, 10))
            .sort((a, b) => a - b);
        const normalizedMonthly = {};
        if (observedMonthNums.length > 0) {
            const minMonth = observedMonthNums[0];
            const maxMonth = observedMonthNums[observedMonthNums.length - 1];
            for (let m = minMonth; m <= maxMonth; m++) {
                const key = `${m}월`;
                normalizedMonthly[key] = totalMonthly[key] || 0;
            }
        }
        if (totalMonthly["미정"]) normalizedMonthly["미정"] = totalMonthly["미정"];
        const monthlySummaryRows = Object.entries(normalizedMonthly).map(([m, cnt]) => [m, cnt, totalMonthlyCount > 0 ? cnt / totalMonthlyCount : 0]);
        const monthlyRevenueSummaryRows = Object.keys(normalizedMonthly).map((monthLabel) => [monthLabel, Number(totalMonthlyRevenue[monthLabel] || 0)]);
        if (monthlySummaryRows.length === 0) monthlySummaryRows.push(["-", 0, 0]);
        if (monthlyRevenueSummaryRows.length === 0) monthlyRevenueSummaryRows.push(["-", 0]);
        monthlySummaryRows.push(["합계", totalMonthlyCount, totalMonthlyCount > 0 ? 1.0 : 0]);
        monthlyRevenueSummaryRows.push(["합계", totalMonthlyRevenueAmount]);

        const totalCancelCount = cancelRows.reduce((s, r) => s + r[1], 0);
        const cancelObservedMonthNums = Object.keys(totalCancelByArrivalMonth)
            .filter((k) => /^\d+월$/.test(k))
            .map((k) => parseInt(k, 10))
            .sort((a, b) => a - b);
        const normalizedCancelMonthly = {};
        if (cancelObservedMonthNums.length > 0) {
            const minM = cancelObservedMonthNums[0];
            const maxM = cancelObservedMonthNums[cancelObservedMonthNums.length - 1];
            for (let m = minM; m <= maxM; m++) {
                const key = `${m}월`;
                normalizedCancelMonthly[key] = totalCancelByArrivalMonth[key] || 0;
            }
        }
        if (totalCancelByArrivalMonth["미정"]) normalizedCancelMonthly["미정"] = totalCancelByArrivalMonth["미정"];
        const cancelSummaryRows = Object.entries(normalizedCancelMonthly).map(([m, cnt]) => [m, cnt, totalCancelCount > 0 ? cnt / totalCancelCount : 0]);
        if (cancelSummaryRows.length === 0) cancelSummaryRows.push(["-", 0, 0]);
        cancelSummaryRows.push(["합계", totalCancelCount, totalCancelCount > 0 ? 1.0 : 0]);

        const roomStatsByBuilding = {};
        const periodStartStr = loopStart.format("YYYY-MM-DD");
        const periodEndStr = yesterday.format("YYYY-MM-DD");
        const periodStart = dayjs(periodStartStr);
        const periodEnd = dayjs(periodEndStr);

        companyDocs.forEach((data) => {
            if (!isIncludedReportDoc(data)) return;
            if (!data.bookDate || data.bookDate < periodStartStr || data.bookDate > periodEndStr) return;
            if (getBookingAmount(data) <= 0) return;
            if (data.status !== "confirmed") return;
            const bd = data.building || "기타";
            const rm = data.room || "-";
            if (!roomStatsByBuilding[bd]) roomStatsByBuilding[bd] = {};
            if (!roomStatsByBuilding[bd][rm]) roomStatsByBuilding[bd][rm] = { reserved: 0, cancelled: 0 };
            roomStatsByBuilding[bd][rm].reserved += 1;
        });

        companyDocs.forEach((data) => {
            if (!isIncludedReportDoc(data)) return;
            if (data.status !== "cancelled") return;
            const rawCancelTime = data.cancelTime || data.modified || "";
            if (!rawCancelTime) return;
            const cancelDate = dayjs(rawCancelTime).tz("Asia/Tokyo");
            if (cancelDate.isBefore(periodStart, "day") || cancelDate.isAfter(periodEnd, "day")) return;
            if (data.arrival) {
                const arrDate = dayjs(data.arrival);
                if (!(arrDate.isAfter(cancelDate.subtract(6, "month")) && arrDate.isBefore(cancelDate.add(6, "month")))) return;
            }
            const bd = data.building || "기타";
            const rm = data.room || "-";
            if (!roomStatsByBuilding[bd]) roomStatsByBuilding[bd] = {};
            if (!roomStatsByBuilding[bd][rm]) roomStatsByBuilding[bd][rm] = { reserved: 0, cancelled: 0 };
            roomStatsByBuilding[bd][rm].cancelled += 1;
        });

        const buildingRateSections = Object.entries(roomStatsByBuilding)
            .map(([building, roomStats]) => {
                const rowsForBuilding = Object.entries(roomStats)
                    .filter(([, stat]) => stat.cancelled > 0)
                    .map(([room, stat]) => {
                        const rate = stat.reserved > 0 ? stat.cancelled / stat.reserved : null;
                        const sortRate = stat.reserved > 0 ? rate : 1;
                        return [room, stat.reserved, stat.cancelled, rate, sortRate];
                    })
                    .sort((a, b) => (b[4] - a[4]) || (b[2] - a[2]) || (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])));
                const reservedTotal = rowsForBuilding.reduce((s, r) => s + r[1], 0);
                const cancelTotal = rowsForBuilding.reduce((s, r) => s + r[2], 0);
                const buildingRate = reservedTotal > 0 ? cancelTotal / reservedTotal : null;
                const buildingSortRate = reservedTotal > 0 ? buildingRate : 1;
                return { building, rows: rowsForBuilding, reservedTotal, cancelTotal, buildingRate, buildingSortRate };
            })
            .filter((section) => section.rows.length > 0)
            .sort((a, b) => (b.buildingSortRate - a.buildingSortRate) || (b.cancelTotal - a.cancelTotal) || a.building.localeCompare(b.building, "ko"));

        const blockWidth = 5;
        const dataColsPerBlock = 4;
        const cancelRightTableLastRow = 5 + cancelSummaryRows.length;
        const roomRateSectionStartRow = Math.max(31, (5 + cancelRows.length) + 2, cancelRightTableLastRow + 2);
        const maxRowsPerBuilding = Math.max(1, ...buildingRateSections.map((s) => s.rows.length));
        const matrixRowCount = 2 + maxRowsPerBuilding;
        const roomRateTotalCols = Math.max(4, buildingRateSections.length * blockWidth - 1);
        const roomRateTitleRow = ["🏢 건물별 객실 취소 요약 (취소 발생 객실 기준)", ...Array(Math.max(0, roomRateTotalCols - 1)).fill("")];
        const roomRateMatrix = Array.from({ length: matrixRowCount }, () => Array.from({ length: roomRateTotalCols }, () => ""));
        if (buildingRateSections.length === 0) {
            roomRateMatrix[0][0] = "데이터 없음";
        } else {
            buildingRateSections.forEach((section, sectionIndex) => {
                const colStart = sectionIndex * blockWidth;
                const buildingRateLabel = section.buildingRate == null ? "취소 발생(모수없음)" : `${(section.buildingRate * 100).toFixed(1)}%`;
                roomRateMatrix[0][colStart] = `▶ ${section.building} (${buildingRateLabel})`;
                roomRateMatrix[1][colStart] = "객실";
                roomRateMatrix[1][colStart + 1] = "예약건수";
                roomRateMatrix[1][colStart + 2] = "취소건수";
                roomRateMatrix[1][colStart + 3] = "취소율";
                section.rows.forEach((row, i) => {
                    roomRateMatrix[2 + i][colStart] = row[0];
                    roomRateMatrix[2 + i][colStart + 1] = row[1];
                    roomRateMatrix[2 + i][colStart + 2] = row[2];
                    roomRateMatrix[2 + i][colStart + 3] = row[3] == null ? "-" : row[3];
                });
            });
        }

        return {
            rows,
            cancelRows,
            monthlySummaryRows,
            monthlyRevenueSummaryRows,
            cancelSummaryRows,
            mtdNew,
            mtdCancel,
            mtdRevenue,
            roomRateSectionStartRow,
            roomRateTitleRow,
            roomRateMatrix,
            matrixRowCount,
            roomRateTotalCols,
            blockWidth,
            dataColsPerBlock,
            buildingRateSections
        };
    }

    async function updateDailySalesLogSheet({
        sheets,
        spreadsheetId,
        meta,
        loopStart,
        tokyoNow,
        year,
        month
    }) {
        const SALES_SHEET_TITLE = "매출일지";
        const SALES_STYLE_LOCK = Object.freeze({
            fontFamily: "Noto Sans KR",
            colDate: 138,
            colMetrics: 118,
            rowHeights: Object.freeze({ title: 52, month: 36, sub: 34, data: 30 }),
            titleFontSize: 18,
            headerFontSize: 12,
            subHeaderFontSize: 11,
            bodyFontSize: 11
        });
        const assertSalesStyleLock = () => {
            if (!SALES_STYLE_LOCK.fontFamily) throw new Error("SALES_STYLE_LOCK 누락: fontFamily");
            if (!SALES_STYLE_LOCK.rowHeights?.title) throw new Error("SALES_STYLE_LOCK 누락: rowHeights");
            if (!SALES_STYLE_LOCK.colDate || !SALES_STYLE_LOCK.colMetrics) throw new Error("SALES_STYLE_LOCK 누락: columns");
        };
        assertSalesStyleLock();

        const NAVY = { red: 0.05, green: 0.12, blue: 0.28 };
        const DARK_BLUE = { red: 0.08, green: 0.22, blue: 0.45 };
        const LIGHT_BLUE = { red: 0.88, green: 0.93, blue: 1.0 };
        const WHITE = { red: 1.0, green: 1.0, blue: 1.0 };
        const ROW_ODD = { red: 0.97, green: 0.98, blue: 1.0 };
        const GREEN = { red: 0.0, green: 0.42, blue: 0.15 };
        const ACCENT_BLUE = { red: 0.1, green: 0.3, blue: 0.65 };
        const BORDER_MED = { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } };
        const BORDER_THIN = { style: "SOLID", color: { red: 0.75, green: 0.80, blue: 0.90 } };

        console.log(`📈 [Scheduled Report] 매출 일지(${SALES_SHEET_TITLE}) 생성 시작...`);

        const sStart = loopStart.format("YYYY-MM-DD");
        const reportEnd = tokyoNow.subtract(1, "day");
        const sEnd = reportEnd.format("YYYY-MM-DD");
        const salesSnap = await admin.firestore().collection("sales_logs")
            .where("__name__", ">=", sStart)
            .where("__name__", "<=", sEnd)
            .get();

        const salesLogs = {};
        salesSnap.forEach((doc) => {
            salesLogs[doc.id] = doc.data();
        });

        let sSheetId = null;
        let sSheet = (meta?.data?.sheets || []).find((s) => s.properties.title === SALES_SHEET_TITLE);
        if (!sSheet) {
            const res = await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: { requests: [{ addSheet: { properties: { title: SALES_SHEET_TITLE, tabColorStyle: { rgbColor: { red: 0.20, green: 0.66, blue: 0.33 } } } } }] }
            });
            sSheetId = res.data.replies[0].addSheet.properties.sheetId;
        } else {
            sSheetId = sSheet.properties.sheetId;
        }

        const projectionMonths = [];
        for (let i = 0; i < 6; i++) {
            projectionMonths.push(loopStart.add(i, "month").format("YYYY-MM"));
        }

        const monthTitle = `📊 [${year}년 ${month}월] 매출 일지 (Booking Pace Executive Report)  |  최종업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | 갱신주기: 매일 08:45 (JST)`;
        const titleRow = [monthTitle, ...Array(12).fill("")];
        const monthHeaderRow = ["기록일", ...projectionMonths.flatMap((m) => [m, ""])];
        const subHeaderRow = ["", ...projectionMonths.flatMap(() => ["매출액 (JPY)", "가동률"])];
        const sRowsRaw = [];

        for (let d = dayjs(loopStart); d.isBefore(tokyoNow, "day"); d = d.add(1, "day")) {
            const dStr = d.format("YYYY-MM-DD");
            const log = salesLogs[dStr];
            if (log && log.monthlyStats) {
                const row = [dStr];
                projectionMonths.forEach((pm) => {
                    const stat = log.monthlyStats[pm] || { revenue: 0, occupancy: 0 };
                    row.push(stat.revenue || 0);
                    row.push((stat.occupancy || 0) / 100);
                });
                sRowsRaw.push(row);
            }
        }

        let sRows = sRowsRaw;
        if (sRowsRaw.length > 1) {
            const baseSig = sRowsRaw[0].slice(1).join("|");
            let firstChangedIndex = sRowsRaw.length - 1;
            for (let i = 1; i < sRowsRaw.length; i++) {
                const sig = sRowsRaw[i].slice(1).join("|");
                if (sig !== baseSig) {
                    firstChangedIndex = i;
                    break;
                }
            }
            if (firstChangedIndex > 0) {
                sRows = sRowsRaw.slice(firstChangedIndex);
                console.log(`   [Scheduled Report] 매출 일지 중복 프리픽스 ${firstChangedIndex}행 제거 (시작일: ${sRows[0][0]})`);
            }
        }

        if (sRows.length === 0) {
            return { salesLogRows: [], projectionMonths: projectionMonths };
        }

        const colA = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${SALES_SHEET_TITLE}!A1:A5000`
        });
        const colAValues = colA.data.values || [];
        const titlePrefix = `📊 [${year}년 ${month}월] 매출 일지`;
        let targetStartRow = 0;
        for (let i = 0; i < colAValues.length; i++) {
            const v = (colAValues[i] && colAValues[i][0]) ? String(colAValues[i][0]) : "";
            if (v.startsWith(titlePrefix)) {
                targetStartRow = i + 1;
                break;
            }
        }
        if (targetStartRow === 0) {
            let lastNonEmpty = 0;
            for (let i = 0; i < colAValues.length; i++) {
                const v = (colAValues[i] && colAValues[i][0]) ? String(colAValues[i][0]).trim() : "";
                if (v) lastNonEmpty = i + 1;
            }
            targetStartRow = lastNonEmpty === 0 ? 1 : lastNonEmpty + 2;
        }

        const blockHeight = 3 + sRows.length;
        const start0 = targetStartRow - 1;
        const end0 = start0 + blockHeight;

        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${SALES_SHEET_TITLE}!A${targetStartRow}:M${targetStartRow + blockHeight + 2}`
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${SALES_SHEET_TITLE}!A${targetStartRow}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [titleRow, monthHeaderRow, subHeaderRow, ...sRows] }
        });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
                requests: [
                    { unmergeCells: { range: { sheetId: sSheetId, startRowIndex: start0, endRowIndex: end0 + 1, startColumnIndex: 0, endColumnIndex: 13 } } },
                    { mergeCells: { range: { sheetId: sSheetId, startRowIndex: start0, endRowIndex: start0 + 1, startColumnIndex: 0, endColumnIndex: 13 }, mergeType: "MERGE_ALL" } },
                    ...projectionMonths.map((_, i) => ({
                        mergeCells: { range: { sheetId: sSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 2, startColumnIndex: 1 + (i * 2), endColumnIndex: 3 + (i * 2) }, mergeType: "MERGE_ALL" }
                    })),
                    { mergeCells: { range: { sheetId: sSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 3, startColumnIndex: 0, endColumnIndex: 1 }, mergeType: "MERGE_ALL" } },
                    { updateDimensionProperties: { range: { sheetId: sSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: SALES_STYLE_LOCK.colDate }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: sSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 13 }, properties: { pixelSize: SALES_STYLE_LOCK.colMetrics }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: sSheetId, dimension: "ROWS", startIndex: start0, endIndex: start0 + 1 }, properties: { pixelSize: SALES_STYLE_LOCK.rowHeights.title }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: sSheetId, dimension: "ROWS", startIndex: start0 + 1, endIndex: start0 + 2 }, properties: { pixelSize: SALES_STYLE_LOCK.rowHeights.month }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: sSheetId, dimension: "ROWS", startIndex: start0 + 2, endIndex: start0 + 3 }, properties: { pixelSize: SALES_STYLE_LOCK.rowHeights.sub }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: sSheetId, dimension: "ROWS", startIndex: start0 + 3, endIndex: end0 }, properties: { pixelSize: SALES_STYLE_LOCK.rowHeights.data }, fields: "pixelSize" } },
                    { repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0, endRowIndex: end0, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { textFormat: { fontFamily: SALES_STYLE_LOCK.fontFamily } } }, fields: "userEnteredFormat.textFormat.fontFamily" } },
                    { repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0, endRowIndex: start0 + 1, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: SALES_STYLE_LOCK.titleFontSize }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 2, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: SALES_STYLE_LOCK.headerFontSize }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0 + 2, endRowIndex: start0 + 3, startColumnIndex: 1, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { foregroundColor: DARK_BLUE, bold: true, fontSize: SALES_STYLE_LOCK.subHeaderFontSize }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 3, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.38, blue: 0.65 }, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: WHITE, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { fontSize: SALES_STYLE_LOCK.bodyFontSize, foregroundColor: DARK_BLUE } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } },
                    ...sRows.map((_, i) => (i % 2 === 1 ? {
                        repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0 + 4 + i, endRowIndex: start0 + 5 + i, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: ROW_ODD } }, fields: "userEnteredFormat.backgroundColor" }
                    } : null)).filter(Boolean),
                    { repeatCell: { range: { sheetId: sSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 1, endColumnIndex: 13 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } },
                    ...projectionMonths.map((_, i) => ({
                        repeatCell: {
                            range: { sheetId: sSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 2 + i * 2, endColumnIndex: 3 + i * 2 },
                            cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, textFormat: { foregroundColor: ACCENT_BLUE, bold: true } } },
                            fields: "userEnteredFormat(numberFormat,textFormat)"
                        }
                    })),
                    ...projectionMonths.map((_, i) => ({
                        repeatCell: {
                            range: { sheetId: sSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 1 + i * 2, endColumnIndex: 2 + i * 2 },
                            cell: { userEnteredFormat: { textFormat: { foregroundColor: GREEN, bold: true } } },
                            fields: "userEnteredFormat.textFormat"
                        }
                    })),
                    { updateBorders: { range: { sheetId: sSheetId, startRowIndex: start0, endRowIndex: end0, startColumnIndex: 0, endColumnIndex: 13 }, top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
                    { updateBorders: { range: { sheetId: sSheetId, startRowIndex: start0 + 2, endRowIndex: start0 + 3, startColumnIndex: 0, endColumnIndex: 13 }, bottom: BORDER_MED } }
                ]
            }
        });
        return { salesLogRows: sRows, projectionMonths };
    }

    async function updateDailyLogSheet({
        sheets,
        spreadsheetId,
        sheetTitle,
        sheetId,
        rows,
        monthlySummaryRows,
        year,
        month,
        tokyoNow,
        mtdNew,
        mtdCancel,
        mtdRevenue
    }) {
        const NAVY = { red: 0.05, green: 0.12, blue: 0.28 };
        const DARK_BLUE = { red: 0.08, green: 0.22, blue: 0.45 };
        const LIGHT_BLUE = { red: 0.88, green: 0.93, blue: 1.0 };
        const WHITE = { red: 1.0, green: 1.0, blue: 1.0 };
        const ROW_ODD = { red: 0.97, green: 0.98, blue: 1.0 };
        const GREEN = { red: 0.0, green: 0.42, blue: 0.15 };
        const ACCENT_BLUE = { red: 0.1, green: 0.3, blue: 0.65 };
        const GRAY_TEXT = { red: 0.3, green: 0.3, blue: 0.35 };
        const BORDER_MED = { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } };
        const BORDER_THIN = { style: "SOLID", color: { red: 0.75, green: 0.80, blue: 0.90 } };
        const DAILY_STYLE_LOCK = Object.freeze({
            fontFamily: "Noto Sans KR",
            rowMin: 28,
            rowMax: 220,
            breakdownLineHeight: 18,
            detailLineHeight: 14,
            dailyColWidth: Object.freeze({ e: 120, f: 500, h: 66, i: 72, j: 68 }),
            rightDataFontSize: 10
        });
        const assertDailyStyleLock = () => {
            if (!DAILY_STYLE_LOCK.fontFamily) throw new Error("DAILY_STYLE_LOCK 누락: fontFamily");
            if (!DAILY_STYLE_LOCK.dailyColWidth?.e) throw new Error("DAILY_STYLE_LOCK 누락: dailyColWidth");
        };
        assertDailyStyleLock();

        const rightTableLastRow = 5 + monthlySummaryRows.length;
        const cancelRate = mtdNew > 0 ? mtdCancel / mtdNew : 0;
        const dashboard = [
            [`📋  ${year}년 ${month}월 경영 분석 리포트 (MTD)`, "", "", "", "", `최종업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | 갱신주기: 매일 08:45 (JST)`],
            ["누적 신규 예약", "누적 취소 건수", "취소율", "누적 매출액 (JPY)", "", "운영 상태"],
            [mtdNew, mtdCancel, cancelRate, mtdRevenue, "", "✅ 정상"],
            ["", "", "", "", "", ""],
            ["날짜", "신규(건)", "취소(건)", "매출액(엔)", "입실 월별 현황", "상세 내역 (건물별)"]
        ];
        const rightValues = [
            ["📊 입실 월별 누적 현황", "", ""],
            ["", "", ""], ["", "", ""], ["", "", ""],
            ["입실 월", "예약 건수", "비율"],
            ...monthlySummaryRows
        ];

        await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetTitle}!A1:Z200` });
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${sheetTitle}!A1`, valueInputOption: "USER_ENTERED", resource: { values: dashboard } });
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${sheetTitle}!A6`, valueInputOption: "USER_ENTERED", resource: { values: rows } });
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${sheetTitle}!H1`, valueInputOption: "USER_ENTERED", resource: { values: rightValues } });

        const lastRow = 5 + rows.length;
        const rowHeightRequests = [
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 52 }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 42 }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: "pixelSize" } }
        ];
        rows.forEach((row, i) => {
            const breakdownLines = row[4] === "-" ? 1 : row[4].split("\n").length;
            const detailLineCount = row[5] === "-" ? 1 : row[5].split("\n").length;
            const breakdownHeight = 8 + (breakdownLines * DAILY_STYLE_LOCK.breakdownLineHeight);
            const detailHeight = 8 + (detailLineCount * DAILY_STYLE_LOCK.detailLineHeight);
            rowHeightRequests.push({
                updateDimensionProperties: {
                    range: { sheetId, dimension: "ROWS", startIndex: 5 + i, endIndex: 6 + i },
                    properties: { pixelSize: Math.min(DAILY_STYLE_LOCK.rowMax, Math.max(DAILY_STYLE_LOCK.rowMin, Math.max(breakdownHeight, detailHeight))) },
                    fields: "pixelSize"
                }
            });
        });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
                requests: [
                    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 5 } }, fields: "gridProperties.frozenRowCount" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 110 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 90 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 90 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 185 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: DAILY_STYLE_LOCK.dailyColWidth.e }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: DAILY_STYLE_LOCK.dailyColWidth.f }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: 24 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: DAILY_STYLE_LOCK.dailyColWidth.h }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: DAILY_STYLE_LOCK.dailyColWidth.i }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: DAILY_STYLE_LOCK.dailyColWidth.j }, fields: "pixelSize" } },
                    { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 } } },
                    { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } },
                    { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }, mergeType: "MERGE_ALL" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(lastRow, rightTableLastRow), startColumnIndex: 0, endColumnIndex: 10 }, cell: { userEnteredFormat: { textFormat: { fontFamily: DAILY_STYLE_LOCK.fontFamily } } }, fields: "userEnteredFormat.textFormat.fontFamily" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 17, fontFamily: "Arial" }, verticalAlignment: "MIDDLE", horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: { red: 0.7, green: 0.8, blue: 1.0 }, fontSize: 9, italic: true }, verticalAlignment: "MIDDLE", horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { foregroundColor: DARK_BLUE, bold: true, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: true, fontSize: 18, foregroundColor: DARK_BLUE }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, textFormat: { bold: true, fontSize: 18, foregroundColor: { red: 0.8, green: 0.2, blue: 0.1 } } } }, fields: "userEnteredFormat(numberFormat,textFormat)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "¥#,##0" }, textFormat: { bold: true, fontSize: 16, foregroundColor: GREEN } } }, fields: "userEnteredFormat(numberFormat,textFormat)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 4, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: true, fontSize: 14, foregroundColor: GREEN }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.97, blue: 0.99 } } }, fields: "userEnteredFormat.backgroundColor" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: WHITE, verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER", textFormat: { fontSize: 10 } } }, fields: "userEnteredFormat(backgroundColor,verticalAlignment,horizontalAlignment,textFormat)" } },
                    ...rows.map((_, i) => i % 2 === 1 ? { repeatCell: { range: { sheetId, startRowIndex: 6 + i, endRowIndex: 7 + i, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: ROW_ODD } }, fields: "userEnteredFormat.backgroundColor" } } : null).filter(Boolean),
                    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColor: GREEN }, numberFormat: { type: "CURRENCY", pattern: "¥#,##0" } } }, fields: "userEnteredFormat(textFormat,numberFormat)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 4, endColumnIndex: 5 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", horizontalAlignment: "CENTER", textFormat: { fontSize: 11, bold: true, foregroundColor: ACCENT_BLUE } } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment,textFormat)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "MIDDLE", textFormat: { fontSize: 9, foregroundColor: GRAY_TEXT } } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)" } },
                    { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 }, top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED } },
                    { updateBorders: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 }, bottom: BORDER_MED } },
                    { updateBorders: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 }, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
                    { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 6 }, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
                    { unmergeCells: { range: { sheetId, startRowIndex: 5, endRowIndex: Math.max(lastRow, rightTableLastRow), startColumnIndex: 7, endColumnIndex: 10 } } },
                    { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 10 } } },
                    { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 10 }, mergeType: "MERGE_ALL" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 12 }, verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE } }, fields: "userEnteredFormat.backgroundColor" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 4, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: WHITE } }, fields: "userEnteredFormat.backgroundColor" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: WHITE, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { fontSize: DAILY_STYLE_LOCK.rightDataFontSize } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } },
                    ...monthlySummaryRows.map((_, i) => i % 2 === 1 ? { repeatCell: { range: { sheetId, startRowIndex: 6 + i, endRowIndex: 7 + i, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: ROW_ODD } }, fields: "userEnteredFormat.backgroundColor" } } : null).filter(Boolean),
                    { repeatCell: { range: { sheetId, startRowIndex: rightTableLastRow - 1, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { bold: true, fontSize: 11, foregroundColor: DARK_BLUE } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: rightTableLastRow, startColumnIndex: 9, endColumnIndex: 10 }, cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } }, fields: "userEnteredFormat.numberFormat" } },
                    { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: rightTableLastRow - 1, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: ACCENT_BLUE } } }, fields: "userEnteredFormat.textFormat" } },
                    { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 }, top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
                    { updateBorders: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 10 }, bottom: BORDER_MED } },
                    { updateBorders: { range: { sheetId, startRowIndex: rightTableLastRow - 1, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 }, top: BORDER_MED } },
                    ...rowHeightRequests
                ]
            }
        });

        console.log("✅ [Scheduled Report] Daily Log 업데이트 완료.");
    }

    async function updateCancelLogSheet({
        sheets,
        spreadsheetId,
        meta,
        cancelSheetTitle,
        cancelLayoutSchemaVersion,
        cancelLayoutSchemaCell,
        cancelRows,
        cancelSummaryRows,
        roomRateSectionStartRow,
        roomRateTitleRow,
        roomRateMatrix,
        matrixRowCount,
        roomRateTotalCols,
        blockWidth,
        dataColsPerBlock,
        buildingRateSections,
        year,
        month,
        tokyoNow
    }) {
        const NAVY = { red: 0.05, green: 0.12, blue: 0.28 };
        const DARK_BLUE = { red: 0.08, green: 0.22, blue: 0.45 };
        const LIGHT_BLUE = { red: 0.88, green: 0.93, blue: 1.0 };
        const WHITE = { red: 1.0, green: 1.0, blue: 1.0 };
        const ROW_ODD = { red: 0.97, green: 0.98, blue: 1.0 };
        const ACCENT_BLUE = { red: 0.1, green: 0.3, blue: 0.65 };
        const GRAY_TEXT = { red: 0.3, green: 0.3, blue: 0.35 };
        const BORDER_MED = { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } };
        const BORDER_THIN = { style: "SOLID", color: { red: 0.75, green: 0.80, blue: 0.90 } };
        const CANCEL_STYLE_LOCK = Object.freeze({
            fontFamily: "Noto Sans KR",
            rowMin: 28,
            rowMax: 220,
            breakdownLineHeight: 18,
            detailLineHeight: 14,
            dailyColWidth: Object.freeze({ f: 500, h: 66, i: 72, j: 68 }),
            rightDataFontSize: 10
        });
        const assertCancelStyleLock = () => {
            if (!CANCEL_STYLE_LOCK.fontFamily) throw new Error("CANCEL_STYLE_LOCK 누락: fontFamily");
            if (!CANCEL_STYLE_LOCK.dailyColWidth?.f) throw new Error("CANCEL_STYLE_LOCK 누락: dailyColWidth");
        };
        assertCancelStyleLock();

        const totalCancelCount = cancelRows.reduce((s, r) => s + r[1], 0);
        const cancelRightTableLastRow = 5 + cancelSummaryRows.length;
        const detailColCount = 12;
        const rightStartCol = 4;
        const rightEndCol = rightStartCol + 3;
        const cancelLastRow = 5 + cancelRows.length;
        const buildingSectionEnd = cancelRightTableLastRow;

        let cancelSheetId = null;
        let cancelSheet = (meta?.data?.sheets || []).find((s) => s.properties.title === cancelSheetTitle);
        if (cancelSheet) {
            const schemaRes = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${cancelSheetTitle}!${cancelLayoutSchemaCell}`
            });
            const currentSchema = schemaRes.data.values?.[0]?.[0] || "";
            if (currentSchema !== cancelLayoutSchemaVersion) {
                console.log(`   취소 시트 스키마 변경 감지 → 재생성 (${currentSchema || "none"} -> ${cancelLayoutSchemaVersion})`);
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    resource: { requests: [{ deleteSheet: { sheetId: cancelSheet.properties.sheetId } }] }
                });
                cancelSheet = null;
            }
        }
        if (!cancelSheet) {
            const addRes = await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: { requests: [{ addSheet: { properties: { title: cancelSheetTitle, tabColorStyle: { rgbColor: { red: 0.90, green: 0.22, blue: 0.22 } }, gridProperties: { frozenRowCount: 5, frozenColumnCount: 0 } } } }] }
            });
            cancelSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
        } else {
            cancelSheetId = cancelSheet.properties.sheetId;
        }

        // 시트가 외부에서 삭제된 경우 대비: batchUpdate 직전에 현재 스프레드시트에서 시트 ID 재조회
        const freshMeta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
        const currentCancelSheet = (freshMeta.data.sheets || []).find((s) => s.properties.title === cancelSheetTitle);
        if (currentCancelSheet) {
            cancelSheetId = currentCancelSheet.properties.sheetId;
        } else {
            const addRes = await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: { requests: [{ addSheet: { properties: { title: cancelSheetTitle, tabColorStyle: { rgbColor: { red: 0.90, green: 0.22, blue: 0.22 } }, gridProperties: { frozenRowCount: 5, frozenColumnCount: 0 } } } }] }
            });
            cancelSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
        }

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
                requests: [
                    { unmergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1200, startColumnIndex: 0, endColumnIndex: 52 } } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1200, startColumnIndex: 0, endColumnIndex: 52 }, top: { style: "NONE" }, bottom: { style: "NONE" }, left: { style: "NONE" }, right: { style: "NONE" }, innerHorizontal: { style: "NONE" }, innerVertical: { style: "NONE" } } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1200, startColumnIndex: 0, endColumnIndex: 52 }, cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { foregroundColor: DARK_BLUE, fontSize: 10, bold: false }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "OVERFLOW_CELL" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)" } }
                ]
            }
        });

        const cancelDashboard = [
            [`📋  ${year}년 ${month}월 취소 분석 리포트 (MTD)`, "", "", `최종업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | 갱신주기: 매일 08:45 (JST)`],
            ["누적 취소 건수", "", "", ""],
            [totalCancelCount, "", "", ""],
            ["", "", "", ""],
            ["날짜", "취소(건)", "취소 입실월별 현황", "상세 내역 (건물별/객실별)"]
        ];
        const cancelRightValues = [
            ["📊 입실월별 취소 현황", "", ""],
            ["", "", ""], ["", "", ""], ["", "", ""],
            ["입실 월", "취소 건수", "비율"],
            ...cancelSummaryRows
        ];

        await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${cancelSheetTitle}!A1:AZ1200` });
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${cancelSheetTitle}!A1`, valueInputOption: "USER_ENTERED", resource: { values: cancelDashboard } });
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${cancelSheetTitle}!A6`, valueInputOption: "USER_ENTERED", resource: { values: cancelRows } });
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${cancelSheetTitle}!E1`, valueInputOption: "USER_ENTERED", resource: { values: cancelRightValues } });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${cancelSheetTitle}!A${roomRateSectionStartRow}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [roomRateTitleRow, ...roomRateMatrix] }
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${cancelSheetTitle}!${cancelLayoutSchemaCell}`,
            valueInputOption: "RAW",
            resource: { values: [[cancelLayoutSchemaVersion]] }
        });

        const cancelRowHeightRequests = [
            { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 52 }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 42 }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: "pixelSize" } }
        ];
        cancelRows.forEach((row, i) => {
            const breakdownLines = row[2] === "-" ? 1 : row[2].split("\n").length;
            const detailLineCount = row[3] === "-" ? 1 : row[3].split("\n").length;
            const breakdownHeight = 8 + (breakdownLines * CANCEL_STYLE_LOCK.breakdownLineHeight);
            const detailHeight = 8 + (detailLineCount * CANCEL_STYLE_LOCK.detailLineHeight);
            cancelRowHeightRequests.push({ updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 5 + i, endIndex: 6 + i }, properties: { pixelSize: Math.min(CANCEL_STYLE_LOCK.rowMax, Math.max(CANCEL_STYLE_LOCK.rowMin, Math.max(breakdownHeight, detailHeight))) }, fields: "pixelSize" } });
        });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
                requests: [
                    { updateSheetProperties: { properties: { sheetId: cancelSheetId, gridProperties: { frozenRowCount: 5 } }, fields: "gridProperties.frozenRowCount" } },
                    { unmergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1200, startColumnIndex: 0, endColumnIndex: 52 } } },
                    { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 102 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 72 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: CANCEL_STYLE_LOCK.dailyColWidth.f }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: CANCEL_STYLE_LOCK.dailyColWidth.h }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: CANCEL_STYLE_LOCK.dailyColWidth.i }, fields: "pixelSize" } },
                    { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: CANCEL_STYLE_LOCK.dailyColWidth.j }, fields: "pixelSize" } },
                    { unmergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 } } },
                    { mergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: "MERGE_ALL" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: Math.max(cancelRightTableLastRow, roomRateSectionStartRow + 1 + matrixRowCount, buildingSectionEnd), startColumnIndex: 0, endColumnIndex: Math.max(12, detailColCount, roomRateTotalCols) }, cell: { userEnteredFormat: { textFormat: { fontFamily: CANCEL_STYLE_LOCK.fontFamily } } }, fields: "userEnteredFormat.textFormat.fontFamily" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 17 }, verticalAlignment: "MIDDLE", horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: { red: 0.7, green: 0.8, blue: 1.0 }, fontSize: 9, italic: true }, verticalAlignment: "MIDDLE", horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { foregroundColor: DARK_BLUE, bold: true, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: true, fontSize: 18, foregroundColor: DARK_BLUE }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 18, foregroundColor: { red: 0.8, green: 0.2, blue: 0.1 } } } }, fields: "userEnteredFormat.textFormat" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.97, blue: 0.99 } } }, fields: "userEnteredFormat.backgroundColor" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelLastRow, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: WHITE, verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER", textFormat: { fontSize: 10 } } }, fields: "userEnteredFormat(backgroundColor,verticalAlignment,horizontalAlignment,textFormat)" } },
                    ...cancelRows.map((_, i) => i % 2 === 1 ? { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 6 + i, endRowIndex: 7 + i, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: ROW_ODD } }, fields: "userEnteredFormat.backgroundColor" } } : null).filter(Boolean),
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelLastRow, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 0.8, green: 0.2, blue: 0.1 } } } }, fields: "userEnteredFormat.textFormat" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelLastRow, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", horizontalAlignment: "CENTER", textFormat: { fontSize: 11, bold: true, foregroundColor: ACCENT_BLUE } } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment,textFormat)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelLastRow, startColumnIndex: 3, endColumnIndex: 4 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "MIDDLE", textFormat: { fontSize: 9, foregroundColor: GRAY_TEXT } } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)" } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: cancelLastRow, startColumnIndex: 0, endColumnIndex: 4 }, top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 4 }, bottom: BORDER_MED } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelLastRow, startColumnIndex: 0, endColumnIndex: 4 }, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
                    { unmergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol } } },
                    { mergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, mergeType: "MERGE_ALL" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 12 }, verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE } }, fields: "userEnteredFormat.backgroundColor" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 2, endRowIndex: 5, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: WHITE } }, fields: "userEnteredFormat.backgroundColor" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelRightTableLastRow, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: WHITE, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { fontSize: CANCEL_STYLE_LOCK.rightDataFontSize } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } },
                    ...cancelSummaryRows.map((_, i) => i % 2 === 1 ? { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 6 + i, endRowIndex: 7 + i, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: ROW_ODD } }, fields: "userEnteredFormat.backgroundColor" } } : null).filter(Boolean),
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: cancelRightTableLastRow - 1, endRowIndex: cancelRightTableLastRow, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { bold: true, fontSize: 11, foregroundColor: DARK_BLUE } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelRightTableLastRow, startColumnIndex: rightStartCol + 2, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } }, fields: "userEnteredFormat.numberFormat" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelRightTableLastRow - 1, startColumnIndex: rightStartCol + 1, endColumnIndex: rightStartCol + 2 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" }, textFormat: { bold: true, foregroundColor: DARK_BLUE } } }, fields: "userEnteredFormat(numberFormat,textFormat)" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelRightTableLastRow - 1, startColumnIndex: rightStartCol, endColumnIndex: rightStartCol + 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: ACCENT_BLUE } } }, fields: "userEnteredFormat.textFormat" } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: cancelRightTableLastRow, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, bottom: BORDER_MED } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: cancelRightTableLastRow - 1, endRowIndex: cancelRightTableLastRow, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, top: BORDER_MED } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelRightTableLastRow - 1, startColumnIndex: rightStartCol + 1, endColumnIndex: rightStartCol + 2 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColor: DARK_BLUE } } }, fields: "userEnteredFormat.textFormat" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelRightTableLastRow - 1, startColumnIndex: rightStartCol + 2, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 0.78, green: 0.18, blue: 0.12 } } } }, fields: "userEnteredFormat.textFormat" } },
                    { unmergeCells: { range: { sheetId: cancelSheetId, startRowIndex: roomRateSectionStartRow - 1, endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount, startColumnIndex: 0, endColumnIndex: Math.max(roomRateTotalCols, 30) } } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: roomRateSectionStartRow, endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount, startColumnIndex: 0, endColumnIndex: Math.max(roomRateTotalCols, 30) }, cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { foregroundColor: DARK_BLUE, fontSize: 10, bold: false } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
                    { updateBorders: { range: { sheetId: cancelSheetId, startRowIndex: roomRateSectionStartRow - 1, endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount, startColumnIndex: 0, endColumnIndex: Math.max(roomRateTotalCols, 30) }, top: { style: "NONE" }, bottom: { style: "NONE" }, left: { style: "NONE" }, right: { style: "NONE" }, innerHorizontal: { style: "NONE" }, innerVertical: { style: "NONE" } } },
                    { mergeCells: { range: { sheetId: cancelSheetId, startRowIndex: roomRateSectionStartRow - 1, endRowIndex: roomRateSectionStartRow, startColumnIndex: 0, endColumnIndex: roomRateTotalCols }, mergeType: "MERGE_ALL" } },
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: roomRateSectionStartRow - 1, endRowIndex: roomRateSectionStartRow, startColumnIndex: 0, endColumnIndex: roomRateTotalCols }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 12 }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        mergeCells: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow,
                                endRowIndex: roomRateSectionStartRow + 1,
                                startColumnIndex: sectionIndex * blockWidth,
                                endColumnIndex: sectionIndex * blockWidth + dataColsPerBlock
                            },
                            mergeType: "MERGE_ALL"
                        }
                    })),
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        repeatCell: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow,
                                endRowIndex: roomRateSectionStartRow + 1,
                                startColumnIndex: sectionIndex * blockWidth,
                                endColumnIndex: sectionIndex * blockWidth + dataColsPerBlock
                            },
                            cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { bold: true, foregroundColor: DARK_BLUE, fontSize: 10 }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE" } },
                            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                        }
                    })),
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        repeatCell: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow + 1,
                                endRowIndex: roomRateSectionStartRow + 2,
                                startColumnIndex: sectionIndex * blockWidth,
                                endColumnIndex: sectionIndex * blockWidth + dataColsPerBlock
                            },
                            cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
                            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                        }
                    })),
                    { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: roomRateSectionStartRow + 2, endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount, startColumnIndex: 0, endColumnIndex: roomRateTotalCols }, cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        repeatCell: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow + 2,
                                endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount,
                                startColumnIndex: sectionIndex * blockWidth,
                                endColumnIndex: sectionIndex * blockWidth + 1
                            },
                            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, foregroundColor: DARK_BLUE }, horizontalAlignment: "LEFT" } },
                            fields: "userEnteredFormat(textFormat,horizontalAlignment)"
                        }
                    })),
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        repeatCell: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow + 2,
                                endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount,
                                startColumnIndex: sectionIndex * blockWidth + 1,
                                endColumnIndex: sectionIndex * blockWidth + 2
                            },
                            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, foregroundColor: DARK_BLUE } } },
                            fields: "userEnteredFormat.textFormat"
                        }
                    })),
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        repeatCell: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow + 2,
                                endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount,
                                startColumnIndex: sectionIndex * blockWidth + 2,
                                endColumnIndex: sectionIndex * blockWidth + 3
                            },
                            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.78, green: 0.18, blue: 0.12 } } } },
                            fields: "userEnteredFormat.textFormat"
                        }
                    })),
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        repeatCell: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow + 2,
                                endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount,
                                startColumnIndex: sectionIndex * blockWidth + 3,
                                endColumnIndex: sectionIndex * blockWidth + 4
                            },
                            cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, textFormat: { bold: true, foregroundColor: ACCENT_BLUE } } },
                            fields: "userEnteredFormat(numberFormat,textFormat)"
                        }
                    })),
                    ...buildingRateSections.map((section, sectionIndex) => ({
                        updateBorders: {
                            range: {
                                sheetId: cancelSheetId,
                                startRowIndex: roomRateSectionStartRow,
                                endRowIndex: roomRateSectionStartRow + 1 + matrixRowCount,
                                startColumnIndex: sectionIndex * blockWidth,
                                endColumnIndex: sectionIndex * blockWidth + dataColsPerBlock
                            },
                            bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN
                        }
                    })),
                    ...cancelRowHeightRequests
                ]
            }
        });

        console.log(`✅ [Scheduled Report] 취소 분석 리포트(${cancelSheetTitle}) 업데이트 완료.`);
    }

    async function runScheduledDailyReport() {
        const spreadsheetId = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
        const tokyoNow = dayjs().tz("Asia/Tokyo");
        const reportTarget = tokyoNow.subtract(1, "day");
        const year = reportTarget.year();
        const month = reportTarget.month() + 1;
        const sheetTitle = `일일로그_${year}_${String(month).padStart(2, "0")}`;
        const cancelSheetTitle = `취소로그_${year}_${String(month).padStart(2, "0")}`;
        const cancelLayoutSchemaVersion = "cancel_layout_v20260302";
        const cancelLayoutSchemaCell = "Z1000";
        const salesSheetTitle = "매출일지";

        console.log(`\n📅 [Scheduled Report] ${year}년 ${month}월 자동 보고서 생성 시작 (대상: ${sheetTitle}, ${salesSheetTitle})...`);

        try {
            await assertReservationDataReady("scheduledDailyReport");

            console.log("   Firestore 데이터 조회 중...");
            const loopStart = reportTarget.startOf("month");
            const yesterday = reportTarget.endOf("day");
            const reportStartDate = loopStart.format("YYYY-MM-DD");
            const reportEndDate = reportTarget.format("YYYY-MM-DD");
            const reportStartIso = loopStart.startOf("day").toISOString();
            const reportEndIso = yesterday.toISOString();
            const selectedFields = ["id", "bookId", "bookDate", "status", "price", "totalPrice", "building", "room", "cancelTime", "arrival", "departure", "modified", "updatedAt", "referer", "companyId"];

            const [bookedSnap, cancelSnap, modifiedSnap] = await Promise.all([
                admin.firestore().collection("reservations")
                    .where("bookDate", ">=", reportStartDate)
                    .where("bookDate", "<=", reportEndDate)
                    .select(...selectedFields)
                    .get(),
                admin.firestore().collection("reservations")
                    .where("cancelTime", ">=", reportStartIso)
                    .where("cancelTime", "<=", reportEndIso)
                    .select(...selectedFields)
                    .get(),
                admin.firestore().collection("reservations")
                    .where("modified", ">=", reportStartIso)
                    .where("modified", "<=", reportEndIso)
                    .select(...selectedFields)
                    .get()
            ]);

            const allDocs = [];
            const seen = new Set();
            const pushUnique = (doc) => {
                const d = doc.data();
                const key = String(
                    d.bookId ||
                    d.id ||
                    `${d.bookDate || ""}|${d.arrival || ""}|${d.room || ""}|${d.cancelTime || d.modified || ""}`
                );
                if (seen.has(key)) return;
                seen.add(key);
                allDocs.push(d);
            };
            bookedSnap.forEach(pushUnique);
            cancelSnap.forEach(pushUnique);
            modifiedSnap.forEach(pushUnique);
            const companyDocs = filterDocsToCompany(allDocs, DEFAULT_COMPANY_ID);
            console.log(`   Firestore ${companyDocs.length}건 로드 완료 (bookDate:${bookedSnap.size}, cancelTime:${cancelSnap.size}, modified:${modifiedSnap.size})`);

            const auth = new google.auth.GoogleAuth({
                credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });
            const client = await auth.getClient();
            const sheets = google.sheets({ version: "v4", auth: client });

            const meta = await sheets.spreadsheets.get({ spreadsheetId });
            let targetSheet = meta.data.sheets.find((s) => s.properties.title === sheetTitle);
            let sheetId = targetSheet ? targetSheet.properties.sheetId : null;
            if (!targetSheet) {
                const res = await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    resource: { requests: [{ addSheet: { properties: { title: sheetTitle, tabColorStyle: { rgbColor: { red: 0.27, green: 0.51, blue: 0.93 } } } } }] }
                });
                sheetId = res.data.replies[0].addSheet.properties.sheetId;
            }

            const {
                rows,
                cancelRows,
                monthlySummaryRows,
                monthlyRevenueSummaryRows,
                cancelSummaryRows,
                mtdNew,
                mtdCancel,
                mtdRevenue,
                roomRateSectionStartRow,
                roomRateTitleRow,
                roomRateMatrix,
                matrixRowCount,
                roomRateTotalCols,
                blockWidth,
                dataColsPerBlock,
                buildingRateSections
            } = buildScheduledDailyReportData({
                companyDocs,
                loopStart,
                yesterday
            });

            await updateDailyLogSheet({
                sheets,
                spreadsheetId,
                sheetTitle,
                sheetId,
                rows,
                monthlySummaryRows,
                year,
                month,
                tokyoNow,
                mtdNew,
                mtdCancel,
                mtdRevenue
            });
            if (NOTION_PAGES.dailyLog) {
                await syncNotionDailyLog(NOTION_PAGES.dailyLog, { rows, monthlySummaryRows, monthlyRevenueSummaryRows, mtdNew, mtdCancel, mtdRevenue, year, month, tokyoNow });
            }

            await updateCancelLogSheet({
                sheets,
                spreadsheetId,
                meta,
                cancelSheetTitle,
                cancelLayoutSchemaVersion,
                cancelLayoutSchemaCell,
                cancelRows,
                cancelSummaryRows,
                roomRateSectionStartRow,
                roomRateTitleRow,
                roomRateMatrix,
                matrixRowCount,
                roomRateTotalCols,
                blockWidth,
                dataColsPerBlock,
                buildingRateSections,
                year,
                month,
                tokyoNow
            });
            if (NOTION_PAGES.cancelLog) {
                await syncNotionCancelLog(NOTION_PAGES.cancelLog, {
                    cancelRows, cancelSummaryRows, buildingRateSections, year, month, tokyoNow
                });
            }

            const salesLogResult = await updateDailySalesLogSheet({
                sheets,
                spreadsheetId,
                meta,
                loopStart,
                tokyoNow,
                year,
                month
            });
            if (NOTION_PAGES.salesLog) {
                await syncNotionSalesLog(NOTION_PAGES.salesLog, {
                    year,
                    month,
                    tokyoNow,
                    salesLogRows: salesLogResult?.salesLogRows ?? [],
                    projectionMonths: salesLogResult?.projectionMonths ?? []
                });
            }

            await updateFutureTargetGoalsSheet({
                sheets,
                spreadsheetId,
                meta,
                tokyoNow,
                dayjs,
                db: admin.firestore(),
                companyId: DEFAULT_COMPANY_ID,
                BUILDING_ROOMS
            });

            try {
                const platformMonthStart = reportTarget.startOf("month").format("YYYY-MM-DD");
                const platformReportEnd = reportTarget.format("YYYY-MM-DD");
                const platformSnap = await admin.firestore().collection("reservations")
                    .where("bookDate", ">=", platformMonthStart)
                    .where("bookDate", "<=", platformReportEnd)
                    .select("status", "building", "room", "arrival", "departure", "referer", "referrer", "apiSource", "platform", "price", "totalPrice", "bookDate")
                    .get();
                const platformDocs = filterDocsToCompany(platformSnap.docs.map((d) => d.data()), DEFAULT_COMPANY_ID);
                const platformData = await generatePlatformAnalysisTab(sheets, spreadsheetId, year, month, platformDocs, { reportEndDate: platformReportEnd });
                if (NOTION_PAGES.platformAnalysis && platformData) {
                    await syncNotionPlatformAnalysis(NOTION_PAGES.platformAnalysis, { year, month, tokyoNow, platformData });
                }
            } catch (e) {
                console.error("❌ [Platform Analysis] 실패:", e.message);
            }

            console.log("✅ [Scheduled Report] 모든 보고서(Log, Sales, Platform)가 업데이트되었습니다.");
        } catch (e) {
            console.error("❌ [Scheduled Report] 실패:", e.stack);
            await sendSyncAlert("scheduledDailyReport failed", [e.stack || e.message]);
        }
    }

    const scheduledPlatformAnalysisHourly = onSchedule({
        schedule: "0 * * * *",
        timeZone: "Asia/Tokyo",
        timeoutSeconds: 540,
        memory: "1GiB"
    }, async () => {
        const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
        const tokyoNow = dayjs().tz("Asia/Tokyo");
        const year = tokyoNow.year();
        const month = tokyoNow.month() + 1;
        const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
        const reportEndDate = tokyoNow.subtract(1, "day").format("YYYY-MM-DD");

        console.log(`🕐 [Platform Analysis Hourly] ${year}-${month} DB 기반 갱신 시작 (일일로그 기준 ~ ${reportEndDate})`);
        try {
            await assertReservationDataReady("scheduledPlatformAnalysisHourly");
            const stateRef = admin.firestore()
                .collection("reportRuntime")
                .doc(`platform_analysis_${year}_${String(month).padStart(2, "0")}`);
            const latestUpdatedAtSnap = await admin.firestore().collection("reservations")
                .orderBy("updatedAt", "desc")
                .limit(1)
                .select("updatedAt")
                .get();
            const latestUpdatedAt = latestUpdatedAtSnap.empty ? null : latestUpdatedAtSnap.docs[0].data().updatedAt;
            const latestUpdatedAtMillis = latestUpdatedAt && typeof latestUpdatedAt.toMillis === "function"
                ? latestUpdatedAt.toMillis()
                : 0;
            const stateDoc = await stateRef.get();
            const prevUpdatedAtMillis = stateDoc.exists ? Number(stateDoc.data()?.latestUpdatedAtMillis || 0) : 0;

            if (latestUpdatedAtMillis > 0 && latestUpdatedAtMillis <= prevUpdatedAtMillis) {
                console.log("⏭️ [Platform Analysis Hourly] 변경 감지 없음 - 재계산 생략");
                return;
            }

            const snap = await admin.firestore().collection("reservations")
                .where("bookDate", ">=", monthStart)
                .where("bookDate", "<=", reportEndDate)
                .select("status", "building", "room", "arrival", "departure", "referer", "referrer", "apiSource", "platform", "price", "totalPrice", "bookDate")
                .get();
            const allDocs = filterDocsToCompany(snap.docs.map((d) => d.data()), DEFAULT_COMPANY_ID);

            const auth = new google.auth.GoogleAuth({
                credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
                scopes: ["https://www.googleapis.com/auth/spreadsheets"]
            });
            const client = await auth.getClient();
            const sheets = google.sheets({ version: "v4", auth: client });

            const platformData = await generatePlatformAnalysisTab(sheets, SPREADSHEET_ID, year, month, allDocs, { reportEndDate });
            if (platformData && NOTION_PAGES.platformAnalysis) {
                const tokyoNow = dayjs().tz("Asia/Tokyo");
                await syncNotionPlatformAnalysis(NOTION_PAGES.platformAnalysis, { year, month, tokyoNow, platformData });
            }
            await stateRef.set({
                latestUpdatedAtMillis,
                lastRebuildAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log("✅ [Platform Analysis Hourly] 갱신 완료");
        } catch (e) {
            console.error("❌ [Platform Analysis Hourly] 실패:", e.stack || e.message);
            await sendSyncAlert("scheduledPlatformAnalysisHourly failed", [e.stack || e.message]);
        }
    });

    const scheduledPaxOccupancyReport = onSchedule({
        schedule: "50 8 * * *",
        timeZone: "Asia/Tokyo",
        timeoutSeconds: 540,
        memory: "1GiB"
    }, async () => {
        try {
            await assertReservationDataReady("scheduledPaxOccupancyReport");
            const result = await runPaxOccupancyReport();
            console.log(`✅ [PAX Occupancy] Updated ${result.sheetTitle} (${result.start}~${result.end}) rows=${result.rowCount}`);
            if (NOTION_PAGES.paxOccupancy) {
                const tokyoNow = dayjs().tz("Asia/Tokyo");
                await syncNotionPaxOccupancy(NOTION_PAGES.paxOccupancy, {
                    title: `인원현황 ${result.sheetTitle || ""}`,
                    tokyoNow,
                    summaryText: `${result.sheetTitle || "PAX"} 시트 갱신됨 (${result.start || ""}~${result.end || ""}, ${result.rowCount ?? 0}행)`,
                    paxData: result.paxDataForNotion || null
                });
            }
        } catch (e) {
            console.error("❌ [PAX Occupancy] failed:", e.stack || e.message);
            await sendSyncAlert("scheduledPaxOccupancyReport failed", [e.stack || e.message]);
            throw e;
        }
    });

    const scheduledMonthlyBriefingSetup = onSchedule({
        schedule: "0 6 1 * *", // 매월 1일 06:00 JST
        timeZone: "Asia/Tokyo",
        timeoutSeconds: 300,
        memory: "256MiB"
    }, async () => {
        try {
            const spreadsheetId = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
            const tokyoNow = dayjs().tz("Asia/Tokyo");
            const year = tokyoNow.year();
            const month = tokyoNow.month() + 1;
            const monthPad = String(month).padStart(2, "0");
            const briefingTitle = `${month}월브리핑`;

            console.log(`📅 [Monthly Briefing] ${year}년 ${month}월 브리핑 시트 자동 생성 시작...`);

            const auth = new google.auth.GoogleAuth({
                credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
                scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            });
            const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

            const meta = await sheets.spreadsheets.get({ spreadsheetId });
            const allSheets = meta.data.sheets;
            const existing = allSheets.find(s => s.properties.title === briefingTitle);

            let briefingSheetId;
            if (existing) {
                briefingSheetId = existing.properties.sheetId;
                console.log(`ℹ️  "${briefingTitle}" 이미 존재 — 재적용`);
            } else {
                const res = await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    resource: { requests: [{ addSheet: { properties: { title: briefingTitle, tabColorStyle: { rgbColor: { red: 0.31, green: 0.28, blue: 0.90 } } } } }] }
                });
                briefingSheetId = res.data.replies[0].addSheet.properties.sheetId;
                console.log(`✅ "${briefingTitle}" 생성 완료`);
            }

            const buttons = [
                { label: "📋  일일로그",   color: { red: 0.310, green: 0.275, blue: 0.898 } },
                { label: "❌  취소로그",   color: { red: 0.725, green: 0.110, blue: 0.110 } },
                { label: "📊  플랫폼분석", color: { red: 0.427, green: 0.157, blue: 0.851 } },
                { label: "👥  인원현황",   color: { red: 0.016, green: 0.471, blue: 0.337 } },
            ];

            const requests = buildBriefingDesignRequests(
                briefingSheetId,
                `${month}월 브리핑`,
                `${year}년 ${month}월  ·  예약 현황 데이터 조회`,
                buttons
            );
            await sheets.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests } });

            // 이미 존재하는 해당 월 데이터 시트 숨김 처리
            const dataSheetPrefixes = ["일일로그", "취소로그", "플랫폼분석", "인원현황"];
            const suffix = `_${year}_${monthPad}`;
            const toHide = allSheets.filter(s =>
                dataSheetPrefixes.some(p => s.properties.title.startsWith(p)) &&
                s.properties.title.endsWith(suffix) &&
                !s.properties.hidden
            );
            if (toHide.length > 0) {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    resource: { requests: toHide.map(s => ({ updateSheetProperties: { properties: { sheetId: s.properties.sheetId, hidden: true }, fields: "hidden" } })) }
                });
                toHide.forEach(s => console.log(`👻 숨김: "${s.properties.title}"`));
            }

            console.log(`🎉 [Monthly Briefing] ${briefingTitle} 자동 설정 완료!`);
        } catch (e) {
            console.error("❌ [Monthly Briefing Setup] failed:", e.stack || e.message);
            await sendSyncAlert("scheduledMonthlyBriefingSetup failed", [e.stack || e.message]);
            throw e;
        }
    });

    return {
        runScheduledDailyReport,
        scheduledPlatformAnalysisHourly,
        scheduledPaxOccupancyReport,
        scheduledMonthlyBriefingSetup
    };
}

module.exports = {
    createGoogleSheetReportModule
};
