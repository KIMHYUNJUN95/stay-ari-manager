/**
 * Beds24 API - 다른 방법으로 룸 이름 조회
 * 1. /channels/airbnb/listings
 * 2. /properties 에서 room 관련 정보
 * 3. booking API에서 room name
 */
const axios = require("axios");

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getToken() {
    const res = await axios.get("https://beds24.com/api/v2/authentication/token", {
        headers: { "refreshToken": REFRESH_TOKEN }
    });
    return res.data.token;
}

async function tryGet(token, endpoint, params) {
    try {
        const res = await axios.get(`https://beds24.com/api/v2${endpoint}`, {
            headers: { "token": token },
            params
        });
        return { ok: true, data: res.data };
    } catch (e) {
        return { ok: false, status: e.response?.status, msg: e.response?.data || e.message };
    }
}

async function main() {
    const token = await getToken();
    console.log("Token acquired.\n");

    const propertyIds = [176430, 176431, 243936, 211056];
    const propertyNames = ["아라키초A", "가부키초", "다카다노바바", "오쿠보C동"];

    // 1. Airbnb listings 엔드포인트
    console.log("=== 1. /channels/airbnb/listings ===\n");
    for (let i = 0; i < propertyIds.length; i++) {
        const r = await tryGet(token, "/channels/airbnb/listings", { propertyId: propertyIds[i] });
        console.log(`${propertyNames[i]}: ${r.ok ? JSON.stringify(r.data).substring(0, 500) : `${r.status} ${JSON.stringify(r.msg).substring(0, 200)}`}`);
        await new Promise(r => setTimeout(r, 300));
    }

    // 2. 채널 설정
    console.log("\n\n=== 2. /channels/airbnb/rooms ===\n");
    const sampleRoomIds = ["383971", "601545", "383979", "451220"];
    for (const rid of sampleRoomIds) {
        const r = await tryGet(token, "/channels/airbnb/rooms", { roomId: parseInt(rid) });
        console.log(`roomId ${rid}: ${r.ok ? JSON.stringify(r.data).substring(0, 500) : `${r.status} ${JSON.stringify(r.msg).substring(0, 200)}`}`);
        await new Promise(r => setTimeout(r, 300));
    }

    // 3. bookings에서 룸 이름 확인 (최근 예약에서 룸 이름 가져오기)
    console.log("\n\n=== 3. /bookings (최근 예약에서 room name 확인) ===\n");
    const dualRoomIds = [
        { building: "아라키초A", room: "201호", ids: ["383971", "601545"] },
        { building: "가부키초", room: "202호", ids: ["383979", "451220"] },
    ];

    for (const dr of dualRoomIds) {
        console.log(`\n📍 ${dr.building} - ${dr.room}:`);
        for (const rid of dr.ids) {
            const r = await tryGet(token, "/bookings", {
                roomId: parseInt(rid),
                arrivalFrom: "2025-01-01",
                arrivalTo: "2026-03-09",
                includeInvoice: false,
                pageSize: 1
            });
            if (r.ok && Array.isArray(r.data?.data) && r.data.data.length > 0) {
                const b = r.data.data[0];
                console.log(`  roomId ${rid}:`);
                console.log(`    roomId in booking: ${b.roomId}`);
                console.log(`    unitName: "${b.unitName || "N/A"}"`);
                console.log(`    roomName: "${b.roomName || "N/A"}"`);
                console.log(`    name: "${b.name || "N/A"}"`);
                // 모든 키 중 room/unit/name 관련
                const nameKeys = Object.keys(b).filter(k => /room|unit|name|title|listing/i.test(k));
                for (const k of nameKeys) {
                    if (!["roomId", "unitName", "roomName", "name"].includes(k)) {
                        console.log(`    ${k}: ${JSON.stringify(b[k]).substring(0, 200)}`);
                    }
                }
            } else {
                console.log(`  roomId ${rid}: ${r.ok ? "No bookings" : r.status}`);
            }
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // 4. V2 room 상세 - POST 방식도 시도
    console.log("\n\n=== 4. POST /inventory/rooms (시도) ===\n");
    try {
        const res = await axios.post("https://beds24.com/api/v2/inventory/rooms",
            { id: [383971, 601545] },
            { headers: { "token": token, "Content-Type": "application/json" } }
        );
        console.log("POST result:", JSON.stringify(res.data).substring(0, 500));
    } catch (e) {
        console.log(`POST failed: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message).substring(0, 300)}`);
    }
}

main().catch(console.error);
