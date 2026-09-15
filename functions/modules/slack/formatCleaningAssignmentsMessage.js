const { HOTELSMART_PROPERTY_ORDER } = require("../hotelsmart/constants");

function sortProperties(properties = []) {
    const order = new Map(HOTELSMART_PROPERTY_ORDER.map((name, index) => [name, index]));
    return [...properties].sort((a, b) => {
        const ai = order.has(a.propertyName) ? order.get(a.propertyName) : 999;
        const bi = order.has(b.propertyName) ? order.get(b.propertyName) : 999;
        return ai - bi;
    });
}

function formatCleaningAssignmentsMessage(result = {}) {
    const properties = sortProperties(result.properties || []);
    const lines = [
        "HOTELSMART 청소 담당 배정",
        `기준일: ${result.operatingDate || "-"}`,
        `수집시각: ${result.collectedAt || "-"}`,
        "",
    ];

    properties.forEach((property) => {
        lines.push(`[${property.propertyName}]`);

        if (!Array.isArray(property.assignments) || property.assignments.length === 0) {
            lines.push("배정 없음", "");
            return;
        }

        const roomMap = new Map();
        property.assignments.forEach((assignment) => {
            const roomKey = assignment.roomCodeNormalized || assignment.roomRaw || "-";
            const existing = roomMap.get(roomKey) || [];
            existing.push(assignment.assigneeNormalized || "-");
            roomMap.set(roomKey, existing);
        });

        Array.from(roomMap.entries())
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .forEach(([roomKey, assignees]) => {
                lines.push(`${roomKey} -> ${assignees.join(", ")}`);
            });

        lines.push("");
    });

    return lines.join("\n").trim();
}

module.exports = {
    formatCleaningAssignmentsMessage,
};
