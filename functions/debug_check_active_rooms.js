const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

const ROOMS_TO_CHECK = [
    { id: 383971, name: "201호 (ID: 383971)" },
    { id: 601545, name: "201호 (ID: 601545)" }
];

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

async function checkActiveRooms() {
    const token = await getAccessToken();
    if (!token) return;

    for (const room of ROOMS_TO_CHECK) {
        console.log(`Checking Room: ${room.name}...`);
        try {
            const response = await axios.get("https://beds24.com/api/v2/inventory/rooms/calendar", {
                headers: { "token": token },
                params: {
                    roomId: room.id,
                    startDate: new Date().toISOString().slice(0, 10),
                    endDate: new Date().toISOString().slice(0, 10),
                    includeMinStay: true
                }
            });

            const data = response.data;
            if (data && data.data && data.data.length > 0 && data.data[0].calendar && data.data[0].calendar.length > 0) {
                const day = data.data[0].calendar[0];
                const minStay = day.minStay;
                console.log(`  - MinStay: ${minStay}`);

                if (minStay < 50) {
                    console.log("  => ACTIVE (Success)");
                } else {
                    console.log("  => INACTIVE (Skipped by logic)");
                }
            } else {
                console.log("  - No calendar data or empty.");
            }

        } catch (e) {
            console.error(`  - Error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
}

checkActiveRooms();
