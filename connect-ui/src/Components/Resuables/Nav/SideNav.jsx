import {
  AppWindow,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Database,
  Gem,
  LayoutDashboard,
  Mail,
  MessageCircle,
  MonitorCheck,
  PanelLeftClose,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Unplug,
  Workflow,
  Grip
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import CF_LOGO from "../../../assets/images/CF_LOGO_WHITE.png";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { SET_SIDEBAR_COLLAPSED } from "../../../GlobalContext/action.types";
import "./css/Nav.css";

const SideNav = (props) => {
  const { dispatch, globalContext } = useContext(GlobalContext);
  const { user } = globalContext;
  const { hasContentSprawl } = user;
  const [expandedMenus, setExpandedMenus] = useState({});
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const collapsed = globalContext?.sidebarCollapsed ?? false;
  const { pathname } = useLocation();

  const getActiveProduct = () => {
    if (pathname.startsWith("/Migrations/Content")) return "Content Migration";
    if (pathname.startsWith("/Migrations/Collaborations")) return "Message Migration";
    if (pathname.startsWith("/Migrations/Email")) return "Email Migration";
    return "Manage";
  };
  const activeProduct = getActiveProduct();
  const sideNavRef = useRef();
  const productDropdownRef = useRef();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target)) {
        setIsProductDropdownOpen(false);
      }
    };
    if (isProductDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isProductDropdownOpen]);

  const isStandardUser = (() => {
    if (!localStorage?.globalState) return false;
    const userRoles = JSON.parse(localStorage.globalState)?.user?.roles;
    return userRoles?.[0]?.name === "StandardUser";
  })();

  const agentGovernanceIcon = (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" color="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M13.8758 0.282251L14.2241 1.35305C14.3324 1.67859 14.5152 1.97441 14.7579 2.21699C15.0007 2.45957 15.2967 2.64223 15.6225 2.75044L16.6941 3.09845L16.7156 3.10381C16.7982 3.13292 16.8697 3.18692 16.9203 3.25836C16.9709 3.3298 16.998 3.41516 16.998 3.50268C16.998 3.5902 16.9709 3.67556 16.9203 3.747C16.8697 3.81844 16.7982 3.87244 16.7156 3.90155L15.644 4.24956C15.3182 4.35778 15.0221 4.54044 14.7794 4.78302C14.5366 5.0256 14.3538 5.32141 14.2455 5.64696L13.8972 6.71775C13.8681 6.80029 13.814 6.87175 13.7426 6.92231C13.6711 6.97286 13.5856 7.00001 13.498 7.00001C13.4105 7.00001 13.325 6.97286 13.2535 6.92231C13.2465 6.91732 13.2396 6.91213 13.2329 6.90675C13.1716 6.85755 13.1251 6.79215 13.0989 6.71775L12.7506 5.64696C12.7319 5.59014 12.7109 5.53422 12.6877 5.47932C12.5777 5.21872 12.4183 4.98116 12.2177 4.77999C12.1796 4.74173 12.1401 4.70496 12.0994 4.66973C11.8811 4.48064 11.6272 4.33588 11.3521 4.24421L10.2805 3.8962C10.1979 3.86708 10.1264 3.81308 10.0758 3.74164C10.0252 3.6702 9.99805 3.58484 9.99805 3.49733C9.99805 3.40981 10.0252 3.32445 10.0758 3.25301C10.1264 3.18157 10.1979 3.12757 10.2805 3.09845L11.3521 2.75044C11.674 2.63941 11.9657 2.45549 12.2046 2.21307C12.4435 1.97065 12.623 1.67631 12.7292 1.35305L13.0774 0.282251C13.1066 0.19972 13.1606 0.128252 13.2321 0.0776997C13.3036 0.0271473 13.389 0 13.4766 0C13.5642 0 13.6496 0.0271473 13.7211 0.0776997C13.7926 0.128252 13.8467 0.19972 13.8758 0.282251ZM18.781 8.21319L18.0155 7.96461C17.7828 7.88731 17.5714 7.75684 17.398 7.58357C17.2246 7.4103 17.094 7.199 17.0166 6.96647L16.7679 6.20161C16.7471 6.14266 16.7085 6.09161 16.6574 6.05551C16.6063 6.0194 16.5453 6.00001 16.4827 6.00001C16.4202 6.00001 16.3592 6.0194 16.3081 6.05551C16.257 6.09161 16.2184 6.14266 16.1976 6.20161L15.9488 6.96647C15.873 7.19737 15.7448 7.40762 15.5742 7.58077C15.4035 7.75392 15.1951 7.8853 14.9653 7.96461L14.1998 8.21319C14.1408 8.23398 14.0897 8.27255 14.0536 8.32358C14.0175 8.37461 13.998 8.43558 13.998 8.4981C13.998 8.56061 14.0175 8.62158 14.0536 8.67261C14.0897 8.72364 14.1408 8.76221 14.1998 8.78301L14.9653 9.03158C15.1984 9.10926 15.4101 9.24032 15.5835 9.41428C15.757 9.58824 15.8873 9.80031 15.9642 10.0335L16.2129 10.7984C16.2337 10.8574 16.2723 10.9084 16.3234 10.9445C16.3745 10.9806 16.4355 11 16.498 11C16.5606 11 16.6216 10.9806 16.6727 10.9445C16.7238 10.9084 16.7624 10.8574 16.7832 10.7984L17.0319 10.0335C17.1093 9.80101 17.2399 9.58972 17.4133 9.41645C17.5867 9.24317 17.7981 9.11271 18.0308 9.03541L18.7963 8.78683C18.8553 8.76603 18.9064 8.72746 18.9425 8.67643C18.9786 8.62541 18.998 8.56443 18.998 8.50192C18.998 8.43941 18.9786 8.37844 18.9425 8.32741C18.9064 8.27638 18.8553 8.23781 18.7963 8.21701L18.781 8.21319ZM16.4998 12C16.2758 11.9992 16.0588 11.9433 15.866 11.838L13.6073 15.7506C13.5179 15.9053 13.3529 16.0006 13.1742 16.0006H6.82376C6.64512 16.0006 6.48005 15.9053 6.39073 15.7506L3.21541 10.2503C3.12611 10.0956 3.12611 9.90503 3.21541 9.75034L6.39073 4.25002C6.48005 4.09531 6.64512 4 6.82376 4H9.08895C9.02902 3.84162 8.99805 3.67231 8.99805 3.49611C8.99805 3.32279 9.02801 3.15614 9.08603 3H6.82376C6.28784 3 5.79263 3.28592 5.52469 3.75005L2.34937 9.25037C2.08146 9.71445 2.08146 10.2862 2.34937 10.7503L5.52469 16.2506C5.79263 16.7147 6.28784 17.0006 6.82376 17.0006H13.1742C13.7102 17.0006 14.2054 16.7147 14.4733 16.2506L16.9663 11.9322C16.8187 11.9813 16.6611 11.9996 16.4998 12Z" fill="#fff" stroke="2"></path></svg>
  );

  const menuJson = [
    {
      icon: <LayoutDashboard size={18} />,
      title: "Dashboard",
      link: "/Dashboard",
    },
    {
      icon: <Unplug size={18} />,
      title: "Integrations",
      link: "/Integrations/Add",
    },
    {
      icon: <Boxes size={18} />,
      title: "SaaS Hub",
      link: "#",
      children: [
        {
          icon: <AppWindow size={16} />,
          title: "Applications",
          link: "/Applications",
        },
        {
          icon: <Workflow size={16} />,
          title: "WorkFlows",
          link: "/Workflow/Template#WorkFlows",
        },
        {
          icon: <MonitorCheck size={16} />,
          title: "Browser Activity",
          link: "/BrowserActivity",
        },
      ],
    },
    {
      icon: <Bot size={18} />,
      title: "AI Hub",
      link: "#",
      children: [
        { icon: <LayoutDashboard size={16} />, title: "Overview", link: "/AIHub/Overview" },
        { icon: <MonitorCheck size={16} />, title: "Machines", link: "/AIHub/Machines" },
        { icon: <AppWindow size={16} />, title: "Tools Catalog", link: "/AIHub/Tools" },
        { icon: <ShieldCheck size={16} />, title: "Agents & MCP", link: "/AIHub/Agents" },
        { icon: <Database size={16} />, title: "Server Agents", link: "/AIHub/ServerAgents" },
        { icon: <Sparkles size={16} />, title: "AI Activity", link: "/AIHub/DLP" },
        { icon: <Grip size={16} />, title: "AI Platforms", link: "/AIHub/Platforms" },
        { icon: agentGovernanceIcon, title: "Agent Governance", link: "/AIHub/AgentGovernance" },
      ],
    },
    ...(hasContentSprawl
      ? [
        {
          icon: <ShieldCheck size={18} />,
          title: "Data Hub",
          link: "/Data",
          children: [
            { icon: <Database size={16} />, title: "Content Sprawl", link: "/DataSprawl" },
            { icon: <MessageCircle size={16} />, title: "Message Sprawl", link: "/MessageSprawl" },
            { icon: <Mail size={16} />, title: "Email Sprawl", link: "/EmailSprawl" },
          ],
        },
      ]
      : []),
    // {
    //   icon: <Rocket size={18} />,
    //   title: "Migrate",
    //   link: "/Migrate",
    //   children: [
    //     { icon: <Database size={16} />, title: "Content Migration", link: "/Migrations/Content" },
    //     { icon: <MessageCircle size={16} />, title: "Message Migration", link: "/Migrations/Collaborations" },
    //     { icon: <Mail size={16} />, title: "Email Migration", link: "/Migrations/Email" },
    //   ],
    // },
  ];

  const toggleExpand = (title) => {
    setExpandedMenus((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const isChildActive = (child) =>
    child.title === props?.subMenuActive || child.title === props?.activeTab;

  const hasActiveChild = (item) =>
    Array.isArray(item.children) && item.children.some(isChildActive);

  const isActive = (menuTitle) =>
    menuTitle === (props?.activeTab ?? "Dashboard");

  return (
    <div className={`cf_sideNav_div ${collapsed ? "cf_sideNav_collapsed" : ""}`} ref={sideNavRef}>
      <nav>
        <div className="cf_sideNav_logo_placer" ref={productDropdownRef}>
          <img src={CF_LOGO} alt="CloudFuze Logo" />
          {!collapsed && (
            <>
              <span className="cf_sideNav_brand_name">CloudFuze</span>

              {/* <button
                className="cf_sideNav_toggle"
                onClick={() => setIsProductDropdownOpen((prev) => !prev)}
                title="Switch product"
                style={{ marginLeft: "auto" }}
              >
                <Grip size={16} />
              </button> */}
              <button
                className="cf_sideNav_toggle"
                onClick={() => dispatch({ type: SET_SIDEBAR_COLLAPSED, payload: true })}
                title="Collapse sidebar"
                style={{ marginLeft: "auto" }}
              >
                <PanelLeftClose size={16} />
              </button>
            </>
          )}
          {isProductDropdownOpen && (
            <div className="cf_product_switcher_dropdown">
              <p className="cf_product_switcher_heading">Switch to</p>
              <div className="cf_product_switcher_grid">
                {[
                  { icon: <AppWindow size={22} />, label: "Manage", link: "/Applications" },
                  { icon: <Database size={22} />, label: "Content Migration", link: "/Migrations/Content" },
                  { icon: <MessageCircle size={22} />, label: "Message Migration", link: "http://127.0.0.1:5500/pages/messageMigration.html", externalLink: true },
                  { icon: <Mail size={22} />, label: "Email Migration", link: "/Migrations/Email" },
                ].map((product) => {
                  const tileClass = `cf_product_switcher_tile ${activeProduct === product.label ? "cf_product_switcher_tile_active" : ""}`;
                  const tileContent = (
                    <>
                      <span className="cf_product_switcher_icon">{product.icon}</span>
                      <span className="cf_product_switcher_label">{product.label}</span>
                    </>
                  );
                  return product.externalLink ? (
                    <a
                      key={product.label}
                      href={product.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={tileClass}
                      onClick={() => setIsProductDropdownOpen(false)}
                    >
                      {tileContent}
                    </a>
                  ) : (
                    <Link
                      key={product.label}
                      to={product.link}
                      className={tileClass}
                      onClick={() => setIsProductDropdownOpen(false)}
                    >
                      {tileContent}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <ul className="cf_sideNav_menu">
          {menuJson.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const childActive = hasActiveChild(item);
            const isExpanded = expandedMenus[item.title] ?? childActive;
            const active = isActive(item.title) || childActive;

            return (
              <li key={item.title} className="cf_sideNav_item">
                {hasChildren ? (
                  <>
                    <div
                      className={`cf_sideNav_link ${active ? "cf_sideNav_active" : ""}`}
                      onClick={() => {
                        toggleExpand(item.title)
                        dispatch({ type: SET_SIDEBAR_COLLAPSED, payload: false })
                      }}
                      title={item.title}
                    >
                      <span className="cf_sideNav_icon">{item.icon}</span>
                      <span className="cf_sideNav_label">{item.title}</span>
                      <span className="cf_sideNav_chevron">
                        {isExpanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                      </span>
                    </div>
                    {isExpanded && (
                      <ul className="cf_sideNav_submenu">
                        {item.children.map((child) => (
                          <li key={child.title} className="cf_sideNav_subitem">
                            <Link
                              to={child.link}
                              className={`cf_sideNav_sublink ${isChildActive(child)
                                ? "cf_sideNav_active"
                                : ""
                                }`}
                              title={child.title}
                            >
                              {child.icon && (
                                <span className="cf_sideNav_icon">{child.icon}</span>
                              )}
                              <span className="cf_sideNav_sublabel">
                                {child.title}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <Link
                    to={item.link}
                    className={`cf_sideNav_link ${active ? "cf_sideNav_active" : ""}`}
                    title={item.title}
                  >
                    <span className="cf_sideNav_icon">{item.icon}</span>
                    <span className="cf_sideNav_label">{item.title}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        <div className="cf_sideNav_footer">
          {!isStandardUser && (
            <Link
              to="/Settings"
              className={`cf_sideNav_link cf_sideNav_help_link ${isActive("Settings") ? "cf_sideNav_active" : ""}`}
              title="Settings"
            >
              <span className="cf_sideNav_icon">
                <Settings size={18} />
              </span>
              <span className="cf_sideNav_label">Settings</span>
            </Link>
          )}
          <Link
            to="https://blogs.cloudfuzehost.com/CloudFuze"
            target="_blank"
            className="cf_sideNav_link cf_sideNav_help_link"
            title="Help"
          >
            <span className="cf_sideNav_icon">
              <CircleHelp size={18} />
            </span>
            <span className="cf_sideNav_label">Help</span>
          </Link>
        </div>
      </nav>
    </div >
  );
};

export default SideNav;
