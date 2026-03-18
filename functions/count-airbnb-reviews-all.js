const axios = require('axios');

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

async function fetchAllReviewsForRoom(token, roomId) {
  let all = [];
  let nextLink = null;
  let pageCount = 0;

  while (pageCount < 20) {
    let result;
    if (nextLink) {
      const res = await axios.get(nextLink, { headers: { token } });
      result = res.data;
    } else {
      const res = await axios.get('https://beds24.com/api/v2/channels/airbnb/reviews', {
        headers: { token },
        params: { roomId: parseInt(roomId) }
      });
      result = res.data;
    }

    if (!result || !Array.isArray(result.data)) break;
    all.push(...result.data);

    if (result.pages?.nextPageExists && result.pages?.nextPageLink) {
      nextLink = result.pages.nextPageLink;
      pageCount++;
      await new Promise(r => setTimeout(r, 300));
    } else {
      break;
    }
  }
  return all;
}

async function run() {
  const tokenRes = await axios.get('https://beds24.com/api/v2/authentication/token', {
    headers: { refreshToken: 'f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=' }
  });
  const token = tokenRes.data.token;
  console.log('토큰 OK\n');

  let grandTotal = 0;
  const seenIds = new Set();

  for (const [building, rooms] of Object.entries(BUILDING_ROOMS)) {
    let buildingTotal = 0;
    for (const roomId of rooms) {
      try {
        const reviews = await fetchAllReviewsForRoom(token, roomId);
        for (const r of reviews) seenIds.add(r.id);
        buildingTotal += reviews.length;
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {
        // 400: Airbnb 미연동 방 skip
      }
    }
    if (buildingTotal > 0) console.log(building + ': ' + buildingTotal + '건');
    grandTotal += buildingTotal;
  }

  console.log('\n전체 합계(중복 포함): ' + grandTotal + '건');
  console.log('고유 리뷰 ID 기준: ' + seenIds.size + '건');
}

run().catch(e => { console.error(e.message); process.exit(1); });
