const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const auth = admin.auth();

async function changeEmail() {
  try {
    const oldEmail = 'kghkwnd95@naver.com';
    const newEmail = 'rlaguswns95@haru-tokyo.com';

    console.log('📧 EMAIL CHANGE SCRIPT\n');
    console.log('=' .repeat(60));
    console.log(`Old Email: ${oldEmail}`);
    console.log(`New Email: ${newEmail}`);
    console.log('=' .repeat(60) + '\n');

    // Step 1: Find user by email in Firebase Authentication
    console.log('🔍 Step 1: Finding user in Firebase Authentication...');
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(oldEmail);
      console.log('✅ User found!');
      console.log('   User ID:', userRecord.uid);
      console.log('   Current Email:', userRecord.email);
      console.log('   Display Name:', userRecord.displayName || 'N/A');
      console.log('   Created:', new Date(userRecord.metadata.creationTime).toLocaleString());
      console.log('');
    } catch (err) {
      console.error('❌ User not found with email:', oldEmail);
      console.error('   Error:', err.message);
      process.exit(1);
    }

    // Step 2: Check if new email already exists
    console.log('🔍 Step 2: Checking if new email already exists...');
    try {
      const existingUser = await auth.getUserByEmail(newEmail);
      console.log('⚠️  WARNING: New email already exists!');
      console.log('   Existing User ID:', existingUser.uid);
      console.log('   If you want to merge accounts, use a different script.');
      console.log('   Aborting...\n');
      process.exit(1);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log('✅ New email is available\n');
      } else {
        throw err;
      }
    }

    // Step 3: Update email in Firebase Authentication
    console.log('📝 Step 3: Updating email in Firebase Authentication...');
    await auth.updateUser(userRecord.uid, {
      email: newEmail
    });
    console.log('✅ Firebase Authentication email updated\n');

    // Step 4: Update email in Firestore users document
    console.log('📝 Step 4: Updating email in Firestore users document...');
    const userDocRef = db.collection('users').doc(userRecord.uid);
    const userDoc = await userDocRef.get();

    if (userDoc.exists()) {
      await userDocRef.update({
        email: newEmail,
        updatedAt: new Date().toISOString()
      });
      console.log('✅ Firestore users document updated\n');
    } else {
      console.log('⚠️  No Firestore document found for this user\n');
    }

    // Step 5: Verify changes
    console.log('🔍 Step 5: Verifying changes...');
    const updatedUser = await auth.getUser(userRecord.uid);
    const updatedDoc = await userDocRef.get();
    const updatedData = updatedDoc.data();

    console.log('✅ Firebase Authentication:');
    console.log('   Email:', updatedUser.email);
    console.log('');
    console.log('✅ Firestore Document:');
    console.log('   Email:', updatedData?.email || 'N/A');
    console.log('   Updated At:', updatedData?.updatedAt || 'N/A');
    console.log('');

    // Final summary
    console.log('=' .repeat(60));
    console.log('🎉 EMAIL CHANGE COMPLETED SUCCESSFULLY!');
    console.log('=' .repeat(60));
    console.log('');
    console.log('✅ Old Email:', oldEmail);
    console.log('✅ New Email:', newEmail);
    console.log('✅ User ID:', userRecord.uid);
    console.log('');
    console.log('⚠️  IMPORTANT: User must log in with the NEW email address!');
    console.log('   Password remains the same.');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Email change failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

changeEmail();
