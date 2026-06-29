import { Link } from "react-router-dom";

const NavTabSwitcher = (props) => {
  return (
    <div className="cf_navTabSwitcher_div">
      <div
        className={`cf_navTabSwitcher_div_tab ${
          props?.activeTab === "Add Applications"
            ? "cf_navTabSwitcher_div_tab_active"
            : ""
        }`}
      >
        <Link to="/Integrations/Add">ADD APPLICATIONS</Link>
      </div>
      <div
        className={`cf_navTabSwitcher_div_tab ${
          props?.activeTab === "Manage Applications"
            ? "cf_navTabSwitcher_div_tab_active"
            : ""
        }`}
      >
        <Link to="/Integrations/Manage">MANAGE APPLICATIONS</Link>
      </div>
    </div>
  );
};

export default NavTabSwitcher;
