import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import MultiSelectInputDropDown from "../../Resuables/InputsComponents/MultiSelectInputDropDown";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import "./css/Settings.css";
import OnBoardingWorkFlowManagement from "./OnBoardingWorkFlowManagement/OnBoardingWorkFlowManagement";
import ServerUsage from "./ServerUsage/ServerUsage";
import UserManagement from "./UserManagement/UserManagement";
import { getWorkFlows, saveNewWorkFlow, saveOffBoardWorkFlow, updatePrimaryApplication } from "../UserManagement/UserManagementActions/UserManagementActions";
import { notifyToast, validateEmail } from "../../helpers/utils";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import { SET_CF_USER, SET_CLOUDS_LIST } from "../../../GlobalContext/action.types";
import Popup from "../../Resuables/Popup/Popup";
import { createClientAccessToken, updateExistingUser } from "./SettingsActions/SettingsActions";
import TextInputUpdate from "../../Resuables/InputsComponents/TextInputUpdate";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import CustomToolTip from "../../Resuables/CustomToolTip/CustomToolTip";
import { Scan } from "lucide-react";
const PROACTIVE_KEY = 'cf_proactive_enabled';
const Settings = () => {
  const navigate = useNavigate();
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { cloudsList, user } = globalContext;
  const [activeTab, setActiveTab] = useState("");
  const [primaryApplication, setPrimaryApplication] = useState(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [confirmDialogVisible, setConfirmDialogVisible] = useState(false);
  const [nextPrimaryApplication, setNextPrimaryApplication] = useState(null);
  const [isSupportEmailEditable, setIsSupportEmailEditable] = useState(false);
  const [clientTokenReveal, setClientTokenReveal] = useState(null);
  const [clientTokenLoading, setClientTokenLoading] = useState(false);
  const [proactiveEnabled, setProactiveEnabled] = useState(
    () => localStorage.getItem(PROACTIVE_KEY) !== 'false'
  );
  const formatTokenCreatedDisplay = (iso) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const handleCreateClientToken = async () => {
    setClientTokenLoading(true);
    try {
      const res = await createClientAccessToken();
      if (res?.status === "OK" && res?.res?.token) {
        const createdTime = res?.res?.tokenCreatedTime ?? new Date().toISOString();
        setClientTokenReveal(res.res.token);
        dispatch({
          type: SET_CF_USER,
          payload: {
            ...user,
            tokenCreated: true,
            tokenCreatedTime: createdTime,
          },
        });
        notifyToast("success", "Access token created. Copy it now — it will not be shown again.");
      } else {
        notifyToast(
          "error",
          res?.res?.message || res?.res || "Failed to create access token"
        );
      }
    } finally {
      setClientTokenLoading(false);
    }
  };
  useEffect(() => {
    if (cloudsList?.length > 0) {
      let app = cloudsList?.find((cloud) => cloud?.primaryApp);
      if (app) {
        setPrimaryApplication(app);
      }
    }
  }, [cloudsList]);

  const savePrimaryApplication = async (id) => {
    setIsPageLoading(true);
    setConfirmDialogVisible(false);
    let res = await updatePrimaryApplication(id);
    if (res?.status === "OK") {
      setPrimaryApplication(nextPrimaryApplication);
      setIsPageLoading(false);
      let cpyCloudsList = [...cloudsList];
      cpyCloudsList.map((cloud) => {
        if (cloud?.id === id) {
          cloud.primaryApp = true;
        } else {
          cloud.primaryApp = false;
        }
      });
      dispatch({
        type: SET_CLOUDS_LIST,
        payload: cpyCloudsList,
      });
      updateWorkFlows();
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed to save primary application");
    }
  }


  const updateWorkFlows = async () => {
    setIsPageLoading(true);

    try {
      const response = await getWorkFlows();

      if (response?.status !== "OK") return;

      const {
        onBoardWorkFlowList = [],
        offBoardWorkFlowList = [],
      } = response?.res || {};

      const autoOnboardWorkflow = onBoardWorkFlowList.find(
        (workFlow) =>
          workFlow?.manual === false &&
          workFlow?.workFlowName === "ONBOARD"
      );

      if (
        autoOnboardWorkflow &&
        autoOnboardWorkflow.adminCloudId !== nextPrimaryApplication?.id
      ) {
        const updatedWorkflow = {
          ...autoOnboardWorkflow,
          adminCloudId: nextPrimaryApplication?.id,
          providerName: nextPrimaryApplication?.providerName,
        };

        await saveNewWorkFlow(updatedWorkflow);
      }

      const offboardWorkflow = offBoardWorkFlowList[0];

      if (
        offboardWorkflow &&
        offboardWorkflow.adminCloudId !== nextPrimaryApplication?.id
      ) {
        const updatedOffboardWorkflow = {
          ...offboardWorkflow,
          adminCloudId: nextPrimaryApplication?.id,
        };

        await saveOffBoardWorkFlow(updatedOffboardWorkflow);
      }
    } catch (error) {
      console.error("Failed to update workflows:", error);
    } finally {
      setIsPageLoading(false);
    }
  };

  const updateSupportEmail = async (email) => {
    setIsPageLoading(true);
    setIsSupportEmailEditable(false);
    let newUpadate = await updateExistingUser({ ...user, supportEmail: email });
    if (newUpadate?.status === "OK") {
      setIsPageLoading(false);
      dispatch({ type: SET_CF_USER, payload: newUpadate?.res });
      notifyToast("success", "Support Email Updated Successfully");
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed to update support email");
    }
  }


  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Settings" />
        <div className="cf_main_content_place">
          <TopNav
            reportsCustomToggler={(e) => setActiveTab(e)}
            backLink={activeTab ? "/Settings" : ""}
            pageName={
              activeTab === "USER_MANAGEMENT"
                ? "User Management"
                : activeTab === "ONBOARDING_WORKFLOW_MANAGEMENT"
                  ? "OnBoarding Workflow Management"
                  : "Settings"
            }
          />
          <div
            className="cf_main_content_place_main"
            style={{
              padding: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>Primary Application</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <div style={{ width: "300px", position: "absolute" }}>
                  <MultiSelectInputDropDown
                    isCloudsList={true}
                    parentStyle={{ maxWidth: "100%" }}
                    childrenStyle={{ maxWidth: "300px" }}
                    loadAction={() => {
                      return true;
                    }}
                    displayFields={["adminEmail"]}
                    options={{
                      inputType: "radio",
                      inputName: "currentApplication",
                      name: "Primary Application",
                    }}
                    suggestedData={cloudsList?.filter(
                      (cloud) => cloud?.providerName !== "OTHERS"
                    )}
                    selectedData={primaryApplication ? [primaryApplication] : []}
                    handleSelection={(e, data) => {
                      setNextPrimaryApplication(data);
                      setConfirmDialogVisible(true);
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <div style={{ display: "flex", alignItems: "center", gap: "5px", position: "relative" }}>
                  <h2>Support Email</h2>
                  <div style={{ position: "absolute", top: "0", right: "-20px", cursor: "pointer" }}
                    title="This support email will be included in the footer section of Onboarding Notification emails."
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" color="#454545" width="14" height="14" viewBox="0 0 24 24" fill="#f2f2f2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-circle-question-mark-icon lucide-circle-question-mark"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
                  </div>
                </div>
              </div>
              <div className="cf_main_userManagement_body" style={{ position: "absolute", width: "fit-content" }}>
                <div style={{ width: "300px", position: "absolute", marginTop: "-15px" }}>
                  {isSupportEmailEditable ? (
                    <div style={{ width: "calc(100% - 100px)" }}>
                      <TextInputUpdate
                        defaultVal={user?.supportEmail}
                        inputWidth="300px"
                        inputHeight="40px"
                        customActionStyles={{ top: "45px" }}
                        closeAction={() => setIsSupportEmailEditable(false)}
                        saveAction={(value) => {
                          if (validateEmail(value)) {
                            updateSupportEmail(value);
                          } else {
                            notifyToast("error", "Invalid Email");
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <p
                      className="cf_newFlow_trigger_pannel_header_name cf_newFlow_trigger_pannel_header_name_hoverEffect"
                      onClick={() => setIsSupportEmailEditable(true)}
                      style={{ cursor: "pointer", fontSize: "14px", marginTop: "10px", width: "fit-content", padding: "5px" }}
                    >
                      {user?.supportEmail || "No Support Email Configured"}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {/* <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>Manage Browser Extensions</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <ButtonComponent
                  isLoading={false}
                  isDisabled={false}
                  buttonName="Manage Browser Extensions"
                  buttonClickAction={() => {
                    navigate("/Settings/BrowserExtensionConfig");
                  }}
                />
              </div>
            </div> */}
            {/* <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>Manage Orgchart</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <ButtonComponent
                  isLoading={false}
                  isDisabled={false}
                  buttonName="Manage Orgchart"
                  buttonClickAction={() => {
                    navigate("/OrgChart");
                  }}
                />
              </div>
            </div> */}
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>User Management</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <ButtonComponent
                  isLoading={false}
                  isDisabled={false}
                  buttonName="Manage Users"
                  buttonClickAction={() => {
                    setActiveTab("USER_MANAGEMENT");
                    window.location.hash = "userManagement";
                  }}
                />
              </div>
            </div>
            {/* <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>Manage Server</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <ButtonComponent
                  isLoading={false}
                  isDisabled={false}
                  buttonName="Add/Remove Servers"
                />
              </div>
            </div>
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>Add Licenses</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <ButtonComponent
                  isLoading={false}
                  isDisabled={false}
                  buttonName="Manage Licenses"
                />
              </div>
            </div>
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>Monitor Server Usage</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <ButtonComponent
                  isLoading={false}
                  isDisabled={false}
                  buttonName="Monitor"
                  buttonClickAction={() => setActiveTab("SERVER_USAGE")}
                />
              </div>
            </div> */}
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>CloudFuze Access Token</h2>
              </div>
              <div className="cf_main_userManagement_body" style={{ maxWidth: "640px" }}>
                <div
                  className="settings-client-token-generate-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0",
                  }}
                >
                  <ButtonComponent
                    isLoading={false}
                    isDisabled={false}
                    buttonName={clientTokenLoading ? "Generating…" : "Generate Access Token"}
                    buttonClickAction={handleCreateClientToken}
                  />
                </div>
              </div>
            </div>
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>AI Agent Suggestions</h2>
              </div>
              <div className="cf_main_userManagement_body" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  onClick={() => {
                    const next = !proactiveEnabled;
                    setProactiveEnabled(next);
                    localStorage.setItem(PROACTIVE_KEY, String(next));
                  }}
                  style={{
                    width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                    background: proactiveEnabled ? "#2563eb" : "#cbd5e1",
                    position: "relative", transition: "background 0.2s", flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 3,
                    left: proactiveEnabled ? 23 : 3,
                    width: 18, height: 18, borderRadius: "50%",
                    background: "#fff", transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }} />
                </div>
                <span style={{ fontSize: 14, color: "#374151" }}>
                  {proactiveEnabled ? "Enabled" : "Disabled"} — proactive question suggestions from the AI agent
                </span>
              </div>
            </div>
            <div className="cf_main_userManagement">
              <div className="cf_main_userManagement_title">
                <h2>Audit Logs</h2>
              </div>
              <div className="cf_main_userManagement_body">
                <ButtonComponent
                  isLoading={false}
                  isDisabled={false}
                  buttonName="View Audit Logs"
                  buttonClickAction={() => {
                    navigate("/AuditLogs");
                  }}
                />
              </div>
            </div>
          </div>
          {activeTab === "USER_MANAGEMENT" ? (
            <UserManagement changeClick={(e) => setActiveTab(e)} />
          ) : (
            ""
          )}
          {activeTab === "ONBOARDING_WORKFLOW_MANAGEMENT" ? (
            <OnBoardingWorkFlowManagement changeClick={(e) => setActiveTab(e)} />
          ) : (
            ""
          )}
          {activeTab === "SERVER_USAGE" ? (
            <ServerUsage changeClick={(e) => setActiveTab(e)} />
          ) : (
            ""
          )}
        </div>
      </div>
      <Popup
        options={{
          isOpen: confirmDialogVisible,
          title: `Primary Application Alert`,
          popupWidth: "60%",
          popupHeight: `200px`,
          popupTop: "150px",
        }}
        toggleOpen={setConfirmDialogVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "30px",
            maxHeight: "500px",
          }}
        >
          <p style={{ fontWeight: "500", textAlign: "center" }}>
            By changing the primary application, the automated workflows will be updated to the new primary application.<br /> Are you sure you want to continue?
          </p>
        </div>
        <div className="cf_popup_container_footer" style={{ gap: "10px" }}>
          <ButtonComponent
            customstyles={{
              marginLeft: "auto",
              background: "#f2f2f2",
              color: "#000",
              border: "1px solid #ddd",
            }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="No"
            buttonClickAction={() => {
              setConfirmDialogVisible(false);
            }}
          />
          <ButtonComponent
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Yes"
            buttonClickAction={() => savePrimaryApplication(nextPrimaryApplication?.id)}
          />
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: !!clientTokenReveal,
          title: "CloudFuze Access Token",
          popupWidth: "600px",
          popupHeight: "250px",
          popupTop: "100px",
        }}
        toggleOpen={() => setClientTokenReveal(null)}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "16px 18px 20px",
            flexDirection: "column",
            gap: "14px",
            height: "200px",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          {clientTokenReveal ? (
            <TextInput
              key={clientTokenReveal}
              isLableRequired
              type="text"
              placeHolder="client-api-access-token"
              inputName="clientAccessToken"
              readOnly
              copyToClipboard
              copyButtonText="Token"
              defaultValue={`Bearer ${clientTokenReveal}`}
              inputWidth="100%"
              textInputWidth="100%"
              inputHeight="44px"
              inputFontSize="13px"
            />
          ) : null}
          <p
            style={{
              fontSize: "13px",
              color: "#b45309",
              margin: 0,
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            This CloudFuze Access Token is shown only once. Copy it now and store it securely. You will not be able to see it
            again after you close this dialog or refresh the page.
          </p>
        </div>
        {/* <div className="cf_popup_container_footer" style={{ gap: "10px", padding: "0 18px 16px" }}>
          <ButtonComponent
            customstyles={{ marginLeft: "auto", background: "#f1f5f9", color: "#0f172a" }}
            isLoading={false}
            isDisabled={false}
            buttonName="Close"
            inputWidth="100px"
            buttonClickAction={() => setClientTokenReveal(null)}
          />
        </div> */}
      </Popup>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default Settings;
