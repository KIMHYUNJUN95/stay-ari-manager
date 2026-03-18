const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkPriceSync803() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Firestore price_sync 컬렉션에서 803호 데이터 확인');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const building = '가부키초';
  const roomIds = ['624198', '648398'];

  for (const roomId of roomIds) {
    console.log(`\n[roomId: ${roomId}]`);
    console.log('─────────────────────────────────────────────────────────────');

    const roomDocRef = db.collection('price_sync').doc(building).collection('rooms').doc(roomId);
    const roomSnap = await roomDocRef.get();

    if (!roomSnap.exists) {
      console.log('❌ 데이터 없음 - price_sync에 저장되지 않음');
      console.log('   → syncAllPrices()가 아직 실행되지 않았거나 스킵됨');
      continue;
    }

    const data = roomSnap.data();
    console.log('✅ 데이터 존재');
    console.log(`   - roomName: ${data.roomName || 'N/A'}`);
    console.log(`   - lastSyncRoom: ${data.lastSyncRoom?.toDate() || 'N/A'}`);

    if (!data.dates) {
      console.log('   - dates: 없음');
      continue;
    }

    const dates = data.dates;
    const dateKeys = Object.keys(dates);
    console.log(`   - dates 개수: ${dateKeys.length}건`);

    if (dateKeys.length === 0) {
      console.log('   - dates가 비어있음');
      continue;
    }

    // 3월, 4월 데이터 확인
    const march = dateKeys.filter(k => k.startsWith('202503') || k.startsWith('202603'));
    const april = dateKeys.filter(k => k.startsWith('202504') || k.startsWith('202604'));

    console.log(`   - 3월 데이터: ${march.length}건`);
    console.log(`   - 4월 데이터: ${april.length}건`);

    // minStay 데이터 확인
    const withMinStay = dateKeys.filter(k => dates[k].m && dates[k].m !== '' && dates[k].m !== '0');
    console.log(`   - minStay 있는 날짜: ${withMinStay.length}건`);

    if (withMinStay.length > 0) {
      console.log('\n   샘플 (minStay 있는 날짜 5건):');
      withMinStay.slice(0, 5).forEach(k => {
        const d = dates[k];
        const dateStr = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
        console.log(`     ${dateStr}: minStay=${d.m}, maxStay=${d.mx || '없음'}, p1=${d.p1 || '0'}`);
      });
    }

    // 3월, 4월 minStay 샘플
    const marchWithMinStay = march.filter(k => dates[k].m && dates[k].m !== '' && dates[k].m !== '0');
    const aprilWithMinStay = april.filter(k => dates[k].m && dates[k].m !== '' && dates[k].m !== '0');

    if (marchWithMinStay.length > 0) {
      console.log(`\n   3월 minStay 샘플 (${marchWithMinStay.length}건 중 5건):`);
      marchWithMinStay.slice(0, 5).forEach(k => {
        const d = dates[k];
        const dateStr = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
        console.log(`     ${dateStr}: minStay=${d.m}`);
      });
    } else {
      console.log('\n   ⚠️ 3월에 minStay 데이터 없음');
    }

    if (aprilWithMinStay.length > 0) {
      console.log(`\n   4월 minStay 샘플 (${aprilWithMinStay.length}건 중 5건):`);
      aprilWithMinStay.slice(0, 5).forEach(k => {
        const d = dates[k];
        const dateStr = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
        console.log(`     ${dateStr}: minStay=${d.m}`);
      });
    } else {
      console.log('\n   ⚠️ 4월에 minStay 데이터 없음');
    }
  }

  console.log('\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('결론:');
  console.log('  - roomId 648398이 price_sync에 없으면 → syncAllPrices() 필요');
  console.log('  - 있지만 3/4월 minStay 없으면 → Beds24 API 응답 문제');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(0);
}

checkPriceSync803().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
