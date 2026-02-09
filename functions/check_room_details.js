const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";
const ROOM_ID_TO_TEST = 383971; // 아라키초A 201호

async function checkRoomDetails() {
    console.log("Checking Room Details...");
    try {
        const tokenRes = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: { refreshToken: REFRESH_TOKEN }
        });
        const token = tokenRes.data.token;

        console.log(`Fetching Room ${ROOM_ID_TO_TEST}...`);
        const res = await axios.get("https://beds24.com/api/v2/inventory/rooms", {
            headers: { token: token },
            params: { roomId: ROOM_ID_TO_TEST }
        });

        if (res.data.data && res.data.data.length > 0) {
            const room = res.data.data[0];
            console.log("Room Object Keys:", Object.keys(room));
            console.log("Price related fields:", {
                price: room.price,
                defaultPrice: room.defaultPrice,
                price1: room.price1,
                minPrice: room.minPrice,
                prices: room.prices
            });
            console.log("Full Object:", JSON.stringify(room, null, 2));
        } else {
            console.log("Room not found");
        }

    } catch (e) {
        console.error("Error:", e.message);
    }
}

checkRoomDetails();
