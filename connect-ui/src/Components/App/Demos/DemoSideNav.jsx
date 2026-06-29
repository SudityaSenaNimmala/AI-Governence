import {
  AppWindow,
  CloudCog,
  FileChartColumn,
  LayoutDashboard,
  Rocket,
  Settings,
  Unplug,
  UserCog,
  Workflow,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import CF_LOGO_WHITE from "../../../assets/images/CF_LOGO_WHITE.png";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";

const DemoSideNav = (props) => {
  const { dispatch, globalContext } = useContext(GlobalContext);
  const [subMenu, setSubMenu] = useState("");
  const [menuList, setMenuList] = useState([]);
  const sideNavRef = useRef();
  const reportsRef = useRef();
  const integrationsRef = useRef();
  const nullRef = useRef();
  let menuJson = [
    {
      icon: <LayoutDashboard />,
      title: "Dashboard",
      link: "/Dashboard",
    },
    {
      icon: <Unplug />,
      title: "Integrations",
      link: "/Integrations/Add",
    },
    {
      icon: <AppWindow />,
      title: "Applications",
      link: "/Demo",
    },
    {
      icon: <Workflow />,
      title: "Workflow",
      link: "/Workflow",
    },
    {
      icon: <Rocket />,
      title: "Migrations",
      link: "/Migrations",
    },
    {
      icon: <FileChartColumn />,
      title: "Reports",
      link: "#",
    },
    {
      icon: <Settings />,
      title: "Settings",
      link: "/Settings",
    },
  ];
  const reportsSubMenu = [
    {
      title: "Collaborations Reports",
      link: "/Reports/Collaborations#S2T",
      isDiabled: false,
    },
    {
      title: "Content Reports",
      link: "/Reports/Content",
      isDiabled: true,
    },
    {
      title: "Email Reports",
      link: "/Reports/Email",
      isDiabled: true,
    },
    {
      title: "White Board Reports",
      link: "/Reports/WhiteBoard",
      isDiabled: true,
    },
  ];

  const integrationSubMenu = [
    {
      title: "Add Clouds",
      link: "/Integrations/Add",
    },
    {
      title: "Manage Clouds",
      link: "/Integrations/Manage",
    },
  ];

  useEffect(() => {
    if (subMenu === "Reports") {
      setMenuList(reportsSubMenu);
    } else if (subMenu === "Integrations") {
      if (localStorage?.globalState) {
        const userRoles = JSON.parse(localStorage?.globalState)?.user?.roles;
        const isStandardUser = userRoles?.[0]?.name === "StandardUser";
        if (isStandardUser) {
          setMenuList([
            {
              title: "Manage Clouds",
              link: "/Integrations/Manage",
            },
          ]);
        } else {
          setMenuList(integrationSubMenu);
        }
      } else {
        setMenuList(integrationSubMenu);
      }
    }
  }, [subMenu]);

  const handleClickOutside = (event) => {
    if (
      sideNavRef.current &&
      !sideNavRef.current.contains(event.target) &&
      !reportsRef.current.contains(event.target) &&
      !integrationsRef.current.contains(event.target)
    ) {
      setSubMenu("");
    }
  };

  useEffect(() => {
    if (subMenu) {
      document.addEventListener("click", handleClickOutside);
    } else {
      document.removeEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [subMenu]);

  return (
    <div className="cf_sideNav_div">
      <nav>
        <div className="cf_sideNav_logo_placer">
          <img src={CF_LOGO_WHITE} alt="CloudFuze Logo" />
        </div>
        <ul>
          {menuJson?.map((data) => {
            return (localStorage?.globalState
              ? JSON.parse(localStorage?.globalState)?.user?.roles
                ? JSON.parse(localStorage?.globalState)?.user?.roles[0]
                    ?.name === "StandardUser"
                : false
              : false) &&
              (data?.title === "Migrations" || data?.title === "Settings") ? (
              ""
            ) : (
              <li
                ref={
                  data?.title === "Reports"
                    ? reportsRef
                    : data?.title === "Integrations"
                    ? integrationsRef
                    : nullRef
                }
                key={data?.title}
                className={
                  data?.title === (props?.activeTab ?? "Dashboard")
                    ? "activeSideNav"
                    : data?.title === subMenu || data?.title === subMenu
                    ? "activeSideNav"
                    : ""
                }
                onClick={() => {
                  data?.title === "Reports"
                    ? setSubMenu(subMenu === data?.title ? "" : data?.title)
                    : setSubMenu("");
                }}
              >
                <Link to={data?.link}>
                  {data?.icon}
                  {data?.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div
        className={`cf_reports_subMenu ${subMenu ? "" : "cf_d-none"}`}
        ref={sideNavRef}
      >
        <ul>
          {menuList?.map((data) => {
            return (
              <li
                key={data?.title}
                className={
                  data?.isDiabled
                    ? "cf_disabled"
                    : props?.subMenuActive === data?.title
                    ? "activeSideNav"
                    : ""
                }
                onClick={() => setSubMenu("")}
              >
                <Link to={!data?.isDiabled ? data?.link : "#"}>
                  {data?.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default DemoSideNav;
