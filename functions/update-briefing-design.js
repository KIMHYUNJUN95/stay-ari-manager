/**
 * update-briefing-design.js
 * 2월브리핑 / 3월브리핑 시트 디자인 고도화
 *
 * 실행: node functions/update-briefing-design.js
 *
 * - 기존 버튼 텍스트 값 보존 (Apps Script와 호환)
 * - 월별 데이터 시트 일절 수정 없음
 */

const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");

const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";

// ── 색상 팔레트 ─────────────────────────────────────────────────
const C = {
  headerBg:    { red: 0.059, green: 0.090, blue: 0.165 }, // #0F172A — 최상단 헤더
  headerSub:   { red: 0.118, green: 0.157, blue: 0.239 }, // #1E293B — 서브 헤더
  accent:      { red: 0.310, green: 0.275, blue: 0.898 }, // #4F46E5 — 왼쪽 인디고 바
  lightBg:     { red: 0.945, green: 0.961, blue: 0.980 }, // #F1F5F9 — 스페이서/버튼행 배경
  veryLightBg: { red: 0.976, green: 0.984, blue: 0.996 }, // #F8FAFC — 하단 안내 배경
  white:       { red: 1,     green: 1,     blue: 1     },
  subText:     { red: 0.580, green: 0.671, blue: 0.800 }, // #94A3B8 — 서브타이틀 텍스트
  helpText:    { red: 0.392, green: 0.455, blue: 0.545 }, // #64748B — 안내 텍스트
  divider:     { red: 0.200, green: 0.259, blue: 0.357 }, // #334155 — 헤더/본문 경계선
  btnDivider:  { red: 0.882, green: 0.910, blue: 0.941 }, // #E2E8F0 — 버튼 행 하단선

  // 버튼 배경 + 상단 액센트 보더 (더 깊고 풍부한 색상)
  btn: [
    { bg: { red: 0.263, green: 0.220, blue: 0.796 }, border: { red: 0.180, green: 0.149, blue: 0.573 } }, // 인디고
    { bg: { red: 0.725, green: 0.110, blue: 0.110 }, border: { red: 0.500, green: 0.071, blue: 0.071 } }, // 레드
    { bg: { red: 0.427, green: 0.157, blue: 0.851 }, border: { red: 0.286, green: 0.098, blue: 0.592 } }, // 퍼플
    { bg: { red: 0.016, green: 0.471, blue: 0.337 }, border: { red: 0.008, green: 0.294, blue: 0.208 } }, // 티알
  ],
};

// ── 레이아웃 상수 ───────────────────────────────────────────────
const TITLE_IDX    = 0; // 행1
const SUB_IDX      = 1; // 행2
const SPACER_IDX   = 2; // 행3
const BTN_IDX      = 3; // 행4 ← Apps Script BUTTON_ROW=4 유지
const HELP_IDX     = 4; // 행5

const ACCENT_COL   = 0; // 왼쪽 인디고 바 (8px)
const CONTENT_COL  = 1; // 콘텐츠 시작
const BTN_SPAN     = 6; // 버튼 1개당 컬럼 수
const GAP_SPAN     = 1; // 버튼 사이 간격 컬럼 수
const HEADER_END   = 29; // 전체 컬럼 범위

const getBtnStart = (i) => CONTENT_COL + i * (BTN_SPAN + GAP_SPAN);

// ── 메인 빌더 ───────────────────────────────────────────────────
function buildDesignRequests(sheetId, title, subtitle, btnCount) {
  const reqs = [];

  // 1. 기존 셀 병합 전체 해제 (충돌 방지)
  reqs.push({
    unmergeCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: HEADER_END }
    }
  });

  // 2. 포맷만 초기화 (값은 보존 — 버튼 텍스트 유지)
  reqs.push({
    updateCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: HEADER_END },
      fields: "userEnteredFormat"
    }
  });

  // 3. 컬럼 너비 설정
  const colWidths = [
    { start: 0,  end: 1,  px: 8  }, // 인디고 액센트 바
    { start: 28, end: 29, px: 20 }, // 오른쪽 여백
  ];
  // 버튼 컬럼 (4개 기준)
  for (let i = 0; i < 4; i++) {
    const s = getBtnStart(i);
    colWidths.push({ start: s,         end: s + BTN_SPAN, px: 30 }); // 버튼 6컬럼
    colWidths.push({ start: s + BTN_SPAN, end: s + BTN_SPAN + GAP_SPAN, px: 14 }); // 간격
  }
  colWidths.forEach(({ start, end, px }) => {
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: start, endIndex: end },
        properties: { pixelSize: px }, fields: "pixelSize"
      }
    });
  });

  // 4. 행 높이 설정
  const rowHeights = [
    { idx: TITLE_IDX,  px: 58 },
    { idx: SUB_IDX,    px: 24 },
    { idx: SPACER_IDX, px: 18 },
    { idx: BTN_IDX,    px: 66 },
    { idx: HELP_IDX,   px: 26 },
  ];
  rowHeights.forEach(({ idx, px }) => {
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 },
        properties: { pixelSize: px }, fields: "pixelSize"
      }
    });
  });

  // 5. 왼쪽 인디고 액센트 바 (Title ~ Button 행)
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: TITLE_IDX, endRowIndex: BTN_IDX + 1, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: C.accent } },
      fields: "userEnteredFormat.backgroundColor"
    }
  });
  // Help 행 액센트 바: 매우 연한 배경
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: HELP_IDX, endRowIndex: HELP_IDX + 1, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: C.veryLightBg } },
      fields: "userEnteredFormat.backgroundColor"
    }
  });

  // 6. 타이틀 행 (병합 + 포맷 + 값)
  reqs.push({
    mergeCells: {
      range: { sheetId, startRowIndex: TITLE_IDX, endRowIndex: TITLE_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HEADER_END },
      mergeType: "MERGE_ALL"
    }
  });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: TITLE_IDX, endRowIndex: TITLE_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HEADER_END },
      cell: {
        userEnteredValue: { stringValue: title },
        userEnteredFormat: {
          backgroundColor: C.headerBg,
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          padding: { left: 20 },
          textFormat: { foregroundColor: C.white, bold: true, fontSize: 18, fontFamily: "Arial" }
        }
      },
      fields: "userEnteredValue,userEnteredFormat"
    }
  });

  // 7. 서브타이틀 행
  reqs.push({
    mergeCells: {
      range: { sheetId, startRowIndex: SUB_IDX, endRowIndex: SUB_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HEADER_END },
      mergeType: "MERGE_ALL"
    }
  });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: SUB_IDX, endRowIndex: SUB_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HEADER_END },
      cell: {
        userEnteredValue: { stringValue: subtitle },
        userEnteredFormat: {
          backgroundColor: C.headerSub,
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          padding: { left: 22 },
          textFormat: { foregroundColor: C.subText, bold: false, fontSize: 10, fontFamily: "Arial" }
        }
      },
      fields: "userEnteredValue,userEnteredFormat"
    }
  });

  // 헤더 하단 구분선 (서브타이틀 아래)
  reqs.push({
    updateBorders: {
      range: { sheetId, startRowIndex: SUB_IDX, endRowIndex: SUB_IDX + 1, startColumnIndex: 0, endColumnIndex: HEADER_END },
      bottom: { style: "SOLID", colorStyle: { rgbColor: C.divider } }
    }
  });

  // 8. 스페이서 행
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: SPACER_IDX, endRowIndex: SPACER_IDX + 1, startColumnIndex: 0, endColumnIndex: HEADER_END },
      cell: { userEnteredFormat: { backgroundColor: C.lightBg } },
      fields: "userEnteredFormat"
    }
  });

  // 9. 버튼 행 배경
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: BTN_IDX, endRowIndex: BTN_IDX + 1, startColumnIndex: 0, endColumnIndex: HEADER_END },
      cell: { userEnteredFormat: { backgroundColor: C.lightBg } },
      fields: "userEnteredFormat"
    }
  });

  // 10. 버튼 셀 (포맷만 — 값은 Apps Script setup()이 설정)
  for (let i = 0; i < btnCount; i++) {
    const s = getBtnStart(i);
    const e = s + BTN_SPAN;
    const color = C.btn[i];

    // 병합
    reqs.push({
      mergeCells: {
        range: { sheetId, startRowIndex: BTN_IDX, endRowIndex: BTN_IDX + 1, startColumnIndex: s, endColumnIndex: e },
        mergeType: "MERGE_ALL"
      }
    });

    // 버튼 포맷
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: BTN_IDX, endRowIndex: BTN_IDX + 1, startColumnIndex: s, endColumnIndex: e },
        cell: {
          userEnteredFormat: {
            backgroundColor: color.bg,
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            textFormat: { foregroundColor: C.white, bold: true, fontSize: 12, fontFamily: "Arial" }
          }
        },
        fields: "userEnteredFormat"
      }
    });

    // 버튼 상단 두꺼운 액센트 보더
    reqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: BTN_IDX, endRowIndex: BTN_IDX + 1, startColumnIndex: s, endColumnIndex: e },
        top: { style: "SOLID_THICK", colorStyle: { rgbColor: color.border } }
      }
    });
  }

  // 버튼 행 하단 구분선
  reqs.push({
    updateBorders: {
      range: { sheetId, startRowIndex: BTN_IDX, endRowIndex: BTN_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HEADER_END },
      bottom: { style: "SOLID", colorStyle: { rgbColor: C.btnDivider } }
    }
  });

  // 11. 안내 텍스트 행
  reqs.push({
    mergeCells: {
      range: { sheetId, startRowIndex: HELP_IDX, endRowIndex: HELP_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HEADER_END },
      mergeType: "MERGE_ALL"
    }
  });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: HELP_IDX, endRowIndex: HELP_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HELP_IDX + 1 },
      cell: {
        userEnteredValue: { stringValue: "ℹ  버튼을 클릭하면 해당 시트 탭이 열립니다" },
        userEnteredFormat: {
          backgroundColor: C.veryLightBg,
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          padding: { left: 22 },
          textFormat: { foregroundColor: C.helpText, bold: false, fontSize: 10, fontFamily: "Arial", italic: true }
        }
      },
      fields: "userEnteredValue,userEnteredFormat"
    }
  });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: HELP_IDX, endRowIndex: HELP_IDX + 1, startColumnIndex: CONTENT_COL, endColumnIndex: HEADER_END },
      cell: {
        userEnteredFormat: { backgroundColor: C.veryLightBg }
      },
      fields: "userEnteredFormat.backgroundColor"
    }
  });

  return reqs;
}

// ── 실행 ────────────────────────────────────────────────────────
async function updateBriefingDesign() {
  console.log("🎨 브리핑 시트 디자인 고도화 시작...\n");

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheets = meta.data.sheets;
  const find = (t) => allSheets.find(s => s.properties.title === t);

  const febSheet = find("2월브리핑");
  const marSheet = find("3월브리핑");
  if (!febSheet || !marSheet) {
    console.error("❌ 브리핑 시트를 찾을 수 없습니다. reorganize-sheets.js를 먼저 실행하세요.");
    process.exit(1);
  }

  // 2월브리핑
  console.log("✏️  2월브리핑 디자인 적용 중...");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: buildDesignRequests(
        febSheet.properties.sheetId,
        "2월 브리핑",
        "2026년 2월  ·  예약 현황 데이터 조회",
        2
      )
    }
  });
  console.log("   ✅ 완료\n");

  // 3월브리핑
  console.log("✏️  3월브리핑 디자인 적용 중...");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: buildDesignRequests(
        marSheet.properties.sheetId,
        "3월 브리핑",
        "2026년 3월  ·  예약 현황 데이터 조회",
        4
      )
    }
  });
  console.log("   ✅ 완료\n");

  console.log("🎉 디자인 고도화 완료!");
  console.log("   ⚠️  Apps Script setup()을 다시 실행해서 버튼 텍스트를 복원하세요.");
}

updateBriefingDesign().catch(err => {
  console.error("❌ 오류:", err.message || err);
  process.exit(1);
});
