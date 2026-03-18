const admin = require('firebase-admin');
const dayjs = require('dayjs');
const serviceAccount = require('./functions/serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const TARGET_YEAR = 2026;
const TARGET_MONTH = 2; // Feb

async function analyzePlatformRatio() {
    console.log(`\n📊 [Platform Ratio Analysis] ${TARGET_YEAR}-${TARGET_MONTH} 분석 시작...`);

    const startStr = `${TARGET_YEAR}-${String(TARGET_MONTH).padStart(2, '0')}-01`;
    const lastDay = new Date(TARGET_YEAR, TARGET_MONTH, 0).getDate();
    const endStr = `${TARGET_YEAR}-${String(TARGET_MONTH).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    console.log(`   대상 기간 (Check-in 기준): ${startStr} ~ ${endStr}`);

    // 1. Fetch reservations arriving in the target month
    const snap = await db.collection('reservations')
        .where('arrival', '>=', startStr)
        .where('arrival', '<=', endStr)
        .where('status', '==', 'confirmed')
        .get();

    const buildings = {};

    snap.forEach(doc => {
        const data = doc.data();
        const building = data.building || "Unknown";
        let platform = data.platform || "Direct";

        // Normalize platform names based on previous logic
        const source = (data.referer || data.referrer || data.apiSource || "").toLowerCase();
        if (source.includes("airbnb")) platform = "Airbnb";
        else if (source.includes("booking")) platform = "Booking.com";
        else if (source.includes("expedia")) platform = "Expedia";
        else if (source.includes("agoda")) platform = "Agoda";
        else if (source.includes("direct") || source.includes("manual") || platform === "Direct") platform = "Direct";

        if (!buildings[building]) {
            buildings[building] = {
                totalRevenue: 0,
                totalBookings: 0,
                platforms: {}
            };
        }

        if (!buildings[building].platforms[platform]) {
            buildings[building].platforms[platform] = { revenue: 0, count: 0 };
        }

        const price = Number(data.price || data.totalPrice || 0);
        buildings[building].totalRevenue += price;
        buildings[building].totalBookings += 1;
        buildings[building].platforms[platform].revenue += price;
        buildings[building].platforms[platform].count += 1;
    });

    console.log("\n--- 건물별 플랫폼 비중 (매출 기준) ---");

    // Sort and output
    Object.entries(buildings).sort((a, b) => b[1].totalRevenue - a[1].totalRevenue).forEach(([name, stats]) => {
        console.log(`\n🏢 ${name} (총 매출: ¥${stats.totalRevenue.toLocaleString()}, 건수: ${stats.totalBookings}건)`);

        Object.entries(stats.platforms)
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .forEach(([p, pStats]) => {
                const ratio = ((pStats.revenue / stats.totalRevenue) * 100).toFixed(1);
                console.log(`   - ${p.padEnd(12)}: ¥${pStats.revenue.toLocaleString().padStart(10)} (${ratio}%) / ${pStats.count}건`);
            });
    });

    console.log("\n--- 전체 요약 ---");
    const totalStats = { revenue: 0, bookings: 0, platforms: {} };
    Object.values(buildings).forEach(b => {
        totalStats.revenue += b.totalRevenue;
        totalStats.bookings += b.totalBookings;
        Object.entries(b.platforms).forEach(([p, s]) => {
            if (!totalStats.platforms[p]) totalStats.platforms[p] = { revenue: 0, count: 0 };
            totalStats.platforms[p].revenue += s.revenue;
            totalStats.platforms[p].count += s.count;
        });
    });

    console.log(`🌍 전체 실적 (매출: ¥${totalStats.revenue.toLocaleString()}, 건수: ${totalStats.bookings}건)`);
    Object.entries(totalStats.platforms)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .forEach(([p, s]) => {
            const ratio = ((s.revenue / totalStats.revenue) * 100).toFixed(1);
            console.log(`   - ${p.padEnd(12)}: ¥${s.revenue.toLocaleString().padStart(10)} (${ratio}%) / ${s.count}건`);
        });

    process.exit(0);
}

analyzePlatformRatio().catch(err => {
    console.error(err);
    process.exit(1);
});
