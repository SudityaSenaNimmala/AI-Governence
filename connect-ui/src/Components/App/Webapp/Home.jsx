import { Mails, MessageSquare, MoveRight, Users, Users2 } from "lucide-react";
import { cloudImageMapper } from "../../helpers/helpers";
import TopNav from "../../Resuables/Nav/TopNav";
import "./CSS/WebApp.css";
import { useState } from "react";
import { Link } from "react-router-dom";

const Home = () => {
  const [migrationMenuList] = useState([
    {
      icon: <Users color="#fff" />,
      title: "Content Migration",
      background: "#3b82f6",
      description: "Initiate Migration Between Two Business Clouds",
      link: "/Migrations",
    },
    {
      icon: <MessageSquare color="#fff" />,
      title: "Chat Migration",
      background: "#f97316",
      description: "Initiate Migration Between Two Collaboration Clouds",
      link: "/Migrations",
    },
    {
      icon: <Mails color="#fff" />,
      title: "Email Migration",
      background: "#10b981",
      description: "Initiate Migration Between Two Email Providers",
      link: "/Migrations",
    },
  ]);
  const [manageMenuList] = useState([
    {
      icon: <Users color="#fff" />,
      title: "SaaS Management Platform",
      background: "#0129ac",
      description:
        "Manage your SaaS Applications, Users, Shadow IT and Licenses",
      link: "/MultiUserMigration",
      isNew: true,
    },
    // {
    //   icon: <MessageSquare color="#fff" />,
    //   title: "User Onboarding & Offboarding",
    //   background: "#f97316",
    //   description: "Manage your Users Across Multiple SaaS Applications",
    //   link: "/MultiUserMigration",
    // },
    // {
    //   icon: <Mails color="#fff" />,
    //   title: "Shadow IT",
    //   background: "#10b981",
    //   description: "Manage your Shadow IT",
    //   link: "/MultiUserMigration",
    // },
    // {
    //   icon: <Mails color="#fff" />,
    //   title: "License Management",
    //   background: "#10b981",
    //   description: "Manage your Shadow IT",
    //   link: "/MultiUserMigration",
    // },
  ]);

  return (
    <div className="cf_main_container" style={{ width: "100%" }}>
      <div className="cf_main_content_place" style={{ width: "100%" }}>
        <TopNav pageName="Home" isWebapp={true} />
        <div
          className="cf_main_content_place_main CF_d-flex"
          style={{ padding: "5px 0", flexDirection: "column", gap: "0px" }}
        >
          <div
            className="CF_d-flex ai-center CF_WebApp_Header"
            style={{ gap: "10px" }}
          >
            <img
              src={cloudImageMapper("MIGRATION")}
              alt="CloudFuze"
              style={{
                width: "50px",
              }}
            />
            <h2>Migration</h2>
          </div>
          <div className="cf_saas_cloudPlacer" style={{ marginTop: "0" }}>
            {migrationMenuList.map((data, index) => {
              return (
                <div
                  key={data?.title}
                  className={`cf_new_dashboard_info_pannel cf_main_saas_selector`}
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
                        {data?.description}
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
          <div
            className="CF_d-flex ai-center CF_WebApp_Header"
            style={{ gap: "10px" }}
          >
            <img
              src={cloudImageMapper("MIGRATION")}
              alt="CloudFuze"
              style={{
                width: "50px",
              }}
            />
            <h2>Manage</h2>
          </div>
          <div className="cf_saas_cloudPlacer" style={{ marginTop: "0" }}>
            {manageMenuList.map((data, index) => {
              return (
                <div
                  key={data?.title}
                  className={`cf_new_dashboard_info_pannel cf_main_saas_selector`}
                  style={{
                    paddingLeft: "0",
                    paddingRight: "0",
                    position: "relative",
                    animationDelay: `${index * 0.1}s`,
                  }}
                >
                  <div
                    style={{
                      padding: "0 1.5rem 0 1.5rem",
                      position: "relative",
                    }}
                  >
                    {data?.isNew && (
                      <div className="cf_new_dashboard_info_pannel_new skeletonDataNewBG">
                        New
                      </div>
                    )}
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
                        {data?.description}
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

export default Home;
