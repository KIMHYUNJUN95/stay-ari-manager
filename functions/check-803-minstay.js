const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function check803MinStay() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('가부키초 803호 최소숙박일수(minStay) 데이터 확인');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const roomIds = ['624198', '648398']; // 803호의 두 계정

  console.log('803호 roomId:');
  console.log('  - 624198 (기존 계정)');
  console.log('  - 648398 (새 계정)');
  console.log('');

  // 예약 데이터에서 minStay 확인
  for (const roomId of roomIds) {
    console.log(`\n[${'803호 - roomId: ' + roomId}]`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const snapshot = await db.collection('reservations')
      .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
      .where('roomId', '==', roomId)
      .get();

    console.log(`총 예약: ${snapshot.size}건\n`);

    // 3월, 4월 데이터 찾기
    const marchApril = [];
    const allMinStay = new Map();

    snapshot.forEach(doc => {
      const data = doc.data();
      const arrival = data.arrival;
      const minStay = data.minStay;

      if (minStay !== undefined) {
        allMinStay.set(arrival, minStay);
      }

      if (arrival && (arrival.startsWith('2025-03') || arrival.startsWith('2025-04') ||
                      arrival.startsWith('2026-03') || arrival.startsWith('2026-04'))) {
        marchApril.push({
          arrival: data.arrival,
          departure: data.departure,
          minStay: data.minStay,
          guestName: data.guestName,
          status: data.status
        });
      }
    });

    // minStay 통계
    const minStayValues = Array.from(allMinStay.values());
    const hasMinStay50Plus = minStayValues.filter(ms => ms >= 50).length;
    const hasMinStayLow = minStayValues.filter(ms => ms >= 1 && ms < 50).length;

    console.log('minStay 통계:');
    console.log(`  - minStay >= 50 (비활성화): ${hasMinStay50Plus}건`);
    console.log(`  - 1 <= minStay < 50 (활성화): ${hasMinStayLow}건`);
    console.log(`  - minStay 없음: ${snapshot.size - minStayValues.length}건`);

    if (minStayValues.length > 0) {
      const avgMinStay = minStayValues.reduce((a, b) => a + b, 0) / minStayValues.length;
      const maxMinStay = Math.max(...minStayValues);
      const minMinStay = Math.min(...minStayValues);
      console.log(`  - 평균: ${avgMinStay.toFixed(1)}박`);
      console.log(`  - 최소: ${minMinStay}박`);
      console.log(`  - 최대: ${maxMinStay}박`);
    }

    // 3월, 4월 데이터
    if (marchApril.length > 0) {
      console.log(`\n3월/4월 예약 (${marchApril.length}건):`);
      marchApril.slice(0, 10).forEach(b => {
        const minStayStr = b.minStay !== undefined ? `minStay: ${b.minStay}박` : 'minStay: 없음';
        const statusStr = b.status || 'unknown';
        console.log(`  - ${b.arrival} ~ ${b.departure} | ${b.guestName || '(이름없음)'} | ${minStayStr} | ${statusStr}`);
      });
    } else {
      console.log('\n3월/4월 예약: 없음');
    }

    // 최근 예약 샘플
    console.log('\n최근 예약 샘플 (최대 5건):');
    let count = 0;
    snapshot.forEach(doc => {
      if (count >= 5) return;
      const data = doc.data();
      const minStayStr = data.minStay !== undefined ? `minStay: ${data.minStay}박` : 'minStay: 없음';
      console.log(`  ${count + 1}. ${data.arrival} ~ ${data.departure} | ${minStayStr} | ${data.status}`);
      count++;
    });
  }

  console.log('\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('결론:');
  console.log('  - minStay >= 50: 비활성화 계정 (캘린더에서 제외)');
  console.log('  - 1 <= minStay < 50: 활성화 계정 (캘린더에 표시)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(0);
}

check803MinStay().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
