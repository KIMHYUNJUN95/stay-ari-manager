/**
 * Auto Migration Script
 * Email: rlaguswns95@haru-tokyo.com
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const USER_EMAIL = 'rlaguswns95@haru-tokyo.com';
const BATCH_SIZE = 500;

async function runMigration() {
  try {
    console.log('🚀 Starting Migration...\n');

    // Step 1: Get companyId
    console.log('📝 Step 1: Getting your companyId...');
    const usersSnapshot = await db.collection('users')
      .where('email', '==', USER_EMAIL)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      throw new Error(`User not found: ${USER_EMAIL}`);
    }

    const userData = usersSnapshot.docs[0].data();
    const companyId = userData.companyId;

    console.log(`✅ Found companyId: ${companyId}\n`);

    // Step 2: Count documents
    console.log('📊 Step 2: Analyzing data...');
    const reservationsSnapshot = await db.collection('reservations').get();
    const totalDocs = reservationsSnapshot.size;

    const withCompanyId = reservationsSnapshot.docs.filter(doc => doc.data().companyId).length;
    const needMigration = totalDocs - withCompanyId;

    console.log(`   Total reservations: ${totalDocs}`);
    console.log(`   Already migrated: ${withCompanyId}`);
    console.log(`   Need migration: ${needMigration}\n`);

    if (needMigration === 0) {
      console.log('✅ All data already migrated! Nothing to do.');
      process.exit(0);
    }

    // Step 3: Migrate
    console.log('🔄 Step 3: Migrating data...');
    console.log('⏳ Please wait...\n');

    let migratedCount = 0;
    const docs = reservationsSnapshot.docs.filter(doc => !doc.data().companyId);

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const batchDocs = docs.slice(i, Math.min(i + BATCH_SIZE, docs.length));

      for (const doc of batchDocs) {
        batch.update(doc.ref, {
          companyId: companyId,
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        migratedCount++;
      }

      await batch.commit();

      const progress = Math.min(i + BATCH_SIZE, docs.length);
      console.log(`   Progress: ${progress}/${docs.length} (${Math.round(progress / docs.length * 100)}%)`);
    }

    // Step 4: Verify
    console.log('\n🔍 Step 4: Verifying...');
    const afterSnapshot = await db.collection('reservations')
      .where('companyId', '==', companyId)
      .get();

    const afterCount = afterSnapshot.size;

    console.log(`   Total reservations: ${totalDocs}`);
    console.log(`   With companyId: ${afterCount}`);

    if (totalDocs === afterCount) {
      console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY!');
      console.log(`   ${migratedCount} reservations migrated to your company.\n`);
    } else {
      console.log('\n⚠️  MIGRATION WARNING:');
      console.log(`   ${totalDocs - afterCount} documents still missing companyId\n`);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

runMigration();
