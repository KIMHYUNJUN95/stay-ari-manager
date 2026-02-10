const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const COMPANY_ID = 'dGxlQyu47LbplLVCVXiV';
const BATCH_SIZE = 500;

async function migrate() {
  try {
    console.log('🚀 HARU Studio - Multi-Tenant Migration\n');
    console.log(`📝 Company ID: ${COMPANY_ID}`);
    console.log(`👤 Owner: KIM HYUN JUN\n`);

    // Step 1: Analyze
    console.log('📊 Analyzing data...');
    const reservationsSnapshot = await db.collection('reservations').get();
    const totalDocs = reservationsSnapshot.size;

    const withCompanyId = reservationsSnapshot.docs.filter(doc => doc.data().companyId).length;
    const needMigration = totalDocs - withCompanyId;

    console.log(`   Total reservations: ${totalDocs}`);
    console.log(`   Already migrated: ${withCompanyId}`);
    console.log(`   Need migration: ${needMigration}\n`);

    if (needMigration === 0) {
      console.log('✅ All data already migrated!\n');
      process.exit(0);
    }

    // Step 2: Migrate
    console.log('🔄 Migrating reservations...');
    console.log('⏳ Please wait...\n');

    let migratedCount = 0;
    const docs = reservationsSnapshot.docs.filter(doc => !doc.data().companyId);

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const batchDocs = docs.slice(i, Math.min(i + BATCH_SIZE, docs.length));

      for (const doc of batchDocs) {
        batch.update(doc.ref, {
          companyId: COMPANY_ID,
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        migratedCount++;
      }

      await batch.commit();

      const progress = Math.min(i + BATCH_SIZE, docs.length);
      const percent = Math.round((progress / docs.length) * 100);
      console.log(`   Progress: ${progress}/${docs.length} (${percent}%)`);
    }

    // Step 3: Verify
    console.log('\n🔍 Verifying migration...');
    const afterSnapshot = await db.collection('reservations')
      .where('companyId', '==', COMPANY_ID)
      .get();

    const afterCount = afterSnapshot.size;

    console.log(`   Before: ${totalDocs} total`);
    console.log(`   After: ${afterCount} with companyId`);

    if (totalDocs === afterCount) {
      console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY!');
      console.log(`   ✨ ${migratedCount} reservations migrated`);
      console.log(`   🏢 All data assigned to your company\n`);

      console.log('📝 Next Steps:');
      console.log('   1. Dashboard components will be updated');
      console.log('   2. Data will be filtered by companyId');
      console.log('   3. New users will see only their company data\n');
    } else {
      console.log('\n⚠️  WARNING: Some documents not migrated');
      console.log(`   Missing: ${totalDocs - afterCount} documents\n`);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

migrate();
