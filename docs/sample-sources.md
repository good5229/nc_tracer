# 공개 테스트 자료

실제 NC 파일 및 다운로드한 예제는 `samples/`에 두면 Git에서 제외됩니다. 이 폴더와 일반적인 NC 확장자(`.nc`, `.ngc`, `.tap`, `.gcode`)는 기본적으로 공개 배포에서 제외됩니다. 사용자가 공개를 요청한 세 LinuxCNC 원본은 `demo/`에서만 예외로 추적하고 앱에 포함합니다. `.txt`는 다른 문서에 사용될 수 있으므로 자동 제외하지 않으며, NC 텍스트는 `samples/`에 보관하세요. 앱의 합성 예제와 자동화 테스트의 코드 문자열은 기능 검증에 필요하므로 소스에 남겨 둡니다.

아래 자료는 LinuxCNC의 공개 예제이며 원본과 GPL-2.0 라이선스는 링크에서 확인할 수 있습니다. 컴퓨터에 다운로드한 뒤 파일 열기로 사용할 수 있습니다.

- [3dtest.ngc](https://github.com/LinuxCNC/linuxcnc/blob/c9a5a0a5034177c8db64cb44abf14d4f2eb166f7/nc_files/3dtest.ngc): 여러 평면의 원호.
- [arcspiral.ngc](https://github.com/LinuxCNC/linuxcnc/blob/c9a5a0a5034177c8db64cb44abf14d4f2eb166f7/nc_files/arcspiral.ngc): 원호와 컨트롤러 명령.
- [increment.ngc](https://github.com/LinuxCNC/linuxcnc/blob/c9a5a0a5034177c8db64cb44abf14d4f2eb166f7/nc_files/increment.ngc): 매크로와 서브루틴 진단.
- [LinuxCNC 라이선스](https://github.com/LinuxCNC/linuxcnc/blob/c9a5a0a5034177c8db64cb44abf14d4f2eb166f7/COPYING)

이 자료는 제조 현장에서 실행하기 위한 프로그램이 아닙니다. 실제 장비에 사용하지 마세요.

## 로컬 확인 기록 (2026-10-27)

다운로드한 원본을 로컬 production preview에서 시험했다. `3dtest.ngc`는 초기 거리 모드를 사용자가 G90으로 지정했을 때 49개 모션을 해석하고, 시작점이 불명확한 첫 이동을 경고했다. 기본 미지정 상태에서는 단위·거리 모드 부족으로 중단했다. `arcspiral.ngc`는 첫 줄 G64에서 중단했고, `increment.ngc`는 지원하지 않는 서브루틴 구문에서 중단한다. 이 결과는 해당 컨트롤러 전체를 지원한다는 의미가 아니다.

## 내장 LinuxCNC 데모

요청한 세 원본의 출처, 라이선스 및 실제 해석 결과는 [demo/README.md](../demo/README.md)에 기록한다. 현재 세 파일 모두 미지원 구문으로 경로 표시가 중단되며 완성 형상을 검증할 수 없다.
