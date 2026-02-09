// Standalone debug script
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Read refresh token from a file or hardcode for test if available (usually I rely on existing files).
// I'll reuse the logic from `check_room_details.js` or similar if valid.
// Wait, `beds24Helper.js` does likely handle token refresh. I should try to use it if I can run it via `firebase functions:shell` or just pure node if env vars are set.
// But `beds24Helper` likely imports `firebase-functions`.
// simpler: I'll use the refresh token I found in `check_price_response.js` (if any) or ask the user / use the existing `check_*.js` structure.
// I see `functions/check_price_response.js` uses `axios` and `REFRESH_TOKEN`. I will copy that pattern.

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";
const CLIENT_KEY = "690a6184-e902-45e0-9104-e58832a50676";


async function getAccessToken() {
    try {
        const response = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: { "refreshToken": REFRESH_TOKEN }
        });
        return response.data.token;
    } catch (e) {
        console.error("Token Error:", e.message);
        return null;
    }
}

async function testSetPrice() {
    const token = await getAccessToken();
    if (!token) return;

    const roomId = 383971; // 201호
    const date = "2026-02-01";
    const testPrice = 12345;

    console.log(`Setting Price for Room ${roomId} on ${date} to ${testPrice}...`);

    const payload = [{
        roomId: roomId,
        calendar: [
            {
                from: date,
                to: date,
                price1: testPrice
            }
        ]
    }];

    try {
        const response = await axios.post("https://beds24.com/api/v2/inventory/rooms/calendar", payload, {
            headers: { "token": token }
        });
        console.log("Set Response:", JSON.stringify(response.data));
    } catch (e) {
        console.error("Set Error:", e.response ? e.response.data : e.message);
    }

    // Verify
    console.log("Verifying...");
    try {
        const response = await axios.get("https://beds24.com/api/v2/inventory/rooms/calendar", {
            headers: { "token": token },
            params: {
                roomId: roomId,
                startDate: date,
                endDate: date,
                includePrices: true
            }
        });
        console.log("Get Response:", JSON.stringify(response.data?.data?.[0]?.calendar?.[0]));
    } catch (e) {
        console.error("Get Error:", e.message);
    }
}

testSetPrice();
