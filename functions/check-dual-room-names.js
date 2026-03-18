/**
 * 듀얼 어카운트 룸의 Airbnb 리뷰에서 listing 정보 확인
 */
const axios = require("axios");

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getToken() {
    const res = await axios.get("https://beds24.com/api/v2/authentication/token", {
        headers: { "refreshToken": REFRESH_TOKEN }
    });
    return res.data.token;
}

async function getReviews(token, roomId) {
    try {
        const res = await axios.get("https://beds24.com/api/v2/channels/airbnb/reviews", {
            headers: { "token": token },
            params: { roomId: parseInt(roomId) }
        });
        return res.data?.data || [];
    } catch (e) {
        return [];
    }
}

// 대표 샘플만 체크
const SAMPLES = [
    { building: "아라키초A", room: "201호", ids: ["383971", "601545"] },
    { building: "가부키초", room: "202호", ids: ["383979", "451220"] },
    { building: "다카다노바바", room: "401호", ids: ["513700", "556719"] },
    { building: "오쿠보C동", room: "오쿠보C", ids: ["450096", "496532", "648399"] },
];

async function main() {
    const token = await getToken();

    for (const sample of SAMPLES) {
        console.log(`\n${"=".repeat(70)}`);
        console.log(`📍 ${sample.building} - ${sample.room}`);
        console.log("=".repeat(70));

        for (const rid of sample.ids) {
            const reviews = await getReviews(token, rid);
            console.log(`\n--- roomId: ${rid} (${reviews.length} reviews) ---`);

            if (reviews.length > 0) {
                const first = reviews[0];
                // 리뷰 데이터에서 모든 키 확인
                console.log(`  Available fields: ${Object.keys(first).join(", ")}`);
                console.log(`  listing_id: ${first.listing_id || "N/A"}`);
                console.log(`  listing_name: ${first.listing_name || "N/A"}`);
                console.log(`  overall_rating: ${first.overall_rating || "N/A"}`);

                // 리뷰 날짜 범위 확인 (어느 기간 사용했는지)
                const dates = reviews
                    .map(r => r.created_at || r.reservation_confirmation_code || "")
                    .filter(Boolean);
                if (dates.length > 0) {
                    console.log(`  Date samples: ${dates.slice(0, 3).join(", ")}`);
                }

                // 첫 번째 리뷰 전체 출력 (구조 파악)
                if (sample === SAMPLES[0] && rid === sample.ids[0]) {
                    console.log(`\n  [Full first review structure]:`);
                    console.log(JSON.stringify(first, null, 4));
                }
            }
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

main().catch(console.error);
