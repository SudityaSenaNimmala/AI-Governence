import React, { Profiler, useEffect, useReducer } from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import App from "./App";
import { ChatPanel } from "./Components/App/Agent/FloatingAgent/ChatPanel";
import { isSessionValid, notifyToast } from "./Components/helpers/utils";
import { GlobalContext } from "./GlobalContext/GlobalContext";
import GlobalContextReducer from "./GlobalContext/GlobalContextReducer";
import { RESET_APP_CONTEXT } from "./GlobalContext/action.types";
import ReactDOM from "react-dom";
import ErrorCatcher from "./Components/Resuables/ErrorCatcher/ErrorCatcher";

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
          localStorage.clear();
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
