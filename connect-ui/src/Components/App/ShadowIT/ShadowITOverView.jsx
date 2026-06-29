import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import ShadowITInfo from "./ShadowITInfo";

const ShadowITOverView = () => {
  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Shadow IT" />
        <div className="cf_main_content_place">
          <TopNav pageName="Shadow IT" />
          <ShadowITInfo />
        </div>
      </div>
    </>
  );
};
export default ShadowITOverView;
