const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const COMPANY_ID = 'dGxlQyu47LbplLVCVXiV'; // kghkwnd95@naver.com's company
const BATCH_SIZE = 500;

async function migrateSalesLogs() {
  try {
    console.log('🚀 Migrating sales_logs and salesLogMemos...\n');
    console.log(`📝 Company ID: ${COMPANY_ID}`);
    console.log(`👤 Owner: kghkwnd95@naver.com\n`);

    // ==========================================
    // 1. Migrate sales_logs
    // ==========================================
    console.log('📊 Step 1: Migrating sales_logs collection...\n');

    const salesLogsSnapshot = await db.collection('sales_logs').get();
    const totalSalesLogs = salesLogsSnapshot.size;

    console.log(`   Total sales_logs documents: ${totalSalesLogs}`);

    let migratedSalesLogs = 0;
    let skippedSalesLogs = 0;

    const salesLogDocs = salesLogsSnapshot.docs;

    for (let i = 0; i < salesLogDocs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const batchDocs = salesLogDocs.slice(i, Math.min(i + BATCH_SIZE, salesLogDocs.length));

      for (const doc of batchDocs) {
        const data = doc.data();

        // Skip if already has companyId
        if (data.companyId) {
          skippedSalesLogs++;
          continue;
        }

        // Add companyId
        batch.update(doc.ref, {
          companyId: COMPANY_ID,
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        migratedSalesLogs++;
      }

      await batch.commit();

      const progress = Math.min(i + BATCH_SIZE, salesLogDocs.length);
      console.log(`   Progress: ${progress}/${salesLogDocs.length} (${Math.round(progress / salesLogDocs.length * 100)}%)`);
    }

    console.log(`\n   ✅ Migrated: ${migratedSalesLogs}`);
    console.log(`   ⏭️  Skipped: ${skippedSalesLogs}\n`);

    // ==========================================
    // 2. Migrate salesLogMemos
    // ==========================================
    console.log('📝 Step 2: Migrating salesLogMemos collection...\n');

    const memosSnapshot = await db.collection('salesLogMemos').get();
    const totalMemos = memosSnapshot.size;

    console.log(`   Total salesLogMemos documents: ${totalMemos}`);

    let migratedMemos = 0;
    let skippedMemos = 0;

    const memoDocs = memosSnapshot.docs;

    for (let i = 0; i < memoDocs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const batchDocs = memoDocs.slice(i, Math.min(i + BATCH_SIZE, memoDocs.length));

      for (const doc of batchDocs) {
        const data = doc.data();

        // Skip if already has companyId
        if (data.companyId) {
          skippedMemos++;
          continue;
        }

        // Add companyId
        batch.update(doc.ref, {
          companyId: COMPANY_ID,
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        migratedMemos++;
      }

      await batch.commit();

      const progress = Math.min(i + BATCH_SIZE, memoDocs.length);
      console.log(`   Progress: ${progress}/${memoDocs.length} (${Math.round(progress / memoDocs.length * 100)}%)`);
    }

    console.log(`\n   ✅ Migrated: ${migratedMemos}`);
    console.log(`   ⏭️  Skipped: ${skippedMemos}\n`);

    // ==========================================
    // 3. Verify
    // ==========================================
    console.log('🔍 Step 3: Verification...\n');

    const verifiedSalesLogs = await db.collection('sales_logs')
      .where('companyId', '==', COMPANY_ID)
      .get();

    const verifiedMemos = await db.collection('salesLogMemos')
      .where('companyId', '==', COMPANY_ID)
      .get();

    console.log(`   sales_logs: ${verifiedSalesLogs.size}/${totalSalesLogs} have companyId`);
    console.log(`   salesLogMemos: ${verifiedMemos.size}/${totalMemos} have companyId\n`);

    if (verifiedSalesLogs.size === totalSalesLogs && verifiedMemos.size === totalMemos) {
      console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!\n');
      console.log('📝 Summary:');
      console.log(`   ✨ ${migratedSalesLogs} sales_logs migrated`);
      console.log(`   ✨ ${migratedMemos} salesLogMemos migrated`);
      console.log(`   🏢 All data assigned to: ${COMPANY_ID}\n`);
    } else {
      console.log('⚠️  WARNING: Some documents not migrated\n');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

migrateSalesLogs();
