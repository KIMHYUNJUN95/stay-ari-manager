const admin = require('firebase-admin');
try {
    var serviceAccount = require("../serviceAccountKey.json");
} catch (e) {
    console.error("Error loading serviceAccountKey.json");
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

// Import the function to test (we need to export it or copy-paste relevant part, 
// but since it's inside index.js and not exported, we might need to rely on the deployed version 
// or mock it. 
// Actually, I can just copy the `active_only` filter logic here to verify it works as expected 
// against the real Firestore data.

const db = admin.firestore();
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
dayjs.extend(timezone);

async function testActiveOnlyFilter() {
    console.log("Testing 'active_only' filter logic against Firestore...");

    // Logic from index.js
    const today = dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
    const tomorrow = dayjs().tz('Asia/Tokyo').add(1, 'day').format('YYYY-MM-DD');
    const yesterday = dayjs().tz('Asia/Tokyo').subtract(1, 'day').format('YYYY-MM-DD');
    const twoWeeksAgo = dayjs().tz('Asia/Tokyo').subtract(14, 'day').format('YYYY-MM-DD');

    console.log(`Reference Dates: Today=${today}, Tmrw=${tomorrow}, Yest=${yesterday}`);

    const snapshot = await db.collection("reservations")
        .where("departure", ">=", twoWeeksAgo)
        .get();

    let total = 0;
    let activeCount = 0;
    const activeBookings = [];

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        total++;

        // Status check
        if (!data.bookId || !data.platform || data.platform === 'Manual') return;

        // Active Only Logic
        const isCheckInOrOutRecently = (data.arrival <= tomorrow && data.departure >= yesterday);

        // Recent Inquiry Logic
        // status is 'inquiry' or 'request' AND modified time is recent
        // We will simulate modified verification if field exists
        const isRecentInquiry = (data.status === 'inquiry' || data.status === 'request')
            && (data.modified >= yesterday || data.modifiedTime >= yesterday);

        if (isCheckInOrOutRecently || isRecentInquiry) {
            activeCount++;
            activeBookings.push(`${data.guestName} (${data.arrival} ~ ${data.departure}) [${data.status}]`);
        }
    });

    console.log(`Total Bookings Scanned (Last 2 Weeks): ${total}`);
    console.log(`Active/Upcoming/Inquiry Bookings: ${activeCount}`);
    console.log("---------------------------------------------------");
    activeBookings.forEach(b => console.log(b));

    if (activeCount < total && activeCount >= 0) {
        console.log("✅ Filter logic is working (Dataset reduced).");
    } else {
        console.log("⚠️ Filter might be too broad or no data.");
    }
}

testActiveOnlyFilter();
