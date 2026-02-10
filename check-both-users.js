const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkBothUsers() {
  try {
    console.log('🔍 Checking both user accounts...\n');

    const email1 = 'kghkwnd95@naver.com';
    const email2 = 'rlaguswns95@haru-tokyo.com';

    // Check user 1
    console.log(`📧 User 1: ${email1}`);
    const user1Snap = await db.collection('users')
      .where('email', '==', email1)
      .limit(1)
      .get();

    if (!user1Snap.empty) {
      const user1Data = user1Snap.docs[0].data();
      console.log(`   CompanyId: ${user1Data.companyId || 'NONE'}`);
      console.log(`   Role: ${user1Data.role || 'N/A'}`);
      console.log(`   Name: ${user1Data.fullName || 'N/A'}`);

      // Check their sales_logs count
      if (user1Data.companyId) {
        const salesLogsSnap = await db.collection('sales_logs')
          .where('companyId', '==', user1Data.companyId)
          .get();
        console.log(`   📊 Sales Logs: ${salesLogsSnap.size} documents`);

        const memosSnap = await db.collection('salesLogMemos')
          .where('companyId', '==', user1Data.companyId)
          .get();
        console.log(`   📝 Sales Memos: ${memosSnap.size} documents`);
      }
    } else {
      console.log(`   ⚠️  User not found!`);
    }

    console.log('\n---\n');

    // Check user 2
    console.log(`📧 User 2: ${email2}`);
    const user2Snap = await db.collection('users')
      .where('email', '==', email2)
      .limit(1)
      .get();

    if (!user2Snap.empty) {
      const user2Data = user2Snap.docs[0].data();
      console.log(`   CompanyId: ${user2Data.companyId || 'NONE'}`);
      console.log(`   Role: ${user2Data.role || 'N/A'}`);
      console.log(`   Name: ${user2Data.fullName || 'N/A'}`);

      // Check their sales_logs count
      if (user2Data.companyId) {
        const salesLogsSnap = await db.collection('sales_logs')
          .where('companyId', '==', user2Data.companyId)
          .get();
        console.log(`   📊 Sales Logs: ${salesLogsSnap.size} documents`);

        const memosSnap = await db.collection('salesLogMemos')
          .where('companyId', '==', user2Data.companyId)
          .get();
        console.log(`   📝 Sales Memos: ${memosSnap.size} documents`);
      }
    } else {
      console.log(`   ⚠️  User not found!`);
    }

    console.log('\n✅ Complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkBothUsers();
