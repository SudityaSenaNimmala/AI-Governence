import {
  Building,
  ChevronUp,
  GitFork,
  Maximize,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import {
  colorPairs,
  getUserId,
  notifyToast,
  zoomToFit,
} from "../../helpers/utils";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import "./css/NewFlow.css";
import NewFlowActionPannel from "./NewFlowActionPannel";
import {
  getWorkFlows,
  saveNewWorkFlow,
} from "../UserManagement/UserManagementActions/UserManagementActions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
const NewFlowV3 = () => {
  const navigate = useNavigate();
  const [queryParams] = useSearchParams();
  const workFlowId = queryParams.get("workFlowId");
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [popupAcionsList, setPopupAcionsList] = useState([]);
  const [flowActionsList, setFlowActionsList] = useState({});
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [licenseInfoMap, setLicenseInfoMap] = useState({});
  const [departmentList, setDepartmentList] = useState([]);
  const [departMentMap, setDepartMentMap] = useState({});
  const [departMentAppMap, setDepartMentAppMap] = useState({});
  const [currentDepartment, setCurrentDepartment] = useState(null);
  const [selectedApplicationList, setSelectedApplicationList] = useState([]);
  const [editWorkFlowObject, setEditWorkFlowObject] = useState(null);
  const [editedAction, setEditedAction] = useState(null);
  const [
    selectedApplicaionsBasedOnDepartment,
    setSelectedApplicaionsBasedOnDepartment,
  ] = useState({});
  const containerRef = useRef(null);
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

  console.log(Math.abs((scale / 1) * 100));

  const addAction = (type) => {
    setIsPopupOpen(true);
    if (type === "DEPT_APP_SELECT") {
      setPopupAcionsList(["ONBOARD_TO_APPLICATIONS"]);
    } else if (type === "GLOBAL") {
      setCurrentDepartment(null);
      if (flowActionsList["IF_ELSE"]) {
        setPopupAcionsList(["DEPARTMENT_BASED_ACTION"]);
      } else if (
        flowActionsList["TRIGGER"] &&
        !flowActionsList["IF_ELSE"] &&
        flowActionsList["PRIMARY_APPLICATION"]?.length > 0
      ) {
        setPopupAcionsList(["ONBOARD_TO_APPLICATIONS", "IF_ELSE"]);
      } else if (flowActionsList["TRIGGER"]) {
        setPopupAcionsList(["ONBOARD_TO_APPLICATIONS"]);
      } else {
        setPopupAcionsList(["TRIGGER"]);
      }
    }
  };

  const handleAddToFlow = (res, action) => {
    console.log(res, action);
    if (departmentList.includes(action)) {
      let cpyDepartmentAppMap = departMentAppMap[action] || [];
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
    } else if (action === "DEPARTMENT_BASED_ACTION") {
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
    } else if (action === "PRIMARY_APPLICATION") {
      if (res?.currentApplication?.id) {
        setSelectedApplicationList([
          ...selectedApplicationList,
          res?.currentApplication?.providerName,
        ]);
      }
      setFlowActionsList({
        ...flowActionsList,
        PRIMARY_APPLICATION: [
          ...(flowActionsList["PRIMARY_APPLICATION"] || []),
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

  const deleteAction = (res, action, department = null) => {
    if (action === "IF_ELSE") {
      let cpyFlowActionsList = { ...flowActionsList };
      delete cpyFlowActionsList["IF_ELSE"];
      setFlowActionsList(cpyFlowActionsList);
      setDepartmentList([]);
      setDepartMentAppMap({});
      setSelectedApplicaionsBasedOnDepartment({});
      setSelectedApplicationList([]);
      return;
    }
    if (department) {
      let cpyDepartmentAppMap = { ...departMentAppMap };
      cpyDepartmentAppMap[department] = cpyDepartmentAppMap[department].filter(
        (item) => item?.currentApplication?.id !== res?.currentApplication?.id
      );
      setDepartMentAppMap(cpyDepartmentAppMap);
    } else if (action === "PRIMARY_APPLICATION") {
      let cpyFlowActionsList = { ...flowActionsList };
      cpyFlowActionsList["PRIMARY_APPLICATION"] = cpyFlowActionsList[
        "PRIMARY_APPLICATION"
      ].filter(
        (item) => item?.currentApplication?.id !== res?.currentApplication?.id
      );
      setFlowActionsList(cpyFlowActionsList);
      setSelectedApplicationList(
        selectedApplicationList.filter(
          (item) => item !== res?.currentApplication?.providerName
        )
      );
    } else if (action === "DEPARTMENT") {
      let cpyDepartmentAppMap = { ...departMentAppMap };
      delete cpyDepartmentAppMap[res];
      setDepartmentList(departmentList.filter((item) => item !== res));
      setDepartMentAppMap(cpyDepartmentAppMap);
    }
  };

  const handleSaveWorkFlow = async () => {
    let cpyApiBody = { ...apiBody };
    cpyApiBody.userId = getUserId();
    if (!flowActionsList["TRIGGER"]?.currentApplication?.id) {
      notifyToast("error", "Please add a trigger");
      return;
    }
    cpyApiBody.adminCloudId =
      flowActionsList["TRIGGER"]?.currentApplication?.id;
    cpyApiBody.providerName =
      flowActionsList["TRIGGER"]?.currentApplication?.providerName;

    if (
      !flowActionsList["PRIMARY_APPLICATION"] &&
      flowActionsList["PRIMARY_APPLICATION"]?.length === 0
    ) {
      notifyToast("error", "Please add a primary application");
      return;
    }

    let primaryApplicationBody = makeApplicationsBody(
      flowActionsList["PRIMARY_APPLICATION"]
    );

    let departmentBasedBody = [];

    departmentList?.map((data) => {
      departmentBasedBody.push({
        departmentName: data,
        workFlowApplications: makeApplicationsBody(departMentAppMap[data]),
      });
    });

    cpyApiBody.departMentWorkFlows = departmentBasedBody;

    cpyApiBody.mandatoryApplications = primaryApplicationBody;
    setIsPageLoading(true);

    let res = await saveNewWorkFlow(cpyApiBody);
    if (res?.status === "OK") {
      notifyToast("success", "Workflow Created successfully");
      navigate("/Workflow/Template");
      setIsPageLoading(false);
    } else {
      notifyToast("error", res?.res);
      setIsPageLoading(false);
    }
  };

  const makeApplicationsBody = (applications) => {
    return applications?.reduce((acc, res) => {
      acc.push({
        applicationName: res?.currentApplication?.providerName,
        adminCloudId: res?.currentApplication?.id,
        uSubscriptionIds: (res["LICENSES"] || [])?.reduce((acc, license) => {
          acc.push({
            subscriptionName: license?.planName || license?.planId,
            subscriptionId: license?.id,
          });
          return acc;
        }, []),
        groupIds: (res["GROUPS"] || [])?.reduce((acc, group) => {
          acc.push({
            groupName: group?.groupName,
            groupId: group?.groupId,
          });
          return acc;
        }, []),
      });
      return acc;
    }, []);
  };

  useEffect(() => {
    if (workFlowId) {
      fetchWorkFlows();
    }
  }, [workFlowId]);

  const fetchWorkFlows = async () => {
    setIsPageLoading(true);
    let res = await getWorkFlows();
    if (res?.status === "OK") {
      res?.res?.map((data) => {
        if (data?.id === workFlowId) {
          setEditWorkFlowObject(data);
        }
      });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  console.log(flowActionsList);

  useEffect(() => {
    if (editWorkFlowObject?.id) {
      makeUIForEditWorkFlow();
    }
  }, [editWorkFlowObject]);

  const makeUIForEditWorkFlow = () => {
    let flowMapper = {};
    let makeFlowItems = [];
    let selApplication = [];
    let triggerCloud = cloudsList?.find(
      (data) => data?.id === editWorkFlowObject?.adminCloudId
    );
    flowMapper = {
      TRIGGER: {
        currentApplication: triggerCloud,
        action: "TRIGGER",
      },
    };

    selApplication.push(triggerCloud?.providerName);
    flowMapper["PRIMARY_APPLICATION"] = [];
    if (editWorkFlowObject?.mandatoryApplications?.length > 0) {
      editWorkFlowObject?.mandatoryApplications?.map((data) => {
        let cloudMapper = {
          currentApplication: {
            id: data?.adminCloudId,
            providerName: data?.applicationName,
          },
          LICENSES: data?.usubscriptionIds || [],
          GROUPS: data?.groupIds || [],
        };
        selApplication.push(data?.applicationName);
        flowMapper["PRIMARY_APPLICATION"].push(cloudMapper);
      });
    }

    if (editWorkFlowObject?.departMentWorkFlows?.length > 0) {
      flowMapper["IF_ELSE"] = [];
      let editDepartmentList = editWorkFlowObject?.departMentWorkFlows?.reduce(
        (acc, data) => {
          acc.push(data?.departmentName);
          return acc;
        },
        []
      );

      let cpyDepartMentSelectedAppMap =
        editWorkFlowObject?.departMentWorkFlows?.reduce((acc, data) => {
          acc[data?.departmentName] = data?.workFlowApplications?.reduce(
            (dcc, res) => {
              dcc.push(res?.applicationName);
              return dcc;
            },
            []
          );
          return acc;
        }, {});

      let cpyDepartMentAppMap = editWorkFlowObject?.departMentWorkFlows?.reduce(
        (acc, data) => {
          acc[data?.departmentName] = data?.workFlowApplications?.reduce(
            (dcc, res) => {
              dcc.push({
                currentApplication: {
                  id: res?.adminCloudId,
                  providerName: res?.applicationName,
                },
                action: "ONBOARD_TO_APPLICATIONS",
                LICENSES: res?.usubscriptionIds || [],
                GROUPS: res?.groupIds || [],
              });
              return dcc;
            },
            []
          );
          return acc;
        },
        {}
      );

      setDepartMentAppMap(cpyDepartMentAppMap);
      setSelectedApplicaionsBasedOnDepartment(cpyDepartMentSelectedAppMap);
      setDepartmentList(editDepartmentList);
    }

    setFlowActionsList(flowMapper);
  };

  console.log(departmentList);
  console.log(departMentAppMap);
  console.log(selectedApplicaionsBasedOnDepartment);

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Workflow" />
        <div className="cf_main_content_place">
          <TopNav pageName={"Create Workflow"} backLink="/Workflow/Template" />
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
                width: "100%",
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
                      Onboard Workflow
                    </p>
                  </div>
                </div>
                {flowActionsList["TRIGGER"] ? (
                  <div
                    className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                    style={{
                      marginTop: "60px",
                      border: "2px solid #fa8248",
                      background: "#f9bfa22b",
                    }}
                  >
                    <div
                      className="cf_newFlow_trigger_pannel_action_icon"
                      style={{ right: "0px" }}
                      onClick={() => {
                        setEditedAction(flowActionsList["TRIGGER"]);
                      }}
                    >
                      <Pencil size={10} />
                    </div>
                    <div className="cf_newFlow_trigger_pannel_header">
                      <p style={{ fontSize: "18px", fontWeight: "500" }}>⚡</p>
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
                          title={`When User Onboarded in ${getCloudName(
                            flowActionsList["TRIGGER"]?.currentApplication
                              ?.providerName
                          )}`}
                        >
                          When User Onboarded in
                        </p>
                        <p
                          className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                          style={{
                            fontWeight: "400",
                            color: "#64748b",
                          }}
                        >
                          {getCloudName(
                            flowActionsList["TRIGGER"]?.currentApplication
                              ?.providerName
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  ""
                )}
                {flowActionsList["PRIMARY_APPLICATION"]?.map((res) => {
                  return (
                    <div
                      className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                      style={{
                        marginTop: "60px",
                        border: "2px solid #0062ff",
                        background: "rgb(178 199 255 / 14%)",
                      }}
                      key={res?.currentApplication?.id + "APPLICATION"}
                    >
                      {flowActionsList["PRIMARY_APPLICATION"]?.length > 1 ||
                      !flowActionsList["IF_ELSE"] ? (
                        <div
                          className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
                          onClick={() => {
                            deleteAction(res, "PRIMARY_APPLICATION");
                          }}
                        >
                          <Trash2 size={10} />
                        </div>
                      ) : (
                        ""
                      )}
                      <div className="cf_newFlow_trigger_pannel_header">
                        {/* <div className="cf_newFlow_trigger_pannel_header_icon"> */}
                        <img
                          src={cloudImageMapper(
                            res?.currentApplication?.providerName
                          )}
                          style={{
                            width: "20px",
                            height: "20px",
                            objectFit: "contain",
                          }}
                          alt={res?.currentApplication?.providerName}
                        />
                        {/* </div> */}
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
                            title={`Onboard User to ${getCloudName(
                              res?.currentApplication?.providerName
                            )}`}
                          >
                            Onboard User to
                          </p>
                          <p
                            className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                            style={{
                              fontWeight: "400",
                              color: "#64748b",
                            }}
                          >
                            {getCloudName(
                              res?.currentApplication?.providerName
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {flowActionsList["IF_ELSE"] ? (
                  <div
                    className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                    style={{
                      marginTop: "60px",
                      background: "rgb(255 231 231 / 43%)",
                      border: "2px solid rgb(255 0 0)",
                    }}
                  >
                    <div
                      className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
                      onClick={() => {
                        deleteAction({}, "IF_ELSE");
                      }}
                    >
                      <Trash2 size={10} />
                    </div>
                    <div className="cf_newFlow_trigger_pannel_header">
                      <div className="cf_newFlow_trigger_pannel_header_icon">
                        <GitFork
                          size={22}
                          style={{ transform: "rotate(180deg)" }}
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
                          title={`When User Onboarded in ${getCloudName(
                            flowActionsList["TRIGGER"]?.currentApplication
                              ?.providerName
                          )}`}
                        >
                          If Else Conditions
                        </p>
                        <p
                          className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                          style={{
                            fontWeight: "400",
                            color: "#64748b",
                          }}
                        >
                          Route based on department
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  ""
                )}
                {departmentList?.length > 0 ? (
                  <div className="cf_department_based_action_container cf_action_trigger_dottedParent">
                    <div className="cf_department_based_action_container_dottedLine"></div>
                    {departmentList?.map((res, index) => {
                      return (
                        <div
                          className="CF_d-flex"
                          style={{
                            flexDirection: "column",
                            justifyContent: "center",
                            alignItems: "center",
                            position: "relative",
                            // left: "-125px",
                          }}
                        >
                          <div
                            className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                            style={{
                              marginTop: "60px",
                              backgroundColor: colorPairs[index]?.dull,
                              border: `2px solid ${colorPairs[index]?.dark}`,
                            }}
                            key={res + "DEPARTMENT"}
                          >
                            <div
                              className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
                              onClick={() => {
                                deleteAction(res, "DEPARTMENT");
                              }}
                            >
                              <Trash2 size={10} />
                            </div>

                            <div className="cf_newFlow_trigger_pannel_header">
                              <div className="cf_newFlow_trigger_pannel_header_icon">
                                <Building
                                  size={22}
                                  color={colorPairs[index]?.dark}
                                />
                              </div>
                              <p
                                className="cf_newFlow_trigger_pannel_header_name"
                                style={{
                                  // color: colorPairs[index]?.dark,
                                  fontWeight: "500",
                                  fontSize: "16px",
                                }}
                              >
                                {res}
                              </p>
                            </div>
                          </div>
                          {departMentAppMap[res]?.map((deptRes) => {
                            return (
                              <div
                                className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                                style={{
                                  marginTop: "60px",
                                  backgroundColor: colorPairs[index]?.dull,
                                  border: `2px solid ${colorPairs[index]?.dark}`,
                                }}
                                key={
                                  deptRes?.currentApplication?.id +
                                  "APPLICATION"
                                }
                              >
                                <div
                                  className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
                                  onClick={() => {
                                    deleteAction(
                                      deptRes,
                                      "DEPT_APP_SELECT",
                                      res
                                    );
                                  }}
                                >
                                  <Trash2 size={10} />
                                </div>
                                <div className="cf_newFlow_trigger_pannel_header">
                                  <div className="cf_newFlow_trigger_pannel_header_icon">
                                    <img
                                      src={cloudImageMapper(
                                        deptRes?.currentApplication
                                          ?.providerName
                                      )}
                                      style={{
                                        width: "20px",
                                        height: "20px",
                                        objectFit: "contain",
                                      }}
                                      alt={
                                        deptRes?.currentApplication
                                          ?.providerName
                                      }
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
                                      title={`Onboard User to ${getCloudName(
                                        deptRes?.currentApplication
                                          ?.providerName
                                      )}`}
                                    >
                                      Onboard User to
                                    </p>
                                    <p
                                      className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                                      style={{
                                        fontWeight: "400",
                                        color: "#64748b",
                                      }}
                                    >
                                      {getCloudName(
                                        deptRes?.currentApplication
                                          ?.providerName
                                      )}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
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
                                setCurrentDepartment(res);
                              }}
                            >
                              <Plus size={16} />
                            </ActionButton>
                          </div>
                        </div>
                      );
                    })}

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
                        }}
                      >
                        <Plus size={16} />
                      </ActionButton>
                    </div>
                  </div>
                ) : (
                  ""
                )}
                {departmentList?.length === 0 ? (
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
                      }}
                    >
                      <Plus size={16} />
                    </ActionButton>
                  </div>
                ) : (
                  ""
                )}
              </div>
              {departmentList?.length > 0 &&
              Object.keys(departMentAppMap)?.length > 0 &&
              flowActionsList["TRIGGER"] &&
              flowActionsList["PRIMARY_APPLICATION"]?.length > 0 ? (
                <div
                  className="cf_zoom_percentage_container"
                  style={{ top: "20px" }}
                >
                  <ActionButton
                    buttonType="button"
                    customClass={`changeButtonColorOnHover cf_newBox_Shadow`}
                    customStyles={{
                      backgroundColor: "#fff",
                      height: "35px",
                      width: "80px",
                    }}
                    buttonClickAction={() => {
                      handleSaveWorkFlow();
                    }}
                  >
                    <p>Save</p>
                  </ActionButton>
                </div>
              ) : (
                ""
              )}
              <div className="cf_newBox_Shadow cf_zoom_percentage_container">
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
          </div>
        </div>
      </div>
      <NewFlowActionPannel
        licenseInfoMap={licenseInfoMap}
        setLicenseInfoMap={setLicenseInfoMap}
        isPopupOpen={isPopupOpen}
        setIsPopupOpen={setIsPopupOpen}
        viewActionList={
          popupAcionsList || ["TRIGGER", "ONBOARD_TO_APPLICATIONS", "IF_ELSE"]
        }
        handleAddToFlow={handleAddToFlow}
        flowActionsList={flowActionsList}
        currentDepartment={currentDepartment}
        selectedApplicationList={selectedApplicationList}
        selectedDepartmentList={departmentList}
        editedAction={editedAction}
        setEditedAction={setEditedAction}
        selectedApplicaionsBasedOnDepartment={
          selectedApplicaionsBasedOnDepartment[currentDepartment] || []
        }
      />
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default NewFlowV3;
