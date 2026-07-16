import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickEditWindow } from "./features/quick-edit/QuickEditWindow";
import "./styles.css";
import "./styles/aurora-index.css";
import "./styles/abyssal-vent-index.css";
import "./styles/obsidian-sand-index.css";
import "./styles/cloudrift-index.css";
import "./styles/draftgrid-index.css";
import "./styles/frostplain-index.css";
import "./styles/graphite-forge-index.css";
import "./styles/inkpaper-index.css";
import "./styles/lumenreef-index.css";
import "./styles/mossline-index.css";
import "./styles/nebula-dust-index.css";
import "./styles/orange-sea-index.css";
import "./styles/rainlake-index.css";
import "./styles/umbra-index.css";
import "./styles/celadon-index.css";

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
