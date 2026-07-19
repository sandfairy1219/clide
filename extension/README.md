# Clide — VS Code용 Claude Code 클라이언트

**ocgo** (OpenCode Go)를 백엔드로 사용해 Claude Code를 VS Code 사이드 패널 채팅 UI로 쓸 수 있습니다.

## Features

- **Activity Bar** 아이콘 또는 **Editor Title** 버튼으로 채팅 패널 열기
- stream-json 기반 실시간 Claude 응답 스트리밍
- 둥근 채팅 버블, 코드 카드(Bash/Read/Edit/Write/Grep), 마크다운 렌더링
- Tokyonight Night 다크 테마

## Requirements

- [ocgo](https://github.com/anthropics/claude-code) — Claude Code Go 실행기 (`C:\Users\lol\go\bin\ocgo.exe`)
- Claude Code 계정 및 API 키

## Usage

1. 확장 설치 후 VS Code 재로드
2. 왼쪽 Activity Bar에서 Clide 아이콘(말풍선) 클릭 또는 에디터 탭 상단 Clide 아이콘 클릭
3. 하단 입력창에 메시지를 입력하고 Enter
4. Claude의 응답이 채팅 버블로 표시됨

## Configuration

환경변수로 설정을 오버라이드할 수 있습니다:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `CLIDE_BIN` | `C:\Users\lol\go\bin\ocgo.exe` | ocgo 실행 파일 경로 |
| `CLIDE_MODEL` | `glm-5.2` | Claude 모델 ID |
| `CLIDE_YES` | `true` | 권한 자동 승인 |

## Build

```bash
cd extension
pnpm install
pnpm run build        # 빌드
pnpm vsce package     # .vsix 생성
```

## License

MIT
