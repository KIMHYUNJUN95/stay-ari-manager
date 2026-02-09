const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";
const V1_API_KEY = "9378AnbjfrIDo3j9MmrQZjwKd";
const V1_PROP_KEY = "NSoH37aJMipHA4K4MPVyp2pnq"; // 아라키초A

async function test() {
    console.log("=== Beds24 V1 vs V2 API 비교 테스트 ===\n");

    // 1. V2 토큰 발급
    console.log("1. V2 토큰 발급 중...");
    let token;
    try {
        const tokenRes = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: { refreshToken: REFRESH_TOKEN }
        });
        token = tokenRes.data.token;
        console.log("   ✅ 토큰 발급 성공\n");
    } catch (e) {
        console.log("   ❌ 토큰 발급 실패:", e.message);
        return;
    }

    // 2. V1 예약 조회
    console.log("2. V1 예약 조회 (getBookings)...");
    let v1Bookings;
    try {
        const v1Res = await axios.post("https://api.beds24.com/json/getBookings", {
            authentication: { apiKey: V1_API_KEY, propKey: V1_PROP_KEY },
            arrivalFrom: "20260101",
            arrivalTo: "20260228",
            includeInfo: true,
            includeInvoice: true,
            limit: 3
        });
        v1Bookings = v1Res.data;
        console.log("   ✅ V1 응답 건수:", Array.isArray(v1Bookings) ? v1Bookings.length : "N/A");
        if (Array.isArray(v1Bookings) && v1Bookings.length > 0) {
            console.log("   V1 첫 번째 예약 필드:", Object.keys(v1Bookings[0]).join(", "));
        }
    } catch (e) {
        console.log("   ❌ V1 실패:", e.message);
    }

    // 3. V2 예약 조회
    console.log("\n3. V2 예약 조회 (GET /bookings)...");
    let v2Bookings;
    try {
        const v2Res = await axios.get("https://beds24.com/api/v2/bookings", {
            headers: { token: token },
            params: {
                arrivalFrom: "2026-01-01",
                arrivalTo: "2026-02-28"
            }
        });
        v2Bookings = v2Res.data;
        console.log("   ✅ V2 응답 타입:", typeof v2Bookings, Array.isArray(v2Bookings) ? "(배열)" : "(객체)");
        if (Array.isArray(v2Bookings)) {
            console.log("   V2 응답 건수:", v2Bookings.length);
            if (v2Bookings.length > 0) {
                console.log("   V2 첫 번째 예약 필드:", Object.keys(v2Bookings[0]).join(", "));
            }
        } else {
            console.log("   V2 응답 구조:", Object.keys(v2Bookings).join(", "));
            if (v2Bookings.data) {
                console.log("   V2 data 건수:", Array.isArray(v2Bookings.data) ? v2Bookings.data.length : "N/A");
                if (Array.isArray(v2Bookings.data) && v2Bookings.data.length > 0) {
                    console.log("   V2 첫 번째 예약 필드:", Object.keys(v2Bookings.data[0]).join(", "));
                    v2Bookings = v2Bookings.data; // 필드 비교를 위해 재할당
                }
            }
        }
    } catch (e) {
        console.log("   ❌ V2 실패:", e.message, e.response?.data);
    }

    // 4. 필드 비교
    console.log("\n=== 필드 비교 ===");
    if (v1Bookings && v1Bookings.length > 0 && v2Bookings && v2Bookings.length > 0) {
        const v1Fields = new Set(Object.keys(v1Bookings[0]));
        const v2Fields = new Set(Object.keys(v2Bookings[0]));

        const onlyV1 = [...v1Fields].filter(f => !v2Fields.has(f));
        const onlyV2 = [...v2Fields].filter(f => !v1Fields.has(f));
        const common = [...v1Fields].filter(f => v2Fields.has(f));

        console.log("V1에만 있는 필드:", onlyV1.join(", ") || "없음");
        console.log("V2에만 있는 필드:", onlyV2.join(", ") || "없음");
        console.log("공통 필드:", common.join(", "));
    }

    // 5. V1 가격 조회
    console.log("\n4. V1 가격 조회 (getRoomDates)...");
    try {
        const v1PriceRes = await axios.post("https://api.beds24.com/json/getRoomDates", {
            authentication: { apiKey: V1_API_KEY, propKey: V1_PROP_KEY },
            roomId: "383971", // 아라키초A 201호
            from: "20260120",
            to: "20260125"
        });
        console.log("   ✅ V1 가격 응답:", JSON.stringify(v1PriceRes.data).slice(0, 300));
    } catch (e) {
        console.log("   ❌ V1 실패:", e.message);
    }

    // 6. V2 가격 조회
    console.log("\n5. V2 가격 조회 (GET /inventory/rooms/calendar)...");
    try {
        const v2PriceRes = await axios.get("https://beds24.com/api/v2/inventory/rooms/calendar", {
            headers: { token: token },
            params: {
                roomId: "383971",
                startDate: "2026-01-20",
                endDate: "2026-01-25"
            }
        });
        console.log("   ✅ V2 가격 응답:", JSON.stringify(v2PriceRes.data).slice(0, 300));
    } catch (e) {
        console.log("   ❌ V2 실패:", e.message, e.response?.data);
    }

    console.log("\n=== 테스트 완료 ===");
}

test();
