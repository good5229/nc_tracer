# NC Toolpath 3D Viewer

[공개 뷰어](https://good5229.github.io/nc_tracer/) · 로컬 NC/G-code 파일의 프로그램상 3축 경로를 확인하는 정적 웹앱입니다. 파일을 선택하거나 끌어 놓고, 텍스트를 붙여넣거나 내장 합성 예제를 사용할 수 있습니다. `.nc`, `.ngc`, `.tap`, `.gcode`, `.txt` UTF-8 파일을 지원합니다.

## 중요한 제한

G00/G01, G90/G91, G20/G21 및 축 생략의 제한된 프로파일만 해석합니다. 초기 위치와 단위 및 모드를 추측하지 않습니다. 원호 G02/G03, 매크로, 공구 보정, 좌표계, 사이클 등은 미지원이며 진단과 함께 해당 지점에서 해석을 중단합니다. 실제 가공 형상, 기계 운동, 충돌이나 설비 안전을 검증하지 않습니다. [지원 범위](docs/gcode-support-matrix.md)를 확인하세요.

파일 내용과 이름 및 좌표는 브라우저 메모리에서만 처리하고 애플리케이션이 서버에 보내거나 영구 저장하지 않습니다. 탭을 닫거나 새로고침하면 제거됩니다. GitHub Pages 접속 기록은 플랫폼이 관리합니다. 첫 방문에는 네트워크가 필요하며 오프라인 사용은 보장하지 않습니다.

## 실행 및 검증

Node.js 22.12 이상(또는 24)에서 실행합니다.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

GitHub Actions가 main 브랜치에서 빌드와 검사를 거쳐 GitHub Pages에 배포합니다. Vite base는 `/nc_tracer/`입니다. [공개 테스트 자료와 출처](samples/linuxcnc/README.md), [검증 계획](docs/test-plan.md), [배포 체크리스트](docs/release-checklist.md)를 참고하세요. 개인 또는 회사의 실제 NC 파일을 공개 저장소나 CI에 올리지 마세요.
