// 로컬 테스트: V2 예약 취소 테스트
const axios = require("axios");

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getToken() {
    const resp = await axios.get("https://beds24.com/api/v2/authentication/token", {
        headers: { "refreshToken": REFRESH_TOKEN }
    });
    return resp.data.token;
}

async function testCancelBooking() {
    try {
        const token = await getToken();
        console.log("토큰 발급 완료\n");

        // 1. 먼저 기존 예약 조회해서 status 필드 확인
        console.log("=== 1. 기존 예약 데이터 조회 ===");
        const getResp = await axios.get("https://beds24.com/api/v2/bookings", {
            headers: { "token": token },
            params: { propertyId: 176430, pageSize: 3 }
        });
        
        if (getResp.data.data && getResp.data.data.length > 0) {
            getResp.data.data.forEach((b, i) => {
                console.log(`\n[${i+1}] id: ${b.id}, status: ${b.status}, guest: ${b.firstName} ${b.lastName}`);
            });
        }

        // 2. 방금 만든 테스트 예약 취소 시도 (id: 81272785)
        console.log("\n=== 2. 예약 취소 테스트 ===");
        
        // 방법 1: status 필드 사용
        const payload1 = [{
            id: 81272785,
            status: "cancelled"
        }];
        console.log("시도 1 (status: cancelled):", JSON.stringify(payload1));
        try {
            const resp1 = await axios.post("https://beds24.com/api/v2/bookings", payload1, {
                headers: { "token": token }
            });
            console.log("응답:", JSON.stringify(resp1.data, null, 2));
        } catch (e) {
            console.log("에러:", e.response?.data || e.message);
        }

    } catch (err) {
        console.error("\n=== ERROR ===");
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Data:", JSON.stringify(err.response.data, null, 2));
        } else {
            console.error("Message:", err.message);
        }
    }
}

testCancelBooking();
