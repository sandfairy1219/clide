# clide

**ocgo** (OpenCode Go)를 백엔드로 사용하는 Claude Code 클라이언트. stream-json 모드로 Claude와 통신하며, Tauri 데스크톱 앱과 VS Code 확장 두 가지로 제공됩니다.

## 구조

```
src/              — React 프론트엔드 (Tauri + VS Code WebView 공유)
├── components/   — 채팅 UI (MessageBubble, CodeCard, ChatLog 등)
├── App.tsx       — Tauri 앱 메인
└── terminal.ts   — Tauri PTY 바인딩

src-tauri/        — Tauri 데스크톱 앱 (Rust)
└── src/pty.rs    — ocgo spawn, stream-json 파싱, Tauri 이벤트 emit

extension/        — VS Code 확장
├── src/extension.ts  — WebViewView provider + ocgo spawn
└── webview/main.tsx  — src/components/ChatLog 재사용
```

## Tauri 데스크톱 앱

```bash
pnpm install
pnpm tauri dev
```

## VS Code 확장

```bash
cd extension
pnpm install
pnpm run build
pnpm vsce package    # → clide-vscode-0.1.0.vsix
```

VSIX 파일을 VS Code → 확장 → VSIX에서 설치 로 설치합니다.

### 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CLIDE_BIN` | `C:\Users\lol\go\bin\ocgo.exe` | ocgo 실행 파일 경로 |
| `CLIDE_MODEL` | `glm-5.2` | Claude 모델 ID |
| `CLIDE_YES` | `true` | 권한 자동 승인 |

## 라이선스

MIT
