const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const axios = require("axios");
const { collectTodayAssignments } = require("../modules/hotelsmart/collectTodayAssignments");

const DEFAULT_COMPANY_ID = "dGxlQyu47LbplLVCVXiV";
const DEFAULT_DATES = [
    "2026-07-07",
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
    "2026-07-11",
    "2026-07-12",
    "2026-07-13",
];

const TEXT = {
    title: "\uCCAD\uC18C/\uC14B\uD305 \uC6B4\uC601 \uC54C\uB9BC",
    dateLabel: "\uAE30\uC900\uC77C",
    cleaningTitle: "1. \uCCAD\uC18C\uD574\uC57C \uD558\uB294 \uAC1D\uC2E4",
    settingTitle: "2. \uC14B\uD305\uD574\uC57C \uD558\uB294 \uAC1D\uC2E4",
    noSameDayCheckin: "\uB2F9\uC77C \uCCB4\uD06C\uC778 \uC5C6\uC74C",
    nextCheckin: "\uB2E4\uC74C \uCCB4\uD06C\uC778",
    paxSuffix: "\uBA85",
    assignee: "\uB2F4\uB2F9",
    unknown: "\uBBF8\uC815",
    none: "\uC5C6\uC74C",
    etc: "\uAE30\uD0C0",
};

const BUILDINGS = {
    arakichoA: "\uC544\uB77C\uD0A4\uCD08A",
    arakichoB: "\uC544\uB77C\uD0A4\uCD08B",
    kabukicho: "\uAC00\uBD80\uD0A4\uCD08",
    takadanobaba: "\uB2E4\uCE74\uB2E4\uB178\uBC14\uBC14",
    okuboA: "\uC624\uCFE0\uBCF4A\uB3D9",
    okuboB: "\uC624\uCFE0\uBCF4B\uB3D9",
    okuboC: "\uC624\uCFE0\uBCF4C\uB3D9",
    daikyocho: "\uB2E4\uC774\uCFC4\uCD08",
};

const BUILDING_ORDER = [
    BUILDINGS.arakichoA,
    BUILDINGS.arakichoB,
    BUILDINGS.kabukicho,
    BUILDINGS.takadanobaba,
    BUILDINGS.okuboA,
    BUILDINGS.okuboB,
    BUILDINGS.okuboC,
];

const BUILDING_LABELS = {
    [BUILDINGS.okuboA]: "\uC624\uCFE0\uBCF4A (B\uB3D9)",
    [BUILDINGS.okuboB]: "\uC624\uCFE0\uBCF4B (A\uB3D9)",
};

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        dryRun: args.includes("--dry-run"),
        dates: DEFAULT_DATES,
    };

    const datesArg = args.find((arg) => arg.startsWith("--dates="));
    if (datesArg) {
        options.dates = datesArg
            .slice("--dates=".length)
            .split(",")
            .map((date) => date.trim())
            .filter(Boolean);
    }

    return options;
}

function readEnvFile() {
    const envPath = path.join(process.cwd(), ".env");
    const envText = fs.readFileSync(envPath, "utf8");
    return Object.fromEntries(envText
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const index = line.indexOf("=");
            if (index === -1) return [line, ""];
            return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
        }));
}

function getEffectiveCompanyId(data) {
    return data?.companyId || DEFAULT_COMPANY_ID;
}

function filterDocsToCompany(docs, companyId = DEFAULT_COMPANY_ID) {
    return docs.filter((doc) => getEffectiveCompanyId(doc) === companyId);
}

function getReservationPax(reservation) {
    return (reservation?.numAdult || 0) + (reservation?.numChild || 0);
}

function sortCleaningByBuilding(list) {
    return [...list].sort((a, b) => {
        const i = BUILDING_ORDER.indexOf(a.building);
        const j = BUILDING_ORDER.indexOf(b.building);
        const oi = i === -1 ? 999 : i;
        const oj = j === -1 ? 999 : j;
        if (oi !== oj) return oi - oj;
        return String(a.room || "").localeCompare(String(b.room || ""));
    });
}

function formatCleaningRoomCode(building, room) {
    const roomName = String(room || "");
    const roomDigits = roomName.replace(/[^0-9]/g, "");
    if (!roomDigits) return roomName;
    if (building === BUILDINGS.arakichoA) return `AA${roomDigits}`;
    if (building === BUILDINGS.arakichoB) return `AB${roomDigits}`;
    if (building === BUILDINGS.kabukicho) return `K${roomDigits}`;
    if (building === BUILDINGS.takadanobaba) {
        const floorNumber = Number(roomDigits[0]);
        if (Number.isFinite(floorNumber) && floorNumber >= 2 && floorNumber <= 9) return `T${floorNumber}`;
        return `T${roomDigits}`;
    }
    return roomName;
}

function formatCleaningBuildingLabel(building) {
    return BUILDING_LABELS[building] || building;
}

function normalizeCleaningBuildingKey(building) {
    if (building === BUILDINGS.arakichoA || building === "Arakicho A") return "arakicho_a";
    if (building === BUILDINGS.arakichoB || building === "Arakicho B") return "arakicho_b";
    if (building === BUILDINGS.kabukicho || building === "Kabukicho") return "kabukicho";
    if (building === BUILDINGS.takadanobaba || building === "Takadanobaba") return "takadanobaba";
    if (building === BUILDINGS.okuboC || building === "Okubo_C (kr)") return "okubo_c";
    if (building === BUILDINGS.okuboB || building === "OkuboB") return "okubo_b";
    if (building === BUILDINGS.okuboA || building === "OkuboA" || building === "STAY ARI") return "okubo_a";
    return String(building || "");
}

function getCleaningAssignmentLookupKey(building, room) {
    const buildingKey = normalizeCleaningBuildingKey(building);
    const upperRoom = String(room || "").trim().toUpperCase().replace(/\s+/g, "");
    const roomDigits = upperRoom.replace(/[^0-9]/g, "");
    let canonicalRoom = upperRoom;

    if (buildingKey === "arakicho_a" && roomDigits) canonicalRoom = `AA${roomDigits}`;
    else if (buildingKey === "arakicho_b" && roomDigits) canonicalRoom = `AB${roomDigits}`;
    else if (buildingKey === "kabukicho" && roomDigits) canonicalRoom = `K${roomDigits}`;
    else if (buildingKey === "takadanobaba" && roomDigits) canonicalRoom = `T${roomDigits[0]}`;
    else if (buildingKey === "okubo_a" && !roomDigits) canonicalRoom = "OKUBOA";
    else if (buildingKey === "okubo_c" && !roomDigits) canonicalRoom = "OKUBOC";
    else if (buildingKey === "okubo_b" && !roomDigits) canonicalRoom = "OKUBOB";

    return `${buildingKey}__${canonicalRoom}`;
}

function formatHotelsmartRoomCodeForSlack(building, room) {
    const buildingKey = normalizeCleaningBuildingKey(building);
    const upperRoom = String(room || "").trim().toUpperCase().replace(/\s+/g, "");
    const roomDigits = upperRoom.replace(/[^0-9]/g, "");

    if (buildingKey === "arakicho_a" && roomDigits) return `AA${roomDigits}`;
    if (buildingKey === "arakicho_b" && roomDigits) return `AB${roomDigits}`;
    if (buildingKey === "kabukicho" && roomDigits) return `K${roomDigits}`;
    if (buildingKey === "takadanobaba" && roomDigits) return `T${roomDigits[0]}`;
    if (buildingKey === "okubo_a" && !roomDigits) return "\uC624\uCFE0\uBCF4A";
    if (buildingKey === "okubo_c" && !roomDigits) return "\uC624\uCFE0\uBCF4C";
    if (buildingKey === "okubo_b" && !roomDigits) return "\uC624\uCFE0\uBCF4B";
    return String(room || "").trim();
}

function buildAssigneeMap(hotelsmartData) {
    const assigneeMap = new Map();
    for (const property of hotelsmartData.properties || []) {
        for (const assignment of property.assignments || []) {
            const roomValue = assignment.roomCodeNormalized || assignment.roomRaw || "";
            const assigneeName = String(assignment.assigneeNormalized || "").trim();
            if (!assigneeName) continue;

            const keys = [
                getCleaningAssignmentLookupKey(assignment.propertyName, roomValue),
                formatHotelsmartRoomCodeForSlack(assignment.propertyName, roomValue),
            ].filter(Boolean);

            for (const key of keys) {
                if (!assigneeMap.has(key)) assigneeMap.set(key, []);
                const bucket = assigneeMap.get(key);
                if (!bucket.includes(assigneeName)) bucket.push(assigneeName);
            }
        }
    }
    return assigneeMap;
}

function assertMessageIsSafe(text, targetDateStr) {
    const badPatterns = [
        /\?{2,}/u,
        /\uFFFD/u,
    ];
    const hasRequiredKorean = [
        TEXT.title,
        TEXT.dateLabel,
        TEXT.cleaningTitle,
        TEXT.settingTitle,
    ].every((value) => text.includes(value));

    if (!hasRequiredKorean || badPatterns.some((pattern) => pattern.test(text))) {
        throw new Error(`Unsafe message text for ${targetDateStr}`);
    }
}

async function buildMessage(db, targetDateStr) {
    const hotelsmartData = await collectTodayAssignments({ operatingDate: targetDateStr });
    const assigneeMap = buildAssigneeMap(hotelsmartData);

    const [departuresSnap, arrivalsSnap] = await Promise.all([
        db.collection("reservations")
            .where("companyId", "==", DEFAULT_COMPANY_ID)
            .where("status", "==", "confirmed")
            .where("departure", "==", targetDateStr)
            .get(),
        db.collection("reservations")
            .where("companyId", "==", DEFAULT_COMPANY_ID)
            .where("status", "==", "confirmed")
            .where("arrival", "==", targetDateStr)
            .get(),
    ]);

    const departures = filterDocsToCompany(departuresSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })))
        .filter((reservation) => reservation.building !== BUILDINGS.daikyocho);
    const arrivals = filterDocsToCompany(arrivalsSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id })))
        .filter((reservation) => reservation.building !== BUILDINGS.daikyocho);

    const departureRoomKeys = new Set(departures.map((reservation) => `${reservation.building || ""}_${reservation.room || ""}`));
    const arrivalByKey = Object.fromEntries(arrivals.map((reservation) => [
        `${reservation.building || ""}_${reservation.room || ""}`,
        reservation,
    ]));

    const cleaningList = await Promise.all(departures.map(async (departure) => {
        const key = `${departure.building || ""}_${departure.room || ""}`;
        const arrival = arrivalByKey[key];
        if (arrival) {
            return {
                building: departure.building,
                room: departure.room,
                label: `${arrival.guestName || TEXT.unknown} | ${getReservationPax(arrival)}${TEXT.paxSuffix}`,
            };
        }

        const nextCheckinSnap = await db.collection("reservations")
            .where("companyId", "==", DEFAULT_COMPANY_ID)
            .where("status", "==", "confirmed")
            .where("building", "==", departure.building)
            .where("room", "==", departure.room)
            .where("arrival", ">", targetDateStr)
            .orderBy("arrival", "asc")
            .limit(1)
            .get();
        const nextCheckin = nextCheckinSnap.docs
            .map((doc) => doc.data())
            .find((doc) => getEffectiveCompanyId(doc) === DEFAULT_COMPANY_ID);

        if (nextCheckin) {
            return {
                building: departure.building,
                room: departure.room,
                label: `${TEXT.noSameDayCheckin} | ${TEXT.nextCheckin} ${nextCheckin.arrival}: ${nextCheckin.guestName || TEXT.unknown} | ${getReservationPax(nextCheckin)}${TEXT.paxSuffix}`,
            };
        }

        return { building: departure.building, room: departure.room, label: TEXT.noSameDayCheckin };
    }));

    const settingList = arrivals
        .filter((arrival) => !departureRoomKeys.has(`${arrival.building || ""}_${arrival.room || ""}`))
        .map((arrival) => ({
            building: arrival.building,
            room: arrival.room,
            label: `${arrival.guestName || TEXT.unknown} | ${getReservationPax(arrival)}${TEXT.paxSuffix}`,
        }));

    function byBuilding(list, title, includeAssignees = false) {
        const groups = {};
        for (const item of list) {
            const building = item.building || TEXT.etc;
            if (!groups[building]) groups[building] = [];
            const roomCode = formatCleaningRoomCode(item.building, item.room);
            const assignmentKey = getCleaningAssignmentLookupKey(item.building, item.room);
            const assigneeNames = includeAssignees
                ? (assigneeMap.get(assignmentKey) || assigneeMap.get(roomCode) || null)
                : null;
            const assigneeSuffix = assigneeNames && assigneeNames.length > 0
                ? ` | ${TEXT.assignee}: ${assigneeNames.join(", ")}`
                : "";
            groups[building].push(`${roomCode} | ${item.label}${assigneeSuffix}`);
        }

        const lines = [];
        for (const building of BUILDING_ORDER) {
            if (!groups[building] || groups[building].length === 0) continue;
            lines.push(`${formatCleaningBuildingLabel(building)}\n${groups[building].join("\n")}`);
        }
        return lines.length === 0 ? `${title}\n${TEXT.none}` : `${title}\n${lines.join("\n\n")}`;
    }

    const cleaningBlock = byBuilding(sortCleaningByBuilding(cleaningList.filter(Boolean)), TEXT.cleaningTitle, true);
    const settingBlock = byBuilding(sortCleaningByBuilding(settingList), TEXT.settingTitle);
    const message = `${TEXT.title}\n${TEXT.dateLabel}: ${targetDateStr}\n\n${cleaningBlock}\n\n${settingBlock}`;
    assertMessageIsSafe(message, targetDateStr);
    return message;
}

async function main() {
    const options = parseArgs();
    const env = readEnvFile();
    const webhookUrl = String(env.SLACK_CLEANING_REPORT_WEBHOOK_URL || "").trim();
    if (!webhookUrl) throw new Error("Missing SLACK_CLEANING_REPORT_WEBHOOK_URL");

    admin.initializeApp({
        credential: admin.credential.cert(require(path.join(process.cwd(), "serviceAccountKey.json"))),
    });

    const db = admin.firestore();
    const results = [];
    try {
        for (const date of options.dates) {
            console.log(`Building ${date}`);
            const text = await buildMessage(db, date);
            results.push({ date, success: true, length: text.length, preview: text.slice(0, 180) });
            if (!options.dryRun) {
                await axios.post(webhookUrl, { text }, {
                    headers: { "Content-Type": "application/json; charset=utf-8" },
                    timeout: 30000,
                });
                console.log(`Sent ${date}`);
            } else {
                console.log(`Dry-run OK ${date}`);
            }
        }
    } finally {
        await admin.app().delete();
    }

    console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
});
