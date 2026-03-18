const axios = require('axios');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const BUILDING_ROOMS = {
  '아라키초A': ['383971','601545','403542','601546','383972','601547','383978','601548','440617','515300','383974','601549','383975','502229','383976','601550','537451','601551','383973','601552','383977','601553'],
  '아라키초B': ['585734','585738','585735','585739','585736','585740','585737','585741'],
  '다이쿄초': ['440619','440620','440621','440622','440623','440624','440625'],
  '가부키초': ['383979','451220','383980','452061','383981','452062','383982','451223','383983','451224','383984','452063','543189','601560','383985','452064','441885','452065','624198','648398'],
  '다카다노바바': ['513698','513699','513700','556719','513701','513702','513703','513704','513705'],
  '오쿠보A동': ['437952'],
  '오쿠보B동': ['615969'],
  '오쿠보C동': ['450096','496532','648399'],
  '사노시': ['481152']
};

async function run() {
  const tokenRes = await axios.get('https://beds24.com/api/v2/authentication/token', {
    headers: { refreshToken: 'f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=' }
  });
  const token = tokenRes.data.token;
  console.log('토큰 OK');

  const snap = await db.collection('reviews').where('channel', '==', 'airbnb').get();
  const existingIds = new Set(snap.docs.map(d => d.id));
  console.log('Firestore 에어비앤비 리뷰: ' + existingIds.size + '건');

  let beds24Total = 0;
  let missing = [];

  for (const [building, rooms] of Object.entries(BUILDING_ROOMS)) {
    for (const roomId of rooms) {
      try {
        const res = await axios.get('https://beds24.com/api/v2/channels/airbnb/reviews', {
          headers: { token },
          params: { roomId: parseInt(roomId) }
        });
        const data = (res.data && res.data.data) ? res.data.data : [];
        beds24Total += data.length;
        for (const r of data) {
          const docId = 'airbnb_' + r.id;
          const inDB = existingIds.has(docId);
          if (!inDB) {
            missing.push({ docId, building, roomId, date: r.submitted_at || r.first_completed_at || '?' });
          }
        }
      } catch(e) {
        // skip
      }
    }
  }

  console.log('Beds24 에어비앤비 리뷰 총: ' + beds24Total + '건');
  console.log('누락(DB에 없는): ' + missing.length + '건');
  if (missing.length > 0) {
    missing.slice(0, 30).forEach(m => console.log('  -', m.building, 'room=' + m.roomId, m.date, m.docId));
    if (missing.length > 30) console.log('  ... 외 ' + (missing.length - 30) + '건');
  }
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
