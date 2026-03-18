const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkMultipleLogs() {
  const dates = ['2026-02-16', '2026-02-17', '2026-02-18'];

  for (const date of dates) {
    const doc = await db.collection('sales_logs').doc(date).get();

    console.log('\n========== ' + date + ' ==========');

    if (!doc.exists) {
      console.log('로그가 존재하지 않습니다.');
      continue;
    }

    const data = doc.data();

    if (data.monthlyStats && data.monthlyStats['2026-02']) {
      const feb = data.monthlyStats['2026-02'];
      console.log('2026-02 총 매출: ¥' + (feb.revenue || 0).toLocaleString());
      console.log('2026-02 가동률: ' + (feb.occupancy || 0) + '%');

      if (feb._buildingDebug) {
        console.log('디버그 정보: ✅ 있음 (최신 코드로 생성)');

        const hasDaikyo = feb._buildingDebug['다이쿄초'] ? '❌ 포함됨' : '✅ 제외됨';
        const hasOkuboA = feb._buildingDebug['오쿠보A동'] ? '❌ 포함됨' : '✅ 제외됨';
        const hasSano = feb._buildingDebug['사노시'] ? '❌ 포함됨' : '✅ 제외됨';

        console.log('  - 다이쿄초: ' + hasDaikyo);
        console.log('  - 오쿠보A동: ' + hasOkuboA);
        console.log('  - 사노시: ' + hasSano);
      } else {
        console.log('디버그 정보: ❌ 없음 (오래된 코드로 생성, 필터링 미적용 가능성 높음)');
      }
    }
  }

  process.exit(0);
}

checkMultipleLogs().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
