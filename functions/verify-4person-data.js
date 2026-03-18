const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function verifyData() {
  const startDate = '2025-02-18';
  const endDate = '2026-02-18';
  const threePersonRooms = ['502호', '603호', '802호', '803호'];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('가부키초 4인실 데이터 검증');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  console.log('총 확정 예약:', snapshot.size, '건');
  console.log('');

  const roomData = {};
  let kabukichoCount = 0;
  let fourPersonRoomCount = 0;

  snapshot.forEach(doc => {
    const data = doc.data();

    // 가부키초만
    if (data.building !== '가부키초') return;
    kabukichoCount++;

    const room = data.room;

    // 3인실 제외
    if (threePersonRooms.includes(room)) return;

    if (!data.arrival || !data.departure) return;
    if (data.arrival < startDate || data.arrival > endDate) return;

    fourPersonRoomCount++;

    if (!roomData[room]) {
      roomData[room] = {
        total: 0,
        bookings: []
      };
    }

    const numAdult = data.numAdult || 0;
    const numChild = data.numChild || 0;
    const totalGuests = numAdult + numChild;

    roomData[room].total++;
    roomData[room].bookings.push({
      id: doc.id,
      arrival: data.arrival,
      departure: data.departure,
      guests: totalGuests,
      guestName: data.guestName
    });
  });

  console.log('가부키초 전체 예약:', kabukichoCount, '건');
  console.log('4인실 예약 (기간 내, 3인실 제외):', fourPersonRoomCount, '건');
  console.log('');

  // 방별 상세 정보
  const sortedRooms = Object.keys(roomData).sort();

  console.log('방별 예약 건수:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  sortedRooms.forEach(room => {
    const data = roomData[room];
    console.log(`\n[${room}] 총 ${data.total}건`);

    // 첫 5건 샘플
    console.log('  샘플 (최근 5건):');
    const samples = data.bookings
      .sort((a, b) => b.arrival.localeCompare(a.arrival))
      .slice(0, 5);

    samples.forEach((b, idx) => {
      console.log(`    ${idx + 1}. ${b.arrival} ~ ${b.departure} | ${b.guestName} | ${b.guests}인 | ID: ${b.id.substring(0, 8)}...`);
    });
  });

  console.log('\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('요약:');
  sortedRooms.forEach(room => {
    console.log(`  ${room}: ${roomData[room].total}건`);
  });

  const total = sortedRooms.reduce((sum, room) => sum + roomData[room].total, 0);
  console.log(`  합계: ${total}건`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(0);
}

verifyData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
