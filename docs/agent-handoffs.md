# 역할·인계와 승인 기록

Astra/Luna는 역할명이다. 존재하지 않는 모델 호출을 주장하지 않는다. 현재 Astra 작업은 실제 협업 서브에이전트 `/root/astra`에서 수행했다. 상위 실행 담당자 확인에 따른 역할 모델은 Astra `gpt-6-astra`, Luna `gpt-6-luna`이며 상위 Codex 모델명은 미확인이다. Luna 구현은 parser 담당과 통합 담당의 실제 실행 기록으로 증명해야 한다.

2026-10-27 Astra: requirements/architecture/gcode-support-matrix/test-plan/release-checklist/agent-handoffs 사양 작성. 보수적 P0 프로파일과 독립 산술 fixture 사양 승인. 구현 코드 직접 변경 없음. 테스트/공개 배포 승인은 아직 하지 않았다.

## 인계 계약

| 작업 | Goal | Hook | Stop / 완료 판정 |
| --- | --- | --- | --- |
| S0 사양 | P0와 불확실성 경계 확정 | support matrix, P01–P09 독립 정답 | 모순/미확정 좌표를 정상 가정하면 반려. 사양 승인 후 계산 구현 검증 진행 |
| S1 parser/Worker | 로컬 입력→정확한 직선 prefix | P01–P09/P13, 타입·진단·행 매핑 계약 | 좌표 오답/unsupported 이후 경로/메인 스레드 파싱이면 중단. 독립 기대값·Worker 통합 검증 필요 |
| S2 UI/재생 | 코드↔3D 이동 순서 조회 | P10/P14, 원문 1:N 인덱스 | 선택·슬라이더·좌표 불일치면 반려. 양방향 브라우저 시험 통과 필요 |
| S3 원호 | P1의 검증된 기하학 | 평면/회전/IJK/R 별 독립 수학 fixture | 문서화된 제한 프로파일과 독립 기하 fixture를 통과한 원호만 지원 |
| S4 보안/성능/접근성 | 사용자 데이터 보호·대형 입력 응답성 | P11/P12/P15/P16, Network/storage 및 실측 | 데이터 전송/저장 또는 장시간 정지 시 중단. 자동 검사와 실제 브라우저 관찰 모두 필요 |
| S5 배포 | 동일 빌드의 실제 Pages 서비스 | release checklist, base/CI, 합성 E2E | 공개 URL 미검증은 완료 아님. 배포 hash와 Chrome/Edge 검증 필요 |

## 공동 리뷰 기록 형식

- Sprint/담당(실제 런타임·확인 가능한 모델):
- Goal/범위:
- 구현 파일 및 commit:
- 시험 명령 및 PASS/FAIL/SKIP:
- 좌표·모달·원문 매핑 증거:
- 외부 전송/저장 관찰 증거:
- 미지원 명령/남은 위험:
- Astra 판정(APPROVED/REWORK/BLOCKED):
- Luna 후속 조치:

원호는 명시된 제한 프로파일과 보수적 중단 정책으로 구현했다. 독립 리뷰에서 누적 정점 제한, Float32 정밀도 및 필터 진행 문제를 수정한 범위는 승인되었다. 실제 NC 데이터와 최종 배포 검증은 별도이다. 문서에 적힌 기능은 제품 완료 주장으로 읽지 않는다. 구현→자동 테스트→Astra 검토→수정→재검증 후에만 구현 승인을 기록한다.
