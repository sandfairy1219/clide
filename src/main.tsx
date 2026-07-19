import ReactDOM from "react-dom/client";
import App from "./App";

// NOTE: PTY + xterm 조합에서 StrictMode dev 이중 마운트가
// 같은 컨테이너에 터미널을 두 번 open + PTY도 두 번 spawn →
// ResizeObserver fit 루프가 메인 스레드를 잡아먹어 창이
// 응답없음으로 멈추는 원인이 됨 → StrictMode 제거.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);