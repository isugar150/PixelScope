# AGENTS.md

이 문서는 PixelScope 저장소에서 작업하는 AI 코딩 에이전트를 위한 지침입니다. 하위 디렉터리에 별도의 `AGENTS.md`가 있다면 더 가까운 파일의 지침을 우선합니다.

## 프로젝트 개요

PixelScope는 Chrome Extension Manifest V3 기반의 페이지 측정 도구입니다.

- Vanilla TypeScript, Vite, HTML/CSS
- 프레임워크 및 외부 런타임 라이브러리 없음
- Shadow DOM 기반 오버레이
- 영역 측정, DOM 요소 측정, 컬러 피커 제공
- 화면 캡처와 색상 분석은 브라우저 메모리에서만 처리
- 광범위한 host permission 및 외부 데이터 전송 금지

## 주요 구조

```text
manifest.json                       MV3 권한, 서비스 워커, 팝업 선언
src/background.ts                  탭별 상태, content 주입, 화면 캡처
src/shared/                        메시지와 공용 상태 타입
src/popup/                         도구 선택 팝업과 사용자 설정
src/content/index.ts               중복 주입 방지 및 메시지 진입점
src/content/tool-controller.ts     상호 배타적 도구 lifecycle
src/content/measure-controller.ts  요소/영역 측정 interaction 상태
src/content/coordinate.ts          document/viewport 좌표 계산
src/content/overlay.ts             측정 Shadow DOM UI
src/content/color-picker/          캡처, 샘플링, 색상 변환과 UI
tests/                             Vitest 단위 테스트
tests/browser/                     Playwright 확장 브라우저 테스트
```

## 설계 원칙

### TypeScript

- `strict`, `noUncheckedIndexedAccess` 등 현재 `tsconfig.json` 규칙을 유지합니다.
- `any`, non-null assertion, 무분별한 type assertion과 오류 무시는 사용하지 않습니다.
- background, popup, content 간 메시지는 `src/shared/messages.ts`의 discriminated union으로 정의하고 payload를 검증합니다.
- 런타임 공유가 필요하지 않은 import는 `import type`을 사용합니다.

### Chrome Extension

- 필요한 최소 권한만 요청합니다. 새 권한은 사용 이유와 Web Store 영향을 검토하고 README에 기록합니다.
- `chrome://`, Chrome Web Store 등 주입 금지 페이지 오류를 사용자에게 명확히 전달합니다.
- content script 중복 주입을 방지하고, service worker 재시작 후에도 content의 실제 상태를 확인합니다.
- content 빌드는 외부 import가 없는 단일 IIFE여야 합니다. 반복 주입 시 전역 lexical 선언이 충돌하지 않아야 합니다.
- 원격 코드, `eval`, `unsafe-eval`, 동적 `innerHTML` 문자열 삽입을 금지합니다.

### 도구 lifecycle

- 두 도구를 동시에 활성화하지 않습니다. 전환 시 기존 도구를 완전히 `disable()`한 후 새 도구를 시작합니다.
- 이벤트 등록과 해제, pointer capture, observer, RAF, timeout은 반드시 대칭적으로 관리합니다.
- 종료 후 페이지의 cursor, selection, click 및 drag 상태를 원래대로 복구합니다.
- 페이지 이벤트 차단은 활성 도구에서 필요한 이벤트와 시간에만 적용합니다.

### 좌표와 측정

- 드래그 시작점은 document 좌표로 저장합니다.
- 렌더링할 때 현재 `scrollX`, `scrollY`를 반영해 viewport 좌표로 변환합니다.
- DOM 요소 기본 크기는 `getBoundingClientRect()`의 border box를 사용합니다.
- 포인터 처리와 스타일 갱신은 `requestAnimationFrame`당 최대 한 번 수행합니다.
- layout read와 style write를 가능한 한 분리하고, 전체 DOM MutationObserver를 사용하지 않습니다.
- 선택 요소 추적은 해당 요소에만 `ResizeObserver`를 연결합니다.

### 캡처와 픽셀 샘플링

- `captureVisibleTab()`을 pointer move마다 호출하지 않습니다.
- 최초 활성화와 scroll/resize debounce 이후에만 캡처합니다. 정지 상태의 주기 캡처는 오버레이 깜빡임을 유발하므로 추가하지 않습니다.
- 캡처 직전 PixelScope UI를 숨기고 캡처 완료 후 반드시 복원합니다.
- 이미지 좌표는 `visualViewport`의 크기와 offset을 기준으로 가로·세로 배율을 독립 적용하고 경계를 clamp합니다.
- 캡처 요청은 중복 실행과 오래된 응답 덮어쓰기를 방지합니다.
- 캡처 실패가 DOM/영역 측정 전체를 중단시키면 안 됩니다.
- DevTools 모바일 에뮬레이션의 primary touch/pen pointer와 `visualViewport` offset 보정을 유지합니다.

## UI와 접근성

- 오버레이는 페이지 레이아웃에 영향을 주지 않는 Shadow DOM과 충분히 높은 `z-index`를 사용합니다.
- 측정 UI는 `pointer-events: none`으로 페이지 hit testing을 방해하지 않습니다.
- 라벨과 돋보기는 작은 viewport에서도 잘리지 않도록 위치를 clamp 또는 반전합니다.
- 드래그만 유일한 조작으로 만들지 말고 클릭 및 키보드 대안을 유지합니다.
- popup의 native button, label, focus 표시와 키보드 탐색을 보존합니다.
- 색상만으로 활성/오류 상태를 전달하지 않습니다.

## 작업 방식

1. 변경 전에 관련 controller, overlay, shared message와 기존 테스트를 먼저 읽습니다.
2. 사용자가 요청하지 않은 동작이나 권한을 확대하지 않습니다.
3. 기존 미커밋 변경을 사용자 작업으로 간주하고 관련 없는 파일을 복원하거나 삭제하지 않습니다.
4. 좌표 계산과 색상 변환은 DOM에서 분리한 순수 함수로 작성하고 단위 테스트를 추가합니다.
5. UI interaction 변경은 실제 pointer/keyboard 흐름을 포함한 Playwright 테스트를 추가하거나 갱신합니다.
6. README의 사용법, 권한, 개인정보, 제약사항과 구현이 일치하도록 유지합니다.
7. 사용자가 명시하지 않는 한 commit이나 push를 하지 않습니다.

## 검증 명령

작업 범위에 맞춰 최소한 다음 명령을 실행합니다.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

interaction, popup 또는 브라우저 통합 동작이 바뀌면 build 후 다음도 실행합니다.

```bash
npm run test:browser
```

최종 전달 시 실행한 명령, 테스트 개수, 실패 또는 미검증 항목을 간결하게 보고합니다. 테스트 실패를 숨기거나 테스트를 삭제하여 통과시키지 않습니다.

## 산출물 확인

- `dist/manifest.json`과 popup HTML이 생성되어야 합니다.
- `dist/content.js`는 독립형 IIFE이며 외부 `import`가 없어야 합니다.
- `dist/`와 Playwright 결과물은 커밋 대상이 아닙니다.
- Chrome에서 압축 해제된 확장 프로그램으로 로드할 경로는 `dist/`입니다.
