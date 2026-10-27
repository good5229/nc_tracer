# LinuxCNC 공개 데모

이 디렉터리의 세 NC 파일은 LinuxCNC 프로젝트의 공개 원본이며 수정하지 않았습니다. 원본은 LinuxCNC의 `nc_files` 디렉터리에서 가져왔고, 아래 링크는 확인한 리비전으로 고정했습니다. 프로젝트의 GPL 2.0 라이선스 전문은 [COPYING](COPYING)에 포함되어 있으며, `useful-subroutines.ngc`에는 Chris Radek의 저작권과 GPL v2 고지가 들어 있습니다. 개별 파일의 기존 저작권·라이선스 고지도 그대로 유지합니다.

- [useful-subroutines.ngc](https://github.com/LinuxCNC/linuxcnc/blob/07aa2ba191198003000d2acc52e629f8eb377026/nc_files/useful-subroutines.ngc)
- [lathe_g70_71_demo.ngc](https://github.com/LinuxCNC/linuxcnc/blob/07aa2ba191198003000d2acc52e629f8eb377026/nc_files/lathe_g70_71_demo.ngc)
- [lathe-g76.ngc](https://github.com/LinuxCNC/linuxcnc/blob/07aa2ba191198003000d2acc52e629f8eb377026/nc_files/lathe-g76.ngc)

## 현재 뷰어 검증 결과

기본 초기 상태에서 원본을 그대로 해석한 결과입니다. 세 예제 모두 실행 가능한 전체 경로와 부품 형상의 일치를 검증할 수 없습니다.

| 파일 | 최초 중단 행 | 원인 | 표시된 모션 |
| --- | --- | --- | --- |
| useful-subroutines.ngc | 14 | O100 SUB 서브루틴 미지원 | 0 |
| lathe_g70_71_demo.ngc | 1 | G54 작업 좌표계 미지원 | 0 |
| lathe-g76.ngc | 8 | M6 공구 교환 미지원 | 0 |

이후 구문에도 변수·반복·호출·보정·좌표 변환, G70/G71/G76 선반 사이클 등이 있어 최초 중단 명령만 건너뛰어서는 원본 경로를 얻을 수 없습니다. 선반의 공구 설정과 좌표계 등 컨트롤러 상태도 필요합니다. 이 뷰어는 소재 제거를 계산하지 않으므로 경로 지원이 추가되어도 완성 부품 형상이나 충돌 안전을 보증하지 않습니다.
