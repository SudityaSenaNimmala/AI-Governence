import { installGlobalErrorReporting } from './lib/reportClientError.js';
// Catches the two failures React's error boundary never sees: an error in an
// event handler, and a rejected promise nobody awaited. Those are exactly the
// "I clicked it and nothing happened" cases -- the boundary only fires during
// render, so without this a broken button is invisible to everything.
installGlobalErrorReporting();
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
