const axios = require('axios');

const API_KEY = "9378AnbjfrIDo3j9MmrQZjwKd"; // From context
const PROP_KEY = "NSoH37aJMipHA4K4MPVyp2pnq"; // Arrakicho A
const ROOM_ID = 601545; // 201_2

async function checkAvailability() {
    try {
        console.log(`Checking availability for Room ${ROOM_ID} (201_2)...`);

        // Payload mirroring the vendor's intent roughly
        const payload = {
            authentication: { apiKey: API_KEY, propKey: PROP_KEY },
            roomId: ROOM_ID,
            checkIn: "20260201", // Future date
            checkOut: "20260202",
            numAdult: 1,
            numChild: 0
        };

        console.log("Payload:", JSON.stringify(payload, null, 2));

        const res = await axios.post("https://api.beds24.com/json/getAvailabilities", payload);

        console.log("Response Status:", res.status);
        console.log("Response Data:", JSON.stringify(res.data, null, 2));

        if (Array.isArray(res.data) && res.data.length > 0) {
            console.log("✅ SUCCESS: Data received.");
        } else if (res.data && res.data.roomId) {
            console.log("✅ SUCCESS: Single object received.");
        } else {
            console.log("❌ FAILURE: No data or empty response.");
        }

    } catch (e) {
        console.error("❌ ERROR:", e.message);
        if (e.response) {
            console.error("API Error Data:", e.response.data);
        }
    }
}

checkAvailability();
