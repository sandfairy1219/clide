import * as vscode from "vscode";
import { spawn, type ChildProcess } from "child_process";

const OCGO_BIN = process.env.CLIDE_BIN || "C:\\Users\\lol\\go\\bin\\ocgo.exe";
const MODEL = process.env.CLIDE_MODEL || "glm-5.2";

interface PtySession {
  child: ChildProcess;
  webview: vscode.Webview;
}

const sessions = new Map<string, PtySession>();

function getNonce(): string {
  let t = "";
  const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 64; i++) t += p[Math.floor(Math.random() * p.length)];
  return t;
}

function startSession(session: string, webview: vscode.Webview) {
  const yes = process.env.CLIDE_YES === undefined ? true : process.env.CLIDE_YES !== "";

  const child = spawn(OCGO_BIN, [
    "launch", "claude",
    "--model", MODEL,
    ...(yes ? ["--yes"] : []),
    "--",
    "--input-format=stream-json",
    "--output-format=stream-json",
    "--verbose",
    "--include-partial-messages",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
  });

  sessions.set(session, { child, webview });

  const emit = (event: string, payload: Record<string, unknown>) => {
    webview.postMessage({ event, payload: { session, ...payload } });
  };

  let buf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        emit("claude-event", { event: parsed });
      } catch {
        emit("pty-log", { data: line, stream: "stdout" });
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      emit("pty-log", { data: line, stream: "stderr" });
    }
  });

  child.on("exit", (code) => {
    emit("pty-exit", { exit_code: code });
    sessions.delete(session);
  });
}

function getWebviewHtml(webview: vscode.Webview, nonce: string): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(vscode.Uri.file(__dirname), "..", "dist", "webview.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(vscode.Uri.file(__dirname), "..", "dist", "webview.css"),
  );

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="content-security-policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" nonce="${nonce}" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

class ClideViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;
    const session = crypto.randomUUID();
    const webview = webviewView.webview;
    const nonce = getNonce();

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(vscode.Uri.file(__dirname), "..", "dist"),
      ],
    };

    webview.html = getWebviewHtml(webview, nonce);

    webview.onDidReceiveMessage((msg) => {
      const sess = sessions.get(session);
      if (!sess) return;

      if (msg.type === "pty_write" && sess.child.stdin) {
        const payload = JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: msg.data }] },
        }) + "\n";
        sess.child.stdin.write(payload);
      }
      if (msg.type === "pty_kill") {
        sess.child.kill();
        sessions.delete(session);
      }
      if (msg.type === "ready") {
        webview.postMessage({
          event: "claude-event",
          payload: {
            session,
            event: {
              type: "system",
              subtype: "init",
              model: MODEL,
              session_id: session,
            },
          },
        });
      }
    });

    startSession(session, webview);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new ClideViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("clide.chat", provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("clide.open", () => {
      vscode.commands.executeCommand("workbench.view.extension.clide");
    }),
  );
}

export function deactivate() {
  for (const [, sess] of sessions) {
    sess.child.kill();
  }
  sessions.clear();
}
