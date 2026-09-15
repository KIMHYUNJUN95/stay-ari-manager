const { normalizeWhitespace } = require("./shared");

function normalizeAssignee(assigneeRaw) {
    const value = normalizeWhitespace(assigneeRaw);
    if (!value) return "";

    const names = value
        .split(/\n+/u)
        .map((name) => name
            .trim()
            .replace(/^(?:(?:\(\d+\)|[A-Z0-9]+)[,\s]*)+(?=\S)/u, "")
            .trim())
        .filter((name) => name && name !== "-");

    return [...new Set(names)].join(", ");
}

module.exports = {
    normalizeAssignee,
};
