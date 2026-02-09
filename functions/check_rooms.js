const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function checkRooms() {
    console.log("Checking V2 Rooms...");
    try {
        const tokenRes = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: { refreshToken: REFRESH_TOKEN }
        });
        const token = tokenRes.data.token;
        console.log("Got Token.");

        const res = await axios.get("https://beds24.com/api/v2/inventory/rooms", {
            headers: { token: token }
        });

        console.log("Rooms count:", res.data.data ? res.data.data.length : 0);
        if (res.data.data) {
            res.data.data.forEach(r => {
                console.log(`Room: ${r.id} | Name: ${r.name} | Property: ${r.propertyId}`);
            });
        }

    } catch (e) {
        console.error("Error:", e.message);
        if (e.response) {
            console.error("Response:", e.response.data);
        }
    }
}

checkRooms();
