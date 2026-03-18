const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function checkStatusMismatch() {
    console.log("🔍 Checking for records with cancelTime in Feb but status !== 'cancelled'...");

    const snap = await db.collection('reservations')
        .limit(5000)
        .get();

    let count = 0;
    snap.forEach(doc => {
        const d = doc.data();
        const time = d.cancelTime || "";
        if (time.startsWith('2026-02') && d.status !== 'cancelled') {
            count++;
            if (count < 10) console.log(`- ID: ${doc.id}, Status: ${d.status}, CancelTime: ${d.cancelTime}`);
        }
    });

    console.log(`📊 Total mismatches: ${count}`);
}

checkStatusMismatch();
