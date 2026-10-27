# 정적 브라우저 아키텍처

React + TypeScript strict + Vite + Three.js. 런타임 JS/CSS/필요 자산은 번들에 포함한다. 백엔드·DB·로그인·사용자 데이터 업로드 endpoint는 없다.

## 데이터 흐름

로컬 File/붙여넣기 → 인코딩·크기 확인 → 세대 ID로 오래된 응답을 차단하는 Worker 메시지 → tokenizer/모달 interpreter → immutable 파싱 결과·행 인덱스·좌표 buffer → React 진단/코드 패널 + Three.js BufferGeometry → 선택/순서 재생 상태.

원본 텍스트는 현재 탭의 React 메모리에 유지한다. 비교 파일은 별도 컴포넌트의 메모리에만 보관하며 비교 닫기 또는 파일 교체 시 제거한다. Worker는 파일 전환 시 종료/재시작하거나 request ID로 오래된 응답을 버린다. 원호의 Float64 분할 좌표 버퍼는 transferable로 전달한다. 직선 구간 메타데이터와 좌표 객체는 structured clone으로 전달되므로 매우 큰 파일에서는 복제 비용이 남는다. CPU 파싱은 메인 스레드에서 하지 않는다.

## 계약

- 좌표: `{x:number|null,y:number|null,z:number|null}`, 내부 mm. NaN/Infinity 금지. null은 unknown이다.
- 모달 상태: unit, distanceMode, motionMode, plane, position, feed/spindle/tool/workOffset/controllerProfile 및 검증 상태.
- segment: 안정 ID, sourceLine(1-based), 선택 nBlock, rawCode, motion, start/end, status, warning IDs, 선택 feed/lengthMm.
- 경고: 안정 ID, sourceLine, 사유/code, 사용자 설명. 미지원 경계/오류는 처리 중단 행 포함.
- 매핑: sourceLine → segment IDs 배열; segment ID → 원본 행. 반복 N을 key로 사용하지 않는다.
- 파싱 결과: 상태, source lines, 확정 segments, 진단, 최종 모달 상태/미확정 여부, 처리 중단 위치.

## 뷰어와 재생

전체 경로는 BufferGeometry를 사용하고 재생 진행은 draw range 또는 별도 강조 geometry로 표현한다. 모든 모션마다 React DOM/Three 객체를 만들지 않는다. 3D pick은 segment ID를 통해 원문 선택과 같은 상태 경로를 사용한다. 슬라이더 인덱스는 모션 블록 순서이며 원호 tessellation vertex와 분리한다. 재생 배속은 시각적 블록 진행 속도다.

파일 교체 시 geometry/material, Worker, 이벤트, animation frame, 선택·진행·진단을 정리한다. 컴포넌트 unmount에서 Three renderer/controls도 dispose한다. 큰 원문은 가상화 또는 bounded window로 표시하여 100k DOM 행을 피한다.

## 보안 경계

NC는 데이터이며 eval/Function/스크립트 삽입/HTML 실행을 금지한다. React 텍스트 바인딩으로 원문·파일명을 표시한다. 사용자 데이터의 fetch/POST/sendBeacon/WebSocket, 분석 SDK, 원격 에러 reporting을 금지한다. 외부 CDN 스크립트/폰트를 사용하지 않는다. localStorage/sessionStorage/IndexedDB/Cache Storage/서비스 워커에 파일·좌표·파일명을 저장하지 않는다. 새로고침 시 초기 메모리 상태로 돌아간다.

## 배포

GitHub Actions는 합성 fixture만 사용하며 npm ci → typecheck → lint → unit → build → browser smoke → Pages artifact → deploy 순서다. Vite base를 저장소 하위 경로에 맞춘다. 단일 페이지이며 새로고침에 별도 서버 라우팅이 필요하지 않다. Pages environment 보호 정책과 최소 권한을 유지한다. 공개 URL 검증은 CI/build 성공과 별도 릴리스 게이트다.
