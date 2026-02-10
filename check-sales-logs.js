const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkSalesLogs() {
  try {
    console.log('🔍 Checking sales_logs collection structure...\n');

    // Get a few sample documents
    const snapshot = await db.collection('sales_logs')
      .limit(3)
      .get();

    console.log(`Total documents found: ${snapshot.size}\n`);

    if (snapshot.empty) {
      console.log('⚠️  No sales_logs found!');
    } else {
      snapshot.forEach((doc, index) => {
        const data = doc.data();
        console.log(`\n=== Document ${index + 1} ===`);
        console.log(`Document ID: ${doc.id}`);
        console.log(`Has companyId: ${data.companyId ? '✅ YES' : '❌ NO'}`);
        if (data.companyId) {
          console.log(`  CompanyId: ${data.companyId}`);
        }
        console.log(`Data keys:`, Object.keys(data));

        // Show structure
        if (data.monthlyStats) {
          console.log(`  monthlyStats keys:`, Object.keys(data.monthlyStats).slice(0, 3));
        }

        // Show sample data
        console.log('\nSample data structure:');
        console.log(JSON.stringify(data, null, 2).substring(0, 500));
        console.log('...\n');
      });
    }

    // Check salesLogMemos too
    console.log('\n\n🔍 Checking salesLogMemos collection...\n');
    const memosSnapshot = await db.collection('salesLogMemos')
      .limit(3)
      .get();

    console.log(`Total memos found: ${memosSnapshot.size}\n`);

    if (!memosSnapshot.empty) {
      memosSnapshot.forEach((doc, index) => {
        const data = doc.data();
        console.log(`\n=== Memo ${index + 1} ===`);
        console.log(`Document ID: ${doc.id}`);
        console.log(`Has companyId: ${data.companyId ? '✅ YES' : '❌ NO'}`);
        console.log(`Data:`, data);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkSalesLogs();
