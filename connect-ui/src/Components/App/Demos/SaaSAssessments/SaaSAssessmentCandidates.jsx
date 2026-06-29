import { useContext, useEffect, useRef, useState } from "react";
import { cloudImageMapper, getRandomArray } from "../../../helpers/helpers";
import { getMaxChar } from "../../../helpers/utils";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getAssessmentCandidates } from "../DemoActions/DemoActions";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { Check } from "lucide-react";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import { BiFilterAlt } from "react-icons/bi";

const SaaSAssessmentCandidates = ({ assessmentId, assessmentName = "ALL" }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 100,
    totalPages: 1,
    totalDocuments: 0,
  });
  const [filters, setFilters] = useState({
    status: { key: "ALL", value: "ALL" },
  });
  const [searchFilter, setSearchFilter] = useState("");

  const { globalContext } = useContext(GlobalContext);
  const { memberId, providerName, usersCount, id } = {
    ...globalContext?.saasCloud,
  };

  const fetchAssessmentCandidates = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    assessment = assessmentName,
    status = filters?.status?.key,
    searchVal = searchFilter
  ) => {
    setIsLoading(true);
    let res = await getAssessmentCandidates(
      id,
      pageNo,
      pageSize,
      assessmentName,
      status,
      searchVal
    );
    if (res?.status === "OK" && res?.res) {
      setIsLoading(false);
      setUsersList(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          ...pagination,
          currentPage: pageNo,
          pageSize: pageSize,
          totalDocuments: res?.res?.totalDocuments,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
    } else {
      setIsLoading(false);
    }
  };

  const searchDebounce = useRef(null);
  const searchUsersList = async (e) => {
    setSearchFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        fetchAssessmentCandidates(1, 100, "ALL", filters?.status?.key, e);
      }, 500);
    } else {
      fetchAssessmentCandidates(1, 100, "ALL", filters?.status?.key, null);
    }
  };

  useEffect(() => {
    fetchAssessmentCandidates();
  }, [id]);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchAssessmentCandidates(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchAssessmentCandidates(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const handleFilterChanges = (e, action) => {
    setFilters({
      ...filters,
      [action]: e,
    });
    fetchAssessmentCandidates(1, 100, "ALL", e?.key, null);
  };
  return (
    <>
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
          inputPlaceHolder={
            providerName == "JIRA"
              ? `Search By Name`
              : `Search By Email Or Name`
          }
          onInputSearch={(e) => searchUsersList(e.searchInput)}
        />
        <span style={{ marginLeft: "auto" }}></span>
      </div>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{
          padding: "10px 0 0 0",
          flexDirection: "column",
          ...(assessmentId ? {} : { height: "fit-content" }),
        }}
      >
        <div
          className="cf_new_tables_div"
          style={{
            ...(assessmentId
              ? { height: "calc(100% - 60px)", overflow: "auto" }
              : { height: "fit-content", overflow: "visible" }),
          }}
        >
          <table>
            <thead>
              <tr>
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>First Name</span>
                  </div>
                </th>
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Last Name</span>
                  </div>
                </th>
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Email</span>
                  </div>
                </th>
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Assessment Name</span>
                  </div>
                </th>
                <th style={{ width: "50px" }}>
                  <span>Attempts</span>
                </th>
                <th style={{ width: "50px" }}>
                  <span>Score</span>
                </th>
                <th style={{ width: "50px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Time Taken</span>
                  </div>
                </th>
                <th style={{ width: "50px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Status</span>
                    <CustomDropDown
                      customDropDownStyles={{
                        width: "120px",
                        right: "-100%",
                      }}
                      defaultVal={filters?.status}
                      dropDownList={[
                        { key: "ALL", value: "All" },
                        { key: "INVITED", value: "Invited" },
                        { key: "PASS", value: "Passed" },
                        { key: "FAILED", value: "Failed" },
                      ]}
                      selectFilter={(e) => handleFilterChanges(e, "status")}
                    >
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt />
                      </span>
                    </CustomDropDown>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  <tr>
                    <td colSpan={8}>{getCFTextLoader()}</td>
                  </tr>
                  <tr style={{ visibility: "hidden" }}>
                    <td className="cf_new_table_hide_text">
                      <p>vimalesh.t_cloudfuze...odclub.onmicrosoft.com</p>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "15%" }}
                    >
                      <div className="cf_new_unverified_div">
                        <p>Unverified</p>
                      </div>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "15%" }}
                    >
                      <div className="cf_new_unverified_div">
                        <p>Unverified</p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "15%" }}
                    >
                      <div className="cf_new_unverified_div">
                        <p>Unverified</p>
                      </div>
                    </td>
                  </tr>
                </>
              ) : (
                usersList?.map((res, index) => (
                  <tr key={index}>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <img
                          src={res?.logoUrl ?? cloudImageMapper(providerName)}
                          alt="SLACK"
                        />
                        <p title={res?.firstName}>
                          {getMaxChar(res?.firstName, 40)}
                        </p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p title={res?.lastName}>
                          {getMaxChar(res?.lastName, 40)}
                        </p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p title={res?.email}>{getMaxChar(res?.email, 40)}</p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p title={res?.assessmentName}>
                          {getMaxChar(res?.assessmentName, 40)}
                        </p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "50px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p>{res?.attempt > 0 ? res?.attempt : "0"}</p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "50px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p>{res?.finalScore > 0 ? res?.finalScore : "0"}</p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "50px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p>
                          {res?.timeUsed > 0
                            ? `${(res?.timeUsed / 60)
                                .toFixed(2)
                                .toString()
                                .replace(".", ":")} Mins`
                            : "-"}
                        </p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "50px" }}
                    >
                      {res?.status === "INVITED" ? (
                        <div className="cf_new_invited_div">
                          <p style={{ color: "#0062ff !important" }}>Invited</p>
                        </div>
                      ) : res?.isPass ? (
                        <div className="cf_new_verified_div">
                          <Check size={16} strokeWidth={3} color="#166534" />
                          <p>Pass</p>
                        </div>
                      ) : (
                        <div className="cf_new_unverified_div">
                          <p>Failed</p>
                        </div>
                      )}
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

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default SaaSAssessmentCandidates;
