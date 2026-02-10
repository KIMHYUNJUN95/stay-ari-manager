/**
 * Multi-Tenant Migration Script
 *
 * Safely migrates existing Firestore data to multi-tenant structure
 * by adding companyId to all documents.
 *
 * ⚠️ IMPORTANT: Run Firebase backup before executing this script!
 */

const admin = require('firebase-admin');
const readline = require('readline');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Configuration
const BATCH_SIZE = 500;
const COLLECTIONS_TO_MIGRATE = [
  'reservations',
  // Add other collections if needed
  // 'customers',
  // 'rooms',
  // 'salesLogs'
];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Step 1: Get user's companyId
async function getUserCompanyId(email) {
  try {
    const usersSnapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      throw new Error(`No user found with email: ${email}`);
    }

    const userData = usersSnapshot.docs[0].data();
    return userData.companyId;
  } catch (error) {
    throw new Error(`Failed to get companyId: ${error.message}`);
  }
}

// Step 2: Count documents in collection
async function countDocuments(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.size;
}

// Step 3: Check how many documents already have companyId
async function countDocumentsWithCompanyId(collectionName) {
  const snapshot = await db.collection(collectionName)
    .where('companyId', '!=', null)
    .get();
  return snapshot.size;
}

// Step 4: Migrate collection
async function migrateCollection(collectionName, companyId) {
  log(`\n📦 Migrating collection: ${collectionName}`, 'cyan');

  const collectionRef = db.collection(collectionName);

  // Get all documents without companyId
  const snapshot = await collectionRef.get();
  const docs = snapshot.docs;

  log(`   Total documents: ${docs.length}`, 'blue');

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  // Process in batches
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchDocs = docs.slice(i, Math.min(i + BATCH_SIZE, docs.length));

    for (const doc of batchDocs) {
      const data = doc.data();

      // Skip if already has companyId
      if (data.companyId) {
        skippedCount++;
        continue;
      }

      try {
        // Add companyId field only
        batch.update(doc.ref, {
          companyId: companyId,
          migratedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        migratedCount++;
      } catch (error) {
        errorCount++;
        log(`   ⚠️  Error updating document ${doc.id}: ${error.message}`, 'red');
      }
    }

    // Commit batch
    await batch.commit();

    const progress = Math.min(i + BATCH_SIZE, docs.length);
    log(`   Progress: ${progress}/${docs.length} (${Math.round(progress / docs.length * 100)}%)`, 'blue');
  }

  log(`\n   ✅ Migrated: ${migratedCount}`, 'green');
  log(`   ⏭️  Skipped (already has companyId): ${skippedCount}`, 'yellow');
  if (errorCount > 0) {
    log(`   ❌ Errors: ${errorCount}`, 'red');
  }

  return { migratedCount, skippedCount, errorCount };
}

// Step 5: Verify migration
async function verifyMigration(collectionName, companyId) {
  log(`\n🔍 Verifying ${collectionName}...`, 'cyan');

  const totalSnapshot = await db.collection(collectionName).get();
  const withCompanyIdSnapshot = await db.collection(collectionName)
    .where('companyId', '==', companyId)
    .get();

  const total = totalSnapshot.size;
  const withCompanyId = withCompanyIdSnapshot.size;

  log(`   Total documents: ${total}`, 'blue');
  log(`   With companyId: ${withCompanyId}`, 'blue');

  if (total === withCompanyId) {
    log(`   ✅ Verification PASSED - All documents have companyId`, 'green');
    return true;
  } else {
    log(`   ⚠️  Verification WARNING - ${total - withCompanyId} documents missing companyId`, 'yellow');
    return false;
  }
}

// Main migration function
async function runMigration() {
  try {
    log('\n╔════════════════════════════════════════════════════════╗', 'cyan');
    log('║   HARU Studio - Multi-Tenant Migration Script         ║', 'cyan');
    log('╚════════════════════════════════════════════════════════╝', 'cyan');

    // Step 1: Get user email and companyId
    log('\n📝 Step 1: User Identification', 'yellow');
    const email = await askQuestion('\nEnter your email address: ');

    log('\n🔍 Fetching your company information...', 'blue');
    const companyId = await getUserCompanyId(email);
    log(`✅ Found companyId: ${companyId}`, 'green');

    // Step 2: Show current state
    log('\n📊 Step 2: Current State Analysis', 'yellow');
    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      const total = await countDocuments(collectionName);
      const withCompanyId = await countDocumentsWithCompanyId(collectionName);
      log(`   ${collectionName}: ${total} total, ${withCompanyId} already migrated`, 'blue');
    }

    // Step 3: Confirm migration
    log('\n⚠️  IMPORTANT SAFETY CHECKS:', 'yellow');
    log('   1. Have you backed up Firestore? (Firebase Console → Export)', 'yellow');
    log('   2. This will add companyId field to ALL existing data', 'yellow');
    log('   3. Existing data will NOT be modified, only new field added', 'yellow');
    log('   4. This operation is IRREVERSIBLE (use backup to restore)', 'yellow');

    const confirm1 = await askQuestion('\n✅ I have backed up Firestore (yes/no): ');
    if (confirm1.toLowerCase() !== 'yes') {
      log('\n❌ Migration cancelled. Please backup first!', 'red');
      rl.close();
      process.exit(0);
    }

    const confirm2 = await askQuestion(`✅ Assign all data to companyId: ${companyId} (yes/no): `);
    if (confirm2.toLowerCase() !== 'yes') {
      log('\n❌ Migration cancelled by user.', 'red');
      rl.close();
      process.exit(0);
    }

    // Step 4: Run migration
    log('\n🚀 Step 3: Running Migration', 'yellow');
    log('⏳ Please wait... This may take several minutes.\n', 'blue');

    const startTime = Date.now();
    const results = {};

    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      results[collectionName] = await migrateCollection(collectionName, companyId);
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Step 5: Verify
    log('\n🔍 Step 4: Verification', 'yellow');
    const verificationResults = {};
    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      verificationResults[collectionName] = await verifyMigration(collectionName, companyId);
    }

    // Step 6: Summary
    log('\n╔════════════════════════════════════════════════════════╗', 'cyan');
    log('║             MIGRATION SUMMARY                          ║', 'cyan');
    log('╚════════════════════════════════════════════════════════╝', 'cyan');

    log(`\n⏱️  Duration: ${duration} seconds`, 'blue');
    log(`\n📊 Results by Collection:`, 'blue');

    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      const result = results[collectionName];
      const verified = verificationResults[collectionName] ? '✅' : '⚠️';

      log(`\n   ${collectionName} ${verified}`, 'cyan');
      log(`      Migrated: ${result.migratedCount}`, 'green');
      log(`      Skipped: ${result.skippedCount}`, 'yellow');
      if (result.errorCount > 0) {
        log(`      Errors: ${result.errorCount}`, 'red');
      }

      totalMigrated += result.migratedCount;
      totalSkipped += result.skippedCount;
      totalErrors += result.errorCount;
    }

    log(`\n📈 Total Summary:`, 'blue');
    log(`   Total Migrated: ${totalMigrated}`, 'green');
    log(`   Total Skipped: ${totalSkipped}`, 'yellow');
    if (totalErrors > 0) {
      log(`   Total Errors: ${totalErrors}`, 'red');
    }

    if (totalErrors === 0 && Object.values(verificationResults).every(v => v)) {
      log('\n✅ MIGRATION COMPLETED SUCCESSFULLY!', 'green');
      log('   All data has been assigned to your company.', 'green');
      log('\n📝 Next Steps:', 'yellow');
      log('   1. Update dashboard components to filter by companyId', 'blue');
      log('   2. Test data isolation in the application', 'blue');
      log('   3. Monitor for any issues', 'blue');
    } else {
      log('\n⚠️  MIGRATION COMPLETED WITH WARNINGS', 'yellow');
      log('   Please check the logs above for details.', 'yellow');
    }

  } catch (error) {
    log(`\n❌ Migration failed: ${error.message}`, 'red');
    console.error(error);
  } finally {
    rl.close();
    process.exit(0);
  }
}

// Run migration
runMigration();
