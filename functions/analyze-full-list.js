const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function analyzeFullList() {
  const startDate = '2025-02-18';
  const endDate = '2026-02-18';
  const threePersonRooms = ['502호', '603호', '802호', '803호'];

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  const roomStats = {};
  threePersonRooms.forEach(room => {
    roomStats[room] = {
      oneGuest: [],
      twoGuests: [],
      threeGuests: []
    };
  });

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.building !== '가부키초') return;
    const room = data.room;
    if (!threePersonRooms.includes(room)) return;
    if (!data.arrival || !data.departure) return;
    if (data.arrival < startDate || data.arrival > endDate) return;

    const numAdult = data.numAdult || 0;
    const numChild = data.numChild || 0;
    const totalGuests = numAdult + numChild;

    const booking = {
      arrival: data.arrival,
      departure: data.departure,
      guestName: data.guestName || '(이름없음)',
      adults: numAdult,
      children: numChild,
      platform: data.platform || 'Unknown',
      bookId: doc.id
    };

    if (totalGuests === 1) {
      roomStats[room].oneGuest.push(booking);
    } else if (totalGuests === 2) {
      roomStats[room].twoGuests.push(booking);
    } else if (totalGuests === 3) {
      roomStats[room].threeGuests.push(booking);
    }
  });

  // 날짜순 정렬
  threePersonRooms.forEach(room => {
    roomStats[room].oneGuest.sort((a, b) => a.arrival.localeCompare(b.arrival));
    roomStats[room].twoGuests.sort((a, b) => a.arrival.localeCompare(b.arrival));
    roomStats[room].threeGuests.sort((a, b) => a.arrival.localeCompare(b.arrival));
  });

  // 출력
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('가부키초 3인실 상세 예약 리스트 (2025-02-18 ~ 2026-02-18)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  threePersonRooms.forEach(room => {
    const stats = roomStats[room];
    const total = stats.oneGuest.length + stats.twoGuests.length + stats.threeGuests.length;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`【${room}】 총 ${total}건 (1인: ${stats.oneGuest.length}, 2인: ${stats.twoGuests.length}, 3인: ${stats.threeGuests.length})`);
    console.log('═══════════════════════════════════════════════════════════════');

    // 1인 예약
    if (stats.oneGuest.length > 0) {
      console.log('');
      console.log(`【1인 예약 - ${stats.oneGuest.length}건】`);
      console.log('─────────────────────────────────────────────────────────────');
      stats.oneGuest.forEach((b, idx) => {
        console.log(`${idx + 1}. ${b.arrival} ~ ${b.departure} | ${b.guestName} | ${b.adults}명(성인${b.adults}, 아동${b.children}) | ${b.platform}`);
      });
    }

    // 2인 예약
    if (stats.twoGuests.length > 0) {
      console.log('');
      console.log(`【2인 예약 - ${stats.twoGuests.length}건】`);
      console.log('─────────────────────────────────────────────────────────────');
      stats.twoGuests.forEach((b, idx) => {
        console.log(`${idx + 1}. ${b.arrival} ~ ${b.departure} | ${b.guestName} | ${b.adults}명(성인${b.adults}, 아동${b.children}) | ${b.platform}`);
      });
    }

    // 3인 예약
    if (stats.threeGuests.length > 0) {
      console.log('');
      console.log(`【3인 예약 - ${stats.threeGuests.length}건】`);
      console.log('─────────────────────────────────────────────────────────────');
      stats.threeGuests.forEach((b, idx) => {
        console.log(`${idx + 1}. ${b.arrival} ~ ${b.departure} | ${b.guestName} | ${b.adults}명(성인${b.adults}, 아동${b.children}) | ${b.platform}`);
      });
    }
  });

  // 전체 요약 (CSV)
  console.log('');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CSV 형식 (엑셀 복사용)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('방,체크인,체크아웃,게스트명,인원수,성인,아동,플랫폼');

  threePersonRooms.forEach(room => {
    const allBookings = [
      ...roomStats[room].oneGuest,
      ...roomStats[room].twoGuests,
      ...roomStats[room].threeGuests
    ].sort((a, b) => a.arrival.localeCompare(b.arrival));

    allBookings.forEach(b => {
      const total = b.adults + b.children;
      console.log(`${room},${b.arrival},${b.departure},${b.guestName},${total},${b.adults},${b.children},${b.platform}`);
    });
  });

  process.exit(0);
}

analyzeFullList().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
