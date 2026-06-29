import {
  CalendarClock,
  ChevronUp,
  Clock,
  Maximize,
  Minus,
  Plus,
  TriangleAlert,
  X
} from "lucide-react";
import { useContext, useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import CronExpressionBuilder from "../../Resuables/CronExpressionBuilder/CronExpressionBuilder";
import { getCronDescription } from "../../Resuables/CronExpressionBuilder/cronUtils";
import { getSaaSRolesForApplication } from "../SaaSManagement/SaaSActions/SaaSActions";
import {
  getTemplatesList,
  getWorkFlows,
  saveNewWorkFlow
} from "../UserManagement/UserManagementActions/UserManagementActions";
import ActionPanel from "./components/ActionPanel";
import { ACTION_TYPES, WAITING_STATES } from "./constants/workflowConstants";
import "./css/NewFlow.css";
import CustomTemplateActionPannel from "./CustomeTemplate/CustomTemplateActionPannel";
import { useCanvasZoom } from "./hooks/useCanvasZoom";
import { useTemplateState } from "./hooks/useTemplateState";
import NewFlowActionPannelV2 from "./NewFlowActionPannelV2";
import {
  handleDropAction,
  makeApplicationsBody,
  parseDropData
} from "./utils/workflowUtils";
import TextInputUpdate from "../../Resuables/InputsComponents/TextInputUpdate";
import { notifyToast } from "../../helpers/utils";
const ScheduledTrigger = () => {
  const navigate = useNavigate();
  const [queryParams] = useSearchParams();
  const manualTrigger = queryParams.get("manualTrigger");
  const workFlowId = queryParams.get("workFlowId");
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [popupAcionsList, setPopupAcionsList] = useState([]);
  const [flowActionsList, setFlowActionsList] = useState({});
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isTemplatePopupOpen, setIsTemplatePopupOpen] = useState(false);
  const [currentTemplateId, setCurrentTemplateId] = useState(null);
  const [licenseInfoMap, setLicenseInfoMap] = useState({});
  const [departmentList, setDepartmentList] = useState([]);
  const [departMentMap, setDepartMentMap] = useState({});
  const [departMentAppMap, setDepartMentAppMap] = useState({});
  const [currentDepartment, setCurrentDepartment] = useState(null);
  const [selectedApplicationList, setSelectedApplicationList] = useState([]);
  const [editWorkFlowObject, setEditWorkFlowObject] = useState(null);
  const [editedAction, setEditedAction] = useState(null);
  const [waitingForDragging, setWaitingForDragging] = useState(null);
  const [selectedTemplates, setSelectedTemplates] = useState([]);
  const [isCreateTemplate, setIsCreateTemplate] = useState(false);
  const [
    selectedApplicaionsBasedOnDepartment,
    setSelectedApplicaionsBasedOnDepartment,
  ] = useState({});
  const [templatesList, setTemplatesList] = useState([]);
  const [listOfToBeUpdatedTemplates, setListOfToBeUpdatedTemplates] = useState(
    []
  );
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);
  const [divisionsList, setDivisionsList] = useState([]);
  const [divisionTemplatesMap, setDivisionTemplatesMap] = useState({});
  const [currentDivision, setCurrentDivision] = useState(null);
  const [actionsList, setActionsList] = useState({
    titles: [],
    locations: [],
    divisions: [],
  });
  const [editObject, setEditObject] = useState(null);
  const templateStateManager = useTemplateState();
  const [flowName, setFlowName] = useState("Scheduled Workflow");
  const [isWorkflowNameEditable, setIsWorkflowNameEditable] = useState(false);
  const [deletedApplications, setDeletedApplications] = useState([]);
  const [apiBody, setApiBody] = useState({
    userId: "",
    adminCloudId: "",
    timeZone: "",
    language: "",
    region: "",
    passWord: "",
    workFlowName: "ONBOARD",
    mandatoryApplications: [],
    departMentWorkFlows: [],
  });
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
  });
  const [primaryGroup, setPrimaryGroup] = useState(null);

  const handleCronClose = useCallback(() => {
    setSelectedCron((prev) => ({
      ...prev,
      isEditOpen: false,
    }));
  }, []);

  const openCronPopup = () => {
    setIsPopupOpen(false);
    setWaitingForDragging(false);
    setIsTemplatePopupOpen(false);
    setSelectedCron((prev) => ({ ...prev, isEditOpen: true }));
    return;
  }

  const handleSaveWorkFlow = useCallback(async (cronExpress = selectedCron?.cronExpression) => {

    let manditoryApplications = makeApplicationsBody(flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]);
    let groupName = primaryGroup?.group?.groupName;
    let groupId = primaryGroup?.group?.groupId;
    let cronExpression = cronExpress || selectedCron?.cronExpression;
    let adminCloudId = primaryGroup?.currentApplication?.id;
    let providerName = primaryGroup?.currentApplication?.providerName;
    let apiBody = {
      mandatoryApplications: manditoryApplications,
      groupName: groupName,
      groupId: groupId,
      cronExpression: cronExpression,
      adminCloudId: adminCloudId,
      providerName: providerName,
      name: flowName,
      workFlowName: "GROUP_SHEDULING",
      divisionDetails: [],
      departMentWorkFlows: [],
      manual: false,
      delete: false,
      active: true,
      recurring: cronExpression?.includes("*"),
    };

    if (workFlowId) {
      apiBody.id = workFlowId;
    }

    setIsPageLoading(true);
    let res = await saveNewWorkFlow(apiBody);
    if (res?.status === "OK") {
      notifyToast("success", "Scheduled Workflow Created successfully");
      navigate("/Workflow/Template");
      setIsPageLoading(false);
    } else {
      notifyToast("error", res?.res);
      setIsPageLoading(false);
    }
  }, [flowActionsList, selectedCron, primaryGroup, workFlowId, flowName]);

  const handleCronSave = useCallback((cronExpression) => {
    handleSaveWorkFlow(cronExpression, "cron");
  }, [handleSaveWorkFlow]);

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
    setFlowActionsList({
      ...flowActionsList,
      [ACTION_TYPES.TRIGGER]: {
        currentApplication: {
          id: "123",
        },
      },
    });
  }, []);

  useEffect(() => {
    if (cloudsList?.length > 0) {
      let app = cloudsList?.find((cloud) => cloud?.primaryApp);
      if (app) {
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


  const handleDrop = (e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("json");
    setWaitingForDragging(null);
    setIsPopupOpen(false);
    setIsTemplatePopupOpen(false);
    setCurrentTemplateId(null);
    const jsonData = parseDropData(data);
    if (jsonData) {
      if (jsonData?.action === ACTION_TYPES.SELECT_GROUP) {
        setPrimaryGroup(jsonData);
      } else if (
        currentTemplateId === "PRIMARY_APPLICATION_ADD" &&
        jsonData?.action === "ONBOARD_TO_APPLICATIONS"
      ) {
        handleAddToFlow(jsonData, ACTION_TYPES.PRIMARY_APPLICATION);
      } else {
        handleDropAction(jsonData, handleAddToFlow);
      }
    }
  };


  const handleAddToFlow = (res, action) => {
    if (departmentList.includes(action)) {
      const cpyDepartmentAppMap = departMentAppMap[action] || [];
      cpyDepartmentAppMap.push(res);
      setDepartMentAppMap({
        ...departMentAppMap,
        [action]: cpyDepartmentAppMap,
      });
      setSelectedApplicaionsBasedOnDepartment({
        ...selectedApplicaionsBasedOnDepartment,
        [action]: [
          ...(selectedApplicaionsBasedOnDepartment[action] || []),
          res?.currentApplication?.providerName,
        ],
      });
    } else if (action === ACTION_TYPES.PRIMARY_APPLICATION) {
      if (res?.currentApplication?.id) {
        setSelectedApplicationList([
          ...selectedApplicationList,
          res?.currentApplication?.providerName,
        ]);
      }
      setFlowActionsList({
        ...flowActionsList,
        [ACTION_TYPES.PRIMARY_APPLICATION]: [
          ...(flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION] || []),
          res,
        ],
      });
    } else {
      if (res?.currentApplication?.id) {
        setSelectedApplicationList([
          ...selectedApplicationList,
          res?.currentApplication?.providerName,
        ]);
      }
      setFlowActionsList({
        ...flowActionsList,
        [action]: res,
      });
    }
  };

  useEffect(() => {
    if (workFlowId) {
      fetchWorkFlows();
      // Read deletedApplications from localStorage
      const storedDeletedApps = localStorage.getItem(`deletedApplications_${workFlowId}`);
      if (storedDeletedApps) {
        try {
          const parsedApps = JSON.parse(storedDeletedApps);
          setDeletedApplications(parsedApps);
        } catch (error) {
          console.error("Error parsing deletedApplications from localStorage:", error);
        }
      }
    }
    // Cleanup: clear localStorage on unmount
    return () => {
      if (workFlowId) {
        localStorage.removeItem(`deletedApplications_${workFlowId}`);
      }
    };
  }, [workFlowId]);

  useEffect(() => {
    if (templatesList.length === 0) {
      fetchTemplates();
    }
  }, []);

  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === "Escape" && isTemplatePopupOpen) {
        setIsTemplatePopupOpen(false);
        setCurrentTemplateId(null);
        setEditObject(null);
        setWaitingForDragging(null);
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

    if (isTemplatePopupOpen || isPopupOpen) {
      window.addEventListener("keydown", handleEscapeKey);
    }

    return () => {
      window.removeEventListener("keydown", handleEscapeKey);
    };
  }, [isTemplatePopupOpen, isPopupOpen, currentTemplateId]);

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
      res?.res?.onBoardWorkFlowList?.map((data) => {
        if (data?.id === workFlowId) {
          if (data?.departMentWorkFlows?.length > 0) {
            data.divisionDetails.push({
              divisionName: "Division Not Met",
              conditionalWorkFlows: data.departMentWorkFlows,
            });
          }
          setEditWorkFlowObject(data);
        }
      });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (editWorkFlowObject?.id && cloudsList?.length > 0) {
      makeUIForEdit();
    }
  }, [editWorkFlowObject, cloudsList]);

  const makeUIForEdit = () => {
    // Set flow name
    if (editWorkFlowObject?.name) {
      setFlowName(editWorkFlowObject.name);
    }

    // Set cron expression
    if (editWorkFlowObject?.cronExpression) {
      setSelectedCron((prev) => ({
        ...prev,
        cronExpression: editWorkFlowObject.cronExpression,
      }));
    }

    // Set primary group
    if (editWorkFlowObject?.groupId && editWorkFlowObject?.adminCloudId) {
      const currentApplication = cloudsList?.find(
        (cloud) => cloud?.id === editWorkFlowObject?.adminCloudId
      );

      if (currentApplication) {
        const groupData = {
          action: ACTION_TYPES.SELECT_GROUP,
          group: {
            groupName: editWorkFlowObject?.groupName,
            groupId: editWorkFlowObject?.groupId,
          },
          currentApplication: currentApplication,
          licenses: editWorkFlowObject?.uSubscriptionIds || [],
        };
        setPrimaryGroup(groupData);
        setFlowActionsList((prev) => ({
          ...prev,
          [ACTION_TYPES.SELECT_GROUP]: groupData,
        }));
      }
    }

    // Set primary applications
    if (editWorkFlowObject?.mandatoryApplications?.length > 0) {
      const primaryApplications = [];
      const selectedApps = [];

      editWorkFlowObject.mandatoryApplications.forEach((data) => {
        let cpyData = { ...data };
        delete cpyData.usubscriptionIds;
        delete cpyData.groupIds;
        delete cpyData.roles;

        const cloudMapper = {
          currentApplication: {
            ...cpyData,
            providerName: data?.applicationName,
            id: data?.adminCloudId || data?.id,
          },
          LICENSES: data?.usubscriptionIds || [],
          deleted: data?.deleted || false,
          GROUPS: data?.groupIds || [],
          usubscriptionIds: data?.uSubscriptionIds || [],
          roles: data?.roles || [],
          commonName: data?.commonName,
        };

        primaryApplications.push(cloudMapper);
        if (data?.applicationName) {
          selectedApps.push(data.applicationName);
        }
      });

      setFlowActionsList((prev) => ({
        ...prev,
        [ACTION_TYPES.PRIMARY_APPLICATION]: primaryApplications,
      }));
      setSelectedApplicationList(selectedApps);
    }
  };

  const handleEditObject = (e) => {
    if (e.type === "PRIMARY_APPLICATION") {
      const transformedEditObject = {
        application: {
          currentApplication: {
            ...e.currentApplication,
            adminCloudId:
              e.currentApplication?.adminCloudId || e.currentApplication?.id,
          },
          LICENSES: e.LICENSES || [],
          deleted: e?.deleted || false,
          GROUPS: e.GROUPS || [],
          roles: e.roles || [],
          commonName: e.commonName,
          adminCloudId: e.currentApplication?.id,
        },
        type: "PRIMARY_APPLICATION",
        originalData: e,
      };
      setEditObject(transformedEditObject);
      setIsPopupOpen(false);
      setWaitingForDragging(null);
      setIsTemplatePopupOpen(true);
      setCurrentTemplateId("PRIMARY_APPLICATION_" + e.currentApplication?.id);
    } else {
      setIsPopupOpen(false);
      setWaitingForDragging(null);
      setEditObject(e);
      setIsTemplatePopupOpen(true);
      setCurrentTemplateId("" + new Date().getTime());
    }
  };

  const addAction = (type) => {
    setEditObject(null);
    if (type === "DEPT_APP_SELECT" || manualTrigger === "true") {
      setIsPopupOpen(false);
      setIsTemplatePopupOpen(true);
      setCurrentTemplateId("PRIMARY_APPLICATION_ADD");
      setPopupAcionsList([ACTION_TYPES.ONBOARD_TO_APPLICATIONS]);
    } else if (type === "GLOBAL") {
      setCurrentDepartment(null);
      setCurrentDivision(null);
      setIsPopupOpen(true);
      setIsTemplatePopupOpen(false);

      if (primaryGroup) {
        setPopupAcionsList(["ONBOARD_TO_APPLICATIONS"]);
      } else {
        setPopupAcionsList(["SELECT_GROUP"]);
      }
    }
  };

  const handleSaveApplicationEditObject = async (e, action) => {
    if (action === "DELETE") {
      // return;
    }

    if (e?.type === "PRIMARY_APPLICATION") {
      const updatedApplication = {
        currentApplication: e?.application?.currentApplication,
        LICENSES: e?.application?.LICENSES || [],
        deleted: e?.application?.deleted || false,
        GROUPS: e?.application?.GROUPS || [],
        roles: e?.application?.roles || [],
        commonName: e?.application?.commonName,
      };

      const cpyFlowActionsList = { ...flowActionsList };
      const primaryApps =
        cpyFlowActionsList[ACTION_TYPES.PRIMARY_APPLICATION] || [];
      const updatedPrimaryApps = primaryApps.map((app) => {
        if (
          app?.currentApplication?.id === e?.application?.currentApplication?.id
        ) {
          return updatedApplication;
        }
        return app;
      });
      cpyFlowActionsList[ACTION_TYPES.PRIMARY_APPLICATION] = updatedPrimaryApps;
      setFlowActionsList(cpyFlowActionsList);

      setIsTemplatePopupOpen(false);
      setCurrentTemplateId(null);
      setEditObject(null);
      return;
    }

    let cpyEditObject = { ...editWorkFlowObject };

    let divDetails = cpyEditObject?.divisionDetails || [];

    let currentConditionalVal = null;

    divDetails = divDetails.map((data) => {
      const updatedConditionalWorkFlows = data?.conditionalWorkFlows?.map(
        (wfl) => {
          let isCondFlowUpdated = false;
          let updatedWfl = { ...wfl };

          if (action === "DELETE") {
            updatedWfl.workFlowApplications = wfl?.workFlowApplications?.filter(
              (app) => {
                if (e.type === "LOCATION") {
                  if (wfl?.conditionValue === e?.department) {
                    return app?.location !== e?.location;
                  }
                  return true;
                } else if (e.type === "ROLE") {
                  if (wfl?.conditionValue === e?.department) {
                    return app?.title !== e?.role;
                  }
                  return true;
                } else {
                  return app?.id !== e?.application?.currentApplication?.id;
                }
              }
            );
          } else {
            updatedWfl.workFlowApplications = wfl?.workFlowApplications?.map(
              (app) => {
                if (app?.id === e?.application?.currentApplication?.id) {
                  isCondFlowUpdated = true;
                  return {
                    ...app,
                    usubscriptionIds:
                      e?.application?.LICENSES?.map((curr) => ({
                        subscriptionName: curr?.planName,
                        subscriptionId: curr?.id,
                      })) || [],
                    groupIds: e?.application?.GROUPS || [],
                    roles: e?.application?.roles || data?.roles,
                    commonName: e?.application?.commonName,
                  };
                }
                return app;
              }
            );
          }

          if (isCondFlowUpdated) {
            currentConditionalVal = updatedWfl;
          }

          return updatedWfl;
        }
      );

      return { ...data, conditionalWorkFlows: updatedConditionalWorkFlows };
    });

    setEditWorkFlowObject({ ...cpyEditObject, divisionDetails: divDetails });

    if (currentConditionalVal) {
      let cpyList = [...listOfToBeUpdatedTemplates];

      if (cpyList?.length > 0) {
        let isFound = false;
        cpyList = cpyList.map((data) => {
          if (data?.id === currentConditionalVal?.id) {
            isFound = true;
            return currentConditionalVal;
          }
          return data;
        });
        if (!isFound) {
          cpyList.push(currentConditionalVal);
        }
        setListOfToBeUpdatedTemplates(cpyList);
      } else {
        setListOfToBeUpdatedTemplates([currentConditionalVal]);
      }
    }

    setIsTemplatePopupOpen(false);
    setCurrentTemplateId(null);
    setEditObject(null);
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
          {deletedApplications && deletedApplications.length > 0 && (
            <div
              style={{
                padding: "10px 15px",
                margin: "0 15px",
                backgroundColor: "#fff3cd",
                border: "1px solid #ffc107",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "10px",
                position: "absolute",
                zIndex: 1000,
                top: "100px",
                right: "100px",
                width: "calc(100vw - 300px)",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                cursor: "pointer",
              }}
            >
              <TriangleAlert size={18} color="#856404" />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ fontSize: "13px", fontWeight: "500", color: "#856404", margin: 0 }}>
                    Deleted Applications Detected In Workflow
                  </p>
                  <X size={18} color="#856404" onClick={() => setDeletedApplications([])} />
                </div>
                <p style={{ fontSize: "12px", color: "#856404", margin: "4px 0 0 0" }}>
                  {deletedApplications.map(app => getCloudName(app?.name) || app?.id).join(", ")}
                </p>
              </div>
            </div>
          )}
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
                      isPopupOpen || isTemplatePopupOpen
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
                        <Clock size={18} />
                      </div>
                      {isWorkflowNameEditable ? (
                        <div style={{ width: "calc(100% - 100px)" }}>
                          <TextInputUpdate
                            defaultVal={flowName}
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
                          style={{ cursor: "pointer", fontSize: "14px" }}
                        >
                          {flowName || "Scheduled Workflow"}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* <ActionPanel
                    action={flowActionsList[ACTION_TYPES.TRIGGER]}
                    onEdit={() => {
                      setIsPopupOpen(false);
                      setWaitingForDragging(false);
                      setIsTemplatePopupOpen(false);
                      setSelectedCron((prev) => ({ ...prev, isEditOpen: true }));
                    }}
                    borderColor="#0062ff"
                    backgroundColor="rgb(178 199 255 / 14%)"
                    icon={
                      <div className="cf_newFlow_trigger_pannel_header_icon"><CalendarClock size={18} /></div>
                    }
                    title={selectedCron?.cronExpression ? getCronDescription(selectedCron.cronExpression) : "Select Time and Recurring"}
                    subtitle={""}
                  /> */}

                  {primaryGroup && (
                    <ActionPanel
                      action={primaryGroup}
                      onDelete={() => {
                        setPrimaryGroup(null);
                        setIsPopupOpen(false);
                        setWaitingForDragging(false);
                        setSelectedCron({ ...selectedCron, isEditOpen: false });
                        setEditObject(null);
                        setCurrentTemplateId(null);
                        setIsTemplatePopupOpen(false);
                        setFlowActionsList({
                          ...flowActionsList,
                          [ACTION_TYPES.PRIMARY_APPLICATION]: null,
                        });
                      }}
                      borderColor="#0062ff"
                      backgroundColor="rgb(178 199 255 / 14%)"
                      imageSrc={cloudImageMapper(
                        primaryGroup?.currentApplication?.providerName
                      )}
                      title="Select Group"
                      subtitle={primaryGroup?.group?.groupName || ""}
                    />
                  )}

                  {flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]?.map(
                    (res) => (
                      <ActionPanel
                        key={res?.currentApplication?.id + "APPLICATION"}
                        action={res}
                        onEdit={() => {
                          setIsPopupOpen(false);
                          setWaitingForDragging(false);
                          setSelectedCron({ ...selectedCron, isEditOpen: false });
                          handleEditObject({
                            ...res,
                            type: "PRIMARY_APPLICATION",
                          })
                        }
                        }
                        onDelete={() => {
                          setIsPopupOpen(false);
                          setWaitingForDragging(false);
                          setSelectedCron({ ...selectedCron, isEditOpen: false });
                          setFlowActionsList({
                            ...flowActionsList,
                            [ACTION_TYPES.PRIMARY_APPLICATION]: flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]?.filter(app => app?.currentApplication?.id !== res?.currentApplication?.id),
                          });
                          setEditObject(null);
                          setCurrentTemplateId(null);
                          setEditObject(null);
                          setIsTemplatePopupOpen(false);
                        }
                        }
                        showDelete={
                          flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]
                            ?.length > 1 ||
                          !flowActionsList[ACTION_TYPES.IF_ELSE]
                        }
                        borderColor="#0062ff"
                        backgroundColor="rgb(178 199 255 / 14%)"
                        imageSrc={cloudImageMapper(
                          res?.currentApplication?.providerName
                        )}
                        imageAlt={res?.currentApplication?.providerName}
                        title="Onboard User to"
                        subtitle={getCloudName(
                          res?.currentApplication?.providerName
                        )}
                      />
                    )
                  )}
                  {(waitingForDragging === WAITING_STATES.GLOBAL ? (
                    <div
                      className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent cf_action_drop_pannel"
                      style={{
                        marginTop: "60px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleDrop}
                    >
                      <p>
                        Drag and drop here to add a {!primaryGroup ? "Group" : "Application"}
                      </p>
                    </div>
                  ) : (
                    <div
                      className="cf_action_trigger cf_action_triggerV3"
                      style={{ marginTop: "60px" }}
                    >
                      <ActionButton
                        customClass="changeButtonColorOnHover cf_newBox_Shadow"
                        customStyles={{
                          backgroundColor: "#fff",
                          height: "35px",
                          width: "35px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "50%",
                        }}
                        buttonType="button"
                        isDisabled={false}
                        buttonClickAction={() => {
                          addAction("GLOBAL");
                          setSelectedCron({ ...selectedCron, isEditOpen: false });
                          setWaitingForDragging(WAITING_STATES.GLOBAL);
                        }}
                      >
                        <Plus size={16} />
                      </ActionButton>
                    </div>
                  ))}
                </div>
                {(primaryGroup &&
                  flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]?.length >
                  0) ? (
                  <div
                    className="cf_zoom_percentage_container"
                    style={{
                      top: "20px",
                      right:
                        selectedCron?.isEditOpen ? "calc( 40% + 20px )" :
                          isPopupOpen || isTemplatePopupOpen
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
                      buttonClickAction={openCronPopup}
                    >
                      <p>Save</p>
                    </ActionButton>
                  </div>
                ) : ""}
                <div
                  className="cf_newBox_Shadow cf_zoom_percentage_container"
                  style={{
                    right:
                      selectedCron?.isEditOpen ? "calc( 40% + 20px )" :
                        isPopupOpen || isTemplatePopupOpen
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
            {isPopupOpen && !editObject && (
              <NewFlowActionPannelV2
                licenseInfoMap={licenseInfoMap}
                setLicenseInfoMap={setLicenseInfoMap}
                isPopupOpen={isPopupOpen}
                setIsPopupOpen={setIsPopupOpen}
                viewActionList={
                  popupAcionsList || [
                    "TRIGGER",
                    "ONBOARD_TO_APPLICATIONS",
                    "IF_ELSE",
                  ]
                }
                handleAddToFlow={handleAddToFlow}
                flowActionsList={flowActionsList}
                currentDepartment={currentDepartment}
                selectedApplicationList={selectedApplicationList}
                selectedDepartmentList={departmentList}
                editedAction={editedAction}
                setEditedAction={setEditedAction}
                selectedTemplatesList={
                  divisionTemplatesMap[
                    waitingForDragging?.split("_")[
                    waitingForDragging?.split("_")?.length - 1
                    ]
                  ]?.reduce((acc, curr) => {
                    acc.push(curr?.conditionValue);
                    return acc;
                  }, []) || []
                }
                selectedApplicaionsBasedOnDepartment={
                  selectedApplicaionsBasedOnDepartment[currentDepartment] || []
                }
                templatesList={templatesList}
                isTemplatesLoading={isTemplatesLoading}
                actionsList={actionsList}
                selectedDivisionsList={divisionsList}
                isCreateTemplate={isCreateTemplate}
                editObject={editObject}
                setIsCreateTemplate={setIsCreateTemplate}
                setIsLoading={setIsPageLoading}
              />
            )}
            {isTemplatePopupOpen && currentTemplateId && (
              <CustomTemplateActionPannel
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
                enableOptionsList={
                  editObject?.type === "PRIMARY_APPLICATION" ||
                    currentTemplateId === "PRIMARY_APPLICATION_ADD"
                    ? []
                    : templateStateManager.getEnableOptionsList(
                      currentTemplateId
                    )
                }
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
                selectedCron={selectedCron}
                setSelectedCron={setSelectedCron}
              />
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
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default ScheduledTrigger;
