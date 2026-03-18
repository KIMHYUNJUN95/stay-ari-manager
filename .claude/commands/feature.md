---
model: claude-sonnet-4-6
---

# 기능 개발 워크플로우

당신은 Stay-Ari Manager 프로젝트의 기능 개발 전담 에이전트입니다.
**개발할 기능**: $ARGUMENTS

## Phase 1 — 분석 (코드 작성 전 필수)

다음 순서로 분석하세요:

1. **요구사항 파악**: 기능의 목적, 영향 범위, 필요한 데이터 파악
2. **관련 파일 탐색**: 유사한 기존 컴포넌트/함수 찾기 (재사용 가능 여부 확인)
3. **데이터 흐름 파악**: Firestore 컬렉션, Cloud Functions, UserContext 관계 분석
4. **패턴 확인**: 기존 코드에서 따라야 할 패턴 식별

## Phase 2 — 구현 계획

코드 작성 전에 다음을 명확히 하세요:
- 어떤 파일을 수정/생성하는지
- 멀티 테넌트(companyId) 처리 방법
- 모바일/데스크톱 반응형 처리 방법
- 새 Cloud Function 필요 여부

## Phase 3 — 구현

구현 시 반드시 지켜야 할 것:

### 컴포넌트 작성
```javascript
// 기본 구조
import { useUser } from '../contexts/UserContext';

export default function FeatureName() {
  const { user, companyId, loading } = useUser();
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    // 데이터 로드
  }, [companyId]);

  if (loading) return <div>로딩 중...</div>;

  return (/* JSX */);
}
```

### Firestore 쿼리
- `where('companyId', '==', companyId)` 필수
- 에러 처리는 try/catch로

### 스타일
- 기존 CSS 클래스 체계 유지
- 색상: `#1E293B` (사이드바), `#4F46E5` (primary), `#F1F5F9` (BG)
- 모바일 반응형: `@media (max-width: 768px)`

## Phase 4 — 검증 체크리스트

구현 완료 후 아래를 순서대로 확인:

- [ ] companyId 없이 Firestore 접근하는 코드 없는지
- [ ] 새 라우트 추가 시 App.jsx에 등록됐는지
- [ ] 모바일 뷰 레이아웃 깨지지 않는지
- [ ] Cloud Function 추가 시 타임아웃 설정 확인
- [ ] 기존 컴포넌트 스타일과 일관성 있는지
- [ ] 불필요한 console.log 제거됐는지

## Phase 5 — 완료 보고

다음 형식으로 요약:
```
✅ 구현 완료: [기능명]

변경 파일:
- src/components/XXX.jsx (신규/수정)
- src/App.jsx (라우트 추가)
- functions/index.js (함수 추가 시)

주요 결정사항:
- [선택한 패턴/접근법과 이유]

확인 필요:
- [사용자가 직접 확인해야 할 사항]
```
