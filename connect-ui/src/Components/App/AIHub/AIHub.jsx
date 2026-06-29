import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import AITopDashboard from "./AITopDashboard";
import AIBottomDashboard from "./AIBottomDashboard";

const AIHub = () => {
    return (
        <div className="cf_main_container">
            <SideNav activeTab="Copilot Hub" />
            <div className="cf_main_content_place">
                <TopNav pageName="Copilot Hub" />
                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
                >
                    <AITopDashboard />
                    <AIBottomDashboard />
                </div>
            </div>
        </div>
    );
};

export default AIHub;