import React, { Profiler, useEffect, useReducer } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import App from "./App";
import { ChatPanel } from "./Components/App/Agent/FloatingAgent/ChatPanel";
import { isSessionValid, notifyToast, clearLocalStorage } from "./Components/helpers/utils";

// Wrapper that preserves AG keys across session clear
const clearLocalStorageSafe = clearLocalStorage;
import { GlobalContext } from "./GlobalContext/GlobalContext";
import GlobalContextReducer from "./GlobalContext/GlobalContextReducer";
import { RESET_APP_CONTEXT } from "./GlobalContext/action.types";
import ReactDOM from "react-dom";
import ErrorCatcher from "./Components/Resuables/ErrorCatcher/ErrorCatcher";
import { identifyHotjarUser } from "./analytics/hotjar";

const GlobalApp = () => {
  // const navigation = useNavigate();

  const stateData = {
    time: 0,
    user: {},
    csvId: "",
    userId: "",
    userEmail: "",
    authToken: "",
    jobDetails: {},
    jobParams: "",
    mappedPairs: [],
    mappingSource: [],
    billingSummary: {},
    mappingDestination: [],
    rolesList: [],
    oauthStatus: "",
    cloudsList: [],
    saasCloud: {},
    sourceCloud: {},
    destinationCloud: {},
    resourceAppsList: [],
    resourceAppsSummary: {},
    groupsTeamsList: [],
    channelsMappingsList: {
      public: [],
      export: [],
      private: [],
      exportIds: [],
      publicIds: [],
      privateIds: [],
    },
    dmsMappingsList: {
      dms: [],
      dmIds: [],
    },
    groupsTeamsSummary: {},
  };
  const initialState =
    localStorage?.globalState && localStorage?.globalState !== "undefined"
      ? JSON.parse(localStorage?.globalState)
      : stateData;

  const [globalContext, dispatch] = useReducer(
    GlobalContextReducer,
    initialState
  );

  useEffect(() => {
    localStorage.setItem("globalState", JSON.stringify(globalContext));
  }, [globalContext]);

  // Tag the Hotjar recording once sign-in resolves, so a session can be traced back to the tenant
  // it belongs to. No-ops when Hotjar is disabled, which is the default. Sends no email address --
  // see identifyHotjarUser in src/analytics/hotjar.js for why.
  useEffect(() => {
    if (globalContext?.userId) identifyHotjarUser(globalContext.user);
    // userId only: SET_CF_USER also fires on profile edits (Settings, UserManagement), and
    // re-identifying on each of those is noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalContext?.userId]);

  useEffect(() => {
    if (!(localStorage.time && window.location.pathname === "/CloudFuze")) {
      if (!isSessionValid() && localStorage.time) {
        dispatch({
          type: RESET_APP_CONTEXT,
          payload: "",
        });
        if (localStorage.time) {
          localStorage.removeItem("time");
          notifyToast("warn", "Session expired. Please login again.");
        }
        setTimeout(() => {
          clearLocalStorageSafe();
          window.location.href = "/CloudFuze#login";
        }, 200);
      }
    }
  }, []);

  const onRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
    interactions
  ) => {
    // console.log("Render details: ", {
    //   id: id,
    //   phase: phase,
    //   actualDuration: actualDuration,
    //   baseDuration: baseDuration,
    //   startTime: startTime,
    //   interactions: interactions,
    // });
  };

  return (
    <>
      <Profiler id="GlobalApp" onRender={onRenderCallback}>
        {/* <ErrorCatcher> */}
        <GlobalContext.Provider value={{ globalContext, dispatch }}>
          <App />
          {/* {!!globalContext.authToken && (
            <ChatPanel
              token={globalContext.authToken || ''}
              isAuthenticated={true}
              userFullName={globalContext.user?.name || globalContext.userEmail || ''}
            />
          )} */}
          {/* <GlobalChatAgent /> */}
        </GlobalContext.Provider>
        {ReactDOM.createPortal(
          <ToastContainer
            position="top-right"
            autoClose={5000}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme="light"
          />,
          document.getElementById("toast-root")
        )}
        {/* </ErrorCatcher> */}
      </Profiler>
    </>
  );
};

export default GlobalApp;
