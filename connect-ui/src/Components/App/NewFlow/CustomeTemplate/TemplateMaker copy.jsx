import { BriefcaseBusiness, Building, ChevronUp, Maximize, Minus, Plus, User, Workflow } from "lucide-react";
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
import ActionPanel from "../components/ActionPanel";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
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
  const [rolesList, setRolesList] = useState([]);
  const [roleMapper, setRoleMapper] = useState({});

  const getConfigurations = async (applicationName) => {
    let res = await getSaaSRolesForApplication(applicationName, null);
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
        getConfigurations(app?.providerName);
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

  const handleDrop = (e, newObj) => {
    e.preventDefault();
    let data = JSON.parse(e.dataTransfer.getData("json"));
    if (data?.action === "SELECT_DEPARTMENT") {
      setWorkFlowJSON({
        ...workFlowJSON,
        departMentName: data?.department?.name,
        actions: {},
        rolesList: [],
        locationsList: [],
        locationActions: {},
        applicationsList: [],
      });
    } else if (data?.action === "ONBOARD_TO_APPLICATIONS" && !newObj) {
      setPrimaryApplicationsList([...primaryApplicationsList, {
        currentApplication: data?.currentApplication,
        deleted: data?.deleted || false,
        LICENSES: data?.LICENSES || [],
        GROUPS: data?.GROUPS || [],
        roles: data?.roles || [],
        commonName: data?.commonName || null,
      }]);
    } else if (data?.action === "SELECT_ROLE") {
      let cpyRolesList = [...rolesList];
      cpyRolesList.push(data?.role);
      setRolesList(cpyRolesList);
      let cpyRoleMapper = { ...roleMapper };
      cpyRoleMapper[data?.role] = {};
      setRoleMapper(cpyRoleMapper);
    } else if (data?.action === "SELECT_LOCATION") {
      let cpyRoleMapper = { ...roleMapper };
      cpyRoleMapper[newObj?.currentRole] = {
        ...(cpyRoleMapper[newObj?.currentRole] || {}),
        locationsList: [...(cpyRoleMapper[newObj?.currentRole]?.locationsList || []), data?.location?.name],
      };
      setRoleMapper(cpyRoleMapper);
    } else if (data?.action === "ONBOARD_TO_APPLICATIONS") {
      let cpyRoleMapper = { ...roleMapper };
      let locationMapper = [...(cpyRoleMapper[newObj?.currentRole]?.locationMapper?.[newObj?.currentLocation?.replaceAll(" ", "_")] || [])];
      locationMapper.push({
        currentApplication: data?.currentApplication,
        deleted: data?.deleted || false,
        LICENSES: data?.LICENSES || [],
        GROUPS: data?.GROUPS || [],
        roles: data?.roles || [],
        commonName: data?.commonName || null,
        currentRole: newObj?.currentRole,
        currentLocation: newObj?.currentLocation,
      });
      cpyRoleMapper[newObj?.currentRole] = {
        ...(cpyRoleMapper[newObj?.currentRole] || {}),
        locationMapper: {
          ...(cpyRoleMapper[newObj?.currentRole]?.locationMapper || {}),
          [newObj?.currentLocation?.replaceAll(" ", "_")]: locationMapper,
        },
      };
      setRoleMapper(cpyRoleMapper);
    }
    console.log(data);
    setIsPopupOpen(false);
    setWaitingForDragging(null);
  };

  console.log(roleMapper);

  const addAction = (action) => {
    setEditObject(null);
    setIsPopupOpen(true);
  };


  const deleteAction = (key, type, roleKey = null, delDat = null) => {

  };

  const hasValidWorkFlowData = () => {

  };

  const saveTemplate = async () => {

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
            {
              workFlowJSON?.departMentName ?
                (
                  <ActionPanel
                    key={workFlowJSON?.departMentName + "DEPARTMENT"}
                    action={workFlowJSON?.departMentName}
                    onEdit={() =>
                      handleEditObject({
                        ...workFlowJSON?.departMentName,
                        type: "DEPARTMENT",
                      })
                    }
                    onDelete={() => {
                      handleDepartmentDelete(workFlowJSON?.departMentName);
                    }
                    }
                    icon={<Building size={20} color="#B2562B" />}
                    showDelete={true}
                    borderColor="#B2562B"
                    backgroundColor="#FFDFC8"
                    title={workFlowJSON?.departMentName}
                  />
                )
                : ""
            }
            {primaryApplicationsList?.map(
              (res) => (
                <ActionPanel
                  key={res?.currentApplication?.id + "APPLICATION"}
                  action={res}
                  onEdit={() =>
                    handleEditObject({
                      ...res,
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
            {rolesList?.length > 0 ? <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
              <div className="cf_department_based_action_container_dottedLine_role" />
              {rolesList?.map(
                (res) => (
                  <div
                    className="CF_d-flex"
                    style={{
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      position: "relative",
                    }}
                  >
                    <ActionPanel
                      key={res + "APPLICATION"}
                      action={res}
                      onEdit={() =>
                        handleEditObject({
                          ...res,
                          type: "PRIMARY_APPLICATION",
                        })
                      }
                      onDelete={() => {
                        handlePrimaryApplicationsDelete(res);
                      }
                      }
                      showDelete={true}
                      borderColor="#5A2E8A"
                      backgroundColor="#E8D9FF"
                      icon={<BriefcaseBusiness size={20} color="#5A2E8A" />}
                      title={res}
                    />
                    {roleMapper[res]?.locationsList?.length > 0 ? <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                      <div className="cf_department_based_action_container_dottedLine_role" />
                      {roleMapper[res]?.locationsList?.map(
                        (location) => (
                          <div
                            className="CF_d-flex"
                            style={{
                              flexDirection: "column",
                              justifyContent: "center",
                              alignItems: "center",
                              position: "relative",
                            }}
                          >
                            <ActionPanel
                              key={location + "LOCATION"}
                              action={location}
                              onEdit={() => handleEditObject({ ...location, type: "LOCATION" })}
                              onDelete={() => handleLocationDelete(location)}
                              showDelete={true}
                              borderColor="#9E2A5C"
                              backgroundColor="#FFD6E7"
                              icon={<Building size={20} color="#9E2A5C" />}
                              title={location}
                            />
                            {roleMapper[res]?.locationMapper?.[location?.replaceAll(" ", "_")]?.length > 0 ?
                              roleMapper[res]?.locationMapper?.[location?.replaceAll(" ", "_")]?.map(
                                (application) => (
                                  <ActionPanel
                                    key={application?.currentApplication?.id + "APPLICATION"}
                                    action={application}
                                    onEdit={() => handleEditObject({ ...application, type: "PRIMARY_APPLICATION" })}
                                    onDelete={() => handlePrimaryApplicationsDelete(application)}
                                    showDelete={true}
                                    borderColor="#0062ff"
                                    backgroundColor="rgb(178 199 255 / 14%)"
                                    imageSrc={cloudImageMapper(
                                      application?.currentApplication?.providerName
                                    )}
                                    imageAlt={application?.currentApplication?.providerName}
                                    title="Onboard User to"
                                    subtitle={getCloudName(
                                      application?.currentApplication?.providerName
                                    )}
                                  />
                                )
                              )
                              : ""}
                            {waitingForDragging === "ROLE_" + res + "_" + location?.replaceAll(" ", "_") ? (
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
                                onDrop={(e) => handleDrop(e, { ...e, currentRole: res, currentLocation: location })}
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
                                    setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
                                    setWaitingForDragging("ROLE_" + res + "_" + location?.replaceAll(" ", "_"));
                                  }}
                                >
                                  <Plus size={16} />
                                </ActionButton>
                              </div>
                            )}
                          </div>
                        )
                      )}
                      <div className="cf_action_trigger cf_action_triggerV3 cf_action_trigger_for_department">
                        {waitingForDragging === "ROLE_" + res ? (
                          <div
                            className="cf_newFlow_trigger_pannel cf_action_drop_pannel"
                            style={{
                              marginTop: "00px",
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
                              setEnableOptionsList(["LOCATION_BASED_ACTION"]);
                              setWaitingForDragging("ROLE_" + res);
                            }}
                          >
                            <Plus size={16} />
                          </ActionButton>
                        )}

                      </div>
                    </div> : ""}
                    {!roleMapper[res]?.locationsList ? waitingForDragging === "ROLE_" + res ? (
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
                        onDrop={(e) => handleDrop(e, { ...e, currentRole: res })}
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
                            setEnableOptionsList(["LOCATION_BASED_ACTION"]);
                            setWaitingForDragging("ROLE_" + res);
                          }}
                        >
                          <Plus size={16} />
                        </ActionButton>
                      </div>
                    ) : ""}
                  </div>
                )
              )}
              <div className="cf_action_trigger cf_action_triggerV3 cf_action_trigger_for_department">
                {waitingForDragging === "SELECT_ROLE" ? (
                  <div
                    className="cf_newFlow_trigger_pannel cf_action_drop_pannel"
                    style={{
                      marginTop: "00px",
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
                      if (workFlowJSON?.departMentName) {
                        setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "ROLE_BASED_ACTION"]);
                      } else {
                        setEnableOptionsList(["DEPARTMENT_BASED_ACTION", "ONBOARD_TO_APPLICATIONS"]);
                      }
                      setWaitingForDragging("SELECT_ROLE");
                    }}
                  >
                    <Plus size={16} />
                  </ActionButton>
                )}

              </div>
            </div> : ""}
            {rolesList?.length === 0 ?
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
                        if (workFlowJSON?.departMentName) {
                          setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "ROLE_BASED_ACTION"]);
                        } else {
                          setEnableOptionsList(["DEPARTMENT_BASED_ACTION", "ONBOARD_TO_APPLICATIONS"]);
                        }
                        setWaitingForDragging("SELECT_ROLE");
                      }}
                    >
                      <Plus size={16} />
                    </ActionButton>
                  </div>
                )}
              </> : ""
            }
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

export default TemplateMaker;
