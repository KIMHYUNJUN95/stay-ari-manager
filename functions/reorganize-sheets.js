/**
 * reorganize-sheets.js
 * 구글 시트 탭 재구성 스크립트
 *
 * 실행: node functions/reorganize-sheets.js
 * 롤백: node functions/rollback-sheets.js
 *
 * 결과: 매출일지 | 2월브리핑 | 3월브리핑
 *   - 2월브리핑: 일일로그_2026_02, 취소로그_2026_02 버튼
 *   - 3월브리핑: 일일로그_2026_03, 취소로그_2026_03, 플랫폼분석_2026_03, 인원현황_2026_03 버튼
 *   - 월별 시트들은 숨김 (삭제 아님 — 롤백 가능)
 */

const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");
const fs = require("fs");
const path = require("path");

const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const SNAPSHOT_PATH = path.join(__dirname, "sheets_snapshot.json");

// 앱 디자인 색상 체계
const C = {
    indigo:    { red: 0.310, green: 0.275, blue: 0.898 }, // #4F46E5
    darkSlate: { red: 0.075, green: 0.110, blue: 0.200 }, // 헤더 배경
    red:       { red: 0.863, green: 0.149, blue: 0.149 }, // #DC2626
    purple:    { red: 0.486, green: 0.227, blue: 0.929 }, // #7C3AED
    teal:      { red: 0.020, green: 0.588, blue: 0.412 }, // #059669
    white:     { red: 1,     green: 1,     blue: 1     },
    lightBg:   { red: 0.945, green: 0.961, blue: 0.980 }, // #F1F5F9
    subText:   { red: 0.620, green: 0.710, blue: 0.800 }, // 서브타이틀 색
};

async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: serviceAccount.client_email,
            private_key: serviceAccount.private_key,
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await auth.getClient();
    return google.sheets({ version: "v4", auth: client });
}

async function ensureSheet(sheets, title, tabColor) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existing = meta.data.sheets.find(s => s.properties.title === title);
    if (existing) {
        console.log(`   ↩️  "${title}" 이미 존재 — 재사용 (기존 내용 덮어씀)`);
        return existing.properties.sheetId;
    }
    const res = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            requests: [{
                addSheet: {
                    properties: {
                        title,
                        tabColorStyle: { rgbColor: tabColor }
                    }
                }
            }]
        }
    });
    const sheetId = res.data.replies[0].addSheet.properties.sheetId;
    console.log(`   ✅ "${title}" 생성 (sheetId: ${sheetId})`);
    return sheetId;
}

/**
 * 브리핑 시트 포맷 요청 빌드
 * 레이아웃:
 *   Row 0 (52px): 타이틀 헤더 (전체 병합)
 *   Row 1 (14px): 서브타이틀 (생성일시)
 *   Row 2 (16px): 스페이서
 *   Row 3 (52px): 버튼 행
 *   Row 4 (16px): 스페이서
 *
 * 버튼 컬럼 구조 (0-indexed):
 *   Col 0       : 왼쪽 여백 (20px)
 *   Cols 1-6    : 버튼1 (6cols × 30px = 180px)
 *   Col 7       : 간격 (14px)
 *   Cols 8-13   : 버튼2
 *   Col 14      : 간격
 *   Cols 15-20  : 버튼3
 *   Col 21      : 간격
 *   Cols 22-27  : 버튼4
 *   Col 28      : 오른쪽 여백 (20px)
 */
function buildBriefingRequests(sheetId, titleText, subtitleText, buttons) {
    const BTN_START_COL  = 1;
    const BTN_COLS       = 6;
    const GAP_COLS       = 1;
    const HEADER_END_COL = 29; // cols 0~28

    const HEADER_ROW  = 0;
    const SUB_ROW     = 1;
    const SPACER1_ROW = 2;
    const BTN_ROW     = 3;
    const SPACER2_ROW = 4;

    const reqs = [];

    // ── 컬럼 추가 (기본 26개 → 30개로 확장) ────────────────────────────────
    reqs.push({
        appendDimension: {
            sheetId,
            dimension: "COLUMNS",
            length: 4
        }
    });

    // ── 전체 콘텐츠 초기화 ──────────────────────────────────────────────────
    reqs.push({
        updateCells: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 20, startColumnIndex: 0, endColumnIndex: 30 },
            fields: "userEnteredValue,userEnteredFormat"
        }
    });

    // ── 행 높이 ──────────────────────────────────────────────────────────────
    const rowHeights = [
        { row: HEADER_ROW,  px: 54 },
        { row: SUB_ROW,     px: 26 },
        { row: SPACER1_ROW, px: 16 },
        { row: BTN_ROW,     px: 54 },
        { row: SPACER2_ROW, px: 16 },
    ];
    rowHeights.forEach(({ row, px }) => {
        reqs.push({
            updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: row, endIndex: row + 1 },
                properties: { pixelSize: px },
                fields: "pixelSize"
            }
        });
    });

    // ── 컬럼 너비 ────────────────────────────────────────────────────────────
    // Col 0: 여백
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 20 }, fields: "pixelSize" } });
    // 버튼 + 간격 컬럼들
    for (let i = 0; i < 4; i++) {
        const btnStart = BTN_START_COL + i * (BTN_COLS + GAP_COLS);
        // 버튼 6cols
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: btnStart, endIndex: btnStart + BTN_COLS }, properties: { pixelSize: 30 }, fields: "pixelSize" } });
        // 간격 1col (마지막 버튼 뒤는 오른쪽 여백)
        const gapCol = btnStart + BTN_COLS;
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: gapCol, endIndex: gapCol + 1 }, properties: { pixelSize: 14 }, fields: "pixelSize" } });
    }
    // Col 28: 오른쪽 여백
    reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 28, endIndex: 29 }, properties: { pixelSize: 20 }, fields: "pixelSize" } });

    // ── 타이틀 헤더 행 (Row 0) ───────────────────────────────────────────────
    reqs.push({
        mergeCells: {
            range: { sheetId, startRowIndex: HEADER_ROW, endRowIndex: HEADER_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL },
            mergeType: "MERGE_ALL"
        }
    });
    reqs.push({
        repeatCell: {
            range: { sheetId, startRowIndex: HEADER_ROW, endRowIndex: HEADER_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL },
            cell: {
                userEnteredValue: { stringValue: titleText },
                userEnteredFormat: {
                    backgroundColor: C.darkSlate,
                    horizontalAlignment: "LEFT",
                    verticalAlignment: "MIDDLE",
                    padding: { left: 24 },
                    textFormat: {
                        foregroundColor: C.white,
                        bold: true,
                        fontSize: 16,
                        fontFamily: "Arial"
                    }
                }
            },
            fields: "userEnteredValue,userEnteredFormat"
        }
    });

    // ── 서브타이틀 행 (Row 1) ────────────────────────────────────────────────
    reqs.push({
        mergeCells: {
            range: { sheetId, startRowIndex: SUB_ROW, endRowIndex: SUB_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL },
            mergeType: "MERGE_ALL"
        }
    });
    reqs.push({
        repeatCell: {
            range: { sheetId, startRowIndex: SUB_ROW, endRowIndex: SUB_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL },
            cell: {
                userEnteredValue: { stringValue: subtitleText },
                userEnteredFormat: {
                    backgroundColor: C.darkSlate,
                    horizontalAlignment: "LEFT",
                    verticalAlignment: "MIDDLE",
                    padding: { left: 26 },
                    textFormat: {
                        foregroundColor: C.subText,
                        bold: false,
                        fontSize: 10,
                        fontFamily: "Arial"
                    }
                }
            },
            fields: "userEnteredValue,userEnteredFormat"
        }
    });

    // ── 스페이서 행들 ─────────────────────────────────────────────────────────
    [SPACER1_ROW, SPACER2_ROW].forEach(row => {
        reqs.push({
            repeatCell: {
                range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL },
                cell: { userEnteredFormat: { backgroundColor: C.lightBg } },
                fields: "userEnteredFormat"
            }
        });
    });

    // ── 버튼 행 배경 ─────────────────────────────────────────────────────────
    reqs.push({
        repeatCell: {
            range: { sheetId, startRowIndex: BTN_ROW, endRowIndex: BTN_ROW + 1, startColumnIndex: 0, endColumnIndex: HEADER_END_COL },
            cell: { userEnteredFormat: { backgroundColor: C.lightBg } },
            fields: "userEnteredFormat"
        }
    });

    // ── 버튼 셀들 ────────────────────────────────────────────────────────────
    buttons.forEach(({ label, gid, color }, i) => {
        const startCol = BTN_START_COL + i * (BTN_COLS + GAP_COLS);
        const endCol   = startCol + BTN_COLS;

        // 병합
        reqs.push({
            mergeCells: {
                range: { sheetId, startRowIndex: BTN_ROW, endRowIndex: BTN_ROW + 1, startColumnIndex: startCol, endColumnIndex: endCol },
                mergeType: "MERGE_ALL"
            }
        });

        // 내용 + 포맷
        reqs.push({
            repeatCell: {
                range: { sheetId, startRowIndex: BTN_ROW, endRowIndex: BTN_ROW + 1, startColumnIndex: startCol, endColumnIndex: endCol },
                cell: {
                    userEnteredValue: {
                        formulaValue: `=HYPERLINK("#gid=${gid}","${label}")`
                    },
                    userEnteredFormat: {
                        backgroundColor: color,
                        horizontalAlignment: "CENTER",
                        verticalAlignment: "MIDDLE",
                        textFormat: {
                            foregroundColor: C.white,
                            bold: true,
                            fontSize: 11,
                            fontFamily: "Arial"
                        }
                    }
                },
                fields: "userEnteredValue,userEnteredFormat"
            }
        });
    });

    return reqs;
}

async function reorganizeSheets() {
    console.log("🚀 구글 시트 재구성 시작...\n");
    const sheets = await getSheetsClient();

    // ── Step 1: 현재 상태 스냅샷 저장 ──────────────────────────────────────
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const allSheets = meta.data.sheets;

    const snapshot = allSheets.map(s => ({
        sheetId: s.properties.sheetId,
        title:   s.properties.title,
        index:   s.properties.index,
        hidden:  s.properties.hidden || false,
    }));
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));

    console.log("📸 스냅샷 저장 완료:", SNAPSHOT_PATH);
    console.log("   현재 시트 목록:");
    allSheets.forEach(s =>
        console.log(`   [${s.properties.index}] "${s.properties.title}" (gid=${s.properties.sheetId})`)
    );
    console.log();

    // ── Step 2: 대상 시트 탐색 ──────────────────────────────────────────────
    const find  = (title) => allSheets.find(s => s.properties.title === title);
    const findP = (prefix) => allSheets.find(s => s.properties.title.startsWith(prefix));

    const febDaily   = find("일일로그_2026_02");
    const febCancel  = find("취소로그_2026_02");
    const marDaily   = find("일일로그_2026_03");
    const marCancel  = find("취소로그_2026_03");
    const marPlat    = findP("플랫폼분석_2026_03");
    const marPax     = findP("인원현황_2026_03");
    const salesSheet = find("매출일지");

    console.log("📋 감지된 시트:");
    console.log(`   2월: 일일로그=${febDaily?.properties.sheetId ?? "없음"}, 취소로그=${febCancel?.properties.sheetId ?? "없음"}`);
    console.log(`   3월: 일일로그=${marDaily?.properties.sheetId ?? "없음"}, 취소로그=${marCancel?.properties.sheetId ?? "없음"}, 플랫폼분석=${marPlat?.properties.sheetId ?? "없음"}, 인원현황=${marPax?.properties.sheetId ?? "없음"}`);
    console.log(`   매출일지: ${salesSheet?.properties.sheetId ?? "없음"}`);
    console.log();

    // ── Step 3: 브리핑 시트 생성 ────────────────────────────────────────────
    console.log("📝 브리핑 시트 생성 중...");
    const febBriefingId = await ensureSheet(sheets, "2월브리핑", { red: 0.18, green: 0.40, blue: 0.88 });
    const marBriefingId = await ensureSheet(sheets, "3월브리핑", { red: 0.31, green: 0.28, blue: 0.90 });
    console.log();

    // ── Step 4: 2월브리핑 포맷 ──────────────────────────────────────────────
    console.log("🎨 2월브리핑 디자인 적용 중...");
    const febButtons = [];
    if (febDaily)  febButtons.push({ label: "📋  일일로그",  gid: febDaily.properties.sheetId,  color: C.indigo });
    if (febCancel) febButtons.push({ label: "❌  취소로그",  gid: febCancel.properties.sheetId, color: C.red    });

    if (febButtons.length > 0) {
        const reqs = buildBriefingRequests(
            febBriefingId,
            "2월 브리핑",
            "2026년 2월  ·  버튼을 눌러 해당 데이터로 이동하세요",
            febButtons
        );
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { requests: reqs } });
        console.log("   ✅ 완료");
    } else {
        console.log("   ⚠️  2월 시트를 찾지 못해 버튼 생략");
    }
    console.log();

    // ── Step 5: 3월브리핑 포맷 ──────────────────────────────────────────────
    console.log("🎨 3월브리핑 디자인 적용 중...");
    const marButtons = [];
    if (marDaily)  marButtons.push({ label: "📋  일일로그",  gid: marDaily.properties.sheetId,  color: C.indigo });
    if (marCancel) marButtons.push({ label: "❌  취소로그",  gid: marCancel.properties.sheetId, color: C.red    });
    if (marPlat)   marButtons.push({ label: "📊  플랫폼분석", gid: marPlat.properties.sheetId,  color: C.purple });
    if (marPax)    marButtons.push({ label: "👥  인원현황",  gid: marPax.properties.sheetId,    color: C.teal   });

    if (marButtons.length > 0) {
        const reqs = buildBriefingRequests(
            marBriefingId,
            "3월 브리핑",
            "2026년 3월  ·  버튼을 눌러 해당 데이터로 이동하세요",
            marButtons
        );
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { requests: reqs } });
        console.log("   ✅ 완료");
    } else {
        console.log("   ⚠️  3월 시트를 찾지 못해 버튼 생략");
    }
    console.log();

    // ── Step 6: 월별 시트 숨김 처리 ─────────────────────────────────────────
    console.log("🙈 월별 시트 숨김 처리 중...");
    const toHide = [febDaily, febCancel, marDaily, marCancel, marPlat, marPax].filter(Boolean);

    if (toHide.length > 0) {
        const hideReqs = toHide.map(s => ({
            updateSheetProperties: {
                properties: { sheetId: s.properties.sheetId, hidden: true },
                fields: "hidden"
            }
        }));
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { requests: hideReqs } });
        toHide.forEach(s => console.log(`   👻 숨김: "${s.properties.title}"`));
    }
    console.log();

    // ── Step 7: 탭 순서 정렬 (매출일지 → 2월브리핑 → 3월브리핑) ─────────────
    console.log("📐 탭 순서 정렬 중...");
    const reorderReqs = [];
    if (salesSheet) {
        reorderReqs.push({ updateSheetProperties: { properties: { sheetId: salesSheet.properties.sheetId, index: 0 }, fields: "index" } });
    }
    reorderReqs.push({ updateSheetProperties: { properties: { sheetId: febBriefingId, index: 1 }, fields: "index" } });
    reorderReqs.push({ updateSheetProperties: { properties: { sheetId: marBriefingId, index: 2 }, fields: "index" } });

    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { requests: reorderReqs } });
    console.log("   ✅ 순서: 매출일지 → 2월브리핑 → 3월브리핑\n");

    console.log("🎉 완료!");
    console.log("   탭 바에 표시되는 시트: 매출일지, 2월브리핑, 3월브리핑");
    console.log("   월별 시트는 숨김 처리 (데이터 보존, 버튼으로 접근 가능)");
    console.log("\n   ⚠️  롤백이 필요하면: node functions/rollback-sheets.js");
}

reorganizeSheets().catch(err => {
    console.error("\n❌ 오류 발생:", err.message || err);
    process.exit(1);
});
