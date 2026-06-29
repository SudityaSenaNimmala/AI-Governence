import {
  Building,
  ChevronUp,
  GitFork,
  Maximize,
  Minus,
  Plus,
  Workflow,
  TriangleAlert,
  X,
  ClipboardList,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { colorPairs, getUserId, notifyToast } from "../../helpers/utils";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import Popup from "../../Resuables/Popup/Popup";
import { getSaaSRolesForApplication } from "../SaaSManagement/SaaSActions/SaaSActions";
import {
  configureFormWorkFlow,
  getTemplatesList,
  getWorkFlows,
  saveNewWorkFlow,
  saveTemplateWorkFlow,
  updateFormWorkFlowId,
} from "../UserManagement/UserManagementActions/UserManagementActions";
import ActionPanel from "./components/ActionPanel";
import { ACTION_TYPES, WAITING_STATES } from "./constants/workflowConstants";
import "./css/NewFlow.css";
import CustomeTemplate from "./CustomeTemplate/CustomeTemplate";
import CustomTemplateActionPannel from "./CustomeTemplate/CustomTemplateActionPannel";
import RecursiveTemplate from "./CustomeTemplate/RecursiveTemplate";
import { useCanvasZoom } from "./hooks/useCanvasZoom";
import { useTemplateState } from "./hooks/useTemplateState";
import NewFlowActionPannelV2 from "./NewFlowActionPannelV2";
import {
  calculateWidth,
  getAvailableActions,
  handleDropAction,
  makeApplicationsBody,
  parseDropData,
} from "./utils/workflowUtils";
import TextInputUpdate from "../../Resuables/InputsComponents/TextInputUpdate";
import RecursiveTemplateV2 from "./CustomeTemplate/RecursiveTemplateV2";
const NewFlowV4 = () => {
  const navigate = useNavigate();
  const [queryParams] = useSearchParams();
  const manualTrigger = queryParams.get("manualTrigger");
  const offboarding = queryParams.get("offboarding");
  const workFlowId = queryParams.get("workFlowId");
  const formBased = queryParams.get("formBased");
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const primaryApp = cloudsList?.find((cloud) => cloud?.primaryApp);
  const [formUrl, setFormUrl] = useState(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [popupAcionsList, setPopupAcionsList] = useState([]);
  const [flowActionsList, setFlowActionsList] = useState({});
  const [shadowWorkflowId, setShadowWorkflowId] = useState(null);
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
  const [isWorkflowNameEditable, setIsWorkflowNameEditable] = useState(false);
  const [isFormUrlEditable, setIsFormUrlEditable] = useState(false);
  const [flowName, setFlowName] = useState(formBased ? "Form Based Onboarding" : manualTrigger ? (offboarding === "true" ? "Manual Trigger Offboarding" : "Manual Trigger Onboarding") : "Automate Onboarding Workflows");
  const [actionsList, setActionsList] = useState({
    titles: [],
    locations: [],
    divisions: [],
  });
  const [editObject, setEditObject] = useState(null);
  const templateStateManager = useTemplateState();
  const [deletedApplications, setDeletedApplications] = useState([]);
  const [apiBody, setApiBody] = useState({
    userId: "",
    adminCloudId: "",
    timeZone: "",
    language: "",
    region: "",
    passWord: "",
    workFlowName: offboarding === "true" ? "OFFBOARD" : "ONBOARD",
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

  console.log(selectedApplicationList);

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

  // Helper functions for template state management
  const getTemplateKey = (templateId, divisionName = null) => {
    return divisionName ? `${divisionName}_${templateId}` : templateId;
  };

  const addAction = (type) => {
    setEditObject(null);
    if (type === "DEPT_APP_SELECT" || manualTrigger === "true" || formBased === "true") {
      if (!formUrl && formBased === "true") {
        setIsPopupOpen(false);
        setIsTemplatePopupOpen(true);
        // setCurrentTemplateId("PRIMARY_APPLICATION_ADD");
        setPopupAcionsList([ACTION_TYPES.ASSIGN_TEMPLATE]);
      } else {
        setIsPopupOpen(false);
        setIsTemplatePopupOpen(true);
        setCurrentTemplateId("PRIMARY_APPLICATION_ADD");
        setPopupAcionsList([ACTION_TYPES.ONBOARD_TO_APPLICATIONS]);
      }
    } else if (type === "DIVISION_TEMPLATE_SELECT") {
      setIsPopupOpen(true);
      setIsTemplatePopupOpen(false);
      setPopupAcionsList([ACTION_TYPES.ASSIGN_TEMPLATE]);
    } else if (type === "GLOBAL") {
      setCurrentDepartment(null);
      setCurrentDivision(null);
      setIsPopupOpen(true);
      setIsTemplatePopupOpen(false);
      const availableActions = getAvailableActions(flowActionsList);
      setPopupAcionsList(availableActions);
    }
  };

  console.log(primaryApp)

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
          res?.currentApplication?.providerName === "OTHERS" ? res?.currentApplication?.externalProviderName : res?.currentApplication?.providerName,
        ],
      });
    } else if (action === ACTION_TYPES.DEPARTMENT_BASED_ACTION) {
      setDepartMentMap({
        ...departMentMap,
        [res?.department?.name]: [
          ...(departMentMap[res?.department?.name] || []),
          res,
        ],
      });
      if (!departmentList?.includes(res?.department?.name)) {
        setDepartmentList((prev) => [...prev, res?.department?.name]);
      }
    } else if (action === ACTION_TYPES.PRIMARY_APPLICATION) {
      if (res?.currentApplication?.id) {
        setSelectedApplicationList([
          ...selectedApplicationList,
          res?.currentApplication?.providerName === "OTHERS" ? res?.currentApplication?.externalProviderName : res?.currentApplication?.providerName,
        ]);
      }
      setFlowActionsList({
        ...flowActionsList,
        [ACTION_TYPES.PRIMARY_APPLICATION]: [
          ...(flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION] || []),
          res,
        ],
      });
    } else if (action === ACTION_TYPES.ASSIGN_TEMPLATE) {
      const template = res?.templateObject || res;

      if (currentDivision) {
        setDivisionTemplatesMap((prev) => ({
          ...prev,
          [currentDivision]: [...(prev[currentDivision] || []), template],
        }));

        const templateKey = templateStateManager.getTemplateKey(
          template.id,
          currentDivision
        );
        if (
          template?.id &&
          !templateStateManager.getWorkFlowJSON(templateKey)
        ) {
          if (template?.workFlowApplications?.length || template?.mandatoryApplications?.length) {
            transformTemplateToDivisionWorkFlowJSON(currentDivision, template);
          } else {
            templateStateManager.setWorkFlowJSON(templateKey, {
              workFlowName:
                template?.workFlowName || template?.name || "Template",
              departMentName: template?.conditionValue || null,
              applicationsList: [],
              locationsList: [],
              locationActions: {},
              rolesList: [],
              actions: {},
            });
          }
        }
      } else {
        // Legacy behavior - add to flowActionsList directly
        setSelectedTemplates((prev) => [...prev, template]);
        setFlowActionsList({
          ...flowActionsList,
          [ACTION_TYPES.ASSIGN_TEMPLATE]: [
            ...(flowActionsList[ACTION_TYPES.ASSIGN_TEMPLATE] || []),
            template,
          ],
        });
        if (
          template?.id &&
          !templateStateManager.getWorkFlowJSON(template.id)
        ) {
          if (template?.workFlowApplications) {
            transformTemplateToWorkFlowJSON(template);
          } else {
            // Get department name from either conditionValue or departmentName (API might use either)
            const departmentName =
              template?.conditionValue || template?.departmentName || null;

            templateStateManager.setWorkFlowJSON(template.id, {
              workFlowName:
                template?.workFlowName || template?.name || "Template",
              departMentName: departmentName,
              applicationsList: [],
              locationsList: [],
              locationActions: {},
              rolesList: [],
              actions: {},
            });
          }
        }
      }
    } else if (action === ACTION_TYPES.DIVISION_BASED_ACTION) {
      if (!divisionsList?.includes(res?.division?.name)) {
        setDivisionsList((prev) => [...prev, res?.division?.name]);
        setDivisionTemplatesMap((prev) => ({
          ...prev,
          [res?.division?.name]: [],
        }));
      }
    } else {
      if (res?.currentApplication?.id) {
        setSelectedApplicationList([
          ...selectedApplicationList,
          res?.currentApplication?.providerName === "OTHERS" ? res?.currentApplication?.externalProviderName : res?.currentApplication?.providerName,
        ]);
      }
      setFlowActionsList({
        ...flowActionsList,
        [action]: res,
      });
    }
  };

  const deleteAction = (res, action, department = null, division = null) => {
    if (action === ACTION_TYPES.IF_ELSE) {
      const cpyFlowActionsList = { ...flowActionsList };
      delete cpyFlowActionsList[ACTION_TYPES.IF_ELSE];
      setFlowActionsList(cpyFlowActionsList);
      setDepartmentList([]);
      setDepartMentAppMap({});
      setSelectedApplicaionsBasedOnDepartment({});
      setSelectedApplicationList([]);
      setSelectedTemplates([]);
      setDivisionsList([]);
      setDivisionTemplatesMap({});
      templateStateManager.clearAll();
      return;
    }
    if (action === "DIVISION") {
      const cpyDivisionTemplatesMap = { ...divisionTemplatesMap };
      delete cpyDivisionTemplatesMap[res];
      setDivisionsList(divisionsList.filter((item) => item !== res));
      setDivisionTemplatesMap(cpyDivisionTemplatesMap);

      // Clean up division template data
      const workFlowJSONMap =
        templateStateManager.templateState.workFlowJSONMap;
      Object.keys(workFlowJSONMap).forEach((key) => {
        if (key.startsWith(`${res}_`)) {
          templateStateManager.deleteTemplate(key);
        }
      });
      return;
    }
    if (action === "DIVISION_TEMPLATE") {
      const cpyDivisionTemplatesMap = { ...divisionTemplatesMap };
      cpyDivisionTemplatesMap[division] = (
        cpyDivisionTemplatesMap[division] || []
      ).filter((item) => item?.id !== res?.id);
      setDivisionTemplatesMap(cpyDivisionTemplatesMap);

      const templateKey = templateStateManager.getTemplateKey(
        res?.id,
        division
      );
      templateStateManager.deleteTemplate(templateKey);
      return;
    }
    if (action === ACTION_TYPES.ASSIGN_TEMPLATE) {
      const cpyFlowActionsList = { ...flowActionsList };
      cpyFlowActionsList[ACTION_TYPES.ASSIGN_TEMPLATE] = cpyFlowActionsList[
        ACTION_TYPES.ASSIGN_TEMPLATE
      ].filter((item) => item?.id !== res?.id);
      setFlowActionsList(cpyFlowActionsList);
      setSelectedTemplates(
        selectedTemplates.filter((item) => item?.id !== res?.id)
      );
      // Remove template data from maps
      templateStateManager.deleteTemplate(res?.id);
      return;
    }
    if (department) {
      const cpyDepartmentAppMap = { ...departMentAppMap };
      cpyDepartmentAppMap[department] = cpyDepartmentAppMap[department].filter(
        (item) => item?.currentApplication?.id !== res?.currentApplication?.id
      );
      setDepartMentAppMap(cpyDepartmentAppMap);
    } else if (action === ACTION_TYPES.PRIMARY_APPLICATION) {
      const cpyFlowActionsList = { ...flowActionsList };
      cpyFlowActionsList[ACTION_TYPES.PRIMARY_APPLICATION] = cpyFlowActionsList[
        ACTION_TYPES.PRIMARY_APPLICATION
      ].filter(
        (item) => item?.currentApplication?.id !== res?.currentApplication?.id
      );
      setFlowActionsList(cpyFlowActionsList);
      setSelectedApplicationList(
        selectedApplicationList.filter(
          (item) => item !== res?.currentApplication?.providerName === "OTHERS" ? res?.currentApplication?.externalProviderName : res?.currentApplication?.providerName
        )
      );
    } else if (action === "DEPARTMENT") {
      const cpyDepartmentAppMap = { ...departMentAppMap };
      delete cpyDepartmentAppMap[res];
      setDepartmentList(departmentList.filter((item) => item !== res));
      setDepartMentAppMap(cpyDepartmentAppMap);
    }
  };

  const handleSaveWorkFlow = async () => {
    setIsPageLoading(true);

    // if (listOfToBeUpdatedTemplates?.length > 0) {
    //   listOfToBeUpdatedTemplates.forEach(async (data) => {
    //     new Promise(async (resolve, reject) => {
    //       let res = await saveTemplateWorkFlow(data);
    //       if (res?.status === "OK") {
    //         resolve();
    //       } else {
    //         reject(res?.res);
    //       }
    //     });
    //   });
    // }

    const cpyApiBody = { ...apiBody };
    cpyApiBody.userId = getUserId();

    if (
      !flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.id &&
      !manualTrigger &&
      !formBased
    ) {
      notifyToast("error", "Please add a trigger");
      return;
    }

    if (manualTrigger || formBased) {
      cpyApiBody.adminCloudId = null;
      cpyApiBody.providerName = null;
    } else {
      cpyApiBody.adminCloudId =
        flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.id;
      cpyApiBody.providerName =
        flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.providerName === "OTHERS" ? flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.externalProviderName : flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.providerName;
    }

    let primaryApplicationBody = [];
    if (
      flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION] ||
      flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]?.length > 0
    ) {
      primaryApplicationBody = makeApplicationsBody(
        flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION], (manualTrigger === "true" || formBased === "true") && workFlowId !== null
      );
    }

    const divisionDetails = divisionsList?.map((divisionName) => {
      const templates = divisionTemplatesMap[divisionName] || [];
      const conditionalWorkFlows = templates?.map((template) => {
        const templateKey = templateStateManager.getTemplateKey(
          template.id,
          divisionName
        );
        const templateWorkFlowJSON =
          templateStateManager.getWorkFlowJSON(templateKey) ||
          templateStateManager.getDataMap(templateKey);

        const workflowIdForTemplate =
          shadowWorkflowId ?? editWorkFlowObject?.id ?? null;

        // Department-level apps → mandatoryApplications (not workFlowApplications)
        const mandatoryApplicationsRaw = templateWorkFlowJSON?.applicationsList?.length
          ? makeApplicationsBody(templateWorkFlowJSON.applicationsList)
          : [];
        const mandatoryApplications = mandatoryApplicationsRaw.map((app) => ({
          ...app,
          workFlowId: workflowIdForTemplate,
        }));

        const workFlowApplications = [];

        if (templateWorkFlowJSON?.locationActions) {
          Object.keys(templateWorkFlowJSON.locationActions).forEach(
            (locName) => {
              const locationApps =
                templateWorkFlowJSON.locationActions[locName];
              locationApps.forEach((app) => {
                const appBody = makeApplicationsBody([app])[0];
                if (appBody) {
                  workFlowApplications.push({
                    ...appBody,
                    workFlowId: workflowIdForTemplate,
                    location:
                      locName === "Location Not Met" ||
                        locName === "LOCATION_NOT_MET"
                        ? null
                        : locName,
                  });
                }
              });
            }
          );
        }

        if (templateWorkFlowJSON?.actions) {
          Object.keys(templateWorkFlowJSON.actions).forEach((roleName) => {
            const roleData = templateWorkFlowJSON.actions[roleName];

            if (roleData?.applicationsList) {
              roleData.applicationsList.forEach((app) => {
                const appBody = makeApplicationsBody([app])[0];
                if (appBody) {
                  workFlowApplications.push({
                    ...appBody,
                    workFlowId: workflowIdForTemplate,
                    title:
                      roleName === "Title Not Met" ||
                        roleName === "TITLE_NOT_MET"
                        ? null
                        : roleName,
                  });
                }
              });
            }

            if (roleData?.actions) {
              Object.keys(roleData.actions).forEach((locName) => {
                const locationApps = roleData.actions[locName];
                locationApps.forEach((app) => {
                  const appBody = makeApplicationsBody([app])[0];
                  if (appBody) {
                    workFlowApplications.push({
                      ...appBody,
                      workFlowId: workflowIdForTemplate,
                      title:
                        roleName === "Title Not Met" ||
                          roleName === "TITLE_NOT_MET"
                          ? null
                          : roleName,
                      location:
                        locName === "Location Not Met" ||
                          locName === "LOCATION_NOT_MET"
                          ? null
                          : locName,
                    });
                  }
                });
              });
            }
          });
        }

        const conditionValue =
          templateWorkFlowJSON?.departMentName ||
          template?.conditionValue ||
          null;
        const normalizedDivisionName =
          divisionName === "Division Not Met" ||
            divisionName === "DIVISION_NOT_MET"
            ? null
            : divisionName;
        const normalizedConditionValue =
          conditionValue === "Department Not Met" ||
            conditionValue === "DEPARTMENT_NOT_MET"
            ? null
            : conditionValue;

        return {
          workflowId: workflowIdForTemplate,
          divisionName: normalizedDivisionName,
          conditionValue: normalizedConditionValue,
          deleted: false,
          userId: template?.userId,
          id: template?.id,
          type: "DEPARTMENT",
          enable: true,
          mandatoryApplications,
          workFlowApplications,
        };
      });

      return {
        divisionName:
          divisionName === "Division Not Met" ||
            divisionName === "DIVISION_NOT_MET"
            ? null
            : divisionName,
        conditionalWorkFlows: conditionalWorkFlows,
      };
    });

    let nullDivision = [];
    let finalDivisionDetails = [];
    divisionDetails?.map((data) => {
      if (data.divisionName === null) {
        nullDivision = data.conditionalWorkFlows;
      } else {
        finalDivisionDetails.push(data);
      }
    });

    cpyApiBody.divisionDetails = finalDivisionDetails;
    cpyApiBody.mandatoryApplications = primaryApplicationBody;
    cpyApiBody.departMentWorkFlows = nullDivision;
    cpyApiBody.active = true;
    if (editWorkFlowObject?.id || shadowWorkflowId) {
      cpyApiBody.id = editWorkFlowObject?.id || shadowWorkflowId;
    }

    cpyApiBody.manual = manualTrigger === "true";
    cpyApiBody.formBasedWorkFlow = formBased === "true";
    cpyApiBody.name = flowName;
    cpyApiBody.recurring = (manualTrigger === "true" || formBased === "true") ? false : true;

    if (formBased === "true") {
      const configureRes = await configureFormWorkFlow({
        formUrl,
        adminCloudId: primaryApp?.id,
      });
      if (configureRes?.status !== "OK") {
        notifyToast("error", configureRes?.res || "Failed to configure form");
        setIsPageLoading(false);
        return;
      }
      const formDetailsId = configureRes?.res?.id;
      cpyApiBody.formDetailsId = formDetailsId;
      cpyApiBody.formName = configureRes?.res?.itemName;

      const res = await saveNewWorkFlow(cpyApiBody);
      if (res?.status === "OK") {
        const savedWorkflowId = res?.res?.id;
        await updateFormWorkFlowId(formDetailsId, savedWorkflowId);
        notifyToast("success", workFlowId ? "Workflow Updated successfully" : "Workflow Created successfully");
        navigate("/Workflow/Template");
        setIsPageLoading(false);
      } else {
        notifyToast("error", res?.res);
        setIsPageLoading(false);
      }
      return;
    }

    const res = await saveNewWorkFlow(cpyApiBody);
    if (res?.status === "OK") {
      if (workFlowId) {
        notifyToast("success", "Workflow Updated successfully");
      } else {
        notifyToast("success", "Workflow Created successfully");
      }
      navigate("/Workflow/Template");
      setIsPageLoading(false);
    } else {
      notifyToast("error", res?.res);
      setIsPageLoading(false);
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

  const transformTemplateToWorkFlowJSON = (template) => {
    const rawDepartmentName =
      template?.conditionValue || template?.departmentName || null;
    const departmentName =
      rawDepartmentName === null ? "Department Not Met" : rawDepartmentName;

    const workFlowJSON = {
      workFlowName: template?.workFlowName || template?.name,
      departMentName: departmentName,
      applicationsList: [],
      locationsList: [],
      locationActions: {},
      rolesList: [],
      actions: {},
    };

    // Department-level apps from mandatoryApplications (for legacy / non-division templates)
    if (template?.mandatoryApplications?.length) {
      template.mandatoryApplications.forEach((app) => {
        const subscriptionIds = app?.usubscriptionIds || [];
        const appData = {
          currentApplication: {
            ...(cloudsList?.find((c) => c?.id === app?.adminCloudId) || {}),
            id: app?.adminCloudId,
            providerName: app?.applicationName,
            adminCloudId: app?.adminCloudId,
          },
          deleted: app?.deleted || false,
          LICENSES:
            subscriptionIds?.map((sub) => {
              if (typeof sub === "object" && sub !== null) {
                return {
                  id: sub?.subscriptionId || sub?.id,
                  planName: sub?.subscriptionName || sub?.planName,
                  planId: sub?.subscriptionId || sub?.planId,
                };
              }
              return { id: sub, planName: sub, planId: sub };
            }) || [],
          GROUPS: app?.groupIds || [],
          roles: app?.roles || [],
          commonName: app?.commonName ?? null,
        };
        workFlowJSON.applicationsList.push(appData);
      });
    }

    if (template?.workFlowApplications) {
      template.workFlowApplications.forEach((app) => {
        const subscriptionIds = app?.usubscriptionIds || [];
        let cpyData = { ...app };
        delete cpyData.usubscriptionIds;
        delete cpyData.groupIds;
        delete cpyData.roles;
        const appData = {
          currentApplication: {
            ...cpyData,
            providerName: app?.applicationName,
          },
          deleted: app?.deleted || false,
          LICENSES:
            subscriptionIds?.map((sub) => {
              if (typeof sub === "object" && sub !== null) {
                return {
                  id: sub?.subscriptionId || sub?.id,
                  planName: sub?.subscriptionName || sub?.planName,
                  planId: sub?.subscriptionId || sub?.planId,
                };
              }
              return {
                id: sub,
                planName: sub,
                planId: sub,
              };
            }) || [],
          GROUPS: app?.groupIds || [],
          roles: app?.roles || [],
          commonName: app?.commonName,
        };

        const roleName = app?.title === null ? "Title Not Met" : app?.title;
        const locationName =
          app?.location === null ? "Location Not Met" : app?.location;

        if (roleName && locationName) {
          if (!workFlowJSON.rolesList.includes(roleName)) {
            workFlowJSON.rolesList.push(roleName);
          }

          if (!workFlowJSON.actions[roleName]) {
            workFlowJSON.actions[roleName] = {
              locationsList: [],
              applicationsList: [],
              actions: {},
            };
          }

          if (
            !workFlowJSON.actions[roleName].locationsList.includes(locationName)
          ) {
            workFlowJSON.actions[roleName].locationsList.push(locationName);
          }

          if (!workFlowJSON.actions[roleName].actions[locationName]) {
            workFlowJSON.actions[roleName].actions[locationName] = [];
          }

          workFlowJSON.actions[roleName].actions[locationName].push(appData);
        } else if (roleName) {
          if (!workFlowJSON.rolesList.includes(roleName)) {
            workFlowJSON.rolesList.push(roleName);
          }

          if (!workFlowJSON.actions[roleName]) {
            workFlowJSON.actions[roleName] = {
              locationsList: [],
              applicationsList: [],
              actions: {},
            };
          }

          workFlowJSON.actions[roleName].applicationsList.push(appData);
        } else if (locationName) {
          if (!workFlowJSON.locationsList.includes(locationName)) {
            workFlowJSON.locationsList.push(locationName);
          }

          if (!workFlowJSON.locationActions[locationName]) {
            workFlowJSON.locationActions[locationName] = [];
          }

          workFlowJSON.locationActions[locationName].push(appData);
        } else {
          workFlowJSON.applicationsList.push(appData);
        }
      });
    }

    templateStateManager.setDataMap(template.id, workFlowJSON);
    templateStateManager.setWorkFlowJSON(template.id, workFlowJSON);
  };

  const transformTemplateToDivisionWorkFlowJSON = (divisionName, template) => {
    const rawDepartmentName =
      template?.conditionValue || template?.departmentName || null;
    const departmentName =
      rawDepartmentName === null ? "Department Not Met" : rawDepartmentName;

    const workFlowJSON = {
      workFlowName: template?.workFlowName || template?.name,
      departMentName: departmentName,
      applicationsList: [],
      locationsList: [],
      locationActions: {},
      rolesList: [],
      actions: {},
    };

    // Department-level apps from mandatoryApplications (so they show in workflow view)
    if (template?.mandatoryApplications?.length) {
      template.mandatoryApplications.forEach((app) => {
        const subscriptionIds = app?.usubscriptionIds || [];
        const appData = {
          currentApplication: {
            ...(cloudsList?.find((c) => c?.id === app?.adminCloudId) || {}),
            id: app?.adminCloudId,
            providerName: app?.applicationName,
            adminCloudId: app?.adminCloudId,
          },
          deleted: app?.deleted || false,
          LICENSES:
            subscriptionIds?.map((sub) => {
              if (typeof sub === "object" && sub !== null) {
                return {
                  id: sub?.subscriptionId || sub?.id,
                  planName: sub?.subscriptionName || sub?.planName,
                  planId: sub?.subscriptionId || sub?.planId,
                };
              }
              return { id: sub, planName: sub, planId: sub };
            }) || [],
          GROUPS: app?.groupIds || [],
          roles: app?.roles || [],
          commonName: app?.commonName ?? null,
        };
        workFlowJSON.applicationsList.push(appData);
      });
    }

    if (template?.workFlowApplications) {
      template.workFlowApplications.forEach((app) => {
        const subscriptionIds =
          app?.usubscriptionIds || app?.usubscriptionIds || [];
        let cpyData = { ...app };
        delete cpyData.usubscriptionIds;
        delete cpyData.groupIds;
        delete cpyData.roles;
        const appData = {
          currentApplication: {
            ...cpyData,
            providerName: app?.applicationName,
          },
          deleted: app?.deleted || false,
          LICENSES:
            subscriptionIds?.map((sub) => {
              if (typeof sub === "object" && sub !== null) {
                return {
                  id: sub?.subscriptionId || sub?.id,
                  planName: sub?.subscriptionName || sub?.planName,
                  planId: sub?.subscriptionId || sub?.planId,
                };
              }
              return {
                id: sub,
                planName: sub,
                planId: sub,
              };
            }) || [],
          GROUPS: app?.groupIds || [],
          roles: app?.roles || [],
          commonName: app?.commonName,
        };

        const roleName = app?.title === null ? "Title Not Met" : app?.title;
        const locationName =
          app?.location === null ? "Location Not Met" : app?.location;

        if (roleName && locationName) {
          if (!workFlowJSON.rolesList.includes(roleName)) {
            workFlowJSON.rolesList.push(roleName);
          }

          if (!workFlowJSON.actions[roleName]) {
            workFlowJSON.actions[roleName] = {
              locationsList: [],
              applicationsList: [],
              actions: {},
            };
          }

          if (
            !workFlowJSON.actions[roleName].locationsList.includes(locationName)
          ) {
            workFlowJSON.actions[roleName].locationsList.push(locationName);
          }

          if (!workFlowJSON.actions[roleName].actions[locationName]) {
            workFlowJSON.actions[roleName].actions[locationName] = [];
          }

          workFlowJSON.actions[roleName].actions[locationName].push(appData);
        } else if (roleName) {
          if (!workFlowJSON.rolesList.includes(roleName)) {
            workFlowJSON.rolesList.push(roleName);
          }

          if (!workFlowJSON.actions[roleName]) {
            workFlowJSON.actions[roleName] = {
              locationsList: [],
              applicationsList: [],
              actions: {},
            };
          }

          workFlowJSON.actions[roleName].applicationsList.push(appData);
        } else if (locationName) {
          if (!workFlowJSON.locationsList.includes(locationName)) {
            workFlowJSON.locationsList.push(locationName);
          }

          if (!workFlowJSON.locationActions[locationName]) {
            workFlowJSON.locationActions[locationName] = [];
          }

          workFlowJSON.locationActions[locationName].push(appData);
        } else {
          workFlowJSON.applicationsList.push(appData);
        }
      });
    }

    const templateKey = templateStateManager.getTemplateKey(
      template.id,
      divisionName
    );
    templateStateManager.setDataMap(templateKey, workFlowJSON);
    templateStateManager.setWorkFlowJSON(templateKey, workFlowJSON);
  };

  const handleDivisionTemplateDrop = (divisionName, templateId, e) => {
    e.preventDefault();
    const data = parseDropData(e.dataTransfer.getData("json"));
    if (!data || !templateId || !divisionName) return;

    const templateKey = templateStateManager.getTemplateKey(
      templateId,
      divisionName
    );
    const currentWorkFlowJSON = templateStateManager.getWorkFlowJSON(
      templateKey
    ) || {
      workFlowName: "Template",
      departMentName: null,
      applicationsList: [],
      locationsList: [],
      locationActions: {},
      rolesList: [],
      actions: {},
    };

    // Dropping an existing template: merge its workFlowApplications and mandatoryApplications
    if (data?.action === ACTION_TYPES.ASSIGN_TEMPLATE && data?.templateObject) {
      const template = data.templateObject;
      const workFlowJSON = { ...currentWorkFlowJSON };
      const existingAppIds = new Set(
        (workFlowJSON.applicationsList || []).map(
          (a) => a?.currentApplication?.id || a?.currentApplication?.adminCloudId || a?.id
        )
      );

      const templateAppToAppData = (app) => {
        const subscriptionIds = app?.usubscriptionIds || [];
        const appData = {
          currentApplication: {
            ...(cloudsList?.find((c) => c?.id === app?.adminCloudId) || {}),
            id: app?.adminCloudId,
            providerName: app?.applicationName,
            adminCloudId: app?.adminCloudId,
          },
          deleted: app?.deleted || false,
          LICENSES:
            subscriptionIds?.map((sub) => {
              if (typeof sub === "object" && sub !== null) {
                return {
                  id: sub?.subscriptionId || sub?.id,
                  planName: sub?.subscriptionName || sub?.planName,
                  planId: sub?.subscriptionId || sub?.planId,
                };
              }
              return { id: sub, planName: sub, planId: sub };
            }) || [],
          GROUPS: app?.groupIds || [],
          roles: app?.roles || [],
          commonName: app?.commonName ?? null,
        };
        return appData;
      };

      // Add mandatoryApplications to department-level applicationsList
      if (template?.mandatoryApplications?.length) {
        workFlowJSON.applicationsList = workFlowJSON.applicationsList || [];
        template.mandatoryApplications.forEach((app) => {
          const appId = app?.adminCloudId || app?.id;
          if (appId && !existingAppIds.has(appId)) {
            existingAppIds.add(appId);
            workFlowJSON.applicationsList.push(templateAppToAppData(app));
          }
        });
      }

      // Add workFlowApplications to roles/locations/applicationsList (same as transformTemplateToDivisionWorkFlowJSON)
      if (template?.workFlowApplications?.length) {
        workFlowJSON.rolesList = workFlowJSON.rolesList || [];
        workFlowJSON.actions = workFlowJSON.actions || {};
        workFlowJSON.locationsList = workFlowJSON.locationsList || [];
        workFlowJSON.locationActions = workFlowJSON.locationActions || {};

        template.workFlowApplications.forEach((app) => {
          const appData = templateAppToAppData(app);
          const roleName = app?.title === null ? "Title Not Met" : app?.title;
          const locationName =
            app?.location === null ? "Location Not Met" : app?.location;

          if (roleName && locationName) {
            if (!workFlowJSON.rolesList.includes(roleName)) {
              workFlowJSON.rolesList.push(roleName);
            }
            if (!workFlowJSON.actions[roleName]) {
              workFlowJSON.actions[roleName] = {
                locationsList: [],
                applicationsList: [],
                actions: {},
              };
            }
            if (!workFlowJSON.actions[roleName].locationsList.includes(locationName)) {
              workFlowJSON.actions[roleName].locationsList.push(locationName);
            }
            if (!workFlowJSON.actions[roleName].actions[locationName]) {
              workFlowJSON.actions[roleName].actions[locationName] = [];
            }
            workFlowJSON.actions[roleName].actions[locationName].push(appData);
          } else if (roleName) {
            if (!workFlowJSON.rolesList.includes(roleName)) {
              workFlowJSON.rolesList.push(roleName);
            }
            if (!workFlowJSON.actions[roleName]) {
              workFlowJSON.actions[roleName] = {
                locationsList: [],
                applicationsList: [],
                actions: {},
              };
            }
            workFlowJSON.actions[roleName].applicationsList.push(appData);
          } else if (locationName) {
            if (!workFlowJSON.locationsList.includes(locationName)) {
              workFlowJSON.locationsList.push(locationName);
            }
            if (!workFlowJSON.locationActions[locationName]) {
              workFlowJSON.locationActions[locationName] = [];
            }
            workFlowJSON.locationActions[locationName].push(appData);
          } else {
            workFlowJSON.applicationsList = workFlowJSON.applicationsList || [];
            workFlowJSON.applicationsList.push(appData);
          }
        });
      }

      templateStateManager.updateWorkFlowJSON(templateKey, workFlowJSON);
      templateStateManager.setWaitingForDragging(templateKey, null);
      return;
    }

    if (data?.action === "SELECT_DEPARTMENT") {
      templateStateManager.updateWorkFlowJSON(templateKey, {
        ...currentWorkFlowJSON,
        departMentName: data?.department?.name,
        actions: {},
        rolesList: [],
        locationsList: [],
        locationActions: {},
        applicationsList: [],
      });
    } else if (data?.action === "SELECT_ROLE") {
      templateStateManager.updateWorkFlowJSON(templateKey, {
        ...currentWorkFlowJSON,
        actions: {
          ...currentWorkFlowJSON?.actions,
          [data?.role]: {
            locationsList: [],
            applicationsList: [],
            actions: {},
          },
        },
        rolesList: [...(currentWorkFlowJSON?.rolesList || []), data?.role],
      });
    } else if (data?.action === "SELECT_LOCATION") {
      const currentRole =
        data?.currentRole || templateStateManager.getCurrentRole(templateKey);
      if (currentRole) {
        const roleData = currentWorkFlowJSON?.actions[currentRole] || {
          locationsList: [],
          applicationsList: [],
          actions: {},
        };
        const currentLocationsList = roleData?.locationsList || [];
        const currentActions = roleData?.actions || {};

        if (!currentLocationsList.includes(data?.location?.name)) {
          currentLocationsList.push(data?.location?.name);
        }
        if (!currentActions[data?.location?.name]) {
          currentActions[data?.location?.name] = [];
        }

        templateStateManager.updateWorkFlowJSON(templateKey, {
          ...currentWorkFlowJSON,
          actions: {
            ...currentWorkFlowJSON?.actions,
            [currentRole]: {
              ...roleData,
              locationsList: currentLocationsList,
              actions: currentActions,
            },
          },
        });
      } else if (currentWorkFlowJSON?.departMentName) {
        const currentLocationsList = currentWorkFlowJSON?.locationsList || [];
        const currentLocationActions =
          currentWorkFlowJSON?.locationActions || {};

        if (!currentLocationsList.includes(data?.location?.name)) {
          currentLocationsList.push(data?.location?.name);
        }
        if (!currentLocationActions[data?.location?.name]) {
          currentLocationActions[data?.location?.name] = [];
        }

        templateStateManager.updateWorkFlowJSON(templateKey, {
          ...currentWorkFlowJSON,
          locationsList: currentLocationsList,
          locationActions: currentLocationActions,
        });
      }
    } else if (data?.action === "ONBOARD_TO_APPLICATIONS") {
      const waitingKey =
        templateStateManager.getWaitingForDragging(templateKey);
      const currentRole = templateStateManager.getCurrentRole(templateKey);

      if (waitingKey?.startsWith("SELECT_DEPARTMENT_")) {
        const roleName = waitingKey.replace("SELECT_DEPARTMENT_", "");
        const roleData = currentWorkFlowJSON?.actions[roleName] || {};
        if (!roleData?.locationsList || roleData.locationsList.length === 0) {
          templateStateManager.updateWorkFlowJSON(templateKey, {
            ...currentWorkFlowJSON,
            actions: {
              ...currentWorkFlowJSON?.actions,
              [roleName]: {
                ...roleData,
                applicationsList: [
                  ...(roleData?.applicationsList || []),
                  {
                    currentApplication: data?.currentApplication,
                    LICENSES: data?.LICENSES || [],
                    deleted: data?.deleted || false,
                    GROUPS: data?.GROUPS || [],
                    roles: data?.roles || [],
                    commonName: data?.commonName,
                  },
                ],
              },
            },
          });
        }
      } else if (waitingKey?.startsWith("SELECT_LOCATION_")) {
        const locationName = waitingKey.replace("SELECT_LOCATION_", "");
        const targetRole = currentRole || data?.currentRole;

        if (targetRole && currentWorkFlowJSON?.actions[targetRole]) {
          const currentActions =
            currentWorkFlowJSON?.actions[targetRole]?.actions || {};
          const locationApplications = currentActions[locationName] || [];

          templateStateManager.updateWorkFlowJSON(templateKey, {
            ...currentWorkFlowJSON,
            actions: {
              ...currentWorkFlowJSON?.actions,
              [targetRole]: {
                ...currentWorkFlowJSON?.actions[targetRole],
                actions: {
                  ...currentActions,
                  [locationName]: [
                    ...locationApplications,
                    {
                      ...data,
                    },
                  ],
                },
              },
            },
          });
        } else if (currentWorkFlowJSON?.departMentName && !targetRole) {
          const currentLocationActions =
            currentWorkFlowJSON?.locationActions || {};
          const locationApplications =
            currentLocationActions[locationName] || [];

          templateStateManager.updateWorkFlowJSON(templateKey, {
            ...currentWorkFlowJSON,
            locationActions: {
              ...currentLocationActions,
              [locationName]: [
                ...locationApplications,
                {
                  ...data,
                },
              ],
            },
          });
        }
      } else if (waitingKey === "SELECT_DEPARTMENT_APPLICATION") {
        templateStateManager.updateWorkFlowJSON(templateKey, {
          ...currentWorkFlowJSON,
          applicationsList: [
            ...(currentWorkFlowJSON?.applicationsList || []),
            {
              currentApplication: data?.currentApplication,
              LICENSES: data?.LICENSES || [],
              deleted: data?.deleted || false,
              GROUPS: data?.GROUPS || [],
              roles: data?.roles || [],
              commonName: data?.commonName,
            },
          ],
        });
      }
    }

    templateStateManager.setWaitingForDragging(templateKey, null);
  };

  const handleDivisionTemplateDelete = (
    divisionName,
    templateId,
    key,
    type,
    roleKey = null,
    deleteData = null
  ) => {
    const templateKey = templateStateManager.getTemplateKey(
      templateId,
      divisionName
    );
    const currentWorkFlowJSON =
      templateStateManager.getWorkFlowJSON(templateKey);
    if (!currentWorkFlowJSON) return;

    if (
      deleteData?.type === "LOCATION" ||
      deleteData?.type === "ROLE"
    ) {
      handleSaveApplicationEditObject(deleteData, "DELETE");
      return;
    }

    if (type === "DEPARTMENT") {
      let cptDivTemplateMap = { ...divisionTemplatesMap };
      cptDivTemplateMap[divisionName] = cptDivTemplateMap[divisionName]?.filter(
        (template) => template?.conditionValue !== key
      );
      setDivisionTemplatesMap(cptDivTemplateMap);
      if (cptDivTemplateMap[divisionName]?.length === 0) {
        templateStateManager.deleteTemplateKey(templateKey);
      }
    } else if (type === "ROLE") {
      const updatedRolesList = currentWorkFlowJSON?.rolesList?.filter(
        (role) => role !== key
      );
      const updatedActions = { ...currentWorkFlowJSON?.actions };
      delete updatedActions[key];
      templateStateManager.updateWorkFlowJSON(templateKey, {
        ...currentWorkFlowJSON,
        rolesList: updatedRolesList,
        actions: updatedActions,
      });
    } else if (type === "LOCATION") {
      const targetRoleKey =
        roleKey ||
        templateStateManager.getCurrentRole(templateKey) ||
        Object.keys(currentWorkFlowJSON?.actions || {})[0];
      if (targetRoleKey && currentWorkFlowJSON?.actions[targetRoleKey]) {
        const updatedLocationsList = currentWorkFlowJSON?.actions[
          targetRoleKey
        ]?.locationsList?.filter((location) => location !== key);
        const updatedActions = { ...currentWorkFlowJSON?.actions };
        if (updatedActions[targetRoleKey]) {
          updatedActions[targetRoleKey] = {
            ...updatedActions[targetRoleKey],
            locationsList: updatedLocationsList,
          };
          if (updatedActions[targetRoleKey]?.actions) {
            delete updatedActions[targetRoleKey].actions[key];
          }
        }
        templateStateManager.updateWorkFlowJSON(templateKey, {
          ...currentWorkFlowJSON,
          actions: updatedActions,
        });
      } else if (
        currentWorkFlowJSON?.departMentName &&
        currentWorkFlowJSON?.locationsList
      ) {
        const updatedLocationsList = currentWorkFlowJSON.locationsList.filter(
          (location) => location !== key
        );
        const updatedLocationActions = {
          ...currentWorkFlowJSON?.locationActions,
        };
        delete updatedLocationActions[key];
        templateStateManager.updateWorkFlowJSON(templateKey, {
          ...currentWorkFlowJSON,
          locationsList: updatedLocationsList,
          locationActions: updatedLocationActions,
        });
      }
    } else if (type === "APPLICATION") {
      const isMatchingApp = (app) => {
        const appId = app?.currentApplication?.id || app?.id;
        return appId === key;
      };

      // Department-level app: remove only from applicationsList
      if (deleteData?.parentType === "DEPARTMENT" && currentWorkFlowJSON?.applicationsList) {
        const updatedApplicationsList = currentWorkFlowJSON.applicationsList.filter(
          (app) => !isMatchingApp(app)
        );
        templateStateManager.updateWorkFlowJSON(templateKey, {
          ...currentWorkFlowJSON,
          applicationsList: updatedApplicationsList,
        });
        return;
      }

      // Use deleteData.role when app is under role/location (RecursiveTemplateV2 passes location as roleKey for apps under location)
      const targetRoleKey =
        deleteData?.role ||
        roleKey ||
        templateStateManager.getCurrentRole(templateKey) ||
        Object.keys(currentWorkFlowJSON?.actions || {})[0];

      if (targetRoleKey && currentWorkFlowJSON?.actions[targetRoleKey]) {
        const updatedActions = { ...currentWorkFlowJSON?.actions };
        if (updatedActions[targetRoleKey]) {
          const updatedApplicationsList =
            updatedActions[targetRoleKey]?.applicationsList?.filter(
              (app) => !isMatchingApp(app)
            ) || [];

          if (updatedActions[targetRoleKey]?.actions) {
            Object.keys(updatedActions[targetRoleKey].actions).forEach(
              (locationName) => {
                updatedActions[targetRoleKey].actions[locationName] =
                  updatedActions[targetRoleKey].actions[locationName].filter(
                    (app) => !isMatchingApp(app)
                  );
              }
            );
          }

          updatedActions[targetRoleKey] = {
            ...updatedActions[targetRoleKey],
            applicationsList: updatedApplicationsList,
          };
        }
        templateStateManager.updateWorkFlowJSON(templateKey, {
          ...currentWorkFlowJSON,
          actions: updatedActions,
        });
      } else if (currentWorkFlowJSON?.departMentName) {
        const updates = { ...currentWorkFlowJSON };
        if (currentWorkFlowJSON?.applicationsList) {
          updates.applicationsList = currentWorkFlowJSON.applicationsList.filter(
            (app) => !isMatchingApp(app)
          );
        }
        if (currentWorkFlowJSON?.locationActions) {
          const updatedLocationActions = { ...currentWorkFlowJSON.locationActions };
          Object.keys(updatedLocationActions).forEach((locationName) => {
            updatedLocationActions[locationName] = updatedLocationActions[
              locationName
            ].filter((app) => !isMatchingApp(app));
          });
          updates.locationActions = updatedLocationActions;
        }
        templateStateManager.updateWorkFlowJSON(templateKey, updates);
      }
    }
  };

  const handleDivisionTemplateAddAction = (
    divisionName,
    templateId,
    action
  ) => {
    const templateKey = templateStateManager.getTemplateKey(
      templateId,
      divisionName
    );
    setCurrentTemplateId(templateKey);
    setIsTemplatePopupOpen(true);
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
    if (editWorkFlowObject?.id) {
      makeUIForEditWorkFlow();
    }
  }, [editWorkFlowObject]);

  const makeUIForEditWorkFlow = () => {
    console.log("editWorkFlowObject", editWorkFlowObject);
    setFormUrl(editWorkFlowObject?.formName);
    setFlowName(editWorkFlowObject?.name ? editWorkFlowObject?.name : formBased ? "Form Based Onboarding" : manualTrigger ? (offboarding === "true" ? "Manual Trigger Offboarding" : "Manual Trigger Onboarding") : "Automate Onboarding Workflows");
    const triggerCloud = cloudsList?.find(
      (data) => data?.id === editWorkFlowObject?.adminCloudId
    );

    const flowMapper = {
      [ACTION_TYPES.TRIGGER]: {
        currentApplication: triggerCloud,
        action: ACTION_TYPES.TRIGGER,
      },
      [ACTION_TYPES.PRIMARY_APPLICATION]: [],
    };

    if (editWorkFlowObject?.mandatoryApplications?.length > 0) {
      editWorkFlowObject.mandatoryApplications.forEach((data) => {
        let cpyData = { ...data };
        delete cpyData.usubscriptionIds;
        delete cpyData.groupIds;
        delete cpyData.roles;
        const cloudMapper = {
          currentApplication: {
            ...cpyData,
            providerName: data?.applicationName,
          },
          LICENSES: data?.usubscriptionIds || [],
          deleted: data?.deleted || false,
          GROUPS: data?.groupIds || [],
          roles: data?.roles || [],
          commonName: data?.commonName,
        };
        flowMapper[ACTION_TYPES.PRIMARY_APPLICATION].push(cloudMapper);
      });
    }

    if (editWorkFlowObject?.divisionDetails?.length > 0) {
      flowMapper[ACTION_TYPES.IF_ELSE] = {};

      const divisionsListFromAPI = editWorkFlowObject.divisionDetails.map(
        (data) =>
          data?.divisionName === null ? "Division Not Met" : data?.divisionName
      );
      setDivisionsList(divisionsListFromAPI);

      const divisionTemplatesMapFromAPI = {};

      editWorkFlowObject.divisionDetails.forEach((divisionData) => {
        const divisionName =
          divisionData?.divisionName === null
            ? "Division Not Met"
            : divisionData?.divisionName;
        const conditionalWorkFlows = divisionData?.conditionalWorkFlows || [];

        const templates = conditionalWorkFlows.map((workFlow, index) => {
          const rawDepartmentName =
            workFlow?.departmentName || workFlow?.conditionValue || null;
          const departmentName =
            rawDepartmentName === null
              ? "Department Not Met"
              : rawDepartmentName;

          const templateId =
            workFlow?.id || `template_${divisionName}_${index}`;

          const template = {
            id: templateId,
            workFlowName: departmentName || `Template ${index + 1}`,
            conditionValue: departmentName,
            workFlowApplications: workFlow?.workFlowApplications || [],
            mandatoryApplications: workFlow?.mandatoryApplications || [],
            userId: workFlow?.userId,
            type: workFlow?.type,
          };

          const workFlowJSON = {
            workFlowName: template.workFlowName,
            departMentName: departmentName,
            applicationsList: [],
            locationsList: [],
            locationActions: {},
            rolesList: [],
            actions: {},
          };

          // Load mandatoryApplications (department-level) into applicationsList
          if (workFlow?.mandatoryApplications?.length) {
            workFlow.mandatoryApplications.forEach((app) => {
              const subscriptionIds = app?.usubscriptionIds || [];
              workFlowJSON.applicationsList.push({
                currentApplication: {
                  ...(cloudsList?.find((c) => c?.id === app?.adminCloudId) || {}),
                  id: app?.adminCloudId,
                  providerName: app?.applicationName,
                  adminCloudId: app?.adminCloudId,
                },
                deleted: app?.deleted || false,
                LICENSES:
                  subscriptionIds?.map((sub) => {
                    if (typeof sub === "object" && sub !== null) {
                      return {
                        id: sub?.subscriptionId || sub?.id,
                        planName: sub?.subscriptionName || sub?.planName,
                        planId: sub?.subscriptionId || sub?.planId,
                      };
                    }
                    return { id: sub, planName: sub, planId: sub };
                  }) || [],
                GROUPS: app?.groupIds || [],
                roles: app?.roles || [],
                commonName: app?.commonName ?? null,
              });
            });
          }

          if (workFlow?.workFlowApplications) {
            workFlow.workFlowApplications.forEach((app) => {
              const subscriptionIds =
                app?.usubscriptionIds || app?.usubscriptionIds || [];

              let cpyData = { ...app };
              delete cpyData.usubscriptionIds;
              delete cpyData.groupIds;
              delete cpyData.roles;

              const appData = {
                currentApplication: {
                  ...cpyData,
                  providerName: app?.applicationName,
                },
                LICENSES:
                  subscriptionIds?.map((sub) => {
                    if (typeof sub === "object" && sub !== null) {
                      return {
                        id: sub?.subscriptionId || sub?.id,
                        planName: sub?.subscriptionName || sub?.planName,
                        planId: sub?.subscriptionId || sub?.planId,
                      };
                    }
                    return {
                      id: sub,
                      planName: sub,
                      planId: sub,
                    };
                  }) || [],
                deleted: app?.deleted || false,
                GROUPS:
                  app?.groupIds?.map((group) => ({
                    groupId: group?.groupId,
                    groupName: group?.groupName,
                  })) || [],
                roles: app?.roles || [],
                commonName: app?.commonName,
              };

              // workFlowApplications always go under role/location structure so Title/Location nodes render
              const roleName =
                app?.title == null || app?.title === ""
                  ? "Title Not Met"
                  : app?.title;
              const locationName =
                app?.location == null || app?.location === ""
                  ? "Location Not Met"
                  : app?.location;

              if (roleName && locationName) {
                if (!workFlowJSON.rolesList.includes(roleName)) {
                  workFlowJSON.rolesList.push(roleName);
                }

                if (!workFlowJSON.actions[roleName]) {
                  workFlowJSON.actions[roleName] = {
                    locationsList: [],
                    applicationsList: [],
                    actions: {},
                  };
                }

                if (
                  !workFlowJSON.actions[roleName].locationsList.includes(
                    locationName
                  )
                ) {
                  workFlowJSON.actions[roleName].locationsList.push(
                    locationName
                  );
                }

                if (!workFlowJSON.actions[roleName].actions[locationName]) {
                  workFlowJSON.actions[roleName].actions[locationName] = [];
                }

                workFlowJSON.actions[roleName].actions[locationName].push(
                  appData
                );
              } else if (roleName) {
                if (!workFlowJSON.rolesList.includes(roleName)) {
                  workFlowJSON.rolesList.push(roleName);
                }

                if (!workFlowJSON.actions[roleName]) {
                  workFlowJSON.actions[roleName] = {
                    locationsList: [],
                    applicationsList: [],
                    actions: {},
                  };
                }

                workFlowJSON.actions[roleName].applicationsList.push(appData);
              } else if (locationName) {
                if (!workFlowJSON.locationsList.includes(locationName)) {
                  workFlowJSON.locationsList.push(locationName);
                }

                if (!workFlowJSON.locationActions[locationName]) {
                  workFlowJSON.locationActions[locationName] = [];
                }

                workFlowJSON.locationActions[locationName].push(appData);
              } else {
                workFlowJSON.applicationsList.push(appData);
              }
            });
          }

          const templateKey = templateStateManager.getTemplateKey(
            template.id,
            divisionName
          );

          templateStateManager.setWorkFlowJSON(templateKey, workFlowJSON);
          templateStateManager.setDataMap(templateKey, workFlowJSON);

          return template;
        });

        if (!divisionTemplatesMapFromAPI[divisionName]) {
          divisionTemplatesMapFromAPI[divisionName] = [];
        }
        divisionTemplatesMapFromAPI[divisionName] = templates;
      });

      setDivisionTemplatesMap(divisionTemplatesMapFromAPI);
    } else if (editWorkFlowObject?.departMentWorkFlows?.length > 0) {
      // Legacy support for old format
      flowMapper[ACTION_TYPES.IF_ELSE] = {};
      flowMapper[ACTION_TYPES.ASSIGN_TEMPLATE] =
        editWorkFlowObject?.departMentWorkFlows;
      setSelectedTemplates(editWorkFlowObject?.departMentWorkFlows);
      const templates = editWorkFlowObject.departMentWorkFlows;

      templates.forEach((template) => {
        if (
          template?.id &&
          !templateStateManager.getWorkFlowJSON(template.id)
        ) {
          if (template?.workFlowApplications?.length || template?.mandatoryApplications?.length) {
            transformTemplateToWorkFlowJSON(template);
          } else {
            const rawDepartmentName =
              template?.conditionValue || template?.departmentName || null;
            const departmentName =
              rawDepartmentName === null
                ? "Department Not Met"
                : rawDepartmentName;

            templateStateManager.setWorkFlowJSON(template.id, {
              workFlowName:
                template?.workFlowName || template?.name || "Template",
              departMentName: departmentName,
              applicationsList: [],
              locationsList: [],
              locationActions: {},
              rolesList: [],
              actions: {},
              deleted: template?.deleted || false,
            });
          }
        }
      });
    }

    setFlowActionsList(flowMapper);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("json");
    setWaitingForDragging(null);
    setIsPopupOpen(false);
    setIsTemplatePopupOpen(false);
    setCurrentTemplateId(null);
    const jsonData = parseDropData(data);
    if (jsonData) {
      // If dropping from CustomTemplateActionPannel for PRIMARY_APPLICATION, ensure it's added correctly
      if (
        currentTemplateId === "PRIMARY_APPLICATION_ADD" &&
        jsonData?.action === "ONBOARD_TO_APPLICATIONS"
      ) {
        handleAddToFlow(jsonData, ACTION_TYPES.PRIMARY_APPLICATION);
      } else {
        handleDropAction(jsonData, handleAddToFlow);
      }
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

  useEffect(() => {
    if (flowActionsList[ACTION_TYPES.IF_ELSE] && !workFlowId) {
      shadowSaveWorkFlow()
    }
  }, [flowActionsList[ACTION_TYPES.IF_ELSE]]);


  const shadowSaveWorkFlow = async () => {
    if (shadowWorkflowId) {
      return;
    }
    let apiBody = {
      adminCloudId: flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.id,
      providerName: flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.providerName === "OTHERS" ? flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.externalProviderName : flowActionsList[ACTION_TYPES.TRIGGER]?.currentApplication?.providerName,
      delete: true,
      active: false,
      manual: false,
      recurring: true,
      workFlowName: offboarding === "true" ? "OFFBOARD" : "ONBOARD",
    }
    setIsPageLoading(true);
    let res = await saveNewWorkFlow(apiBody);
    if (res?.status === "OK") {
      setShadowWorkflowId(res?.res?.id);
      getConfigurations(res?.res?.providerName, res?.res?.id);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  }


  const handleSaveApplicationEditObject = async (e, action) => {
    if (action === "DELETE") {
      // return;
    }

    // Handle PRIMARY_APPLICATION edit
    if (e?.type === "PRIMARY_APPLICATION") {
      const updatedApplication = {
        currentApplication: e?.application?.currentApplication,
        LICENSES: e?.application?.LICENSES || [],
        deleted: e?.application?.deleted || false,
        GROUPS: e?.application?.GROUPS || [],
        roles: e?.application?.roles || [],
        commonName: e?.application?.commonName,
      };

      // Update the flowActionsList with the edited application
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

    // Create mode: update templateStateManager for division template edit
    if (!editWorkFlowObject && e?.divisionName && e?.templateId) {
      const templateKey = templateStateManager.getTemplateKey(
        e.templateId,
        e.divisionName
      );
      const currentWorkFlowJSON =
        templateStateManager.getWorkFlowJSON(templateKey);
      if (!currentWorkFlowJSON) {
        setIsTemplatePopupOpen(false);
        setCurrentTemplateId(null);
        setEditObject(null);
        return;
      }

      const appId =
        e?.application?.currentApplication?.id || e?.application?.currentApplication?.adminCloudId;
      const updatedApp = {
        currentApplication: e?.application?.currentApplication,
        LICENSES: e?.application?.LICENSES || [],
        deleted: e?.application?.deleted || false,
        GROUPS: e?.application?.GROUPS || [],
        roles: e?.application?.roles || [],
        commonName: e?.application?.commonName ?? null,
      };

      const applyEdit = (app) => {
        const id = app?.currentApplication?.id || app?.currentApplication?.adminCloudId || app?.id;
        return id === appId ? { ...app, ...updatedApp } : app;
      };

      let updatedWorkFlowJSON = { ...currentWorkFlowJSON };

      if (e?.parentType === "DEPARTMENT" && currentWorkFlowJSON?.applicationsList) {
        updatedWorkFlowJSON.applicationsList =
          currentWorkFlowJSON.applicationsList.map(applyEdit);
      } else if (e?.role && e?.location && currentWorkFlowJSON?.actions?.[e.role]?.actions?.[e.location]) {
        updatedWorkFlowJSON = {
          ...currentWorkFlowJSON,
          actions: {
            ...currentWorkFlowJSON.actions,
            [e.role]: {
              ...currentWorkFlowJSON.actions[e.role],
              actions: {
                ...currentWorkFlowJSON.actions[e.role].actions,
                [e.location]: currentWorkFlowJSON.actions[e.role].actions[e.location].map(applyEdit),
              },
            },
          },
        };
      } else if (e?.role && currentWorkFlowJSON?.actions?.[e.role]?.applicationsList) {
        updatedWorkFlowJSON = {
          ...currentWorkFlowJSON,
          actions: {
            ...currentWorkFlowJSON.actions,
            [e.role]: {
              ...currentWorkFlowJSON.actions[e.role],
              applicationsList: currentWorkFlowJSON.actions[e.role].applicationsList.map(applyEdit),
            },
          },
        };
      } else if (e?.location && currentWorkFlowJSON?.locationActions?.[e.location]) {
        updatedWorkFlowJSON = {
          ...currentWorkFlowJSON,
          locationActions: {
            ...currentWorkFlowJSON.locationActions,
            [e.location]: currentWorkFlowJSON.locationActions[e.location].map(applyEdit),
          },
        };
      }

      templateStateManager.updateWorkFlowJSON(templateKey, updatedWorkFlowJSON);
      setIsTemplatePopupOpen(false);
      setCurrentTemplateId(null);
      setEditObject(null);
      return;
    }

    // Handle template/division application edits (existing logic)
    let cpyEditObject = { ...editWorkFlowObject || {} };

    let divDetails = cpyEditObject?.divisionDetails || [];

    let currentConditionalVal = null;

    divDetails = divDetails.map((data) => {
      const updatedConditionalWorkFlows = data?.conditionalWorkFlows?.map(
        (wfl) => {
          let isCondFlowUpdated = false;
          let updatedWfl = { ...wfl };

          if (action === "DELETE") {
            const originalWflLength = wfl?.workFlowApplications?.length ?? 0;
            const originalMandLength = wfl?.mandatoryApplications?.length ?? 0;
            updatedWfl.workFlowApplications = wfl?.workFlowApplications?.filter(
              (app) => {
                if (e?.type === "LOCATION") {
                  if (wfl?.conditionValue === e?.department) {
                    return app?.location !== e?.location;
                  }
                  return true;
                } else if (e?.type === "ROLE") {
                  if (wfl?.conditionValue === e?.department) {
                    return app?.title !== e?.role;
                  }
                  return true;
                } else {
                  const appId = app?.adminCloudId || app?.id;
                  const targetId = e?.application?.currentApplication?.id || e?.application?.currentApplication?.adminCloudId;
                  return appId !== targetId;
                }
              }
            );
            if (e?.type === "APPLICATION" || (!e?.type && e?.application)) {
              updatedWfl.mandatoryApplications = (wfl?.mandatoryApplications || []).filter(
                (app) => {
                  const appId = app?.adminCloudId || app?.id;
                  const targetId = e?.application?.currentApplication?.id || e?.application?.currentApplication?.adminCloudId;
                  return targetId == null || appId !== targetId;
                }
              );
            } else {
              updatedWfl.mandatoryApplications = wfl?.mandatoryApplications || [];
            }
            const newWflLength = updatedWfl.workFlowApplications?.length ?? 0;
            const newMandLength = updatedWfl.mandatoryApplications?.length ?? 0;
            if (newWflLength !== originalWflLength || newMandLength !== originalMandLength) {
              isCondFlowUpdated = true;
            }
          } else {
            const appToApiFormat = (app) => ({
              ...app,
              usubscriptionIds:
                e?.application?.LICENSES?.map((curr) => ({
                  subscriptionName: curr?.planName,
                  subscriptionId: curr?.id,
                })) || [],
              groupIds: e?.application?.GROUPS || [],
              roles: e?.application?.roles || [],
              commonName: e?.application?.commonName,
            });
            const targetId = e?.application?.currentApplication?.id || e?.application?.currentApplication?.adminCloudId;
            updatedWfl.workFlowApplications = wfl?.workFlowApplications?.map(
              (app) => {
                const appId = app?.adminCloudId || app?.id;
                if (appId === targetId) {
                  isCondFlowUpdated = true;
                  return appToApiFormat(app);
                }
                return app;
              }
            );
            updatedWfl.mandatoryApplications = (wfl?.mandatoryApplications || []).map(
              (app) => {
                const appId = app?.adminCloudId || app?.id;
                if (appId === targetId) {
                  isCondFlowUpdated = true;
                  return appToApiFormat(app);
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
                        <Workflow size={18} />
                      </div>
                      {manualTrigger ? isWorkflowNameEditable ? (
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
                          style={{ cursor: "pointer", fontSize: "12px" }}
                        >
                          {flowName || formBased || manualTrigger ? flowName ? flowName : formBased ? "Form Based Onboarding" : "Manual Trigger Onboarding" : "Automate Onboarding Workflows"}
                        </p>
                      ) : <p className="cf_newFlow_trigger_pannel_header_name">
                        Automate Onboarding Workflow
                      </p>}
                    </div>
                  </div>
                  {formBased === "true" && <div className="cf_newFlow_trigger_pannel cf_action_trigger cf_action_triggerV3" style={{ marginTop: "60px" }}>
                    <div className="cf_newFlow_trigger_pannel_header">
                      <div className="cf_newFlow_trigger_pannel_header_icon">
                        <ClipboardList size={18} />
                      </div>
                      {formBased ? isFormUrlEditable ? (
                        <div style={{ width: "calc(100% - 100px)" }}>
                          <TextInputUpdate
                            defaultVal={formUrl}
                            inputWidth="220px"
                            inputHeight="40px"
                            customActionStyles={{ top: "45px" }}
                            closeAction={() => setIsFormUrlEditable(false)}
                            saveAction={(value) => {
                              setFormUrl(value);
                              setIsFormUrlEditable(false);
                            }}
                          />
                        </div>
                      ) : (
                        <p
                          className="cf_newFlow_trigger_pannel_header_name"
                          onClick={() => setIsFormUrlEditable(true)}
                          style={{ cursor: "pointer", fontSize: "12px", whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}
                        >
                          {formUrl ? formUrl : "Configure Form Response Excel URL"}
                        </p>
                      ) : <p className="cf_newFlow_trigger_pannel_header_name">
                        Form URL
                      </p>}
                    </div>
                  </div>}
                  {!!flowActionsList[ACTION_TYPES.TRIGGER] && manualTrigger !== "true" && formBased !== "true" && (
                    <ActionPanel
                      action={flowActionsList[ACTION_TYPES.TRIGGER]}
                      borderColor="#fa8248"
                      backgroundColor="#f9bfa22b"
                      icon={
                        <p style={{ fontSize: "18px", fontWeight: "500" }}>
                          ⚡
                        </p>
                      }
                      title="When User Onboarded in"
                      subtitle={getCloudName(
                        flowActionsList[ACTION_TYPES.TRIGGER]
                          ?.currentApplication?.providerName === "OTHERS" ? flowActionsList[ACTION_TYPES.TRIGGER]
                            ?.currentApplication?.externalProviderName : flowActionsList[ACTION_TYPES.TRIGGER]
                              ?.currentApplication?.providerName
                      )}
                    />
                  )}
                  {flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]?.map(
                    (res) => (
                      <ActionPanel
                        key={res?.currentApplication?.id + "APPLICATION"}
                        action={res}
                        onEdit={offboarding ? null : () => {
                          if (offboarding) {
                            return null;
                          } else {
                            handleEditObject({
                              ...res,
                              type: "PRIMARY_APPLICATION",
                            })
                          }
                        }
                        }
                        onDelete={() =>
                          deleteAction(res, ACTION_TYPES.PRIMARY_APPLICATION)
                        }
                        showDelete={
                          flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]
                            ?.length > 1 ||
                          !flowActionsList[ACTION_TYPES.IF_ELSE]
                        }
                        borderColor="#0062ff"
                        backgroundColor="rgb(178 199 255 / 14%)"
                        imageSrc={cloudImageMapper(
                          res?.currentApplication?.providerName, res?.currentApplication?.externalProviderName
                        )}
                        imageAlt={res?.currentApplication?.providerName === "OTHERS" ? res?.currentApplication?.externalProviderName : res?.currentApplication?.providerName}
                        title="Onboard User to"
                        subtitle={getCloudName(
                          res?.currentApplication?.providerName === "OTHERS" ? res?.currentApplication?.externalProviderName : res?.currentApplication?.providerName
                        )}
                      />
                    )
                  )}
                  {!!flowActionsList[ACTION_TYPES.IF_ELSE] && (
                    <ActionPanel
                      action={flowActionsList[ACTION_TYPES.IF_ELSE]}
                      onDelete={() => deleteAction({}, ACTION_TYPES.IF_ELSE)}
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
                  )}

                  <div
                    className="CF_d-flex"
                    style={{
                      marginTop: flowActionsList[ACTION_TYPES.IF_ELSE]
                        ? "25px"
                        : "0px",
                    }}
                  >
                    {divisionsList?.length > 0 && (
                      <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                        <div
                          className="cf_department_based_action_container_dottedLine_role"
                          style={{
                            width: `calc(100% - ${calculateWidth(
                              "DIVISION",
                              scale
                            )}px)`,
                          }}
                        ></div>
                        {divisionsList?.map((divisionName, index) => (
                          <div
                            key={divisionName + "DIVISION"}
                            className="CF_d-flex"
                            id={`cf_roleLevel_container_DIVISION_${index}`}
                            style={{
                              flexDirection: "column",
                              justifyContent: "center",
                              alignItems: "center",
                              position: "relative",
                            }}
                          >
                            <ActionPanel
                              action={divisionName}
                              onDelete={() =>
                                deleteAction(divisionName, "DIVISION")
                              }
                              borderColor={colorPairs[index]?.dark}
                              backgroundColor={colorPairs[index]?.dull}
                              icon={
                                <Building
                                  size={22}
                                  color={colorPairs[index]?.dark}
                                />
                              }
                              title={divisionName}
                            />
                            {divisionTemplatesMap[divisionName]?.length > 0 ? (
                              <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                                <>
                                  <div
                                    className="cf_department_based_action_container_dottedLine_role"
                                    style={{
                                      width: `calc(100% - ${calculateWidth(
                                        "DIVISION_TEMPLATES",
                                        scale,
                                        divisionTemplatesMap[divisionName][0]
                                          ?.conditionValue
                                      )}px)`,
                                    }}
                                  ></div>
                                  {divisionTemplatesMap[divisionName]?.map(
                                    (template) => {
                                      const templateId = template?.id;
                                      const templateKey =
                                        templateStateManager.getTemplateKey(
                                          templateId,
                                          divisionName
                                        );
                                      const templateWorkFlowJSON =
                                        templateStateManager.getWorkFlowJSON(
                                          templateKey
                                        ) ||
                                        templateStateManager.getDataMap(
                                          templateKey
                                        );
                                      return (
                                        <div key={templateKey + "TEMPLATE"}>
                                          {templateWorkFlowJSON && (
                                            <RecursiveTemplateV2
                                              editAction={(e) =>
                                                handleEditObject({
                                                  ...e,
                                                  divisionName: divisionName,
                                                  templateId: templateId,
                                                })
                                              }
                                              scale={scale}
                                              workFlowJSON={
                                                templateWorkFlowJSON
                                              }
                                              level={0}
                                              onDelete={(
                                                key,
                                                type,
                                                roleKey,
                                                deleteData
                                              ) =>
                                                handleDivisionTemplateDelete(
                                                  divisionName,
                                                  templateId,
                                                  key,
                                                  type,
                                                  roleKey,
                                                  {
                                                    ...deleteData,
                                                    divisionName: divisionName,
                                                  }
                                                )
                                              }
                                              onAddAction={(action) =>
                                                handleDivisionTemplateAddAction(
                                                  divisionName,
                                                  templateId,
                                                  action
                                                )
                                              }
                                              waitingForDragging={templateStateManager.getWaitingForDragging(
                                                templateKey
                                              )}
                                              onDrop={(e) =>
                                                handleDivisionTemplateDrop(
                                                  divisionName,
                                                  templateId,
                                                  e
                                                )
                                              }
                                              currentRole={templateStateManager.getCurrentRole(
                                                templateKey
                                              )}
                                              setCurrentRole={(role) =>
                                                templateStateManager.setCurrentRole(
                                                  templateKey,
                                                  role
                                                )
                                              }
                                              currentLocation={templateStateManager.getCurrentLocation(
                                                templateKey
                                              )}
                                              setCurrentLocation={(location) =>
                                                templateStateManager.setCurrentLocation(
                                                  templateKey,
                                                  location
                                                )
                                              }
                                              setEnableOptionsList={(options) =>
                                                templateStateManager.setEnableOptionsList(
                                                  templateKey,
                                                  options
                                                )
                                              }
                                              setWaitingForDragging={(
                                                waiting
                                              ) =>
                                                templateStateManager.setWaitingForDragging(
                                                  templateKey,
                                                  waiting
                                                )
                                              }
                                              viewMode={true}
                                            />
                                          )}
                                        </div>
                                      );
                                    }
                                  )}
                                  {waitingForDragging ===
                                    `SELECT_DIVISION_TEMPLATE_${divisionName}` ? (
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
                                        Drag and drop here to add a Template
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="cf_action_trigger cf_action_triggerV3 cf_action_trigger_for_department">
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
                                          addAction("DIVISION_TEMPLATE_SELECT");
                                          setCurrentDivision(divisionName);
                                          setWaitingForDragging(
                                            `SELECT_DIVISION_TEMPLATE_${divisionName}`
                                          );
                                        }}
                                      >
                                        <Plus size={16} />
                                      </ActionButton>
                                    </div>
                                  )}
                                </>
                              </div>
                            ) : (
                              ""
                            )}
                            {divisionTemplatesMap[divisionName]?.length ===
                              0 ? (
                              waitingForDragging ===
                                `SELECT_DIVISION_TEMPLATE_${divisionName}` ? (
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
                                  <p>Drag and drop here to add a Template</p>
                                </div>
                              ) : (
                                <div className="cf_action_trigger cf_action_triggerV3">
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
                                      addAction("DIVISION_TEMPLATE_SELECT");
                                      setCurrentDivision(divisionName);
                                      setWaitingForDragging(
                                        `SELECT_DIVISION_TEMPLATE_${divisionName}`
                                      );
                                    }}
                                  >
                                    <Plus size={16} />
                                  </ActionButton>
                                </div>
                              )
                            ) : (
                              ""
                            )}
                          </div>
                        ))}
                        {waitingForDragging ===
                          WAITING_STATES.SELECT_DIVISION ? (
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
                            <p>Drag and drop here to add a Division</p>
                          </div>
                        ) : (
                          <div className="cf_action_trigger cf_action_triggerV3 cf_action_trigger_for_department">
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
                                setWaitingForDragging(
                                  WAITING_STATES.SELECT_DIVISION
                                );
                              }}
                            >
                              <Plus size={16} />
                            </ActionButton>
                          </div>
                        )}
                      </div>
                    )}
                    {departmentList?.length > 0 ? (
                      <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                        <div className="cf_department_based_action_container_dottedLine"></div>
                        {departmentList?.map((res, index) => (
                          <div
                            key={res + "DEPARTMENT"}
                            className="CF_d-flex"
                            style={{
                              flexDirection: "column",
                              justifyContent: "center",
                              alignItems: "center",
                              position: "relative",
                            }}
                          >
                            <ActionPanel
                              action={res}
                              onDelete={() => deleteAction(res, "DEPARTMENT")}
                              borderColor={colorPairs[index]?.dark}
                              backgroundColor={colorPairs[index]?.dull}
                              icon={
                                <Building
                                  size={22}
                                  color={colorPairs[index]?.dark}
                                />
                              }
                              title={res}
                            />
                            {departMentAppMap[res]?.map((deptRes) => (
                              <ActionPanel
                                key={
                                  deptRes?.currentApplication?.id +
                                  "APPLICATION"
                                }
                                action={deptRes}
                                onDelete={() =>
                                  deleteAction(deptRes, "DEPT_APP_SELECT", res)
                                }
                                borderColor={colorPairs[index]?.dark}
                                backgroundColor={colorPairs[index]?.dull}
                                imageSrc={cloudImageMapper(
                                  deptRes?.currentApplication?.providerName, deptRes?.currentApplication?.externalProviderName
                                )}
                                imageAlt={
                                  deptRes?.currentApplication?.providerName === "OTHERS" ? deptRes?.currentApplication?.externalProviderName : deptRes?.currentApplication?.providerName
                                }
                                title="Onboard User to"
                                subtitle={getCloudName(
                                  deptRes?.currentApplication?.providerName === "OTHERS" ? deptRes?.currentApplication?.externalProviderName : deptRes?.currentApplication?.providerName
                                )}
                              />
                            ))}
                            {waitingForDragging ===
                              `SELECT_DEPARTMENT_${res}` ? (
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
                                <p>Drag and drop here to add an Application</p>
                              </div>
                            ) : (
                              <div className="cf_action_trigger cf_action_triggerV3">
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
                                    addAction("DEPT_APP_SELECT");
                                    setCurrentDepartment(res);
                                    setWaitingForDragging(
                                      `SELECT_DEPARTMENT_${res}`
                                    );
                                  }}
                                >
                                  <Plus size={16} />
                                </ActionButton>
                              </div>
                            )}
                          </div>
                        ))}

                        {waitingForDragging ===
                          WAITING_STATES.SELECT_DEPARTMENT ? (
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
                            <p>Drag and drop here to add a Department</p>
                          </div>
                        ) : (
                          <div className="cf_action_trigger cf_action_triggerV3 cf_action_trigger_for_department">
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
                                setWaitingForDragging(
                                  WAITING_STATES.SELECT_DEPARTMENT
                                );
                              }}
                            >
                              <Plus size={16} />
                            </ActionButton>
                          </div>
                        )}
                      </div>
                    ) : (
                      ""
                    )}

                    {divisionsList?.length === 0 &&
                      departmentList?.length === 0 &&
                      !flowActionsList[ACTION_TYPES.ASSIGN_TEMPLATE] &&
                      (waitingForDragging === WAITING_STATES.GLOBAL ? (
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
                            Drag and drop here to add a{" "}
                            {manualTrigger ? "Application" : "Trigger"}
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
                              setWaitingForDragging(WAITING_STATES.GLOBAL);
                            }}
                          >
                            <Plus size={16} />
                          </ActionButton>
                        </div>
                      ))}
                  </div>
                </div>
                {/* !editWorkFlowObject?.id && */}
                {(divisionsList?.length > 0 &&
                  !!flowActionsList[ACTION_TYPES.TRIGGER]) ||
                  (manualTrigger &&
                    flowActionsList[ACTION_TYPES.PRIMARY_APPLICATION]?.length >
                    0) ? (
                  <div
                    className="cf_zoom_percentage_container"
                    style={{
                      top: "20px",
                      right:
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
                      buttonClickAction={handleSaveWorkFlow}
                    >
                      <p>Save</p>
                    </ActionButton>
                  </div>
                ) : ""}
                <div
                  className="cf_newBox_Shadow cf_zoom_percentage_container"
                  style={{
                    right:
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
                offboarding={offboarding}
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
                  manualTrigger ? selectedApplicationList :
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
                offboarding={offboarding}
              />
            )}
            {isCreateTemplate && (
              <Popup
                options={{
                  isOpen: isCreateTemplate,
                  title: `Create New Template`,
                  popupWidth: "100%",
                  type: "side",
                  popupHeight: "calc(100% - 0px)",
                  popupTop: "00px",
                  maxHeight: "100%",
                  overflowY: "auto",
                  titleCustomStyles: {
                    fontSize: "16px",
                    fontWeight: "600",
                    color: "#fff",
                  },
                  parentStyles: {
                    justifyContent: "flex-end",
                  },
                  titleDivStyles: {
                    backgroundColor: "#0062ff",
                  },
                  disableEscapeKey: true,
                }}
                toggleOpen={setIsCreateTemplate}
              >
                <div
                  className="cf_popup_container_body"
                  style={{
                    padding: "0 15px 15px 15px",
                    height: "100%",
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    flexDirection: "column",
                    gap: "10px",
                    width: "100%",
                  }}
                >
                  <CustomeTemplate
                    isTemplateCreateFromWorkflow={true}
                    setIsCreateTemplate={setIsCreateTemplate}
                    fetchTemplates={fetchTemplates}
                  />
                </div>
              </Popup>
            )}
          </div>
        </div>
      </div>

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default NewFlowV4;
