import React, { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import { makeFirstLetterCapital, newImplementation } from "../../helpers/utils";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import Popup from "../../Resuables/Popup/Popup";
import { getLicensesUserList } from "../SaaSManagement/SaaSActions/SaaSActions";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { Check } from "lucide-react";
import CustomDropDown from "../../Resuables/CustomDropDown/CustomDropDown";
import { BiFilterAlt } from "react-icons/bi";

const SaaSLicenceUserList = ({ licenseInfo, setSelectedLicense }) => {
  const navigate = useNavigate();
  const { globalContext } = useContext(GlobalContext);
  const { planName, planId, assignCount } = licenseInfo;
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [licenseUsersList, setLicenseUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    currentPage: 0,
    totalUsers: 0,
    pageSize: 0,
    totalPages: 0,
  });
  const { adminEmail, memberId, providerName, id } = {
    ...globalContext?.saasCloud,
  };

  const [filters, setFilters] = useState({
    activeStatus: { key: "ALL", value: "All" },
  });

  useEffect(() => {
    setLicenseUsersList([]);
    fetchLicenseUsers();
  }, []);

  useEffect(() => {
    if (Object.keys(licenseInfo).length > 0) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [licenseInfo]);

  const fetchLicenseUsers = async (
    pageNo = 0,
    pageSize = 100,
    status = filters?.activeStatus?.key
  ) => {
    setLicenseUsersList([]);
    setIsLoading(true);
    let res = await getLicensesUserList(
      memberId,
      providerName,
      planId,
      pageNo,
      pageSize,
      id,
      status
    );
    if (res?.status === "OK" && res?.res) {
      if (pageNo === 0) {
        setPagination({
          currentPage: 1,
          totalUsers: res?.res?.totalDocuments,
          pageSize: pageSize,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
      setLicenseUsersList(res?.res?.data);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    if (e?.target?.name === "pageSize") {
      setPagination({ ...pagination, pageSize: e?.target?.value });
      fetchLicenseUsers(0, +e?.target?.value, filters?.activeStatus?.key);
    } else {
      setPagination({ ...pagination, currentPage: e?.target?.value });
      fetchLicenseUsers(
        +e?.target?.value - 1,
        pagination?.pageSize,
        filters?.activeStatus?.key
      );
    }
  };

  const handleFilterChanges = (e, action) => {
    setFilters({
      ...filters,
      [action]: e,
    });
    let type = filters?.type?.key;
    let activeStatus = filters?.activeStatus?.key;

    if (action === "activeStatus") {
      activeStatus = e.key;
    }
    if (action === "type") {
      type = e.key;
    }
    fetchLicenseUsers(0, 100, activeStatus);
  };

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: `${planName?.replaceAll("_", " ")} License Users`,
        popupWidth: "60%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "0px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: {
          justifyContent: "flex-end",
        },
      }}
      toggleOpen={setSelectedLicense}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "100%",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
          // gap: "10px",
        }}
      >
        <div
          className="cf_licenses_container_table"
          style={{ height: "calc(100% - 25px)", overflow: "auto" }}
        >
          <table className="cf_licenses_table">
            <thead>
              <tr>
                {!newImplementation.includes(providerName) && (
                  <th style={{ width: "15%", textAlign: "left" }}>Name</th>
                )}
                <th style={{ width: "15%", textAlign: "left" }}>Email</th>
                <th style={{ width: "15%", textAlign: "left" }}>
                  {" "}
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Status</span>
                    <CustomDropDown
                      customDropDownStyles={{
                        width: "120px",
                        right: "-100%",
                      }}
                      defaultVal={filters?.activeStatus}
                      dropDownList={[
                        { key: "ALL", value: "All" },
                        { key: "ACTIVE", value: "Active" },
                        { key: "IN_ACTIVE", value: "Inactive" },
                      ]}
                      selectFilter={(e) =>
                        handleFilterChanges(e, "activeStatus")
                      }
                    >
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt />
                      </span>
                    </CustomDropDown>
                  </div>
                </th>
                <th style={{ width: "15%", textAlign: "left" }}></th>
                {/* <th></th> */}
              </tr>
            </thead>
            <tbody>
              {licenseUsersList?.map((data) => {
                return (
                  <tr key={data?.planId}>
                    {!newImplementation.includes(providerName) && (
                      <td style={{ padding: "5px 15px" }}>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          <div className="cf_license_img_placer">
                            <img
                              src={cloudImageMapper(providerName)}
                              alt={providerName}
                              style={{ width: "25px" }}
                            />
                          </div>
                          <div className="cf_license_title cf_mapping_email">
                            {data?.firstName?.replaceAll("_", " ")}
                          </div>
                        </div>
                      </td>
                    )}
                    <td
                      className="cf_license_title"
                      style={{ padding: "5px 15px" }}
                    >
                      {newImplementation.includes(providerName) ? (
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          <div className="cf_license_img_placer">
                            <img
                              src={cloudImageMapper(providerName)}
                              alt={providerName}
                              style={{ width: "25px" }}
                            />
                          </div>
                          <span className="cf_mapping_email">
                            {data?.email || data?.emailId}
                          </span>
                        </div>
                      ) : (
                        <span className="cf_mapping_email">
                          {data?.email || data?.emailId}
                        </span>
                      )}
                    </td>
                    <td
                      className="cf_license_title"
                      style={{ padding: "5px 15px" }}
                    >
                      {data?.status === "ACTIVE" ? (
                        <div className="cf_new_verified_div">
                          <Check size={16} strokeWidth={3} color="#166534" />
                          <p>Active</p>
                        </div>
                      ) : (
                        ""
                      )}
                      {data?.status === "IN_ACTIVE" ? (
                        <div className="cf_new_unverified_div">
                          <p>Inactive</p>
                        </div>
                      ) : (
                        ""
                      )}
                      {data?.status !== "ACTIVE" &&
                        data?.status !== "IN_ACTIVE" ? (
                        <div className="cf_new_unverified_div">
                          <p>{makeFirstLetterCapital(data?.status)}</p>
                        </div>
                      ) : (
                        ""
                      )}
                    </td>
                    <td style={{ padding: "5px 15px" }}></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isLoading ? getCFTextLoader() : ""}
        </div>
        <div className="cf_new_tables_footer">
          <span>Total Users: {pagination?.totalUsers} </span>
          {newImplementation.includes(providerName) ? (
            <>
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
            </>
          ) : (
            ""
          )}
        </div>
      </div>
    </Popup>
  );
};

export default SaaSLicenceUserList;
