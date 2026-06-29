import { useState } from "react";

const VerticalTabs = (props) => {
  const [activeTab, setActiveTab] = useState(props?.tabMenu[0]?.id);
  return (
    <div className="cf_vertical_tabs_container">
      {props?.tabMenu?.map((tab) => (
        <div
          className={`cf_vertical_tab ${
            activeTab === tab?.id ? "cf_vertical_tab_active" : "cf_vertical_tab"
          }`}
          key={tab?.id}
          onClick={() => setActiveTab(tab?.id)}
        >
          <p>{tab?.name}</p>
        </div>
      ))}
    </div>
  );
};

export default VerticalTabs;
