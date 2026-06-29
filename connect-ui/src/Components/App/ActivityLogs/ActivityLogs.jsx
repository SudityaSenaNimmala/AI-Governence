import { useEffect, useState } from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import { getActivityLogs } from "../SaaSManagement/SaaSActions/SaaSActions";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import { makeFirstLetterCapital } from "../../helpers/utils";
import { RefreshCcw } from "lucide-react";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";

const ActivityLogs = () => {
  const [activityLogs, setActivityLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState({
    pageSize: 100,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });

  const getLogs = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize
  ) => {
    setIsLoading(true);
    let res = await getActivityLogs(pageNo, pageSize);
    if (res?.status === "OK") {
      setIsLoading(false);
      setActivityLogs(res?.res?.data);
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

  useEffect(() => {
    getLogs();
  }, []);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      getLogs(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      getLogs(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  return (
    <div className="cf_main_container">
      <SideNav activeTab="Settings" />
      <div className="cf_main_content_place">
        <TopNav pageName="Audit Logs" backLink="/Settings" />
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
        >
          <div
            className="cf_saas_options"
            style={{ marginTop: "10px", height: "40px" }}
          >
            <span style={{ marginLeft: "auto" }}></span>
            <ActionButton
              customClass={`changeButtonColorOnHover`}
              customStyles={{
                backgroundColor: "#f2f2f2",
                height: "35px",
                width: "35px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              buttonType="button"
              buttonClickAction={() => {
                getLogs();
              }}
            >
              <RefreshCcw size={16} />
            </ActionButton>
          </div>
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              padding: "0 0 10px 0",
              flexDirection: "column",
              height: "calc(100% - 40px)",
              width: "100%",
            }}
          >
            <div
              className="cf_new_tables_div"
              style={{ height: "calc(100% - 50px)" }}
            >
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "50px" }}>Time</th>
                    <th style={{ width: "100px" }}>Actor</th>
                    <th style={{ width: "50px" }}>Application</th>
                    <th style={{ width: "100px" }}>Event</th>
                    <th style={{ width: "100px" }}>Type</th>
                    {/* <th style={{ width: "300px" }}>Full Text</th> */}
                  </tr>
                </thead>
                <tbody>
                  {activityLogs?.map((log) => (
                    <tr key={log?.id}>
                      <td
                        className="cf_new_table_hide_text"
                        style={{ width: "50px" }}
                      >
                        <p>{new Date(log?.localDateTime).toLocaleString()}</p>
                      </td>
                      <td
                        className="cf_new_table_hide_text"
                        style={{ width: "150px" }}
                      >
                        <p>{log?.actorEmailId}</p>
                      </td>
                      <td className="cf_new_table_hide_text">
                        <img
                          src={cloudImageMapper(log?.vendor)}
                          alt={log?.vendor}
                          style={{
                            width: "20px",
                            height: "20px",
                            objectFit: "contain",
                          }}
                        />
                      </td>
                      <td className="cf_new_table_hide_text">
                        <p>
                          {makeFirstLetterCapital(
                            log?.event?.replaceAll("_", " ")
                          )}
                        </p>
                      </td>
                      <td className="cf_new_table_hide_text">
                        <p>{log?.type}</p>
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
        </div>
      </div>
      {isLoading && getCFLoader()}
    </div>
  );
};

export default ActivityLogs;
