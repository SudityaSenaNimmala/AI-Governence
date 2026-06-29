import { Copy, MoveRight, SquareArrowOutUpRight } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
// import { SET_GROUPS_TEAMS_SUMMARY } from "../../../../../GlobalContext/action.types";
// import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  copyToClipboard,
  formatDateToString,
  notifyToast,
  openLinkInNewTab,
} from "../../helpers/utils";
import CustomToolTip from "../../Resuables/CustomToolTip/CustomToolTip";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
// import {
//   getAssessmentsList,
//   inviteUsersToAssessment,
// } from "../../SaaSActions/SaaSActions";
import { SET_GROUPS_TEAMS_SUMMARY } from "../../../GlobalContext/action.types";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import Popup from "../../Resuables/Popup/Popup";
import {
  getAssessmentsList,
  inviteUsersToAssessment,
} from "../SaaSManagement/SaaSActions/SaaSActions";

const DemoAssesments = () => {
  const navigation = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [inviteUser, setInviteUser] = useState({
    selectedAssessment: {},
    emails: [],
    plainEmails: "",
  });
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [assessmentsList, setAssessmentsList] = useState([]);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { adminEmail } = {
    ...globalContext?.saasCloud,
  };

  useEffect(() => {
    fetchAssessmentsList();
  }, [adminEmail]);

  const fetchAssessmentsList = async () => {
    setIsPageLoading(true);
    const res = await getAssessmentsList(adminEmail);
    if (res?.status === "OK" && res?.res) {
      setAssessmentsList(res?.res);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const handleEmailsInput = (e) => {
    const emails = e.target.value.split(",");
    const validEmails = emails.filter((email) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    });
    let shallowCopy = { ...inviteUser };
    shallowCopy.plainEmails = e.target.value;
    if (validEmails.length > 0) {
      shallowCopy.emails = validEmails;
    }
    setInviteUser(shallowCopy);
  };

  const handleInviteUsers = async () => {
    setIsPageLoading(true);
    const body = {
      candidates: inviteUser?.emails,
      assessment_url: inviteUser?.selectedAssessment?.public_url,
    };
    const res = await inviteUsersToAssessment(adminEmail, body);
    if (res?.status === "OK" && res?.res?.length > 0) {
      setIsPageLoading(false);
      setIsVisible(false);
      setInviteUser({
        selectedAssessment: {},
        emails: [],
        plainEmails: "",
      });
      notifyToast("success", "Users invited successfully");
      fetchAssessmentsList();
    } else {
      setIsPageLoading(false);
      setIsVisible(false);
      setInviteUser({
        selectedAssessment: {},
        emails: [],
        plainEmails: "",
      });
      notifyToast("error", "Failed to invite users");
    }
  };

  return (
    <>
      <div
        className="cf_main_content_place_main cf_saas_options_contatiner"
        style={{ padding: "20px 0 20px 0" }}
      >
        <div className="cf_saas_assessments_list_container">
          {assessmentsList?.map((data) => {
            return (
              <div className="cf_saas_assessments_list_item">
                <div className="cf_saas_assessments_list_item_title">
                  <div
                    className="CF_d-flex"
                    style={{ flexDirection: "column", gap: "5px" }}
                  >
                    <div
                      className="CF_d-flex ai-center"
                      style={{ gap: "10px" }}
                    >
                      <p>{data?.display_name}</p>
                      <MoveRight
                        className="cf_newDashboard_OpenLink"
                        size={16}
                        color="#0062ff"
                        strokeWidth={2.5}
                        onClick={() => {
                          dispatch({
                            type: SET_GROUPS_TEAMS_SUMMARY,
                            payload: data,
                          });
                          navigation("/SaaS/Assessments/Users");
                        }}
                      />
                    </div>
                  </div>

                  {!data?.closed ? (
                    <div className="cf_new_verified_div">
                      <p>Open</p>
                    </div>
                  ) : (
                    <div className="cf_new_unverified_div">
                      <p>Closed</p>
                    </div>
                  )}
                </div>
                <div className="cf_saas_assessments_list_item_body">
                  <div className="cf_saas_assessments_list_item_body_content">
                    <div className="cf_saas_assessments_list_item_body_content_item">
                      <p>{data?.overview_stats?.total}</p>
                      <span>Invited</span>
                    </div>
                    <div className="cf_saas_assessments_list_item_body_content_item">
                      <p>{data?.overview_stats?.assessed}</p>
                      <span>Assessed</span>
                    </div>
                    <div className="cf_saas_assessments_list_item_body_content_item">
                      <p>{data?.overview_stats?.qualified}</p>
                      <span>Qualified</span>
                    </div>
                    <div className="cf_saas_assessments_list_item_body_content_item">
                      <p>{data?.overview_stats?.qualifying_score}</p>
                      <span>Qualifying Score</span>
                    </div>
                  </div>
                  <div className="cf_saas_assessments_list_item_body_content_col">
                    <div className="cf_saas_assessments_list_item_body_content_item_col">
                      <p>{data?.overview_stats?.challenge_count}</p>
                      <span>Challenges</span>
                    </div>
                    <div className="cf_saas_assessments_list_item_body_content_item_col">
                      <p>{data?.overview_stats?.multiple_choice_count}</p>
                      <span>Multiple Choice</span>
                    </div>
                    <div className="cf_saas_assessments_list_item_body_content_item_col">
                      <p>{data?.overview_stats?.project_count}</p>
                      <span>Projects</span>
                    </div>
                    <div className="cf_saas_assessments_list_item_body_content_item_col">
                      <p>{data?.overview_stats?.open_ended_count}</p>
                      <span>Open Ended</span>
                    </div>
                  </div>
                </div>
                <div className="cf_saas_assessments_list_item_footer">
                  {!data?.closed ? (
                    <ActionButton
                      customClass={`changeButtonColorOnHover cf_newDashboard_OpenLink_tr`}
                      customStyles={{
                        backgroundColor: "#f2f2f2",
                        // padding: "8px 12px",
                        height: "30px",
                      }}
                      buttonType="button"
                      buttonClickAction={() => {
                        setInviteUser({
                          selectedAssessment: data,
                          emails: [],
                          plainEmails: "",
                        });
                        setIsVisible(true);
                      }}
                    >
                      <p style={{ fontSize: "12px" }}>Invite</p>
                    </ActionButton>
                  ) : (
                    ""
                  )}

                  <CustomToolTip title="Preview">
                    <SquareArrowOutUpRight
                      className="cf_newDashboard_OpenLink"
                      size={12}
                      color="#0062ff"
                      onClick={() => openLinkInNewTab(data?.public_url)}
                    />
                  </CustomToolTip>
                  <CustomToolTip title="Copy Public Link">
                    <Copy
                      className="cf_newDashboard_OpenLink"
                      size={12}
                      color="#0062ff"
                      onClick={() => copyToClipboard(data?.public_url)}
                    />
                  </CustomToolTip>
                  <p
                    style={{
                      fontSize: "10px",
                      marginLeft: "auto",
                      color: "#64748b",
                      fontWeight: "500",
                    }}
                  >
                    Created At: {formatDateToString(data?.created_date)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Popup
        options={{
          isOpen: isVisible,
          title: `Invite Users to ${inviteUser?.selectedAssessment?.display_name} Assessment`,
          popupWidth: "40%",
          popupHeight: `250px`,
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
          }}
        >
          <textarea
            className="cf_textInput"
            style={{
              resize: "none",
              width: "100%",
              height: "100vh",
              fontSize: "12px",
              padding: "6px",
            }}
            value={inviteUser?.plainEmails}
            onInput={(e) =>
              e.target.value
                ? handleEmailsInput(e)
                : setInviteUser({
                    ...inviteUser,
                    emails: [],
                    plainEmails: "",
                  })
            }
            placeholder="Enter emails seperated by comma (e.g. abc@gmail.com,xyz@gmail.com)"
          />
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={inviteUser?.emails?.length === 0}
            buttonName="Send Invite"
            buttonClickAction={() => handleInviteUsers(inviteUser?.emails)}
          />
        </div>
      </Popup>
      {isPageLoading ? getCFLoader() : null}
    </>
  );
};

export default DemoAssesments;
