import {
  Ban,
  ChevronUp,
  CircleCheckBig,
  CircleX,
  GitFork,
  Mail,
  Maximize,
  Minus,
  Plus,
  UserMinus,
  Workflow
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import { getSaaSRolesForApplication } from "../../SaaSManagement/SaaSActions/SaaSActions";
import {
  getTemplatesList,
  getWorkFlows,
  saveOffBoardWorkFlow
} from "../../UserManagement/UserManagementActions/UserManagementActions";
import ActionPanel from "../components/ActionPanel";
import { ACTION_TYPES } from "../constants/workflowConstants";
import "../css/NewFlow.css";
import CustomTemplateActionPannel from "../CustomeTemplate/CustomTemplateActionPannel";
import { useCanvasZoom } from "../hooks/useCanvasZoom";
import { useTemplateState } from "../hooks/useTemplateState";
import { calculateWidth } from "../utils/workflowUtils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { notifyToast } from "../../../helpers/utils";
const OffBoardingWorkFlow = () => {
  const navigate = useNavigate();
  const [queryParams] = useSearchParams();
  const manualTrigger = queryParams.get("manualTrigger");
  const workFlowId = queryParams.get("workFlowId");
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [flowActionsList, setFlowActionsList] = useState({});
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isTemplatePopupOpen, setIsTemplatePopupOpen] = useState(false);
  const [currentTemplateId, setCurrentTemplateId] = useState(null);
  const [licenseInfoMap, setLicenseInfoMap] = useState({});
  const [selectedApplicationList, setSelectedApplicationList] = useState([]);
  const [editWorkFlowObject, setEditWorkFlowObject] = useState(null);
  const [waitingForDragging, setWaitingForDragging] = useState(null);
  const [isCreateTemplate, setIsCreateTemplate] = useState(false);
  const [templatesList, setTemplatesList] = useState([]);
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);
  const [approvalEmail, setApprovalEmail] = useState(null);
  const [isApprovalEmailOpen, setIsApprovalEmailOpen] = useState(false);
  const [isGoogleWorkspaceDataTransferOpen, setIsGoogleWorkspaceDataTransferOpen] = useState(false);
  const [googleWorkSpaceDataTransferEmail, setGoogleWorkSpaceDataTransferEmail] = useState(null);
  const [actionsList, setActionsList] = useState({
    titles: [],
    locations: [],
    divisions: [],
  });
  const [editObject, setEditObject] = useState(null);
  const templateStateManager = useTemplateState();
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
      if (event.key === "Escape" && (isTemplatePopupOpen || isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen)) {
        setIsTemplatePopupOpen(false);
        setCurrentTemplateId(null);
        setEditObject(null);
        setWaitingForDragging(null);
        setIsApprovalEmailOpen(false);
        setIsGoogleWorkspaceDataTransferOpen(false);
        if (
          currentTemplateId &&
          !currentTemplateId.startsWith("PRIMARY_APPLICATION_")
        ) {
          templateStateManager.setWaitingForDragging(currentTemplateId, null);
          templateStateManager.setCurrentRole(currentTemplateId, null);
          templateStateManager.setCurrentLocation(currentTemplateId, null);
          templateStateManager.setEnableOptionsList(currentTemplateId, []);
        }
      }

      if (event.key === "Escape" && isPopupOpen) {
        setIsPopupOpen(false);
        setWaitingForDragging(null);
        setEditObject(null);
        setWaitingForDragging(null);
      }
    };

    if (isTemplatePopupOpen || isPopupOpen || isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen) {
      window.addEventListener("keydown", handleEscapeKey);
    }

    return () => {
      window.removeEventListener("keydown", handleEscapeKey);
    };
  }, [isTemplatePopupOpen, isPopupOpen, currentTemplateId, isApprovalEmailOpen, isGoogleWorkspaceDataTransferOpen]);

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
  }


  const handleSaveApplicationEditObject = async (e, action) => {

  };

  const handleSave = async () => {
    if (!approvalEmail) {
      notifyToast("error", "Please add an approval email");
      setIsApprovalEmailOpen(true);
      return;
    }
    if (!googleWorkSpaceDataTransferEmail?.email) {
      notifyToast("error", "Please add a Google Workspace data transfer email");
      setIsGoogleWorkspaceDataTransferOpen(true);
      return;
    }

    let apiBody = {
      adminCloudId: flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.id,
      approvalEmail: approvalEmail,
      transferEmail: googleWorkSpaceDataTransferEmail?.email,
      saasUserId: googleWorkSpaceDataTransferEmail?.vendorAdminCloudId[0]?.split(":")[1],
    }

    if (editWorkFlowObject?.id) {
      apiBody.id = editWorkFlowObject?.id;
    }

    let res = await saveOffBoardWorkFlow(apiBody);
    setIsPageLoading(true);
    if (res?.status === "OK") {
      notifyToast("success", "Offboarding workflow saved successfully");
    } else {
      notifyToast("error", "Failed to save offboarding workflow");
    }

    navigate("/Workflow/Template");
    setIsPageLoading(false);

    console.log("apiBody", apiBody);
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Workflow" />
        <div className="cf_main_content_place">
          <TopNav
            pageName={workFlowId ? "View Workflow" : "Create Workflow"}
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
                    isPopupOpen || isTemplatePopupOpen || isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen
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
                      <p className="cf_newFlow_trigger_pannel_header_name">
                        Automated Offboarding Workflow
                      </p>
                    </div>
                  </div>
                  {!!flowActionsList[ACTION_TYPES.TRIGGER] && manualTrigger !== "true" && (
                    <ActionPanel
                      action={flowActionsList[ACTION_TYPES.TRIGGER]}
                      borderColor="#fa8248"
                      backgroundColor="#f9bfa22b"
                      icon={
                        <p style={{ fontSize: "18px", fontWeight: "500" }}>
                          ⚡
                        </p>
                      }
                      title="When User Offboarded in"
                      subtitle={getCloudName(
                        flowActionsList[ACTION_TYPES.TRIGGER]
                          ?.currentApplication?.providerName
                      )}
                    />
                  )}

                  <ActionPanel
                    action={flowActionsList[ACTION_TYPES.TRIGGER]}
                    onEdit={() => {
                      setIsGoogleWorkspaceDataTransferOpen(false);
                      setIsApprovalEmailOpen(true)
                    }}
                    borderColor="#0062ff"
                    backgroundColor="rgb(178 199 255 / 14%)"
                    icon={
                      <div className="cf_newFlow_trigger_pannel_header_icon"><Mail /></div>
                    }
                    title="Approval Email"
                    subtitle={approvalEmail ? approvalEmail : ""}
                  />

                  <ActionPanel
                    action={flowActionsList[ACTION_TYPES.IF_ELSE]}
                    borderColor="rgb(255 0 0)"
                    backgroundColor="rgb(255 231 231 / 43%)"
                    icon={
                      <GitFork
                        size={22}
                        style={{ transform: "rotate(180deg)" }}
                      />
                    }
                    title="If Else Conditions"
                    subtitle="Route based on division"
                    isRhombus={true}
                  />
                  <div
                    className="CF_d-flex"
                    style={{
                      marginTop: flowActionsList[ACTION_TYPES.IF_ELSE]
                        ? "25px"
                        : "0px",
                    }}
                  >
                    <div className="cf_department_based_action_container cf_action_trigger_dottedParent" style={{ gap: "120px" }}>
                      <div
                        className="cf_department_based_action_container_dottedLine_role"
                        style={{
                          width: `421px`,
                          left: "149px"
                        }}
                      ></div>
                      <div
                        key={"DIVISION"}
                        className="CF_d-flex"
                        id={`cf_roleLevel_container_DIVISION_0`}
                        style={{
                          flexDirection: "column",
                          justifyContent: "center",
                          alignItems: "center",
                          position: "relative",
                        }}
                      >
                        <ActionPanel
                          action={"Division Not Met"}
                          borderColor="#16a34a"
                          backgroundColor="rgb(21 128 61 / 14%)"
                          icon={
                            <div className="cf_newFlow_trigger_pannel_header_icon">
                              <CircleCheckBig />

                            </div>
                          }
                          title="Request Approved"
                        />
                        {
                          cloudsList?.find(cloud => cloud?.providerName === "GOOGLE_WORKSPACE") && (
                            <ActionPanel
                              action={flowActionsList[ACTION_TYPES.TRIGGER]}
                              onEdit={() => {
                                setIsApprovalEmailOpen(false);
                                setIsGoogleWorkspaceDataTransferOpen(true)
                              }}
                              borderColor="#0062ff"
                              backgroundColor="rgb(178 199 255 / 14%)"
                              imageSrc={cloudImageMapper(
                                "GOOGLE_WORKSPACE"
                              )}
                              title="Transfer Google Workspace Data To"
                              subtitle={googleWorkSpaceDataTransferEmail ? googleWorkSpaceDataTransferEmail?.email : ""} />)
                        }
                        <ActionPanel
                          action={"Division Not Met"}
                          borderColor="#ff9f1c"
                          backgroundColor="rgb(255 159 28 / 14%)"
                          icon={
                            <div className="cf_newFlow_trigger_pannel_header_icon">
                              <UserMinus />

                            </div>
                          }
                          title="Start User Deprovisioning From Application"
                        />
                      </div>
                      <div
                        key={"DIVISION"}
                        className="CF_d-flex"
                        id={`cf_roleLevel_container_DIVISION_0`}
                        style={{
                          flexDirection: "column",
                          justifyContent: "center",
                          alignItems: "center",
                          position: "relative",
                        }}
                      >
                        <ActionPanel
                          action={"Division Not Met"}
                          borderColor="#ef4343e6"
                          backgroundColor="rgb(239 67 67 / 10%)"
                          icon={
                            <div className="cf_newFlow_trigger_pannel_header_icon">
                              <CircleX />

                            </div>
                          }
                          title="Request Rejected"
                        />
                        <ActionPanel
                          action={"Division Not Met"}
                          borderColor="#ef4343e6"
                          icon={
                            <div className="cf_newFlow_trigger_pannel_header_icon">
                              <Ban />

                            </div>
                          }
                          backgroundColor="rgb(239 67 67 / 10%)"
                          title="End Of User Deprovisioning"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="cf_zoom_percentage_container"
                  style={{
                    top: "20px",
                    right:
                      isPopupOpen || isTemplatePopupOpen || isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen
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
                    buttonClickAction={handleSave}
                  >
                    <p>Save</p>
                  </ActionButton>
                </div>
                <div
                  className="cf_newBox_Shadow cf_zoom_percentage_container"
                  style={{
                    right:
                      isPopupOpen || isTemplatePopupOpen || isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen
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
            {(isTemplatePopupOpen && currentTemplateId) || (isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen) && (
              <CustomTemplateActionPannel
                isGoogleWorkspaceDataTransferOpen={isGoogleWorkspaceDataTransferOpen}
                setIsGoogleWorkspaceDataTransferOpen={setIsGoogleWorkspaceDataTransferOpen}
                googleWorkSpaceDataTransferEmail={googleWorkSpaceDataTransferEmail}
                setGoogleWorkSpaceDataTransferEmail={setGoogleWorkSpaceDataTransferEmail}
                isApprovalEmailOpen={isApprovalEmailOpen}
                setIsApprovalEmailOpen={setIsApprovalEmailOpen}
                approvalEmail={approvalEmail}
                setApprovalEmail={setApprovalEmail}
                licenseInfoMap={licenseInfoMap}
                setLicenseInfoMap={setLicenseInfoMap}
                isPopupOpen={isTemplatePopupOpen}
                workFlowJSON={
                  editObject?.type === "PRIMARY_APPLICATION" ||
                    currentTemplateId === "PRIMARY_APPLICATION_ADD"
                    ? {}
                    : templateStateManager.getWorkFlowJSON(currentTemplateId) ||
                    {}
                }
                setIsPopupOpen={setIsTemplatePopupOpen}
                currentRole={
                  editObject?.type === "PRIMARY_APPLICATION" ||
                    currentTemplateId === "PRIMARY_APPLICATION_ADD"
                    ? null
                    : templateStateManager.getCurrentRole(currentTemplateId)
                }
                enableOptionsList={["DEPARTMENT_BASED_ACTION"]}
                currentLocation={
                  editObject?.type === "PRIMARY_APPLICATION" ||
                    currentTemplateId === "PRIMARY_APPLICATION_ADD"
                    ? null
                    : templateStateManager.getCurrentLocation(currentTemplateId)
                }
                selectedApplicationList={
                  editObject?.type === "PRIMARY_APPLICATION" ||
                    currentTemplateId === "PRIMARY_APPLICATION_ADD"
                    ? selectedApplicationList
                    : templateStateManager.getSelectedApplicationList(
                      currentTemplateId
                    )
                }
                actionsList={actionsList}
                editObject={editObject}
                handleSaveApplicationEditObject={
                  handleSaveApplicationEditObject
                }
                initialElement={
                  currentTemplateId === "PRIMARY_APPLICATION_ADD" && !editObject
                    ? "ONBOARD_TO_APPLICATIONS"
                    : null
                }
              />
            )}

          </div>
        </div>
      </div>

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default OffBoardingWorkFlow;
