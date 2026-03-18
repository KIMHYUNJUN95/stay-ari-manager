var admin = require("firebase-admin");
var sa = require("./serviceAccountKey.json");
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
var db = admin.firestore();

db.collection("reviews").where("companyId", "==", "stay_ari").get().then(function(snap) {
    var airbnb = 0, booking = 0;
    var airbnbDates = [], bookingDates = [];
    snap.docs.forEach(function(d) {
        var data = d.data();
        if (data.channel === "airbnb") {
            airbnb++;
            if (data.createdAt) airbnbDates.push(data.createdAt.substring(0, 10));
        } else {
            booking++;
            if (data.createdAt) bookingDates.push(data.createdAt.substring(0, 10));
        }
    });
    airbnbDates.sort();
    bookingDates.sort();
    console.log("Airbnb: " + airbnb + "건 (" + (airbnbDates[0] || "?") + " ~ " + (airbnbDates[airbnbDates.length-1] || "?") + ")");
    console.log("Booking: " + booking + "건 (" + (bookingDates[0] || "?") + " ~ " + (bookingDates[bookingDates.length-1] || "?") + ")");

    // 아라키초A 201호 최신 5개
    var a201 = snap.docs.map(function(d) { return d.data(); })
        .filter(function(r) { return r.channel === "airbnb" && r.building === "아라키초A" && r.roomName === "201호"; })
        .sort(function(a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); });
    console.log("\n아라키초A 201호 최신 5개:");
    a201.slice(0, 5).forEach(function(r, i) {
        console.log("  " + (i+1) + ". " + (r.createdAt || "null").substring(0, 19) + " | score:" + r.rawScore + " | " + (r.reviewerName || "?") + " | roomId:" + r.roomId);
    });
});
