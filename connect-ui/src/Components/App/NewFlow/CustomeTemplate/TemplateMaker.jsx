import { ChevronUp, Maximize, Minus, Plus, Workflow } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { notifyToast, zoomToFit } from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import TextInputUpdate from "../../../Resuables/InputsComponents/TextInputUpdate";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import { getSaaSRolesForApplication } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { getTemplatesList, saveTemplateWorkFlow } from "../../UserManagement/UserManagementActions/UserManagementActions";
import ActionPanel from "../components/ActionPanel";
import "../css/NewFlow.css";
import { makeApplicationsBody } from "../utils/workflowUtils";
import CustomTemplateActionPannel from "./CustomTemplateActionPannel";
import RecursiveTemplateV2 from "./RecursiveTemplateV2";

const TemplateMaker = ({
  isTemplateCreateFromWorkflow = false,
  setIsCreateTemplate = null,
  fetchTemplates = null,
}) => {
  const [workFlowJSON, setWorkFlowJSON] = useState({
    workFlowName: "Custom Template",
    actions: [],
    rolesList: [],
  });
  const navigate = useNavigate();
  const [queryParams] = useSearchParams();
  const templateId = queryParams.get("templateId");
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [licenseInfoMap, setLicenseInfoMap] = useState({});
  const [currentRole, setCurrentRole] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [waitingForDragging, setWaitingForDragging] = useState(null);
  const [enableOptionsList, setEnableOptionsList] = useState([]);
  const [selectedApplicationList, setSelectedApplicationList] = useState([]);
  const [isWorkflowNameEditable, setIsWorkflowNameEditable] = useState(false);
  const [editObject, setEditObject] = useState(null);
  const [isApprovalEmailOpen, setIsApprovalEmailOpen] = useState(false);
  const [isGoogleWorkspaceDataTransferOpen, setIsGoogleWorkspaceDataTransferOpen] = useState(false);
  const [approvalEmail, setApprovalEmail] = useState(null);
  const [googleWorkSpaceDataTransferEmail, setGoogleWorkSpaceDataTransferEmail] = useState(null);
  const [primaryApplicationsList, setPrimaryApplicationsList] = useState([]);
  const [actionsList, setActionsList] = useState({
    titles: [],
    locations: [],
    divisions: [],
  });
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const innerRef = useRef(null);
  const position = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const [templatesList, setTemplatesList] = useState([]);
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);
  const [selectedTemplatesList, setSelectedTemplatesList] = useState([]);

  // useEffect(() => {
  //   fetchTemplates();
  // }, []);

  const fetchTemplatesInternal = async () => {
    if (templatesList?.length > 0) {
      return;
    }
    setIsTemplatesLoading(true);
    let res = await getTemplatesList();
    if (res?.status === "OK") {
      setTemplatesList(res?.res || []);
    }
    setIsTemplatesLoading(false);
  }

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

  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === "Escape" && isPopupOpen) {
        event.preventDefault();
        event.stopPropagation();
        setIsPopupOpen(false);
        setWaitingForDragging(null);
        setCurrentRole(null);
        setCurrentLocation(null);
        setEnableOptionsList([]);
      }
    };

    if (isPopupOpen) {
      window.addEventListener("keydown", handleEscapeKey);
    }

    return () => {
      window.removeEventListener("keydown", handleEscapeKey);
    };
  }, [isPopupOpen]);

  const onWheelZoom = (e) => {
    const zoomIntensity = 0.001;
    const next = Math.min(Math.max(scale - e.deltaY * zoomIntensity, 0.3), 2);
    setScale(next);
    innerRef.current.style.transform = `translate(${position.current.x}px, ${position.current.y}px) scale(${next})`;
  };

  const onMouseDown = (e) => {
    isDragging.current = true;
    dragStart.current = {
      x: e.clientX - position.current.x,
      y: e.clientY - position.current.y,
    };
  };

  const onMouseMove = (e) => {
    if (!isDragging.current) return;

    position.current = {
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    };

    requestAnimationFrame(() => {
      innerRef.current.style.transform = `translate(${position.current.x}px, ${position.current.y}px) scale(${scale})`;
    });
  };

  const stopDrag = () => {
    isDragging.current = false;
  };

  const resetZoom = () => {
    const { x, y, scale } = zoomToFit(containerRef, innerRef);
    position.current = { x: x, y: y };
    setScale(scale);
    innerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    setScale(scale);
  };

  const templateAppsToAppData = (templateObject) => {
    const appDataList = [];
    const mapApp = (app) => {
      const subIds = app?.usubscriptionIds || [];
      const licenses = subIds.map((sub) =>
        typeof sub === "object" && sub !== null
          ? { id: sub?.subscriptionId || sub?.id, planName: sub?.subscriptionName || sub?.planName, planId: sub?.subscriptionId || sub?.planId }
          : { id: sub, planName: sub, planId: sub }
      );
      const groups = (app?.groupIds || []).map((g) => ({
        groupId: g?.groupId ?? g,
        groupName: g?.groupName ?? g,
      }));
      return {
        currentApplication: {
          id: app?.adminCloudId,
          providerName: app?.applicationName,
        },
        deleted: app?.deleted || false,
        LICENSES: licenses,
        GROUPS: groups,
        roles: app?.roles || [],
        commonName: app?.commonName ?? null,
      };
    };
    (templateObject?.mandatoryApplications || []).forEach((app) => appDataList.push(mapApp(app)));
    (templateObject?.workFlowApplications || []).forEach((app) => appDataList.push(mapApp(app)));
    return appDataList;
  };

  const handleDrop = (e) => {
    e.preventDefault();
    let data = JSON.parse(e.dataTransfer.getData("json"));
    if ((data?.action === "ONBOARD_TO_APPLICATIONS" && !workFlowJSON?.departMentName) || (data?.action === "ASSIGN_TEMPLATE" && !workFlowJSON?.departMentName)) {
      if (data?.action === "ASSIGN_TEMPLATE") {

        let existingApplicationList = primaryApplicationsList?.reduce((acc, curr) => {
          acc.push(curr?.providerName)
        }, []);

        let templateMap = []

        data?.templateObject?.mandatoryApplications?.forEach((app) => {
          if (!existingApplicationList.includes(app?.applicationName)) {
            templateMap.push({
              id: app?.id,
              currentApplication: { ...(cloudsList.find((cloud) => cloud?.id === app?.adminCloudId) || {}), adminCloudId: app?.adminCloudId },
              deleted: data?.deleted || false,
              LICENSES: data?.usubscriptionIds || [],
              GROUPS: data?.groupIds || [],
              roles: data?.roles || [],
              commonName: data?.commonName || null,
            });
          }
        })

        setPrimaryApplicationsList([...primaryApplicationsList, ...templateMap]);
      } else {
        setPrimaryApplicationsList([...primaryApplicationsList, {
          currentApplication: data?.currentApplication,
          deleted: data?.deleted || false,
          LICENSES: data?.LICENSES || [],
          GROUPS: data?.GROUPS || [],
          roles: data?.roles || [],
          commonName: data?.commonName || null,
        }]);
      }
    } else if (data?.action === "SELECT_DEPARTMENT") {
      setWorkFlowJSON({
        departMentName: data?.department?.name,
        actions: {},
        rolesList: [],
        locationsList: [],
        locationActions: {},
        applicationsList: [],
      });
    } else if (data?.action === "SELECT_ROLE") {
      setWorkFlowJSON({
        ...workFlowJSON,
        actions: {
          ...workFlowJSON?.actions,
          [data?.role]: {
            locationsList: [],
            applicationsList: [],
            actions: {},
          },
        },
        rolesList: [...workFlowJSON?.rolesList, data?.role],
      });
    } else if (data?.action === "SELECT_LOCATION") {
      let currentRole = data?.currentRole;

      const isDepartmentLevelDrop =
        waitingForDragging === "SELECT_ROLE" ||
        waitingForDragging === "SELECT_DEPARTMENT_LOCATION";

      if (isDepartmentLevelDrop && workFlowJSON?.departMentName) {
        const currentLocationsList = workFlowJSON?.locationsList || [];
        const currentLocationActions = workFlowJSON?.locationActions || {};

        let updatedLocationsList = [...currentLocationsList];
        if (!updatedLocationsList.includes(data?.location?.name)) {
          updatedLocationsList.push(data?.location?.name);
        }

        let updatedLocationActions = { ...currentLocationActions };
        if (!updatedLocationActions[data?.location?.name]) {
          updatedLocationActions[data?.location?.name] = [];
        }

        setWorkFlowJSON({
          ...workFlowJSON,
          locationsList: updatedLocationsList,
          locationActions: updatedLocationActions,
        });
      } else if (currentRole) {
        const roleData = workFlowJSON?.actions[currentRole] || {
          locationsList: [],
          applicationsList: [],
          actions: {},
        };

        let currentActions = roleData?.actions || {};
        let currentLocationsList = roleData?.locationsList || [];

        if (!currentLocationsList.includes(data?.location?.name)) {
          currentLocationsList.push(data?.location?.name);
        }

        if (!currentActions[data?.location?.name]) {
          currentActions[data?.location?.name] = [];
        }

        setWorkFlowJSON({
          ...workFlowJSON,
          actions: {
            ...workFlowJSON?.actions,
            [currentRole]: {
              ...roleData,
              locationsList: currentLocationsList,
              actions: currentActions,
            },
          },
        });
      } else if (workFlowJSON?.departMentName) {
        const currentLocationsList = workFlowJSON?.locationsList || [];
        const currentLocationActions = workFlowJSON?.locationActions || {};

        let updatedLocationsList = [...currentLocationsList];
        if (!updatedLocationsList.includes(data?.location?.name)) {
          updatedLocationsList.push(data?.location?.name);
        }

        let updatedLocationActions = { ...currentLocationActions };
        if (!updatedLocationActions[data?.location?.name]) {
          updatedLocationActions[data?.location?.name] = [];
        }

        setWorkFlowJSON({
          ...workFlowJSON,
          locationsList: updatedLocationsList,
          locationActions: updatedLocationActions,
        });
      }
    } else if (data?.action === "ONBOARD_TO_APPLICATIONS") {
      if (
        waitingForDragging === "SELECT_DEPARTMENT_APPLICATION" ||
        (waitingForDragging === "SELECT_DEPARTMENT_LOCATION" &&
          workFlowJSON?.departMentName &&
          (!workFlowJSON?.rolesList || workFlowJSON.rolesList.length === 0))
      ) {
        const currentApplicationsList = workFlowJSON?.applicationsList || [];
        setWorkFlowJSON({
          ...workFlowJSON,
          applicationsList: [
            ...currentApplicationsList,
            {
              currentApplication: data?.currentApplication,
              deleted: data?.deleted || false,
              LICENSES: data?.LICENSES || [],
              GROUPS: data?.GROUPS || [],
              roles: data?.roles || [],
              commonName: data?.commonName || null,
            },
          ],
        });
      } else if (waitingForDragging?.startsWith("SELECT_DEPARTMENT_")) {
        const roleName = waitingForDragging.replace("SELECT_DEPARTMENT_", "");
        const roleData = workFlowJSON?.actions[roleName] || {};
        const currentApplicationsList = roleData?.applicationsList || [];

        if (!roleData?.locationsList || roleData.locationsList.length === 0) {
          setWorkFlowJSON({
            ...workFlowJSON,
            actions: {
              ...workFlowJSON?.actions,
              [roleName]: {
                ...roleData,
                applicationsList: [
                  ...currentApplicationsList,
                  {
                    currentApplication: data?.currentApplication,
                    deleted: data?.deleted || false,
                    LICENSES: data?.LICENSES || [],
                    GROUPS: data?.GROUPS || [],
                    roles: data?.roles || [],
                    commonName: data?.commonName || null,
                  },
                ],
              },
            },
          });
        }
      } else if (waitingForDragging?.startsWith("SELECT_LOCATION_")) {
        const waitingKeyParts = waitingForDragging
          .replace("SELECT_LOCATION_", "")
          .split("_");
        let locationName;
        let locationUnderRole = null;

        if (currentRole && currentLocation) {
          locationName = currentLocation;
          locationUnderRole = currentRole;
        } else {
          if (waitingKeyParts.length > 1) {
            const roleNameParts = waitingKeyParts.slice(0, -1);
            const roleNameFromKey = roleNameParts.join("_");
            locationName = waitingKeyParts[waitingKeyParts.length - 1];

            if (workFlowJSON?.actions[roleNameFromKey]) {
              const roleLocations =
                workFlowJSON.actions[roleNameFromKey].locationsList || [];
              if (roleLocations.includes(locationName)) {
                locationUnderRole = roleNameFromKey;
              }
            }
          } else {
            locationName = waitingKeyParts[0];
          }
        }

        const isLocationUnderDepartment =
          workFlowJSON?.locationsList?.includes(locationName);

        if (!locationUnderRole && !isLocationUnderDepartment) {
          for (const roleName in workFlowJSON?.actions || {}) {
            const roleLocations =
              workFlowJSON?.actions[roleName]?.locationsList || [];
            if (roleLocations.includes(locationName)) {
              locationUnderRole = roleName;
              break;
            }
          }
        }

        if (locationUnderRole && workFlowJSON?.actions[locationUnderRole]) {
          const currentActions =
            workFlowJSON?.actions[locationUnderRole]?.actions || {};
          const locationApplications = currentActions[locationName] || [];

          setWorkFlowJSON({
            ...workFlowJSON,
            actions: {
              ...workFlowJSON?.actions,
              [locationUnderRole]: {
                ...workFlowJSON?.actions[locationUnderRole],
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
        } else if (isLocationUnderDepartment && workFlowJSON?.departMentName) {
          const currentLocationActions = workFlowJSON?.locationActions || {};
          const locationApplications =
            currentLocationActions[locationName] || [];

          setWorkFlowJSON({
            ...workFlowJSON,
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
      }
    } else if (
      data?.action === "ASSIGN_TEMPLATE" &&
      data?.templateObject &&
      workFlowJSON?.departMentName
    ) {
      const appsToAdd = templateAppsToAppData(data.templateObject);
      if (appsToAdd.length === 0) {
        setIsPopupOpen(false);
        setWaitingForDragging(null);
        return;
      }
      if (
        waitingForDragging === "SELECT_DEPARTMENT_APPLICATION" ||
        (waitingForDragging === "SELECT_DEPARTMENT_LOCATION" &&
          (!workFlowJSON?.rolesList || workFlowJSON.rolesList.length === 0))
      ) {
        const currentApplicationsList = workFlowJSON?.applicationsList || [];
        setWorkFlowJSON({
          ...workFlowJSON,
          applicationsList: [...currentApplicationsList, ...appsToAdd],
        });
      } else if (waitingForDragging?.startsWith("SELECT_DEPARTMENT_")) {
        const roleName = waitingForDragging.replace("SELECT_DEPARTMENT_", "");
        const roleData = workFlowJSON?.actions?.[roleName] || {};
        if (!roleData?.locationsList || roleData.locationsList.length === 0) {
          const currentApplicationsList = roleData?.applicationsList || [];
          setWorkFlowJSON({
            ...workFlowJSON,
            actions: {
              ...workFlowJSON?.actions,
              [roleName]: {
                ...roleData,
                applicationsList: [...currentApplicationsList, ...appsToAdd],
              },
            },
          });
        }
      } else if (waitingForDragging?.startsWith("SELECT_LOCATION_")) {
        const waitingKeyParts = waitingForDragging
          .replace("SELECT_LOCATION_", "")
          .split("_");
        let locationName;
        let locationUnderRole = null;
        if (currentRole && currentLocation) {
          locationName = currentLocation;
          locationUnderRole = currentRole;
        } else if (waitingKeyParts.length > 1) {
          const roleNameFromKey = waitingKeyParts.slice(0, -1).join("_");
          locationName = waitingKeyParts[waitingKeyParts.length - 1];
          if (workFlowJSON?.actions?.[roleNameFromKey]?.locationsList?.includes(locationName)) {
            locationUnderRole = roleNameFromKey;
          }
        } else {
          locationName = waitingKeyParts[0];
        }
        const isLocationUnderDepartment =
          workFlowJSON?.locationsList?.includes(locationName);
        if (!locationUnderRole) {
          for (const r of Object.keys(workFlowJSON?.actions || {})) {
            if (workFlowJSON.actions[r]?.locationsList?.includes(locationName)) {
              locationUnderRole = r;
              break;
            }
          }
        }
        if (locationUnderRole && workFlowJSON?.actions?.[locationUnderRole]) {
          const currentActions =
            workFlowJSON.actions[locationUnderRole].actions || {};
          const locationApplications = currentActions[locationName] || [];
          setWorkFlowJSON({
            ...workFlowJSON,
            actions: {
              ...workFlowJSON?.actions,
              [locationUnderRole]: {
                ...workFlowJSON.actions[locationUnderRole],
                actions: {
                  ...currentActions,
                  [locationName]: [...locationApplications, ...appsToAdd],
                },
              },
            },
          });
        } else if (isLocationUnderDepartment) {
          const currentLocationActions = workFlowJSON?.locationActions || {};
          const locationApplications = currentLocationActions[locationName] || [];
          setWorkFlowJSON({
            ...workFlowJSON,
            locationActions: {
              ...currentLocationActions,
              [locationName]: [...locationApplications, ...appsToAdd],
            },
          });
        }
      }
    }
    setIsPopupOpen(false);
    setWaitingForDragging(null);
  };

  const addAction = (action) => {
    setEditObject(null);
    setIsPopupOpen(true);
  };

  console.log(workFlowJSON);

  const deleteAction = (key, type, roleKey = null, delDat = null) => {
    if (type === "DEPARTMENT") {
      setWorkFlowJSON({
        actions: {},
        rolesList: [],
      });
    } else if (type === "ROLE") {
      const updatedRolesList = workFlowJSON?.rolesList?.filter(
        (role) => role !== key
      );
      const updatedActions = { ...workFlowJSON?.actions };
      delete updatedActions[key];
      setWorkFlowJSON({
        ...workFlowJSON,
        rolesList: updatedRolesList,
        actions: updatedActions,
      });
    } else if (type === "LOCATION") {
      const targetRoleKey =
        roleKey || currentRole || Object.keys(workFlowJSON?.actions || {})[0];

      if (targetRoleKey && workFlowJSON?.actions[targetRoleKey]) {
        const updatedLocationsList = workFlowJSON?.actions[
          targetRoleKey
        ]?.locationsList?.filter((location) => location !== key);
        const updatedActions = { ...workFlowJSON?.actions };
        if (updatedActions[targetRoleKey]) {
          updatedActions[targetRoleKey] = {
            ...updatedActions[targetRoleKey],
            locationsList: updatedLocationsList,
          };
          if (updatedActions[targetRoleKey]?.actions) {
            delete updatedActions[targetRoleKey].actions[key];
          }
        }
        setWorkFlowJSON({
          ...workFlowJSON,
          actions: updatedActions,
        });
      } else if (workFlowJSON?.departMentName && workFlowJSON?.locationsList) {
        const updatedLocationsList = workFlowJSON.locationsList.filter(
          (location) => location !== key
        );
        const updatedLocationActions = { ...workFlowJSON?.locationActions };
        if (updatedLocationActions[key]) {
          delete updatedLocationActions[key];
        }
        setWorkFlowJSON({
          ...workFlowJSON,
          locationsList: updatedLocationsList,
          locationActions: updatedLocationActions,
        });
      }
    } else if (type === "APPLICATION") {
      const isMatchingApp = (app) => {
        const appId = app?.currentApplication?.id || app?.id;
        return appId === key;
      };

      // Department-level app: remove only from applicationsList, not from locations/roles
      if (delDat?.parentType === "DEPARTMENT" && workFlowJSON?.applicationsList) {
        const updatedApplicationsList = workFlowJSON.applicationsList.filter(
          (app) => !isMatchingApp(app)
        );
        setWorkFlowJSON({
          ...workFlowJSON,
          applicationsList: updatedApplicationsList,
        });
        return;
      }

      let targetRoleKey =
        roleKey || currentRole || Object.keys(workFlowJSON?.actions || {})[0];
      if (delDat?.role) {
        targetRoleKey = delDat?.role;
      }
      if (targetRoleKey && workFlowJSON?.actions[targetRoleKey]) {
        const updatedActions = { ...workFlowJSON?.actions };
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
        setWorkFlowJSON({
          ...workFlowJSON,
          actions: updatedActions,
        });
      } else if (workFlowJSON?.departMentName) {
        if (workFlowJSON?.applicationsList) {
          const updatedApplicationsList = workFlowJSON.applicationsList.filter(
            (app) => !isMatchingApp(app)
          );
          setWorkFlowJSON({
            ...workFlowJSON,
            applicationsList: updatedApplicationsList,
          });
        }
        if (workFlowJSON?.locationActions) {
          const updatedLocationActions = { ...workFlowJSON.locationActions };
          Object.keys(updatedLocationActions).forEach((locationName) => {
            updatedLocationActions[locationName] = updatedLocationActions[
              locationName
            ].filter((app) => !isMatchingApp(app));
          });
          setWorkFlowJSON({
            ...workFlowJSON,
            locationActions: updatedLocationActions,
          });
        }
      }
    }
  };

  const hasValidWorkFlowData = () => {
    if (workFlowJSON?.applicationsList?.length > 0) {
      return true;
    }

    if (workFlowJSON?.locationActions) {
      const hasLocationApps = Object.keys(workFlowJSON.locationActions).some(
        (locationName) => {
          const locationApps = workFlowJSON.locationActions[locationName] || [];
          return locationApps.length > 0;
        }
      );
      if (hasLocationApps) return true;
    }

    if (workFlowJSON?.actions) {
      const hasRoleApps = Object.keys(workFlowJSON.actions).some((roleName) => {
        const roleData = workFlowJSON.actions[roleName];
        if (roleData?.applicationsList?.length > 0) {
          return true;
        }
        if (roleData?.actions) {
          return Object.keys(roleData.actions).some((locationName) => {
            const locationApps = roleData.actions[locationName] || [];
            return locationApps.length > 0;
          });
        }
        return false;
      });
      if (hasRoleApps) return true;
    }

    return false;
  };

  const saveTemplate = async () => {
    setIsPageLoading(true);
    const workFlowApplications = [];

    const transformApplication = (app, role = null, location = null) => {
      const currentApp = app?.currentApplication || app;
      const licenses = app?.LICENSES || [];
      const groups = app?.GROUPS || [];
      const roles = app?.roles || [];
      const commonName = app?.commonName || null;
      return {
        applicationName: currentApp?.providerName,
        adminCloudId: currentApp?.id,
        title: role === "Title Not Met" ? null : role || null,
        location: location === "Location Not Met" ? null : location || null,
        deleted: app?.deleted || false,
        groupIds: groups.map((group) => ({
          groupName: group?.groupName,
          groupId: group?.groupId,
        })),
        roles: roles || [],
        commonName: commonName || null,
        usubscriptionIds: licenses.map((license) => ({
          subscriptionName: license?.planName || license?.planId,
          subscriptionId: license?.id,
        })),
      };
    };

    // Department-level applications (applicationsList) go only in mandatoryApplications
    // to avoid duplication with workFlowApplications
    if (workFlowJSON?.locationActions) {
      Object.keys(workFlowJSON.locationActions).forEach((locationName) => {
        const locationApps = workFlowJSON.locationActions[locationName] || [];
        locationApps.forEach((app) => {
          workFlowApplications.push(
            transformApplication(app, null, locationName)
          );
        });
      });
    }

    if (workFlowJSON?.actions) {
      Object.keys(workFlowJSON.actions).forEach((roleName) => {
        const roleData = workFlowJSON.actions[roleName];
        const roleApps = roleData?.applicationsList || [];

        roleApps.forEach((app) => {
          workFlowApplications.push(transformApplication(app, roleName));
        });

        if (roleData?.actions) {
          Object.keys(roleData.actions).forEach((locationName) => {
            const locationApps = roleData.actions[locationName] || [];
            locationApps.forEach((app) => {
              workFlowApplications.push(
                transformApplication(app, roleName, locationName)
              );
            });
          });
        }
      });
    }

    // Applications between Department Name and roles → mandatoryApplications
    const mandatoryApplications =
      makeApplicationsBody(workFlowJSON?.applicationsList || []) || [];

    let body = {
      conditionValue: workFlowJSON?.departMentName || null,
      type: "DEPARTMENT",
      templetName: workFlowJSON?.workFlowName || null,
      workFlowApplications: workFlowApplications,
      mandatoryApplications,
    };

    if (templateId) {
      body.id = templateId;
    }

    if (primaryApplicationsList?.length > 0) {
      let mandatoryApplications = makeApplicationsBody(primaryApplicationsList);
      body.mandatoryApplications = mandatoryApplications;
    }


    let res = await saveTemplateWorkFlow(body);

    if (res?.status === "OK") {
      if (templateId) {
        notifyToast("success", "Template updated successfully");
      } else {
        notifyToast("success", "Template saved successfully");
      }
      if (isTemplateCreateFromWorkflow) {
        setIsCreateTemplate(false);
        fetchTemplates();
      } else {
        navigate("/Workflow/Template#Templates");
      }
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  useEffect(() => {
    if (templateId) {
      makeUIForEditTemplate(templateId);
    }
  }, [templateId]);

  const transformTemplateToWorkFlowJSON = (template) => {
    const rawDepartmentName =
      template?.conditionValue || template?.departmentName || null;
    const departmentName =
      rawDepartmentName === null ? "Department Not Met" : rawDepartmentName;
    const workFlowJSON = {
      workFlowName:
        template?.workFlowName || template?.name || "Custom Template",
      departMentName: departmentName,
      applicationsList: [],
      locationsList: [],
      locationActions: {},
      rolesList: [],
      actions: {},
    };

    if (template?.workFlowApplications) {
      template.workFlowApplications.forEach((app) => {
        const subscriptionIds =
          app?.usubscriptionIds || app?.usubscriptionIds || [];

        const appData = {
          currentApplication: {
            id: app?.adminCloudId,
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
          GROUPS:
            app?.groupIds?.map((group) => ({
              groupId: group?.groupId || group,
              groupName: group?.groupName || group,
            })) || [],
          roles: app?.roles || [],
          commonName: app?.commonName || null,
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

          if (appData?.commonName) {
            appData.roles.push(appData?.commonName);
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

    // Applications between Department and roles: also load from mandatoryApplications
    if (template?.mandatoryApplications?.length > 0) {
      const existingAppIds = new Set(
        workFlowJSON.applicationsList.map(
          (a) => a?.currentApplication?.id || a?.currentApplication?.providerName
        )
      );
      template.mandatoryApplications.forEach((app) => {
        const appId = app?.adminCloudId || app?.applicationName;
        if (existingAppIds.has(appId)) return;
        existingAppIds.add(appId);
        const subscriptionIds = app?.usubscriptionIds || [];
        const appData = {
          currentApplication: {
            id: app?.adminCloudId,
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
              return { id: sub, planName: sub, planId: sub };
            }) || [],
          GROUPS:
            app?.groupIds?.map((group) => ({
              groupId: group?.groupId || group,
              groupName: group?.groupName || group,
            })) || [],
          roles: app?.roles || [],
          commonName: app?.commonName || null,
        };
        workFlowJSON.applicationsList.push(appData);
      });
    }

    return { ...workFlowJSON, workFlowName: template?.templetName };
  };

  const makeUIForEditTemplate = async () => {
    let templateData = JSON.parse(localStorage.getItem("editTemplate"));
    if (templateData?.mandatoryApplications?.length > 0 && !templateData?.conditionValue) {
      let transformData = []
      templateData?.mandatoryApplications?.forEach((app) => {
        const appId = app?.adminCloudId || app?.applicationName;
        const subscriptionIds = app?.usubscriptionIds || [];
        const appData = {
          currentApplication: {
            id: app?.adminCloudId,
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
              return { id: sub, planName: sub, planId: sub };
            }) || [],
          GROUPS:
            app?.groupIds?.map((group) => ({
              groupId: group?.groupId || group,
              groupName: group?.groupName || group,
            })) || [],
          roles: app?.roles || [],
          commonName: app?.commonName || null,
        };
        transformData.push(appData);
      });
      setPrimaryApplicationsList(transformData);
      setWorkFlowJSON({ workFlowName: templateData?.templetName });
      return;
    }
    if (templateData) {
      if (templateData?.workFlowApplications) {
        const transformedWorkFlowJSON =
          transformTemplateToWorkFlowJSON(templateData);
        setWorkFlowJSON({ ...transformedWorkFlowJSON });

      } else {
        setWorkFlowJSON(templateData);
      }
    }
  };
  console.log(workFlowJSON)
  const handleEditObject = (e) => {
    if (e?.type === "PRIMARY_APPLICATION") {
      setEditObject({
        ...e,
        application: {
          ...e.application,
          currentApplication: {
            ...e.currentApplication,
            adminCloudId: e.currentApplication.id,
          },
        },
      })
    } else {
      setEditObject({
        ...e,
        application: {
          ...e.application,
          currentApplication: {
            ...e.application.currentApplication,
            adminCloudId: e.application.currentApplication.id,
          },
        },
      });
    }
    setIsPopupOpen(true);
  };

  const handlePrimaryApplicationsDelete = (res) => {
    let cpyPrimaryApplicationsList = [...primaryApplicationsList];
    cpyPrimaryApplicationsList = cpyPrimaryApplicationsList.filter(item => item.currentApplication.id !== res.currentApplication.id);
    setPrimaryApplicationsList(cpyPrimaryApplicationsList);
  };


  const renderCanvas = () => {
    return (
      <div
        className={
          !isTemplateCreateFromWorkflow
            ? "cf_main_content_place_main CF_d-flex"
            : "CF_d-flex"
        }
        style={{
          padding: "10px 0",
          gap: "15px",
          position: "relative",
          ...(isTemplateCreateFromWorkflow
            ? { width: "100%", height: "100%" }
            : {}),
        }}
      >
        <div
          className="cf_newFlow_canvas_newFlowV3"
          onWheel={onWheelZoom}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          style={{
            width: isPopupOpen ? "calc(100% - 30%)" : "100%",
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
                      defaultVal={workFlowJSON?.workFlowName}
                      inputWidth="220px"
                      inputHeight="40px"
                      customActionStyles={{ top: "45px" }}
                      closeAction={() => setIsWorkflowNameEditable(false)}
                      saveAction={(value) => {
                        setWorkFlowJSON({
                          ...workFlowJSON,
                          workFlowName: value,
                        });
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
                    {workFlowJSON?.workFlowName || "Template Name"}
                  </p>
                )}
              </div>
            </div>
            {primaryApplicationsList?.map(
              (res) => (
                <ActionPanel
                  key={res?.currentApplication?.id + "APPLICATION"}
                  action={res}
                  onEdit={() =>
                    handleEditObject({
                      ...res,
                      application: {
                        ...res.application,
                        LICENSES: res?.LICENSES || [],
                        GROUPS: res?.GROUPS || [],
                        roles: res?.roles || [],
                        commonName: res?.commonName || null,
                      },
                      type: "PRIMARY_APPLICATION",
                    })
                  }
                  onDelete={() => {
                    handlePrimaryApplicationsDelete(res);
                  }
                  }
                  showDelete={true}
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
            {workFlowJSON?.departMentName ? (
              <RecursiveTemplateV2
                editAction={(e) =>
                  handleEditObject({
                    ...e,
                  })
                }
                workFlowJSON={workFlowJSON}
                level={0}
                onDelete={deleteAction}
                onAddAction={addAction}
                waitingForDragging={waitingForDragging}
                onDrop={handleDrop}
                currentRole={currentRole}
                setCurrentRole={setCurrentRole}
                currentLocation={currentLocation}
                setCurrentLocation={setCurrentLocation}
                setEnableOptionsList={setEnableOptionsList}
                setWaitingForDragging={setWaitingForDragging}
                createTemplate={true}
                scale={scale}
              />
            ) : (
              <>
                {workFlowJSON?.rolesList?.length > 0 ? (
                  <RecursiveTemplateV2
                    editAction={(e) =>
                      handleEditObject({
                        ...e,
                      })
                    }
                    workFlowJSON={workFlowJSON}
                    level={0}
                    onDelete={deleteAction}
                    onAddAction={addAction}
                    waitingForDragging={waitingForDragging}
                    onDrop={handleDrop}
                    currentRole={currentRole}
                    setCurrentRole={setCurrentRole}
                    currentLocation={currentLocation}
                    setCurrentLocation={setCurrentLocation}
                    setEnableOptionsList={setEnableOptionsList}
                    setWaitingForDragging={setWaitingForDragging}
                    createTemplate={true}
                    scale={scale}
                  />
                ) : (
                  <>
                    {waitingForDragging === "SELECT_ROLE" ? (
                      <div
                        className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent cf_action_drop_pannel"
                        style={{
                          marginTop: "60px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                        }}
                        onDrop={handleDrop}
                      >
                        <p>Drag and drop here</p>
                      </div>
                    ) : (
                      <div className="cf_action_trigger cf_action_triggerV3">
                        <ActionButton
                          customClass={`changeButtonColorOnHover cf_newBox_Shadow`}
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
                            if (primaryApplicationsList?.length > 0) {
                              setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                            } else {
                              setEnableOptionsList(["DEPARTMENT_BASED_ACTION", "ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                            }
                            setWaitingForDragging("SELECT_ROLE");
                          }}
                        >
                          <Plus size={16} />
                        </ActionButton>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {(hasValidWorkFlowData() || primaryApplicationsList?.length > 0) && (
            <div
              className="cf_zoom_percentage_container"
              style={{
                top: "20px",
                right: isPopupOpen ? "calc( 30% + 20px )" : "10px",
              }}
            >
              <ActionButton
                buttonType="button"
                customClass={`changeButtonColorOnHover cf_newBox_Shadow`}
                customStyles={{
                  backgroundColor: "#fff",
                  height: "35px",
                  width: "80px",
                  right: isPopupOpen ? "calc( 30% + 20px )" : "10px",
                }}
                buttonClickAction={() => {
                  saveTemplate();
                }}
              >
                <p>Save</p>
              </ActionButton>
            </div>
          )}
          <div
            className="cf_newBox_Shadow cf_zoom_percentage_container"
            style={{ right: isPopupOpen ? "calc( 30% + 20px )" : "10px" }}
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
                  onClick={() => {
                    setScale(scale - 0.1);
                    innerRef.current.style.transform = `translate(${position.current.x
                      }px, ${position.current.y}px) scale(${scale - 0.1})`;
                  }}
                >
                  <p>Zoom Out</p>
                  <div className="cf_canvas_zoom_options_icon">
                    <Minus strokeWidth={3} size={12} />
                  </div>
                </div>
                <div
                  className="cf_canvas_zoom_options_icon_container"
                  onClick={() => {
                    setScale(scale + 0.1);
                    innerRef.current.style.transform = `translate(${position.current.x
                      }px, ${position.current.y}px) scale(${scale + 0.1})`;
                  }}
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
        {isPopupOpen && (
          <CustomTemplateActionPannel
            licenseInfoMap={licenseInfoMap}
            setLicenseInfoMap={setLicenseInfoMap}
            isPopupOpen={isPopupOpen}
            workFlowJSON={workFlowJSON}
            setIsPopupOpen={setIsPopupOpen}
            currentRole={currentRole}
            enableOptionsList={enableOptionsList}
            currentLocation={currentLocation}
            selectedApplicationList={primaryApplicationsList?.length > 0 ? primaryApplicationsList?.reduce((acc, curr) => {
              acc.push(curr?.currentApplication?.providerName);
              return acc;
            }, []) : selectedApplicationList}
            actionsList={actionsList}
            editObject={editObject}
            handleSaveApplicationEditObject={handleSaveApplicationEditObject}
            isApprovalEmailOpen={isApprovalEmailOpen}
            setIsApprovalEmailOpen={setIsApprovalEmailOpen}
            isGoogleWorkspaceDataTransferOpen={isGoogleWorkspaceDataTransferOpen}
            setIsGoogleWorkspaceDataTransferOpen={setIsGoogleWorkspaceDataTransferOpen}
            approvalEmail={approvalEmail}
            setApprovalEmail={setApprovalEmail}
            googleWorkSpaceDataTransferEmail={googleWorkSpaceDataTransferEmail}
            setGoogleWorkSpaceDataTransferEmail={setGoogleWorkSpaceDataTransferEmail}
            templatesList={templatesList}
            isTemplatesLoading={isTemplatesLoading}
            selectedTemplatesList={selectedTemplatesList}
            fetchTemplatesInternal={fetchTemplatesInternal}
          />
        )}
      </div>
    );
  };

  const handleSaveApplicationEditObject = (e) => {
    if (e?.type === "PRIMARY_APPLICATION") {
      let cpyPrimaryApplicationsList = [...primaryApplicationsList];
      cpyPrimaryApplicationsList = cpyPrimaryApplicationsList.map(data => {
        if (data?.currentApplication?.id === e?.currentApplication?.id) {
          return {
            ...data,
            deleted: e?.deleted ?? data?.deleted ?? false,
            usubscriptionIds:
              e?.LICENSES?.map((curr) => ({
                subscriptionName: curr?.planName,
                subscriptionId: curr?.id,
              })) || [],
            GROUPS: e?.application?.GROUPS?.map((group) => ({
              groupId: group?.groupId || group,
              groupName: group?.groupName || group,
            })) || [],
            LICENSES: e?.LICENSES?.map((curr) => ({
              subscriptionName: curr?.planName,
              subscriptionId: curr?.id,
            })) || [],
            groupIds: e?.application?.GROUPS || [],
            roles: e?.application?.roles || [],
            commonName: e?.application?.commonName ?? data?.commonName ?? null,
          };
        }
        return data;
      });
      setPrimaryApplicationsList(cpyPrimaryApplicationsList);
      setIsPopupOpen(false);
      setEditObject(null);
      return;
    }
    // Department-level app: update only applicationsList, not location/role actions
    if (e?.parentType === "DEPARTMENT" && workFlowJSON?.applicationsList) {
      const appId = e?.application?.currentApplication?.id;
      const updatedApplicationsList = workFlowJSON.applicationsList.map(
        (data) => {
          const dataId = data?.currentApplication?.id || data?.id;
          if (dataId === appId) {
            return {
              ...data,
              deleted: e?.application?.deleted ?? data?.deleted ?? false,
              LICENSES: e?.application?.LICENSES || [],
              GROUPS: e?.application?.GROUPS || [],
              roles: e?.application?.roles || [],
              commonName: e?.application?.commonName ?? data?.commonName ?? null,
            };
          }
          return data;
        }
      );
      setWorkFlowJSON({
        ...workFlowJSON,
        applicationsList: updatedApplicationsList,
      });
      setIsPopupOpen(false);
      setEditObject(null);
      return;
    }
    if (!e?.role || !e?.location) {
      setIsPopupOpen(false);
      setEditObject(null);
      return;
    }

    const cpyWorkFlowJSON = { ...workFlowJSON };
    const roleActions = { ...cpyWorkFlowJSON.actions[e.role] };
    const act = { ...roleActions.actions };

    act[e.location] = act[e.location]?.map((data) => {
      if (
        data?.currentApplication?.id === e?.application?.currentApplication?.id
      ) {
        return {
          ...data,
          deleted: e?.application?.deleted ?? data?.deleted ?? false,
          usubscriptionIds:
            e?.application?.LICENSES?.map((curr) => ({
              subscriptionName: curr?.planName,
              subscriptionId: curr?.id,
            })) || [],
          GROUPS: e?.application?.GROUPS || [],
          LICENSES: e?.application?.LICENSES || [],
          groupIds: e?.application?.GROUPS || [],
          roles: e?.application?.roles || [],
          commonName: e?.application?.commonName ?? data?.commonName ?? null,
        };
      }
      return data;
    });

    roleActions.actions = act;
    cpyWorkFlowJSON.actions[e.role] = roleActions;

    setWorkFlowJSON(cpyWorkFlowJSON);
    setIsPopupOpen(false);
    setEditObject(null);
  };

  console.log(workFlowJSON)

  return (
    <>
      {isTemplateCreateFromWorkflow ? (
        renderCanvas()
      ) : (
        <div className="cf_main_container">
          <SideNav activeTab="Workflow" />
          <div className="cf_main_content_place">
            <TopNav
              pageName={"Create Template"}
              backLink="/Workflow/Template#Templates"
            />
            {renderCanvas()}
          </div>
        </div>
      )}

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default TemplateMaker;
