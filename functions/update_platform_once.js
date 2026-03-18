/**
 * 플랫폼 분석 시트 임시 1회 갱신 (로컬 실행)
 * 사용법: node update_platform_once.js
 */
const path = require("path");
const sa = require("./serviceAccountKey.json");

process.env.GCLOUD_PROJECT = sa.project_id;
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, "serviceAccountKey.json");

async function main() {
    const index = require("./index.js");
    const db = require("firebase-admin").firestore();
    const dayjs = require("dayjs");
    const tz = require("dayjs/plugin/timezone");
    const utc = require("dayjs/plugin/utc");
    dayjs.extend(utc);
    dayjs.extend(tz);

    const tokyoNow = dayjs().tz("Asia/Tokyo");
    const year = tokyoNow.year();
    const month = tokyoNow.month() + 1;
    const docId = `platform_analysis_${year}_${String(month).padStart(2, "0")}`;

    await db.collection("reportRuntime").doc(docId).delete();
    console.log(`[임시] reportRuntime/${docId} 삭제 → 재계산 강제 실행`);
    await index.scheduledPlatformAnalysisHourly.run();
    console.log("✅ 플랫폼 분석 시트 갱신 완료");
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
