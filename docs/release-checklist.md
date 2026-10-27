# 릴리스 체크리스트

현재 상태: 명세 기준 확정. 아래 항목은 실제 증거를 확인한 담당자가 완료 표시한다. 문서 생성만으로 체크하지 않는다.

- [ ] G-code 지원 범위와 실제 parser가 일치하며 독립 P01–P09/P13 기대값 통과.
- [ ] 미확정 좌표·미지원 명령 뒤 허위 경로 없음. INVALID/PARTIAL 진단이 원문 행과 연결됨.
- [ ] drop/file/paste, 교체 경합, 재생·양방향 매핑 검증.
- [ ] 카메라·보기·범례·표시 토글과 모바일·키보드 접근성 검증.
- [ ] 1k/10k/100k 파싱·렌더·응답성·메모리 실측 기록, 장시간 메인 스레드 정지 없음.
- [ ] Network/브라우저 storage 관찰 및 코드 점검에서 파일명·원문·좌표 전송/영구 저장 없음.
- [ ] 원문 안전 텍스트 바인딩, Worker/Three 자원 정리, 파일 교체 stale 응답 제거.
- [ ] 외부 분석/원격 로그/CDN/원격 폰트 및 실 NC fixture 없음.
- [ ] 필수 한계/기밀 문구, 설치·사용·배포 README, 합성 예제 제공.
- [ ] npm ci, typecheck, lint, unit, production build, Playwright smoke 통과.
- [ ] Pages base/단일 페이지 새로고침 및 최소 CI 권한 확인.
- [ ] 저장소·CI 공개 대상에 회사 데이터/개인정보 없음.
- [ ] Pages 환경 설정·Actions artifact/deploy 성공, 배포 commit/build hash 기록.
- [ ] 실제 공개 URL Chrome/Edge에서 합성 파일 입력→3D→선택→재생 검증.
- [ ] Astra 리뷰 후 결함 수정·재검증 완료, 남은 한계 공지.

## 즉시 중단 조건

지원한다고 선언한 좌표 오답, 불확실한 경로의 정상 처리, 사용자 데이터 전송/영구 저장, 코드↔경로 불일치, 기밀 공개, 공개 URL 번들/렌더 실패가 하나라도 있으면 release 승인을 보류한다. 빌드/로컬 smoke 성공과 실제 Pages 성공을 구별한다.

## 릴리스 증거 기록

담당/실제 런타임:

commit/build hash:

검증 명령·결과/브라우저:

성능 측정 환경/수치:

공개 URL·검증 시각:

실패/SKIP·남은 조치:

Astra 판정(APPROVED/REWORK/BLOCKED):

## 2026-10-27 진행 기록

- `cf1597d`: GitHub Actions의 npm ci, 타입 검사, 린트, 단위 테스트, 빌드, Chromium smoke 및 Pages 배포 성공. 실제 공개 URL에서 합성 예제 5행 선택 시 X40 Y0 Z0 및 새로고침 확인. 최초 배포이며 최종 변경 반영 여부는 Actions에서 확인한다.
- 로컬 macOS Chromium headless 합성 입력 1k/10k/100k: 파일 입력부터 해석 상태 표시까지 약 537/507/1655 ms. 메모리 또는 장시간 상호작용 측정은 아니다.
- Astra 구현 검토에서 수치 범위, 긴 코드 목록, 생산 빌드 테스트 관련 재작업 요청. 후속 수정과 재검증을 별도로 확인해야 한다.
- Edge, 실제 사용자 NC, 접근성 전체 및 저장소 관찰, 대용량 메모리 측정은 미수행. 원호 및 고급 기능은 미지원.

## 2026-10-27 Chrome·Edge 공개 URL 검사

커밋 `279cc26`의 [GitHub Actions 실행](https://github.com/good5229/nc_tracer/actions/runs/40425982598)은 빌드·배포 및 공개 URL의 Chrome/Edge 합성 파일 입력·코드 선택·다음 블록·캔버스·새로고침 검증을 통과했다. 이 기록은 해당 커밋에 한한다. 실제 NC 파일 및 후속 커밋에 대한 검증 결과와 구별한다.
