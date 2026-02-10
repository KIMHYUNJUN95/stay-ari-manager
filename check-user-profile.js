const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkUserProfile() {
  try {
    const email = 'kghkwnd95@naver.com';

    console.log(`🔍 Checking user profile: ${email}\n`);

    // Get user
    const userSnap = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (userSnap.empty) {
      console.log('❌ User not found!');
      process.exit(1);
    }

    const userDoc = userSnap.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    console.log('📧 User Document:');
    console.log('   ID:', userId);
    console.log('   Email:', userData.email);
    console.log('   Name:', userData.fullName || 'N/A');
    console.log('   Phone:', userData.phone || 'N/A');
    console.log('   Country:', userData.country || 'N/A');
    console.log('   CompanyId:', userData.companyId || 'N/A');
    console.log('   Role:', userData.role || 'N/A');
    console.log('   Profile Image:', userData.profileImage || 'N/A');
    console.log('   Timezone:', userData.timezone || 'N/A');
    console.log('');

    // Get company
    if (userData.companyId) {
      console.log('🏢 Company Document:\n');
      const companyDoc = await db.collection('companies').doc(userData.companyId).get();

      if (companyDoc.exists) {
        const companyData = companyDoc.data();
        console.log('   ID:', companyDoc.id);
        console.log('   Name:', companyData.name || 'N/A');
        console.log('   Registration Number:', companyData.registrationNumber || 'N/A');
        console.log('   Address:', companyData.address || 'N/A');
        console.log('   Property Type:', companyData.propertyType || 'N/A');
        console.log('   Number of Rooms:', companyData.numberOfRooms || 'N/A');
        console.log('   Owner ID:', companyData.ownerId || 'N/A');
      } else {
        console.log('   ⚠️  Company document not found!');
      }
    } else {
      console.log('⚠️  No company associated with this user');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkUserProfile();
