const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkStatus() {
  const COMPANY_ID = 'dGxlQyu47LbplLVCVXiV';
  
  console.log('=== 예약 데이터 상태별 집계 ===\n');
  
  const allSnap = await db.collection('reservations')
    .where('companyId', '==', COMPANY_ID)
    .get();
  
  console.log('전체 예약:', allSnap.size, '건\n');
  
  const statusCount = {};
  allSnap.forEach(doc => {
    const status = doc.data().status || 'unknown';
    statusCount[status] = (statusCount[status] || 0) + 1;
  });
  
  console.log('상태별 분포:');
  Object.entries(statusCount)
    .sort((a,b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log('  -', status + ':', count, '건');
    });
  
  process.exit(0);
}

checkStatus().catch(err => {
  console.error(err);
  process.exit(1);
});
