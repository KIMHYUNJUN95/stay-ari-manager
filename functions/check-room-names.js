/**
 * Beds24 API에서 룸 이름/상세정보 가져오기 - 다양한 엔드포인트 시도
 */
const axios = require("axios");

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getToken() {
    const res = await axios.get("https://beds24.com/api/v2/authentication/token", {
        headers: { "refreshToken": REFRESH_TOKEN }
    });
    return res.data.token;
}

const SAMPLE_IDS = [
    { building: "아라키초A", room: "201호", ids: ["383971", "601545"] },
    { building: "가부키초", room: "202호", ids: ["383979", "451220"] },
    { building: "다카다노바바", room: "401호", ids: ["513700", "556719"] },
    { building: "오쿠보C동", room: "오쿠보C", ids: ["450096", "496532", "648399"] },
];

async function tryEndpoint(token, name, url, params) {
    try {
        const res = await axios.get(url, { headers: { "token": token }, params });
        return { success: true, data: res.data };
    } catch (e) {
        return { success: false, status: e.response?.status, error: e.message };
    }
}

async function main() {
    const token = await getToken();
    console.log("Token acquired.\n");

    // 1. 먼저 어떤 엔드포인트가 작동하는지 테스트
    const testRoomId = "383971";
    const testPropertyId = 176430; // 아라키초A

    console.log("=== 엔드포인트 테스트 (roomId: 383971) ===\n");

    const endpoints = [
        { name: "GET /inventory/rooms (by id)", url: "https://beds24.com/api/v2/inventory/rooms", params: { id: testRoomId } },
        { name: "GET /inventory/rooms (by propertyId)", url: "https://beds24.com/api/v2/inventory/rooms", params: { propertyId: testPropertyId } },
        { name: "GET /properties", url: "https://beds24.com/api/v2/properties", params: { id: testPropertyId } },
        { name: "GET /inventory/rooms/list", url: "https://beds24.com/api/v2/inventory/rooms/list", params: { propertyId: testPropertyId } },
    ];

    for (const ep of endpoints) {
        const result = await tryEndpoint(token, ep.name, ep.url, ep.params);
        if (result.success) {
            console.log(`✅ ${ep.name} → OK`);
            const data = result.data;
            if (Array.isArray(data)) {
                console.log(`   ${data.length} items`);
                if (data.length > 0) {
                    // 룸 이름 관련 필드만 출력
                    const first = data[0];
                    const nameFields = Object.keys(first).filter(k =>
                        /name|title|label|desc|room/i.test(k)
                    );
                    console.log(`   Name-related fields: ${nameFields.join(", ") || "none"}`);
                    for (const f of nameFields) {
                        console.log(`   ${f}: ${JSON.stringify(first[f]).substring(0, 200)}`);
                    }
                    // 전체 키 출력
                    console.log(`   All keys: ${Object.keys(first).join(", ")}`);
                }
            } else if (typeof data === "object") {
                const keys = Object.keys(data);
                console.log(`   Keys: ${keys.join(", ")}`);
                // 배열 형태의 값 찾기
                for (const k of keys) {
                    if (Array.isArray(data[k]) && data[k].length > 0) {
                        console.log(`   ${k}[0] keys: ${Object.keys(data[k][0]).join(", ")}`);
                    }
                }
            }
        } else {
            console.log(`❌ ${ep.name} → ${result.status || "error"}: ${result.error}`);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // 2. 성공한 엔드포인트로 전체 룸 정보 가져오기
    console.log("\n\n=== propertyId 기반 룸 목록 조회 ===\n");

    const properties = [
        { name: "아라키초A", v2Id: 176430 },
        { name: "가부키초", v2Id: 176431 },
        { name: "다카다노바바", v2Id: 243936 },
        { name: "오쿠보C동", v2Id: 211056 },
    ];

    for (const prop of properties) {
        console.log(`\n📍 ${prop.name} (propertyId: ${prop.v2Id})`);
        console.log("-".repeat(50));

        const result = await tryEndpoint(token, "", "https://beds24.com/api/v2/inventory/rooms", { propertyId: prop.v2Id });
        if (result.success && Array.isArray(result.data)) {
            for (const room of result.data) {
                console.log(`  roomId: ${room.id} | name: "${room.name}" | qty: ${room.roomQty || "?"} | unitGroup: ${room.unitGroup || "N/A"}`);
            }
        } else {
            console.log(`  Failed: ${result.status || result.error}`);
            // propertyId 기반이 안되면 각 roomId로 개별 시도
            const building = SAMPLE_IDS.find(s => s.building === prop.name);
            if (building) {
                for (const rid of building.ids) {
                    const r2 = await tryEndpoint(token, "", "https://beds24.com/api/v2/inventory/rooms", { id: parseInt(rid) });
                    if (r2.success && Array.isArray(r2.data) && r2.data.length > 0) {
                        const room = r2.data[0];
                        console.log(`  roomId: ${rid} | name: "${room.name}"`);
                    } else {
                        console.log(`  roomId: ${rid} | Failed: ${r2.status || r2.error}`);
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }
        await new Promise(r => setTimeout(r, 300));
    }
}

main().catch(console.error);
