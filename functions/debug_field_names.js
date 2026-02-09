const axios = require('axios');

const API_KEY = "9378AnbjfrIDo3j9MmrQZjwKd";
const PROP_KEY = "3ldwEucRNOIyhAdAhFWbBhw3e"; // Kabukicho
const ROOM_ID = "451220";

async function checkFields() {
    try {
        console.log("Fetching getRoomDates...");
        const response = await axios.post("https://api.beds24.com/json/getRoomDates", {
            authentication: { apiKey: API_KEY, propKey: PROP_KEY },
            roomId: ROOM_ID,
            from: "20250201",
            to: "20250205"
        });

        if (response.data && typeof response.data === 'object' && !response.data.error) {
            const keys = Object.keys(response.data);
            if (keys.length > 0) {
                const sampleDate = keys[0];
                const sampleData = response.data[sampleDate];
                console.log(`Sample Date: ${sampleDate}`);
                console.log("Keys:", JSON.stringify(Object.keys(sampleData)));
            } else {
                console.log("Empty response data.");
            }
        } else {
            console.log("Response / Error:", JSON.stringify(response.data));
        }

    } catch (e) {
        console.error("Error:", e.message);
    }
}

checkFields();
