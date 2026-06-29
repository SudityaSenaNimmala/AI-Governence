import { ChevronUp, Maximize, Minus, Plus, Workflow } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { notifyToast, zoomToFit } from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import "../css/NewFlow.css";
import CustomTemplateActionPannel from "./CustomTemplateActionPannel";
import RecursiveTemplate from "./RecursiveTemplate";
import TextInputUpdate from "../../../Resuables/InputsComponents/TextInputUpdate";
import { saveTemplateWorkFlow } from "../../UserManagement/UserManagementActions/UserManagementActions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { getSaaSRolesForApplication } from "../../SaaSManagement/SaaSActions/SaaSActions";

const CustomeTemplate = ({
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

  const handleDrop = (e) => {
    e.preventDefault();
    let data = JSON.parse(e.dataTransfer.getData("json"));
    if (data?.action === "SELECT_DEPARTMENT") {
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
      if (waitingForDragging?.startsWith("SELECT_DEPARTMENT_")) {
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
      } else if (waitingForDragging === "SELECT_DEPARTMENT_APPLICATION") {
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

    if (workFlowJSON?.applicationsList?.length > 0) {
      workFlowJSON.applicationsList.forEach((app) => {
        workFlowApplications.push(transformApplication(app));
      });
    }

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

    let body = {
      conditionValue: workFlowJSON?.departMentName || null,
      type: "DEPARTMENT",
      workFlowApplications: workFlowApplications,
    };

    if (templateId) {
      body.id = templateId;
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

    return workFlowJSON;
  };

  const makeUIForEditTemplate = async () => {
    let templateData = JSON.parse(localStorage.getItem("editTemplate"));
    if (templateData) {
      if (templateData?.workFlowApplications) {
        const transformedWorkFlowJSON =
          transformTemplateToWorkFlowJSON(templateData);
        setWorkFlowJSON(transformedWorkFlowJSON);
      } else {
        setWorkFlowJSON(templateData);
      }
    }
  };

  const handleEditObject = (e) => {
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
    setIsPopupOpen(true);
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
                    onClick={() => setIsWorkflowNameEditable(false)}
                    style={{ cursor: "pointer", fontSize: "14px" }}
                  >
                    {workFlowJSON?.workFlowName || "Template Name"}
                  </p>
                )}
              </div>
            </div>
            {workFlowJSON?.departMentName ? (
              <RecursiveTemplate
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
                  <RecursiveTemplate
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
                            setEnableOptionsList(["DEPARTMENT_BASED_ACTION"]);
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
          {hasValidWorkFlowData() && (
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
            selectedApplicationList={selectedApplicationList}
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
          />
        )}
      </div>
    );
  };

  const handleSaveApplicationEditObject = (e) => {
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

export default CustomeTemplate;
