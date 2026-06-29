import {
  Ban,
  CheckCircle,
  Copy,
  MoveRight,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SET_GROUPS_TEAMS_SUMMARY } from "../../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  copyToClipboard,
  formatDateToString,
  getMaxChar,
  openLinkInNewTab,
} from "../../../../helpers/utils";
import CustomToolTip from "../../../../Resuables/CustomToolTip/CustomToolTip";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import { getAssessmentsUsersList } from "../../SaaSActions/SaaSActions";
import { IoClose } from "react-icons/io5";

const SaaSAssessmentsUsers = () => {
  const navigation = useNavigate();
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [assessmentUsersList, setAssessmentUsersList] = useState([]);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { display_name, test_id } = {
    ...globalContext?.groupsTeamsSummary,
  };
  const { adminEmail } = {
    ...globalContext?.saasCloud,
  };
  useEffect(() => {
    fetchAssessmentsList();
  }, []);

  const fetchAssessmentsList = async () => {
    const res = await getAssessmentsUsersList(adminEmail, test_id);
    if (res?.status === "OK" && res?.res) {
      setAssessmentUsersList(res?.res);
      setIsPageLoading(false);
    } else {
      setAssessmentUsersList([]);
      setIsPageLoading(false);
    }
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav
            pageName={`${display_name} Assessment Users`}
            backLink="/Applications/Insights#ASSESSMENTS"
          />

          <div
            className="cf_main_content_place_main cf_saas_options_contatiner"
            style={{ padding: "20px 0 20px 0" }}
          >
            <div
              className="cf_main_content_place_main CF_d-flex"
              style={{
                padding: "10px 0 0 0",
                flexDirection: "column",
                height: "calc(100vh - 130px)",
              }}
            >
              <div
                className="cf_new_tables_div"
                style={{ height: "calc(100% - 50px)" }}
              >
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "100px" }}>Name</th>
                      <th style={{ width: "100px" }}>Email</th>
                      <th style={{ width: "100px" }}>Invited By</th>
                      <th style={{ width: "50px" }}>MCQ Score</th>
                      <th style={{ width: "50px" }}>Code Score</th>
                      <th style={{ width: "50px" }}>Total Score</th>
                      <th style={{ width: "50px" }}>Status</th>
                      <th style={{ width: "10px" }}></th>
                      <th style={{ width: "100px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assessmentUsersList?.map((item, index) => (
                      <tr key={index}>
                        <td
                          className="cf_new_table_hide_text"
                          title={item?.name}
                        >
                          <p>{getMaxChar(item?.name || "-", 15)}</p>
                        </td>
                        <td
                          className="cf_new_table_hide_text"
                          title={item?.email}
                        >
                          <p>{getMaxChar(item?.email || "-", 20)}</p>
                        </td>
                        <td
                          className="cf_new_table_hide_text"
                          title={item?.invited_by_admin}
                        >
                          <p>{getMaxChar(item?.invited_by_admin || "-", 20)}</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>{item?.mc_score}</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>{item?.code_score}</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>{item?.final_score}</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <p>{item?.status}</p>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <div>
                            {item?.final_grade ? (
                              item?.final_grade === "pass" ? (
                                <CustomToolTip title="Passed">
                                  <CheckCircle
                                    color="green"
                                    title="Passed"
                                    size={15}
                                  />
                                </CustomToolTip>
                              ) : (
                                <CustomToolTip title="Failed">
                                  <IoClose
                                    size={15}
                                    color="red"
                                    title="Failed"
                                  />
                                </CustomToolTip>
                              )
                            ) : (
                              ""
                            )}
                          </div>
                        </td>
                        <td className="cf_new_table_hide_text">
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "20px" }}
                          >
                            <div>
                              {item?.date_joined ? (
                                <div>
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Started At:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {formatDateToString(item?.date_joined)}
                                  </span>
                                </div>
                              ) : (
                                ""
                              )}
                              {item?.time_taken ? (
                                <div>
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Time Taken:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {item?.time_taken} Mins
                                  </span>
                                </div>
                              ) : (
                                ""
                              )}
                            </div>
                            <div>
                              {item?.status !== "Invited" ? (
                                <CustomToolTip title="View Report">
                                  <SquareArrowOutUpRight
                                    className="cf_newDashboard_OpenLink_tr"
                                    size={12}
                                    color="#0062ff"
                                    onClick={() =>
                                      openLinkInNewTab(item?.report_link)
                                    }
                                  />
                                </CustomToolTip>
                              ) : (
                                ""
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : null}
    </>
  );
};

export default SaaSAssessmentsUsers;
