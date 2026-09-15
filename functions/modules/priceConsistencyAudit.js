/**
 * Beds24 ↔ price_sync 캐시 정합성 대조 (읽기 전용).
 *
 * 운영 기준: 객실 오픈 시 Beds24에 약 12개월치 가격을 넣으므로,
 * "오늘 기준 Beds24에 열려 있는 날짜"는 모든 객실에서 금액(p1/p2)과
 * 최소숙박일수(m)가 우리 웹 캐시와 정확히 일치해야 한다.
 *
 * 이 모듈은 어떤 쓰기도 하지 않는다. 불일치 목록만 반환한다.
 */

const DEFAULT_AUDIT_MONTHS = 12;
const GET_BATCH_SIZE = 20;
const DEFAULT_SAMPLE_LIMIT = 20;

function toDateKey(dateStr) {
    return String(dateStr || "").replace(/-/g, "");
}

function toNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Beds24 calendar 응답(from~to 범위 배열)을 날짜별 맵으로 펼친다.
 * 동기화 코드와 동일한 방식이어야 대조 결과가 의미를 갖는다.
 */
function expandCalendarEntries(calendar, dayjs) {
    const byDateKey = {};
    (calendar || []).forEach((entry) => {
        const from = dayjs(entry.from);
        const to = dayjs(entry.to);
        if (!from.isValid() || !to.isValid()) return;
        for (let d = from; d.isBefore(to) || d.isSame(to, "day"); d = d.add(1, "day")) {
            byDateKey[d.format("YYYYMMDD")] = entry;
        }
    });
    return byDateKey;
}

function createPriceConsistencyAuditModule({
    onRequest,
    db,
    dayjs,
    beds24GetRoomCalendarAllPages,
    normalizeBeds24MinStay,
    authorizeInternalRequest,
    BUILDING_ROOMS,
    PROPERTIES,
    DEFAULT_COMPANY_ID
}) {
    async function auditBuilding({ building, fromDate, toDate, sampleLimit }) {
        const rooms = BUILDING_ROOMS[building] || [];
        if (rooms.length === 0) {
            return { building, checkedRooms: 0, openDates: 0, mismatchCount: 0, missingCount: 0, rooms: [] };
        }

        const roomById = new Map(rooms.map((room) => [String(room.roomId), room]));
        const roomIds = [...roomById.keys()];

        // Beds24 live 조회 (배치) — 페이지 끝까지 읽는다.
        // 잘린 걸 모르고 넘어가면 "비교할 날짜가 없다"가 "일치한다"로 잘못 보고된다.
        const truncatedBatches = [];
        const fetchLive = async (includeLinkedPrices, tag) => {
            const byRoomId = new Map();
            for (let i = 0; i < roomIds.length; i += GET_BATCH_SIZE) {
                const chunk = roomIds.slice(i, i + GET_BATCH_SIZE);
                const pageResult = await beds24GetRoomCalendarAllPages({
                    roomId: chunk,
                    startDate: fromDate,
                    endDate: toDate,
                    includePrices: true,
                    includeLinkedPrices,
                    includeMinStay: true,
                    includeNumAvail: true,
                    includeOverride: true
                }, { label: `audit ${building} ${tag} [${chunk.join(",")}]` });

                if (pageResult.truncated) {
                    truncatedBatches.push(`${tag}:${chunk.join(",")}`);
                }
                pageResult.roomsById.forEach((roomData, rid) => byRoomId.set(rid, roomData));
            }
            return byRoomId;
        };

        // effective: 링크로 파생된 값까지 포함한 "실제 팔리는 가격" (캐시가 이 기준으로 만들어진다)
        // own: 그 roomId에 직접 저장된 값만. 둘을 비교하면 저장/파생 여부를 판별할 수 있다.
        const liveByRoomId = await fetchLive(true, "effective");
        const ownByRoomId = await fetchLive(false, "own");

        // 캐시 조회
        const buildingRef = db.collection("price_sync").doc(building);
        const cacheSnaps = await Promise.all(
            roomIds.map((roomId) => buildingRef.collection("rooms").doc(roomId).get())
        );
        const cacheByRoomId = new Map();
        cacheSnaps.forEach((snap, index) => {
            cacheByRoomId.set(roomIds[index], snap.exists ? (snap.data()?.dates || {}) : null);
        });

        const roomReports = [];
        let buildingOpenDates = 0;
        let buildingMismatches = 0;
        let buildingMissing = 0;

        roomIds.forEach((roomId) => {
            const roomInfo = roomById.get(roomId);
            const liveRoom = liveByRoomId.get(roomId);
            const cacheDates = cacheByRoomId.get(roomId);

            if (!liveRoom || !Array.isArray(liveRoom.calendar)) {
                roomReports.push({
                    roomId,
                    roomName: roomInfo?.name || "",
                    status: "beds24_no_data",
                    openDates: 0,
                    mismatches: [],
                    missingDates: 0
                });
                return;
            }

            const liveByDateKey = expandCalendarEntries(liveRoom.calendar, dayjs);
            const openDateKeys = Object.keys(liveByDateKey).sort();
            buildingOpenDates += openDateKeys.length;

            if (cacheDates === null) {
                buildingMissing += openDateKeys.length;
                roomReports.push({
                    roomId,
                    roomName: roomInfo?.name || "",
                    status: "cache_room_missing",
                    openDates: openDateKeys.length,
                    mismatches: [],
                    missingDates: openDateKeys.length
                });
                return;
            }

            const mismatches = [];
            let missingDates = 0;

            openDateKeys.forEach((dateKey) => {
                const liveEntry = liveByDateKey[dateKey];
                const cacheEntry = cacheDates[dateKey];

                if (!cacheEntry) {
                    missingDates++;
                    return;
                }

                const diffs = [];

                const liveP1 = toNumber(liveEntry.price1);
                const cacheP1 = toNumber(cacheEntry.p1);
                if (liveP1 !== cacheP1) diffs.push({ field: "price1", beds24: liveP1, cache: cacheP1 });

                const liveP2 = toNumber(liveEntry.price2);
                const cacheP2 = toNumber(cacheEntry.p2);
                if (liveP2 !== cacheP2) diffs.push({ field: "price2", beds24: liveP2, cache: cacheP2 });

                // Beds24는 minStay 1을 빈칸으로 돌려주므로 양쪽 모두 정규화 후 비교한다.
                const liveMinStay = Number(normalizeBeds24MinStay(liveEntry.minStay));
                const cacheMinStay = Number(normalizeBeds24MinStay(cacheEntry.m));
                if (liveMinStay !== cacheMinStay) {
                    diffs.push({ field: "minStay", beds24: liveMinStay, cache: cacheMinStay });
                }

                if (diffs.length > 0) {
                    mismatches.push({
                        date: `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`,
                        diffs
                    });
                }
            });

            buildingMismatches += mismatches.length;
            buildingMissing += missingDates;

            roomReports.push({
                roomId,
                roomName: roomInfo?.name || "",
                status: mismatches.length === 0 && missingDates === 0 ? "ok" : "mismatch",
                openDates: openDateKeys.length,
                firstOpenDate: openDateKeys[0] || null,
                lastOpenDate: openDateKeys[openDateKeys.length - 1] || null,
                mismatchCount: mismatches.length,
                missingDates,
                mismatches: mismatches.slice(0, sampleLimit)
            });
        });

        // ===== 듀얼 ID 교차 분석 =====
        // 평소에는 한쪽 ID만 팔리므로 링크가 끊겨도 드러나지 않는다.
        // 두 ID가 동시에 열리는 "교차일"에만 비-source ID가 옛 가격으로 팔리는 사고가 난다.
        // 그래서 교차일에 한정해 ID 간 유효가격이 같은지를 따로 본다.
        const roomIdsByName = {};
        rooms.forEach((room) => {
            const name = String(room.name || "");
            if (!roomIdsByName[name]) roomIdsByName[name] = [];
            roomIdsByName[name].push(String(room.roomId));
        });

        const dualRoomReports = [];
        Object.entries(roomIdsByName).forEach(([roomName, ids]) => {
            if (ids.length < 2) return;

            const expandedEffective = {};
            const expandedOwn = {};
            ids.forEach((rid) => {
                expandedEffective[rid] = expandCalendarEntries(liveByRoomId.get(rid)?.calendar, dayjs);
                expandedOwn[rid] = expandCalendarEntries(ownByRoomId.get(rid)?.calendar, dayjs);
            });

            // 각 roomId가 가격을 직접 저장하는지(stored) 링크로 파생받는지(derived) 판별
            const linkage = {};
            ids.forEach((rid) => {
                let stored = 0;
                let derivedOnly = 0;
                Object.entries(expandedEffective[rid]).forEach(([dateKey, entry]) => {
                    const effectivePrice = toNumber(entry?.price1);
                    const ownPrice = toNumber(expandedOwn[rid][dateKey]?.price1);
                    if (ownPrice > 0) stored++;
                    else if (effectivePrice > 0) derivedOnly++;
                });
                linkage[rid] = stored > 0 && derivedOnly === 0 ? "stored"
                    : derivedOnly > 0 && stored === 0 ? "derived"
                        : derivedOnly > 0 ? "mixed" : "none";
            });

            const allDateKeys = [...new Set(ids.flatMap((rid) => Object.keys(expandedEffective[rid])))].sort();
            let crossoverDates = 0;
            let crossoverMismatchDates = 0;
            const crossoverSamples = [];

            // 운영 기준: 활성/비활성과 무관하게 같은 객실의 모든 roomId는 가격이 같아야 한다.
            // 그래서 전 날짜를 비교하고, 그중 교차일(두 ID가 동시에 열린 날)은 별도로 집계한다.
            // 교차일 불일치는 실제로 잘못된 가격에 팔리는 것이라 심각도가 다르기 때문이다.
            let comparedDates = 0;
            let mismatchDates = 0;
            let zeroVsPricedDates = 0;
            const mismatchSamples = [];

            allDateKeys.forEach((dateKey) => {
                // 두 개 이상의 ID가 그 날짜에 캘린더 항목을 가진 경우에만 비교 가능
                const presentIds = ids.filter((rid) => expandedEffective[rid][dateKey]);
                if (presentIds.length < 2) return;

                comparedDates++;

                // 사내 룰: minStay 1~49 = 활성. 50 이상(50~99)은 비활성으로 닫아둔 상태.
                const activeIds = presentIds.filter((rid) => {
                    const ms = Number(normalizeBeds24MinStay(expandedEffective[rid][dateKey]?.minStay));
                    return ms >= 1 && ms < 50;
                });
                const isCrossover = activeIds.length >= 2;
                if (isCrossover) crossoverDates++;

                const prices = presentIds.map((rid) => toNumber(expandedEffective[rid][dateKey]?.price1));
                if (prices.every((p) => p === prices[0])) return;

                mismatchDates++;
                // 한쪽만 가격이 비어 있는 경우와, 둘 다 값이 있는데 서로 다른 경우는 원인이 다르다.
                const kind = prices.some((p) => p === 0) && prices.some((p) => p > 0)
                    ? "zero_vs_priced" : "price_diff";
                if (kind === "zero_vs_priced") zeroVsPricedDates++;
                if (isCrossover) crossoverMismatchDates++;

                if (mismatchSamples.length < sampleLimit) {
                    mismatchSamples.push({
                        date: `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`,
                        kind,
                        crossover: isCrossover,
                        prices: presentIds.reduce((acc, rid) => {
                            acc[rid] = {
                                effective: toNumber(expandedEffective[rid][dateKey]?.price1),
                                own: toNumber(expandedOwn[rid][dateKey]?.price1),
                                minStay: Number(normalizeBeds24MinStay(expandedEffective[rid][dateKey]?.minStay))
                            };
                            return acc;
                        }, {})
                    });
                    if (isCrossover && crossoverSamples.length < sampleLimit) {
                        crossoverSamples.push(mismatchSamples[mismatchSamples.length - 1]);
                    }
                }
            });

            dualRoomReports.push({
                roomName,
                roomIds: ids,
                linkage,
                comparedDates,
                mismatchDates,
                zeroVsPricedDates,
                crossoverDates,
                crossoverMismatchDates,
                status: mismatchDates === 0 ? "ok"
                    : crossoverMismatchDates > 0 ? "crossover_price_mismatch"
                        : "price_mismatch",
                mismatchSamples,
                crossoverSamples
            });
        });

        const crossoverMismatchTotal = dualRoomReports.reduce((s, r) => s + r.crossoverMismatchDates, 0);
        const crossoverDateTotal = dualRoomReports.reduce((s, r) => s + r.crossoverDates, 0);
        const dualComparedTotal = dualRoomReports.reduce((s, r) => s + r.comparedDates, 0);
        const dualMismatchTotal = dualRoomReports.reduce((s, r) => s + r.mismatchDates, 0);

        return {
            building,
            checkedRooms: roomIds.length,
            openDates: buildingOpenDates,
            mismatchCount: buildingMismatches,
            missingCount: buildingMissing,
            truncatedBatches,
            dualRooms: dualRoomReports,
            dualComparedDates: dualComparedTotal,
            dualMismatchDates: dualMismatchTotal,
            crossoverDates: crossoverDateTotal,
            crossoverMismatchDates: crossoverMismatchTotal,
            rooms: roomReports
        };
    }

    const auditPriceConsistency = onRequest(
        { cors: true, timeoutSeconds: 540, memory: "2GiB", maxInstances: 2 },
        async (req, res) => {
            try {
                if (req.method !== "POST") {
                    return res.status(400).json({ success: false, error: "POST required" });
                }

                // Beds24 크레딧을 소비하는 엔드포인트라 companyId만으로는 보호가 되지 않는다.
                // Firebase ID 토큰 + owner/manager 권한을 요구한다.
                if (typeof authorizeInternalRequest !== "function") {
                    return res.status(500).json({ success: false, error: "Authorization handler not configured" });
                }
                try {
                    await authorizeInternalRequest(req);
                } catch (authError) {
                    return res.status(authError.statusCode || 401).json({ success: false, error: authError.message });
                }

                const companyId = String(req.body?.companyId || "").trim();
                if (!companyId) {
                    return res.status(400).json({ success: false, error: "Missing companyId" });
                }
                if (companyId !== DEFAULT_COMPANY_ID) {
                    return res.status(403).json({ success: false, error: "Access denied: companyId mismatch" });
                }

                const requestedBuilding = String(req.body?.building || "").trim();
                const targetBuildings = requestedBuilding
                    ? [requestedBuilding]
                    : PROPERTIES.filter((prop) => !prop.disabled).map((prop) => prop.name);

                if (requestedBuilding && !BUILDING_ROOMS[requestedBuilding]) {
                    return res.status(400).json({ success: false, error: `Unknown building: ${requestedBuilding}` });
                }

                const tokyoNow = dayjs().utcOffset(9);
                const fromDate = String(req.body?.dateFrom || tokyoNow.format("YYYY-MM-DD"));
                const toDate = String(req.body?.dateTo || tokyoNow.add(DEFAULT_AUDIT_MONTHS, "month").format("YYYY-MM-DD"));
                const sampleLimit = Number.isFinite(Number(req.body?.sampleLimit))
                    ? Math.max(1, Math.min(200, Number(req.body.sampleLimit)))
                    : DEFAULT_SAMPLE_LIMIT;

                const buildingReports = [];
                for (const building of targetBuildings) {
                    const report = await auditBuilding({ building, fromDate, toDate, sampleLimit });
                    buildingReports.push(report);
                    console.log(
                        `[PriceAudit] ${building}: rooms=${report.checkedRooms}, openDates=${report.openDates}, ` +
                        `mismatch=${report.mismatchCount}, missing=${report.missingCount}`
                    );
                }

                const summary = buildingReports.reduce((acc, report) => ({
                    checkedRooms: acc.checkedRooms + report.checkedRooms,
                    openDates: acc.openDates + report.openDates,
                    mismatchCount: acc.mismatchCount + report.mismatchCount,
                    missingCount: acc.missingCount + report.missingCount,
                    truncatedBatchCount: acc.truncatedBatchCount + (report.truncatedBatches?.length || 0),
                    // 듀얼 ID는 활성/비활성과 무관하게 전 날짜에서 가격이 같아야 한다.
                    dualComparedDates: acc.dualComparedDates + (report.dualComparedDates || 0),
                    dualMismatchDates: acc.dualMismatchDates + (report.dualMismatchDates || 0),
                    // 그중 교차일(동시 개방)은 실제로 잘못된 가격에 팔리는 것이라 별도 집계한다.
                    crossoverDates: acc.crossoverDates + (report.crossoverDates || 0),
                    crossoverMismatchDates: acc.crossoverMismatchDates + (report.crossoverMismatchDates || 0)
                }), {
                    checkedRooms: 0, openDates: 0, mismatchCount: 0, missingCount: 0,
                    truncatedBatchCount: 0, dualComparedDates: 0, dualMismatchDates: 0,
                    crossoverDates: 0, crossoverMismatchDates: 0
                });

                // 응답이 잘렸으면 비교 자체가 불완전하므로 "일치"라고 단정하지 않는다.
                const complete = summary.truncatedBatchCount === 0;

                return res.json({
                    success: true,
                    complete,
                    // 듀얼 ID 가격 불일치는 "캐시가 틀렸다"가 아니라 "Beds24 쪽이 어긋나 있다"는 뜻이라
                    // consistent 판정에 반드시 포함한다. (교차일은 그중에서도 실제 판매에 영향을 주는 부분집합)
                    consistent: complete
                        && summary.mismatchCount === 0
                        && summary.missingCount === 0
                        && summary.dualMismatchDates === 0,
                    range: { dateFrom: fromDate, dateTo: toDate },
                    summary,
                    buildings: buildingReports
                });
            } catch (e) {
                console.error("auditPriceConsistency Error:", e.response?.data || e.message);
                return res.status(500).json({ success: false, error: e.message });
            }
        }
    );

    return { auditPriceConsistency };
}

module.exports = { createPriceConsistencyAuditModule };
