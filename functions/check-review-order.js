const admin = require("firebase-admin");
const sa = require("./serviceAccountKey.json");
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function main() {
    const snap = await db.collection("reviews")
        .where("companyId", "==", "stay_ari")
        .where("channel", "==", "airbnb")
        .get();

    const reviews = snap.docs.map(d => d.data())
        .filter(r => r.building === "아라키초A" && r.roomName === "201호" && r.roomId === "383971")
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    console.log("아라키초A 201호 (roomId:383971) 최신순 10개:");
    reviews.slice(0, 10).forEach((r, i) => {
        const date = r.createdAt ? r.createdAt.substring(0, 19) : "null";
        console.log("  " + (i+1) + ". " + date + " | score:" + r.rawScore + " | " + (r.reviewerName || "no name"));
    });
    console.log("  총 " + reviews.length + "건");

    // 날짜 null 체크
    const allAirbnb = snap.docs.map(d => d.data());
    const noDate = allAirbnb.filter(r => !r.createdAt);
    console.log("\nAirbnb 전체: " + allAirbnb.length + "건, 날짜없음: " + noDate.length + "건");

    // 날짜 범위
    const dates = allAirbnb.filter(r => r.createdAt).map(r => r.createdAt.substring(0, 10)).sort();
    if (dates.length > 0) {
        console.log("가장 오래된: " + dates[0]);
        console.log("가장 최신: " + dates[dates.length - 1]);
    }
}
main().catch(console.error);
