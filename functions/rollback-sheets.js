/**
 * rollback-sheets.js
 * reorganize-sheets.js 실행 전 상태로 완전 복원
 *
 * 실행: node functions/rollback-sheets.js
 *
 * 수행 작업:
 *   1. 브리핑 시트 삭제 (2월브리핑, 3월브리핑)
 *   2. 숨겨진 월별 시트 다시 표시
 *   3. 원래 탭 순서 복원
 */

const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");
const fs = require("fs");
const path = require("path");

const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const SNAPSHOT_PATH  = path.join(__dirname, "sheets_snapshot.json");
const BRIEFING_TITLES = ["2월브리핑", "3월브리핑"];

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

async function rollbackSheets() {
    console.log("⏪ 롤백 시작...\n");

    if (!fs.existsSync(SNAPSHOT_PATH)) {
        console.error("❌ 스냅샷 파일이 없습니다:", SNAPSHOT_PATH);
        console.error("   reorganize-sheets.js를 실행한 적이 없거나 스냅샷이 삭제된 경우입니다.");
        process.exit(1);
    }

    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
    console.log(`📸 스냅샷 로드 완료: ${snapshot.length}개 시트 기록됨`);
    console.log("   스냅샷 내용:");
    snapshot.forEach(s => console.log(`   [${s.index}] "${s.title}" (gid=${s.sheetId}, hidden=${s.hidden})`));
    console.log();

    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const currentSheets = meta.data.sheets;

    const requests = [];

    // ── Step 1: 브리핑 시트 삭제 ──────────────────────────────────────────
    console.log("🗑️  브리핑 시트 삭제 중...");
    for (const s of currentSheets) {
        if (BRIEFING_TITLES.includes(s.properties.title)) {
            requests.push({ deleteSheet: { sheetId: s.properties.sheetId } });
            console.log(`   삭제: "${s.properties.title}" (gid=${s.properties.sheetId})`);
        }
    }

    // ── Step 2: 숨겨진 시트 복원 ─────────────────────────────────────────
    console.log("\n👁️  숨겨진 시트 복원 중...");
    for (const snap of snapshot) {
        if (snap.hidden) continue; // 원래 숨겨져 있던 시트는 그대로 둠
        const current = currentSheets.find(s => s.properties.sheetId === snap.sheetId);
        if (current && current.properties.hidden) {
            requests.push({
                updateSheetProperties: {
                    properties: { sheetId: snap.sheetId, hidden: false },
                    fields: "hidden"
                }
            });
            console.log(`   표시 복원: "${snap.title}"`);
        }
    }

    if (requests.length === 0) {
        console.log("\n   변경 사항 없음 — 이미 원래 상태입니다.");
        return;
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests }
    });

    // ── Step 3: 탭 순서 복원 ─────────────────────────────────────────────
    console.log("\n📐 탭 순서 복원 중...");
    const meta2 = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const currentSheets2 = meta2.data.sheets;

    const reorderReqs = [];
    const sortedSnap = [...snapshot].sort((a, b) => a.index - b.index);

    for (const snap of sortedSnap) {
        const current = currentSheets2.find(s => s.properties.sheetId === snap.sheetId);
        if (current) {
            reorderReqs.push({
                updateSheetProperties: {
                    properties: { sheetId: snap.sheetId, index: snap.index },
                    fields: "index"
                }
            });
        }
    }

    if (reorderReqs.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: reorderReqs }
        });
        console.log("   ✅ 원래 순서 복원 완료");
    }

    // ── 스냅샷 파일 백업 (재롤백 방지) ───────────────────────────────────
    const backupPath = SNAPSHOT_PATH.replace(".json", "_used.json");
    fs.renameSync(SNAPSHOT_PATH, backupPath);
    console.log(`\n📦 스냅샷 백업: ${backupPath}`);

    console.log("\n✅ 롤백 완료! 스프레드시트가 원래 상태로 복원됐습니다.");
}

rollbackSheets().catch(err => {
    console.error("\n❌ 오류 발생:", err.message || err);
    process.exit(1);
});
