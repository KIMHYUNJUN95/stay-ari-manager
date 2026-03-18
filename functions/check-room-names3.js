/**
 * Beds24 V1 API로 룸 이름 조회 시도
 * V1은 getRoomSetup 등으로 룸 이름을 가져올 수 있을 수 있음
 */
const axios = require("axios");

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getToken() {
    const res = await axios.get("https://beds24.com/api/v2/authentication/token", {
        headers: { "refreshToken": REFRESH_TOKEN }
    });
    return res.data.token;
}

async function main() {
    const token = await getToken();
    console.log("Token acquired.\n");

    // V2 properties에서 room 정보 시도 (rooms 파라미터 포함)
    console.log("=== /properties with rooms ===\n");
    const propertyIds = [176430, 176431, 243936, 211056];
    const names = ["아라키초A", "가부키초", "다카다노바바", "오쿠보C동"];

    for (let i = 0; i < propertyIds.length; i++) {
        try {
            const res = await axios.get("https://beds24.com/api/v2/properties", {
                headers: { "token": token },
                params: { id: propertyIds[i] }
            });
            const data = res.data?.data?.[0];
            if (data) {
                console.log(`📍 ${names[i]}: "${data.name}"`);
                // 룸 관련 키 찾기
                const roomKeys = Object.keys(data).filter(k => /room/i.test(k));
                for (const k of roomKeys) {
                    console.log(`  ${k}: ${JSON.stringify(data[k]).substring(0, 300)}`);
                }
            }
        } catch (e) {
            console.log(`${names[i]}: error ${e.response?.status}`);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // V2 inventory/rooms/setup 같은 다른 경로 시도
    console.log("\n\n=== 다양한 inventory 엔드포인트 시도 ===\n");
    const inventoryEndpoints = [
        "/inventory/rooms/setup",
        "/inventory/rooms/details",
        "/inventory/rooms/info",
        "/inventory/units",
    ];

    for (const ep of inventoryEndpoints) {
        try {
            const res = await axios.get(`https://beds24.com/api/v2${ep}`, {
                headers: { "token": token },
                params: { propertyId: 176430 }
            });
            console.log(`✅ ${ep}: ${JSON.stringify(res.data).substring(0, 300)}`);
        } catch (e) {
            console.log(`❌ ${ep}: ${e.response?.status || e.message}`);
        }
        await new Promise(r => setTimeout(r, 200));
    }

    // Airbnb listing 정보를 roomId로 가져오기
    console.log("\n\n=== /channels/airbnb/listings (roomId별) ===\n");
    const sampleRoomIds = ["383971", "601545", "383979", "451220"];
    for (const rid of sampleRoomIds) {
        try {
            const res = await axios.get("https://beds24.com/api/v2/channels/airbnb/listings", {
                headers: { "token": token },
                params: { roomId: parseInt(rid) }
            });
            console.log(`roomId ${rid}: ${JSON.stringify(res.data).substring(0, 500)}`);
        } catch (e) {
            console.log(`roomId ${rid}: ${e.response?.status} ${JSON.stringify(e.response?.data || "").substring(0, 200)}`);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // Airbnb listing 상세 - listing_id로
    console.log("\n\n=== /channels/airbnb/listings (listing_id별) ===\n");
    // 아라키초A 201호의 두 listing_id
    const listingIds = [
        { rid: "383971", listingId: "31627968" },
        { rid: "601545", listingId: "1475641369123867060" },
        { rid: "383979", listingId: "674791405856669260" },
        { rid: "451220", listingId: "1004589512654505656" },
    ];
    for (const l of listingIds) {
        try {
            const res = await axios.get("https://beds24.com/api/v2/channels/airbnb/listings", {
                headers: { "token": token },
                params: { listingId: l.listingId }
            });
            const data = res.data;
            if (data && typeof data === "object") {
                // 이름 관련 필드 찾기
                const flat = Array.isArray(data.data) ? data.data[0] : data;
                if (flat) {
                    const nameKeys = Object.keys(flat).filter(k => /name|title|label/i.test(k));
                    console.log(`listing ${l.listingId} (room ${l.rid}):`);
                    console.log(`  All keys: ${Object.keys(flat).join(", ")}`);
                    for (const k of nameKeys) {
                        console.log(`  ${k}: "${flat[k]}"`);
                    }
                }
            } else {
                console.log(`listing ${l.listingId}: ${JSON.stringify(data).substring(0, 300)}`);
            }
        } catch (e) {
            console.log(`listing ${l.listingId}: ${e.response?.status} ${JSON.stringify(e.response?.data || "").substring(0, 200)}`);
        }
        await new Promise(r => setTimeout(r, 300));
    }
}

main().catch(console.error);
