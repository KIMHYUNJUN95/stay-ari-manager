const HOTELSMART_LOGIN_URL = "https://connect.hotelsmart.jp/host/login";
const HOTELSMART_CLEANING_SCHEDULE_URL = "https://connect.hotelsmart.jp/host/cleaning/schedule?&date=";

const HOTELSMART_PROPERTY_ORDER = [
    "Arakicho A",
    "Kabukicho",
    "STAY ARI",
    "Takadanobaba",
    "Okubo_C (kr)",
    "Arakicho B",
    "OkuboB",
    "STAY ARI Apartment Hotel",
];

const HOTELSMART_ACTIVE_PROPERTY_ORDER = [...HOTELSMART_PROPERTY_ORDER];

const ROOM_PREFIX_BY_PROPERTY = {
    "Arakicho A": "AA",
    "Arakicho B": "AB",
    "Kabukicho": "KK",
};

const MATERIAL_ICON_LABELS = new Set([
    "business",
    "person",
    "hotel",
    "people",
    "description",
    "notifications",
    "event",
    "help",
    "edit",
    "chevron_right",
    "chevron_left",
    "keyboard_arrow_down",
    "keyboard_arrow_left",
    "keyboard_arrow_right",
    "checklist",
    "print",
]);

const HOTELS = {
    loginUrl: HOTELSMART_LOGIN_URL,
    cleaningScheduleBaseUrl: HOTELSMART_CLEANING_SCHEDULE_URL,
};

module.exports = {
    HOTELS,
    HOTELSMART_PROPERTY_ORDER,
    HOTELSMART_ACTIVE_PROPERTY_ORDER,
    ROOM_PREFIX_BY_PROPERTY,
    MATERIAL_ICON_LABELS,
};
