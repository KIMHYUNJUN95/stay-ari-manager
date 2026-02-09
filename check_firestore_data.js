const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json'); // I'll assume I might not have it, or I can use default credentials if on a GCP env

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

async function inspect() {
    const buildings = ["가부키초", "아라키초A", "아라키초B"];
    for (const b of buildings) {
        const doc = await db.collection("price_sync").doc(b).get();
        if (!doc.exists) {
            console.log(`Building ${b}: Document DOES NOT EXIST`);
            continue;
        }
        const data = doc.data();
        console.log(`Building ${b}:`);
        console.log(` - roomCount field: ${data.roomCount}`);
        console.log(` - priceData keys: ${Object.keys(data.priceData || {}).length}`);
        if (data.priceData) {
            const firstRoomId = Object.keys(data.priceData)[0];
            if (firstRoomId) {
                const room = data.priceData[firstRoomId];
                const dateKeys = Object.keys(room.dates || {});
                console.log(` - First Room (${room.roomName}): ${dateKeys.length} dates`);
                console.log(` - First 5 dates: ${dateKeys.slice(0, 5).join(", ")}`);
                console.log(` - Last 5 dates: ${dateKeys.slice(-5).join(", ")}`);
            }
        }
    }
    process.exit(0);
}

inspect();
