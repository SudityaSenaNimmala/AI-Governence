import { Activity, Play, Plus, X } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { onBoardCloudsList } from "../../helpers/helpers";
import SalesForceLanguages from "../../helpers/JSON/SalesForceLanguages.json";
import SalesForceRegions from "../../helpers/JSON/SalesForceRegions.json";
import SalesForceTimeZones from "../../helpers/JSON/SalesForceTimeZones.json";
import { notifyToast, onBoardWithOutLicense } from "../../helpers/utils";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import MultiSelectInputDropDown from "../../Resuables/InputsComponents/MultiSelectInputDropDown";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import {
  getLicensesList,
  getSaaSRolesForApplication,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import {
  createWorkFlow,
  getWorkFlows,
  updateWorkFlow,
} from "../UserManagement/UserManagementActions/UserManagementActions";
import "./css/NewFlow.css";
const NewFlowV2 = () => {
  const navigate = useNavigate();
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [queryParams] = useSearchParams();
  const workFlowId = queryParams.get("workFlowId");
  const [flowItems, setFlowItems] = useState([]);
  const [flowEditApp, setFlowEditApp] = useState({});
  const [licenseMap, setLicenseMap] = useState({});
  const [onBoardAction, setOnBoardAction] = useState(null);
  const [onBoardLicenseMap, setOnBoardLicenseMap] = useState({});
  const [userInfoMap, setUserInfoMap] = useState({});
  const [selectedUserInfoMap, setSelectedUserInfoMap] = useState({});
  const [isLicenseLoaded, setIsLicenseLoaded] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [existingWorkFlowObject, setExistingWorkFlowObject] = useState(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [errorFields, setErrorFields] = useState({});
  const [triggerList, setTriggerList] = useState([
    {
      id: 1,
      name: "TRIGGER",
      actions: null,
      event: null,
      subItems: [],
      currentApplication: null,
    },
  ]);
  const [currentTriggerItem, setCurrentTriggerItem] = useState(null);
  const [currentAction, setCurrentAction] = useState(null);

  const [listActions] = useState([
    {
      name: "Select License",
      value: "SELECT_LICENSE",
    },
    {
      name: "Add User to Group or Team",
      value: "ADD_USER_TO_GROUP",
    },
  ]);

  const [departmentList] = useState([
    {
      id: "1",
      name: "Sales",
    },
    {
      id: "2",
      name: "Marketing",
    },
    {
      id: "3",
      name: "IT",
    },
    {
      id: "4",
      name: "HR",
    },
    {
      id: "5",
      name: "Finance",
    },
    {
      id: "6",
      name: "Operations",
    },
    {
      id: "7",
      name: "Customer Support",
    },
    {
      id: "8",
      name: "Engineering",
    },
  ]);

  const [triggerEvents] = useState([
    {
      id: "USER_CREATED",
      name: "User Created",
    },
    {
      id: "ROLE_CHANGED",
      name: "Role Changed",
    },
  ]);

  const [flowObject, setFlowObject] = useState({
    workFlowName: "",
    workFlowLists: [],
  });

  useEffect(() => {
    if (
      flowEditApp?.currentApplication &&
      onBoardAction === "ASSIGN_USER_WITH_LICENSE"
    ) {
      fetchLicenses();
    }
  }, [flowEditApp]);

  const fetchLicenses = async () => {
    if (
      licenseMap[
      `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
      ]
    ) {
      return;
    }
    setIsLicenseLoaded(true);
    let res = await getLicensesList(
      "",
      flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName,
      flowEditApp?.currentApplication?.id
    );

    if (res?.status === "OK") {
      setLicenseMap({
        ...licenseMap,
        [`${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`]:
          res?.res,
      });
      setIsLicenseLoaded(false);
    } else {
      setIsLicenseLoaded(false);
    }
  };

  const userActionRequired = [
    "BAMBOOHR",
    "MONGODBATLAS",
    "ZOHOCRM",
    "CLOUDFLARE",
    "SALESFORCE",
    "INFORMATICA",
  ];

  const handleLicenseSelection = (e, data, providerName) => {
    let selectedLicenses = [...(onBoardLicenseMap[`${providerName}`] || [])];
    if (e === "INPUT_TEXT") {
      setOnBoardLicenseMap((prev) => ({
        ...prev,
        [`${providerName}`]: data,
      }));
    } else {
      if (e.target.checked) {
        selectedLicenses.push(data);
      } else {
        selectedLicenses = selectedLicenses.filter(
          (license) => license?.id !== data?.id
        );
      }
      setOnBoardLicenseMap((prev) => ({
        ...prev,
        [`${providerName}`]: selectedLicenses,
      }));
    }
  };

  const [onBoardFields] = useState({
    ZOHOCRM: [
      {
        name: "Profile Name *",
        type: "select",
        id: "PROFILES",
      },
      {
        name: "Role *",
        type: "select",
        id: "USER",
      },
    ],
    MONGODBATLAS: [
      {
        name: "Role *",
        type: "select",
        id: "USER",
      },
    ],
    CLOUDFLARE: [
      {
        name: "Role *",
        type: "select",
        id: "USER",
        inputType: "checkbox",
      },
    ],
    SALESFORCE: [
      {
        name: "TimeZone *",
        type: "select",
        displayFields: ["label"],
        id: "TIMEZONE",
      },
      {
        name: "Region *",
        type: "select",
        displayFields: ["label"],
        id: "REGION",
      },
      {
        name: "Language *",
        type: "select",
        displayFields: ["label"],
        id: "LANGUAGE",
      },
    ],
    INFORMATICA: [
      {
        name: "Role *",
        type: "select",
        id: "USER",
      },
    ],
  });

  const getRoles = async (action) => {
    if (
      userInfoMap[
      `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
      ]?.[action]
    ) {
      return true;
    }

    let salesForceActionResponse = null;

    if (
      action === "TIMEZONE" &&
      flowEditApp?.currentApplication?.providerName === "SALESFORCE"
    ) {
      salesForceActionResponse = SalesForceTimeZones;
    }
    if (
      action === "LANGUAGE" &&
      flowEditApp?.currentApplication?.providerName === "SALESFORCE"
    ) {
      salesForceActionResponse = SalesForceLanguages;
    }
    if (
      action === "REGION" &&
      flowEditApp?.currentApplication?.providerName === "SALESFORCE"
    ) {
      salesForceActionResponse = SalesForceRegions;
    }

    if (salesForceActionResponse) {
      setUserInfoMap((prev) => ({
        ...prev,
        [`${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`]:
        {
          ...userInfoMap[
          `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
          ],
          [action]: salesForceActionResponse,
        },
      }));
      return true;
    }

    let res = await getSaaSRolesForApplication(
      flowEditApp?.currentApplication?.providerName,
      action,
      flowEditApp?.currentApplication?.id
    );
    if (res?.status === "OK") {
      setUserInfoMap((prev) => ({
        ...prev,
        [`${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`]:
        {
          ...userInfoMap[
          `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
          ],
          [action]: res?.res,
        },
      }));
      return true;
    } else {
      return false;
    }
  };

  const handleSelectFromMultiList = (e, data, action, type) => {
    let mapId = `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`;

    if (type === "radio") {
      if (currentAction === "TRIGGER") {
        if (action === "EVENT") {
          setCurrentTriggerItem({ ...currentTriggerItem, event: data });
        } else if (action === "DEPARTMENT") {
          setCurrentTriggerItem({ ...currentTriggerItem, department: data });
        } else {
          setCurrentTriggerItem({
            ...currentTriggerItem,
            currentApplication: data,
          });
        }
      } else if (currentAction === "ACTION") {
        if (action === "APP") {
          let cpyCurrentTriggerItem = {
            ...currentTriggerItem,
            currentApplication: data,
          };
          if (!onBoardWithOutLicense.includes(data?.providerName)) {
            setOnBoardAction("ASSIGN_USER_WITH_LICENSE");
          }
          setFlowEditApp({ ...cpyCurrentTriggerItem });
          setCurrentTriggerItem(cpyCurrentTriggerItem);
        }
      } else {
        setSelectedUserInfoMap((prev) => ({
          ...prev,
          [mapId]: {
            ...(selectedUserInfoMap[mapId] || {}),
            [action]: [{ ...data }],
          },
        }));
      }
    } else {
      if (type === "checkbox") {
        let mapper = selectedUserInfoMap[mapId] || {};
        let selectedData = mapper[action] || [];
        if (e.target.checked) {
          selectedData.push(data);
        } else {
          selectedData = selectedData.filter(
            (selData) => selData?.id !== data?.id
          );
        }
        setSelectedUserInfoMap((prev) => ({
          ...prev,
          [mapId]: {
            ...(selectedUserInfoMap[mapId] || {}),
            [action]: selectedData,
          },
        }));
      }
    }
  };

  const handleCreateWorkflow = async () => {
    if (!validateWorkFlow()) {
      notifyToast("error", "Please fill all the required fields");
      return;
    }
    setIsPageLoading(true);
    let finalList = [];
    flowItems?.map((data) => {
      let vendor = data?.currentApplication;
      let mapperId = `${vendor?.providerName}|${vendor?.id}`;
      let cpyObject = { ...selectedUserInfoMap[mapperId] };
      if (cpyObject?.TIMEZONE) {
        delete cpyObject.TIMEZONE;
      }
      if (cpyObject?.LANGUAGE) {
        delete cpyObject.LANGUAGE;
      }
      if (cpyObject?.REGION) {
        delete cpyObject.REGION;
      }
      let mapper = {
        providerName: vendor?.providerName,
        adminCloudId: vendor?.id,
        adminEmail: vendor?.adminEmail,
        timeZone: selectedUserInfoMap[mapperId]?.TIMEZONE?.[0]?.value || null,
        language: selectedUserInfoMap[mapperId]?.LANGUAGE?.[0]?.value || null,
        region: selectedUserInfoMap[mapperId]?.REGION?.[0]?.value || null,
        skus: onBoardLicenseMap[mapperId] || [],
        saaSApplicationRoles: Object.values(cpyObject || {}).flat(),
        groups: [],
      };
      finalList.push(mapper);
    });

    let fnlBody = {
      workFlowName: flowObject?.workFlowName || "Sample Workflow",
      workFlowLists: finalList,
    };
    let res = null;
    if (existingWorkFlowObject?.id) {
      fnlBody.id = existingWorkFlowObject?.id;
      fnlBody.createdOn = existingWorkFlowObject?.createdOn;
      fnlBody.updatedOn = existingWorkFlowObject?.updatedOn;
      fnlBody.updatedOn = existingWorkFlowObject?.updatedOn;
      fnlBody.userId = existingWorkFlowObject?.userId;
      res = await updateWorkFlow(fnlBody);
    } else {
      res = await createWorkFlow(fnlBody);
    }
    if (res?.status === "OK") {
      notifyToast(
        "success",
        existingWorkFlowObject?.id
          ? "Workflow updated successfully"
          : "Workflow created successfully"
      );
      setIsPageLoading(false);
      navigate("/Workflow/Template");
    } else {
      notifyToast("error", res?.res);
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (workFlowId) {
      getEditWorkFlowForEdit();
    }
  }, [workFlowId]);

  const getEditWorkFlowForEdit = async () => {
    setIsPageLoading(true);
    let res = await getWorkFlows(true, workFlowId);
    if (res?.status === "OK") {
      setExistingWorkFlowObject(res?.res[0]);
      makeUIForEditWorkFlow(res?.res[0]);
      setFlowObject({
        ...flowObject,
        workFlowName: res?.res[0]?.workFlowName,
      });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const makeUIForEditWorkFlow = (workFlowObject) => {
    let makeFlowItems = [];

    workFlowObject?.workFlowLists?.map((item) => {
      let mapperId = `${item?.providerName === "OTHERS" ? item?.externalProviderName : item?.providerName}|${item?.adminCloudId}`;
      let currentApplication = cloudsList?.find(
        (cld) => cld?.id === item?.adminCloudId
      );
      if (currentApplication?.id) {
        makeFlowItems.push({
          id: currentApplication?.id,
          action: null,
          currentApplication: currentApplication,
          subItems:
            item?.skus?.length > 0
              ? [
                {
                  action: null,
                  currentApplication: null,
                },
              ]
              : [],
        });

        let dumSelectedUserInfoMap = { ...selectedUserInfoMap };

        if (item?.timeZone) {
          if (item?.providerName === "SALESFORCE") {
            let timeZone = SalesForceTimeZones?.find(
              (tz) => tz?.value === item?.timeZone
            );
            dumSelectedUserInfoMap[mapperId] = {
              ...dumSelectedUserInfoMap[mapperId],
              TIMEZONE: [{ ...timeZone }],
            };
          }
        }

        if (item?.language) {
          if (item?.providerName === "SALESFORCE") {
            let language = SalesForceLanguages?.find(
              (lang) => lang?.value === item?.language
            );
            dumSelectedUserInfoMap[mapperId] = {
              ...dumSelectedUserInfoMap[mapperId],
              LANGUAGE: [{ ...language }],
            };
          }
        }

        if (item?.region) {
          if (item?.providerName === "SALESFORCE") {
            let region = SalesForceRegions?.find(
              (reg) => reg?.value === item?.region
            );
            dumSelectedUserInfoMap[mapperId] = {
              ...dumSelectedUserInfoMap[mapperId],
              REGION: [{ ...region }],
            };
          }
        }

        if (item?.saaSApplicationRoles?.length > 0) {
          let appMapper = item?.saaSApplicationRoles?.reduce((acc, curr) => {
            if (acc[curr?.roleFor]) {
              acc[curr?.roleFor].push(curr);
            } else {
              acc[curr?.roleFor] = [curr];
            }
            return acc;
          }, {});
          dumSelectedUserInfoMap[mapperId] = {
            ...dumSelectedUserInfoMap[mapperId],
            ...appMapper,
          };
        }

        setSelectedUserInfoMap((prev) => ({
          ...prev,
          [mapperId]: dumSelectedUserInfoMap[mapperId],
        }));

        setOnBoardLicenseMap((prev) => ({
          ...prev,
          [mapperId]: item?.skus,
        }));
      }
    });

    setFlowItems(makeFlowItems);
  };

  const validateWorkFlow = () => {
    let isValid = true;
    let dupErrorFields = { ...errorFields };
    flowItems?.map((data) => {
      let mapperId = `${data?.currentApplication?.providerName === "OTHERS" ? data?.currentApplication?.externalProviderName : data?.currentApplication?.providerName}|${data?.currentApplication?.id}`;
      let currentApplicationError = dupErrorFields[mapperId] || {};
      onBoardFields[data?.currentApplication?.providerName === "OTHERS" ? data?.currentApplication?.externalProviderName : data?.currentApplication?.providerName]?.map((field) => {
        if (!selectedUserInfoMap[mapperId]?.[field?.id]) {
          currentApplicationError[field?.id] =
            field?.name?.replaceAll(" *", "") + " field is required";
        }
      });
      if (Object.values(currentApplicationError).flat().length > 0) {
        dupErrorFields[mapperId] = currentApplicationError;
      }
    });
    setErrorFields(dupErrorFields);
    if (Object.values(dupErrorFields).flat().length > 0) {
      isValid = false;
    }
    return isValid;
  };

  console.log(errorFields);

  console.log(triggerList);

  const addNewAction = () => {
    let newAction = {
      id: new Date().getTime(),
      name: "Action " + (triggerList?.length + 1),
      currentApplication: null,
      event: null,
      department: null,
    };
    setTriggerList([...triggerList, newAction]);
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Workflow" />
        <div className="cf_main_content_place">
          <TopNav
            pageName={workFlowId ? "Edit Workflow" : "Create Workflow"}
            backLink="/Workflow/Template"
          />
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{ padding: "10px 0", gap: "15px" }}
          >
            <div
              className="cf_workflow_canvas_container_body_left"
              style={{ width: "350px", border: "none" }}
            >
              <div className="cf_newFlow_trigger_pannel">
                <div className="cf_newFlow_trigger_pannel_header">
                  <div className="cf_newFlow_trigger_pannel_header_icon">
                    <Activity size={14} />
                  </div>
                  <p className="cf_newFlow_trigger_pannel_header_name">
                    {triggerList[0]?.name}
                  </p>
                </div>
                <div className="cf_newFlow_trigger_pannel_body">
                  <p
                    className="cf_make_link"
                    style={{ fontSize: "12px", fontWeight: "500" }}
                    onClick={() => {
                      setCurrentAction("TRIGGER");
                      setCurrentTriggerItem(
                        triggerList?.filter(
                          (item) => item?.name === "TRIGGER"
                        )?.[0]
                      );
                    }}
                  >
                    {/* {triggerList?.filter((data) => data?.name === "TRIGGER")
                      ?.length > 0
                      ? "Edit Trigger"
                      : "Select Trigger"} */}
                    Select Trigger
                  </p>
                </div>
              </div>
              {triggerList?.length > 1 &&
                triggerList?.map((data, index) => {
                  return (
                    index > 0 && (
                      <div
                        className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent"
                        style={{ marginTop: "30px" }}
                      >
                        <div className="cf_newFlow_trigger_pannel_header">
                          <div className="cf_newFlow_trigger_pannel_header_icon">
                            <Play size={14} />
                          </div>
                          <p className="cf_newFlow_trigger_pannel_header_name">
                            Action {index}
                          </p>
                        </div>
                        <div className="cf_newFlow_trigger_pannel_body">
                          <p
                            className="cf_make_link"
                            style={{ fontSize: "12px", fontWeight: "500" }}
                            onClick={() => {
                              let newTriggerList = triggerList?.map((re) => {
                                if (re?.id === currentTriggerItem?.id) {
                                  re = currentTriggerItem;
                                }
                                return re;
                              });
                              setTriggerList(newTriggerList);
                              setCurrentAction("ACTION");
                              setCurrentTriggerItem(data);
                            }}
                          >
                            Select Action
                          </p>
                        </div>
                      </div>
                    )
                  );
                })}
              <div className="cf_action_trigger">
                <ActionButton
                  customClass={`changeButtonColorOnHover`}
                  customStyles={{
                    backgroundColor: "#f2f2f2",
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
                    addNewAction();
                  }}
                >
                  <Plus size={16} />
                </ActionButton>
              </div>
            </div>
            <div
              className="cf_newFlow_canvas"
              style={{
                width: "100%",
              }}
            >
              <div className="cf_newFlow_canvas_action">
                {currentAction === "TRIGGER" ? (
                  <>
                    <div
                      className="cf_workdflow_cloud_license_item"
                      style={{ flexDirection: "column", gap: "4px" }}
                    >
                      <p
                        className="cf_sub_heading"
                        style={{ color: "#64748b", fontWeight: "500" }}
                      >
                        Primary Application
                      </p>
                      <MultiSelectInputDropDown
                        loadAction={() => {
                          return true;
                        }}
                        displayFields={["providerName"]}
                        options={{
                          inputType: "radio",
                          inputName: "APP",
                          name: "Primary Application",
                        }}
                        isCloudsList={true}
                        suggestedData={cloudsList?.filter((cloud) =>
                          onBoardCloudsList.includes(cloud?.providerName)
                        )}
                        selectedData={
                          currentTriggerItem?.currentApplication?.id
                            ? [
                              {
                                ...currentTriggerItem?.currentApplication,
                              },
                            ]
                            : []
                        }
                        handleSelection={handleSelectFromMultiList}
                        parentStyle={{ maxWidth: "100%" }}
                      />
                    </div>
                    {currentTriggerItem?.currentApplication?.id && (
                      <div className="cf_workflow_event_condition_container">
                        <p
                          className="cf_sub_heading"
                          style={{ color: "#64748b", fontWeight: "500" }}
                        >
                          WHEN
                        </p>
                        <MultiSelectInputDropDown
                          loadAction={() => {
                            return true;
                          }}
                          displayFields={["name"]}
                          options={{
                            inputType: "radio",
                            inputName: "EVENT",
                            name: "Event",
                          }}
                          suggestedData={triggerEvents}
                          selectedData={
                            currentTriggerItem?.event?.id
                              ? [
                                {
                                  ...currentTriggerItem?.event,
                                },
                              ]
                              : []
                          }
                          handleSelection={handleSelectFromMultiList}
                          parentStyle={{ maxWidth: "160px", height: "35px" }}
                        />
                        {currentTriggerItem?.event?.id ? (
                          currentTriggerItem?.event?.id === "USER_CREATED" ? (
                            <>
                              <p
                                className="cf_sub_heading"
                                style={{ color: "#64748b", fontWeight: "500" }}
                              >
                                IN DEPARTMENT
                              </p>
                              <MultiSelectInputDropDown
                                loadAction={() => {
                                  return true;
                                }}
                                displayFields={["name"]}
                                options={{
                                  inputType: "radio",
                                  inputName: "DEPARTMENT",
                                  name: "Department",
                                }}
                                suggestedData={departmentList}
                                selectedData={
                                  currentTriggerItem?.department?.id
                                    ? [
                                      {
                                        ...currentTriggerItem?.department,
                                      },
                                    ]
                                    : []
                                }
                                handleSelection={handleSelectFromMultiList}
                                parentStyle={{
                                  maxWidth: "300px",
                                  height: "35px",
                                }}
                              />
                            </>
                          ) : (
                            ""
                          )
                        ) : (
                          <p></p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  ""
                )}
                {currentAction === "ACTION" ? (
                  <>
                    <div
                      className="cf_workdflow_cloud_license_item"
                      style={{ flexDirection: "column", gap: "4px" }}
                    >
                      <p
                        className="cf_sub_heading"
                        style={{ color: "#64748b", fontWeight: "500" }}
                      >
                        Select Application To Onboard
                      </p>
                      <MultiSelectInputDropDown
                        loadAction={() => {
                          return true;
                        }}
                        displayFields={["providerName"]}
                        options={{
                          inputType: "radio",
                          inputName: "APP",
                          name: "Select Application To Onboard",
                        }}
                        isCloudsList={true}
                        suggestedData={cloudsList?.filter((cloud) =>
                          onBoardCloudsList.includes(cloud?.providerName)
                        )}
                        selectedData={
                          currentTriggerItem?.currentApplication?.id
                            ? [
                              {
                                ...currentTriggerItem?.currentApplication,
                              },
                            ]
                            : []
                        }
                        handleSelection={handleSelectFromMultiList}
                        parentStyle={{ maxWidth: "100%" }}
                      />
                    </div>
                    <div className="CF_d-flex" style={{ gap: "30px" }}>
                      <div className="cf_workflow_event_condition_container_license">
                        <div className="cf_workflow_event_condition_container_license_header">
                          <p>Select License To Assign</p>
                        </div>
                        <div className="cf_workflow_event_condition_container_license_body">
                          {isLicenseLoaded
                            ? getCFTextLoader()
                            : licenseMap[
                              `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                            ]?.map((res) => (
                              <div className="cf_workdflow_cloud_license_item">
                                <input
                                  type="checkbox"
                                  onChange={(e) => {
                                    handleLicenseSelection(
                                      e,
                                      res,
                                      `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                                    );
                                  }}
                                  checked={onBoardLicenseMap[
                                    `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                                  ]?.find(
                                    (license) =>
                                      license?.id === res?.id &&
                                      license?.adminCloudId ===
                                      res?.adminCloudId
                                  )}
                                />
                                <p
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: "500",
                                    color: "#64748b",
                                  }}
                                >
                                  {res?.planName?.replaceAll("_", " ")}{" "}
                                  {res?.organization ? (
                                    <span
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      ({res?.organization})
                                    </span>
                                  ) : (
                                    ""
                                  )}
                                </p>
                              </div>
                            ))}
                        </div>
                      </div>
                      <div className="cf_workflow_event_condition_container_license">
                        <div className="cf_workflow_event_condition_container_license_header">
                          <p>Select Groups To Assign</p>
                        </div>
                        <div className="cf_workflow_event_condition_container_license_body">
                          {isLicenseLoaded
                            ? getCFTextLoader()
                            : licenseMap[
                              `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                            ]?.map((res) => (
                              <div className="cf_workdflow_cloud_license_item">
                                <input
                                  type="checkbox"
                                  onChange={(e) => {
                                    handleLicenseSelection(
                                      e,
                                      res,
                                      `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                                    );
                                  }}
                                  checked={onBoardLicenseMap[
                                    `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                                  ]?.find(
                                    (license) =>
                                      license?.id === res?.id &&
                                      license?.adminCloudId ===
                                      res?.adminCloudId
                                  )}
                                />
                                <p
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: "500",
                                    color: "#64748b",
                                  }}
                                >
                                  {res?.planName?.replaceAll("_", " ")}{" "}
                                  {res?.organization ? (
                                    <span
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      ({res?.organization})
                                    </span>
                                  ) : (
                                    ""
                                  )}
                                </p>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  ""
                )}
              </div>
            </div>
            {onBoardAction === "ZZZ" ? (
              <div
                className="cf_workflow_canvas_container_body_left"
                style={{ width: "400px" }}
              >
                <div
                  className="cf_newFlow_canvas_header"
                  style={{
                    borderBottom: "1px solid #e2e8f0",
                    boxShadow: "none",
                    borderRadius: "0",
                  }}
                >
                  <div className="cf_newFlow_canvas_header_name">
                    <p>
                      {onBoardAction === "CREATE_USER" ? "Create User" : ""}
                    </p>
                  </div>
                  <span style={{ marginLeft: "auto" }}></span>
                  <X
                    size={16}
                    onClick={() => setOnBoardAction(null)}
                    style={{ cursor: "pointer" }}
                  />
                </div>
                <div
                  className="cf_workflow_canvas_container_body_left_body"
                  style={{ overflow: "unset", height: "calc(100% - 50px)" }}
                >
                  {onBoardAction === "CREATE_USER" ? (
                    <div
                      className="cf_workdflow_cloud_license_item"
                      style={{
                        flexDirection: "column",
                        gap: "10px",
                        display: "flex",
                        marginTop: "15px",
                      }}
                    >
                      {onBoardFields[
                        flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName
                      ]?.map((field) => (
                        <div
                          className="cf_workdflow_cloud_license_item"
                          style={{ flexDirection: "column", gap: "4px" }}
                        >
                          <p
                            className="cf_sub_heading"
                            style={{ color: "#64748b", fontWeight: "500" }}
                          >
                            {field?.name}
                          </p>
                          <MultiSelectInputDropDown
                            loadAction={() => getRoles(field?.id)}
                            displayFields={field?.displayFields || ["roleName"]}
                            options={{
                              inputType: field?.inputType || "radio",
                              inputName: field?.id,
                              name: field?.name,
                            }}
                            suggestedData={
                              userInfoMap[
                              `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                              ]?.[field?.id] || []
                            }
                            selectedData={
                              selectedUserInfoMap[
                              `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                              ]?.[field?.id] || []
                            }
                            handleSelection={handleSelectFromMultiList}
                          />
                        </div>
                      ))}
                    </div>
                  ) : !isLicenseLoaded &&
                    licenseMap[
                      `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                    ]?.length === 0 ? (
                    <p>No licenses found...</p>
                  ) : (
                    ""
                  )}
                  {isLicenseLoaded
                    ? getCFTextLoader()
                    : licenseMap[
                      `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                    ]?.map((res) => (
                      <div className="cf_workdflow_cloud_license_item">
                        <input
                          type="checkbox"
                          onChange={(e) => {
                            handleLicenseSelection(
                              e,
                              res,
                              `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                            );
                          }}
                          checked={onBoardLicenseMap[
                            `${flowEditApp?.currentApplication?.providerName === "OTHERS" ? flowEditApp?.currentApplication?.externalProviderName : flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                          ]?.find(
                            (license) =>
                              license?.id === res?.id &&
                              license?.adminCloudId === res?.adminCloudId
                          )}
                        />
                        <p>
                          {res?.planName?.replaceAll("_", " ")}{" "}
                          {res?.organization ? (
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: "500",
                              }}
                            >
                              ({res?.organization})
                            </span>
                          ) : (
                            ""
                          )}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              ""
            )}
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default NewFlowV2;
