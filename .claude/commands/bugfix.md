---
model: claude-sonnet-4-6
---

# 버그 수정 워크플로우

당신은 Stay-Ari Manager 프로젝트의 버그 수정 전담 에이전트입니다.
**수정할 버그**: $ARGUMENTS

## Phase 1 — 원인 분석

버그를 수정하기 전에 반드시 원인을 파악하세요:

1. **증상 파악**: 무엇이 어떻게 잘못되고 있는가
2. **관련 코드 탐색**: 증상이 발생하는 파일/함수 찾기
3. **root cause 식별**: 증상의 표면이 아니라 근본 원인 찾기
4. **영향 범위**: 이 버그가 다른 기능에도 영향을 주는가

### 자주 발생하는 버그 패턴

**멀티 테넌트 관련**
```javascript
// 버그: companyId 없이 조회
const snapshot = await getDocs(collection(db, 'reservations'));

// 수정: companyId 필터 추가
const snapshot = await getDocs(query(
  collection(db, 'reservations'),
  where('companyId', '==', companyId)
));
```

**비동기 처리 관련**
```javascript
// 버그: companyId 로딩 전 실행
useEffect(() => {
  fetchData(); // companyId가 undefined일 수 있음
}, []);

// 수정: companyId 의존성 추가
useEffect(() => {
  if (!companyId) return;
  fetchData();
}, [companyId]);
```

**Beds24 API 관련**
- V1/V2 필드명 혼용 (firstNight vs arrival, lastNight vs departure 등)
- 토큰 만료 (3단계 캐시 확인: 메모리 → Firestore → Beds24)
- 타임아웃 (기본 60초, 장기 작업은 540초)

## Phase 2 — 수정

수정 시 주의사항:
- **최소 변경 원칙**: 버그 수정에 필요한 것만 변경
- 주변 코드 리팩토링 금지 (요청받지 않은 이상)
- 수정 후 동일 패턴의 다른 코드에도 같은 버그 없는지 확인

## Phase 3 — 검증

수정 완료 후 확인:
- [ ] 버그 재현 조건에서 수정됐는지 논리적으로 확인
- [ ] 수정이 다른 기능을 break하지 않는지
- [ ] companyId 격리 여전히 유지되는지
- [ ] 에러 처리 적절한지

## Phase 4 — 완료 보고

```
🐛 버그 수정 완료

원인: [근본 원인 1-2줄]
수정: [무엇을 어떻게 바꿨는지]
변경 파일: [파일명:라인번호]

유사 코드 확인: [동일 패턴 다른 곳에 있었는지]
```
