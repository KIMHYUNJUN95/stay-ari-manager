// src/constants/buildingData.js

export const BUILDING_DATA = {
  "아라키초A": [
    "201호", "202호", "301호", "302호", "401호", "402호",
    "501호", "502호", "602호", "701호", "702호"
  ],
  "아라키초B": [
    "101호", "102호", "201호", "202호", "301호", "302호", "401호", "402호"
  ],
  "다이쿄초": [
    "B01호", "B02호", "101호", "102호", "201호", "202호", "302호"
  ],
  "가부키초": [
    "202호", "203호", "302호", "303호", "402호", "403호",
    "502호", "603호", "802호", "803호"
  ],
  "다카다노바바": [
    "201호", "301호", "401호", "501호", "601호", "701호", "801호", "901호"
  ],
  "오쿠보": [
    "A동", "B동", "C동"
  ],
  "사노시": [
    "독채"
  ]
};

// Building Name English Mapping for notifications
export const BUILDING_NAMES_EN = {
  "아라키초A": "Arakicho A",
  "아라키초B": "Arakicho B",
  "아라키초": "Arakicho",
  "다이쿄초": "Daikyocho",
  "가부키초": "Kabukicho",
  "다카다노바바": "Takadanobaba",
  "오쿠보A동": "Okubo A",
  "오쿠보B동": "Okubo B",
  "오쿠보C동": "Okubo C",
  "오쿠보A": "Okubo A",
  "오쿠보B": "Okubo B",
  "오쿠보C": "Okubo C",
  "사노시": "Sano",
  "사노": "Sano",
  "사노시 사노": "Sano"
};

// 건물 정렬 순서 (전체 — 다이쿄초 포함)
export const BUILDING_ORDER = [
  "아라키초A", "아라키초B", "다이쿄초", "가부키초",
  "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동", "사노시"
];

// 다이쿄초: DB 보존, 화면에서는 항상 제외
export const EXCLUDED_BUILDING_UI = "다이쿄초";

// 활성 건물 목록 (다이쿄초 제외)
export const ACTIVE_BUILDING_ORDER = BUILDING_ORDER.filter(b => b !== EXCLUDED_BUILDING_UI);