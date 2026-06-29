import { Circle, CircleX, X } from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { BiFilterAlt } from "react-icons/bi";
import { FaRegCheckCircle } from "react-icons/fa";
import {
  cloudImageMapper,
  getCloudName,
  getRandomArray,
  OffBoardImplementedCloudsList,
} from "../../../helpers/helpers";
import {
  downloadGlobalCSV,
  getMaxChar,
  notifyToast,
} from "../../../helpers/utils";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import CustomToolTip from "../../../Resuables/CustomToolTip/CustomToolTip";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
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
  getDownloadSaaSReport,
  getDownloadStatus,
  getVendorSearch,
} from "../../SaaSManagement/SaaSActions/SaaSActions";
import { offBoardUser } from "../UserManagementActions/UserManagementActions";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";

const OffBoarding = () => {
  const { globalContext } = useContext(GlobalContext);
  const [downloadStatus, setDownloadStatus] = useState({});
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [activeCloudFilter, setActiveCloudFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({ key: "ALL", value: "All" });
  const [showWorkFlow, setShowWorkFlow] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
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

  useEffect(() => {
    fetchUniqueUsersList();
  }, []);

  useEffect(() => {
    fetchUniqueUsersList();
  }, [filters]);

  const wsList = ["gajha-qa", "gajha-productteam", "gajha-dev"];

  const fetchUniqueUsersList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize
  ) => {
    setUsersList([]);
    setIsLoading(true);
    let res = await getUniqueUsersList(pageNo, pageSize, filters?.key);
    if (res?.status === "OK") {
      setIsLoading(false);
      setUsersList(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          totalDocuments: res?.res?.totalDocuments,
          currentPage: pageNo,
          pageSize: pageSize,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
    } else {
      setIsLoading(false);
    }
  };

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
      searchValue?.trim()
    );
    if (res?.status === "OK") {
      if (res?.res?.data?.length > 0) {
        setIsPageLoading(false);
        setUsersList(res?.res?.data);
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

  const getCSVStatus = async () => {
    setIsPageLoading(true);
    let res = await getDownloadStatus("UNIQUUSERSSEARCH", "unqusers");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setDownloadStatus({ ...res?.res });
      if (res?.res?.status === "PROCESSED") {
        downloadSaaSReport("users");
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const downloadSaaSReport = async (action) => {
    setIsPageLoading(true);
    let res = await getDownloadSaaSReport("UNIQUUSERSSEARCH", "unqusers");
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.headers["content-type"] === "text/csv") {
        downloadGlobalCSV(res?.res, `UniqueUsersList`);
        setDownloadStatus({
          ...downloadStatus,
          status: "Downloaded",
        });
      } else {
        setDownloadStatus({
          ...downloadStatus,
          status: "IN_PROGRESS",
        });
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed Downloading CSV");
    }
  };

  const startUserOffBoarding = async () => {
    setSelectedUser((prevState) => ({ ...prevState, startOffBoarding: true }));

    let updatedCloudsStatus = { ...selectedUser?.offBoardStatus };

    for (let cloud of selectedUser?.offBoardVendorSelected) {
      updatedCloudsStatus[cloud?.vendor] = "IN_PROGRESS";

      setSelectedUser((prevState) => ({
        ...prevState,
        offBoardStatus: updatedCloudsStatus,
      }));

      let res = await offBoardUser(cloud, selectedUser?.deleteUserPermanently);

      if (res?.status === "OK") {
        updatedCloudsStatus[cloud?.vendor] = "COMPLETED";
        setSelectedUser((prevState) => ({
          ...prevState,
          offBoardStatus: updatedCloudsStatus,
          startOffBoarding: true,
        }));
      } else {
        updatedCloudsStatus[cloud?.vendor] = "FAILED";
        // updatedCloudsStatus[cloud?.vendor] = "COMPLETED";
        setSelectedUser((prevState) => ({
          ...prevState,
          offBoardStatus: updatedCloudsStatus,
          startOffBoarding: true,
        }));
      }
    }
    // fetchSaaSCosting();
    setTimeout(() => {
      setShowWorkFlow(false);
      fetchUniqueUsersList(1, 100);
    }, 2000);
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Workflow" />
        <div className="cf_main_content_place">
          <TopNav pageName="Offboard Users" backLink="/Workflow" />
          <div
            className="cf_saas_options"
            style={{ marginTop: "10px", height: "40px" }}
          >
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
              inputPlaceHolder={`Search By User Email`}
              onInputSearch={(e) => searchUsersList(e.searchInput)}
            />
            <span style={{ marginLeft: "auto" }}></span>
            {/* <ActionButton
              customClass="CF_d-flex ai-center"
              customStyles={{
                backgroundColor: "#f2f2f2",
                height: "40px",
              }}
              buttonType="button"
              buttonClickAction={() =>
                downloadStatus?.status === "IN_PROGRESS"
                  ? getCSVStatus()
                  : downloadSaaSReport("users")
              }
            >
              {downloadStatus?.status === "IN_PROGRESS" ? (
                <RotateCw size={18} strokeWidth={2} title="Check Status" />
              ) : (
                <FileDown size={18} strokeWidth={2} />
              )}
            </ActionButton> */}
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
                      <th style={{ width: "20%" }}>Email</th>
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
                            <p>vimalesh.t_cloudfuze...odclub.onmicrosoft.com</p>
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
                      usersList?.map((res, index) => (
                        <tr key={res?.email || res?.firstName}>
                          <td className="cf_new_table_hide_text">
                            <CustomToolTip
                              title={res?.email}
                              customWidth={true}
                            >
                              <p>{getMaxChar(res?.email, 40)}</p>
                            </CustomToolTip>
                          </td>
                          {/* //   return <div className={`bg_35-${cloud}`}></div>; */}
                          <td className="cf_new_table_hide_text">
                            <div
                              className="CF_d-flex ai-center"
                              style={{ gap: "8px" }}
                            >
                              {res?.vendorAdminCloudId?.map((cloud, index) => {
                                return index < 8 ? (
                                  <div className="cf_cloudImageCloadDiv CF_Pointer">
                                    <CustomToolTip
                                      title={getCloudName(
                                        index === 0
                                          ? cloud?.split(":")[0]
                                          : cloud?.split(":")[0] === "GITHUB__"
                                          ? `GitHub Copilot | ${
                                              wsList[index - 1]
                                            } `
                                          : cloud?.split(":")[0]
                                      )}
                                    >
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
                                    </CustomToolTip>
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
                                      <CustomToolTip title="View More">
                                        <p style={{ fontSize: "12px" }}>
                                          +{res?.vendorAdminCloudId?.length - 8}
                                        </p>
                                      </CustomToolTip>
                                    </div>
                                  </div>
                                ) : (
                                  ""
                                );
                              })}
                            </div>
                          </td>
                          <td>
                            <div
                              className="CF_d-flex"
                              style={{ justifyContent: "flex-end" }}
                            >
                              {res?.vendorAdminCloudId?.filter((reCloud) => {
                                return OffBoardImplementedCloudsList.includes(
                                  reCloud?.split(":")[0]
                                );
                              }).length > 0 ? (
                                <ButtonComponent
                                  customstyles={{ height: "30px" }}
                                  inputWidth="100px"
                                  isLoading={false}
                                  isDisabled={false}
                                  buttonClickAction={() => {
                                    setShowWorkFlow(true);
                                    setSelectedUser({
                                      ...selectedUser,
                                      uniqueMemeberId: [],
                                      offBoardStatus: {},
                                      offBoardVendor: res,
                                      startOffBoarding: false,
                                      offBoardVendorSelected: [],
                                      deleteUserPermanently: false,
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
                                    <p
                                      style={{
                                        color: "#fff",
                                        fontSize: "12px",
                                      }}
                                    >
                                      Off Board
                                    </p>
                                  </div>
                                </ButtonComponent>
                              ) : (
                                ""
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
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
      {isPageLoading ? getCFLoader() : ""}
      {/* Create User Popup Start's */}
      <Popup
        options={{
          isOpen: showWorkFlow,
          title: selectedUser?.startOffBoarding
            ? `Offboarding ${getMaxChar(
                selectedUser?.offBoardVendor?.email,
                30
              )}`
            : `Select Applications To Offboard ${getMaxChar(
                selectedUser?.offBoardVendor?.email,
                30
              )}`,
          popupWidth: "30%",
          popupHeight: `fit-content`,
          popupTop: "70px",
          customStyles: { padding: "0 0 0px 0", maxHeight: "700px" },
          titleCustomStyles: { fontSize: "14px" },
        }}
        toggleOpen={setShowWorkFlow}
      >
        {selectedUser?.startOffBoarding ? (
          <div
            className="cf_popup_container_body"
            style={{
              padding: "0px",
              flexDirection: "column",
            }}
          >
            {selectedUser?.offBoardVendorSelected?.map((data, index) => {
              return (
                <div
                  key={`OFF_${data?.vendor}`}
                  className="CF_d-flex ai-center cf_onboard_cloudSelect"
                  style={{
                    gap: "15px",
                    height: "70px",
                    padding: "0 15px",
                    borderBottom: "1px solid #e0e0e0",
                  }}
                >
                  <div className={`cf_onboard_cloudSelect_img_wrapper_flow`}>
                    <img
                      src={cloudImageMapper(
                        index === 0
                          ? data?.vendor
                          : data?.vendor === "GITHUB__"
                          ? "GITHUB_COPILOT"
                          : data?.vendor
                      )}
                      alt={data?.vendor}
                    />
                    {/* <div className={`bg_35-${data?.vendor}`}></div> */}
                  </div>
                  <div>
                    <p style={{ fontSize: "12px" }}>
                      {getCloudName(
                        index === 0
                          ? data?.name
                          : data?.name === "GITHUB__"
                          ? `GitHub Copilot | ${wsList[index - 1]} `
                          : data?.name
                      )}
                    </p>
                    <p
                      style={{
                        fontSize: "12px",
                        fontWeight: "400",
                        color: "#71717A",
                      }}
                    >
                      {getCloudName(selectedUser?.offBoardStatus[data?.vendor])}
                    </p>
                  </div>
                  <div
                    style={{ marginLeft: "auto" }}
                    className="CF_d-flex ai-center"
                  >
                    {selectedUser?.offBoardStatus[data?.vendor] ===
                    "IN_PROGRESS" ? (
                      <div
                        className="cf_domainSpinner"
                        style={{ width: "20px", height: "20px" }}
                      ></div>
                    ) : selectedUser?.offBoardStatus[data?.vendor] ===
                      "COMPLETED" ? (
                      <>
                        <FaRegCheckCircle className="PROCESSED cf_onBoardingCompleted" />
                      </>
                    ) : selectedUser?.offBoardStatus[data?.vendor] ===
                      "FAILED" ? (
                      <>
                        <CircleX size={20} color="red" className="CONFLICT" />
                      </>
                    ) : (
                      <Circle size={20} color="#acacac" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div
              className="cf_popup_container_body"
              style={{
                padding: "0px",
                flexDirection: "column",
                // gap: "30px",
              }}
            >
              {selectedUser?.offBoardVendor?.vendorAdminCloudId?.map(
                (data, index) => {
                  return OffBoardImplementedCloudsList.includes(
                    data?.split(":")[0]
                  ) ? (
                    <>
                      <div
                        key={data?.id}
                        className="CF_d-flex  cf_onboard_cloudSelect"
                        style={{ gap: "5px", flexDirection: "column" }}
                      >
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "15px", width: "100%", height: "70px" }}
                        >
                          <input
                            type="checkbox"
                            onChange={(e) => {
                              let selList = [
                                ...selectedUser?.offBoardVendorSelected,
                              ];
                              let selMapp = { ...selectedUser?.offBoardStatus };
                              if (e.target.checked) {
                                let obj = {
                                  email: selectedUser?.offBoardVendor?.email,
                                  vendor: data?.split(":")[0],
                                  adminMemberId: data?.split(":")[1],
                                };
                                selMapp[data?.split(":")[0]] = "YET_TO_START";
                                selList.push(obj);
                              } else {
                                selList = selList?.filter((no) => {
                                  return (
                                    no?.adminMemberId !== data?.split(":")[1]
                                  );
                                });
                                delete selMapp[data?.split(":")[0]];
                              }
                              setSelectedUser((prevState) => ({
                                ...selectedUser,
                                offBoardStatus: selMapp,
                                offBoardVendorSelected: selList,
                              }));
                            }}
                          />
                          <div className="cf_onboard_cloudSelect_img_wrapper">
                            <img
                              src={cloudImageMapper(
                                index === 0
                                  ? data?.split(":")[0]
                                  : data?.split(":")[0] === "GITHUB__"
                                  ? "GITHUB_COPILOT"
                                  : data?.split(":")[0]
                              )}
                              alt={data?.split(":")[0]}
                            />
                          </div>
                          <p>
                            {getCloudName(
                              index === 0
                                ? data?.split(":")[0]
                                : data?.split(":")[0] === "GITHUB__"
                                ? `GitHub Copilot | ${wsList[index - 1]} `
                                : data?.split(":")[0]
                            )}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    ""
                  );
                }
              )}
              <div
                className="CF_d-flex  cf_onboard_cloudSelect"
                style={{ gap: "5px", flexDirection: "column" }}
              >
                <div
                  className="CF_d-flex ai-center"
                  style={{ gap: "15px", width: "100%", height: "70px" }}
                >
                  <p>Delete User Permanently :</p>
                  <label className="switch" style={{ marginTop: "10px" }}>
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        setSelectedUser({
                          ...selectedUser,
                          deleteUserPermanently: e.target.checked,
                        });
                      }}
                      checked={selectedUser?.deleteUserPermanently}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
            </div>
            <div className="cf_popup_container_footer">
              <ButtonComponent
                inputWidth="100%"
                isLoading={false}
                isDisabled={selectedUser?.offBoardVendorSelected?.length === 0}
                buttonName="Start Offboard"
                buttonClickAction={() => startUserOffBoarding()}
              />
            </div>
          </>
        )}
      </Popup>
      {/* Create User Popup End's */}
    </>
  );
};

export default OffBoarding;
