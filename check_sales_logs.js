const admin = require('firebase-admin');
const serviceAccount = require('./functions/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

Promise.all([
  db.collection('sales_logs').doc('2026-03-11').get(),
  db.collection('sales_logs').doc('2026-03-12').get(),
]).then(([d11, d12]) => {
  const s11 = d11.data()?.monthlyStats || {};
  const s12 = d12.data()?.monthlyStats || {};
  const months = [...new Set([...Object.keys(s11), ...Object.keys(s12)])].sort();
  console.log('월별 매출/가동률 비교 (11일 vs 12일):');
  months.forEach(m => {
    const r11 = s11[m]?.revenue || 0;
    const r12 = s12[m]?.revenue || 0;
    const o11 = s11[m]?.occupancy || 0;
    const o12 = s12[m]?.occupancy || 0;
    const diff = r12 - r11;
    console.log(m + ': 11일=¥' + r11.toLocaleString() + ' (' + o11 + '%) / 12일=¥' + r12.toLocaleString() + ' (' + o12 + '%) / 차이=' + (diff >= 0 ? '+' : '') + diff.toLocaleString());
  });
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
