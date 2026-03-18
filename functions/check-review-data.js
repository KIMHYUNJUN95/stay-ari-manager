/**
 * Firestore에서 리뷰 데이터 확인 - reviewerName, createdAt 필드 체크
 */
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function main() {
    // Airbnb 리뷰 5개 샘플
    const airbnbSnap = await db.collection("reviews")
        .where("channel", "==", "airbnb")
        .limit(5)
        .get();

    console.log("=== Airbnb 리뷰 샘플 (최근 동기화 후) ===\n");
    airbnbSnap.docs.forEach(doc => {
        const d = doc.data();
        console.log(`ID: ${doc.id}`);
        console.log(`  building: ${d.building}, room: ${d.roomName}`);
        console.log(`  reviewerName: ${d.reviewerName}`);
        console.log(`  reviewerId: ${d.reviewerId}`);
        console.log(`  createdAt: ${d.createdAt}`);
        console.log(`  rawScore: ${d.rawScore}, score: ${d.score}`);
        console.log(`  syncedAt: ${d.syncedAt?.toDate?.()}`);
        console.log("");
    });

    // Booking 리뷰 2개 샘플
    const bookingSnap = await db.collection("reviews")
        .where("channel", "==", "booking")
        .limit(2)
        .get();

    console.log("=== Booking.com 리뷰 샘플 ===\n");
    bookingSnap.docs.forEach(doc => {
        const d = doc.data();
        console.log(`ID: ${doc.id}`);
        console.log(`  building: ${d.building}`);
        console.log(`  reviewerName: ${d.reviewerName}`);
        console.log(`  createdAt: ${d.createdAt}`);
        console.log(`  score: ${d.score}`);
        console.log("");
    });

    // 통계: createdAt이 null인 리뷰 수
    const allSnap = await db.collection("reviews")
        .where("companyId", "==", "stay_ari")
        .get();

    let airbnbTotal = 0, airbnbNoDate = 0, airbnbNoName = 0;
    let bookingTotal = 0, bookingNoDate = 0;
    allSnap.docs.forEach(doc => {
        const d = doc.data();
        if (d.channel === "airbnb") {
            airbnbTotal++;
            if (!d.createdAt) airbnbNoDate++;
            if (!d.reviewerName) airbnbNoName++;
        } else if (d.channel === "booking") {
            bookingTotal++;
            if (!d.createdAt) bookingNoDate++;
        }
    });

    console.log("=== 통계 ===");
    console.log(`Airbnb: ${airbnbTotal}건 (날짜없음: ${airbnbNoDate}, 이름없음: ${airbnbNoName})`);
    console.log(`Booking: ${bookingTotal}건 (날짜없음: ${bookingNoDate})`);
}

main().catch(console.error);
