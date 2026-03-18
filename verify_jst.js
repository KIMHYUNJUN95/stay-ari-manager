const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function checkJSTCounts() {
    console.log("🔍 Checking Daily Counts with JST Correction...");

    const snap = await db.collection('reservations')
        .select('status', 'price', 'cancelTime', 'modified', 'arrival')
        .orderBy('updatedAt', 'desc')
        .limit(5000)
        .get();

    const all = [];
    snap.forEach(doc => all.push(doc.data()));

    const dailyCounts = {};
    const dailyCountsWithPrice = {};

    all.forEach(d => {
        if (d.status === 'cancelled') {
            const rawTime = d.cancelTime || d.modified || "";
            if (!rawTime) return;

            const jst = dayjs(rawTime).tz("Asia/Tokyo");
            const jstDate = jst.format("YYYY-MM-DD");

            if (jstDate.startsWith('2026-02')) {
                if (!dailyCounts[jstDate]) {
                    dailyCounts[jstDate] = 0;
                    dailyCountsWithPrice[jstDate] = 0;
                }
                dailyCounts[jstDate]++;
                if ((Number(d.price) || 0) > 0) dailyCountsWithPrice[jstDate]++;
            }
        }
    });

    console.log(`📊 Processed ${all.length} records.`);

    const results = [];
    for (let i = 1; i <= 20; i++) {
        const d = `2026-02-${String(i).padStart(2, '0')}`;
        results.push({
            Date: d,
            'All (Incl 0)': dailyCounts[d] || 0,
            'Price > 0 Only': dailyCountsWithPrice[d] || 0
        });
    }
    console.table(results);
}

checkJSTCounts();
