import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./index_35X35.css";
import GlobalApp from "./GlobalApp.jsx";
import { initHotjar } from "./analytics/hotjar";

// No-ops unless a Hotjar site ID is configured, which is the default. Called before render so the
// hj() queue exists for the first identify call. See src/analytics/hotjar.js.
initHotjar();

ReactDOM.createRoot(document.getElementById("root")).render(
  <>
    <GlobalApp />
  </>
);

// <React.StrictMode>
{
  /* <App /> */
}
// </React.StrictMode>
