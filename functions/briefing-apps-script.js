/**
 * Stay-Ari Manager — 브리핑 네비게이션 Apps Script (동적 버전)
 *
 * 📌 사용법 (최초 1회만):
 *   1. 구글 시트 열기 → 확장 프로그램 → Apps Script
 *   2. 이 파일 내용 전체 붙여넣기 → 저장 (Ctrl+S)
 *   3. 상단 [함수 선택]에서 "setup" 선택 → ▶ 실행 → 권한 허용
 *   4. 완료! 이후 매월 재실행 불필요.
 *
 * 🎯 실행할 함수 (상단 드롭다운에서 선택 후 ▶ 실행):
 *   • setup          — 최초 1회. 트리거 정리·권한 부여.
 *   • debugButtonMap — 버튼/시트 매핑 확인용. 스프레드시트 연 상태에서 실행.
 *
 * 📅 매월: "4월 브리핑", "5월 브리핑" 등 새 시트만 추가하고, 버튼을 같은 열(B-H, I-N, O-V, W-AB)
 *    위치에 두면 코드 수정·재배포 없이 자동 인식됩니다. (일일로그_2026_04 등 시트가 있어야 함)
 *
 * ⚠️ 버튼이 "이미지/도형"이면 셀 선택이 바뀌지 않아 동작 안 함. 반드시 셀을
 *    서식으로 꾸민 "셀 버튼"으로 사용하세요.
 */

var BUTTON_ORDER = ['일일로그', '취소로그', '플랫폼분석', '인원현황'];
// 시트 이름이 "취소 로그_2026_03"처럼 공백 있을 수 있음 → 여러 접두어로 매칭
var BUTTON_ORDER_TO_PREFIXES = [
  ['일일로그'],
  ['취소로그', '취소 로그'],
  ['플랫폼분석', '플랫폼 분석'],
  ['인원현황', '인원 현황']
];
// 실제 시트 버튼 위치(합쳐진 셀). 취소로그=I4:N4(9-14), 인원현황=W4:AB4(23-28) 등
var BTN_POSITIONS = [
  { startCol: 2,  endCol: 8 },   // B-H   일일로그
  { startCol: 9,  endCol: 14 },  // I-N   취소로그
  { startCol: 15, endCol: 22 },  // O-V   플랫폼분석
  { startCol: 23, endCol: 28 },  // W-AB  인원현황
];
var BUTTON_ROW_START = 4;
var BUTTON_ROW_END = 5;

// ══════════════════════════════════════════════════════════════
// 동적 시트 감지
// ══════════════════════════════════════════════════════════════

function getBriefingSheetNames(ss) {
  if (!ss) return [];
  return ss.getSheets()
    .map(function(s) { return s.getName(); })
    .filter(function(n) { return /^[0-9０-９]+월\s*브리핑$/.test(n); });
}

function getMonthlySheetNames(ss) {
  if (!ss) return [];
  return ss.getSheets()
    .map(function(s) { return s.getName(); })
    .filter(function(n) { return /^[^\s]+_\d{4}_\d{2}$/.test(n); });
}

function buildButtonMap(ss) {
  if (!ss) return {};
  var allSheetNames = ss.getSheets().map(function(s) { return s.getName(); });
  var briefingNames = getBriefingSheetNames(ss);
  var map = {};
  var year = new Date().getFullYear();

  briefingNames.forEach(function(briefingName) {
    var match = briefingName.match(/^([0-9０-９]+)월\s*브리핑$/);
    if (!match) return;
    var monthStr = match[1].replace(/[０-９]/g, function(c) { return '0123456789'['０１２３４５６７８９'.indexOf(c)] || c; });
    var monthNum = parseInt(monthStr, 10) || 1;
    var monthPad = monthNum < 10 ? '0' + monthNum : String(monthNum);
    var suffix = '_' + year + '_' + monthPad;

    var buttons = [];
    for (var i = 0; i < 4; i++) {
      var prefixes = BUTTON_ORDER_TO_PREFIXES[i] || [BUTTON_ORDER[i]];
      var targetName = null;
      for (var p = 0; p < prefixes.length; p++) {
        var want = prefixes[p] + suffix;
        if (allSheetNames.indexOf(want) !== -1) {
          targetName = want;
          break;
        }
      }
      if (!targetName) {
        var fallback = allSheetNames.filter(function(n) {
          return prefixes.some(function(pr) { return n.indexOf(pr) === 0 && n.lastIndexOf(suffix) === n.length - suffix.length; });
        });
        if (fallback.length > 0) targetName = fallback[0];
      }
      buttons.push({
        startCol: BTN_POSITIONS[i].startCol,
        endCol:   BTN_POSITIONS[i].endCol,
        target:   targetName
      });
    }

    var key = briefingName.replace(/\s/g, '');
    map[key] = buttons;
  });

  return map;
}

// ══════════════════════════════════════════════════════════════
// 단순 트리거 핸들러 — 함수명 고정 (onSelectionChange)
// ══════════════════════════════════════════════════════════════

function onSelectionChange(e) {
  if (!e || !e.source || !e.range) return;

  try {
    var ss = e.source;
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();

    var briefingSheetNames = getBriefingSheetNames(ss);

    if (briefingSheetNames.indexOf(sheetName) !== -1) {
      var clickedRow = e.range.getRow();
      var clickedCol = e.range.getColumn();

      if (clickedRow >= BUTTON_ROW_START && clickedRow <= BUTTON_ROW_END) {
        var buttonMap = buildButtonMap(ss);
        var buttons = buttonMap[sheetName.replace(/\s/g, '')] || buttonMap[sheetName] || [];
        for (var i = 0; i < buttons.length; i++) {
          var btn = buttons[i];
          if (clickedCol >= btn.startCol && clickedCol <= btn.endCol) {
            if (btn.target) {
              navigateTo(ss, btn.target);
            } else {
              try { ss.toast('⏳ 해당 시트가 없습니다.', '', 2); } catch (e) {}
            }
            return;
          }
        }
      }
      return;
    }

    var monthlySheetNames = getMonthlySheetNames(ss);
    if (monthlySheetNames.indexOf(sheetName) === -1) {
      hideMonthlySheets(ss, monthlySheetNames);
    }

  } catch (err) {
    // 오류 발생해도 사용자 작업 방해하지 않음
  }
}

// ══════════════════════════════════════════════════════════════
// setup() — 최초 1회 실행: 설치형 트리거 제거 + 권한 부여
// ══════════════════════════════════════════════════════════════

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    SpreadsheetApp.getUi().alert('스프레드시트를 연 상태에서 실행해 주세요.');
    return;
  }

  // 설치형 트리거만 정리 (onSelectionChange는 단순 트리거라 등록 불가, 함수 이름만 맞으면 자동 동작)
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  SpreadsheetApp.getUi().alert(
    '✅ 설정 완료!\n\n' +
    '버튼(일일로그/취소로그/플랫폼분석/인원현황) 클릭 시 해당 시트로 이동합니다.\n' +
    'onSelectionChange는 단순 트리거로, 셀 선택만 바꿔도 자동 실행됩니다. 매월 새 브리핑 시트 자동 인식.'
  );
}

// ══════════════════════════════════════════════════════════════
// 헬퍼 함수
// ══════════════════════════════════════════════════════════════

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

/** 디버그: 현재 스프레드시트에서 인식한 브리핑·버튼 매핑을 알림으로 표시 (원인 파악용) */
function debugButtonMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) { SpreadsheetApp.getUi().alert('스프레드시트를 열어 두고 실행하세요.'); return; }
  var names = ss.getSheets().map(function(s) { return s.getName(); });
  var briefingNames = getBriefingSheetNames(ss);
  var map = buildButtonMap(ss);
  var lines = ['[시트 목록] ' + names.length + '개\n' + names.slice(0, 20).join(', ') + (names.length > 20 ? '...' : ''),
    '[브리핑 시트] ' + (briefingNames.length ? briefingNames.join(', ') : '없음')];
  briefingNames.forEach(function(bname) {
    var key = bname.replace(/\s/g, '');
    var buttons = map[key] || [];
    lines.push('\n[' + bname + '] 버튼 ' + buttons.length + '개');
    buttons.forEach(function(b, i) {
      lines.push('  ' + (i + 1) + ') 열 ' + b.startCol + '~' + b.endCol + ' → ' + (b.target || '(없음)'));
    });
  });
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}
