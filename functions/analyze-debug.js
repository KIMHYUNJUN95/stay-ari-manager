const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function debugAnalysis() {
  console.log('=== 디버그: 필터링 조건 확인 ===\n');

  const startDate = '2025-02-18';
  const endDate = '2026-02-18';
  const threePersonRooms = ['502호', '603호', '802호', '803호'];

  console.log('기간:', startDate, '~', endDate);
  console.log('대상 방:', threePersonRooms.join(', '));
  console.log('');

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  console.log('총 예약:', snapshot.size, '건\n');

  // 단계별 필터링
  let step1 = 0; // 가부키초
  let step2 = 0; // 3인실
  let step3 = 0; // 기간 내
  let step4_exact = 0; // arrival >= start AND arrival <= end
  let step4_between = 0; // arrival >= start AND arrival < end

  const roomCounts = {};
  threePersonRooms.forEach(room => {
    roomCounts[room] = 0;
  });

  snapshot.forEach(doc => {
    const data = doc.data();

    // Step 1: 가부키초
    if (data.building !== '가부키초') return;
    step1++;

    // Step 2: 3인실
    const room = data.room;
    if (!threePersonRooms.includes(room)) return;
    step2++;

    // Step 3: 날짜 있는지 확인
    if (!data.arrival || !data.departure) return;

    // Step 4a: arrival >= start AND arrival <= end
    if (data.arrival >= startDate && data.arrival <= endDate) {
      step4_exact++;
      roomCounts[room]++;
    }

    // Step 4b: arrival >= start AND arrival < end
    if (data.arrival >= startDate && data.arrival < endDate) {
      step4_between++;
    }

    step3++;
  });

  console.log('필터링 단계:');
  console.log('  1. 가부키초 예약:', step1, '건');
  console.log('  2. 3인실만:', step2, '건');
  console.log('  3. 날짜 정보 있음:', step3, '건');
  console.log('  4a. arrival >= 2025-02-18 AND arrival <= 2026-02-18:', step4_exact, '건');
  console.log('  4b. arrival >= 2025-02-18 AND arrival < 2026-02-18:', step4_between, '건');
  console.log('');

  console.log('방별 예약 수 (arrival >= start AND arrival <= end):');
  threePersonRooms.forEach(room => {
    console.log('  ' + room + ':', roomCounts[room], '건');
  });
  console.log('  합계:', Object.values(roomCounts).reduce((a, b) => a + b, 0), '건');

  // 2026-02-18 당일 체크인 확인
  console.log('\n2026-02-18 당일 체크인 예약:');
  let todayCheckins = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.building === '가부키초' &&
        threePersonRooms.includes(data.room) &&
        data.arrival === '2026-02-18') {
      todayCheckins.push({
        room: data.room,
        guestName: data.guestName,
        departure: data.departure
      });
    }
  });

  if (todayCheckins.length > 0) {
    todayCheckins.forEach(b => {
      console.log('  - ' + b.room + ' | ' + b.guestName + ' | 2026-02-18 ~ ' + b.departure);
    });
  } else {
    console.log('  없음');
  }

  process.exit(0);
}

debugAnalysis().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
