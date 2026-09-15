const { ROOM_PREFIX_BY_PROPERTY } = require("./constants");
const { normalizeWhitespace } = require("./shared");

function stripKnownSuffix(rawRoom) {
    return normalizeWhitespace(rawRoom).replace(/_[^_]+$/u, "");
}

function normalizeRoomCode(propertyName, roomRaw) {
    const rawText = normalizeWhitespace(roomRaw);
    const property = String(propertyName || "").trim();
    const rawKey = rawText.toUpperCase().replace(/[\s_\-()]/g, "");

    if (property === "STAY ARI" || property === "STAY ARI Apartment Hotel") {
        if (rawKey.startsWith("OKUBOA")) return "OKUBOA";
        if (rawKey.startsWith("OKUBOB")) return "OKUBOB";
        if (rawKey.startsWith("OKUBOC")) return "OKUBOC";
    }

    const baseRoom = stripKnownSuffix(rawText);
    if (!baseRoom) return "";

    const uppercaseBase = baseRoom.toUpperCase();
    if (/^(AA|AB|KK)\d+$/u.test(uppercaseBase)) {
        return uppercaseBase;
    }

    if (String(propertyName || "").trim() === "Takadanobaba") {
        const digits = uppercaseBase.match(/\d+/g)?.join("") || "";
        if (digits) return `T${digits[0]}`;
    }

    const prefix = ROOM_PREFIX_BY_PROPERTY[String(propertyName || "").trim()];
    const digits = uppercaseBase.match(/\d+/g)?.join("") || "";

    if (prefix && digits) return `${prefix}${digits}`;

    return baseRoom;
}

module.exports = {
    normalizeRoomCode,
};
