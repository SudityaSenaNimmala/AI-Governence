import { BadgeAlert, BadgeCheck, X } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import { getNewShadowAppsList, revokeAccessForApplication } from "../SaaSManagement/SaaSActions/SaaSActions";
import ManageShadowITApplications from "./ManageShadowITApplications";
import CustomToolTip from "../../Resuables/CustomToolTip/CustomToolTip";
import { getMaxChar, notifyToast } from "../../helpers/utils";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import { BiFilterAlt } from "react-icons/bi";
import CustomDropDown from "../../Resuables/CustomDropDown/CustomDropDown";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import Popup from "../../Resuables/Popup/Popup";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";

const ShadowITInfo = ({ filter = null, from = null, searchData = null }) => {
  const { globalContext } = useContext(GlobalContext);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [scopesList, setScopesList] = useState([]);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [activeSearchFilter, setActiveSearchFilter] = useState("");
  const [filters, setFilters] = useState({ key: "ALL", value: "All" });
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [appsList, setAppsList] = useState([]);
  const [currentAdminCloudId, setCurrentAdminCloudId] = useState(null);
  const [currentVendor, setCurrentVendor] = useState(null);
  const [isRevokeAccessPopupOpen, setIsRevokeAccessPopupOpen] = useState(false);
  const [revokeApplication, setRevokeApplication] = useState(null);
  // useEffect(() => {
  //   getAppsList();
  // }, []);

  useEffect(() => {
    if (filters?.key === "ALL") {
      setCurrentAdminCloudId(null);
      getAppsList(1, 100, activeSearchFilter, null);
    } else {
      let cloudId = globalContext?.cloudsList?.find(
        (res) => (res?.adminEmail === filters?.value && res?.providerName === filters?.key)
      )?.id;
      console.log(cloudId);
      setCurrentAdminCloudId(cloudId);
      getAppsList(1, 100, activeSearchFilter, cloudId);
    }
  }, [filters]);

  const getAppsList = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    searchValue = null,
    adminCloudId = currentAdminCloudId
  ) => {
    setIsPageLoading(true);
    console.log(adminCloudId);
    let res = await getNewShadowAppsList(
      adminCloudId,
      searchValue,
      pageNo,
      pageSize
    );
    if (res?.status === "OK" && res?.res) {
      setAppsList(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          pageSize: pageSize,
          currentPage: pageNo,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
          totalDocuments: res?.res?.totalDocuments,
        });
      }
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const selectApplication = (application) => {
    setSelectedApplication(application);
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      getAppsList(1, +value, activeSearchFilter);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      getAppsList(+value, pagination?.pageSize, activeSearchFilter);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const displayScopes = (scopes, providerName) => {
    return scopes
      ?.filter((res) => res?.scopeName || res?.scopeAccess !== "")
      .map((data, index) => {
        return (index === 0 || index === 1) &&
          (data?.scopeName || data?.scopeAccess) ? (
          <div
            className="cf_new_unverified_div CF_ChangeColor"
            key={`${index}_scopes_${providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
              providerName === "MICROSOFT_TEAMS" ||
              providerName === "MICROSOFT_OFFICE_365"
              ? data?.scopeAccess
              : data?.scopeName
              }`}
          >
            <CustomToolTip
              title={
                providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
                  providerName === "MICROSOFT_TEAMS" ||
                  providerName === "MICROSOFT_OFFICE_365"
                  ? data?.scopeAccess
                  : data?.scopeName
              }
            >
              <p style={{ color: "#000" }}>
                {getMaxChar(
                  providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
                    providerName === "MICROSOFT_TEAMS" ||
                    providerName === "MICROSOFT_OFFICE_365"
                    ? data?.scopeAccess
                    : data?.scopeName,
                  15
                )}
              </p>
            </CustomToolTip>
          </div>
        ) : index === 2 ? (
          <div
            className="cf_new_unverified_div CF_Pointer CF_ChangeColor"
            onClick={() => {
              setScopesList(scopes);
              setCurrentVendor(providerName);
            }}
            key={`${index}_scope2`}
          >
            <CustomToolTip title="Click To View The Scopes">
              <p style={{ color: "#000", zIndex: "-1" }}>
                + {scopes?.length - 2}
              </p>
            </CustomToolTip>
          </div>
        ) : (
          ""
        );
      });
  };

  const searchDebounce = useRef(null);
  const searchAppsList = async (e) => {
    setActiveSearchFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        getAppsList(1, 100, e);
      }, 500);
    } else {
      getAppsList(1, 100, null);
    }
  };

  useEffect(() => {
    if (searchData || searchData?.trim() === "") {
      searchAppsList(searchData?.trim());
    }
  }, [searchData]);


  const handleRevokeAccess = async () => {
    setIsRevokeAccessPopupOpen(false);
    setIsPageLoading(true);
    let res = await revokeAccessForApplication(revokeAccessForApplication?.adminCloudId, revokeAccessForApplication?.applicationId, revokeAccessForApplication?.vendor);
    if (res?.status === "OK") {
      let softDelete = [...appsList];
      softDelete = softDelete.filter(item => item?.id !== revokeApplication?.id);
      setAppsList(softDelete);
      notifyToast("success", "Access revoked successfully");
      setIsPageLoading(false);
    } else {
      let softDelete = [...appsList];
      softDelete = softDelete.filter(item => item?.id !== revokeApplication?.id);
      setAppsList(softDelete);
      notifyToast("error", "Failed to revoke access");
      setIsPageLoading(false);
    }
  }

  return (
    <>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{ padding: "10px 0", flexDirection: "column", gap: "15px", ...(from === "Applications" ? { height: "calc(100% - 115px)" } : {}) }}
      >
        {from !== "Applications" ? <div
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
            inputPlaceHolder={`Search By Application Name`}
            onInputSearch={(e) => searchAppsList(e?.searchInput)}
          />
          <span style={{ marginLeft: "auto" }}></span>
        </div> : ""}
        <div
          style={{
            height: from === "Applications" ? "calc(100% - 0px)" : "calc(100% - 60px)",
            flexDirection: "row",
            gap: "10px",
            display: "flex",
            marginTop: from === "Applications" ? "10px" : "0px",
          }}
        >
          <div
            className=""
            style={{
              height: "calc(100% - 00px)",
              width: scopesList?.length > 0 ? "70%" : "100%",
            }}
          >
            <div
              className="cf_new_tables_div"
              style={{ height: "calc(100% - 50px)" }}
            >
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "200px" }}>Application</th>
                    <th style={{ width: "200px" }}>Publisher</th>
                    {filter === null ? (
                      <th style={{ width: "200px" }}>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          <span
                            className="CF_d-flex cf_mapping_email"
                            style={{ gap: "10px", width: "fit-content" }}
                          >
                            Source
                          </span>
                          <CustomDropDown
                            isCloudsList={true}
                            customDropDownStyles={{
                              width: "fit-content",
                              left: "-100%",
                            }}
                            defaultVal={filters}
                            matchKey="id"
                            dropDownList={[
                              { key: "ALL", value: "All" },
                              ...globalContext?.cloudsList?.reduce(
                                (acc, curr) => {
                                  if (
                                    curr?.providerName !== "OTHERS" &&
                                    (curr?.providerName ===
                                      "GOOGLE_WORKSPACE" ||
                                      curr?.providerName ===
                                      "MICROSOFT_OFFICE_365")
                                  ) {
                                    acc.push({
                                      key: curr?.providerName,
                                      value: curr?.adminEmail,
                                      id: curr?.id,
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
                    ) : (
                      ""
                    )}
                    <th style={{ width: "200px", textAlign: "left" }}>Sensitivity</th>
                    <th style={{ width: "200px", textAlign: "left" }}>
                      Scopes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {appsList.map((item, index) => (
                    <tr key={index}>
                      <td className="cf_new_table_hide_text">
                        <div className="cf_ManageClouds_table_image_container">
                          <img
                            src={
                              item?.logoUrl
                                ? item?.logoUrl
                                : item?.vendor === "TAILSCALE" && item?.os
                                  ? cloudImageMapper(item?.os)
                                  : cloudImageMapper("APPLICATION")
                            }
                            alt="SLACK"
                            style={
                              item?.vendor === "TAILSCALE" && item?.os
                                ? {
                                  width: "20px",
                                  height: "20px",
                                  objectFit: "contain",
                                }
                                : { objectFit: "contain" }
                            }
                          />
                          <div className="cf_license_title">
                            <p
                              className="cf_make_link"
                              onClick={() => {
                                setSelectedApplication(item);
                              }}
                            >
                              {getMaxChar(
                                item?.vendor === "TAILSCALE"
                                  ? item?.hostname
                                  : item?.appName || item?.displayName,
                                40
                              )}
                            </p>
                            {item?.vendor === "TAILSCALE" && (
                              <span style={{ fontSize: "10px" }}>
                                {item?.version}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="cf_new_table_hide_text">
                        <p>{item.publisherDomain ?? "-"}</p>
                      </td>
                      {filter === null ? (
                        <td className="cf_new_table_hide_text">
                          <div
                            className="cf_ManageClouds_table_image_container"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              marginLeft: "20px",
                            }}
                          >
                            <img
                              src={cloudImageMapper(item?.vendor)}
                              alt="SLACK"
                            />
                          </div>
                        </td>
                      ) : (
                        ""
                      )}
                      <td>
                        {(() => {
                          const len = item?.scopes?.length ?? 0;
                          const level = len > 3 ? "HIGH" : len > 0 ? "MEDIUM" : "LOW";
                          const badgeStyle = {
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            ...(level === "HIGH"
                              ? { background: "#fef2f2", color: "#dc2626" }
                              : level === "MEDIUM"
                                ? { background: "#fffbeb", color: "#d97706" }
                                : { background: "#f0fdf4", color: "#16a34a" }),
                          };
                          return <span style={badgeStyle}>{level}</span>;
                        })()}
                      </td>
                      <td className="cf_new_table_hide_text">
                        <div className="CF_d-flex" style={{ gap: "5px" }}>
                          {item?.scopes?.length > 0
                            ? displayScopes(item?.scopes, item?.vendor)
                            : "-"}
                        </div>
                      </td>
                    </tr>
                  ))}
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
          {scopesList?.length > 0 ? (
            <div
              className="cf_main_content_place_main CF_d-flex"
              style={{
                padding: "0 0 0px 0",
                width: scopesList?.length > 0 ? "30%" : "0%",
                position: "sticky",
                top: "00px",
                height: "100%",
              }}
            >
              <div
                className="cf_new_tables_div"
                style={{
                  height: "calc(100% - 00px)",
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
                          <p>Scopes List</p>
                          <X
                            size={15}
                            className="CF_Pointer"
                            onClick={() => setScopesList([])}
                          />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopesList?.map((res, index) => {
                      return (
                        <tr key={`${index}_scope1`}>
                          <td>
                            <div
                              style={{
                                width: "100%",
                                flexDirection: "column",
                                gap: "8px",
                                overflow: "hidden",
                              }}
                              className="CF_d-flex"
                            >
                              <div
                                className="cf_new_unverified_div CF_ChangeColor"
                                style={{ background: "#0022701a" }}
                              >
                                <p style={{ color: "#000" }}>
                                  {currentVendor === "MICROSOFT_TEAMS" ||
                                    currentVendor === "MICROSOFT_OFFICE_365" ||
                                    currentVendor === "AZURE_ACTIVE_DIRECTORY"
                                    ? res?.scopeAccess
                                    : res?.scopeName}
                                </p>
                              </div>
                              <p
                                style={{
                                  color: "#000",
                                  padding: "0 5px",
                                  fontWeight: "500",
                                  textOverflow: "ellipsis",
                                }}
                                title={
                                  currentVendor === "MICROSOFT_TEAMS" ||
                                    currentVendor === "MICROSOFT_OFFICE_365" ||
                                    currentVendor === "AZURE_ACTIVE_DIRECTORY"
                                    ? res?.adminConsentDescription
                                    : res?.scopeAccess
                                }
                              >
                                {getMaxChar(
                                  currentVendor === "MICROSOFT_TEAMS" ||
                                    currentVendor === "MICROSOFT_OFFICE_365" ||
                                    currentVendor === "AZURE_ACTIVE_DIRECTORY"
                                    ? res?.adminConsentDescription
                                    : res?.scopeAccess,
                                  "60"
                                )}
                              </p>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            ""
          )}
        </div>
      </div >
      {selectedApplication && (
        <ManageShadowITApplications
          application={selectedApplication}
          setSelectedApplication={setSelectedApplication}
        />
      )
      }
      {isPageLoading ? getCFLoader() : ""}
      <Popup
        options={{
          isOpen: isRevokeAccessPopupOpen,
          title: `Revoke Access For ${getMaxChar(
            revokeApplication?.vendor === "TAILSCALE"
              ? revokeApplication?.hostname
              : revokeApplication?.appName || revokeApplication?.displayName,
            40
          )}`,
          popupWidth: "30%",
          popupHeight: `200px`,
          popupTop: "150px",
        }}
        toggleOpen={setIsRevokeAccessPopupOpen}
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
            Are you sure you want to revoke access for the application?
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
              setIsRevokeAccessPopupOpen(null);
            }}
          />
          <ButtonComponent
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Yes"
            buttonClickAction={() => handleRevokeAccess()}
          />
        </div>
      </Popup>
    </>
  );
};

export default ShadowITInfo;
