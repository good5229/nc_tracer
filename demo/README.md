# LinuxCNC 공개 데모

이 디렉터리의 세 NC 파일은 LinuxCNC 프로젝트의 공개 원본이며 수정하지 않았습니다. 원본은 LinuxCNC의 `nc_files` 디렉터리에서 가져왔고, 아래 링크는 확인한 리비전으로 고정했습니다. 프로젝트의 GPL 2.0 라이선스 전문은 [COPYING](COPYING)에 포함되어 있으며, `useful-subroutines.ngc`에는 Chris Radek의 저작권과 GPL v2 고지가 들어 있습니다. 개별 파일의 기존 저작권·라이선스 고지도 그대로 유지합니다.

- [useful-subroutines.ngc](https://github.com/LinuxCNC/linuxcnc/blob/07aa2ba191198003000d2acc52e629f8eb377026/nc_files/useful-subroutines.ngc)
- [lathe_g70_71_demo.ngc](https://github.com/LinuxCNC/linuxcnc/blob/07aa2ba191198003000d2acc52e629f8eb377026/nc_files/lathe_g70_71_demo.ngc)
- [lathe-g76.ngc](https://github.com/LinuxCNC/linuxcnc/blob/07aa2ba191198003000d2acc52e629f8eb377026/nc_files/lathe-g76.ngc)

## 현재 뷰어 검증 결과

데모 선택은 LinuxCNC 프로파일과 가상 점 공구 참조 설정을 명시적으로 사용합니다: 시작 XYZ=0, G90/G8, G54=0, 공구 길이와 지름 0, 위치가 변하지 않는 공구 교환. 이 값은 실제 장비의 공구표와 좌표계를 뜻하지 않습니다.

| 파일 | 점 공구 참조 결과 | 검증 및 제한 |
| --- | --- | --- |
| useful-subroutines.ngc | 58개 이동 | LinuxCNC 2.9.4의 D0 참조에서 이동 유형·끝점 58개를 대조함 |
| lathe-g76.ngc | 235개 이동 | LinuxCNC 2.9.4의 D0 참조에서 이동 유형·끝점 235개를 대조함. 양의 T1 공구 반경에서는 G41 진입 이동 길이가 0이어서 LinuxCNC도 중단함 |
| lathe_g70_71_demo.ngc | G71.1의 28행에서 중단 | 자체 계산의 윤곽 접점 간격이 허용 오차를 넘어 결과를 생성하지 않음. 이 진단만으로 원본 좌표의 오류를 뜻하지 않음. LinuxCNC 2.9.4 원본 실행은 이후 G42.1 D0.3의 오목 원호 파고듦 오류로 중단됨 |

참조 해석기의 좌표 출력은 소수점 넷째 자리까지이며 두 경로의 최대 끝점 차이는 각각 약 0.00127mm, 0.001263mm입니다. [공개 참조 실행](https://github.com/good5229/nc_tracer/actions/runs/40433993251)의 D0 결과는 점 공구 조건입니다. 원본의 모든 실제 공구 보정과 세 번째 사이클을 지원하거나 실제 부품 형상이 일치한다고 뜻하지 않습니다.

일부 변수·반복·호출, G92 변환과 G76은 지원하지만 임의의 공구표·실제 반경 보정과 G70/G71.2 등은 아직 지원하지 않아 최초 중단 명령만 건너뛰어서는 원본 경로를 얻을 수 없습니다. 선반의 공구 설정과 좌표계 등 컨트롤러 상태도 필요합니다. 이 뷰어는 소재 제거를 계산하지 않으므로 경로 지원이 추가되어도 완성 부품 형상이나 충돌 안전을 보증하지 않습니다.

G71.1 계산에서 허용 오차를 넘는 접점 간격은 자동으로 메우지 않고 중단한다. 현재 이 데모에서 보고하는 간격은 0.000008mm이며, 계산 오차인지 NC 입력의 문제인지 별도 확인이 필요하다. G71.2와 실제 공구 반경 보정은 아직 지원하지 않는다.
