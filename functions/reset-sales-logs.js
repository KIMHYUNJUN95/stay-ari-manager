const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function resetSalesLogs() {
  console.log('========================================');
  console.log('📝 Sales Logs 초기화 시작');
  console.log('========================================\n');

  // 1. 기존 sales_logs 전체 삭제
  console.log('1️⃣  기존 sales_logs 컬렉션 삭제 중...');

  const snapshot = await db.collection('sales_logs').get();
  console.log('   총 ' + snapshot.size + '개 문서 발견');

  if (snapshot.size > 0) {
    const batch = db.batch();
    let count = 0;

    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
      count++;
      if (count % 50 === 0) {
        console.log('   삭제 중... ' + count + '/' + snapshot.size);
      }
    });

    await batch.commit();
    console.log('   ✅ ' + snapshot.size + '개 문서 삭제 완료\n');
  } else {
    console.log('   ℹ️  삭제할 문서가 없습니다.\n');
  }

  // 2. 오늘 날짜로 새로운 로그 생성
  const today = '2026-02-18';
  console.log('2️⃣  ' + today + ' 로그 생성 중...');
  console.log('   saveSalesLogManual 함수 호출...\n');

  const axios = require('axios');

  try {
    const response = await axios.post(
      'https://us-central1-my-booking-app-3f0e7.cloudfunctions.net/saveSalesLogManual',
      { date: today },
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (response.data.success) {
      console.log('   ✅ ' + today + ' 로그 생성 완료');
      console.log('   매출 데이터:', response.data.data);
    } else {
      console.log('   ❌ 생성 실패:', response.data.error);
    }
  } catch (error) {
    console.error('   ❌ API 호출 오류:', error.message);
  }

  console.log('\n========================================');
  console.log('✅ 초기화 완료!');
  console.log('========================================');

  process.exit(0);
}

resetSalesLogs().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
