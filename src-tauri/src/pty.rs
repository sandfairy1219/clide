use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// claude 실행기. 기본은 ocgo(OpenCode Go)로 claude를 띄운다.
/// 환경변수 CLIDE_BIN / CLIDE_MODEL / CLIDE_YES 로 오버라이드 가능.
const OCGO_BIN: &str = "C:\\Users\\lol\\go\\bin\\ocgo.exe";
const DEFAULT_MODEL: &str = "glm-5.2";

#[derive(Clone, Serialize)]
struct PtyDataPayload {
    session: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExitPayload {
    session: String,
    exit_code: Option<i32>,
}

/// 하나의 PTY 세션. master는 resize와 writer를 위해 들고 있어야 한다.
pub struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
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
    let cols = cols.unwrap_or(80);
    let rows = rows.unwrap_or(24);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {e}"))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader: {e}"))?;

    let ocgo_bin = std::env::var("CLIDE_BIN").unwrap_or_else(|_| OCGO_BIN.to_string());
    let model = std::env::var("CLIDE_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    let yes = std::env::var("CLIDE_YES").map(|v| !v.is_empty()).unwrap_or(false);

    // ocgo launch claude --model <model> [--yes]
    let mut cmd = CommandBuilder::new(&ocgo_bin);
    cmd.arg("launch");
    cmd.arg("claude");
    cmd.arg("--model");
    cmd.arg(&model);
    if yes {
        cmd.arg("--yes");
    }
    if let Some(c) = cwd {
        cmd.cwd(c);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;

    drop(pair.slave); // slave는 spawn 후 더 이상 필요 없음

    let master = pair.master;

    // 출력 reader 스레드 → 이벤트 emit
    let app_handle = app.clone();
    let session_id = session.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_handle.emit(
                        "pty-data",
                        PtyDataPayload {
                            session: session_id.clone(),
                            data,
                        },
                    );
                }
                Err(e) => {
                    log::warn!("pty reader error ({session_id}): {e}");
                    break;
                }
            }
        }
    });

    let sess = Arc::new(PtySession {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    state
        .sessions
        .lock()
        .unwrap()
        .insert(session.clone(), sess.clone());

    // 종료 감지 스레드
    let app_handle = app.clone();
    let session_id = session.clone();
    std::thread::spawn(move || {
        let mut child = sess.child.lock().unwrap();
        let status = child.wait();
        let exit_code = status.ok().map(|s| s.exit_code() as i32);
        let _ = app_handle.emit(
            "pty-exit",
            PtyExitPayload {
                session: session_id,
                exit_code,
            },
        );
    });

    Ok(())
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
    let mut writer = sess.writer.lock().unwrap();
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    writer.flush().map_err(|e| format!("flush: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyState>,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sess = {
        let sessions = state.sessions.lock().unwrap();
        sessions
            .get(&session)
            .ok_or_else(|| format!("no session: {session}"))?
            .clone()
    };
    let master = sess.master.lock().unwrap();
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<'_, PtyState>, session: String) -> Result<(), String> {
    let sess = state.sessions.lock().unwrap().remove(&session);
    if let Some(sess) = sess {
        let mut child = sess.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}