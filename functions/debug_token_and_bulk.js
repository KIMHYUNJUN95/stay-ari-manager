const https = require('https');
const admin = require('firebase-admin');

try {
    var serviceAccount = require("../serviceAccountKey.json");
} catch (e) {
    console.log("Error loading serviceAccountKey");
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

function httpsRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    console.log("Raw Data:", data);
                    parsed = data;
                }
                resolve({ statusCode: res.statusCode, data: parsed });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function runDebug() {
    try {
        console.log("Getting token...");
        const doc = await db.collection('settings').doc('beds24_token').get();
        if (!doc.exists) {
            console.log("No token found");
            return;
        }
        const token = doc.data().token;

        // Check authentication details
        console.log("Checking token details...");
        const details = await httpsRequest({
            hostname: 'beds24.com',
            path: '/api/v2/authentication/details',
            method: 'GET',
            headers: { 'token': token }
        });
        console.log("Details Status:", details.statusCode);
        // console.log("Details Data:", JSON.stringify(details.data, null, 2));

        // Attempt to get bookings directly
        console.log("Getting bookings...");
        const bookings = await httpsRequest({
            hostname: 'beds24.com',
            path: '/api/v2/bookings?page=1&arrivalFrom=2024-01-01', // Ensure we get something
            method: 'GET',
            headers: { 'token': token }
        });

        console.log("Bookings Status:", bookings.statusCode);

        if (bookings.data && bookings.data.data && bookings.data.data.length > 0) {
            console.log(`Found ${bookings.data.data.length} bookings.`);
            const b = bookings.data.data[0];
            const propId = b.propertyId;
            console.log(`Sample Booking ID: ${b.id}, Property ID: ${propId}`);

            // Try bulk messages for this property
            console.log(`Testing Bulk Messages for Property ${propId}...`);
            const propMsgs = await httpsRequest({
                hostname: 'beds24.com',
                path: `/api/v2/bookings/messages?propertyId=${propId}&maxAge=3`,
                method: 'GET',
                headers: { 'token': token }
            });
            console.log("Prop Messages Status:", propMsgs.statusCode);
            console.log("Prop Messages Count:", propMsgs.data.count);
            if (propMsgs.data.data && propMsgs.data.data.length > 0) {
                console.log("Message Sample:", propMsgs.data.data[0]);
            }
        } else {
            console.log("No bookings returned.");
            // If bookings failed, maybe property list failed too?
            console.log("Bookings Data:", JSON.stringify(bookings.data));
        }

    } catch (e) {
        console.error("Debug Error:", e);
    }
}

runDebug();
