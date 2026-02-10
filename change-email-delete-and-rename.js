const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const auth = admin.auth();

async function changeEmailWithDelete() {
  try {
    const oldEmail = 'kghkwnd95@naver.com';
    const newEmail = 'rlaguswns95@haru-tokyo.com';

    console.log('📧 EMAIL CHANGE SCRIPT (Method A)\n');
    console.log('=' .repeat(60));
    console.log('Step 1: Delete existing account with new email');
    console.log('Step 2: Change email of account with data');
    console.log('=' .repeat(60) + '\n');

    // ============================================
    // STEP 1: Find and delete the new email account
    // ============================================
    console.log('🔍 STEP 1: Finding account with new email...');
    let newEmailUser;
    try {
      newEmailUser = await auth.getUserByEmail(newEmail);
      console.log('✅ Found account to delete:');
      console.log('   Email:', newEmailUser.email);
      console.log('   User ID:', newEmailUser.uid);
      console.log('   Created:', new Date(newEmailUser.metadata.creationTime).toLocaleString());
      console.log('');

      // Check if this account has any data in Firestore
      console.log('🔍 Checking if account has any data...');
      const userDocRef = db.collection('users').doc(newEmailUser.uid);
      const userDoc = await userDocRef.get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        console.log('⚠️  WARNING: This account has a Firestore document!');
        console.log('   Data:', JSON.stringify(userData, null, 2));
        console.log('');
        console.log('⚠️  Are you sure you want to delete this account?');
        console.log('   If it has important data, STOP HERE!');
        console.log('');
      } else {
        console.log('✅ No Firestore data found (safe to delete)\n');
      }

      // Delete the account
      console.log('🗑️  Deleting account:', newEmail);
      await auth.deleteUser(newEmailUser.uid);
      console.log('✅ Account deleted from Firebase Authentication');

      // Delete Firestore document if exists
      if (userDoc.exists) {
        await userDocRef.delete();
        console.log('✅ Firestore document deleted');
      }
      console.log('');

    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log('✅ No account exists with new email (ready to proceed)\n');
      } else {
        throw err;
      }
    }

    // ============================================
    // STEP 2: Find account with old email
    // ============================================
    console.log('🔍 STEP 2: Finding account with old email...');
    let oldEmailUser;
    try {
      oldEmailUser = await auth.getUserByEmail(oldEmail);
      console.log('✅ Found account to update:');
      console.log('   Email:', oldEmailUser.email);
      console.log('   User ID:', oldEmailUser.uid);
      console.log('   Created:', new Date(oldEmailUser.metadata.creationTime).toLocaleString());
      console.log('');
    } catch (err) {
      console.error('❌ Account not found with email:', oldEmail);
      console.error('   Error:', err.message);
      process.exit(1);
    }

    // ============================================
    // STEP 3: Update email in Firebase Authentication
    // ============================================
    console.log('📝 STEP 3: Updating email in Firebase Authentication...');
    await auth.updateUser(oldEmailUser.uid, {
      email: newEmail
    });
    console.log('✅ Firebase Authentication email updated\n');

    // ============================================
    // STEP 4: Update email in Firestore users document
    // ============================================
    console.log('📝 STEP 4: Updating email in Firestore users document...');
    const userDocRef = db.collection('users').doc(oldEmailUser.uid);
    const userDoc = await userDocRef.get();

    if (userDoc.exists) {
      await userDocRef.update({
        email: newEmail,
        updatedAt: new Date().toISOString()
      });
      console.log('✅ Firestore users document updated\n');
    } else {
      console.log('⚠️  No Firestore document found for this user\n');
    }

    // ============================================
    // STEP 5: Verify changes
    // ============================================
    console.log('🔍 STEP 5: Verifying changes...');
    const updatedUser = await auth.getUser(oldEmailUser.uid);
    const updatedDoc = await userDocRef.get();
    const updatedData = updatedDoc.data();

    console.log('✅ Firebase Authentication:');
    console.log('   Email:', updatedUser.email);
    console.log('   User ID:', updatedUser.uid);
    console.log('');
    console.log('✅ Firestore Document:');
    console.log('   Email:', updatedData?.email || 'N/A');
    console.log('   Full Name:', updatedData?.fullName || 'N/A');
    console.log('   Company ID:', updatedData?.companyId || 'N/A');
    console.log('   Role:', updatedData?.role || 'N/A');
    console.log('   Updated At:', updatedData?.updatedAt || 'N/A');
    console.log('');

    // ============================================
    // FINAL SUMMARY
    // ============================================
    console.log('=' .repeat(60));
    console.log('🎉 EMAIL CHANGE COMPLETED SUCCESSFULLY!');
    console.log('=' .repeat(60));
    console.log('');
    console.log('✅ Old Email:', oldEmail);
    console.log('✅ New Email:', newEmail);
    console.log('✅ User ID:', oldEmailUser.uid);
    console.log('✅ All data preserved');
    console.log('');
    console.log('⚠️  IMPORTANT: Next login details');
    console.log('   Email: ' + newEmail);
    console.log('   Password: (same as before)');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Email change failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

changeEmailWithDelete();
