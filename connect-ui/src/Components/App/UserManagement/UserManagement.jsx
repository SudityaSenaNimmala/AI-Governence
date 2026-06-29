import React from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import {
  LayoutGrid,
  MoveRight,
  Network,
  UserRoundMinus,
  UserRoundPlus,
  Workflow,
} from "lucide-react";
import { Link } from "react-router-dom";
const UserManagement = () => {
  let menuList = [
    {
      icon: <Workflow color="#fff" />,
      link: `/Workflow/Template`,
      background: "#001a6f",
      title: `Manage Workflows`,
      summary: `Create and manage workflows to automate user onboarding and offboarding processes.`,
      isSynced: true,
    },
    {
      icon: <UserRoundPlus color="#fff" />,
      link: `/Workflow/OnBoard`,
      background: "#3b82f6",
      title: `User Onboarding`,
      summary: `Quickly onboard users to SaaS apps, assigning roles and configuring permissions.`,
      isSynced: true,
    },
    {
      icon: <UserRoundMinus color="#fff" />,
      link: `/Workflow/OffBoard`,
      background: "#f97316",
      title: `User offboarding`,
      summary: `Safely offboard users by revoking access and managing data and permissions.`,
      isSynced: true,
    },
    // {
    //   icon: <Network color="#fff" />,
    //   link: `/UserManagement/WorkFlow`,
    //   background: "#22c55e",
    //   title: `Manage Onboarding Workflows`,
    //   summary: `Create and manage onboarding workflows to automate user onboarding processes.`,
    //   isSynced: true,
    // },
  ];
  return (
    <div className="cf_main_container">
      <SideNav activeTab="Workflow" />
      <div className="cf_main_content_place">
        <TopNav pageName="Workflow" />
        <div
          className="cf_main_content_place_main"
          style={{ padding: "10px 0", gap: "15px" }}
        >
          <div className="cf_saas_cloudPlacer">
            {menuList?.map((data, index) => {
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
                  <div className="cf_saas_menu_link_container">
                    <Link to={`${data?.link}`}>
                      Start{" "}
                      <MoveRight
                        size="12px"
                        className="cf_newDashboard_OpenLink"
                      />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
