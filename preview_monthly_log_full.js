const admin = require('firebase-admin');
const { google } = require('googleapis');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const serviceAccount = require('./serviceAccountKey.json');

dayjs.extend(utc);
dayjs.extend(timezone);
const JST = "Asia/Tokyo";

// --- CONFIGURATION ---
const SPREADSHEET_ID = '1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0';
const TARGET_YEAR = 2026;
const TARGET_MONTH = 2;
const SHEET_TITLE = `Daily_Log_${TARGET_YEAR}_${String(TARGET_MONTH).padStart(2, '0')}`;
const SALES_SHEET_TITLE = `Daily_Sales_${TARGET_YEAR}_${String(TARGET_MONTH).padStart(2, '0')}`;

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function previewFullMonthLog() {
    console.log(`\n📅 [Daily Log Full Preview] ${TARGET_YEAR}-${TARGET_MONTH} 월간 전체 일지 생성 시작...`);

    // 1. Fetch ALL Data for the month (Creation/Mod date)
    console.log("   데이터 조회 중 (Limit 5000, Optimized Select)...");
    const snap = await db.collection('reservations')
        .select('bookDate', 'status', 'price', 'building', 'room', 'cancelTime', 'arrival', 'modified', 'updatedAt', 'referer')
        .orderBy('updatedAt', 'desc')
        .limit(5000)
        .get();

    const allDocs = [];
    snap.forEach(doc => allDocs.push(doc.data()));
    console.log(`   데이터 로드 완료: ${allDocs.length}건`);

    // 2. Auth Google Sheets
    const auth = new google.auth.GoogleAuth({
        credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 3. Prepare Sheet (Clear & formatted)
    let sheetId = null;

    try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
        let targetSheet = meta.data.sheets.find(s => s.properties.title === SHEET_TITLE);

        if (!targetSheet) {
            const res = await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { requests: [{ addSheet: { properties: { title: SHEET_TITLE, gridProperties: { frozenRowCount: 1 } } } }] }
            });
            sheetId = res.data.replies[0].addSheet.properties.sheetId;
        } else {
            sheetId = targetSheet.properties.sheetId;
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_TITLE}!A1:Z500`
            });
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: [
                        { updateCells: { range: { sheetId: sheetId }, fields: "userEnteredFormat" } }
                    ]
                }
            });
        }
    } catch (e) {
        console.error("Sheet Init Error:", e);
    }

    // 4. Calculate MTD Summary & Prepare Data Rows
    const rows = [];
    let mtdNew = 0;
    let mtdCancel = 0;
    let mtdRevenue = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const loopStart = new Date(TARGET_YEAR, TARGET_MONTH - 1, 1);

    for (let d = new Date(loopStart); d <= yesterday; d.setDate(d.getDate() + 1)) {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const newBookings = [];
        const cancelledBookings = [];

        allDocs.forEach(data => {
            if (data.building === "다이쿄초") return;
            if (data.referer !== "Airbnb" && data.referer !== "Booking.com") return;

            if (data.bookDate === dateStr && (Number(data.price) || 0) > 0) {
                newBookings.push(data);
            }

            const rawCancelTime = data.status === 'cancelled' ? (data.cancelTime || data.modified || "") : "";
            if (rawCancelTime) {
                const jstCancelDate = dayjs(rawCancelTime).tz(JST).format("YYYY-MM-DD");
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

        let dailyRevenue = 0;
        const buildingMap = {};
        const monthlyBreakdown = {};

        newBookings.forEach(b => {
            const price = Number(b.price) || 0;
            dailyRevenue += price;
            const bd = b.building || "기타";
            if (!buildingMap[bd]) buildingMap[bd] = { count: 0, revenue: 0 };
            buildingMap[bd].count++;
            buildingMap[bd].revenue += price;

            if (b.arrival) {
                const arrMonth = dayjs(b.arrival).format("M월");
                monthlyBreakdown[arrMonth] = (monthlyBreakdown[arrMonth] || 0) + 1;
            } else {
                monthlyBreakdown["미정"] = (monthlyBreakdown["미정"] || 0) + 1;
            }
        });

        let detailLines = [];
        if (newBookings.length > 0) {
            detailLines.push(`[신규] ${Object.entries(buildingMap).map(([bd, info]) => `${bd} ${info.count}건(${info.revenue.toLocaleString()})`).join(", ")}`);
        }
        if (cancelledBookings.length > 0) {
            const cancelMap = {};
            cancelledBookings.forEach(b => {
                const bd = b.building || "기타";
                cancelMap[bd] = (cancelMap[bd] || 0) + 1;
            });
            detailLines.push(`[취소] ${Object.entries(cancelMap).map(([bd, cnt]) => `${bd} ${cnt}건`).join(", ")}`);
        }

        const breakdownStr = Object.entries(monthlyBreakdown).sort((a, b) => (a[0] === "미정" ? 1 : (b[0] === "미정" ? -1 : parseInt(a[0]) - parseInt(b[0])))).map(([m, c]) => `${m} ${c}건`).join(", ");

        rows.push([dateStr, newBookings.length, cancelledBookings.length, dailyRevenue, breakdownStr || "-", detailLines.join("\n") || "-"]);

        mtdNew += newBookings.length;
        mtdCancel += cancelledBookings.length;
        mtdRevenue += dailyRevenue;
    }

    const cancelRate = mtdNew > 0 ? ((mtdCancel / mtdNew) * 100).toFixed(1) + "%" : "0%";
    const dashboard = [
        [`${TARGET_YEAR}년 ${TARGET_MONTH}월 경영 분석 리포트 (MTD)`, "", "", "", "", "작성일: " + new Date().toLocaleDateString()],
        ["누적 신규 예약", "누적 취소 건수", "누적 매출액 (JPY)", "취소율", "", "상태"],
        [mtdNew, mtdCancel, mtdRevenue, cancelRate, "", "정상 운영"],
        ["", "", "", "", "", ""],
        ["날짜", "신규(건)", "취소(건)", "매출액(엔)", "입실 월별 현황", "상세 내역 (건물별)"]
    ];

    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_TITLE}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: dashboard } });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_TITLE}!A6`, valueInputOption: 'USER_ENTERED', resource: { values: rows } });

    const lastRowIndex = 5 + rows.length;

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            requests: [
                { updateSheetProperties: { properties: { sheetId: sheetId, gridProperties: { frozenRowCount: 5 } }, fields: "gridProperties.frozenRowCount" } },
                { updateDimensionProperties: { range: { sheetId: sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: sheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 200 }, fields: "pixelSize" } },
                { updateDimensionProperties: { range: { sheetId: sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: 600 }, fields: "pixelSize" } },
                { repeatCell: { range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.0, green: 0.1, blue: 0.3 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 18 } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
                { mergeCells: { range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 }, mergeType: "MERGE_ALL" } },
                { repeatCell: { range: { sheetId: sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.05, green: 0.2, blue: 0.4 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
                { repeatCell: { range: { sheetId: sheetId, startRowIndex: 5, endRowIndex: lastRowIndex, startColumnIndex: 4, endColumnIndex: 6 }, cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", textFormat: { fontSize: 9 } } }, fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)" } }
            ]
        }
    });

    console.log(`✅ 월간 일지 생성 완료! (${rows.length}일치)`);
}

previewFullMonthLog();
