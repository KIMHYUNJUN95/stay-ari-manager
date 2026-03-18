/**
 * 듀얼 어카운트 룸 정보 조회
 * 같은 객실에 2개 roomId가 있는 경우의 Beds24 실제 데이터 확인
 */
require("dotenv").config();
const axios = require("axios");

const TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

// 듀얼 어카운트 룸들
const DUAL_ROOMS = {
    "아라키초A": [
        { room: "201호", ids: ["383971", "601545"] },
        { room: "202호", ids: ["403542", "601546"] },
        { room: "301호", ids: ["383972", "601547"] },
        { room: "302호", ids: ["383978", "601548"] },
        { room: "401호", ids: ["440617", "515300"] },
        { room: "402호", ids: ["383974", "601549"] },
        { room: "501호", ids: ["383975", "502229"] },
        { room: "502호", ids: ["383976", "601550"] },
        { room: "602호", ids: ["537451", "601551"] },
        { room: "701호", ids: ["383973", "601552"] },
        { room: "702호", ids: ["383977", "601553"] },
    ],
    "가부키초": [
        { room: "202호", ids: ["383979", "451220"] },
        { room: "203호", ids: ["383980", "452061"] },
        { room: "302호", ids: ["383981", "452062"] },
        { room: "303호", ids: ["383982", "451223"] },
        { room: "402호", ids: ["383983", "451224"] },
        { room: "403호", ids: ["383984", "452063"] },
        { room: "502호", ids: ["543189", "601560"] },
        { room: "603호", ids: ["383985", "452064"] },
        { room: "802호", ids: ["441885", "452065"] },
        { room: "803호", ids: ["624198", "648398"] },
    ],
    "다카다노바바": [
        { room: "401호", ids: ["513700", "556719"] },
    ],
    "오쿠보C동": [
        { room: "오쿠보C", ids: ["450096", "496532", "648399"] },
    ]
};

async function getToken() {
    try {
        const res = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: { "refreshToken": TOKEN }
        });
        return res.data.token;
    } catch (e) {
        console.error("Token error:", e.message);
        process.exit(1);
    }
}

async function getRoomInfo(token, roomId) {
    try {
        const res = await axios.get("https://beds24.com/api/v2/inventory/rooms", {
            headers: { "token": token },
            params: { id: roomId }
        });
        return res.data;
    } catch (e) {
        return { error: e.message };
    }
}

async function getAirbnbReviewCount(token, roomId) {
    try {
        const res = await axios.get("https://beds24.com/api/v2/channels/airbnb/reviews", {
            headers: { "token": token },
            params: { roomId: parseInt(roomId) }
        });
        const data = res.data;
        if (data && Array.isArray(data.data)) {
            return data.data.length;
        }
        return 0;
    } catch (e) {
        if (e.response?.status === 400) return "N/A (not Airbnb)";
        return `Error: ${e.message}`;
    }
}

async function main() {
    const token = await getToken();
    console.log("Token acquired.\n");

    // 각 건물에서 대표 1~2개씩만 상세 조회
    const sampleRooms = [
        // 아라키초A 201호
        { building: "아라키초A", room: "201호", ids: ["383971", "601545"] },
        // 가부키초 202호
        { building: "가부키초", room: "202호", ids: ["383979", "451220"] },
        // 다카다노바바 401호
        { building: "다카다노바바", room: "401호", ids: ["513700", "556719"] },
        // 오쿠보C동
        { building: "오쿠보C동", room: "오쿠보C", ids: ["450096", "496532", "648399"] },
    ];

    for (const sample of sampleRooms) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`📍 ${sample.building} - ${sample.room}`);
        console.log("=".repeat(60));

        for (const rid of sample.ids) {
            console.log(`\n--- roomId: ${rid} ---`);

            const info = await getRoomInfo(token, rid);
            if (info.error) {
                console.log(`  Error: ${info.error}`);
            } else if (Array.isArray(info) && info.length > 0) {
                const r = info[0];
                console.log(`  name: "${r.name}"`);
                console.log(`  propertyId: ${r.propertyId}`);
                console.log(`  roomType: ${r.roomType || "N/A"}`);
                console.log(`  roomQty: ${r.roomQty || "N/A"}`);
                console.log(`  description: "${(r.description || "").substring(0, 100)}"`);

                // Airbnb 관련 필드
                if (r.channelSettings) {
                    const airbnb = r.channelSettings.airbnb;
                    if (airbnb) {
                        console.log(`  airbnb.listingId: ${airbnb.listingId || "N/A"}`);
                        console.log(`  airbnb.title: "${airbnb.title || "N/A"}"`);
                    }
                }

                // 중요 필드 전부 출력
                const importantKeys = ["id", "name", "propertyId", "unitGroup"];
                for (const key of importantKeys) {
                    if (r[key] !== undefined && !["name", "propertyId"].includes(key)) {
                        console.log(`  ${key}: ${JSON.stringify(r[key])}`);
                    }
                }
            } else {
                console.log(`  Raw response:`, JSON.stringify(info).substring(0, 300));
            }

            // Airbnb 리뷰 개수
            const reviewCount = await getAirbnbReviewCount(token, rid);
            console.log(`  Airbnb reviews: ${reviewCount}`);

            await new Promise(r => setTimeout(r, 300));
        }
    }

    // 전체 듀얼룸 리뷰 수 요약
    console.log(`\n\n${"=".repeat(60)}`);
    console.log("📊 전체 듀얼룸 Airbnb 리뷰 수 요약");
    console.log("=".repeat(60));

    for (const [building, rooms] of Object.entries(DUAL_ROOMS)) {
        console.log(`\n📍 ${building}:`);
        for (const room of rooms) {
            const counts = [];
            for (const rid of room.ids) {
                const count = await getAirbnbReviewCount(token, rid);
                counts.push(`${rid}=${count}`);
                await new Promise(r => setTimeout(r, 200));
            }
            console.log(`  ${room.room}: ${counts.join(" | ")}`);
        }
    }
}

main().catch(console.error);
