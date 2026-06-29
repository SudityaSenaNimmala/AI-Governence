import {
  ChevronDown,
  ChevronLeft,
  CircleCheck,
  LogOut,
  PanelLeftOpen,
  User,
} from "lucide-react";
import React, { useContext, useEffect, useRef, useState } from "react";
import { FaCaretDown } from "react-icons/fa6";
import { Link, useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import {
  RESET_APP_CONTEXT,
  RESET_SAAS_DATA,
  SET_SAAS_CLOUD,
  SET_SIDEBAR_COLLAPSED,
} from "../../../GlobalContext/action.types";
import { cloudImageMapper } from "../../helpers/helpers";
import {
  customAppMenu,
  getMaxChar,
  globalDebounce,
  isSessionValid,
  makeFirstLetterCapital,
  notifyToast,
  onlyGroupsRequired,
  onlyTeamsRequired,
} from "../../helpers/utils";
import NavTabSwitcher from "./NavTabSwitcher/NavTabSwitcher";
import RenewalCalendar from "./RenewalCalendar";
import Notifications from "./Notifications";
import AgentSearch from "../../App/Agent/AgentSearch/AgentSearch";

const TopNav = (props) => {
  const navigation = useNavigate();
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [isMessageMenuVisible, setIsMessageMenuVisible] = useState(false);
  const { adminEmail, memberId, providerName, externalProviderName, phoneNumber } = {
    ...globalContext?.saasCloud,
  };
  const { jobParams } = {
    ...globalContext,
  };
  const [hash, setHash] = useState("");

  const appsExcludeList = {
    "Connected Apps": customAppMenu?.noResourcesApps,
    "Group Management": customAppMenu?.noTeamsGroupsApps,
    "Channel Management": customAppMenu?.noTeamsGroupsApps,
    "Team Management": customAppMenu?.noTeamsGroupsApps,
    "User Management": customAppMenu?.noUserManagementApps,
    "License Management": customAppMenu?.noLicenseApps,
    "Shadow IT": customAppMenu?.shadowItApps,
    Assessments: customAppMenu?.assesmentsApps,
    Interviews: customAppMenu?.interviewApps,
  };

  const saasSelectList = [
    "/CloudFuze/SaaSManagement/Menu",
    "/CloudFuze/SaaS/ConnectedApps/New",
    "/CloudFuze/SaaS/ConnectedApps/List/New",
    "/CloudFuze/SaaS/License",
    "/CloudFuze/SaaS/UserManagement",
    "/CloudFuze/SaaS/TeamsGroups",
    "/CloudFuze/SaaS/TeamsGroups/Groups/List",
    "/CloudFuze/SaaS/TeamsGroups/Teams/List",
    "/CloudFuze/SaaS/TeamsGroups/Channels/List",
    "/CloudFuze/SaaS/Domains",
    "/CloudFuze/SaaS/ShadowIT",
    "/CloudFuze/SaaS/Assessments",
    "/CloudFuze/Applications/Insights",
  ];

  const getNavName = () => {
    const inputString = globalContext?.user?.name ?? "";
    const words = inputString.split(" ");
    const firstLetters = words.map((word) => word.charAt(0));
    const name = firstLetters.join("");
    return name;
  };

  const userLogout = () => {
    dispatch({
      type: RESET_APP_CONTEXT,
      payload: "",
    });
    localStorage.removeItem("time");
    window.removeEventListener("mousemove", handleMouseMove);
    notifyToast("success", "User Logged out successfully...");
    setTimeout(() => {
      localStorage.clear();
      navigation("/#login");
    }, 1000);
  };

  const handleMouseMove = globalDebounce(() => {
    let time = 0;
    if (isSessionValid()) {
      time = new Date().getTime();
      localStorage.setItem("time", time);
    } else {
      if (localStorage.time) {
        localStorage.removeItem("time");
        notifyToast("warn", "Session expired. Please login again.");
      }
      setTimeout(() => {
        localStorage.clear();
        window.location.href = "/CloudFuze#login";
      }, 700);
      window.removeEventListener("mousemove", handleMouseMove);
    }
  }, 200);

  addEventListener("mousemove", handleMouseMove);

  const messageLinks = [
    {
      name: "SLACK TO MICROSOFT TEAMS MIGRATION",
      code: "S2T",
    },
    {
      name: "SLACK TO GOOGLE CHAT MIGRATION",
      code: "S2C",
    },
    {
      name: "SLACK TO SLACK MIGRATION",
      code: "S2S",
    },
    {
      name: "MICROSOFT TEAMS TO GOOGLE CHAT MIGRATION",
      code: "T2C",
    },
    {
      name: "MICROSOFT TEAMS TO MICROSOFT TEAMS MIGRATION",
      code: "T2T",
    },
    {
      name: "GOOGLE CHAT TO MICROSOFT TEAMS MIGRATION",
      code: "C2T",
    },
    {
      name: "GOOGLE CHAT TO GOOGLE CHAT MIGRATION",
      code: "C2C",
    },
    {
      name: "FACEBOOK WORKSPACE TO GOOGLE CHAT MIGRATION",
      code: "W2C",
    },
    {
      name: "FACEBOOK WORKSPACE TO VIVA ENGAGE MIGRATION",
      code: "W2V",
    },
  ];

  const hashMapLinks = {
    S2T: "SLACK TO MICROSOFT TEAMS MIGRATION",
    S2C: "SLACK TO GOOGLE CHAT MIGRATION",
    S2S: "SLACK TO SLACK MIGRATION",
    T2C: "MICROSOFT TEAMS TO GOOGLE CHAT MIGRATION",
    C2T: "GOOGLE CHAT TO MICROSOFT TEAMS MIGRATION",
    T2T: "MICROSOFT TEAMS TO MICROSOFT TEAMS MIGRATION",
    C2C: "GOOGLE CHAT TO GOOGLE CHAT MIGRATION",
    W2C: "FACEBOOK WORKSPACE TO GOOGLE CHAT MIGRATION",
    W2V: "FACEBOOK WORKSPACE TO VIVA ENGAGE MIGRATION",
  };

  useEffect(() => {
    setHash(window.location.hash.replace("#", ""));
  }, [window.location.hash]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setIsUserMenuOpen(false);
      }
    };
    if (isUserMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isUserMenuOpen]);

  const setNewAppData = (data) => {
    let billingInfo = globalContext?.billingSummary?.userFinancialMetrics?.find(
      (item) =>
        item?.memberId === data?.memberId &&
        item?.vendorName === data?.providerName
    );
    if (billingInfo) {
      data.billingInfo = billingInfo;
    }
    dispatch({ type: SET_SAAS_CLOUD, payload: data });
    dispatch({
      type: RESET_SAAS_DATA,
      payload: "",
    });
  };

  const renderMenuList = (data, index) => {
    return (
      <div
        key={index}
        className={`cf_saas_selector_menu_item ${memberId === data?.memberId && providerName === data?.providerName
          ? "cf_active_saas"
          : ""
          }`}
        onClick={() => {
          setNewAppData(data);
        }}
      >
        <div className="cf_saas_selector_img_div">
          <img
            src={data?.externalProviderName && data?.phoneNumber ? `https://cloudfuzehost.com/globalasserts/${data?.phoneNumber}` : cloudImageMapper(
              data?.providerName,
              data?.externalProviderName
            )}
            alt={
              data?.providerName === "OTHERS"
                ? data?.externalProviderName
                : data?.providerName
            }
            className="cf_topNav_userProfile_img"
          />
        </div>
        <span title={data?.adminEmail}>{getMaxChar(data?.adminEmail, 24)}</span>
      </div>
    );
  };

  const sidebarCollapsed = globalContext?.sidebarCollapsed ?? false;

  return (
    <div className="cf_topNav_div">
      {sidebarCollapsed && (
        <button
          className="cf_topNav_sidebar_toggle"
          onClick={() => dispatch({ type: SET_SIDEBAR_COLLAPSED, payload: false })}
          title="Expand sidebar"
        >
          <PanelLeftOpen size={18} />
        </button>
      )}
      {props?.backLink && props?.reportsCustomToggler ? (
        <button
          className="cf_topNav_goBack_div"
          onClick={() => props?.reportsCustomToggler("")}
        >
          <ChevronLeft strokeWidth={1.5} size={20} />
        </button>
      ) : props?.backLink ? (
        <button
          className="cf_topNav_goBack_div"
          onClick={() => navigation(props?.backLink)}
        >
          <ChevronLeft strokeWidth={1.5} size={20} />
        </button>
      ) : (
        ""
      )}
      {props?.pageName === "Manage Applications" ||
        props?.pageName === "Add Applications" ? (
        <NavTabSwitcher activeTab={props?.pageName} />
      ) : props?.pageName === "Collaborations Reports" ? (
        <div className="cf_topNav_MessageLinks_Container">
          <p
            className="cf_topNav_MessageLinks"
            onMouseEnter={() => setIsMessageMenuVisible(true)}
          >
            {hashMapLinks[hash]}
          </p>
          <ChevronDown size={20} strokeWidth={2} />
          {isMessageMenuVisible ? (
            <div
              className="cf_topNav_MessageLinks_List_Container"
              onMouseLeave={() => setIsMessageMenuVisible(false)}
            >
              {messageLinks?.map((data) => {
                return (
                  <Link
                    to={`#${data?.code}`}
                    key={data?.code}
                    onClick={() => setIsMessageMenuVisible(false)}
                  >
                    {data?.code === hash ? (
                      <CircleCheck size={14} fill="green" color="#fff" />
                    ) : (
                      <CircleCheck
                        size={14}
                        fill="green"
                        color="#fff"
                        style={{ visibility: "hidden" }}
                      />
                    )}
                    <p>{data?.name}</p>
                  </Link>
                );
              })}
            </div>
          ) : (
            ""
          )}
        </div>
      ) : (
        <div className="cf_topNav_title">
          {props?.pageName
            ? props?.pageName?.includes("AI")
              ? props?.pageName
              : makeFirstLetterCapital(props?.pageName)
            : `Dashboard`}
        </div>
      )}
      {/* <AgentSearch /> */}
      <div className="cf_ml_auto"></div>
      {providerName && saasSelectList.includes(window.location.pathname) ? (
        <div className="cf_saas_selector_container">
          <div className="cf_saas_selector">
            <div className="cf_saas_selector_img_div">
              <img
                src={externalProviderName && phoneNumber ? `https://cloudfuzehost.com/globalasserts/${phoneNumber}` : cloudImageMapper(providerName, externalProviderName)}
                alt={
                  providerName === "OTHERS"
                    ? externalProviderName
                    : providerName
                }
                className="cf_topNav_userProfile_img"
              />
            </div>
            <span title={adminEmail}>{getMaxChar(adminEmail, 22)}</span>
            <FaCaretDown style={{ marginLeft: "auto" }} />
          </div>
          <div className={`cf_saas_selector_menu`}>
            {globalContext?.cloudsList
              ?.filter((data) =>
                data?.providerName === "OTHERS"
                  ? data?.externalProviderName === externalProviderName
                  : data?.providerName === providerName
              )
              ?.map((data, index) => {
                return data?.providerName
                  ? window.location.pathname.includes(
                    "/CloudFuze/SaaS/TeamsGroups/Groups/List"
                  )
                    ? onlyGroupsRequired.includes(data?.providerName)
                      ? renderMenuList(data, index)
                      : ""
                    : window.location.pathname.includes(
                      "/CloudFuze/SaaS/TeamsGroups/Teams/List"
                    )
                      ? onlyTeamsRequired.includes(data?.providerName)
                        ? renderMenuList(data, index)
                        : ""
                      : window.location.pathname.includes(
                        "/CloudFuze/SaaS/Assessments"
                      )
                        ? appsExcludeList[jobParams]?.includes(data?.providerName)
                          ? renderMenuList(data, index)
                          : ""
                        : data?.providerName &&
                          !appsExcludeList[jobParams]?.includes(data?.providerName)
                          ? renderMenuList(data, index)
                          : ""
                  : "";
              })}
          </div>
        </div>
      ) : (
        ""
      )}
      {props?.isWebapp ? (
        ""
      ) : (
        <>
          <RenewalCalendar />
          <Notifications />
        </>
      )}
      <div
        ref={userMenuRef}
        className="cf_topNav_userMenu_wrap CF_d-flex ai-center"
      >
        <button
          type="button"
          className={`cf_topNav_userProfile ${isUserMenuOpen ? "cf_topNav_userProfile_active" : ""}`}
          onMouseEnter={() => setIsUserMenuOpen(true)}
          onClick={() => setIsUserMenuOpen((open) => !open)}
          aria-expanded={isUserMenuOpen}
          aria-haspopup="true"
        >
          {getNavName()}
        </button>
        {isUserMenuOpen && (
          <div className="cf_top_nav_userMenu">
            <div>
              <Link to="/MyAccount" onClick={() => setIsUserMenuOpen(false)}>
                <User size="16px" />
                <span>My Account</span>
              </Link>
            </div>
            <div
              style={{ cursor: "pointer" }}
              className="cf_logout_div"
              onClick={() => {
                setIsUserMenuOpen(false);
                userLogout();
              }}
            >
              <LogOut size="16px" />
              <span>Logout</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TopNav;
