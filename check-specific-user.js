const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkUser() {
  try {
    const email = 'rlaguswns95@haru-tokyo.com';

    console.log(`🔍 Checking: ${email}\n`);

    // Check in users collection by email
    const usersByEmail = await db.collection('users')
      .where('email', '==', email)
      .get();

    console.log(`Users found by email: ${usersByEmail.size}\n`);

    if (!usersByEmail.empty) {
      usersByEmail.forEach(doc => {
        const data = doc.data();
        console.log('User found in users collection:');
        console.log('  Document ID:', doc.id);
        console.log('  Email:', data.email);
        console.log('  Name:', data.fullName || data.name || 'N/A');
        console.log('  CompanyId:', data.companyId || 'NONE');
        console.log('  Role:', data.role || 'N/A');
        console.log('');
      });
    } else {
      console.log('❌ User NOT found in users collection\n');
    }

    // Check all users (to see what's in there)
    console.log('📋 All users in database:\n');
    const allUsers = await db.collection('users').get();
    console.log(`Total users: ${allUsers.size}\n`);

    allUsers.forEach(doc => {
      const data = doc.data();
      console.log(`- ${data.email || 'no email'} (${data.fullName || 'no name'}) - companyId: ${data.companyId || 'NONE'}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkUser();
