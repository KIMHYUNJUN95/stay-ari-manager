/**
 * 수동 즉시 실행 스크립트 - scheduledDailyReport 로직 동일
 * 사용법: node run_report_now.js
 */
const admin = require("firebase-admin");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");

dayjs.extend(utc);
dayjs.extend(timezone);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
});
const db = admin.firestore();

const SPREADSHEET_ID = '1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0';

const NAVY       = { red: 0.05, green: 0.12, blue: 0.28 };
const DARK_BLUE  = { red: 0.08, green: 0.22, blue: 0.45 };
const MID_BLUE   = { red: 0.18, green: 0.38, blue: 0.65 };
const LIGHT_BLUE = { red: 0.88, green: 0.93, blue: 1.0  };
const WHITE      = { red: 1.0,  green: 1.0,  blue: 1.0  };
const ROW_ODD    = { red: 0.97, green: 0.98, blue: 1.0  };
const GREEN      = { red: 0.0,  green: 0.42, blue: 0.15 };
const ACCENT_BLUE= { red: 0.1,  green: 0.3,  blue: 0.65 };
const GRAY_TEXT  = { red: 0.3,  green: 0.3,  blue: 0.35 };
const BORDER_MED = { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } };
const BORDER_THIN= { style: "SOLID",        color: { red: 0.75, green: 0.80, blue: 0.90 } };

// STYLE LOCK: 디자인 변경은 이 블록에서만 허용
const REPORT_STYLE_LOCK = Object.freeze({
    fontFamily: "Noto Sans KR",
    daily: Object.freeze({
        rowMin: 28,
        rowMax: 220,
        breakdownLineHeight: 18,
        detailLineHeight: 14,
        dailyColWidth: Object.freeze({ e: 120, f: 500, h: 66, i: 72, j: 68 }),
        rightDataFontSize: 10
    }),
    sales: Object.freeze({
        colDate: 138,
        colMetrics: 118,
        rowHeights: Object.freeze({ title: 52, month: 36, sub: 34, data: 30 }),
        titleFontSize: 18,
        headerFontSize: 12,
        subHeaderFontSize: 11,
        bodyFontSize: 11
    })
});

function assertStyleLock() {
    if (!REPORT_STYLE_LOCK?.fontFamily) throw new Error("STYLE_LOCK 누락: fontFamily");
    if (!REPORT_STYLE_LOCK?.daily?.dailyColWidth?.e) throw new Error("STYLE_LOCK 누락: daily");
    if (!REPORT_STYLE_LOCK?.sales?.rowHeights?.title) throw new Error("STYLE_LOCK 누락: sales");
}

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getBookingAmount(doc) {
  return Number(doc.totalPrice ?? doc.price) || 0;
}

async function run() {
    assertStyleLock();
    const tokyoNow = dayjs().tz("Asia/Tokyo");
    // 날짜 파라미터: node run_report_now.js 2026-02-28 (없으면 어제 기준)
    const targetArg = process.argv[2];
    const reportTarget = targetArg ? dayjs(targetArg).tz("Asia/Tokyo") : tokyoNow.subtract(1, 'day');
    const year = reportTarget.year();
    const month = reportTarget.month() + 1;
    const SHEET_TITLE = `일일로그_${year}_${String(month).padStart(2, '0')}`;
    const CANCEL_SHEET_TITLE = `취소로그_${year}_${String(month).padStart(2, '0')}`;
    const CANCEL_LAYOUT_SCHEMA_VERSION = "cancel_layout_v20260302";
    const CANCEL_LAYOUT_SCHEMA_CELL = "Z1000";
    const SALES_SHEET_TITLE = "매출일지";

    console.log(`\n📅 [Manual Report] ${year}년 ${month}월 실행 시작 → ${SHEET_TITLE}`);

    // 1. Firestore 데이터 조회 (범위 기반 + 중복 제거)
    console.log("   Firestore 조회 중...");
    const loopStart = reportTarget.startOf('month');
    const yesterday = reportTarget;
    const reportStartDate = loopStart.format("YYYY-MM-DD");
    const reportEndDate = yesterday.format("YYYY-MM-DD");
    const reportStartIso = loopStart.startOf("day").toISOString();
    const reportEndIso = yesterday.endOf("day").toISOString();

    const selectedFields = ['id', 'bookId', 'bookDate', 'status', 'price', 'totalPrice', 'building', 'room', 'cancelTime', 'arrival', 'departure', 'modified', 'updatedAt', 'referer'];
    const [bookedSnap, cancelSnap, modifiedSnap] = await Promise.all([
        db.collection('reservations')
            .where('bookDate', '>=', reportStartDate)
            .where('bookDate', '<=', reportEndDate)
            .select(...selectedFields)
            .get(),
        db.collection('reservations')
            .where('cancelTime', '>=', reportStartIso)
            .where('cancelTime', '<=', reportEndIso)
            .select(...selectedFields)
            .get(),
        db.collection('reservations')
            .where('modified', '>=', reportStartIso)
            .where('modified', '<=', reportEndIso)
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

    console.log(`   ${allDocs.length}건 로드 완료 (bookDate:${bookedSnap.size}, cancelTime:${cancelSnap.size}, modified:${modifiedSnap.size})`);

    // 2. Google Sheets 인증
    const auth = new google.auth.GoogleAuth({
        credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 3. 시트 준비
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    let targetSheet = meta.data.sheets.find(s => s.properties.title === SHEET_TITLE);
    let sheetId = targetSheet ? targetSheet.properties.sheetId : null;
    if (!targetSheet) {
        const res = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: [{ addSheet: { properties: { title: SHEET_TITLE, tabColorStyle: { rgbColor: { red: 0.27, green: 0.51, blue: 0.93 } } } } }] }
        });
        sheetId = res.data.replies[0].addSheet.properties.sheetId;
        console.log(`   시트 신규 생성: ${SHEET_TITLE}`);
    }

    // 4. 날짜 루프 (1일 ~ 어제)
    const rows = [];
    const cancelRows = [];
    const totalCancelByArrivalMonth = {};
    const buildingRoomMonthCancel = {};
    let mtdNew = 0, mtdCancel = 0, mtdRevenue = 0;

    for (let d = dayjs(loopStart); d.isBefore(yesterday) || d.isSame(yesterday, 'day'); d = d.add(1, 'day')) {
        const dateStr = d.format("YYYY-MM-DD");
        const newBookings = [], cancelledBookings = [];

        allDocs.forEach(data => {
            if (data.building === "다이쿄초") return;
            if (data.referer !== "Airbnb" && data.referer !== "Booking.com") return;

            if (data.status === "confirmed" && data.bookDate === dateStr && getBookingAmount(data) > 0) {
                newBookings.push(data);
            }
            const rawCancelTime = data.status === 'cancelled' ? (data.cancelTime || data.modified || "") : "";
            if (rawCancelTime) {
                const jstCancelDate = dayjs(rawCancelTime).tz("Asia/Tokyo").format("YYYY-MM-DD");
                if (jstCancelDate === dateStr) {
                    if (data.arrival) {
                        const arrDate = dayjs(data.arrival);
                        const rptDate = dayjs(dateStr);
                        if (arrDate.isAfter(rptDate.subtract(6, 'month')) && arrDate.isBefore(rptDate.add(6, 'month'))) {
                            cancelledBookings.push(data);
                        }
                    } else {
                        cancelledBookings.push(data);
                    }
                }
            }
        });

        const dailyRevenue = newBookings.reduce((sum, b) => sum + getBookingAmount(b), 0);

        // 입실 월별 현황
        const monthlyBreakdown = {};
        newBookings.forEach(b => {
            const key = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
            monthlyBreakdown[key] = (monthlyBreakdown[key] || 0) + 1;
        });

        const breakdownStr = Object.entries(monthlyBreakdown)
            .sort((a, b) => {
                if (a[0] === "미정") return 1;
                if (b[0] === "미정") return -1;
                return parseInt(a[0]) - parseInt(b[0]);
            })
            .map(([m, count]) => `${m} · ${count}건`)
            .join("\n");

        // 건물별 상세
        const buildingMap = {};
        newBookings.forEach(b => {
            const bd = b.building || "기타";
            if (!buildingMap[bd]) buildingMap[bd] = { count: 0, rev: 0 };
            buildingMap[bd].count++;
            buildingMap[bd].rev += getBookingAmount(b);
        });

        const detailLines = [];
        if (newBookings.length > 0) {
            detailLines.push(`[신규] ${Object.entries(buildingMap).map(([bd, info]) => `${bd} ${info.count}건 (¥${info.rev.toLocaleString()})`).join("  /  ")}`);
        }
        if (cancelledBookings.length > 0) {
            const cMap = {};
            cancelledBookings.forEach(b => { cMap[b.building || "기타"] = (cMap[b.building || "기타"] || 0) + 1; });
            detailLines.push(`[취소] ${Object.entries(cMap).map(([bd, cnt]) => `${bd} ${cnt}건`).join("  /  ")}`);
        }

        rows.push([
            dateStr,
            newBookings.length,
            cancelledBookings.length,
            dailyRevenue,
            breakdownStr || "-",
            detailLines.join("\n") || "-"
        ]);
        mtdNew += newBookings.length;
        mtdCancel += cancelledBookings.length;
        mtdRevenue += dailyRevenue;

        // 취소분석 리포트용
        const cancelMonthlyBreakdown = {};
        cancelledBookings.forEach(b => {
            const key = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
            cancelMonthlyBreakdown[key] = (cancelMonthlyBreakdown[key] || 0) + 1;
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
        cancelledBookings.forEach(b => {
            const bd = b.building || "기타";
            const rm = b.room || "-";
            if (!cancelDetailMap[bd]) cancelDetailMap[bd] = {};
            cancelDetailMap[bd][rm] = (cancelDetailMap[bd][rm] || 0) + 1;
        });
        const cancelDetailStr = Object.entries(cancelDetailMap)
            .map(([bd, rooms]) => `${bd}(${Object.entries(rooms).map(([r, n]) => `${r} ${n}건`).join(", ")})`)
            .join(" / ");
        cancelRows.push([dateStr, cancelledBookings.length, cancelBreakdownStr, cancelDetailStr ? `[취소] ${cancelDetailStr}` : "-"]);
        cancelledBookings.forEach(b => {
            const arrMonth = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
            totalCancelByArrivalMonth[arrMonth] = (totalCancelByArrivalMonth[arrMonth] || 0) + 1;
            const bd = b.building || "기타";
            const rm = b.room || "-";
            if (!buildingRoomMonthCancel[bd]) buildingRoomMonthCancel[bd] = {};
            if (!buildingRoomMonthCancel[bd][rm]) buildingRoomMonthCancel[bd][rm] = {};
            buildingRoomMonthCancel[bd][rm][arrMonth] = (buildingRoomMonthCancel[bd][rm][arrMonth] || 0) + 1;
        });

        if (newBookings.length > 0) console.log(`   ${dateStr}: 신규 ${newBookings.length}건 | ${breakdownStr.replace(/\n/g, ', ')}`);
    }

    // 5-0. MTD 입실 월별 누적 집계 (오른쪽 요약 테이블용)
    const totalMonthly = {};
    allDocs.forEach(data => {
        if (data.building === "다이쿄초") return;
        if (data.referer !== "Airbnb" && data.referer !== "Booking.com") return;
        if (data.status === "confirmed" &&
            data.bookDate >= loopStart.format("YYYY-MM-DD") &&
            data.bookDate <= yesterday.format("YYYY-MM-DD") &&
            getBookingAmount(data) > 0) {
            const key = data.arrival ? dayjs(data.arrival).tz("Asia/Tokyo").format("M월") : "미정";
            totalMonthly[key] = (totalMonthly[key] || 0) + 1;
        }
    });
    const totalMonthlyCount = Object.values(totalMonthly).reduce((s, c) => s + c, 0);
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
    if (totalMonthly["미정"]) {
        normalizedMonthly["미정"] = totalMonthly["미정"];
    }

    const monthlySummaryRows = Object.entries(normalizedMonthly).map(([m, cnt]) => [
        m,
        cnt,
        totalMonthlyCount > 0 ? cnt / totalMonthlyCount : 0
    ]);
    if (monthlySummaryRows.length === 0) {
        monthlySummaryRows.push(["-", 0, 0]);
    }
    monthlySummaryRows.push(["합계", totalMonthlyCount, totalMonthlyCount > 0 ? 1.0 : 0]);
    const rightTableLastRow = 5 + monthlySummaryRows.length;

    // 5. 대시보드 + 데이터 쓰기
    const cancelRate = mtdNew > 0 ? mtdCancel / mtdNew : 0; // 소수(0.369)로 저장 → % 서식 적용
    const dashboard = [
        [`📋  ${year}년 ${month}월 경영 분석 리포트 (MTD)`, "", "", "", "", `최종업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | 갱신주기: 매일 08:45 (JST)`],
        ["누적 신규 예약", "누적 취소 건수", "취소율", "누적 매출액 (JPY)", "", "운영 상태"],
        [mtdNew, mtdCancel, cancelRate, mtdRevenue, "", "✅ 정상"],
        ["", "", "", "", "", ""],
        ["날짜", "신규(건)", "취소(건)", "매출액(엔)", "입실 월별 현황", "상세 내역 (건물별)"]
    ];

    // 오른쪽 요약 테이블 데이터 (H열 = index 7, G열은 spacer)
    // 행 1~4: 왼쪽 대시보드와 높이 맞춤 (빈 행), 행 5: 헤더, 행 6+: 데이터
    const rightTableHeader = ["📊 입실 월별 누적 현황", "", ""];
    const rightTableColHeader = ["입실 월", "예약 건수", "비율"];
    const rightValues = [
        rightTableHeader,
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
        rightTableColHeader,
        ...monthlySummaryRows
    ];

    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_TITLE}!A1:Z200` });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_TITLE}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: dashboard } });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_TITLE}!A6`, valueInputOption: 'USER_ENTERED', resource: { values: rows } });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_TITLE}!H1`, valueInputOption: 'USER_ENTERED', resource: { values: rightValues } });

    // 6. 행 높이 동적 계산 (내용 잘림 방지)
    const lastRow = 5 + rows.length;
    const rowHeightRequests = [
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 52 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 42 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
    ];
    rows.forEach((row, i) => {
        const breakdownLines = row[4] === '-' ? 1 : row[4].split('\n').length;
        const detailLineCount = row[5] === '-' ? 1 : row[5].split('\n').length;
        const breakdownHeight = 8 + (breakdownLines * REPORT_STYLE_LOCK.daily.breakdownLineHeight);
        const detailHeight = 8 + (detailLineCount * REPORT_STYLE_LOCK.daily.detailLineHeight);
        // E열(입실 월별 현황)을 우선 보장하되 F열(상세 내역)도 함께 반영
        const rowHeight = Math.min(REPORT_STYLE_LOCK.daily.rowMax, Math.max(REPORT_STYLE_LOCK.daily.rowMin, Math.max(breakdownHeight, detailHeight)));
        rowHeightRequests.push({
            updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: 5 + i, endIndex: 6 + i },
                properties: { pixelSize: rowHeight },
                fields: "pixelSize"
            }
        });
    });

    // 7. 서식 전체 적용
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            requests: [
                // ── 기본 설정 ──
                { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 5 } }, fields: "gridProperties.frozenRowCount" } },

                // ── 열 너비 ──
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 110 }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 90  }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 90  }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 185 }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.e }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.f }, fields: "pixelSize" } },

                // ── 타이틀 행 (Row 1) ──
                { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 } } },
                { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } },
                { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(lastRow, rightTableLastRow), startColumnIndex: 0, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { textFormat: { fontFamily: REPORT_STYLE_LOCK.fontFamily } } },
                    fields: "userEnteredFormat.textFormat.fontFamily" } },
                { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 },
                    cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 17, fontFamily: "Arial" }, verticalAlignment: "MIDDLE", horizontalAlignment: "LEFT" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },
                { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 },
                    cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: { red: 0.7, green: 0.8, blue: 1.0 }, fontSize: 9, italic: true }, verticalAlignment: "MIDDLE", horizontalAlignment: "RIGHT" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },

                // ── MTD 지표 헤더 (Row 2) ──
                { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 },
                    cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { foregroundColor: DARK_BLUE, bold: true, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },

                // ── MTD 지표 값 (Row 3) ──
                { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 4 },
                    cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: true, fontSize: 18, foregroundColor: DARK_BLUE }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                // C열(index 2): 취소율 → % 서식
                { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 2, endColumnIndex: 3 },
                    cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, textFormat: { bold: true, fontSize: 18, foregroundColor: { red: 0.8, green: 0.2, blue: 0.1 } } } },
                    fields: "userEnteredFormat(numberFormat,textFormat)" } },
                // D열(index 3): 누적 매출액 → 통화 서식
                { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 3, endColumnIndex: 4 },
                    cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "¥#,##0" }, textFormat: { bold: true, fontSize: 16, foregroundColor: GREEN } } },
                    fields: "userEnteredFormat(numberFormat,textFormat)" } },
                { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 4, endColumnIndex: 6 },
                    cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: true, fontSize: 14, foregroundColor: GREEN }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },

                // ── 빈 구분 행 (Row 4) ──
                { repeatCell: { range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 6 },
                    cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.97, blue: 0.99 } } },
                    fields: "userEnteredFormat.backgroundColor" } },

                // ── 컬럼 헤더 (Row 5) ──
                { repeatCell: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 },
                    cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },

                // ── 데이터 행 기본 (홀수: 흰색) ──
                { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 },
                    cell: { userEnteredFormat: { backgroundColor: WHITE, verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER", textFormat: { fontSize: 10 } } },
                    fields: "userEnteredFormat(backgroundColor,verticalAlignment,horizontalAlignment,textFormat)" } },

                // ── 데이터 행 짝수: 연한 파랑 ──
                ...rows.map((_, i) => i % 2 === 1 ? {
                    repeatCell: { range: { sheetId, startRowIndex: 6 + i, endRowIndex: 7 + i, startColumnIndex: 0, endColumnIndex: 6 },
                        cell: { userEnteredFormat: { backgroundColor: ROW_ODD } },
                        fields: "userEnteredFormat.backgroundColor" }
                } : null).filter(Boolean),

                // ── 매출액 컬럼 통화 서식 + 초록 볼드 ──
                { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 3, endColumnIndex: 4 },
                    cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColor: GREEN }, numberFormat: { type: "CURRENCY", pattern: "¥#,##0" } } },
                    fields: "userEnteredFormat(textFormat,numberFormat)" } },

                // ── 입실 월별 현황 (E열): 파란 볼드, 가운데, 줄바꿈 ──
                { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 4, endColumnIndex: 5 },
                    cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", horizontalAlignment: "CENTER",
                        textFormat: { fontSize: 11, bold: true, foregroundColor: ACCENT_BLUE } } },
                    fields: "userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment,textFormat)" } },

                // ── 상세 내역 (F열): 작은 글씨, 상단 정렬, 줄바꿈 ──
                { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 5, endColumnIndex: 6 },
                    cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "MIDDLE",
                        textFormat: { fontSize: 9, foregroundColor: GRAY_TEXT } } },
                    fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)" } },

                // ── 테두리: 전체 외곽 (굵게) ──
                { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 },
                    top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED } },

                // ── 테두리: 헤더 아래 구분선 ──
                { updateBorders: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 },
                    bottom: BORDER_MED } },

                // ── 테두리: 데이터 행 내부 (얇게) ──
                { updateBorders: { range: { sheetId, startRowIndex: 5, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 },
                    innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },

                // ── 테두리: MTD 대시보드 구역 ──
                { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 6 },
                    innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },

                // ── G열: spacer ──
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: 24 }, fields: "pixelSize" } },
                // ── 오른쪽 데이터 영역 병합 해제 (잔존 merge로 값 가림 방지) ──
                { unmergeCells: { range: { sheetId, startRowIndex: 5, endRowIndex: Math.max(lastRow, rightTableLastRow), startColumnIndex: 7, endColumnIndex: 10 } } },

                // ── H~J열 너비 (오른쪽 요약 테이블) ──
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.h }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 9 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.i }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.j }, fields: "pixelSize" } },

                // ── 오른쪽 타이틀 (H1:J1) ──
                { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 10 } } },
                { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 10 }, mergeType: "MERGE_ALL" } },
                { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 7, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 12, fontFamily: "Arial" }, verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)" } },

                // ── 오른쪽 행 2~4: 왼쪽 대시보드 맞춤 배경 ──
                { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE } }, fields: "userEnteredFormat.backgroundColor" } },
                { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 4, startColumnIndex: 7, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { backgroundColor: WHITE } }, fields: "userEnteredFormat.backgroundColor" } },

                // ── 오른쪽 컬럼 헤더 (H5:J5) ──
                { repeatCell: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },

                // ── 오른쪽 데이터 행 ──
                { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { backgroundColor: WHITE, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { fontSize: REPORT_STYLE_LOCK.daily.rightDataFontSize } } },
                    fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } },

                // ── 오른쪽 짝수 행 배색 ──
                ...monthlySummaryRows.map((_, i) => i % 2 === 1 ? {
                    repeatCell: { range: { sheetId, startRowIndex: 6 + i, endRowIndex: 7 + i, startColumnIndex: 7, endColumnIndex: 10 },
                        cell: { userEnteredFormat: { backgroundColor: ROW_ODD } }, fields: "userEnteredFormat.backgroundColor" }
                } : null).filter(Boolean),

                // ── 오른쪽 합계 행: 볼드 + 배경 강조 ──
                { repeatCell: { range: { sheetId, startRowIndex: rightTableLastRow - 1, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { bold: true, fontSize: 11, foregroundColor: DARK_BLUE } } },
                    fields: "userEnteredFormat(backgroundColor,textFormat)" } },

                // ── 오른쪽 비율 열 (J = index 9): % 서식 ──
                { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: rightTableLastRow, startColumnIndex: 9, endColumnIndex: 10 },
                    cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } },
                    fields: "userEnteredFormat.numberFormat" } },

                // ── 오른쪽 월 이름 (H열): 파란 볼드 ──
                { repeatCell: { range: { sheetId, startRowIndex: 5, endRowIndex: rightTableLastRow - 1, startColumnIndex: 7, endColumnIndex: 8 },
                    cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: ACCENT_BLUE } } },
                    fields: "userEnteredFormat.textFormat" } },

                // ── 오른쪽 테두리 ──
                { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 },
                    top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED,
                    innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
                { updateBorders: { range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 10 },
                    bottom: BORDER_MED } },
                { updateBorders: { range: { sheetId, startRowIndex: rightTableLastRow - 1, endRowIndex: rightTableLastRow, startColumnIndex: 7, endColumnIndex: 10 },
                    top: BORDER_MED } },

                ...rowHeightRequests,
            ]
        }
    });

    // 7-2. 취소분석 리포트 시트 생성/업데이트
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
    if (totalCancelByArrivalMonth["미정"]) {
        normalizedCancelMonthly["미정"] = totalCancelByArrivalMonth["미정"];
    }
    const cancelSummaryRows = Object.entries(normalizedCancelMonthly).map(([m, cnt]) => [
        m,
        cnt,
        totalCancelCount > 0 ? cnt / totalCancelCount : 0
    ]);
    if (cancelSummaryRows.length === 0) {
        cancelSummaryRows.push(["-", 0, 0]);
    }
    cancelSummaryRows.push(["합계", totalCancelCount, totalCancelCount > 0 ? 1.0 : 0]);
    const cancelRightTableLastRow = 5 + cancelSummaryRows.length;

    // 6) 건물별/객실별 취소율 요약 (취소율 내림차순)
    const roomStatsByBuilding = {};
    const periodStartStr = loopStart.format("YYYY-MM-DD");
    const periodEndStr = yesterday.format("YYYY-MM-DD");
    const periodStart = dayjs(periodStartStr);
    const periodEnd = dayjs(periodEndStr);

    // 예약건수(분모): 경영분석 신규 예약 로직과 동일 (confirmed + bookDate 기준)
    allDocs.forEach((data) => {
        if (data.building === "다이쿄초") return;
        if (data.referer !== "Airbnb" && data.referer !== "Booking.com") return;
        if (!data.bookDate || data.bookDate < periodStartStr || data.bookDate > periodEndStr) return;
        if (getBookingAmount(data) <= 0) return;
        if (data.status !== "confirmed") return;

        const bd = data.building || "기타";
        const rm = data.room || "-";
        if (!roomStatsByBuilding[bd]) roomStatsByBuilding[bd] = {};
        if (!roomStatsByBuilding[bd][rm]) roomStatsByBuilding[bd][rm] = { reserved: 0, cancelled: 0 };
        roomStatsByBuilding[bd][rm].reserved += 1;
    });

    // 취소건수(분자): 조회 기간 내 취소(cancelTime JST) + 기존 취소 리포트 동일 조건
    allDocs.forEach((data) => {
        if (data.building === "다이쿄초") return;
        if (data.referer !== "Airbnb" && data.referer !== "Booking.com") return;
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
                    const sortRate = stat.reserved > 0 ? rate : 1; // 예약모수 0인데 취소 발생한 객실은 우선 노출
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

    const roomRateSectionStartRow = Math.max(31, (5 + cancelRows.length) + 2, cancelRightTableLastRow + 2);
    const blockWidth = 5; // 4 cols + 1 gap
    const dataColsPerBlock = 4;
    const maxRowsPerBuilding = Math.max(1, ...buildingRateSections.map((s) => s.rows.length));
    const matrixRowCount = 2 + maxRowsPerBuilding; // 건물명 + 헤더 + 데이터
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

    const metaForCancel = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    let cancelSheetId = null;
    let cancelSheet = metaForCancel.data.sheets.find(s => s.properties.title === CANCEL_SHEET_TITLE);
    let shouldRecreateCancelSheet = false;

    if (cancelSheet) {
        const schemaRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${CANCEL_SHEET_TITLE}!${CANCEL_LAYOUT_SCHEMA_CELL}`
        });
        const currentSchema = schemaRes.data.values?.[0]?.[0] || "";
        shouldRecreateCancelSheet = currentSchema !== CANCEL_LAYOUT_SCHEMA_VERSION;
        if (shouldRecreateCancelSheet) {
            console.log(`   취소 시트 스키마 변경 감지 → 재생성 (${currentSchema || "none"} -> ${CANCEL_LAYOUT_SCHEMA_VERSION})`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { requests: [{ deleteSheet: { sheetId: cancelSheet.properties.sheetId } }] }
            });
            cancelSheet = null;
        }
    }

    if (!cancelSheet) {
        const addRes = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: [{ addSheet: { properties: { title: CANCEL_SHEET_TITLE, tabColorStyle: { rgbColor: { red: 0.90, green: 0.22, blue: 0.22 } }, gridProperties: { frozenRowCount: 5, frozenColumnCount: 0 } } } }] }
        });
        cancelSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    } else {
        cancelSheetId = cancelSheet.properties.sheetId;
    }
    // 레이아웃 고정용 초기화: 이전 실행 잔여 병합/테두리/배경 제거
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
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
    const rightStartCol = 4; // E열
    const rightEndCol = rightStartCol + 3; // H열 전
    const cancelRightValues = [
        ["📊 입실월별 취소 현황", "", ""],
        ["", "", ""], ["", "", ""], ["", "", ""],
        ["입실 월", "취소 건수", "비율"],
        ...cancelSummaryRows
    ];
    const cancelLastRow = 5 + cancelRows.length;
    const detailColCount = 12;
    const buildingSectionEnd = cancelRightTableLastRow;
    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${CANCEL_SHEET_TITLE}!A1:AZ1200` });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${CANCEL_SHEET_TITLE}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: cancelDashboard } });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${CANCEL_SHEET_TITLE}!A6`, valueInputOption: 'USER_ENTERED', resource: { values: cancelRows } });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${CANCEL_SHEET_TITLE}!E1`, valueInputOption: 'USER_ENTERED', resource: { values: cancelRightValues } });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CANCEL_SHEET_TITLE}!A${roomRateSectionStartRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [roomRateTitleRow, ...roomRateMatrix] }
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CANCEL_SHEET_TITLE}!${CANCEL_LAYOUT_SCHEMA_CELL}`,
        valueInputOption: 'RAW',
        resource: { values: [[CANCEL_LAYOUT_SCHEMA_VERSION]] }
    });

    const cancelRowHeightRequests = [
        { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 52 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 42 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
    ];
    cancelRows.forEach((row, i) => {
        const breakdownLines = row[2] === '-' ? 1 : row[2].split('\n').length;
        const detailLineCount = row[3] === '-' ? 1 : row[3].split('\n').length;
        const breakdownHeight = 8 + (breakdownLines * REPORT_STYLE_LOCK.daily.breakdownLineHeight);
        const detailHeight = 8 + (detailLineCount * REPORT_STYLE_LOCK.daily.detailLineHeight);
        cancelRowHeightRequests.push({ updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "ROWS", startIndex: 5 + i, endIndex: 6 + i }, properties: { pixelSize: Math.min(REPORT_STYLE_LOCK.daily.rowMax, Math.max(REPORT_STYLE_LOCK.daily.rowMin, Math.max(breakdownHeight, detailHeight))) }, fields: "pixelSize" } });
    });

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            requests: [
                { updateSheetProperties: { properties: { sheetId: cancelSheetId, gridProperties: { frozenRowCount: 5 } }, fields: "gridProperties.frozenRowCount" } },
                { unmergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1200, startColumnIndex: 0, endColumnIndex: 52 } } },
                { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 102 }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 72 }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.f }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.h }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.i }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: cancelSheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: REPORT_STYLE_LOCK.daily.dailyColWidth.j }, fields: "pixelSize" } },
                { unmergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 } } },
                { mergeCells: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: "MERGE_ALL" } },
                { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 0, endRowIndex: Math.max(cancelRightTableLastRow, roomRateSectionStartRow + 1 + matrixRowCount, buildingSectionEnd), startColumnIndex: 0, endColumnIndex: Math.max(12, detailColCount, roomRateTotalCols) }, cell: { userEnteredFormat: { textFormat: { fontFamily: REPORT_STYLE_LOCK.fontFamily } } }, fields: "userEnteredFormat.textFormat.fontFamily" } },
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
                { repeatCell: { range: { sheetId: cancelSheetId, startRowIndex: 5, endRowIndex: cancelRightTableLastRow, startColumnIndex: rightStartCol, endColumnIndex: rightEndCol }, cell: { userEnteredFormat: { backgroundColor: WHITE, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { fontSize: REPORT_STYLE_LOCK.daily.rightDataFontSize } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } },
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
                // 하단 건물별 객실 취소율 요약 블록
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
                ...cancelRowHeightRequests,
            ]
        }
    });
    console.log(`✅ [Manual Report] 취소 분석 리포트(${CANCEL_SHEET_TITLE}) 업데이트 완료.`);

    // 8. Daily Sales(매출 일지) 탭 업데이트 - 단일 시트에 월별 블록 누적
    console.log(`\n📈 [Manual Report] ${SALES_SHEET_TITLE} 업데이트 시작...`);
    const salesSnap = await db.collection("sales_logs")
        .where("__name__", ">=", loopStart.format("YYYY-MM-DD"))
        .where("__name__", "<=", tokyoNow.format("YYYY-MM-DD"))
        .get();

    const salesLogs = {};
    salesSnap.forEach((doc) => {
        salesLogs[doc.id] = doc.data();
    });

    let salesSheetId = null;
    const metaAfterDaily = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existingSalesSheet = metaAfterDaily.data.sheets.find((s) => s.properties.title === SALES_SHEET_TITLE);
    if (!existingSalesSheet) {
        const addRes = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: [{ addSheet: { properties: { title: SALES_SHEET_TITLE, tabColorStyle: { rgbColor: { red: 0.20, green: 0.66, blue: 0.33 } } } } }] }
        });
        salesSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    } else {
        salesSheetId = existingSalesSheet.properties.sheetId;
    }

    const projectionMonths = [];
    for (let i = 0; i < 6; i++) {
        projectionMonths.push(loopStart.add(i, "month").format("YYYY-MM"));
    }

    const monthTitle = `📊 [${year}년 ${month}월] 매출 일지 (Booking Pace Executive Report)  |  최종업데이트: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | 갱신주기: 매일 08:45 (JST)`;
    const titleRow = [monthTitle, ...Array(12).fill("")];
    const monthHeaderRow = ["기록일", ...projectionMonths.flatMap((m) => [m, ""])];
    const subHeaderRow = ["", ...projectionMonths.flatMap(() => ["매출액 (JPY)", "가동률"])];

    const rawSalesRows = [];
    for (let d = dayjs(loopStart); d.isBefore(tokyoNow) || d.isSame(tokyoNow, "day"); d = d.add(1, "day")) {
        const dStr = d.format("YYYY-MM-DD");
        const log = salesLogs[dStr];
        if (!log || !log.monthlyStats) continue;

        const row = [dStr];
        projectionMonths.forEach((pm) => {
            const stat = log.monthlyStats[pm] || { revenue: 0, occupancy: 0 };
            row.push(stat.revenue || 0);
            row.push((stat.occupancy || 0) / 100);
        });
        rawSalesRows.push(row);
    }

    let salesRows = rawSalesRows;
    if (rawSalesRows.length > 1) {
        const baseSig = rawSalesRows[0].slice(1).join("|");
        let firstChangedIndex = rawSalesRows.length - 1;
        for (let i = 1; i < rawSalesRows.length; i++) {
            const sig = rawSalesRows[i].slice(1).join("|");
            if (sig !== baseSig) {
                firstChangedIndex = i;
                break;
            }
        }
        if (firstChangedIndex > 0) {
            salesRows = rawSalesRows.slice(firstChangedIndex);
            console.log(`   중복 프리픽스 ${firstChangedIndex}행 제거 (기록 시작일: ${salesRows[0][0]})`);
        }
    }

    if (salesRows.length > 0) {
        const colA = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
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
            targetStartRow = lastNonEmpty === 0 ? 1 : lastNonEmpty + 2; // 1줄 공백 후 새 월 블록
        }

        const blockHeight = 3 + salesRows.length;
        const start0 = targetStartRow - 1;
        const end0 = start0 + blockHeight;

        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SALES_SHEET_TITLE}!A${targetStartRow}:M${targetStartRow + blockHeight + 2}`
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SALES_SHEET_TITLE}!A${targetStartRow}`,
            valueInputOption: "USER_ENTERED",
            resource: { values: [titleRow, monthHeaderRow, subHeaderRow, ...salesRows] }
        });

        const salesStyleRequests = [
            { unmergeCells: { range: { sheetId: salesSheetId, startRowIndex: start0, endRowIndex: end0 + 1, startColumnIndex: 0, endColumnIndex: 13 } } },
            { mergeCells: { range: { sheetId: salesSheetId, startRowIndex: start0, endRowIndex: start0 + 1, startColumnIndex: 0, endColumnIndex: 13 }, mergeType: "MERGE_ALL" } },
            ...projectionMonths.map((_, i) => ({
                mergeCells: { range: { sheetId: salesSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 2, startColumnIndex: 1 + i * 2, endColumnIndex: 3 + i * 2 }, mergeType: "MERGE_ALL" }
            })),
            { mergeCells: { range: { sheetId: salesSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 3, startColumnIndex: 0, endColumnIndex: 1 }, mergeType: "MERGE_ALL" } },
            { updateDimensionProperties: { range: { sheetId: salesSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: REPORT_STYLE_LOCK.sales.colDate }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: salesSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 13 }, properties: { pixelSize: REPORT_STYLE_LOCK.sales.colMetrics }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: salesSheetId, dimension: "ROWS", startIndex: start0, endIndex: start0 + 1 }, properties: { pixelSize: REPORT_STYLE_LOCK.sales.rowHeights.title }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: salesSheetId, dimension: "ROWS", startIndex: start0 + 1, endIndex: start0 + 2 }, properties: { pixelSize: REPORT_STYLE_LOCK.sales.rowHeights.month }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: salesSheetId, dimension: "ROWS", startIndex: start0 + 2, endIndex: start0 + 3 }, properties: { pixelSize: REPORT_STYLE_LOCK.sales.rowHeights.sub }, fields: "pixelSize" } },
            { updateDimensionProperties: { range: { sheetId: salesSheetId, dimension: "ROWS", startIndex: start0 + 3, endIndex: end0 }, properties: { pixelSize: REPORT_STYLE_LOCK.sales.rowHeights.data }, fields: "pixelSize" } },

            { repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0, endRowIndex: end0, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { textFormat: { fontFamily: REPORT_STYLE_LOCK.fontFamily } } }, fields: "userEnteredFormat.textFormat.fontFamily" } },
            { repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0, endRowIndex: start0 + 1, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { foregroundColor: WHITE, bold: true, fontSize: REPORT_STYLE_LOCK.sales.titleFontSize }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 2, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: DARK_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: REPORT_STYLE_LOCK.sales.headerFontSize }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0 + 2, endRowIndex: start0 + 3, startColumnIndex: 1, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: LIGHT_BLUE, textFormat: { foregroundColor: DARK_BLUE, bold: true, fontSize: REPORT_STYLE_LOCK.sales.subHeaderFontSize }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0 + 1, endRowIndex: start0 + 3, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: MID_BLUE, textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },

            { repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: WHITE, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { fontSize: REPORT_STYLE_LOCK.sales.bodyFontSize, foregroundColor: DARK_BLUE } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } },
            ...salesRows.map((_, i) => (i % 2 === 1 ? {
                repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0 + 4 + i, endRowIndex: start0 + 5 + i, startColumnIndex: 0, endColumnIndex: 13 }, cell: { userEnteredFormat: { backgroundColor: ROW_ODD } }, fields: "userEnteredFormat.backgroundColor" }
            } : null)).filter(Boolean),
            { repeatCell: { range: { sheetId: salesSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 1, endColumnIndex: 13 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } },
            ...projectionMonths.map((_, i) => ({
                repeatCell: {
                    range: { sheetId: salesSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 2 + i * 2, endColumnIndex: 3 + i * 2 },
                    cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" }, textFormat: { foregroundColor: ACCENT_BLUE, bold: true } } },
                    fields: "userEnteredFormat(numberFormat,textFormat)"
                }
            })),
            ...projectionMonths.map((_, i) => ({
                repeatCell: {
                    range: { sheetId: salesSheetId, startRowIndex: start0 + 3, endRowIndex: end0, startColumnIndex: 1 + i * 2, endColumnIndex: 2 + i * 2 },
                    cell: { userEnteredFormat: { textFormat: { foregroundColor: GREEN, bold: true } } },
                    fields: "userEnteredFormat.textFormat"
                }
            })),
            { updateBorders: { range: { sheetId: salesSheetId, startRowIndex: start0, endRowIndex: end0, startColumnIndex: 0, endColumnIndex: 13 }, top: BORDER_MED, bottom: BORDER_MED, left: BORDER_MED, right: BORDER_MED, innerHorizontal: BORDER_THIN, innerVertical: BORDER_THIN } },
            { updateBorders: { range: { sheetId: salesSheetId, startRowIndex: start0 + 2, endRowIndex: start0 + 3, startColumnIndex: 0, endColumnIndex: 13 }, bottom: BORDER_MED } },
        ];
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: salesStyleRequests }
        });
    }

    console.log(`\n✅ 완료! ${SHEET_TITLE} 업데이트 (${rows.length}일치, MTD 신규 ${mtdNew}건 / 취소 ${mtdCancel}건 / 매출 ¥${mtdRevenue.toLocaleString()})`);
    console.log(`✅ 완료! ${CANCEL_SHEET_TITLE} 업데이트 (누적 취소 ${totalCancelCount}건)`);
    console.log(`✅ 완료! ${SALES_SHEET_TITLE} 업데이트 (${salesRows.length}행)`);
    process.exit(0);
}

run().catch(e => {
    console.error("❌ 실패:", e.message);
    process.exit(1);
});
