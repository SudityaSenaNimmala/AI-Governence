import { useContext, useEffect, useRef, useState } from "react";
import { cloudImageMapper, getRandomArray } from "../../../helpers/helpers";
import { newImplementation } from "../../../helpers/utils";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { getAssessments } from "../DemoActions/DemoActions";
import { getSaaSGroupsPagination } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { SET_GROUPS_TEAMS_SUMMARY } from "../../../../GlobalContext/action.types";
import moment from "moment";
import { RotateCw } from "lucide-react";
import AssessmentUsersList from "./AssessmentUsersList";

const SaaSAssessments = ({ setIsGroupSync, isGroupSync, checkSyncGroups }) => {
  const [isLoading, setIsLoading] = useState(true);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [assessmentsList, setAssessmentsList] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState(null);
  // const [isGroupSync, setIsGroupSync] = useState(false);
  const [pagination, setPagination] = useState({
    publicCount: 0,
    privateCount: 0,
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const { memberId, providerName, id } = { ...globalContext?.saasCloud };
  const [summary, setSummary] = useState(null);

  const getSaasSummary = async () => {
    setIsPageLoading(true);
    let res = await getSaaSGroupsPagination(memberId, providerName, id);
    if (res?.status === "OK" && res?.res) {
      setIsPageLoading(false);
      if (newImplementation.includes(providerName)) {
        setIsGroupSync(res?.res?.groupSync);
        setIsSynced(res?.res?.groupSync);
        if (res?.res?.groupSync) {
          dispatch({
            type: SET_GROUPS_TEAMS_SUMMARY,
            payload: res?.res,
          });
          setSummary(res?.res);
        }
      } else {
        setIsPageLoading(false);
        setSummary(res?.res);
        dispatch({
          type: SET_GROUPS_TEAMS_SUMMARY,
          payload: res?.res,
        });
      }
      setIsLoading(false);
    } else {
      setIsPageLoading(false);
      setIsLoading(false);
    }
  };

  //   console.log(checkSyncGroups);
  //   console.log(isGroupSync);

  useEffect(() => {
    if (!isGroupSync) {
      getSaasSummary();
    }
  }, [checkSyncGroups]);

  useEffect(() => {
    if (isGroupSync) {
      fetchAssessments();
    }
  }, [isGroupSync]);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchAssessments(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchAssessments(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const searchDebounce = useRef(null);
  const searchAssessments = async (e) => {
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        fetchAssessments(1, pagination?.pageSize, e);
      }, 500);
    } else {
      fetchAssessments(1, pagination?.pageSize);
    }
  };

  const fetchAssessments = async (
    pageNo = 1,
    pageSize = 100,
    searchVal = ""
  ) => {
    setIsLoading(true);
    let res = await getAssessments(id, pageNo, pageSize, searchVal);
    if (res?.status === "OK") {
      setIsLoading(false);
      setAssessmentsList(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          ...pagination,
          totalDocuments: res?.res?.totalDocuments,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
    } else {
      setIsLoading(false);
    }
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
          inputPlaceHolder={`Search By Name`}
          onInputSearch={(e) => searchAssessments(e.searchInput)}
        />
        <span style={{ marginLeft: "auto" }}></span>
        {summary?.groupSync && summary?.processStatus !== "NOT_PROCESSED" && (
          <div
            className="CF_d-flex ai-center"
            style={{ gap: "8px", paddingRight: "40px" }}
          >
            <p
              style={{ fontSize: "12px", fontWeight: "500", color: "#0062ff" }}
            >
              Assessment Candidates are being synced...
            </p>
            <div
              className="cf_dashboard_analytics_edit CF_Pointer"
              style={{ marginLeft: "auto", visibility: "visible" }}
              onClick={() => getSaasSummary()}
              title="Check Status"
            >
              <RotateCw size={12} className="CF_Pointer" title="Check Status" />
            </div>
          </div>
        )}
      </div>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{
          padding: "10px 0 0 0",
          flexDirection: "column",
          height: "fit-content",
        }}
      >
        <div
          className="cf_new_tables_div"
          style={{ height: "calc(100% - 50px)" }}
        >
          <table>
            <thead>
              <tr>
                <th style={{ width: "200px" }}>
                  <span>Assessment Name</span>
                </th>
                <th style={{ width: "100px" }}>
                  <span>Assessment Id</span>
                </th>
                <th style={{ width: "100px" }}>
                  <span>Assessed Users</span>
                </th>
                <th style={{ width: "100px" }}>
                  <span>Total Questions</span>
                </th>
                <th style={{ width: "100px" }}>
                  <span>Passing Score</span>
                </th>
                <th style={{ width: "100px" }}>
                  <span>Retake</span>
                </th>
                <th style={{ width: "100px" }}>
                  <span>Time Allowed</span>
                </th>
                <th style={{ width: "100px" }}>
                  <span>Created At</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  <tr>
                    <td colSpan={7}>{getCFTextLoader()}</td>
                  </tr>
                  <tr style={{ visibility: "hidden" }}>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "200px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <img src={cloudImageMapper(providerName)} alt="SLACK" />
                        <p>hyperlink-migration-in-edited-message</p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>Public</p>
                    </td>
                  </tr>
                </>
              ) : (
                assessmentsList?.map((ass, index) => (
                  <tr key={index}>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "200px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <img
                          src={ass?.logoUrl ?? cloudImageMapper(providerName)}
                          alt="SLACK"
                        />
                        <p
                          className={`cf_make_link`}
                          onClick={() => setSelectedAssessment(ass)}
                          title={ass?.assessmentName}
                        >
                          {ass?.assessmentName}
                        </p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p
                        className={`cf_make_link`}
                        onClick={() => setSelectedAssessment(ass)}
                      >
                        {ass?.assessmentId}
                      </p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p
                        className={`cf_make_link`}
                        onClick={() => setSelectedAssessment(ass)}
                      >
                        {ass?.assessedUsersCount > 0
                          ? ass?.assessedUsersCount
                          : 0}
                      </p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>{ass?.questionsCount > 0 ? ass?.questionsCount : 0}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>{ass?.passingScore > 0 ? ass?.passingScore : 0}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>{ass?.allowReTake ? "Yes" : "No"}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>{ass?.timeAllowed > 0 ? ass?.timeAllowed : 0}</p>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <p>
                        {ass?.dateCreated
                          ? moment(ass?.dateCreated).format("Do MMM YYYY")
                          : "-"}
                      </p>
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
      {selectedAssessment ? (
        <AssessmentUsersList
          assessmentId={selectedAssessment?.assessmentId}
          assessmentName={selectedAssessment?.assessmentName}
          setSelectedAssessment={setSelectedAssessment}
        />
      ) : (
        ""
      )}
    </>
  );
};

export default SaaSAssessments;
