const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkMissing() {
  console.log('=== companyId 유무 확인 ===\n');
  
  // companyId 있는 것
  const withCompany = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .get();
  
  console.log('companyId 있는 예약:', withCompany.size, '건');
  
  // 전체
  const allSnap = await db.collection('reservations').limit(1).get();
  
  if (!allSnap.empty) {
    const sample = allSnap.docs[0].data();
    console.log('\n샘플 예약 필드:', Object.keys(sample).join(', '));
  }
  
  // companyId 없는 것 확인 (샘플 5개)
  console.log('\n=== companyId 없는 예약 샘플 ===');
  const snapshot = await db.collection('reservations').limit(10000).get();
  
  let withoutCompanyId = 0;
  let samples = [];
  
  snapshot.forEach(doc => {
    if (!doc.data().companyId) {
      withoutCompanyId++;
      if (samples.length < 5) {
        samples.push({
          id: doc.id,
          building: doc.data().building,
          guest: doc.data().guestName,
          date: doc.data().date || doc.data().arrival
        });
      }
    }
  });
  
  console.log('\ncompanyId 없는 예약:', withoutCompanyId, '건 (처음 10,000개 중)');
  
  if (samples.length > 0) {
    console.log('\n샘플:');
    samples.forEach(s => {
      console.log('  -', s.id, '|', s.building, '|', s.guest, '|', s.date);
    });
  }
  
  console.log('\n전체 예약 수 (전체 컬렉션):', snapshot.size, '건');
  
  process.exit(0);
}

checkMissing().catch(err => {
  console.error(err);
  process.exit(1);
});
