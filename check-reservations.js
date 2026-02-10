const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkReservations() {
  try {
    const COMPANY_ID = 'dGxlQyu47LbplLVCVXiV';
    
    console.log('Checking reservations with companyId:', COMPANY_ID);
    console.log('');
    
    const snapshot = await db.collection('reservations')
      .where('companyId', '==', COMPANY_ID)
      .limit(10)
      .get();
    
    console.log('Found reservations:', snapshot.size);
    console.log('');
    
    if (snapshot.empty) {
      console.log('NO RESERVATIONS FOUND with this companyId!');
      
      console.log('\nChecking total reservations without filter...');
      const allSnapshot = await db.collection('reservations').limit(5).get();
      console.log('Total reservations in DB:', allSnapshot.size);
      
      if (!allSnapshot.empty) {
        console.log('\nSample reservation:');
        const sampleData = allSnapshot.docs[0].data();
        console.log('- ID:', allSnapshot.docs[0].id);
        console.log('- Building:', sampleData.building);
        console.log('- Guest:', sampleData.guestName);
        console.log('- CompanyId:', sampleData.companyId || 'MISSING');
      }
    } else {
      snapshot.forEach(doc => {
        const data = doc.data();
        console.log('Reservation:', doc.id);
        console.log('  Building:', data.building);
        console.log('  Guest:', data.guestName);
        console.log('  Date:', data.date);
        console.log('');
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkReservations();
