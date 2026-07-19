use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// claude 실행기. ocgo(OpenCode Go)로 claude를 interactive stream-json 모드로 띄운다.
/// 환경변수 CLIDE_BIN / CLIDE_MODEL / CLIDE_YES 로 오버라이드 가능.
///
/// **실행 모델 — piped std::process (ConPTY 아님):**
/// stream-json 은 라인 지향이라 터미널 제어가 필요 없다. 게다가 claude 는
/// stdin 이 tty 면 interactive REPL 로 가서 `--input-format=stream-json` 을
/// "requires --print" 로 거절한다. 그러므로 stdin/stdout/stderr 를 **pipe**
/// (non-tty) 로 묶어 claude 가 자동 print/streaming 모드 로 진입하게 한다.
/// 이 경로는 한 프로세스가 살아있으며 stdin NDJSON user 메시지를 계속 받고
/// stdout 으로 NDJSON 이벤트를 계속 뱉는다 = 단일 세션 다중 턴 (VERIFY A 실증).
const OCGO_BIN: &str = "C:\\Users\\lol\\go\\bin\\ocgo.exe";
const DEFAULT_MODEL: &str = "glm-5.2";

/// 파싱된 claude 이벤트 한 줄 (NDJSON).
#[derive(Clone, Serialize)]
struct ClaudeEventPayload {
    session: String,
    event: Value,
}

/// 비-JSON 라인 (ocgo stderr 노이즈 "No OCGO model mappings..." 등).
#[derive(Clone, Serialize)]
struct PtyLogPayload {
    session: String,
    data: String,
    stream: String, // "stdout" | "stderr"
}

#[derive(Clone, Serialize)]
struct PtyExitPayload {
    session: String,
    exit_code: Option<i32>,
}

/// 하나의 claude 파이프 세션. stream-json 은 터미널 크기를 쓰지 않으므로
/// master/resize 대신 stdin writer + child 만 들고 있으면 된다.
pub struct PipeSession {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Arc<PipeSession>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: tauri::State<'_, PtyState>,
    session: String,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    // stream-json 은 터미널 크기를 사용하지 않음. cols/rows 는 API 호환용으로
    // 받되 무시한다 (pty_resize 도 no-op).
    let _ = (cols, rows);

    let ocgo_bin = std::env::var("CLIDE_BIN").unwrap_or_else(|_| OCGO_BIN.to_string());
    let model = std::env::var("CLIDE_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    // 기본 yes=true: stream-json 라인 모드엔 permission_request 이벤트가 안 나오므로
    // 자동 승인하지 않으면 claude 가 무한 대기(deadlock)할 수 있다.
    let yes = std::env::var("CLIDE_YES")
        .map(|v| !v.is_empty())
        .unwrap_or(true);

    // ocgo launch claude --model <model> [--yes] -- <claude args...>
    //   - ocgo 플래그(--model, --yes)는 `--` 앞.
    //   - claude 인자는 `--` 뒤 (없으면 ocgo unknown option).
    let mut cmd = std::process::Command::new(&ocgo_bin);
    cmd.arg("launch");
    cmd.arg("claude");
    cmd.arg("--model");
    cmd.arg(&model);
    if yes {
        cmd.arg("--yes");
    }
    // claude 인자 — interactive stream-json 모드.
    // stdin 을 pipe(non-tty) 로 묶으면 claude 가 자동 print/streaming 모드 로
    // 진입해 --input-format=stream-json 을 수락하고 다중 턴 stdin NDJSON 을 받는다.
    // 주의: --print 를 명시하면 1회성 print 로 끝나 다중 턴이 안 됨 → 붙이지 않음.
    cmd.arg("--");
    cmd.arg("--input-format=stream-json");
    cmd.arg("--output-format=stream-json");
    cmd.arg("--verbose");
    cmd.arg("--include-partial-messages");

    if let Some(c) = cwd {
        cmd.current_dir(c);
    }
    cmd.env("TERM", "dumb"); // tty 가 아니므로 xterm-256color 무의미 → dumb
    cmd.env("NO_COLOR", "1");
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn ocgo: {e} (bin={ocgo_bin})"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stdout not piped".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "stderr not piped".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "stdin not piped".to_string())?;

    // stdout reader: 라인 단위 NDJSON 파싱 → claude-event / pty-log emit.
    let app_h = app.clone();
    let sid = session.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.is_empty() => emit_line(&app_h, &sid, &l, "stdout"),
                Ok(_) => {}
                Err(e) => {
                    log::warn!("stdout reader ({sid}): {e}");
                    break;
                }
            }
        }
    });

    // stderr reader: ocgo "No OCGO model mappings..." 노이즈 + claude 에러.
    let app_h = app.clone();
    let sid = session.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.is_empty() => {
                    let _ = app_h.emit(
                        "pty-log",
                        PtyLogPayload {
                            session: sid.clone(),
                            data: l,
                            stream: "stderr".to_string(),
                        },
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!("stderr reader ({sid}): {e}");
                    break;
                }
            }
        }
    });

    let sess = Arc::new(PipeSession {
        stdin: Mutex::new(Some(stdin)),
        child: Mutex::new(Some(child)),
    });
    state
        .sessions
        .lock()
        .unwrap()
        .insert(session.clone(), sess.clone());

    // 종료 감지 스레드
    let app_h = app.clone();
    let sid = session.clone();
    std::thread::spawn(move || {
        let mut child_opt = sess.child.lock().unwrap();
        if let Some(child) = child_opt.as_mut() {
            let status = child.wait();
            let exit_code = status.ok().and_then(|s| s.code());
            let _ = app_h.emit(
                "pty-exit",
                PtyExitPayload {
                    session: sid,
                    exit_code,
                },
            );
        }
    });

    Ok(())
}

/// stdout 라인을 JSON 파싱 시도 → 이벤트 emit.
fn emit_line(app: &AppHandle, session: &str, line: &str, stream: &str) {
    match serde_json::from_str::<Value>(line) {
        Ok(event) => {
            let _ = app.emit(
                "claude-event",
                ClaudeEventPayload {
                    session: session.to_string(),
                    event,
                },
            );
        }
        Err(_) => {
            let _ = app.emit(
                "pty-log",
                PtyLogPayload {
                    session: session.to_string(),
                    data: line.to_string(),
                    stream: stream.to_string(),
                },
            );
        }
    }
}

#[tauri::command]
pub fn pty_write(
    state: tauri::State<'_, PtyState>,
    session: String,
    data: String,
) -> Result<(), String> {
    let sess = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&session)
            .ok_or_else(|| format!("no session: {session}"))?
            .clone()
    };
    let mut guard = sess.stdin.lock().unwrap();
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "session stdin closed".to_string())?;
    stdin
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    stdin.flush().map_err(|e| format!("flush: {e}"))?;
    Ok(())
}

/// stream-json 은 터미널 크기를 사용하지 않음 → no-op. API 호환용으로 유지.
#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let _ = (state, session, cols, rows);
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, PtyState>, session: String) -> Result<(), String> {
    let sess = state.sessions.lock().unwrap().remove(&session);
    if let Some(sess) = sess {
        // stdin 을 닫아 claude 가 EOF 를 감지하게 하고, 여유 있게 kill.
        {
            let mut guard = sess.stdin.lock().unwrap();
            *guard = None;
        }
        if let Some(child) = sess.child.lock().unwrap().as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}