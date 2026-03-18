const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkSalesLog() {
  const date = '2026-02-17';
  const doc = await db.collection('sales_logs').doc(date).get();

  if (!doc.exists) {
    console.log('2026-02-17 매출 로그가 존재하지 않습니다.');
    process.exit(0);
  }

  const data = doc.data();
  console.log('========== 2026-02-17 매출 로그 ==========');
  console.log('');

  if (data.monthlyStats && data.monthlyStats['2026-02']) {
    const feb = data.monthlyStats['2026-02'];
    console.log('2026-02 총 매출: ¥' + (feb.revenue || 0).toLocaleString());
    console.log('2026-02 가동률: ' + (feb.occupancy || 0) + '%');
    console.log('');

    if (feb._buildingDebug) {
      console.log('건물별 매출 상세:');
      const sorted = Object.entries(feb._buildingDebug).sort((a, b) => b[1] - a[1]);
      sorted.forEach(([building, revenue]) => {
        const formatted = Math.round(revenue).toLocaleString();
        console.log('  ' + building + ': ¥' + formatted);
      });

      console.log('');
      console.log('제외되어야 할 건물 포함 여부:');
      if (feb._buildingDebug['다이쿄초']) {
        console.log('  ❌ 다이쿄초: ¥' + Math.round(feb._buildingDebug['다이쿄초']).toLocaleString() + ' - 포함됨!');
      } else {
        console.log('  ✅ 다이쿄초: 제외됨');
      }

      if (feb._buildingDebug['오쿠보A동']) {
        console.log('  ❌ 오쿠보A동: ¥' + Math.round(feb._buildingDebug['오쿠보A동']).toLocaleString() + ' - 포함됨!');
      } else {
        console.log('  ✅ 오쿠보A동: 제외됨');
      }

      if (feb._buildingDebug['사노시']) {
        console.log('  ❌ 사노시: ¥' + Math.round(feb._buildingDebug['사노시']).toLocaleString() + ' - 포함됨!');
      } else {
        console.log('  ✅ 사노시: 제외됨');
      }
    } else {
      console.log('⚠️  디버그 정보(_buildingDebug)가 없습니다.');
      console.log('로그가 오래된 버전으로 생성되었을 수 있습니다.');
    }
  }

  process.exit(0);
}

checkSalesLog().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
