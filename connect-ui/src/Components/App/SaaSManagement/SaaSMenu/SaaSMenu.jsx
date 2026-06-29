import {
  FileDown,
  FileText,
  Globe,
  Headset,
  Key,
  LayoutGrid,
  MoveRight,
  RotateCw,
  ShieldAlert,
  Users,
  UsersRound,
} from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  customAppMenu,
  downloadGlobalCSV,
  notifyToast,
  onlyGroupsRequired,
  onlyTeamsRequired,
} from "../../../helpers/utils";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import Popup from "../../../Resuables/Popup/Popup";
import {
  downloadSaaSAppsReports,
  getSaaSCloudStatus,
} from "../SaaSActions/SaaSActions";
import { useNavigate } from "react-router-dom";
import { SET_UPDATE_JOB_PARAMS } from "../../../../GlobalContext/action.types";

const SaaSMenu = () => {
  const navigation = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [synced, setSynced] = useState(false);
  const [cloudStatus, setCloudStatus] = useState({});
  const { adminEmail, memberId, providerName } = {
    ...globalContext?.saasCloud,
  };
  const [reportOptions, setReportOptions] = useState({
    type: "TEAMS",
    duration: providerName === "SENDGRID" ? 30 : 7,
    custom: false,
  });
  const [options, setOptions] = useState([]);

  useEffect(() => {
    setOptions([]);
    setSynced(false);
    setMenuOptions();
  }, [globalContext?.saasCloud]);

  const setMenuOptions = () => {
    let menuList = [];

    if (customAppMenu.assesmentsApps.includes(providerName)) {
      menuList.push({
        icon: <FileText color="#fff" />,
        link: `/SaaS/Assessments`,
        background: "#3b82f6",
        title: `Assessments`,
        summary: `Manage And Invite For Assessments`,
        isSynced: true,
      });
    }

    if (customAppMenu.interviewApps.includes(providerName)) {
      menuList.push({
        icon: <Headset color="#fff" />,
        link: `/SaaS/Interviews`,
        background: "#a855f7",
        title: `Interviews`,
        summary: `Manage And Invite For Interviews`,
        isSynced: true,
      });
    }

    if (!customAppMenu.noResourcesApps.includes(providerName)) {
      menuList.push({
        icon: <LayoutGrid color="#fff" />,
        link: `/SaaS/ConnectedApps/New`,
        background: "#3b82f6",
        title: `Connected Apps`,
        summary: `Manage your application resources`,
        isSynced: true,
      });
    }

    if (!customAppMenu.noLicenseApps.includes(providerName)) {
      menuList.push({
        icon: <Key color="#fff" />,
        link: `/SaaS/License`,
        background: "#a855f7",
        title: `License Management`,
        summary: `Track and optimize licenses`,
        isSynced: true,
      });
    }

    if (!customAppMenu.noUserManagementApps.includes(providerName)) {
      menuList.push({
        icon: <Users color="#fff" />,
        link: `/SaaS/UserManagement`,
        background: "#22c55e",
        title: `User Management`,
        summary: `Manage user access and roles`,
        isSynced: false,
      });
    }

    if (!customAppMenu.noTeamsGroupsApps.includes(providerName)) {
      menuList.push({
        icon: <UsersRound color="#fff" />,
        link: `/SaaS/TeamsGroups`,
        background: "#f97316",
        title:
          providerName === "SLACK"
            ? `Channel Management`
            : onlyTeamsRequired.includes(providerName)
            ? `Team Management`
            : `Group Management`,
        summary: `Organize and manage ${
          providerName === "GOOGLE_WORKSPACE"
            ? `groups`
            : providerName === "SLACK"
            ? `channels`
            : `teams`
        }`,
        isSynced: false,
      });
    }

    if (!customAppMenu.noDomainApps.includes(providerName)) {
      menuList.push({
        icon: <Globe color="#fff" />,
        link: `/SaaS/Domains`,
        background: "#ec4899",
        title: `Domains`,
        summary: `Manage connected domains`,
        isSynced: true,
      });
    }

    if (customAppMenu.shadowItApps.includes(providerName)) {
      menuList.push({
        icon: <ShieldAlert color="#fff" />,
        link: `/SaaS/ShadowIT`,
        background: "#ef4444",
        title: `Shadow IT`,
        summary: `Discover, and manage unauthorized apps in your organization`,
        isSynced: true,
      });
    }

    if (!customAppMenu.noDownloadApps.includes(providerName)) {
      menuList.push({
        icon: <FileDown color="#fff" />,
        link: `#`,
        background: "#6366f1",
        title: `Download Reports`,
        summary: `Download detailed reports`,
        isSynced: true,
      });
    }

    setOptions(menuList);
  };

  useEffect(() => {
    if (options.length > 0 && !synced) {
      getCloudStatus();
    }
  }, [options]);

  const getCloudStatus = async () => {
    setSynced(true);
    let res = await getSaaSCloudStatus(providerName, memberId);
    if (res?.status === "OK") {
      setCloudStatus(res?.res);
      let isGroupsLoaded =
        res?.res?.isGroupLoaded === null ? true : res?.res?.isGroupLoaded;
      let isUsersLoaded =
        res?.res?.isUsersLoaded === null ? true : res?.res?.isUsersLoaded;
      let newOptions = [...options];
      newOptions?.map((data, index) => {
        if (data?.title === "User Management") {
          newOptions[index].isSynced = isUsersLoaded;
        }
        if (
          data?.title === "Group Management" ||
          data?.title === "Team Management" ||
          data?.title === "Channel Management"
        ) {
          newOptions[index].isSynced = isGroupsLoaded;
        }
      });
      setOptions(newOptions);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const getReports = async () => {
    notifyToast("success", "Started Generating Your Report");
    setIsVisible(false);
    let res = await downloadSaaSAppsReports(
      memberId,
      providerName,
      reportOptions?.duration,
      reportOptions?.type
    );
    if (res?.status === "OK") {
      setIsVisible(false);
      if (res?.res) downloadGlobalCSV(res?.res, providerName);
    } else {
      setIsVisible(false);
      notifyToast("error", "Failed To Generate Report");
    }
  };

  const moveToPage = (link, title) => {
    if (link === "#") {
      if (onlyGroupsRequired.includes(providerName)) {
        setReportOptions({
          type: "GROUPS",
          duration:
            providerName === "SENDGRID" ||
            providerName === "SHARE_FILE_BUSINESS"
              ? 30
              : 7,
          custom: false,
        });
      } else {
        setReportOptions({
          type: "TEAMS",
          duration: providerName === "SENDGRID" ? 30 : 7,
          custom: false,
        });
      }
      setIsVisible(true);
    } else {
      navigation(link);
      dispatch({
        type: SET_UPDATE_JOB_PARAMS,
        payload: title,
      });
    }
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav pageName="SaaS Management" backLink="/SaaSManagement" />
          <div
            className="cf_main_content_place_main"
            style={{ padding: "10px 0", gap: "15px" }}
          >
            <div className="cf_saas_cloudPlacer">
              {options?.map((data, index) => {
                return (
                  <div
                    key={data?.title}
                    className={`cf_new_dashboard_info_pannel cf_main_saas_selector ${
                      !data?.isSynced ? "PRE_MIG_LOADING" : ""
                    }`}
                    style={{
                      paddingLeft: "0",
                      paddingRight: "0",
                      position: "relative",
                      animationDelay: `${index * 0.1}s`,
                      background: `linear-gradient(145deg, ${data?.background}15, ${data?.background}30)`,
                    }}
                  >
                    <div style={{ padding: "0 1.5rem 0 1.5rem" }}>
                      <div
                        style={{ background: data?.background }}
                        className="cf_saas_menu_icon_div"
                      >
                        {data?.icon}
                      </div>
                      <div className="cf_saas_menu_title_container">
                        <p className="cf_saas_menu_title_container_head">
                          {data?.title}
                        </p>
                        <p
                          className="cf_new_dashboard_pannel_info"
                          style={{ marginTop: "2px" }}
                        >
                          {data?.summary}
                        </p>
                      </div>
                    </div>
                    <div
                      className="cf_saas_menu_link_container"
                      style={{
                        // padding: "1rem 1.5rem",
                        borderTop: `1px solid ${data?.background}20`,
                        background: "rgba(255, 255, 255, 0.5)",
                        backdropFilter: "blur(8px)",
                      }}
                    >
                      {data?.isSynced ? (
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                          onClick={() => {
                            moveToPage(data?.link, data?.title);
                          }}
                        >
                          <p> View Details </p>
                          <MoveRight
                            size="12px"
                            className="cf_newDashboard_OpenLink"
                          />
                        </div>
                      ) : (
                        <div
                          className="CF_d-flex ai-center"
                          style={{ width: "100%" }}
                        >
                          <p>Syncing In Progress ...</p>
                          <RotateCw
                            size={14}
                            className="CF_Pointer"
                            onClick={() => {
                              setIsPageLoading(true);
                              getCloudStatus();
                            }}
                            style={{ marginLeft: "auto" }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <Popup
        options={{
          isOpen: isVisible,
          title: `Download Report`,
          popupWidth: "40%",
          popupHeight:
            providerName === "SENDGRID" ||
            providerName === "JIRA" ||
            providerName === "SHARE_FILE_BUSINESS"
              ? "200px"
              : "300px",
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "0 10px",
            flexDirection: "column",
            gap: "40px",
            justifyContent: "center",
          }}
        >
          {providerName !== "SENDGRID" &&
          providerName !== "JIRA" &&
          providerName !== "SHARE_FILE_BUSINESS" ? (
            <div className="CF_Reports_Body_Div">
              <p>Generate Reports For :</p>
              <div className="CF_d-flex ai-center" style={{ gap: "40px" }}>
                {!onlyGroupsRequired.includes(providerName) ? (
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="nameTeams"
                      checked={reportOptions?.type === "TEAMS"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "TEAMS" })
                      }
                    />
                    <label htmlFor="nameTeams" style={{ fontWeight: "500" }}>
                      {providerName === "SLACK" ? `Channels` : `Teams`}
                    </label>
                  </div>
                ) : (
                  ""
                )}
                {!onlyTeamsRequired.includes(providerName) ? (
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="nameGroups"
                      checked={reportOptions?.type === "GROUPS"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "GROUPS" })
                      }
                    />
                    <label style={{ fontWeight: "500" }} htmlFor="nameGroups">
                      Groups
                    </label>
                  </div>
                ) : (
                  ""
                )}
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="teamsReport"
                    id="nameUsers"
                    checked={reportOptions?.type === "USERS"}
                    onChange={() =>
                      setReportOptions({ ...reportOptions, type: "USERS" })
                    }
                  />
                  <label style={{ fontWeight: "500" }} htmlFor="nameUsers">
                    Users
                  </label>
                </div>
              </div>
            </div>
          ) : (
            ""
          )}
          <div className="CF_Reports_Body_Div">
            <p>Select Duration :</p>
            {providerName === "SENDGRID" ||
            providerName === "SHARE_FILE_BUSINESS" ? (
              <div className="CF_d-flex ai-center" style={{ gap: "40px" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="durationReport"
                    id="30Days"
                    onChange={() =>
                      setReportOptions({
                        ...reportOptions,
                        duration: 30,
                        custom: false,
                      })
                    }
                    checked={reportOptions?.duration === 30}
                  />
                  <label htmlFor="30Days" style={{ fontWeight: "500" }}>
                    30 Days
                  </label>
                </div>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="durationReport"
                    id="60Days"
                    onChange={() =>
                      setReportOptions({
                        ...reportOptions,
                        duration: 60,
                        custom: false,
                      })
                    }
                    checked={reportOptions?.duration === 60}
                  />
                  <label style={{ fontWeight: "500" }} htmlFor="60Days">
                    60 Days
                  </label>
                </div>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="durationReport"
                    id="90Days"
                    onChange={() =>
                      setReportOptions({
                        ...reportOptions,
                        duration: 90,
                        custom: false,
                      })
                    }
                    checked={reportOptions?.duration === 90}
                  />
                  <label style={{ fontWeight: "500" }} htmlFor="90Days">
                    90 Days
                  </label>
                </div>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="durationReport"
                    id="custom"
                    onChange={() =>
                      setReportOptions({
                        ...reportOptions,
                        custom: true,
                        duration: 120,
                      })
                    }
                    checked={reportOptions?.custom}
                  />
                  <label style={{ fontWeight: "500" }} htmlFor="custom">
                    Custom
                  </label>
                </div>
                {reportOptions?.custom ? (
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <div className="CF_customDuration_div">
                      <div
                        className={
                          reportOptions?.duration < 150
                            ? "cf_cal_nextDate_disabled"
                            : ""
                        }
                        onClick={() => {
                          setReportOptions({
                            ...reportOptions,
                            duration: reportOptions?.duration - 30,
                          });
                        }}
                      >
                        -
                      </div>
                      <input
                        type="number"
                        value={reportOptions?.duration}
                        readOnly
                      />
                      <div
                        onClick={() => {
                          setReportOptions({
                            ...reportOptions,
                            duration: reportOptions?.duration + 30,
                          });
                        }}
                      >
                        +
                      </div>
                    </div>
                  </div>
                ) : (
                  ""
                )}
              </div>
            ) : (
              <div className="CF_d-flex ai-center" style={{ gap: "40px" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="durationReport"
                    id="7Days"
                    onChange={() =>
                      setReportOptions({ ...reportOptions, duration: 7 })
                    }
                    checked={reportOptions?.duration === 7}
                  />
                  <label htmlFor="7Days" style={{ fontWeight: "500" }}>
                    7 Days
                  </label>
                </div>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="durationReport"
                    id="30Days"
                    onChange={() =>
                      setReportOptions({ ...reportOptions, duration: 30 })
                    }
                    checked={reportOptions?.duration === 30}
                  />
                  <label style={{ fontWeight: "500" }} htmlFor="30Days">
                    30 Days
                  </label>
                </div>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <input
                    type="radio"
                    name="durationReport"
                    id="180Days"
                    onChange={() =>
                      setReportOptions({ ...reportOptions, duration: 180 })
                    }
                    checked={reportOptions?.duration === 180}
                  />
                  <label style={{ fontWeight: "500" }} htmlFor="180Days">
                    180 Days
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
        <div
          className="cf_popup_container_footer"
          style={{ borderTop: "1px solid #ddd" }}
        >
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="150px"
            isLoading={false}
            isDisabled={false}
            buttonName="Download Report"
            buttonClickAction={() => getReports()}
          />
        </div>
      </Popup>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default SaaSMenu;
