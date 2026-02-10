const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkUsers() {
  console.log('🔍 Checking Firestore users...\n');

  const usersSnapshot = await db.collection('users').get();

  console.log(`Total users: ${usersSnapshot.size}\n`);

  if (usersSnapshot.empty) {
    console.log('⚠️  No users found in Firestore!\n');
  } else {
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`User ID: ${doc.id}`);
      console.log(`  Email: ${data.email || 'N/A'}`);
      console.log(`  Name: ${data.fullName || 'N/A'}`);
      console.log(`  CompanyId: ${data.companyId || 'N/A'}`);
      console.log('');
    });
  }

  // Also check companies
  console.log('\n🏢 Checking companies...\n');
  const companiesSnapshot = await db.collection('companies').get();
  console.log(`Total companies: ${companiesSnapshot.size}\n`);

  if (!companiesSnapshot.empty) {
    companiesSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`Company ID: ${doc.id}`);
      console.log(`  Name: ${data.name || 'N/A'}`);
      console.log(`  Owner: ${data.ownerId || 'N/A'}`);
      console.log('');
    });
  }

  process.exit(0);
}

checkUsers();
