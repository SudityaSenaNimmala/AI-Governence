import {
  Building,
  Circle,
  CirclePlay,
  CircleX,
  Minus,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { BiFilterAlt } from "react-icons/bi";
import { FaRegCheckCircle } from "react-icons/fa";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  cloudImageMapper,
  getCloudName,
  getRandomArray,
  onBoardCloudsList,
} from "../../../helpers/helpers";
import {
  downloadUserPasswordCSV,
  getMaxChar,
  makeOnBoardObjectForExistingUser,
  makeWorkFlowObject,
  newImplementation,
  notifyToast,
  onBoardWithOutLicense,
  userActionRequired,
  validateEmail,
  validatePassword,
} from "../../../helpers/utils";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import Popup from "../../../Resuables/Popup/Popup";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getUniqueUsersList } from "../../Dashboard/DashboardActions/DashboardActions";
import {
  getLicensesList,
  getVendorSearch,
} from "../../SaaSManagement/SaaSActions/SaaSActions";
import "../css/UserManagement.css";
import {
  deleteOnBoardUserWithId,
  getOnBoardUsersList,
  getWorkFlows,
  runBulkOnBoard,
  saveOnBoardingUser,
} from "../UserManagementActions/UserManagementActions";
import OnBoardHandleUserOptions from "./OnBoardHandleUserOptions";

const OnBoard = () => {
  const [selWsList, setSelWsList] = useState([]);
  const { globalContext } = useContext(GlobalContext);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [activeCloudFilter, setActiveCloudFilter] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({ key: "ALL", value: "All" });
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [errorFields, setErrorFields] = useState({});
  const [usersList, setUsersList] = useState([]);
  const [usersListUnique, setUsersListUnique] = useState([]);
  const [showWorkFlow, setShowWorkFlow] = useState(false);
  const [isExistingUser, setIsExistingUser] = useState(false);
  const [workFlowOptionsSelected, setWorkFlowOptionsSelected] = useState(null);
  const [workFlowsList, setWorkFlowsList] = useState([]);
  const [selectedWorkFlow, setSelectedWorkFlow] = useState(null);
  const [userInfoMap, setUserInfoMap] = useState({});
  const [selectedUserInfoMap, setSelectedUserInfoMap] = useState({});
  const [searchValues, setSearchValues] = useState({
    title: "",
  });
  const [selectedUser, setSelectedUser] = useState({
    viewVendors: {},
    uniqueMemeberId: [],
    offBoardStatus: {},
    offBoardVendor: {},
    startOffBoarding: false,
    offBoardVendorSelected: [],
    deleteUserPermanently: false,
  });
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [workFlowBody, setWorkFlowBody] = useState({
    user: {},
    skews: {},
    clouds: {},
    adminCloudId: {},
    cloudsStatus: {},
    uniqueCloudsList: [],
    onBoardingStarted: false,
  });
  const [thinkificUserEmail, setThinkificUserEmail] = useState({
    email: "",
    error: "",
  });
  const [cloudLicenceInfo, setCloudLicenceInfo] = useState({
    isLoading: true,
    list: [],
  });
  const [selectCloud, setSelectCloud] = useState("");
  const [formValues, setFormValues] = useState({
    firstName: "",
    lastName: "",
    email: "",
    passWord: "",
    cPassWord: "",
    changePasswordAtNextLogin: true,
  });

  const noPasswordRequired = ["BOX_BUSINESS", "SHARE_FILE_BUSINESS"];

  useEffect(() => {
    getOnBoardUsers();
    getWorkFlowsList();
  }, []);

  const getWorkFlowsList = async () => {
    let res = await getWorkFlows();
    if (res?.status === "OK") {
      setWorkFlowsList(res?.res?.onBoardWorkFlowList || []);
    }
  };

  const getOnBoardUsers = async () => {
    setIsPageLoading(true);
    let res = await getOnBoardUsersList(1, 50);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setUsersList(res?.res);
      fetchUniqueUsersList();
      // fetchSaaSCosting();
    } else {
      fetchUniqueUsersList();
      // fetchSaaSCosting();
      setIsPageLoading(false);
    }
  };

  const deleteUser = async () => {
    setIsPageLoading(true);
    setIsVisible(false);
    let res = await deleteOnBoardUserWithId(deleteId);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setUsersList((prevUsers) =>
        prevUsers.filter((user) => user.id !== deleteId)
      );
      notifyToast("success", "User Deleted Successfully");
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed Deleting User");
    }
  };

  const getFormInputs = (val, name) => {
    if (name === "email" && val.includes("@")) {
      setErrorFields({
        ...errorFields,
        email: "Email should not contain any domain",
      });
    } else {
      let copyErrorFields = { ...errorFields };
      if (name === "passWord" || name === "cPassWord") {
        delete copyErrorFields["passWord"];
        delete copyErrorFields["cPassWord"];
      } else {
        delete copyErrorFields[name];
      }
      setErrorFields(copyErrorFields);
    }
    setFormValues({ ...formValues, [name]: val });
  };

  const saveOnBoardUser = async () => {
    let errorFields = {};
    if (!formValues?.firstName) {
      errorFields = { ...errorFields, firstName: "First Name is Required" };
    }

    if (formValues?.firstName?.length < 3) {
      errorFields = {
        ...errorFields,
        firstName: "First Name must be at least 3 characters long",
      };
    }

    if (!formValues?.lastName) {
      errorFields = { ...errorFields, lastName: "Last Name is Required" };
    }

    if (formValues?.lastName?.length < 3) {
      errorFields = {
        ...errorFields,
        lastName: "Last Name must be at least 3 characters long",
      };
    }

    if (!formValues?.email) {
      errorFields = { ...errorFields, email: "Email is Required" };
    }

    if (formValues?.email?.length < 3) {
      errorFields = {
        ...errorFields,
        email: "Email must be at least 3 characters long",
      };
    }

    let passCheck = validatePassword(formValues?.passWord, "Password");
    let cPassCheck = validatePassword(
      formValues?.cPassWord,
      "Confirm Password"
    );

    if (passCheck) {
      errorFields = {
        ...errorFields,
        passWord: passCheck,
      };
    }

    if (cPassCheck) {
      errorFields = {
        ...errorFields,
        cPassWord: cPassCheck,
      };
    }

    if (formValues?.passWord !== formValues?.cPassWord) {
      errorFields = {
        ...errorFields,
        cPassWord: "Password Mismatch",
        passWord: "Password Mismatch",
      };
    }

    setErrorFields(errorFields);
    if (Object.keys(errorFields).length !== 0) {
      return false;
    }
    setIsFormVisible(false);
    setIsPageLoading(true);
    let userObj = { ...formValues };
    delete userObj.cPassWord;

    let res = await saveOnBoardingUser([{ ...userObj }]);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "User Created Successfully");
      setFormValues({
        firstName: "",
        lastName: "",
        email: "",
        passWord: "",
        cPassWord: "",
        changePasswordAtNextLogin: true,
      });
      getOnBoardUsers();
    } else {
      setIsPageLoading(false);
      setFormValues({
        firstName: "",
        lastName: "",
        email: "",
        passWord: "",
        cPassWord: "",
        changePasswordAtNextLogin: true,
      });
      notifyToast("error", "Failed Creating User");
    }
  };

  const startUserOnBoarding = async (returnValue = workFlowBody) => {
    let workFlowBodyObj = workFlowBody;
    if (returnValue?.uniqueCloudsList?.length > 0) {
      workFlowBodyObj = returnValue;
    } else {
      workFlowBodyObj = workFlowBody;
    }
    if (
      workFlowBodyObj?.uniqueCloudsList.includes("THINKIFIC") &&
      workFlowOptionsSelected === null
    ) {
      if (!validateEmail(thinkificUserEmail?.email)) {
        setThinkificUserEmail({
          email: thinkificUserEmail?.email,
          error: "Please Provide Valid Email",
        });
        return;
      }
    }
    setWorkFlowBody({ ...workFlowBodyObj, onBoardingStarted: true });

    let updatedCloudsStatus = { ...workFlowBodyObj?.cloudsStatus };
    let finalList = [];
    let dupSelectedUserInfoMap = { ...selectedUserInfoMap };
    for (let cld of workFlowBodyObj?.uniqueCloudsList) {
      let onBoardUser = { ...workFlowBodyObj?.user };
      let cloud = cld.split("|")[0];
      onBoardUser.vendor = cloud;
      let skew = workFlowBodyObj?.skews[`${cld}`]?.reduce((acc, curr) => {
        delete curr.id;
        acc.push(curr);
        return acc;
      }, []);

      onBoardUser.subIds = skew;
      onBoardUser.adminMemberId =
        globalContext?.cloudsList?.find(
          (cloud) => cloud.id === workFlowBodyObj?.clouds[cld]
        )?.memberId || workFlowBodyObj?.clouds[cld];
      onBoardUser.adminCloudId = workFlowBodyObj?.adminCloudId[cld];
      if (noPasswordRequired.includes(cloud)) {
        onBoardUser.passWord = "";
      } else {
        onBoardUser.passWord = workFlowBodyObj?.user.passWord;
      }
      updatedCloudsStatus[cld] = "IN_PROGRESS";

      console.log(selectedUserInfoMap[cld]);

      onBoardUser.timeZone = workFlowBodyObj?.timeZones
        ? workFlowBodyObj?.timeZones[cld]
        : selectedUserInfoMap[cld]?.TIMEZONE?.[0]?.value || selectedUserInfoMap[cld]?.TIMEZONE?.[0]?.roleName;
      onBoardUser.language = workFlowBodyObj?.languages
        ? workFlowBodyObj?.languages[cld]
        : selectedUserInfoMap[cld]?.LANGUAGE?.[0]?.value || null;
      onBoardUser.region = workFlowBodyObj?.regions
        ? workFlowBodyObj?.regions[cld]
        : selectedUserInfoMap[cld]?.REGION?.[0]?.value || null;

      onBoardUser.commonName =
        selectedUserInfoMap[cld]?.CUSTOM_ACTION?.[0]?.id || null;
      if (cloud !== "VISUAL_VISITOR") {
        delete dupSelectedUserInfoMap[cld]?.TIMEZONE;
      }
      delete dupSelectedUserInfoMap[cld]?.LANGUAGE;
      delete dupSelectedUserInfoMap[cld]?.REGION;
      delete dupSelectedUserInfoMap[cld]?.CUSTOM_ACTION;

      onBoardUser.saaSApplicationRoles = workFlowBodyObj?.saaSApplicationRoles
        ? workFlowBodyObj?.saaSApplicationRoles[cld] || []
        : Object.values(dupSelectedUserInfoMap[cld] || {}).flat();

      if (cloud === "THINKIFIC" && !onBoardUser.existingUser) {
        if (validateEmail(workFlowBodyObj?.user?.email)) {
          onBoardUser.email = workFlowBodyObj?.user?.email;
        } else {
          let domain =
            workFlowBodyObj?.skews[cld]?.[0] || thinkificUserEmail?.email;
          onBoardUser.email = `${workFlowBodyObj?.user?.email}@${domain?.split("@")[1]
            }`;
        }
      } else {
        onBoardUser.email = workFlowBodyObj?.user?.email;
      }

      if (cloud === "THINKIFIC") {
        onBoardUser.subIds = null;
      }

      setWorkFlowBody((prevState) => ({
        ...prevState,
        cloudsStatus: updatedCloudsStatus,
        onBoardingStarted: true,
      }));
      delete onBoardUser.existingVendors;

      finalList.push(onBoardUser);
    }

    let res = await onboardUserBasedOnCloud(finalList);

    if (res?.length === 0) {
      updatedCloudsStatus[
        finalList[0]?.vendor + "|" + finalList[0]?.adminCloudId
      ] = "FAILED";
      setWorkFlowBody((prevState) => ({
        ...prevState,
        user: finalList,
        cloudsStatus: updatedCloudsStatus,
        onBoardingStarted: true,
      }));
    } else {
      res?.map((resData, index) => {
        if (resData?.adminCloudId) {
          if (
            resData?.errorMsg?.includes("User created") ||
            resData?.errorMsg === null
          ) {
            updatedCloudsStatus[resData?.vendor + "|" + resData?.adminCloudId] =
              "COMPLETED";
          } else {
            updatedCloudsStatus[resData?.vendor + "|" + resData?.adminCloudId] =
              "FAILED";
          }
        } else {
          let adminCloudId = finalList[index]?.adminCloudId;
          updatedCloudsStatus[resData?.vendor + "|" + adminCloudId] = "FAILED";
        }
        setWorkFlowBody((prevState) => ({
          ...prevState,
          user: res,
          cloudsStatus: updatedCloudsStatus,
          onBoardingStarted: true,
        }));
      });
    }
  };

  const onboardUserBasedOnCloud = async (onBoardUser) => {
    let res = await runBulkOnBoard(onBoardUser);
    if (res?.status === "OK") {
      return res?.res;
    } else {
      // return "OK";
      return res?.res;
    }
  };

  const getListLicences = async (memberId, cloudName) => {
    // setIsPageLoading(true);
    if (cloudName === "THINKIFIC") {
      setIsPageLoading(false);
      return;
    }
    let res = await getLicensesList(memberId, cloudName, memberId);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setCloudLicenceInfo({ isLoading: false, list: res?.res || [] });
    } else {
      setCloudLicenceInfo({ isLoading: false, list: [] });
      // setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (selectCloud) {
      // alert();
      let cloudData = selectCloud.split("|");
      if (cloudData[0] === "THINKIFIC") {
        setCloudLicenceInfo({ isLoading: false, list: [] });
        return;
      } else {
        setCloudLicenceInfo({ isLoading: true, list: [] });
        getListLicences(cloudData[1], cloudData[0]);
      }
    }
  }, [selectCloud]);

  const searchDebounce = useRef(null);
  const searchUsersList = async (e) => {
    setActiveCloudFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        searchUsers(e);
      }, 500);
    } else {
      fetchUniqueUsersList();
    }
  };

  const searchUsers = async (searchValue) => {
    setIsPageLoading(true);
    let res = await getVendorSearch(
      "UNIQUUSERSSEARCH",
      "unqusers",
      searchValue?.trim(),
      false,
      filters?.key
    );
    if (res?.status === "OK") {
      if (res?.res?.data?.length > 0) {
        setIsPageLoading(false);
        setUsersListUnique(res?.res?.data);
        setPagination({
          totalDocuments: res?.res?.totalDocuments,
          currentPage: 1,
          pageSize: 100,
          totalPages: Math.ceil(res?.res?.totalDocuments / 100),
        });
      } else {
        setIsPageLoading(false);
        notifyToast("error", "No Data Found");
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  const fetchUniqueUsersList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize
  ) => {
    setUsersListUnique([]);
    setIsLoading(true);
    let res = await getUniqueUsersList(pageNo, pageSize, filters?.key);
    if (res?.status === "OK") {
      setIsLoading(false);
      setUsersListUnique(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          totalDocuments: res?.res?.totalDocuments,
          currentPage: 1,
          pageSize: pageSize,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUniqueUsersList();
  }, [filters]);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchUniqueUsersList(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchUniqueUsersList(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  // const fetchSaaSCosting = async () => {
  //   let res = await getSaaSCostingWithAppList();
  //   if (res?.status === "OK") {
  //     setPagination({
  //       totalDocuments: res?.res?.totalUniqueUserCount,
  //       currentPage: 1,
  //       pageSize: 100,
  //       totalPages: Math.ceil(res?.res?.totalUniqueUserCount / 100),
  //     });
  //   }
  // };

  const startUserOnBoardingWithWorkflow = async () => {
    setIsPageLoading(true);
    let res = await getWorkFlows(true, selectedWorkFlow?.id);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      let returnValue = makeWorkFlowObject(
        res?.res?.onBoardWorkFlowList?.[0] || null,
        workFlowBody,
        globalContext?.cloudsList
      );
      startUserOnBoarding(returnValue);
      setWorkFlowBody((prevState) => ({
        ...prevState,
        ...returnValue,
      }));
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed To Get Workflow");
    }
  };

  const handleSelectFromMultiList = (e, eData, action, type, cloudInfo) => {
    let mapId = `${cloudInfo?.providerName}|${cloudInfo?.id}`;

    if (type === "radio") {
      setSelectedUserInfoMap((prev) => ({
        ...prev,
        [mapId]: {
          ...(selectedUserInfoMap[mapId] || {}),
          [action]: [{ ...eData }],
        },
      }));
    } else {
      if (type === "checkbox") {
        let mapper = selectedUserInfoMap[mapId] || {};
        let selectedData = mapper[action] || [];
        if (e.target.checked) {
          selectedData.push(eData);
        } else {
          selectedData = selectedData.filter(
            (selData) => selData?.id !== eData?.id
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

  const setSelectedUserInfoMapInternal = (infoMap) => {
    setUserInfoMap(infoMap);
  };

  console.log(userInfoMap);
  console.log(selectedUserInfoMap);

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Workflow" />
        <div className="cf_main_content_place">
          <TopNav pageName="Onboard Users" backLink="/Workflow" />

          <input
            style={{
              width: "0",
              height: "0",
              opacity: "0",
            }}
            type="text"
            name="nomad"
            autoComplete="off"
            placeholder="Search By User Email Or Name"
          />
          <div
            className="cf_main_content_place_main"
            style={{ padding: "10px 0", gap: "15px" }}
          >
            <div className="cf_add_cloud_filter_div">
              <SearchComponent
                autoOpen={true}
                boxShadows={true}
                inputName="searchInput"
                customStyles={{ width: "350px", height: "40px" }}
                customButtonStyles={{
                  background: "transparent",
                  color: "rgb(255, 255, 255)",
                  fontWeight: "bolder",
                  height: "35px",
                }}
                inputPlaceHolder={`Search By Name Or Email`}
                onInputSearch={(e) => searchUsersList(e.searchInput)}
              />
              <span style={{ marginLeft: "auto" }}></span>
              <ButtonComponent
                inputWidth="115px"
                customstyles={{ padding: "0 5px", borderRadius: "5px" }}
                isLoading={false}
                isDisabled={false}
                buttonName="Create User"
                buttonClickAction={() => setIsFormVisible(true)}
              />
            </div>
            <div
              className="cf_main_content_place_main CF_d-flex"
              style={{
                gap: "10px",
                padding: "10px 0 0 0",
                height: "calc(100vh - 130px)",
              }}
            >
              <div
                className="cf_main_content_place_main CF_d-flex"
                style={{
                  padding: "0 0 10px 0",
                  flexDirection: "column",
                  height: "calc(100%)",
                  width: !selectedUser?.viewVendors?.email ? "100%" : "75%",
                }}
              >
                <div
                  className="cf_new_tables_div"
                  style={{ height: "calc(100% - 50px)" }}
                >
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: "20%" }}>Email/Name</th>
                        <th style={{ width: "60%" }}>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "10px" }}
                          >
                            <span
                              className="CF_d-flex cf_mapping_email"
                              style={{ gap: "10px", width: "fit-content" }}
                            >
                              Applications
                            </span>
                            <CustomDropDown
                              isCloudsList={true}
                              customDropDownStyles={{
                                width: "fit-content",
                                left: "-100%",
                              }}
                              defaultVal={filters}
                              dropDownList={[
                                { key: "ALL", value: "All" },
                                ...globalContext?.cloudsList?.reduce(
                                  (acc, curr) => {
                                    if (
                                      curr?.providerName !== "OTHERS" &&
                                      curr?.providerName
                                    ) {
                                      acc.push({
                                        key: curr?.providerName,
                                        value: curr?.providerName,
                                      });
                                    }
                                    return acc;
                                  },
                                  []
                                ),
                              ]}
                              selectFilter={(e) => setFilters(e)}
                            >
                              <span className="CF_Pointer CF_d-flex ai-center">
                                <BiFilterAlt />
                              </span>
                            </CustomDropDown>
                          </div>
                        </th>
                        <th style={{ width: "20%" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading ? (
                        <>
                          <tr>
                            <td colSpan={3}>{getCFTextLoader()}</td>
                          </tr>
                          <tr style={{ visibility: "hidden" }}>
                            <td className="cf_new_table_hide_text">
                              <p>
                                vimalesh.t_cloudfuze...odclub.onmicrosoft.com
                              </p>
                            </td>
                            <td className="cf_new_table_hide_text">
                              <p>User</p>
                            </td>
                            <td className="cf_new_table_hide_text">
                              <ButtonComponent
                                customstyles={{ height: "35px" }}
                                inputWidth="150px"
                                isLoading={false}
                                isDisabled={false}
                              >
                                <div
                                  className="CF_d-flex ai-center"
                                  style={{
                                    gap: "5px",
                                    width: "100%",
                                    justifyContent: "center",
                                  }}
                                >
                                  <p style={{ color: "#fff" }}>Run WorkFlow</p>
                                </div>
                              </ButtonComponent>
                            </td>
                          </tr>
                        </>
                      ) : (
                        <>
                          {filters?.key !== "ALL"
                            ? ""
                            : activeCloudFilter?.length > 0 &&
                              activeCloudFilter !== ""
                              ? ""
                              : usersList?.map((res, index) => (
                                <tr key={res?.email || res?.firstName}>
                                  <td className="cf_new_table_hide_text">
                                    <p>{getMaxChar(res?.email, 40)}</p>
                                  </td>
                                  {/* //   return <div className={`bg_35-${cloud}`}></div>; */}
                                  <td className="cf_new_table_hide_text">
                                    <div
                                      className="CF_d-flex ai-center"
                                      style={{ gap: "8px" }}
                                    >
                                      {res?.vendors?.map((cloud, index) => {
                                        return cloud?.name ? (
                                          index < 8 ? (
                                            <div className="cf_cloudImageCloadDiv CF_Pointer">
                                              <div className="cf_cloudImageCloadDiv CF_Pointer">
                                                <img
                                                  src={cloudImageMapper(
                                                    index === 0
                                                      ? cloud?.name
                                                      : cloud?.name ===
                                                        "GITHUB__"
                                                        ? "GITHUB_COPILOT"
                                                        : cloud?.name
                                                  )}
                                                />
                                              </div>
                                            </div>
                                          ) : index === 8 ? (
                                            <div className="cf_cloudImageCloadDiv CF_Pointer">
                                              <div
                                                className="cf_cloudImageCloadDiv CF_Pointer"
                                                onClick={() =>
                                                  setSelectedUser({
                                                    ...selectedUser,
                                                    viewVendors: res,
                                                  })
                                                }
                                              >
                                                <p style={{ fontSize: "12px" }}>
                                                  +{res?.vendors?.length - 8}
                                                </p>
                                              </div>
                                            </div>
                                          ) : (
                                            ""
                                          )
                                        ) : (
                                          ""
                                        );
                                      })}
                                    </div>
                                  </td>
                                  <td>
                                    <div
                                      className="CF_d-flex cf_hideforTable"
                                      style={{ justifyContent: "flex-end" }}
                                    >
                                      <ButtonComponent
                                        customstyles={{ height: "35px" }}
                                        inputWidth="150px"
                                        isLoading={false}
                                        isDisabled={false}
                                        buttonClickAction={() => {
                                          setSelectedWorkFlow(null);
                                          // setWorkFlowOptionsSelected(null);
                                          setWorkFlowOptionsSelected("CLOUDS");
                                          setShowWorkFlow(true);
                                          setSelectCloud(null);
                                          setSelWsList([]);
                                          setThinkificUserEmail({
                                            email: res?.email,
                                            error: "",
                                          });
                                          setIsExistingUser(false);
                                          setWorkFlowBody({
                                            user: {
                                              ...res,
                                              existingUser: false,
                                              existingVendors: [],
                                            },
                                            clouds: {},
                                            skews: {},
                                            adminCloudId: {},
                                            cloudsStatus: {},
                                            uniqueCloudsList: [],
                                            onBoardingStarted: false,
                                          });
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
                                          <CirclePlay size={16} />
                                          <p style={{ color: "#fff" }}>
                                            Run WorkFlow
                                          </p>
                                        </div>
                                      </ButtonComponent>
                                      <div
                                        style={{
                                          marginLeft: "auto",
                                          padding: "0",
                                          width: "30px",
                                          height: "30px",
                                          justifyContent: "center",
                                        }}
                                        className="cf_onboard_timer CF_d-flex ai-center CF_Pointer"
                                        onClick={() => {
                                          setDeleteId(res?.id);
                                          setIsVisible(true);
                                        }}
                                      >
                                        <Trash2 size={14} />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                          {usersListUnique?.map((res, index) => (
                            <tr key={res?.email || res?.firstName}>
                              <td className="cf_new_table_hide_text">
                                <p>{getMaxChar(res?.email, 40)}</p>
                              </td>
                              {/* //   return <div className={`bg_35-${cloud}`}></div>; */}
                              <td className="cf_new_table_hide_text">
                                <div
                                  className="CF_d-flex ai-center"
                                  style={{ gap: "8px" }}
                                >
                                  {res?.vendorAdminCloudId?.map(
                                    (cloud, index) => {
                                      return cloud ? (
                                        index < 8 ? (
                                          <div className="cf_cloudImageCloadDiv CF_Pointer">
                                            <div className="cf_cloudImageCloadDiv CF_Pointer">
                                              <img
                                                src={cloudImageMapper(
                                                  index === 0
                                                    ? cloud?.split(":")[0]
                                                    : cloud?.split(":")[0] ===
                                                      "GITHUB__"
                                                      ? "GITHUB_COPILOT"
                                                      : cloud?.split(":")[0]
                                                )}
                                              />
                                            </div>
                                          </div>
                                        ) : index === 8 ? (
                                          <div className="cf_cloudImageCloadDiv CF_Pointer">
                                            <div
                                              className="cf_cloudImageCloadDiv CF_Pointer"
                                              onClick={() =>
                                                setSelectedUser({
                                                  ...selectedUser,
                                                  viewVendors: res,
                                                })
                                              }
                                            >
                                              <p style={{ fontSize: "12px" }}>
                                                +
                                                {res?.vendorAdminCloudId
                                                  ?.length - 8}
                                              </p>
                                            </div>
                                          </div>
                                        ) : (
                                          ""
                                        )
                                      ) : (
                                        ""
                                      );
                                    }
                                  )}
                                </div>
                              </td>
                              <td>
                                <div
                                  className="CF_d-flex cf_hideforTable"
                                  style={{ justifyContent: "flex-end" }}
                                >
                                  <ButtonComponent
                                    customstyles={{ height: "35px" }}
                                    inputWidth="150px"
                                    isLoading={false}
                                    isDisabled={false}
                                    buttonClickAction={() => {
                                      setSelectedWorkFlow(null);
                                      // setWorkFlowOptionsSelected(null);
                                      setWorkFlowOptionsSelected("CLOUDS");
                                      setShowWorkFlow(true);
                                      setSelectCloud(null);
                                      setSelWsList([]);
                                      setThinkificUserEmail({
                                        email: res?.email,
                                        error: "",
                                      });
                                      setIsExistingUser(true);
                                      setWorkFlowBody({
                                        user: makeOnBoardObjectForExistingUser(
                                          res
                                        ),
                                        clouds: {},
                                        skews: {},
                                        adminCloudId: {},
                                        cloudsStatus: {},
                                        uniqueCloudsList: [],
                                        onBoardingStarted: false,
                                      });
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
                                      <CirclePlay size={16} />
                                      <p style={{ color: "#fff" }}>
                                        Run WorkFlow
                                      </p>
                                    </div>
                                  </ButtonComponent>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="cf_new_tables_footer">
                  <span>Total: {pagination?.totalDocuments} </span>
                  <span style={{ marginLeft: "auto" }}></span>
                  <span style={{ opacity: "0.5" }}>
                    Showing {pagination?.currentPage} of{" "}
                    {pagination?.totalPages ? pagination?.totalPages : 1} Page
                  </span>
                  <span>
                    Showing :{" "}
                    <select
                      className="cf_message_pagination_select"
                      name="pageSize"
                      value={pagination?.pageSize}
                      onChange={handlePagination}
                    >
                      <option value="100">100</option>
                      <option value="200">200</option>
                      <option value="300">300</option>
                      <option value="400">400</option>
                      <option value="500">500</option>
                    </select>
                    &nbsp;Rows
                  </span>
                  <span>
                    Go to:{" "}
                    <select
                      className="cf_message_pagination_select"
                      name="currentPage"
                      value={pagination?.currentPage}
                      onChange={handlePagination}
                    >
                      {getRandomArray(pagination?.totalPages)?.map((data) => {
                        return (
                          <option value={data} key={`${data}_DMS`}>
                            {data}
                          </option>
                        );
                      })}
                    </select>
                  </span>
                </div>
              </div>
              {selectedUser?.viewVendors?.vendorAdminCloudId?.length > 0 ? (
                <div
                  className="cf_main_content_place_main CF_d-flex"
                  style={{
                    padding: "0 0 10px 0",
                    width: selectedUser?.viewVendors ? "25%" : "0%",
                    height: "101.5%",
                  }}
                >
                  <div
                    className="cf_new_tables_div"
                    style={{
                      height: "calc(100% - 10px)",
                    }}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th
                            style={{
                              width: "100%",
                              fontSize: "14px",
                              padding: "0 5px",
                            }}
                          >
                            <div className="CF_d-flex ai-center cf_scopesTitle">
                              <p>{selectedUser?.viewVendors?.email}</p>
                              <X
                                size={15}
                                className="CF_Pointer"
                                onClick={() =>
                                  setSelectedUser({
                                    ...selectedUser,
                                    viewVendors: {},
                                  })
                                }
                              />
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUser?.viewVendors?.vendorAdminCloudId?.map(
                          (res) => {
                            return (
                              <tr>
                                <td>
                                  <div
                                    style={{
                                      width: "100%",
                                      gap: "8px",
                                      overflow: "hidden",
                                    }}
                                    className="CF_d-flex ai-center"
                                  >
                                    <div className="cf_cloudImageCloadDiv CF_Pointer">
                                      <div className="cf_cloudImageCloadDiv CF_Pointer">
                                        <img
                                          src={cloudImageMapper(
                                            res?.split(":")[0]
                                          )}
                                        />
                                      </div>
                                    </div>
                                    <p style={{ fontWeight: "600" }}>
                                      {getCloudName(res?.split(":")[0])}
                                    </p>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                ""
              )}
            </div>
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
      {/* Create User Popup Start's */}
      <Popup
        options={{
          isOpen: isFormVisible,
          title: `OnBoard User`,
          popupWidth: "550px",
          popupHeight: `70%`,
          popupTop: "70px",
          customStyles: { padding: "0 0 5px 0" },
        }}
        toggleOpen={setIsFormVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            overflowY: "auto",
            height: "calc(100% - 0px)",
          }}
        >
          <div
            style={{
              padding: "10px 0px",
              maxHeight: "400px",
              width: "100%",
              gap: "30px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ width: "100%" }}>
              <TextInput
                type="text"
                inputWidth="100%"
                placeHolder="First Name *"
                inputName="firstName"
                autoFocus={true}
                defaultValue={formValues?.firstName}
                errorData={errorFields?.firstName}
                getInputText={(val, name) => getFormInputs(val, name)}
              />
            </div>
            <div style={{ width: "100%" }}>
              <TextInput
                type="text"
                inputWidth="100%"
                placeHolder="Last Name *"
                inputName="lastName"
                autoFocus={true}
                defaultValue={formValues?.lastName}
                errorData={errorFields?.lastName}
                getInputText={(val, name) => getFormInputs(val, name)}
              />
            </div>
            <div style={{ width: "100%" }}>
              <TextInput
                type="text"
                inputWidth="100%"
                placeHolder="Email without Domain *"
                inputName="email"
                autoFocus={true}
                defaultValue={formValues?.email}
                errorData={errorFields?.email}
                getInputText={(val, name) => getFormInputs(val, name)}
              />
            </div>
            <div
              style={{ width: "100%", justifyContent: "space-between" }}
              className="CF_d-flex ai-center"
            >
              <TextInput
                type="password"
                inputWidth="49%"
                placeHolder="Password *"
                inputName="passWord"
                autoFocus={true}
                defaultValue={formValues?.passWord}
                errorData={errorFields?.passWord}
                getInputText={(val, name) => getFormInputs(val, name)}
              />
              <TextInput
                type="password"
                inputWidth="49%"
                placeHolder="Confirm Password *"
                inputName="cPassWord"
                autoFocus={true}
                defaultValue={formValues?.cPassWord}
                errorData={errorFields?.cPassWord}
                getInputText={(val, name) => getFormInputs(val, name)}
              />
            </div>
            <div
              style={{ width: "100%", justifyContent: "space-between" }}
              className="CF_d-flex ai-center"
            >
              <div
                className="CF_d-flex ai-center"
                style={{
                  gap: "8px",
                  width: "100%",
                }}
              >
                <p style={{ fontSize: "12px" }}>
                  Change Password At Next Login :
                </p>
                <label className="switch">
                  <input
                    type="checkbox"
                    id="splitChannels"
                    onChange={(e) =>
                      setFormValues({
                        ...formValues,
                        changePasswordAtNextLogin: e.target.checked,
                      })
                    }
                    checked={formValues.changePasswordAtNextLogin}
                  />
                  <span className="slider round" style={{ top: "6px" }}></span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            inputWidth="100%"
            isLoading={false}
            isDisabled={
              !(
                Object.keys(errorFields).length === 0 &&
                formValues?.firstName &&
                formValues?.lastName &&
                formValues?.email &&
                formValues?.passWord &&
                formValues?.cPassWord
              )
            }
            buttonName="Submit"
            buttonClickAction={() => saveOnBoardUser()}
          />
        </div>
      </Popup>
      {/* Create User Popup End's */}

      {/* Create User Popup Start's */}
      <Popup
        options={{
          isOpen: showWorkFlow,
          title: workFlowBody?.onBoardingStarted
            ? `Onboarding ${Array.isArray(workFlowBody?.user)
              ? workFlowBody?.user[0]?.email
              : workFlowBody?.user?.email
            }`
            : `Onboard ${Array.isArray(workFlowBody?.user)
              ? workFlowBody?.user[0]?.email
              : workFlowBody?.user?.email
            }`,
          popupWidth: "450px",
          popupHeight: `fit-content`,
          popupTop: "70px",
          customStyles: { padding: "0 0 0px 0", maxHeight: "700px" },
          titleCustomStyles: { fontSize: "14px" },
        }}
        toggleOpen={setShowWorkFlow}
      >
        {workFlowBody?.onBoardingStarted ? (
          <>
            <div
              className="cf_popup_container_body"
              style={{
                padding: "0px",
                flexDirection: "column",
                maxHeight: "500px",
              }}
            >
              <>
                {workFlowBody?.uniqueCloudsList?.map((data, index) => {
                  return (
                    <div
                      key={data}
                      className="CF_d-flex ai-center cf_onboard_cloudSelect"
                      style={{
                        // gap: "15px",
                        height: "fit-content",
                        padding: "0",
                        // borderBottom: "1px solid #e0e0e0",
                        flexDirection: "column",
                      }}
                    >
                      <div
                        className="CF_d-flex ai-center cf_onboard_cloudSelect"
                        style={{
                          gap: "15px",
                          height: "70px",
                          padding: "0 15px",
                          borderBottom: "0",
                        }}
                      >
                        <div
                          className={`cf_onboard_cloudSelect_img_wrapper_flow`}
                        >
                          <div className={`bg_35-${data?.split("|")[0]}`}></div>
                        </div>
                        <div>
                          <p style={{ fontSize: "12px" }}>
                            {getCloudName(data?.split("|")[0])}
                          </p>
                          <p
                            style={{
                              fontSize: "12px",
                              fontWeight: "400",
                              color: "#71717A",
                            }}
                          >
                            {workFlowBody?.cloudsStatus[data] === "FAILED"
                              ? workFlowBody?.user?.find(
                                (user) => user?.vendor === data?.split("|")[0]
                              )?.errorMsg
                              : getCloudName(workFlowBody?.cloudsStatus[data])}
                          </p>
                        </div>
                        <div
                          style={{ marginLeft: "auto" }}
                          className="CF_d-flex ai-center"
                        >
                          {workFlowBody?.cloudsStatus[data] ===
                            "IN_PROGRESS" ? (
                            <div
                              className="cf_domainSpinner"
                              style={{ width: "20px", height: "20px" }}
                            ></div>
                          ) : workFlowBody?.cloudsStatus[data] ===
                            "COMPLETED" ? (
                            <>
                              <FaRegCheckCircle className="PROCESSED cf_onBoardingCompleted" />
                            </>
                          ) : workFlowBody?.cloudsStatus[data] === "FAILED" ? (
                            <>
                              <CircleX
                                size={20}
                                color="red"
                                className="CONFLICT"
                              />
                            </>
                          ) : (
                            <Circle size={20} color="#acacac" />
                          )}
                        </div>
                      </div>
                      {workFlowBody?.cloudsStatus[data] === "COMPLETED" &&
                        isExistingUser ? (
                        <div
                          style={{
                            width: "100%",
                            height: "50px",
                            padding: "0 15px",
                          }}
                        >
                          <TextInput
                            type="text"
                            autoFocus={false}
                            inputWidth="100%"
                            defaultValue={
                              Array.isArray(workFlowBody?.user)
                                ? workFlowBody?.user?.find(
                                  (user) =>
                                    user?.vendor +
                                    "|" +
                                    user?.adminCloudId ===
                                    data
                                )?.password ||
                                workFlowBody?.user?.find(
                                  (user) =>
                                    user?.vendor +
                                    "|" +
                                    user?.adminCloudId ===
                                    data
                                )?.passWord
                                : workFlowBody?.user[0]?.password ||
                                workFlowBody?.user[0]?.passWord
                            }
                            inputName="password"
                            placeHolder="Password"
                            getInputText={(val) => console.log(val)}
                            readOnly={true}
                            copyToClipboard={true}
                            copyButtonText="Password will be dispeared once you close the popup, so please save it"
                          />
                        </div>
                      ) : (
                        ""
                      )}
                    </div>
                  );
                })}
                {Object.values(workFlowBody?.cloudsStatus)?.includes(
                  "COMPLETED"
                ) && isExistingUser ? (
                  <div
                    className="CF_d-flex ai-center"
                    style={{
                      width: "100%",
                      padding: "0 5px",
                      height: "60px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "12px",
                        color: "#71717A",
                        fontWeight: "500",
                      }}
                    >
                      *Password vanishes on popup close. Save or{" "}
                      <span
                        className="cf_make_link"
                        onClick={() =>
                          downloadUserPasswordCSV(workFlowBody?.user)
                        }
                      >
                        Download
                      </span>{" "}
                      as CSV.
                    </p>
                  </div>
                ) : (
                  ""
                )}
              </>
            </div>
          </>
        ) : workFlowOptionsSelected === null && workFlowsList?.length > 0 ? (
          <div
            className="cf_popup_container_body"
            style={{
              padding: "30px 0",
              flexDirection: "column",
              overflowY: "auto",
              // maxHeight: "500px",
              gap: "30px",
            }}
          >
            <p>How would you like to onboard the user ?</p>
            <div className="CF_d-flex ai-center" style={{ gap: "20px" }}>
              {/* <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                <input
                  type="radio"
                  checked={workFlowOptionsSelected === "WORKFLOWS"}
                  onChange={(e) => {
                    setWorkFlowOptionsSelected("WORKFLOWS");
                  }}
                />
                <p>By Choosing Templates</p>
              </div> */}
              <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                <input
                  type="radio"
                  checked={workFlowOptionsSelected === "CLOUDS"}
                  onChange={(e) => {
                    setWorkFlowOptionsSelected("CLOUDS");
                  }}
                />
                <p>By Selecting Applications</p>
              </div>
            </div>
          </div>
        ) : workFlowOptionsSelected === "WORKFLOWS" ? (
          <>
            <div
              className="cf_popup_container_body"
              style={{
                padding: "10px 0",
                flexDirection: "column",
                overflowY: "auto",
              }}
            >
              <div style={{ maxHeight: "500px", width: "100%" }}>
                {workFlowsList?.map((data, index) => {
                  return (
                    <div
                      key={data?.id}
                      className="CF_d-flex  cf_onboard_cloudSelect"
                      style={{
                        gap: "5px",
                        flexDirection: "column",
                        minHeight: "fit-content",
                      }}
                    >
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "15px", width: "100%", height: "50px" }}
                      >
                        <input
                          type="radio"
                          onChange={(e) => setSelectedWorkFlow(data)}
                          checked={selectedWorkFlow?.id === data?.id}
                        />
                        <p>{data?.workFlowName}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="cf_popup_container_footer">
              <ButtonComponent
                inputWidth="100%"
                isLoading={false}
                isDisabled={selectedWorkFlow === null ? true : false}
                buttonName="Start Workflow"
                buttonClickAction={() => startUserOnBoardingWithWorkflow()}
              />
            </div>
          </>
        ) : (
          <>
            <div
              className="cf_popup_container_body"
              style={{
                padding: "0px",
                flexDirection: "column",
                overflowY: "auto",
                // maxHeight: "500px",
                // gap: "30px",
              }}
            >
              <div style={{ maxHeight: "500px", width: "100%" }}>
                <div style={{ padding: "10px" }}>
                  <SearchComponent
                    autoOpen={true}
                    boxShadows={true}
                    inputName="searchInput"
                    customStyles={{ width: "100%", height: "40px" }}
                    customButtonStyles={{
                      background: "transparent",
                      color: "rgb(255, 255, 255)",
                      fontWeight: "bolder",
                      height: "35px",
                    }}
                    inputPlaceHolder={`Search By Application Name`}
                    defaultValue={searchValues?.title}
                    onInputSearch={(e) =>
                      setSearchValues({ ...searchValues, title: e.searchInput })
                    }
                  />
                </div>
                {globalContext?.cloudsList
                  ?.filter((data) =>
                    data?.providerName
                      ?.toLowerCase()
                      ?.includes(searchValues?.title?.toLowerCase())
                  )
                  ?.map((data, index) => {
                    return (onBoardCloudsList.includes(data?.providerName) || (data?.providerName === "ATLASSIAN" && data?.ssoAppId) || (data?.providerName === "CURSOR_AI" && data?.deltaUsersUrl)) &&
                      !workFlowBody?.user?.existingVendors?.includes(
                        data?.providerName
                      ) ? (
                      <>
                        <div
                          key={data?.id}
                          className="CF_d-flex  cf_onboard_cloudSelect"
                          style={{
                            gap: "5px",
                            flexDirection: "column",
                            minHeight: "fit-content",
                          }}
                        >
                          <div
                            className="CF_d-flex ai-center"
                            style={{
                              gap: "15px",
                              width: "100%",
                              height: "70px",
                            }}
                          >
                            {data?.providerName === "TAILSCALE" ||
                              onBoardWithOutLicense?.includes(
                                data?.providerName
                              ) ? (
                              <input
                                type="checkbox"
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    if (data?.providerName === "THINKIFIC") {
                                      setSelectCloud(
                                        `${data?.providerName}|${data?.id}`
                                      );
                                    }
                                    let uniqueCloudsList = [
                                      ...workFlowBody?.uniqueCloudsList,
                                    ];
                                    if (
                                      !uniqueCloudsList.includes(
                                        `${data?.providerName}|${data?.id}`
                                      )
                                    ) {
                                      uniqueCloudsList.push(
                                        `${data?.providerName}|${data?.id}`
                                      );
                                    }
                                    setWorkFlowBody({
                                      ...workFlowBody,
                                      uniqueCloudsList: uniqueCloudsList,
                                      clouds: {
                                        ...workFlowBody?.clouds,
                                        [`${data?.providerName}|${data?.id}`]:
                                          data?.id,
                                      },
                                      adminCloudId: {
                                        ...workFlowBody?.adminCloudId,
                                        [`${data?.providerName}|${data?.id}`]:
                                          data?.id,
                                      },
                                    });
                                  } else {
                                    let clouds = {
                                      ...workFlowBody?.clouds,
                                    };

                                    if (data?.providerName === "THINKIFIC") {
                                      setSelectCloud(null);
                                    }

                                    delete clouds[
                                      data?.providerName + "|" + data?.id
                                    ];
                                    let uniqueCloudsList =
                                      workFlowBody?.uniqueCloudsList.filter(
                                        (cloud) =>
                                          cloud !==
                                          data?.providerName + "|" + data?.id
                                      );
                                    let adminCloudId = {
                                      ...workFlowBody?.adminCloudId,
                                    };
                                    delete adminCloudId[
                                      data?.providerName + "|" + data?.id
                                    ];
                                    setWorkFlowBody({
                                      ...workFlowBody,
                                      clouds: clouds,
                                      uniqueCloudsList: uniqueCloudsList,
                                      skews: {},
                                    });
                                  }
                                }}
                                checked={
                                  workFlowBody?.uniqueCloudsList.includes(
                                    data?.providerName + "|" + data?.id
                                  ) &&
                                  workFlowBody?.clouds[
                                  data?.providerName + "|" + data?.id
                                  ] === data?.id
                                }
                                disabled={
                                  workFlowBody?.uniqueCloudsList.includes(
                                    data?.providerName + "|" + data?.id
                                  ) &&
                                  workFlowBody?.clouds[
                                  data?.providerName + "|" + data?.id
                                  ] !== data?.id
                                }
                              />
                            ) : selectCloud ===
                              `${data?.providerName}|${data?.id}` ? (
                              <Minus
                                className="CF_Pointer"
                                size={14}
                                onClick={() => setSelectCloud(null)}
                              />
                            ) : (
                              <Plus
                                className="CF_Pointer"
                                size={14}
                                onClick={() =>
                                  setSelectCloud(
                                    `${data?.providerName}|${data?.id}`
                                  )
                                }
                              />
                            )}
                            <div className="cf_onboard_cloudSelect_img_wrapper">
                              <img
                                src={cloudImageMapper(data?.providerName)}
                                alt={data?.providerName}
                              />
                            </div>
                            <p>{data?.adminEmail}</p>
                          </div>
                          {userActionRequired.includes(data?.providerName) &&
                            workFlowBody?.uniqueCloudsList.includes(
                              `${data?.providerName}|${data?.id}`
                            ) && (
                              <div className="cf_onboard_cloudSelect_userOptions">
                                <OnBoardHandleUserOptions
                                  currentProvider={data}
                                  infoMap={userInfoMap}
                                  selectMap={selectedUserInfoMap}
                                  handleSelectFromMultiList={
                                    handleSelectFromMultiList
                                  }
                                  setSelectedUserInfoMapInternal={
                                    setSelectedUserInfoMapInternal
                                  }
                                />
                              </div>
                            )}
                          {workFlowBody?.uniqueCloudsList.includes(
                            `THINKIFIC|${data?.id}`
                          ) &&
                            workFlowBody?.clouds[`THINKIFIC|${data?.id}`] ===
                            data?.id ? (
                            <div
                              style={{
                                width: "100%",
                                padding: "0 0 10px 30px",
                                gap: "10px",
                                flexDirection: "column",
                              }}
                              className="CF_d-flex"
                            >
                              <TextInput
                                type="email"
                                placeHolder="Email *"
                                inputName="email"
                                autoFocus={true}
                                defaultValue={thinkificUserEmail?.email}
                                errorData={thinkificUserEmail?.error}
                                getInputText={(val, name) => {
                                  setThinkificUserEmail({
                                    email: val,
                                    error: "",
                                  });
                                }}
                              />
                            </div>
                          ) : (
                            ""
                          )}
                          {selectCloud ===
                            `${data?.providerName}|${data?.id}` ? (
                            <div
                              style={{
                                width: "100%",
                                padding: "0 0 10px 30px",
                                gap: "10px",
                                flexDirection: "column",
                              }}
                              className="CF_d-flex"
                            >
                              {cloudLicenceInfo?.isLoading
                                ? getCFTextLoader()
                                : cloudLicenceInfo?.list?.map((res) => {
                                  return res?.wsList?.length > 0 ? (
                                    <div>
                                      {res?.wsList?.map((ws) => {
                                        return (
                                          <div
                                            className="CF_d-flex"
                                            style={{
                                              gap: "5px",
                                              padding: "5px 0",
                                              flexDirection: "column",
                                            }}
                                          >
                                            <div
                                              className="CF_d-flex ai-center"
                                              style={{
                                                gap: "5px",
                                                padding: "5px 0",
                                              }}
                                            >
                                              {selWsList.includes(ws) ? (
                                                <Minus
                                                  className="CF_Pointer"
                                                  size={14}
                                                  onClick={() =>
                                                    setSelWsList(
                                                      selWsList.filter(
                                                        (ws) => ws !== ws
                                                      )
                                                    )
                                                  }
                                                />
                                              ) : (
                                                <Plus
                                                  className="CF_Pointer"
                                                  size={14}
                                                  onClick={() =>
                                                    setSelWsList([
                                                      ...selWsList,
                                                      ws,
                                                    ])
                                                  }
                                                />
                                              )}
                                              <Building
                                                size={12}
                                                strokeWidth={2}
                                                color="#64748b"
                                              />
                                              <p>{ws}</p>
                                            </div>
                                            {selWsList.includes(ws) && (
                                              <div
                                                className="CF_d-flex ai-center"
                                                style={{
                                                  padding: "0 10px",
                                                  gap: "8px",
                                                }}
                                              >
                                                <input
                                                  type="checkbox"
                                                  name=""
                                                  id=""
                                                />
                                                <p>
                                                  {res?.planName?.replaceAll(
                                                    "_",
                                                    " "
                                                  )}
                                                </p>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div
                                      className="CF_d-flex ai-center"
                                      style={{ gap: "8px" }}
                                    >
                                      <input
                                        type="checkbox"
                                        style={{ transform: "scale(1.2)" }}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            let uniqueCloudsList = [
                                              ...workFlowBody?.uniqueCloudsList,
                                            ];
                                            if (
                                              !uniqueCloudsList.includes(
                                                `${data?.providerName}|${data?.id}`
                                              )
                                            ) {
                                              uniqueCloudsList.push(
                                                `${data?.providerName}|${data?.id}`
                                              );
                                            }
                                            setWorkFlowBody({
                                              ...workFlowBody,
                                              uniqueCloudsList:
                                                uniqueCloudsList,
                                              clouds: {
                                                ...workFlowBody?.clouds,
                                                [`${data?.providerName}|${data?.id}`]:
                                                  data?.id,
                                              },
                                              adminCloudId: {
                                                ...workFlowBody?.adminCloudId,
                                                [`${data?.providerName}|${data?.id}`]:
                                                  data?.id,
                                              },
                                              skews: {
                                                ...workFlowBody?.skews,
                                                [`${data?.providerName}|${data?.id}`]:
                                                  [
                                                    ...(workFlowBody?.skews?.[
                                                      `${data?.providerName}|${data?.id}`
                                                    ] || []),
                                                    {
                                                      planName: res?.planName,
                                                      planId: res?.planId,
                                                      productId:
                                                        data?.providerName ===
                                                          "TERRAFORM"
                                                          ? res?.organization
                                                          : res?.productId,
                                                      id: res?.id,
                                                    },
                                                  ],
                                              },
                                            });
                                          } else {
                                            let skews = {
                                              ...workFlowBody?.skews,
                                            };
                                            let clouds = {
                                              ...workFlowBody?.clouds,
                                            };
                                            let uniqueCloudsList = [
                                              ...workFlowBody?.uniqueCloudsList,
                                            ];
                                            let adminCloudId = {
                                              ...workFlowBody?.adminCloudId,
                                            };

                                            let newSkews = skews[
                                              `${data?.providerName}|${data?.id}`
                                            ].filter((skew) => {
                                              return skew?.id !== res?.id;
                                            });
                                            skews[
                                              `${data?.providerName}|${data?.id}`
                                            ] = newSkews;
                                            if (
                                              skews[
                                                `${data?.providerName}|${data?.id}`
                                              ].length === 0
                                            ) {
                                              uniqueCloudsList =
                                                uniqueCloudsList.filter(
                                                  (cloud) =>
                                                    cloud !==
                                                    `${data?.providerName}|${data?.id}`
                                                );
                                              delete clouds[
                                                `${data?.providerName}|${data?.id}`
                                              ];
                                              delete skews[
                                                `${data?.providerName}|${data?.id}`
                                              ];
                                              delete adminCloudId[
                                                `${data?.providerName}|${data?.id}`
                                              ];
                                            }
                                            setWorkFlowBody({
                                              ...workFlowBody,
                                              clouds: clouds,
                                              uniqueCloudsList:
                                                uniqueCloudsList,
                                              skews: skews,
                                            });
                                          }
                                        }}
                                        checked={
                                          workFlowBody?.skews[
                                            `${data?.providerName}|${data?.id}`
                                          ]?.findIndex(
                                            (skew) =>
                                              skew?.planName ===
                                              res?.planName &&
                                              skew?.id === res?.id
                                          ) > -1
                                        }
                                        disabled={
                                          (workFlowBody?.uniqueCloudsList.includes(
                                            data?.providerName +
                                            "|" +
                                            data?.id
                                          ) &&
                                            workFlowBody?.clouds[
                                            data?.providerName +
                                            "|" +
                                            data?.id
                                            ] !== data?.id) ||
                                            newImplementation.includes(
                                              data?.providerName +
                                              "|" +
                                              data?.id
                                            )
                                            ? res?.totalLicenceCount ===
                                            res?.assignedLicenceCount
                                            : res?.seatsAvailable === 0
                                        }
                                        title={
                                          newImplementation.includes(
                                            data?.providerName +
                                            "|" +
                                            data?.id
                                          )
                                            ? res?.totalLicenceCount ===
                                              res?.assignedLicenceCount
                                              ? "No seats available"
                                              : res?.seatsAvailable === 0
                                                ? "No seats available"
                                                : ""
                                            : ""
                                        }
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
                                  );
                                })}
                            </div>
                          ) : (
                            ""
                          )}
                        </div>
                      </>
                    ) : (
                      ""
                    );
                  })}
              </div>
            </div>
            <div className="cf_popup_container_footer">
              <ButtonComponent
                inputWidth="100%"
                isLoading={false}
                isDisabled={workFlowBody?.uniqueCloudsList.length === 0}
                buttonName="Start Onboard"
                buttonClickAction={() => startUserOnBoarding()}
              />
            </div>
          </>
        )}
      </Popup>
      {/* Create User Popup End's */}

      <Popup
        options={{
          isOpen: isVisible,
          title: `Delete User`,
          popupWidth: "30%",
          popupHeight: `200px`,
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "30px",
            maxHeight: "500px",
          }}
        >
          <p style={{ fontWeight: "600" }}>
            Are you sure you want to delete the user ?{" "}
          </p>
        </div>
        <div className="cf_popup_container_footer" style={{ gap: "10px" }}>
          <ButtonComponent
            customstyles={{
              marginLeft: "auto",
              background: "#f2f2f2",
              color: "#000",
              border: "1px solid #ddd",
            }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="No"
            buttonClickAction={() => {
              setIsVisible(false);
            }}
          />
          <ButtonComponent
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Yes"
            buttonClickAction={() => deleteUser()}
          />
        </div>
      </Popup>
    </>
  );
};

export default OnBoard;
