# PixelScope

Chrome 팝업에서 픽셀 영역 측정과 실시간 컬러 피커를 선택하는 Manifest V3 확장 프로그램입니다. Vite, 엄격한 TypeScript와 외부 런타임 라이브러리 없는 Vanilla DOM API로 구현되어 있습니다.

## 설치 및 명령어

```bash
npm install
npm run dev       # 변경 감지 개발 빌드
npm run build     # dist 프로덕션 빌드
npm run lint
npm run typecheck
npm test
npm run test:browser  # 먼저 npm run build 필요
```

Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켠 뒤 **압축해제된 확장 프로그램을 로드합니다**를 눌러 이 프로젝트의 `dist` 폴더를 선택합니다. 코드를 변경한 뒤에는 빌드하고 확장 프로그램 카드의 새로고침 버튼을 누릅니다.

## 사용법

1. 일반 웹페이지에서 PixelScope 아이콘을 클릭하고 팝업에서 도구를 선택합니다.
2. **영역 측정**에서는 커서 아래 DOM 요소가 자동으로 강조됩니다. 클릭하면 요소 측정이 고정되고, 4px를 초과해 드래그하면 자유 영역 측정으로 전환됩니다. `ArrowUp`/`ArrowDown`으로 현재 요소의 부모·자식 후보를 탐색할 수 있습니다.
3. 측정 중에는 viewport 십자선과 15×15 CSS 픽셀 주변을 확대한 돋보기가 표시됩니다. 고정 요소는 스크롤·resize·크기 변경을 추적하며 새 클릭이나 드래그로 교체할 수 있습니다.
4. **컬러 피커**는 커서를 움직여 HEX/RGB/HSL/HSV/CMYK, 밝기와 WCAG 대비율을 확인합니다. 왼쪽 클릭하면 설정한 HEX/RGB/HSL 형식으로 복사됩니다.
5. 컬러 피커 설정에서 복사 후 계속 선택할지 정할 수 있으며 설정은 다음 실행에도 유지됩니다.
6. `Escape` 또는 팝업의 **도구 종료**로 활성 도구와 오버레이를 제거합니다. 다른 도구를 선택하면 이전 도구가 먼저 정리됩니다.

주입 금지 페이지에서는 확장 아이콘에 빨간 `!` 배지가 잠시 표시되고 툴팁으로 실행 불가 상태를 안내합니다.

## 구조

```text
manifest.json                    MV3 권한과 서비스 워커 선언
src/background.ts               탭별 상태, 안전한 주입, 화면 캡처
src/popup/*                     키보드 접근 가능한 다크 테마 도구 메뉴와 설정
src/content/index.ts            중복 주입 방지와 단일 도구 컨트롤러
src/content/tool-controller.ts  상호 배타적 도구 수명주기
src/content/measure-controller.ts 이벤트 수명주기, 드래그, RAF, 자동 스크롤
src/content/coordinate.ts       document/viewport 좌표 및 순수 계산 함수
src/content/overlay.ts          Shadow DOM 기반 선택 영역과 라벨
src/content/color-picker/*      캡처 갱신, 픽셀 샘플링, 변환, 패널과 확대경
src/content/styles.ts           격리 UI와 임시 상호작용 스타일
src/shared/messages.ts          background/content 메시지 타입
tests/coordinate.test.ts        좌표, 영역, 라벨, 자동 스크롤 단위 테스트
```

루트 `manifest.json`이 원본이며 빌드 시 `dist/manifest.json`으로 복사됩니다. `activeTab`은 사용자가 선택한 현재 탭 캡처, `scripting`은 content script 주입, `storage`는 복사 설정 보존, `clipboardWrite`는 사용자가 클릭한 색상 복사에만 사용합니다. 광범위한 host permission은 요청하지 않습니다.

## 좌표 처리

드래그 시작점은 `clientX/Y + scrollX/Y`로 계산한 document 좌표로 고정합니다. 현재 끝점 역시 document 좌표로 관리하고, 렌더링할 때만 현재 스크롤 오프셋을 빼서 fixed overlay의 viewport 좌표로 변환합니다. 따라서 드래그 도중 휠, 트랙패드 또는 자동 스크롤이 발생해도 시작 문서 위치는 변하지 않습니다. 모든 마우스 이동 렌더링과 가장자리 자동 스크롤은 `requestAnimationFrame`으로 제한됩니다.

## 제한사항

- iframe 내부 문서 측정은 현재 지원하지 않습니다. 최상위 문서만 측정합니다.
- `chrome://`, Chrome Web Store, 브라우저 내부 PDF 뷰어처럼 Chrome이 확장 스크립트 주입을 차단한 페이지에서는 실행할 수 없습니다.
- 브라우저 UI 영역으로 포인터가 나가면 더 이상 좌표 이벤트를 받을 수 없으므로 마지막 페이지 좌표로 결과를 유지합니다.
- 측정값은 CSS 픽셀 기준입니다. 페이지 확대/축소 시 Chrome이 제공하는 현재 CSS 픽셀 좌표계를 따릅니다.
- DevTools 모바일 에뮬레이션에서는 primary touch/pen pointer를 지원하며, 캡처 픽셀은 `visualViewport`의 크기와 offset을 반영해 변환합니다.
- SPA 경로 이동에도 주입된 컨트롤러는 유지되지만, 전체 문서가 새로 로드되면 다시 아이콘을 눌러 활성화해야 합니다.
- 컬러 피커는 `captureVisibleTab()` 이미지의 실제 가로·세로 크기와 CSS viewport 크기로 각각 배율을 계산합니다. 캡처가 제공하는 알파가 없거나 합성된 화면에서는 불투명도 `1`로 취급합니다.
- 애니메이션, 동영상, Canvas는 캡처 시점과 현재 표시 프레임 사이에 색상 차이가 생길 수 있습니다. 캡처는 최초 활성화와 스크롤·resize 종료 후에만 debounce 갱신하며, 정지 상태에서 주기적으로 갱신하지 않습니다.
- 측정 돋보기 역시 마지막 화면 캡처를 사용하므로 한 프레임 이상 늦을 수 있고, 동영상·애니메이션에서는 현재 화면과 미세한 시점 차이가 날 수 있습니다. 캡처가 실패해도 DOM 요소 및 자유 영역 측정은 계속 동작합니다.
- Chrome의 화면 캡처 결과에는 브라우저 UI가 포함되지 않으며 현재 보이는 탭 viewport만 샘플링합니다.

## 개인정보 및 보안

화면 캡처와 색상 계산은 브라우저 메모리 안에서만 처리됩니다. 캡처 이미지나 색상, 방문 페이지 정보를 저장하거나 외부 서버로 전송하지 않습니다. 캡처 데이터는 도구 종료 시 참조가 제거되며 원격 코드, `eval`, `unsafe-eval`을 사용하지 않습니다.
