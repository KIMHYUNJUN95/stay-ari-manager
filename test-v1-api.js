const axios = require("axios");

async function testV1API() {
    try {
        const response = await axios.post("https://api.beds24.com/json/getRoomDates", {
            authentication: {
                apiKey: "9378AnbjfrIDo3j9MmrQZjwKd",
                propKey: "NSoH37aJMipHA4K4MPVyp2pnq"
            },
            roomId: "383971",
            from: "20260120",
            to: "20260125"
        });

        console.log("=== V1 getRoomDates 테스트 결과 ===");
        console.log("상태: 성공");
        console.log("데이터:", JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log("=== V1 getRoomDates 테스트 결과 ===");
        console.log("상태: 실패");
        console.log("에러 코드:", error.response?.status || "네트워크 에러");
        console.log("에러 메시지:", error.message);
        if (error.response?.data) {
            console.log("응답 데이터:", error.response.data);
        }
    }
}

testV1API();
