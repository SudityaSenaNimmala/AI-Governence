import {
  CalendarClock,
  ChevronUp,
  Mail,
  Maximize,
  Minus,
  Plus,
  User,
  Workflow
} from "lucide-react";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { getUserId, notifyToast } from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import { getSaaSRolesForApplication, manualTriggerWorkflow } from "../../SaaSManagement/SaaSActions/SaaSActions";
import {
  getTemplatesList,
  getWorkFlows,
  saveOffBoardWorkFlow,
  saveOffBoardWorkFlowManual
} from "../../UserManagement/UserManagementActions/UserManagementActions";
import WorkFlowAddAction from "../../WorkFlowBuilder/WorkFlowHelpers/WorkFlowAddAction";
import { ACTION_TYPES } from "../constants/workflowConstants";
import "../css/NewFlow.css";
import { useCanvasZoom } from "../hooks/useCanvasZoom";
import { useTemplateState } from "../hooks/useTemplateState";
import SelectOffBoardUsers from "./SelectOffBoardUsers";
import ActionPanel from "../components/ActionPanel";
import WorkFlowRenderAppications from "../../WorkFlowBuilder/WorkFlowHelpers/WorkFlowRenderAppications";
import { calculateWidth } from "../utils/workflowUtils";
import TextInputUpdate from "../../../Resuables/InputsComponents/TextInputUpdate";
import CronExpressionBuilder from "../../../Resuables/CronExpressionBuilder/CronExpressionBuilder";
import { getCronDescription } from "../../../Resuables/CronExpressionBuilder/cronUtils";
const ManualOrGroupTriggerOffboarding = () => {
  const navigate = useNavigate();
  const [queryParams] = useSearchParams();
  const type = useParams().type;
  const manualTrigger = queryParams.get("manualTrigger");
  const workFlowId = queryParams.get("workFlowId");
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [flowActionsList, setFlowActionsList] = useState({});
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isTemplatePopupOpen, setIsTemplatePopupOpen] = useState(false);
  const [editWorkFlowObject, setEditWorkFlowObject] = useState(null);
  const [waitingForDragging, setWaitingForDragging] = useState(null);
  const [isCreateTemplate, setIsCreateTemplate] = useState(false);
  const [templatesList, setTemplatesList] = useState([]);
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);
  const [approvalEmail, setApprovalEmail] = useState(null);
  const [isApprovalEmailOpen, setIsApprovalEmailOpen] = useState(false);
  const [isGoogleWorkspaceDataTransferOpen, setIsGoogleWorkspaceDataTransferOpen] = useState(false);
  const [googleWorkSpaceDataTransferEmail, setGoogleWorkSpaceDataTransferEmail] = useState(null);
  const [isSelectUsersOpen, setIsSelectUsersOpen] = useState(false);
  const [selectedUsersOffboarding, setSelectedUsersOffboarding] = useState([]);
  const [isWorkflowNameEditable, setIsWorkflowNameEditable] = useState(false);
  const [flowName, setFlowName] = useState(null);
  const [actionsList, setActionsList] = useState({
    titles: [],
    locations: [],
    divisions: [],
  });
  const [editObject, setEditObject] = useState(null);
  const containerRef = useRef(null);
  const {
    scale,
    innerRef,
    position,
    isDragging,
    onWheelZoom,
    onMouseDown,
    onMouseMove,
    stopDrag,
    resetZoom,
    zoomIn,
    zoomOut,
  } = useCanvasZoom(containerRef);

  const [selectedCron, setSelectedCron] = useState({
    time: null,
    recurring: null,
    date: null,
    isEditOpen: false,
    cronExpression: null,
  });

  const handleCronClose = useCallback(() => {
    setSelectedCron((prev) => ({
      ...prev,
      isEditOpen: false,
    }));
  }, []);

  const handleSave = async (cronExpressionOverride = null) => {
    if (!selectedUsersOffboarding?.length) {
      notifyToast("error", "Please select at least one user");
      return;
    }

    const seen = new Set();
    const mandatoryApplications = [];
    selectedUsersOffboarding.forEach((user) => {
      (user?.vendorAdminCloudId ?? []).forEach((cloudIdStr) => {
        if (!cloudIdStr || typeof cloudIdStr !== "string") return;
        const parts = cloudIdStr.split(":");
        const applicationName = parts[0]?.trim?.() || "";
        const adminCloudId = parts[1]?.trim?.() || null;
        let findInClouds = cloudsList?.find((cloud) => cloud?.id === adminCloudId);
        if (!findInClouds) return;
        if (!applicationName) return;
        const key = `${applicationName}:${adminCloudId || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        mandatoryApplications.push({
          applicationName,
          adminCloudId,
          usubscriptionIds: [],
          groupIds: [],
          roles: [],
          commonName: null,
        });
      });
    });

    const isScheduled = type === "Scheduled";
    const cronToUse = cronExpressionOverride ?? selectedCron?.cronExpression;
    const apiBody = {
      userId: getUserId() || null,
      adminCloudId: null,
      timeZone: "",
      language: "",
      region: "",
      passWord: "",
      workFlowName: "OFFBOARD",
      mandatoryApplications,
      departMentWorkFlows: [],
      providerName: null,
      divisionDetails: [],
      active: true,
      manual: !isScheduled,
      name: flowName || (isScheduled ? "Scheduled Trigger Offboarding" : "Manual Trigger Offboarding"),
      recurring: isScheduled ? (cronToUse?.includes?.("*") ?? false) : false,
    };

    if (isScheduled) {
      if (!cronToUse) {
        notifyToast("error", "Please set schedule (Time and Recurring) for the workflow");
        return;
      }
      apiBody.cronExpression = cronToUse;
    }
    if (type === "Scheduled") {
      apiBody.cronExpression = cronExpressionOverride;
    }

    if (editWorkFlowObject?.id) {
      apiBody.id = editWorkFlowObject.id;
    }

    setIsPageLoading(true);
    const res = await saveOffBoardWorkFlowManual(apiBody);
    if (res?.status === "OK") {
      // if (isScheduled) {
      //   notifyToast("success", "Scheduled offboarding workflow saved successfully");
      //   navigate("/Workflow/Template");
      // } else {
      let response = res?.res;
      let runBody = [];
      selectedUsersOffboarding?.map((user) => {
        let listOfInClouds = user?.vendorAdminCloudId?.map((cloudId) => {
          let findInClouds = cloudsList?.find((cloud) => cloud?.id === cloudId?.split(":")[1]);
          if (!findInClouds) return;
          return {
            applicationName: cloudId?.split(":")[0],
            adminCloudId: cloudId?.split(":")[1],
          };
        });
        listOfInClouds = listOfInClouds?.filter((cloud) => cloud?.adminCloudId);
        if (type === "Manual") {
          runBody.push({ ...response, primaryEmail: user?.email, adminCloudId: listOfInClouds[0]?.adminCloudId });
        } else {
          runBody.push({ ...response, primaryEmail: user?.email, adminCloudId: listOfInClouds[0]?.adminCloudId, cronExpression: cronExpressionOverride });
        }
      });
      let runRes = await manualTriggerWorkflow(runBody);
      if (runRes?.status === "OK") {
        notifyToast("success", "Offboarding workflow started successfully");
        navigate("/Workflow/Template");
      } else {
        notifyToast("error", runRes?.message || "Failed to run offboarding workflow");
      }
      // }
    } else {
      notifyToast("error", res?.message || "Failed to save offboarding workflow");
    }
    setIsPageLoading(false);
  };

  const handleCronSave = (cronExpression) => {
    setSelectedCron((prev) => ({
      ...prev,
      cronExpression,
      isEditOpen: false,
    }));
    handleSave(cronExpression);
  };

  const getConfigurations = async (applicationName, adminCloudId) => {
    let res = await getSaaSRolesForApplication(applicationName, null, adminCloudId);
    if (res?.status === "OK") {
      setActionsList({
        titles: res?.res[0]?.titles,
        locations: res?.res[0]?.locations,
        divisions: res?.res[0]?.divisions,
      });
    }
  };

  useEffect(() => {
    if (cloudsList?.length > 0) {
      let app = cloudsList?.find((cloud) => cloud?.primaryApp);
      if (app) {
        setFlowActionsList({
          [ACTION_TYPES.TRIGGER]: {
            currentApplication: app,
            action: ACTION_TYPES.TRIGGER,
          },
          [ACTION_TYPES.PRIMARY_APPLICATION]: [
            {
              currentApplication: app,
            },
          ],
          [ACTION_TYPES.IF_ELSE]: {},
        });
        getConfigurations(app?.providerName, app?.id);
      } else {
        setActionsList({
          titles: [],
          locations: [],
          divisions: [],
        });
      }
    }
  }, [cloudsList]);


  useEffect(() => {
    if (workFlowId) {
      fetchWorkFlows();
    }
  }, [workFlowId]);

  useEffect(() => {
    if (templatesList.length === 0) {
      fetchTemplates();
    }
  }, []);

  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === "Escape" && (isSelectUsersOpen)) {
        setIsSelectUsersOpen(false);
      }
    };

    if (isSelectUsersOpen) {
      window.addEventListener("keydown", handleEscapeKey);
    }

    return () => {
      window.removeEventListener("keydown", handleEscapeKey);
    };
  }, [isSelectUsersOpen]);

  const fetchTemplates = async () => {
    setIsTemplatesLoading(true);
    const res = await getTemplatesList();
    if (res?.status === "OK") {
      setTemplatesList(res?.res || []);
    }
    setIsTemplatesLoading(false);
  };


  const fetchWorkFlows = async () => {
    setIsPageLoading(true);
    let res = await getWorkFlows();
    if (res?.status === "OK") {
      res?.res?.offBoardWorkFlowList?.map((data) => {
        if (data?.id === workFlowId) {

          setEditWorkFlowObject(data);
        }
      });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (editWorkFlowObject?.id) {
      makeUIForEditWorkFlow();
    }
  }, [editWorkFlowObject]);


  const makeUIForEditWorkFlow = () => {
    setApprovalEmail(editWorkFlowObject?.approvalEmail);
    setGoogleWorkSpaceDataTransferEmail({
      email: editWorkFlowObject?.transferEmail,
      vendorAdminCloudId: ["GOOGLE_WORKSPACE:" + editWorkFlowObject?.saasUserId],
    });
    if (editWorkFlowObject?.cronExpression) {
      setSelectedCron((prev) => ({
        ...prev,
        cronExpression: editWorkFlowObject.cronExpression,
      }));
    }
  }


  const handleSaveApplicationEditObject = async (e, action) => {

  };

  const onSaveButtonClick = () => {
    if (type === "Scheduled") {
      if (!selectedUsersOffboarding?.length) {
        notifyToast("error", "Please select at least one user");
        return;
      }
      setSelectedCron((prev) => ({ ...prev, isEditOpen: true }));
    } else {
      handleSave();
    }
  };

  const handleEditObject = (e, cloudInfo, index, action = "DELETE") => {
    if (action === "DELETE") {
      let shallowUsers = [...selectedUsersOffboarding];
      if (cloudInfo) {
        let fndUser = shallowUsers[index];
        fndUser.vendorAdminCloudId = fndUser.vendorAdminCloudId.filter((cloud) => cloud !== cloudInfo);
        shallowUsers[index] = fndUser;
        setSelectedUsersOffboarding(shallowUsers);
      } else {
        shallowUsers.splice(index, 1);
        setSelectedUsersOffboarding(shallowUsers);
      }
    }
  }

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Workflow" />
        <div className="cf_main_content_place">
          <TopNav
            pageName={type === "Manual" ? "Manual Offboarding Workflow" : "Scheduled Offboarding Workflow"}
            backLink="/Workflow/Template"
          />
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{ padding: "10px 0", gap: "15px", position: "relative" }}
          >
            {!isCreateTemplate ? (
              <div
                className="cf_newFlow_canvas_newFlowV3"
                onWheel={onWheelZoom}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={stopDrag}
                onMouseLeave={stopDrag}
                style={{
                  width:
                    selectedCron?.isEditOpen ? "60%" :
                      isSelectUsersOpen
                        ? "calc(100% - 30%)"
                        : "100%",
                  cursor: isDragging.current ? "grabbing" : "grab",
                }}
              >
                <div
                  className="CF_d-flex cf_newFlow_canvas_action"
                  ref={innerRef}
                  style={{
                    willChange: "transform",
                    justifyContent: "center",
                    flexDirection: "column",
                    alignItems: "center",
                    marginTop: "30px",
                    transform: `translate(${position.current.x}px, ${position.current.y}px) scale(${scale})`,
                    transformOrigin: "0 0",
                    transition: isDragging.current ? "none" : "transform 0.1s",
                    userSelect: "none",
                  }}
                >
                  <div className="cf_newFlow_trigger_pannel">
                    <div className="cf_newFlow_trigger_pannel_header">
                      <div className="cf_newFlow_trigger_pannel_header_icon">
                        <Workflow size={18} />
                      </div>
                      {isWorkflowNameEditable ? (
                        <div style={{ width: "calc(100% - 100px)" }}>
                          <TextInputUpdate
                            defaultVal={flowName ? flowName : type === "Manual" ? "Manual Trigger Offboarding" : "Scheduled Trigger Offboarding"}
                            inputWidth="220px"
                            inputHeight="40px"
                            customActionStyles={{ top: "45px" }}
                            closeAction={() => setIsWorkflowNameEditable(false)}
                            saveAction={(value) => {
                              setFlowName(value);
                              setIsWorkflowNameEditable(false);
                            }}
                          />
                        </div>
                      ) : (
                        <p
                          className="cf_newFlow_trigger_pannel_header_name"
                          onClick={() => setIsWorkflowNameEditable(true)}
                          style={{ cursor: "pointer", fontSize: "12px" }}
                        >
                          {flowName ? flowName : type === "Manual" ? "Manual Trigger Offboarding" : "Scheduled Trigger Offboarding"}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* {type === "Scheduled" && (
                    <ActionPanel
                      action={{}}
                      onEdit={() => {
                        setIsSelectUsersOpen(false);
                        setSelectedCron((prev) => ({ ...prev, isEditOpen: true }));
                      }}
                      borderColor="#0062ff"
                      backgroundColor="rgb(178 199 255 / 14%)"
                      icon={
                        <div className="cf_newFlow_trigger_pannel_header_icon"><CalendarClock size={18} /></div>
                      }
                      title={selectedCron?.cronExpression ? getCronDescription(selectedCron.cronExpression) : "Select Time and Recurring"}
                      subtitle=""
                    />
                  )} */}
                  {selectedUsersOffboarding?.length > 0 ? <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                    <div
                      className="cf_department_based_action_container_dottedLine_role"
                      style={{
                        width: `calc(100% - ${calculateWidth("DIVISION", scale)}px)`,
                      }}
                    />
                    {
                      selectedUsersOffboarding?.map((user, masterIndex) => (
                        <div
                          key={`${user?.email}_level`}
                          className={`CF_d-flex current_division_${masterIndex + 1}`}
                          id={`cf_roleLevel_container_DIVISION_${masterIndex}`}
                          style={{
                            flexDirection: "column",
                            justifyContent: "center",
                            alignItems: "center",
                            position: "relative",
                          }}
                        >
                          <ActionPanel action={user}
                            borderColor="#0062ff"
                            backgroundColor="rgb(178 199 255 / 14%)"
                            icon={
                              <div className="cf_newFlow_trigger_pannel_header_icon"><User /></div>
                            }
                            onDelete={() => handleEditObject(user, null, masterIndex, "DELETE")}
                            title={user?.email}
                            subtitle={approvalEmail ? approvalEmail : ""}
                          />
                          {
                            user?.vendorAdminCloudId?.map((cloudId, index) => {
                              let findInClouds = cloudsList?.find((cloud) => cloud?.id === cloudId?.split(":")[1]);
                              if (!findInClouds) return;
                              return (
                                <WorkFlowRenderAppications disableEdit={true} type="OFFBOARD" appData={{
                                  currentApplication: {
                                    providerName: cloudId?.split(":")[0],
                                    id: cloudId?.split(":")[1],
                                    adminCloudId: cloudId?.split(":")[1],
                                    adminEmail: findInClouds?.adminEmail
                                  }
                                }} handleDeleteObject={(e) => handleEditObject(e, cloudId, masterIndex, "DELETE")} />
                              )
                            })
                          }
                        </div>
                      ))
                    }
                    <WorkFlowAddAction
                      handleDrop={(e) => {
                        handleDrop(e, {
                          action: "SELECT_USER",
                          for: "WORKFLOW",
                        })
                      }}
                      addAction={() => {
                        setIsSelectUsersOpen(true);
                      }}
                      isWaitingForDragging={waitingForDragging}
                      customClass="cf_action_trigger_for_department"
                    />
                  </div> : ""}
                  {
                    selectedUsersOffboarding?.length === 0 ? (
                      <WorkFlowAddAction
                        handleDrop={(e) => {
                          handleDrop(e, {
                            action: "SELECT_USER",
                            for: "WORKFLOW",
                          })
                        }}
                        addAction={() => {
                          setIsSelectUsersOpen(true);
                        }}
                        isWaitingForDragging={waitingForDragging}
                      />
                    ) : ""}

                </div>
                <div
                  className="cf_zoom_percentage_container"
                  style={{
                    top: "20px",
                    right:
                      selectedCron?.isEditOpen ? "calc( 40% + 20px )" :
                        isSelectUsersOpen
                          ? "calc( 30% + 20px )"
                          : "10px",
                  }}
                >
                  <ActionButton
                    buttonType="button"
                    customClass="changeButtonColorOnHover cf_newBox_Shadow"
                    customStyles={{
                      backgroundColor: "#fff",
                      height: "35px",
                      width: "80px",
                    }}
                    buttonClickAction={onSaveButtonClick}
                  >
                    <p>Save</p>
                  </ActionButton>
                </div>
                <div
                  className="cf_newBox_Shadow cf_zoom_percentage_container"
                  style={{
                    right:
                      selectedCron?.isEditOpen ? "calc( 40% + 20px )" :
                        isSelectUsersOpen
                          ? "calc( 30% + 20px )"
                          : "10px",
                  }}
                >
                  <div className="cf_zoom_percentage_container_inner">
                    <div className="cf_newBox_Shadow cf_canvas_zoom_options">
                      <div
                        className="cf_canvas_zoom_options_icon_container"
                        onClick={() => {
                          resetZoom();
                        }}
                      >
                        <p>Fit To Canvas</p>
                        <div className="cf_canvas_zoom_options_icon">
                          <Maximize strokeWidth={3} size={12} />
                        </div>
                      </div>
                      <div
                        className="cf_canvas_zoom_options_icon_container"
                        onClick={zoomOut}
                      >
                        <p>Zoom Out</p>
                        <div className="cf_canvas_zoom_options_icon">
                          <Minus strokeWidth={3} size={12} />
                        </div>
                      </div>
                      <div
                        className="cf_canvas_zoom_options_icon_container"
                        onClick={zoomIn}
                      >
                        <p>Zoom In</p>
                        <div className="cf_canvas_zoom_options_icon">
                          <Plus strokeWidth={3} size={12} />
                        </div>
                      </div>
                    </div>
                    <p style={{ fontSize: "12px", fontWeight: "500" }}>
                      {Math.abs((scale / 1) * 100).toFixed(0)}%
                    </p>
                    <span style={{ marginLeft: "auto" }}></span>
                    <ChevronUp size={12} />
                  </div>
                </div>
              </div>
            ) : (
              ""
            )}
            {selectedCron?.isEditOpen && (
              <div
                key={`cron-builder-${selectedCron?.isEditOpen}`}
                style={{
                  width: "40%",
                  height: "100%",
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
                className="cf_box_shadow"
              >
                <CronExpressionBuilder
                  defaultValue={selectedCron?.cronExpression}
                  onClose={handleCronClose}
                  onSave={handleCronSave}
                  isOnlyOnce={true}
                />
              </div>
            )}
            {isSelectUsersOpen && <SelectOffBoardUsers onClose={() => setIsSelectUsersOpen(false)}
              selectedUsersOffboarding={selectedUsersOffboarding}
              setSelectedUsersOffboarding={setSelectedUsersOffboarding} />}
          </div>
        </div>
      </div>

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default ManualOrGroupTriggerOffboarding;
