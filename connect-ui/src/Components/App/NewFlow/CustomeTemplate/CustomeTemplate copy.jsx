import {
  Building,
  ChevronUp,
  LocateIcon,
  MapPin,
  Maximize,
  Minus,
  Plus,
  Trash2,
  User,
  Workflow,
} from "lucide-react";
import { useRef, useState } from "react";
import { colorPairs, zoomToFit } from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import "../css/NewFlow.css";
import CustomTemplateActionPannel from "./CustomTemplateActionPannel";
import RecursiveTemplate from "./RecursiveTemplate";
import { cloudImageMapper } from "../../../helpers/helpers";

const CustomeTemplate = () => {
  const [workFlowJSON, setWorkFlowJSON] = useState({
    actions: [],
    rolesList: [],
  });
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [licenseInfoMap, setLicenseInfoMap] = useState({});
  const [currentRole, setCurrentRole] = useState(null);
  const [waitingForDragging, setWaitingForDragging] = useState(null);
  const [enableOptionsList, setEnableOptionsList] = useState([]);
  const [selectedApplicationList, setSelectedApplicationList] = useState([]);
  const containerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const innerRef = useRef(null);
  const position = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

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
      let currentActions = workFlowJSON?.actions[currentRole]?.actions;
      let currentLocationsList =
        workFlowJSON?.actions[currentRole]?.locationsList;
      currentLocationsList.push(data?.location?.name);

      if (!currentActions[data?.location?.name]) {
        currentActions[data?.location?.name] = [];
      }

      setWorkFlowJSON({
        ...workFlowJSON,
        actions: {
          ...workFlowJSON?.actions,
          [currentRole]: {
            ...workFlowJSON?.actions[currentRole],
            locationsList: currentLocationsList,
          },
        },
      });
    }
    setIsPopupOpen(false);
    setWaitingForDragging(null);
  };

  const addAction = (action) => {
    setIsPopupOpen(true);
    console.log(action);
  };

  console.log(workFlowJSON);

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Workflow" />
        <div className="cf_main_content_place">
          <TopNav pageName={"Create Template"} backLink="/Workflow/Template" />
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{ padding: "10px 0", gap: "15px", position: "relative" }}
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
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
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
                      Template Name
                    </p>
                  </div>
                </div>
                {workFlowJSON?.departMentName && (
                  <div
                    className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                    style={{
                      marginTop: "60px",
                      backgroundColor: colorPairs[0]?.dull,
                      border: `2px solid ${colorPairs[0]?.dark}`,
                    }}
                    key={workFlowJSON?.departMentName + "DEPARTMENT"}
                  >
                    <div
                      className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
                      onClick={() => {
                        deleteAction(
                          workFlowJSON?.departMentName,
                          "DEPARTMENT"
                        );
                      }}
                    >
                      <Trash2 size={10} />
                    </div>

                    <div className="cf_newFlow_trigger_pannel_header">
                      <div className="cf_newFlow_trigger_pannel_header_icon">
                        <Building size={22} color={colorPairs[0]?.dark} />
                      </div>
                      <p
                        className="cf_newFlow_trigger_pannel_header_name"
                        style={{
                          fontWeight: "500",
                          fontSize: "16px",
                        }}
                      >
                        {workFlowJSON?.departMentName}
                      </p>
                    </div>
                  </div>
                )}
                {workFlowJSON?.rolesList?.length > 0 ? (
                  <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                    <div className="cf_department_based_action_container_dottedLine"></div>
                    {workFlowJSON?.rolesList?.length > 0 &&
                      workFlowJSON?.rolesList?.map((res, index) => {
                        return (
                          <>
                            <div
                              className="CF_d-flex"
                              style={{
                                flexDirection: "column",
                                justifyContent: "center",
                                alignItems: "center",
                                position: "relative",
                              }}
                            >
                              <div
                                className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                                style={{
                                  marginTop: "60px",
                                  backgroundColor: colorPairs[index]?.dull,
                                  border: `2px solid ${colorPairs[index]?.dark}`,
                                }}
                                key={res + "ROLE"}
                              >
                                <div
                                  className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
                                  onClick={() => {
                                    deleteAction(res, "ROLE");
                                  }}
                                >
                                  <Trash2 size={10} />
                                </div>
                                <div className="cf_newFlow_trigger_pannel_header">
                                  <div className="cf_newFlow_trigger_pannel_header_icon">
                                    <User
                                      size={22}
                                      color={colorPairs[index]?.dark}
                                    />
                                  </div>
                                  <div
                                    className="CF_d-flex"
                                    style={{
                                      flexDirection: "column",
                                      width: "calc(100% - 50px)",
                                    }}
                                  >
                                    <p
                                      className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                                      style={{
                                        width: "calc(100% - 0px)",
                                        fontWeight: "500",
                                      }}
                                      title={`${res}`}
                                    >
                                      {res}
                                    </p>
                                    <p
                                      className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                                      style={{
                                        fontWeight: "400",
                                        color: "#64748b",
                                      }}
                                    >
                                      {res}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {workFlowJSON?.actions[res]?.locationsList
                                ?.length > 0 ? (
                                <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                                  <div className="cf_department_based_action_container_dottedLine"></div>
                                  {workFlowJSON?.actions[
                                    res
                                  ]?.locationsList?.map((location) => {
                                    return (
                                      <div
                                        className="CF_d-flex"
                                        style={{
                                          flexDirection: "column",
                                          justifyContent: "center",
                                          alignItems: "center",
                                          position: "relative",
                                        }}
                                      >
                                        <div
                                          className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                                          style={{
                                            marginTop: "60px",
                                            backgroundColor:
                                              colorPairs[index]?.dull,
                                            border: `2px solid ${colorPairs[index]?.dark}`,
                                          }}
                                          key={res + "ROLE"}
                                        >
                                          <div
                                            className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
                                            onClick={() => {
                                              deleteAction(res, "ROLE");
                                            }}
                                          >
                                            <Trash2 size={10} />
                                          </div>
                                          <div className="cf_newFlow_trigger_pannel_header">
                                            <div className="cf_newFlow_trigger_pannel_header_icon">
                                              <MapPin
                                                size={22}
                                                color={colorPairs[index]?.dark}
                                              />
                                            </div>
                                            <div
                                              className="CF_d-flex"
                                              style={{
                                                flexDirection: "column",
                                                width: "calc(100% - 50px)",
                                              }}
                                            >
                                              <p
                                                className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                                                style={{
                                                  width: "calc(100% - 0px)",
                                                  fontWeight: "500",
                                                }}
                                                title={`${location}`}
                                              >
                                                {location}
                                              </p>
                                              <p
                                                className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                                                style={{
                                                  fontWeight: "400",
                                                  color: "#64748b",
                                                }}
                                              >
                                                {location}
                                              </p>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
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
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                      }}
                                      onDrop={handleDrop}
                                    >
                                      <p>Drag and drop here to add</p>
                                    </div>
                                  ) : (
                                    <div className="cf_action_trigger cf_action_triggerV3 cf_action_trigger_for_department">
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
                                          addAction("DEPT_APP_SELECT");
                                          setCurrentRole(res);
                                          setEnableOptionsList([
                                            "LOCATION_BASED_ACTION",
                                          ]);
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
                              ) : (
                                ""
                              )}

                              {workFlowJSON?.actions[res]?.locationsList
                                ?.length === 0 ? (
                                waitingForDragging ===
                                `SELECT_DEPARTMENT_${res}` ? (
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
                                    <p>Drag and drop here to add</p>
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
                                        addAction("DEPT_APP_SELECT");
                                        setCurrentRole(res);
                                        setEnableOptionsList([
                                          "ONBOARD_TO_APPLICATIONS",
                                          "LOCATION_BASED_ACTION",
                                        ]);
                                        setWaitingForDragging(
                                          `SELECT_DEPARTMENT_${res}`
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
                          </>
                        );
                      })}

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
                        <p>Drag and drop here to add a Role</p>
                      </div>
                    ) : (
                      <div className="cf_action_trigger cf_action_triggerV3 cf_action_trigger_for_department">
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
                            setEnableOptionsList(["ROLE_BASED_ACTION"]);
                            ``;
                            setWaitingForDragging("SELECT_ROLE");
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
                {console.log(workFlowJSON)}
                {workFlowJSON?.rolesList?.length === 0 ? (
                  waitingForDragging === "GLOBAL" ? (
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
                      <p>Drag and drop here to add a Trigger</p>
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
                          setWaitingForDragging("GLOBAL");
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
                        innerRef.current.style.transform = `translate(${
                          position.current.x
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
                        innerRef.current.style.transform = `translate(${
                          position.current.x
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
                selectedApplicationList={selectedApplicationList}
              />
            )}
          </div>
        </div>
      </div>

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default CustomeTemplate;
