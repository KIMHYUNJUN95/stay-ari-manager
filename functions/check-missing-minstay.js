const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkMissingMinStay() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('803호 minStay 미설정 날짜 확인');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const roomId = '624198';
  const roomDocRef = db.collection('price_sync').doc('가부키초').collection('rooms').doc(roomId);
  const roomSnap = await roomDocRef.get();

  if (!roomSnap.exists) {
    console.log('❌ 데이터 없음');
    process.exit(1);
  }

  const data = roomSnap.data();
  const dates = data.dates || {};
  const dateKeys = Object.keys(dates).sort();

  console.log(`총 날짜: ${dateKeys.length}건\n`);

  // 월별로 그룹화
  const byMonth = {};
  dateKeys.forEach(k => {
    const month = k.slice(0, 6); // YYYYMM
    if (!byMonth[month]) {
      byMonth[month] = { total: 0, withMinStay: 0, withoutMinStay: 0 };
    }
    byMonth[month].total++;
    const d = dates[k];
    if (d.m && d.m !== '' && d.m !== '0') {
      byMonth[month].withMinStay++;
    } else {
      byMonth[month].withoutMinStay++;
    }
  });

  console.log('월별 minStay 설정 현황:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  Object.keys(byMonth).sort().forEach(month => {
    const monthStr = `${month.slice(0, 4)}-${month.slice(4, 6)}`;
    const stats = byMonth[month];
    const missingPercent = ((stats.withoutMinStay / stats.total) * 100).toFixed(1);

    let status = '';
    if (stats.withoutMinStay === 0) {
      status = '✅ 전부 설정됨';
    } else if (stats.withoutMinStay === stats.total) {
      status = '❌ 전부 미설정';
    } else {
      status = `⚠️ 일부 미설정 (${stats.withoutMinStay}/${stats.total})`;
    }

    console.log(`${monthStr}: ${status}`);
    console.log(`  - 설정됨: ${stats.withMinStay}건, 미설정: ${stats.withoutMinStay}건 (미설정률: ${missingPercent}%)`);
  });

  // 미설정된 날짜 샘플 출력
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('minStay 미설정 날짜 샘플 (최대 20건):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const missingDates = dateKeys.filter(k => {
    const d = dates[k];
    return !d.m || d.m === '' || d.m === '0';
  });

  if (missingDates.length > 0) {
    console.log(`\n총 ${missingDates.length}건의 미설정 날짜:\n`);
    missingDates.slice(0, 20).forEach(k => {
      const dateStr = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
      const d = dates[k];
      console.log(`  ${dateStr}: p1=${d.p1 || '없음'}, m=${d.m || '없음'}`);
    });
  } else {
    console.log('\n✅ 모든 날짜에 minStay가 설정되어 있습니다.');
  }

  process.exit(0);
}

checkMissingMinStay().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
