import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./lib/theme";
import "./styles.css";

initTheme(); // 对齐主题偏好 + 跟随系统深浅变化(首帧定妆在 index.html 内联脚本)

createRoot(document.getElementById("app")!).render(<App />);
