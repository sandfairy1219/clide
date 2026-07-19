# clide — stream-json UI 전환 스펙

캡처 기반 명세. xterm(TUI 글자 덤프)을 버리고 stream-json 이벤트를 파싱해 채팅 UI(버블/코드카드/승인 버튼)로 렌더.

## 1. 실행 모델 (백엔드 pty.rs)

ocgo로 claude를 **interactive stream-json 모드**로 띄운다 (`-p` print 아님 — 연속 대화용).

```
ocgo launch claude --model <id> --yes -- --input-format=stream-json --output-format=stream-json --verbose --include-partial-messages
```

- `--model`, `--yes` → **ocgo 플래그** (`--` 앞). `--yes`는 권한 자동 승인.
- `--` **뒤** → claude 인자. `--` 없으면 ocgo가 `unknown option` 에러.
- 입력(stdin) = NDJSON user 메시지 라인. 출력(stdout) = NDJSON 이벤트 라인.
- 환경변수 `CLIDE_BIN`/`CLIDE_MODEL`/`CLIDE_YES` (기본 yes=true — 프롬프트 대기 데드락 방지).

## 2. 이벤트 스키마 (실제 캡처 기반)

각 줄 = 독립 JSON 객체. `type` 필드로 분기.

### `system`
- `subtype: "init"` — 세션 시작. `tools`, `model`, `session_id`, `permissionMode` 등.
- `subtype: "status"` — `status: "requesting"` (LLM 요청 중 표시용).

### `stream_event` (부분 메시지 — `--verbose --include-partial-messages` 필요)
`event.type`:
- `message_start` — assistant 메시지 시작.
- `content_block_start` — `content_block` = `{type:"text",text:""}` 또는 `{type:"tool_use",id,name,input:{}}`.
- `content_block_delta` — `delta.type`:
  - `text_delta` → `delta.text` (타이핑 효과용 글자 조각)
  - `input_json_delta` → `delta.partial_json` (tool 인자 JSON 조각, 이어붙여 파싱)
- `content_block_stop` — 블록 종료.
- `message_delta` → `delta.stop_reason` (`"tool_use"` / `"end_turn"`).
- `message_stop` — 메시지 종료.
→ `--include-partial-messages` **끄면** 이 이벤트들이 안 오고 `assistant` 완성본만 옴 (단순하지만 딜레이 있음).

### `assistant` (완성된 assistant 메시지 한 턴분)
`message.content[]` 배열, 각 block:
- `{type:"text", text}` — 텍스트. 마크다운/코드펜스 포함 가능.
- `{type:"tool_use", id, name, input}` — 도구 호출. `name` 예: `Bash`, `Read`, `Edit`, `Write`, `Grep`, ...
→ 버블 또는 코드카드로 렌더.

### `user` (tool_result — assistant의 tool_use에 대한 결과)
`message.content[]` 배열, 각:
- `{type:"tool_result", tool_use_id, content, is_error}` — 도구 실행 결과.
- `tool_use_result` (최상위) — `{stdout, stderr, interrupted, isImage}`. Bash 등 커맨드 출력은 여기.
→ tool_use 카드 아래 결과 블록으로 매달거나 별도 result 카드.

### `result` (전체 응답 종료 — print/turn 단위)
`subtype: "success"`, `result` (최종 텍스트), `usage`, `duration_ms`, `total_cost_usd`, `num_turns`.
→ 1회 `-p` 호출 종료 표시. interactive 모드에선 turn마다 올 수 있음.

### (관찰되지 않음) `permission_request`
캡처(Bash echo)에서 `--yes` 유무와 무관하게 permission_request 이벤트 미발생 → stream-json 라인 모드에선 권한 프롬프트가 이벤트로 안 나옴. → 1단계는 `--yes` 자동승인. 승인 버튼은 폐기 또는 2단계 PTY fallback 경로로 별도 설계.

## 3. 설계 결정

| # | 결정 | 비고 |
|---|---|---|
| 권한 | (A) `--yes` 자동승인, tool_use/result는 버블/카드로만 렌더 | stream-json에 permission_request 안 나옴 |
| 부분 메시지 | `--include-partial-messages` 켬 → 타이핑/tool인자 스트리밍. 스펙은 둘 다 커버 | 토글 가능 |
| 입력 | keystroke 폐기, NDJSON user 메시지로 stdin 전송 | `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}\n` |

## 4. 백엔드 구현 (pty.rs — 직접 구현, 완료)

- spawn 인자: 상기 1절.
- reader 스레드: 8KB 청크 읽기 → 라인 버퍼(`\n` 단위) → 각 줄 `serde_json` 파싱:
  - 성공 → emit `claude-event {session, event: Value}`
  - 실패(비-JSON: ocgo "No OCGO model mappings..." stderr 노이즈 등) → emit `pty-log {session, data: line}`
- `pty_write` 그대로 (stdin = user NDJSON 라인 전송용).

## 5. 프론트 — 1단계 (파이프 테스트)

xterm 유지, **읽기 전용 NDJSON 로그**로 사용. `terminal.ts`:
- `term.onData` → raw keystroke 전송 **끔** (stream-json stdin이 raw를 거부).
- `send(s)` → user NDJSON 래핑 후 `pty_write` (`{"type":"user",...,"text":s}\n`).
- `listen("claude-event")` / `listen("pty-log")` → 각 라인을 xterm에 덤프 (원시 파이프 확인용).

## 6. 프론트 — 2단계 (DeepSeek Flash에 위임할 단순 컴포넌트)

이벤트 → React 컴포넌트 매핑. xterm 영역을 `<ChatLog events={...}/>`로 교체.

### 컴포넌트 명세 (DeepSeek 핸드오프)

```ts
// 이벤트 타입 (pty.rs에서 온 serde_json::Value를 파싱한 가정)
type ClaudeEvent =
  | { type: "system"; subtype: "init" | "status"; status?: string; model?: string; session_id?: string }
  | { type: "stream_event"; event: { type: string; [k: string]: any } }
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: any[] }; tool_use_result?: { stdout: string; stderr: string; isImage: boolean } }
  | { type: "result"; subtype: string; result: string; usage?: any; total_cost_usd?: number; num_turns?: number };

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };
```

### 컴포넌트
- `<MessageBubble role="user"|"assistant">` — 둥근 채팅 버블. assistant는 좌, user는 우 정렬.
- `<CodeCard name input />` — `tool_use` 렌더. `name` 배지(Bash/Read/Edit...) + `input`을 언어별 코드 블록으로 표현 (Bash→`input.command`, Edit→`input.file_path`+diff 등).
- `<ToolResult tool_use_id content stdout stderr is_error />` — `tool_result`. code card 아래/뒤 매달기. `is_error`면 빨강 톤.
- `<Markdown text />` — assistant text 안의 마크다운/코드펜스 코드카드. (가벼운 마크다운 렌더러.)
- `<StatusPill status="requesting" />` — `system status`용 작은 알약 (LLM thinking 표시).
- `<CostFooter usage total_cost_usd num_turns />` — `result` 이벤트용.

### 스타일 가이드 (사용자 선호: 둥글둥글 채팅창 느낌, 다크)
- 토크미드 Night palette (App.css 기존값 참고): bg `#1a1b26`, 표면 `#1f2335`, 보더 `#2a2b3a`, 텍스트 `#c0caf5`, 액센트 `#7aa2f7`(청)/`#9ece6a`(녹)/`#f7768e`(적)/`#e0af68`(주)/`#bb9af7`(보).
- border-radius **크게** (버블 16~18px, 카드 12px, 버튼 10px).
- 버블 max-width ~80%, 부드러운 그림자, spacing 10~14px.
- 코드카드: 헤더(파일명/언어/복사 버튼) + 모노스페이스 본문. 다크 코드 bg `#16161e`.
- 다크 테마 유지, 라이트 변환 불필요.

### 입력 (2단계)
- 하단 입력바 → user NDJSON 메시지 전송. 멀티라인(Shift+Enter) 지원.
- 빠른 승인 버튼(y/n/a/esc/enter)은 stream-json 모드에선 의미 없음 → 제거.

## 7. 단계

- **1단계 (완료)**: pty.rs stream-json + 라인 버퍼 구조화 emit + terminal.ts 파이프 테스트 뷰. `pnpm tauri dev`로 xterm에 NDJSON 라인 찍히는지 / 입력 보내고 assistant 라인 돌아오는지 확인.
- **2단계**: 위 컴포넌트DeepSeek로 구현 → ChatLog로 xterm 교체.