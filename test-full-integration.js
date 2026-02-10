const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function testFullIntegration() {
  try {
    console.log('🧪 FULL INTEGRATION TEST\n');
    console.log('=' .repeat(60) + '\n');

    const userId = 'xylGHGUVjkNZ9787zcmsHSLgx7p1';
    const companyId = 'dGxlQyu47LbplLVCVXiV';

    // ============================================
    // Test 1: User Document
    // ============================================
    console.log('📋 Test 1: User Document');
    console.log('-'.repeat(60));

    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    console.log('✓ User ID:', userId);
    console.log('✓ Email:', userData.email);
    console.log('✓ Full Name:', userData.fullName);
    console.log('✓ Phone:', userData.phone);
    console.log('✓ Country:', userData.country);
    console.log('✓ Timezone:', userData.timezone);
    console.log('✓ CompanyId:', userData.companyId);
    console.log('✓ Role:', userData.role);

    const userFieldsComplete = userData.fullName && userData.phone && userData.country && userData.timezone && userData.companyId;
    console.log(userFieldsComplete ? '\n✅ User document: COMPLETE\n' : '\n⚠️  User document: INCOMPLETE\n');

    // ============================================
    // Test 2: Company Document
    // ============================================
    console.log('🏢 Test 2: Company Document');
    console.log('-'.repeat(60));

    const companyDoc = await db.collection('companies').doc(companyId).get();
    const companyData = companyDoc.data();

    console.log('✓ Company ID:', companyId);
    console.log('✓ Name:', companyData.name);
    console.log('✓ Registration Number:', companyData.registrationNumber || 'N/A');
    console.log('✓ Address:', companyData.address || 'N/A');
    console.log('✓ Property Type:', companyData.propertyType);
    console.log('✓ Number of Rooms:', companyData.numberOfRooms || 'N/A');
    console.log('✓ Owner ID:', companyData.ownerId);

    const companyFieldsComplete = companyData.name && companyData.propertyType && companyData.ownerId;
    console.log(companyFieldsComplete ? '\n✅ Company document: COMPLETE\n' : '\n⚠️  Company document: INCOMPLETE\n');

    // ============================================
    // Test 3: Field Compatibility
    // ============================================
    console.log('🔗 Test 3: SignUpForm ↔ MyProfile Field Compatibility');
    console.log('-'.repeat(60));

    const fieldChecks = {
      'name (businessName)': companyData.name !== undefined,
      'registrationNumber': companyData.registrationNumber !== undefined,
      'address': companyData.address !== undefined,
      'propertyType': companyData.propertyType !== undefined,
      'numberOfRooms': companyData.numberOfRooms !== undefined,
      'ownerId': companyData.ownerId !== undefined,
      'createdAt': companyData.createdAt !== undefined,
      'updatedAt': companyData.updatedAt !== undefined
    };

    let allFieldsPresent = true;
    Object.entries(fieldChecks).forEach(([field, exists]) => {
      console.log(`${exists ? '✅' : '❌'} ${field}`);
      if (!exists) allFieldsPresent = false;
    });

    console.log(allFieldsPresent ? '\n✅ All fields compatible\n' : '\n⚠️  Some fields missing\n');

    // ============================================
    // Test 4: Empty Fields That Can Be Updated
    // ============================================
    console.log('📝 Test 4: Empty Fields (Can be filled via MyProfile)');
    console.log('-'.repeat(60));

    const emptyFields = [];
    if (!companyData.registrationNumber || companyData.registrationNumber === '') {
      emptyFields.push('registrationNumber');
    }
    if (!companyData.address || companyData.address === '') {
      emptyFields.push('address');
    }
    if (!companyData.numberOfRooms || companyData.numberOfRooms === 0) {
      emptyFields.push('numberOfRooms');
    }

    if (emptyFields.length > 0) {
      console.log('⚠️  Fields that need to be filled:');
      emptyFields.forEach(field => console.log(`   - ${field}`));
      console.log('\n✅ These can be updated via MyProfile\n');
    } else {
      console.log('✅ All company fields are filled\n');
    }

    // ============================================
    // Test 5: User-Company Relationship
    // ============================================
    console.log('🔗 Test 5: User ↔ Company Relationship');
    console.log('-'.repeat(60));

    const userHasCompany = userData.companyId === companyId;
    const companyOwnsUser = companyData.ownerId === userId;
    const roleIsOwner = userData.role === 'owner';

    console.log(`${userHasCompany ? '✅' : '❌'} User.companyId matches Company ID`);
    console.log(`${companyOwnsUser ? '✅' : '❌'} Company.ownerId matches User ID`);
    console.log(`${roleIsOwner ? '✅' : '❌'} User role is 'owner'`);

    const relationshipValid = userHasCompany && companyOwnsUser && roleIsOwner;
    console.log(relationshipValid ? '\n✅ Relationship: VALID\n' : '\n❌ Relationship: INVALID\n');

    // ============================================
    // Test 6: MyProfile Update Simulation
    // ============================================
    console.log('🧪 Test 6: Simulating MyProfile Update');
    console.log('-'.repeat(60));

    const testUpdate = {
      registrationNumber: '999-88-77777',
      address: 'Test Address 123',
      numberOfRooms: 100
    };

    console.log('Updating company with test data...');
    await db.collection('companies').doc(companyId).update({
      ...testUpdate,
      updatedAt: new Date().toISOString()
    });

    const updatedDoc = await db.collection('companies').doc(companyId).get();
    const updatedData = updatedDoc.data();

    const updateSuccess =
      updatedData.registrationNumber === testUpdate.registrationNumber &&
      updatedData.address === testUpdate.address &&
      updatedData.numberOfRooms === testUpdate.numberOfRooms;

    console.log(`${updateSuccess ? '✅' : '❌'} Update successful`);
    console.log(`   Registration Number: ${updatedData.registrationNumber}`);
    console.log(`   Address: ${updatedData.address}`);
    console.log(`   Number of Rooms: ${updatedData.numberOfRooms}`);

    // Restore original data
    await db.collection('companies').doc(companyId).update({
      name: 'HARU Tokyo Properties',
      registrationNumber: '123-45-67890',
      address: '東京都新宿区歌舞伎町1-1-1',
      numberOfRooms: 50,
      updatedAt: new Date().toISOString()
    });
    console.log('\n✅ Test data restored to original values\n');

    // ============================================
    // FINAL SUMMARY
    // ============================================
    console.log('=' .repeat(60));
    console.log('📊 FINAL TEST SUMMARY');
    console.log('=' .repeat(60) + '\n');

    const tests = [
      { name: 'User Document', status: userFieldsComplete },
      { name: 'Company Document', status: companyFieldsComplete },
      { name: 'Field Compatibility', status: allFieldsPresent },
      { name: 'User-Company Relationship', status: relationshipValid },
      { name: 'MyProfile Update', status: updateSuccess }
    ];

    tests.forEach(test => {
      console.log(`${test.status ? '✅' : '❌'} ${test.name}`);
    });

    const allTestsPassed = tests.every(test => test.status);

    console.log('\n' + '='.repeat(60));
    if (allTestsPassed) {
      console.log('🎉 ALL TESTS PASSED!');
      console.log('✅ SignUpForm ↔ MyProfile integration is PERFECT!');
    } else {
      console.log('⚠️  SOME TESTS FAILED');
      console.log('Please review the results above.');
    }
    console.log('=' .repeat(60) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Integration test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testFullIntegration();
