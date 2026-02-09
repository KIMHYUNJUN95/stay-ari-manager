const axios = require('axios');

const V1_API_KEY = "9378AnbjfrIDo3j9MmrQZjwKd";
const V1_PROP_KEY = "NSoH37aJMipHA4K4MPVyp2pnq"; // 아라키초A
const ROOM_ID = "383971"; // 201호
// Dates from the user's screenshot (Jan 2026)
const FROM = "20260122";
const TO = "20260130";

async function checkV1() {
    console.log("Checking V1 Prices (getRoomDates)...");
    try {
        const response = await axios.post("https://api.beds24.com/json/getRoomDates", {
            authentication: {
                apiKey: V1_API_KEY,
                propKey: V1_PROP_KEY
            },
            roomId: ROOM_ID,
            from: FROM,
            to: TO
        });

        const data = response.data;
        console.log("V1 Response Keys:", Object.keys(data));

        // V1 returns { "20260122": { p1: ..., p2: ... }, ... }
        if (data && typeof data === 'object') {
            const dates = Object.keys(data).sort();
            console.log(`Received ${dates.length} days.`);
            dates.forEach(d => {
                const day = data[d];
                console.log(`[${d}] p1:${day.p1} | p2:${day.p2} | p3:${day.p3} | p4:${day.p4} | o1:${day.o1} | o2:${day.o2}`);
            });
        }
    } catch (e) {
        console.error("V1 Error:", e.message);
        if (e.response) console.error(e.response.data);
    }
}

checkV1();
