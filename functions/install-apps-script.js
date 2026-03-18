/**
 * install-apps-script.js
 * Apps Script API를 통해 브리핑 네비게이션 코드를 자동 설치
 *
 * 실행: node functions/install-apps-script.js
 */

const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");
const fs = require("fs");
const path = require("path");

const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const SCRIPT_TITLE = "Stay-Ari 브리핑 네비게이션";

// ── Apps Script 소스 코드 ──────────────────────────────────────
const SCRIPT_SOURCE = `
var BUTTON_ORDER = ['일일로그', '취소로그', '플랫폼분석', '인원현황'];
var BTN_POSITIONS = [
  { startCol: 2,  endCol: 7  },
  { startCol: 9,  endCol: 14 },
  { startCol: 16, endCol: 21 },
  { startCol: 23, endCol: 28 },
];
var BUTTON_ROW = 4;

function getBriefingSheetNames(ss) {
  return ss.getSheets()
    .map(function(s) { return s.getName(); })
    .filter(function(n) { return /^\\d+월브리핑$/.test(n); });
}

function getMonthlySheetNames(ss) {
  return ss.getSheets()
    .map(function(s) { return s.getName(); })
    .filter(function(n) { return /^[^\\s]+_\\d{4}_\\d{2}$/.test(n); });
}

function buildButtonMap(ss) {
  var allSheetNames = ss.getSheets().map(function(s) { return s.getName(); });
  var briefingNames = getBriefingSheetNames(ss);
  var map = {};

  briefingNames.forEach(function(briefingName) {
    var match = briefingName.match(/^(\\d+)월브리핑$/);
    if (!match) return;
    var monthNum = parseInt(match[1]);
    var monthPad = monthNum < 10 ? '0' + monthNum : String(monthNum);

    var buttons = [];
    BUTTON_ORDER.forEach(function(prefix, i) {
      var candidates = allSheetNames.filter(function(n) {
        return n.indexOf(prefix) === 0 && n.slice(-3) === '_' + monthPad;
      }).sort().reverse();

      if (candidates.length > 0) {
        buttons.push({
          startCol: BTN_POSITIONS[i].startCol,
          endCol:   BTN_POSITIONS[i].endCol,
          target:   candidates[0]
        });
      }
    });

    if (buttons.length > 0) {
      map[briefingName] = buttons;
    }
  });

  return map;
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 기존 트리거 전부 삭제 (충돌 방지)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('handleSelectionChange')
    .forSpreadsheet(ss)
    .onSelectionChange()
    .create();

  SpreadsheetApp.getUi().alert('✅ 설정 완료!\\n\\n매월 새 브리핑 시트가 추가되면 자동으로 인식됩니다.\\n재설정 불필요합니다.');
}

function handleSelectionChange(e) {
  if (!e || !e.source || !e.range) return;
  try {
    var ss = e.source;
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();

    var briefingSheetNames = getBriefingSheetNames(ss);

    if (briefingSheetNames.indexOf(sheetName) !== -1) {
      var clickedRow = e.range.getRow();
      var clickedCol = e.range.getColumn();

      if (clickedRow === BUTTON_ROW) {
        var buttonMap = buildButtonMap(ss);
        var buttons = buttonMap[sheetName] || [];
        for (var i = 0; i < buttons.length; i++) {
          var btn = buttons[i];
          if (clickedCol >= btn.startCol && clickedCol <= btn.endCol) {
            navigateTo(ss, btn.target);
            return;
          }
        }
      }
    }

    var monthlySheetNames = getMonthlySheetNames(ss);
    if (monthlySheetNames.indexOf(sheetName) === -1) {
      hideMonthlySheets(ss, monthlySheetNames);
    }
  } catch (err) {
    // 사용자 작업 방해하지 않음
  }
}

function navigateTo(ss, targetName) {
  var target = ss.getSheetByName(targetName);
  if (!target) {
    try { ss.toast('⏳ ' + targetName + ' 아직 준비 중입니다', '', 3); } catch(e) {}
    return;
  }
  if (target.isSheetHidden()) {
    target.showSheet();
  }
  ss.setActiveSheet(target);
  SpreadsheetApp.flush();
}

function hideMonthlySheets(ss, monthlySheetNames) {
  monthlySheetNames = monthlySheetNames || getMonthlySheetNames(ss);
  for (var i = 0; i < monthlySheetNames.length; i++) {
    var sheet = ss.getSheetByName(monthlySheetNames[i]);
    if (sheet && !sheet.isSheetHidden()) {
      sheet.hideSheet();
    }
  }
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'handleSelectionChange') {
      ScriptApp.deleteTrigger(t);
    }
  });
}
`;

async function installAppsScript() {
    console.log("🚀 Apps Script 자동 설치 시작...\n");

    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: serviceAccount.client_email,
            private_key: serviceAccount.private_key,
        },
        scopes: [
            "https://www.googleapis.com/auth/script.projects",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ],
    });
    const authClient = await auth.getClient();
    const script = google.script({ version: "v1", auth: authClient });

    // 1. 기존 바운드 스크립트 확인
    console.log("🔍 기존 스크립트 프로젝트 확인 중...");
    const drive = google.drive({ version: "v3", auth: authClient });
    let scriptId = null;

    try {
        const driveRes = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.script' and '${SPREADSHEET_ID}' in parents`,
            fields: "files(id, name)",
        });
        const files = driveRes.data.files || [];
        if (files.length > 0) {
            scriptId = files[0].id;
            console.log(`   기존 스크립트 발견: "${files[0].name}" (id: ${scriptId})`);
        }
    } catch (e) {
        console.log("   Drive API 검색 실패 (권한 없음) — 새 프로젝트로 생성 시도");
    }

    // 2. 스크립트 프로젝트 생성 (없으면)
    if (!scriptId) {
        console.log("📝 새 스크립트 프로젝트 생성 중...");
        const createRes = await script.projects.create({
            requestBody: {
                title: SCRIPT_TITLE,
                parentId: SPREADSHEET_ID,
            },
        });
        scriptId = createRes.data.scriptId;
        console.log(`   ✅ 생성 완료 (scriptId: ${scriptId})`);
    }

    // 3. 스크립트 코드 업로드
    console.log("⬆️  스크립트 코드 업로드 중...");
    await script.projects.updateContent({
        scriptId,
        requestBody: {
            files: [
                {
                    name: "Code",
                    type: "SERVER_JS",
                    source: SCRIPT_SOURCE.trim(),
                },
                {
                    name: "appsscript",
                    type: "JSON",
                    source: JSON.stringify({
                        timeZone: "Asia/Tokyo",
                        dependencies: {},
                        exceptionLogging: "STACKDRIVER",
                        runtimeVersion: "V8",
                    }),
                },
            ],
        },
    });
    console.log("   ✅ 코드 업로드 완료\n");

    // scriptId 저장
    fs.writeFileSync(
        path.join(__dirname, "apps_script_id.json"),
        JSON.stringify({ scriptId, spreadsheetId: SPREADSHEET_ID }, null, 2)
    );

    console.log("🎉 Apps Script 설치 완료!");
    console.log(`   scriptId: ${scriptId}`);
    console.log("\n⚠️  마지막 단계 (1회만):");
    console.log("   구글 시트 열기 → 확장 프로그램 → Apps Script");
    console.log('   함수 선택: "setup" → ▶ 실행 → 권한 허용');
}

installAppsScript().catch(err => {
    console.error("\n❌ 오류:", err.message || err);
    if (err.message && err.message.includes("disabled")) {
        console.error("\n💡 Apps Script API가 비활성화되어 있습니다.");
        console.error("   수동 설치 방법:");
        console.error("   1. 구글 시트 열기 → 확장 프로그램 → Apps Script");
        console.error("   2. functions/briefing-apps-script.js 내용 붙여넣기 → 저장");
        console.error('   3. "setup" 선택 → ▶ 실행 → 권한 허용');
    }
    process.exit(1);
});
