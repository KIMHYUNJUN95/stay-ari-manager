const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ROOM_MAPPING (functions/index.js에서 복사)
const ROOM_MAPPING = {
  "383971": "201호", "601545": "201호", "403542": "202호", "601546": "202호",
  "383972": "301호", "601547": "301호", "383978": "302호", "601548": "302호",
  "440617": "401호", "515300": "401호", "383974": "402호", "601549": "402호",
  "502229": "501호", "383975": "501호", "383976": "502호", "601550": "502호",
  "537451": "602호", "601551": "602호", "383973": "701호", "601552": "701호",
  "383977": "702호", "601553": "702호",
  "585734": "101호", "585738": "102호", "585735": "201호", "585739": "202호",
  "585736": "301호", "585740": "302호", "585737": "401호", "585741": "402호",
  "440619": "B01호", "440620": "B02호", "440621": "101호", "440622": "102호",
  "440623": "201호", "440624": "202호", "440625": "302호",
  "383979": "202호", "451220": "202호", "383980": "203호", "452061": "203호",
  "383981": "302호", "452062": "302호", "383982": "303호", "451223": "303호",
  "383983": "402호", "451224": "402호", "383984": "403호", "452063": "403호",
  "543189": "502호", "601560": "502호", "383985": "603호", "452064": "603호",
  "441885": "802호", "452065": "802호", "624198": "803호",
  "437952": "오쿠보A", "615969": "오쿠보B", "450096": "오쿠보C", "496532": "오쿠보C",
  "481152": "사노",
  "513698": "201호", "513699": "301호", "513700": "401호", "556719": "401호",
  "513701": "501호", "513702": "601호", "513703": "701호", "513704": "801호", "513705": "901호"
};

async function findNewRooms() {
  console.log('=== Beds24에서 추가된 새로운 방 찾기 ===\n');

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  const newRoomIds = new Map(); // roomId -> { building, room, count, sampleId }

  snapshot.forEach(doc => {
    const data = doc.data();
    const roomId = data.roomId;
    const room = data.room;
    const building = data.building;

    // ROOM_MAPPING에 없는 roomId 찾기
    if (roomId && !ROOM_MAPPING[roomId]) {
      if (!newRoomIds.has(roomId)) {
        newRoomIds.set(roomId, {
          roomId: roomId,
          building: building,
          room: room,
          count: 0,
          sampleId: doc.id
        });
      }
      const info = newRoomIds.get(roomId);
      info.count++;
    }
  });

  if (newRoomIds.size === 0) {
    console.log('✅ 새로 추가된 방이 없습니다. 모든 방이 ROOM_MAPPING에 있습니다.\n');
    process.exit(0);
  }

  console.log('🆕 ROOM_MAPPING에 없는 새로운 방들:\n');

  const sorted = Array.from(newRoomIds.values()).sort((a, b) => {
    if (a.building !== b.building) {
      return a.building.localeCompare(b.building);
    }
    return a.roomId.localeCompare(b.roomId);
  });

  sorted.forEach(info => {
    console.log('건물: ' + info.building);
    console.log('  roomId: ' + info.roomId);
    console.log('  현재 표시: ' + info.room);
    console.log('  예약 개수: ' + info.count);
    console.log('  샘플 예약 ID: ' + info.sampleId);
    console.log('');
  });

  console.log('\n=== ROOM_MAPPING 추가 코드 (복사해서 사용) ===\n');

  const byBuilding = {};
  sorted.forEach(info => {
    if (!byBuilding[info.building]) {
      byBuilding[info.building] = [];
    }
    byBuilding[info.building].push(info);
  });

  Object.keys(byBuilding).sort().forEach(building => {
    console.log('// ' + building);
    byBuilding[building].forEach(info => {
      console.log('"' + info.roomId + '": "???호",  // TODO: 실제 방 번호 입력 (현재: ' + info.room + ')');
    });
    console.log('');
  });

  process.exit(0);
}

findNewRooms().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
