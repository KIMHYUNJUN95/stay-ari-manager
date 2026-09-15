/**
 * Beds24 ↔ 우리 캐시 정합성 대조 실행기 (브라우저 콘솔용)
 *
 * auditPriceConsistency 는 Beds24 크레딧을 소비하므로 Firebase ID 토큰 +
 * owner/manager 권한을 요구한다. 토큰은 로그인된 앱 안에서만 얻을 수 있어
 * 이 스크립트는 브라우저 콘솔에서 실행한다.
 *
 * 사용법
 *  1. 앱에 owner 또는 manager 계정으로 로그인
 *  2. F12 → Console 탭
 *  3. 이 파일 내용을 전부 붙여넣고 Enter
 *  4. 전 건물 대조:      await auditPrices()
 *     특정 건물만:       await auditPrices("아라키초A")
 *
 * 결과 읽는 법
 *  - consistent: true        → 열려 있는 모든 날짜가 금액·최소숙박일수까지 일치
 *  - complete: false         → Beds24 응답이 페이지로 잘려 비교 자체가 불완전 (재실행)
 *  - summary.mismatchCount   → 값이 다른 날짜 수
 *  - summary.missingCount    → Beds24엔 열려 있는데 우리 캐시에 없는 날짜 수
 *  - buildings[].rooms[]     → 객실별 상세, mismatches 에 날짜/필드/양쪽 값
 */

window.auditPrices = async function auditPrices(building) {
    const auth = window.firebase?.auth?.() || null;
    const user = auth?.currentUser;

    if (!user) {
        console.error("로그인 상태가 아닙니다. 앱에 로그인한 탭에서 실행하세요.");
        console.error("firebase 전역이 없으면 앱 화면에서 실행 중인지 확인하세요.");
        return null;
    }

    const token = await user.getIdToken();
    const apiBase = "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net";

    console.log(`대조 시작${building ? ` — ${building}` : " — 전 건물"}... (수십 초 걸릴 수 있습니다)`);
    const startedAt = Date.now();

    const response = await fetch(`${apiBase}/auditPriceConsistency`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
            companyId: "dGxlQyu47LbplLVCVXiV",
            ...(building ? { building } : {})
        })
    });

    const data = await response.json();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    if (!data.success) {
        console.error(`실패 (${elapsed}s):`, data.error);
        return data;
    }

    console.log(`완료 (${elapsed}s)`);
    console.log(`일치 여부: ${data.consistent ? "✅ 전부 일치" : "❌ 불일치 있음"}`);
    if (data.complete === false) {
        console.warn("⚠️ Beds24 응답이 잘려 비교가 불완전합니다. 다시 실행하세요.");
    }
    console.table(data.summary);

    console.table(data.buildings.map((b) => ({
        건물: b.building,
        객실: b.checkedRooms,
        열린날짜: b.openDates,
        불일치: b.mismatchCount,
        캐시누락: b.missingCount,
        "듀얼 비교일": b.dualComparedDates || 0,
        "듀얼 가격불일치": b.dualMismatchDates || 0,
        교차일: b.crossoverDates || 0,
        "교차일 가격불일치": b.crossoverMismatchDates || 0
    })));

    // ===== 듀얼 ID 가격 일치 분석 =====
    // 운영 기준: 활성/비활성과 무관하게 같은 객실의 모든 roomId는 가격이 같아야 한다.
    // 교차일(두 ID가 동시에 열린 날)은 그중에서도 실제 판매에 영향을 주므로 따로 표시한다.
    console.group("듀얼 ID 가격 일치 분석");
    data.buildings.forEach((b) => {
        (b.dualRooms || []).forEach((r) => {
            const linkage = Object.entries(r.linkage || {})
                .map(([rid, kind]) => `${rid}:${kind}`).join(", ");
            const mark = r.mismatchDates > 0 ? "❌" : "✅";
            console.log(`${mark} ${b.building} ${r.roomName} | 비교 ${r.comparedDates}일 / 불일치 ${r.mismatchDates}일 (교차일 ${r.crossoverDates}/${r.crossoverMismatchDates}, 한쪽만가격 ${r.zeroVsPricedDates}) | ${linkage}`);
            (r.mismatchSamples || []).forEach((s) =>
                console.log("     ", s.date, `[${s.kind}]`, `교차일=${s.crossover}`, JSON.stringify(s.prices)));
        });
    });
    console.groupEnd();
    console.log("linkage 의미 — stored: 그 ID에 가격이 직접 저장됨 / derived: 링크로 파생받음 / none: 가격 없음");

    data.buildings.forEach((b) => {
        const bad = b.rooms.filter((r) => r.status !== "ok");
        if (bad.length === 0) return;
        console.groupCollapsed(`${b.building} — 문제 객실 ${bad.length}개`);
        bad.forEach((r) => {
            console.log(`${r.roomName}(${r.roomId}) status=${r.status} 불일치=${r.mismatchCount || 0} 누락=${r.missingDates}`);
            (r.mismatches || []).forEach((m) => console.log("   ", m.date, JSON.stringify(m.diffs)));
        });
        console.groupEnd();
    });

    return data;
};

// 붙여넣는 즉시 전 건물 대조를 실행한다.
// 특정 건물만 다시 보려면 콘솔에서 auditPrices("아라키초A") 를 호출하면 된다.
console.log("전 건물 대조를 시작합니다... (특정 건물만: auditPrices(\"아라키초A\"))");
auditPrices();
