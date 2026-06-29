import React, { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getRandomArray } from "../../../../helpers/helpers";
import { getCFTextLoader } from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import { getLicensesUserList } from "../../SaaSActions/SaaSActions";
import { newImplementation } from "../../../../helpers/utils";

const SaaSLicensesUsersList = () => {
  const navigate = useNavigate();
  const { globalContext } = useContext(GlobalContext);
  const { licenseName, licenseId } = useParams();
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

  useEffect(() => {
    fetchLicenseUsers();
  }, []);

  const fetchLicenseUsers = async (pageNo = 0, pageSize = 100) => {
    setIsLoading(true);
    let res = await getLicensesUserList(
      memberId,
      providerName,
      licenseId,
      pageNo,
      pageSize,
      id
    );
    if (res?.status === "OK" && res?.res) {
      setLicenseUsersList(res?.res);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let count = +licenseName?.replaceAll("_", " ")?.split("|")[1];
    if (isNaN(count)) {
      count = 0;
    }
    setPagination({
      currentPage: 1,
      totalUsers: count,
      pageSize: 100,
      totalPages: Math.ceil(count / 100),
    });
  }, [licenseName]);

  const handlePagination = (e) => {
    if (e?.target?.name === "pageSize") {
      setPagination({ ...pagination, pageSize: e?.target?.value });
      fetchLicenseUsers(0, +e?.target?.value);
    } else {
      setPagination({ ...pagination, currentPage: e?.target?.value });
      fetchLicenseUsers(+e?.target?.value - 1, pagination?.pageSize);
    }
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="SaaS Management" />
      <div className="cf_main_content_place">
        <TopNav
          pageName={`${
            licenseName?.replaceAll("_", " ")?.split("|")[0]
          } License Users`}
          backLink="/Applications/Insights#LICENSE_MANAGEMENT"
        />

        <div
          className="cf_main_content_place_main cf_saas_options_contatiner"
          style={{ padding: "20px 0 20px 0" }}
        >
          <div
            className="cf_licenses_container_table"
            style={{ height: "calc(100% - 25px)", overflow: "auto" }}
          >
            <table className="cf_licenses_table">
              <thead>
                <tr>
                  {!newImplementation.includes(providerName) && (
                    <th style={{ width: "15%" }}>Name</th>
                  )}
                  <th style={{ width: "15%" }}>Email</th>
                  <th style={{ width: "15%" }}></th>
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
      </div>
    </div>
  );
};

export default SaaSLicensesUsersList;
