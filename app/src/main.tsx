import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickEditWindow } from "./features/quick-edit/QuickEditWindow";
import "./styles.css";
import "./styles/aurora-index.css";
import "./styles/abyssal-vent-index.css";

// Disable default webview context menu to prevent opening browser actions.
document.addEventListener("contextmenu", (event) => {
  if (event.target instanceof HTMLElement && event.target.closest("[data-allow-native-contextmenu='true']")) {
    return;
  }
  event.preventDefault();
});

const which = new URLSearchParams(window.location.search).get("window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {which === "quick-edit" ? <QuickEditWindow /> : <App />}
  </React.StrictMode>,
);
