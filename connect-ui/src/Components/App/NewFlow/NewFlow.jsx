import { Plus, SaveAll, X } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import SalesForceLanguages from "../../helpers/JSON/SalesForceLanguages.json";
import SalesForceRegions from "../../helpers/JSON/SalesForceRegions.json";
import SalesForceTimeZones from "../../helpers/JSON/SalesForceTimeZones.json";
import { notifyToast, onBoardWithOutLicense } from "../../helpers/utils";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import MultiSelectInputDropDown from "../../Resuables/InputsComponents/MultiSelectInputDropDown";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
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
const NewFlow = () => {
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
        `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
      ]
    ) {
      return;
    }
    setIsLicenseLoaded(true);
    let res = await getLicensesList(
      "",
      flowEditApp?.currentApplication?.providerName,
      flowEditApp?.currentApplication?.id
    );

    if (res?.status === "OK") {
      setLicenseMap({
        ...licenseMap,
        [`${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`]:
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
        `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
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
      action
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
      setSelectedUserInfoMap((prev) => ({
        ...prev,
        [mapId]: {
          ...(selectedUserInfoMap[mapId] || {}),
          [action]: [{ ...data }],
        },
      }));
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
      let mapperId = `${item?.providerName}|${item?.adminCloudId}`;
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
      let mapperId = `${data?.currentApplication?.providerName}|${data?.currentApplication?.id}`;
      let currentApplicationError = dupErrorFields[mapperId] || {};
      onBoardFields[data?.currentApplication?.providerName]?.map((field) => {
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
              style={{ width: "350px" }}
            >
              <div style={{ padding: "0 10px" }}>
                <SearchComponent
                  autoOpen={true}
                  boxShadows={true}
                  inputName="searchInput"
                  customStyles={{
                    width: "100%",
                    height: "40px",
                    marginTop: "5px",
                  }}
                  inputPlaceHolder={`Search By Application Name or Email`}
                  onInputSearch={(e) => setSearchInput(e?.searchInput)}
                />
              </div>
              <div
                className="cf_workflow_canvas_container_body_left_body"
                style={{
                  justifyContent: "flex-start",
                  height: "calc(100% - 50px)",
                }}
              >
                {cloudsList
                  ?.filter(
                    (cld) => cld?.providerName !== "OTHERS" && cld?.providerName
                  )
                  ?.filter(
                    (cld) =>
                      getCloudName(cld?.providerName)
                        ?.toLowerCase()
                        ?.includes(searchInput?.toLowerCase()) ||
                      cld?.adminEmail
                        ?.toLowerCase()
                        ?.includes(searchInput?.toLowerCase())
                  )
                  ?.map((cloud, index) => (
                    <div
                      key={cloud?.id}
                      data-id={cloud?.id}
                      className="cf_workflow_canvas_container_body_left_body_item"
                      style={{
                        border: "none",
                        height: "40px",
                        cursor: "default",
                        justifyContent: "flex-start",
                      }}
                    >
                      <div
                        className="cf_workflow_canvas_container_body_left_body_item_content"
                        style={{
                          height: "40px",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          gap: "10px",
                        }}
                      >
                        <input
                          type="checkbox"
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFlowItems([
                                ...flowItems,
                                {
                                  id: cloud?.id,
                                  action: null,
                                  currentApplication: cloud,
                                  subItems: [],
                                },
                              ]);
                            } else {
                              setFlowItems(
                                flowItems.filter((item) => item.id !== cloud.id)
                              );
                            }
                          }}
                          checked={flowItems.some(
                            (item) => item.id === cloud.id
                          )}
                        />
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          <img
                            src={cloudImageMapper(cloud?.providerName)}
                            alt={cloud?.name}
                            style={{
                              width: "20px",
                              height: "20px",
                            }}
                          />
                          <div className="cf_workflow_canvas_container_body_left_body_item_content_email">
                            {cloud?.adminEmail
                              ? cloud?.adminEmail
                              : getCloudName(cloud?.providerName)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div
              className="cf_newFlow_canvas"
              style={{
                width: onBoardAction ? "calc(100% - 400px)" : "100%",
              }}
            >
              <div className="cf_newFlow_canvas_action">
                <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                  <div className="cf_newFlow_canvas_header">
                    <div className="cf_newFlow_canvas_header_name">
                      <p
                        className="cf_newFlow_canvas_header_name_p"
                        contentEditable={true}
                        onBlur={(e) => {
                          setFlowObject({
                            ...flowObject,
                            workFlowName: e.target.innerText,
                          });
                        }}
                      >
                        {existingWorkFlowObject?.workFlowName || "Flow Name"}
                      </p>
                    </div>
                    <span
                      style={{ fontSize: "12px", fontWeight: "500" }}
                    ></span>
                  </div>
                  <ActionButton
                    customClass={`changeButtonColorOnHover ${
                      false ? "cf_button_disabled" : ""
                    }`}
                    customStyles={{
                      backgroundColor: "#fff",
                      height: "45px",
                      width: "100px",
                    }}
                    isDisabled={false}
                    buttonType="button"
                    buttonClickAction={() => {
                      handleCreateWorkflow();
                    }}
                  >
                    <div
                      className="CF_d-flex ai-center"
                      style={{
                        gap: "5px",
                        width: "100%",
                        justifyContent: "center",
                      }}
                    >
                      <SaveAll size={16} />
                      <p style={{ fontSize: "12px" }}>
                        {existingWorkFlowObject?.id ? "Update" : "Save"}
                      </p>
                    </div>
                  </ActionButton>
                </div>
                <div className="cf_newFlow_canvas_action_placer_items">
                  {/* <div
                  className="cf_newFlow_canvas_dottedLines"
                  style={{ height: "calc(100% - 40px)" }}
                ></div> */}
                  {flowItems.map((item, index) => (
                    <>
                      <div
                        key={index}
                        className="cf_newFlow_canvas_header cf_sub_header"
                      >
                        <div
                          className="cf_newFlow_canvas_dottedLines"
                          style={
                            index === 0
                              ? { width: "2px" }
                              : { height: "155px", top: "-130px", width: "2px" }
                          }
                        ></div>
                        <div
                          className="CF_d-flex ai-center cf_newFlow_canvas_header_image_block"
                          style={{ gap: "10px" }}
                        >
                          <img
                            src={cloudImageMapper(
                              item?.currentApplication?.providerName
                            )}
                            alt={item?.currentApplication?.name}
                            style={{
                              width: "20px",
                              height: "20px",
                              objectFit: "contain",
                            }}
                          />
                          <p className="cf_sub_header_p">
                            <span style={{ fontWeight: "500" }}>
                              Onboard{" "}
                              {userActionRequired.includes(
                                item?.currentApplication?.providerName
                              ) ? (
                                <span
                                  className="cf_make_link"
                                  style={{ fontWeight: "500" }}
                                  onClick={() => {
                                    setOnBoardAction("CREATE_USER");
                                    setFlowEditApp(item);
                                  }}
                                >
                                  User
                                </span>
                              ) : (
                                "User"
                              )}
                            </span>
                          </p>
                        </div>
                      </div>
                      {onBoardWithOutLicense?.includes(
                        item?.currentApplication?.providerName
                      ) ? (
                        ""
                      ) : (
                        <div
                          className="cf_newFlow_canvas_action_placer_items"
                          style={{ marginTop: "-20px", gap: "15px" }}
                        >
                          <div className="cf_newFlow_canvas_dottedLines_subline"></div>
                          {item?.subItems?.map((subItem, subIndex) => (
                            <div
                              key={index}
                              className="cf_newFlow_canvas_header cf_sub_header"
                            >
                              <div className="cf_newFlow_canvas_dottedLines_subline"></div>
                              <div
                                className="CF_d-flex ai-center cf_newFlow_canvas_header_image_block"
                                style={{ gap: "10px" }}
                              >
                                <img
                                  src={cloudImageMapper(
                                    item?.currentApplication?.providerName
                                  )}
                                  alt={item?.currentApplication?.name}
                                  style={{
                                    width: "20px",
                                    height: "20px",
                                    objectFit: "contain",
                                  }}
                                />
                                <p className="cf_sub_header_p">
                                  {subIndex === 0 ? (
                                    <span
                                      style={{ fontWeight: "500" }}
                                      onClick={() => {
                                        setOnBoardAction(
                                          "ASSIGN_USER_WITH_LICENSE"
                                        );
                                        setFlowEditApp(item);
                                      }}
                                    >
                                      Assign User With{" "}
                                      <span
                                        className="cf_make_link"
                                        style={{ fontWeight: "500" }}
                                      >
                                        {onBoardLicenseMap[
                                          `${item?.currentApplication?.providerName}|${item?.currentApplication?.id}`
                                        ]?.length > 0
                                          ? onBoardLicenseMap[
                                              `${item?.currentApplication?.providerName}|${item?.currentApplication?.id}`
                                            ]?.length + " License"
                                          : "License"}
                                      </span>
                                    </span>
                                  ) : (
                                    ""
                                  )}
                                  {subIndex === 1 ? (
                                    <span
                                      style={{ fontWeight: "500" }}
                                      onClick={() => {
                                        setOnBoardAction(
                                          "ASSIGN_USER_WITH_GROUPS_TEAMS"
                                        );
                                      }}
                                    >
                                      Assign User With{" "}
                                      <span
                                        className="cf_make_link"
                                        style={{ fontWeight: "500" }}
                                      >
                                        Groups/Teams
                                      </span>
                                    </span>
                                  ) : (
                                    ""
                                  )}
                                </p>
                              </div>
                            </div>
                          ))}
                          {item?.subItems?.length < 1 ? (
                            <div className="cf_newFlow_canvas_action_placer">
                              <ActionButton
                                customClass={`${
                                  flowEditApp?.currentApplication
                                    ?.providerName && flowEditApp?.action
                                    ? "changeButtonColorOnHover"
                                    : "changeButtonColorOnHover"
                                }`}
                                customStyles={{
                                  backgroundColor: "#fff",
                                  height: "35px",
                                  width: "35px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                buttonType="button"
                                isDisabled={false}
                                buttonClickAction={() => {
                                  let currentFlowItems = { ...item };
                                  currentFlowItems?.subItems?.push({
                                    action: null,
                                    currentApplication: null,
                                  });
                                  let dummFlow = [...flowItems];
                                  dummFlow[index] = currentFlowItems;
                                  setFlowItems(dummFlow);
                                }}
                              >
                                <Plus size={16} />
                              </ActionButton>
                            </div>
                          ) : (
                            ""
                          )}
                        </div>
                      )}
                    </>
                  ))}
                </div>
              </div>
            </div>
            {onBoardAction ? (
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
                      {onBoardAction === "CREATE_USER"
                        ? "Create User"
                        : "Assign User With License"}
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
                        flowEditApp?.currentApplication?.providerName
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
                                `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                              ]?.[field?.id] || []
                            }
                            selectedData={
                              selectedUserInfoMap[
                                `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                              ]?.[field?.id] || []
                            }
                            handleSelection={handleSelectFromMultiList}
                          />
                        </div>
                      ))}
                    </div>
                  ) : !isLicenseLoaded &&
                    licenseMap[
                      `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                    ]?.length === 0 ? (
                    <p>No licenses found...</p>
                  ) : (
                    ""
                  )}
                  {isLicenseLoaded
                    ? getCFTextLoader()
                    : licenseMap[
                        `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                      ]?.map((res) => (
                        <div className="cf_workdflow_cloud_license_item">
                          <input
                            type="checkbox"
                            onChange={(e) => {
                              handleLicenseSelection(
                                e,
                                res,
                                `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
                              );
                            }}
                            checked={onBoardLicenseMap[
                              `${flowEditApp?.currentApplication?.providerName}|${flowEditApp?.currentApplication?.id}`
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

export default NewFlow;
