const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";
const ROOM_ID_TO_TEST = 383971; // 아라키초A 201호

async function checkPrice(fromDate, toDate) {
    console.log(`\nChecking dates: ${fromDate} ~ ${toDate}`);
    try {
        const tokenRes = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: { refreshToken: REFRESH_TOKEN }
        });
        const token = tokenRes.data.token;
        // console.log("Got Token.");

        const v2PriceRes = await axios.get("https://beds24.com/api/v2/inventory/rooms/calendar", {
            headers: { token: token },
            params: {
                roomId: ROOM_ID_TO_TEST,
                startDate: fromDate,
                endDate: toDate
            }
        });

        const data = v2PriceRes.data;
        if (data && data.data && data.data.length > 0) {
            const calendar = data.data[0].calendar;
            console.log(`Calendar length: ${calendar ? calendar.length : 'undefined'}`);
            if (calendar && calendar.length > 0) {
                console.log("First day:", JSON.stringify(calendar[0]));
                // Check if price1 is actually in the object keys
                console.log("Keys:", Object.keys(calendar[0]));
            }
        } else {
            console.log("No room data returned");
        }

    } catch (e) {
        console.error("Error:", e.message);
    }
}

async function run() {
    await checkPrice("2025-01-20", "2025-01-25");
    await checkPrice("2026-01-20", "2026-01-25");
}

run();
