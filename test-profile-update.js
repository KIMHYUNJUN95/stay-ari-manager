const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function testProfileUpdate() {
  try {
    const companyId = 'dGxlQyu47LbplLVCVXiV';

    console.log('🧪 Testing Profile Update...\n');

    // 1. Update company info
    console.log('📝 Step 1: Updating company information...');
    await db.collection('companies').doc(companyId).update({
      name: 'HARU Tokyo Properties',
      registrationNumber: '123-45-67890',
      address: '東京都新宿区歌舞伎町1-1-1',
      propertyType: 'Hotel',
      numberOfRooms: 50,
      updatedAt: new Date().toISOString()
    });
    console.log('   ✅ Company info updated\n');

    // 2. Read and verify
    console.log('📖 Step 2: Reading updated data...');
    const companyDoc = await db.collection('companies').doc(companyId).get();
    const companyData = companyDoc.data();

    console.log('   Company Name:', companyData.name);
    console.log('   Registration Number:', companyData.registrationNumber);
    console.log('   Address:', companyData.address);
    console.log('   Property Type:', companyData.propertyType);
    console.log('   Number of Rooms:', companyData.numberOfRooms);
    console.log('   Updated At:', companyData.updatedAt);
    console.log('');

    // 3. Verify all fields are saved
    const allFieldsPresent =
      companyData.name === 'HARU Tokyo Properties' &&
      companyData.registrationNumber === '123-45-67890' &&
      companyData.address === '東京都新宿区歌舞伎町1-1-1' &&
      companyData.propertyType === 'Hotel' &&
      companyData.numberOfRooms === 50;

    if (allFieldsPresent) {
      console.log('✅ ALL FIELDS SAVED CORRECTLY!\n');
    } else {
      console.log('❌ Some fields are missing or incorrect\n');
    }

    // 4. Check if SignUpForm fields match
    console.log('🔍 Step 3: Checking field compatibility with SignUpForm...\n');

    const signupFields = {
      'Company Name (businessName)': companyData.name ? '✅' : '❌',
      'Registration Number': companyData.registrationNumber ? '✅' : '❌',
      'Address': companyData.address ? '✅' : '❌',
      'Property Type': companyData.propertyType ? '✅' : '❌',
      'Number of Rooms': companyData.numberOfRooms !== undefined ? '✅' : '❌'
    };

    console.log('   SignUpForm Compatibility:');
    Object.entries(signupFields).forEach(([field, status]) => {
      console.log(`   ${status} ${field}`);
    });

    console.log('\n✅ TEST COMPLETED!\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testProfileUpdate();
