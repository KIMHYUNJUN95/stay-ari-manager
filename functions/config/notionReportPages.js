/**
 * 노션 리포트 시각화용 페이지 ID 매핑
 * 각 리포트 타입별로 노션 페이지 ID를 등록합니다.
 * (나머지는 사용자가 제공하는 대로 추가)
 */
module.exports = {
    /** 매출일지 (Daily_Sales_Log) */
    salesLog: "32291565785a806794dbefa6821e7210",
    /** 일일로그 (Daily_Log MTD) */
    dailyLog: "32291565785a802c9a16ea1ad07778e2",
    /** 취소로그 (Cancel_Log) */
    cancelLog: "32291565785a80c48e76c8a22971a763",
    /** 플랫폼 분석 (Platform_Analysis) */
    platformAnalysis: "32291565785a80a6b2d3d7b4de14a1ba",
    /** 인원현황 (PAX_OCCUPANCY) */
    paxOccupancy: "32291565785a80f48a39d08817749d49",
    /** 매출 대시보드 (우리 DB 집계) */
    salesDashboard: "32291565785a80c7b9ead9da05cdb4b7",
    /** 매출 요약 노션 DB (검색/필터용). 속성: Name(title), Category(select: 월별|건물별|플랫폼), Revenue(number), Note(rich_text). 없으면 동기화 생략 */
    salesDashboardDatabaseId: null,
    /** 가동률 대시보드 (우리 DB 집계) */
    occupancyDashboard: "32291565785a80e39a68c087cb085121"
};
