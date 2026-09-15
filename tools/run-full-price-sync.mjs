/**
 * 배포 직후 1회 실행용 — Beds24에 열려 있는 전 구간(오늘~+12개월)을
 * 건물별·객실별로 전부 다시 가져와 price_sync 캐시를 재구축한다.
 *
 * triggerPriceSync 는 건물 단위이므로 활성 건물 9곳을 순차 호출한다.
 * (forceFull: true 라 invalidatedRoomIds 와 무관하게 모든 roomId를 조회한다)
 *
 * 실행:  node tools/run-full-price-sync.mjs
 * 옵션:  node tools/run-full-price-sync.mjs "아라키초A" "가부키초"   ← 특정 건물만
 *
 * 주의
 *  - Beds24 크레딧을 소비한다. 건물당 배치 GET 1~2회 수준이다.
 *  - 최근 15분 내 수동 수정된 객실은 캐시 보호 규칙에 따라 건너뛴다(정상 동작).
 *  - 큐에 대기 중인 가격 job이 있으면 동기화가 그 job에 양보하고 중단될 수 있다.
 *    결과의 yieldedToManualJob 을 확인하고, 그 경우 잠시 후 다시 실행한다.
 */

const API_BASE = process.env.REACT_APP_API_BASE_URL
    || "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net";
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "dGxlQyu47LbplLVCVXiV";

// 다이쿄초(매각 완료)는 제외된 활성 건물 목록
const BUILDINGS = [
    "아라키초A",
    "아라키초B",
    "가부키초",
    "다카다노바바",
    "오쿠보A동",
    "오쿠보B동",
    "오쿠보C동",
    "STAY ARI Apartment Hotel",
    "사노시"
];

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : BUILDINGS;

function fmt(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}

const results = [];

for (const building of targets) {
    const startedAt = Date.now();
    process.stdout.write(`[${building}] 동기화 중... `);
    try {
        const response = await fetch(`${API_BASE}/triggerPriceSync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId: COMPANY_ID, building })
        });
        const data = await response.json();
        const elapsed = Date.now() - startedAt;

        if (!response.ok || !data.success) {
            console.log(`실패 (${fmt(elapsed)}) — ${data.error || response.status}`);
            results.push({ building, ok: false, error: data.error || String(response.status) });
            continue;
        }

        const r = data.result || {};
        const detail = [
            r.requestedRooms !== undefined ? `요청 ${r.requestedRooms}` : null,
            r.syncedRooms !== undefined ? `동기화 ${r.syncedRooms}` : null,
            r.skippedRooms ? `스킵 ${r.skippedRooms}` : null,
            r.yieldedToManualJob ? "※ job에 양보하고 중단됨" : null
        ].filter(Boolean).join(", ");

        console.log(`완료 (${fmt(elapsed)}) ${detail}`);
        results.push({ building, ok: true, ...r });
    } catch (err) {
        console.log(`오류 — ${err.message}`);
        results.push({ building, ok: false, error: err.message });
    }

    // Beds24 크레딧 여유를 위해 건물 사이에 간격을 둔다.
    await new Promise((r) => setTimeout(r, 2000));
}

console.log("\n===== 요약 =====");
const failed = results.filter((r) => !r.ok);
const yielded = results.filter((r) => r.ok && r.yieldedToManualJob);
console.log(`성공 ${results.length - failed.length} / ${results.length}`);
if (yielded.length > 0) {
    console.log(`양보로 중단된 건물 ${yielded.length}개 — 잠시 후 재실행 필요: ${yielded.map((r) => r.building).join(", ")}`);
}
if (failed.length > 0) {
    console.log("실패:");
    failed.forEach((r) => console.log(`  ${r.building} — ${r.error}`));
    process.exitCode = 1;
}
