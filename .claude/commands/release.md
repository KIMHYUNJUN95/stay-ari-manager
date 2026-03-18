---
model: claude-sonnet-4-6
---

# 릴리즈/배포 워크플로우

당신은 Stay-Ari Manager 프로젝트의 배포 전담 에이전트입니다.
**배포 대상**: $ARGUMENTS (web / android / functions / all)

## 빌드·배포·시트 트리거 명령어 (한눈에)

```bash
# 1) 웹 빌드
npm run build

# 2) Firebase 호스팅 배포 (웹)
firebase deploy --only hosting

# 3) Cloud Functions 배포 (시트 트리거 포함: scheduledDailyReport, scheduledSlackDailyReport, scheduledSlackCleaningReport, scheduledMonthlyNotionReport 등)
firebase deploy --only functions

# 4) 웹 + Functions 한 번에 배포
npm run build && firebase deploy

# 5) 시트 트리거만 반영하려면 (Functions만 배포)
firebase deploy --only functions
```

**시트 트리거**: 구글 시트 경영 분석 리포트·슬랙·노션 등은 모두 Cloud Functions 스케줄러로 동작합니다. `firebase deploy --only functions` 하면 트리거가 최신 코드로 갱신됩니다.

**수동으로 경영 분석 시트만 즉시 갱신** (로컬, `functions/serviceAccountKey.json` 필요):
```bash
cd functions && node run_report_now.js
```

---

## 배포 전 체크리스트

배포 명령어를 실행하기 전에 반드시 확인하세요.

---

## 1. 코드 상태 확인

```bash
git status          # 미커밋 변경사항 확인
git diff            # 변경 내용 검토
git log --oneline -5  # 최근 커밋 확인
```

- [ ] 의도하지 않은 변경사항 없는가
- [ ] .env 파일이 커밋에 포함되지 않는가
- [ ] console.log, 디버그 코드 제거됐는가
- [ ] functions/index.js의 임시 디버그 함수 제거됐는가

---

## 2. 배포 종류별 절차

### 웹 (Firebase Hosting) 배포
```bash
# 1. 프로덕션 빌드
npm run build

# 2. 빌드 결과 확인 (build/ 폴더)
# - 에러 없이 완료됐는지 확인

# 3. Firebase 호스팅 배포
firebase deploy --only hosting
```

**주의**: 배포 전 사용자에게 확인 받을 것

### Cloud Functions 배포
```bash
# Functions만 배포
firebase deploy --only functions

# 특정 함수만 배포
firebase deploy --only functions:functionName
```

**주의사항**:
- 함수 삭제 시 기존 스케줄/트리거 영향 확인
- 타임아웃 설정 변경 시 기존 진행 중인 작업 영향 확인
- Beds24 토큰 캐시 무효화 필요한지 확인

### Android 앱 빌드
```bash
# Capacitor 빌드 + 동기화 + Android Studio 열기
npm run android
# 또는 단계별:
npm run build
npx cap sync android
npx cap open android
```

**Android Studio에서**:
1. Build > Generate Signed Bundle/APK
2. 버전 코드/버전 이름 업데이트 확인

### 전체 배포 (web + functions)
```bash
firebase deploy
```

---

## 3. 배포 후 확인

- [ ] 웹: 프로덕션 URL 접속해서 로그인 동작 확인
- [ ] 웹: 주요 대시보드 (오늘 요약, 매출) 로드 확인
- [ ] Functions: Firebase Console에서 에러 로그 확인
- [ ] Functions: syncBeds24 수동 트리거 후 데이터 동기화 확인
- [ ] Android: 앱 실행 및 기본 기능 동작 확인

---

## 4. 롤백 절차

문제 발생 시:

```bash
# 이전 호스팅 버전으로 롤백
firebase hosting:releases:list          # 릴리즈 목록 확인
firebase hosting:channel:deploy live --version [VERSION_ID]
```

Functions 롤백:
- Firebase Console > Functions > 이전 버전으로 재배포

---

## 완료 보고 형식

```
🚀 배포 완료

대상: [web / functions / android]
환경: production
시각: [배포 시각]

변경 내용:
- [주요 변경사항 bullet]

배포 후 확인:
- [x] 웹 접속 정상
- [x] 데이터 로드 정상
- [ ] (필요한 경우 추가 확인 항목)
```
