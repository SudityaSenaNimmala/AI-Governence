import { Route, BrowserRouter as Router, Routes } from "react-router-dom";
import "./App.css";
import Admin from "./Components/App/Admin/Admin";
import MyAccount from "./Components/App/Admin/MyAccount";
import Agent from "./Components/App/Agent/Agent";
import Dashboard from "./Components/App/Dashboard/Dashboard";
import AppCategory from "./Components/App/Dashboard/New/AppCategory/AppCategory";
import AppConsolidationReports from "./Components/App/Dashboard/New/AppConsolidationReports/AppConsolidationReports";
import DashboardAnalytics from "./Components/App/Dashboard/New/DashboardAnalytics";
import DashboardNew from "./Components/App/Dashboard/New/DashboardNew";
import SpentAnalytics from "./Components/App/Dashboard/New/SpentAnalytics/SpentAnalytics";
import UsersList from "./Components/App/Dashboard/New/UsersList";
import Applications from "./Components/App/Demos/Applications";
import DemosAppInsights from "./Components/App/Demos/DemosAppInsights";
import Integrations from "./Components/App/Integrations/Integrations";
import Login from "./Components/App/Login/Login";
import ResetPassword from "./Components/App/Login/ResetPassword";
import Canvas from "./Components/App/Migrations/Canvas/Canvas";
import Content from "./Components/App/Migrations/Content/Content";
import Message from "./Components/App/Migrations/Message/Message";
import Email from "./Components/App/Migrations/Email/Email";
import Migrations from "./Components/App/Migrations/Migrations";
import AddCloud from "./Components/App/Oauth/AddCloud";
import Oauth from "./Components/App/Oauth/Oauth";
import PostFeatures from "./Components/App/Product/PostFeatures";
import Product from "./Components/App/Product/Product";
import Reports from "./Components/App/Reports/Reports";
import ResourceAppsNew from "./Components/App/SaaSManagement/SaaS/ResourceApps/New/ResourceAppsNew";
import ResourceApps from "./Components/App/SaaSManagement/SaaS/ResourceApps/ResourceApps";
import ResourceAppsList from "./Components/App/SaaSManagement/SaaS/ResourceApps/ResourceAppsList";
import ResourceAppsListNew from "./Components/App/SaaSManagement/SaaS/ResourceApps/ResourceAppsListNew";
import SaaSAssessments from "./Components/App/SaaSManagement/SaaS/SaaSAssessments/SaaSAssessments";
import SaaSAssessmentsUsers from "./Components/App/SaaSManagement/SaaS/SaaSAssessments/SaaSAssessmentsUsers";
import SaaSDomains from "./Components/App/SaaSManagement/SaaS/SaaSDomains";
import SaaSGroupManagement from "./Components/App/SaaSManagement/SaaS/SaaSGroupManagement";
import SaaSTeamsGroupsList from "./Components/App/SaaSManagement/SaaS/SaaSGroupManagement/SaaSTeamsGroupsList";
import SaaSLicenseManagement from "./Components/App/SaaSManagement/SaaS/SaaSLicenseManagement/SaaSLicenseManagement";
import SaaSLicensesUsersList from "./Components/App/SaaSManagement/SaaS/SaaSLicenseManagement/SaaSLicensesUsersList";
import SaaSUserManagement from "./Components/App/SaaSManagement/SaaS/SaaSUserManagement/SaaSUserManagement";
import ShadowIT from "./Components/App/SaaSManagement/SaaS/ShadowIT/ShadowIT";
import SaaSManagement from "./Components/App/SaaSManagement/SaaSManagement";
import SaaSManagementOld from "./Components/App/SaaSManagement/SaaSManagementOld";
import SaaSMenu from "./Components/App/SaaSManagement/SaaSMenu/SaaSMenu";
import OnBoardingWorkFlowManagement from "./Components/App/Settings/OnBoardingWorkFlowManagement/OnBoardingWorkFlowManagement";
import Settings from "./Components/App/Settings/Settings";
import Signup from "./Components/App/Signup/Signup";
import SignupSetup from "./Components/App/Signup/SignupSetup";
import OffBoarding from "./Components/App/UserManagement/OffBoarding/OffBoarding";
import OnBoard from "./Components/App/UserManagement/OnBoard/OnBoard";
import AuthRouter from "./Components/helpers/AuthRouter";
import GaurdRouter from "./Components/helpers/GaurdRouter";
import ReCalendar from "./Components/Resuables/Calendar/ReCalendar";
import Error404 from "./Components/Resuables/Error404/Error404";
import ApiTesting from "./Components/Testing/ApiTesting";
import FolderStructure from "./Components/Testing/FolderStructure";
import InputTesing from "./Components/Testing/InputTesing";
import Testing from "./Components/Testing/Testing";
import WorkflowDiagram from "./Components/Testing/WorkflowDiagram";
// import Home from "./Components/App/Webapp/Home";
import ActivityLogs from "./Components/App/ActivityLogs/ActivityLogs";
import AIDashboard from "./Components/App/AIDashboard/AIDashboard";
import AppConfiguration from "./Components/App/AppConfiguration/AppConfiguration";
import NewPost from "./Components/App/Blog/Admin/NewPost";
import BrowserActivity from "./Components/App/BrowserExtension/BrowserActivity";
import BrowserExtension from "./Components/App/BrowserExtension/BrowserExtension";
import DepartmentCategory from "./Components/App/Demos/DepartmentCategory/DepartmentCategory";
import CustomeTemplate from "./Components/App/NewFlow/CustomeTemplate/CustomeTemplate";
import TemplateMaker from "./Components/App/NewFlow/CustomeTemplate/TemplateMaker";
import NewFlow from "./Components/App/NewFlow/NewFlow";
import NewFlowV2 from "./Components/App/NewFlow/NewFlowV2";
import NewFlowV3 from "./Components/App/NewFlow/NewFlowV3";
import NewFlowV4 from "./Components/App/NewFlow/NewFlowV4";
import OffBoardingWorkFlow from "./Components/App/NewFlow/OffBoardingWorkFlow/OffBoardingWorkFlow";
import ScheduledTrigger from "./Components/App/NewFlow/ScheduledTrigger";
import ShadowITOverView from "./Components/App/ShadowIT/ShadowITOverView";
import OffboardingApproval from "./Components/App/UnProtectedPages/OffboardingApproval";
import ManageWorkFlow from "./Components/App/UserManagement/WorkFlow/ManageWorkFlow";
import ManageWorkFlowNew from "./Components/App/UserManagement/WorkFlow/ManageWorkFlowNew";
import WorkFlowBuilder from "./Components/App/WorkFlowBuilder/WorkFlowBuilder";
import OrgChart from "./Components/App/Settings/OrgChart/OrgChart";
import MFA from "./Components/App/Settings/UserManagement/MFA";
import BlogPost from "./Components/App/Blog/Admin/BlogPost";
import AssertManager from "./Components/App/Blog/AssertManager/AssertManager";
import PostNewBlog from "./Components/App/Blog/Admin/PostNewBlog";
import UsersLicenseHarvest from "./Components/App/Dashboard/LicenseHarvest/UsersLicenseHarvest";
import ContentSprawl from "./Components/App/ContentSprawl/ContentSprawl";
import DataDashboard from "./Components/App/Data/DataDashboard";
import DataDeepDrive from "./Components/App/Data/DataDeepDrive/DataDeepDrive";
import DataPolicy from "./Components/App/Data/DataPolicy/DataPolicy";
import BrowserExtensionConfig from "./Components/App/Settings/BrowserExtensionConfig/BrowserExtensionConfig";
import ManualOrGroupTriggerOffboarding from "./Components/App/NewFlow/OffBoardingWorkFlow/ManualOrGroupTriggerOffboarding";
import AIHub from "./Components/App/AIHub/AIHub";
import AssignGroups from "./Components/App/Client/AssignGroups";
import MessageDeepDiveSelector from "./Components/App/Data/MessageDeepDive/MessageDeepDiveSelector";
import MessageDashboard from "./Components/App/Data/MessageDeepDive/MessageDashboard";
import EmailDashboard from "./Components/App/Data/EmailDeepDive/EmailDashboard";
import EmailDeepDive from "./Components/App/Data/EmailDeepDive/EmailDeepDive";
import AgentGovernance from "./Components/App/AgentGovernance/AgentGovernance";
import AIHubPage from "./Components/App/AIHub/AIHubPage";
import AISprawlDashboard from "./Components/App/AISprawl/AISprawlDashboard";
import M365CopilotInsights from "./Components/App/AISprawl/M365CopilotInsights";
import ClaudeInsights from "./Components/App/AISprawl/ClaudeInsights";
import GeminiInsights from "./Components/App/AISprawl/GeminiInsights";
import OpenAIInsights from "./Components/App/AISprawl/OpenAIInsights";
import CursorInsights from "./Components/App/AISprawl/CursorInsights";
import GitHubCopilotInsights from "./Components/App/AISprawl/GitHubCopilotInsights";
function App() {
  return (
    <>
      {/* <LoadingTransition /> */}
      <Router basename="/CloudFuze">
        <Routes>
          {
            window.location.host?.includes("blogs") ? (
              <>
                <Route path="/" element={<BlogPost />} />
                <Route path="/:postId" element={<BlogPost />} />
                <Route path="/Login" element={<Login />} />
              </>) :
              <Route path="/" element={<Login />} />
          }
          <Route path="/MFA" element={<MFA />} />
          <Route path="/DataSprawl" element={<DataDashboard />} />
          <Route path="/AgentGovernance" element={<AgentGovernance />} />
          <Route path="/AIHub/Overview" element={<AIHubPage page="Overview" />} />
          <Route path="/AIHub/Machines" element={<AIHubPage page="Machines" />} />
          <Route path="/AIHub/Tools" element={<AIHubPage page="Tools" />} />
          <Route path="/AIHub/Agents" element={<AIHubPage page="Agents" />} />
          <Route path="/AIHub/ServerAgents" element={<AIHubPage page="ServerAgents" />} />
          <Route path="/AIHub/DLP" element={<AIHubPage page="DLP" />} />
          <Route path="/AIHub/Platforms" element={<AIHubPage page="Platforms" />} />
          <Route path="/AIHub/AgentGovernance" element={<AgentGovernance />} />
          <Route path="/Data" element={<DataDashboard />} />
          <Route path="/MessageSprawl" element={<MessageDashboard />} />
          <Route path="/EmailSprawl" element={<EmailDashboard />} />
          <Route path="/Client/AssignGroups" element={<AssignGroups />} />
          <Route path="/Data/:contentSprawlId" element={<DataDeepDrive />} />
          <Route path="/Messages/:contentSprawlId" element={<MessageDeepDiveSelector />} />
          <Route path="/Emails/:contentSprawlId" element={<EmailDeepDive />} />
          <Route path="/Data/Policy" element={<DataPolicy />} />
          <Route path="/Blog/AssertManager" element={<AssertManager />} />
          <Route path="/Blog/Admin/NewPost" element={<NewPost />} />
          <Route path="/Blog/Post/:postId" element={<BlogPost />} />
          <Route path="/ResetPassword/:email/:token" element={<ResetPassword />} />
          <Route path="/Signup/Complete" element={<SignupSetup />} />
          <Route
            path="/Admin/AppConfiguration"
            element={<AppConfiguration />}
          />
          <Route path="/Signup" element={<Signup />} />
          <Route path="/BrowserExtension" element={<BrowserExtension />} />
          <Route path="/Dashboard" element={<DashboardNew />} />
          <Route path="/CopilotHub" element={<AIHub />} />
          <Route path="/AgentHub" element={<AISprawlDashboard />} />
          <Route path="/AgentHub/M365Copilot" element={<M365CopilotInsights />} />
          <Route path="/AgentHub/Claude" element={<ClaudeInsights />} />
          <Route path="/AgentHub/Gemini" element={<GeminiInsights />} />
          <Route path="/AgentHub/OpenAI" element={<OpenAIInsights />} />
          <Route path="/AgentHub/Cursor" element={<CursorInsights />} />
          <Route path="/AgentHub/GitHubCopilot" element={<GitHubCopilotInsights />} />
          <Route path="/AIInsights" element={<AIDashboard />} />
          <Route
            path="/offboarddetails/update"
            element={<OffboardingApproval />}
          />
          <Route element={<AuthRouter />}>
            <Route
              path="/Testing/WorkflowDiagram"
              element={<WorkflowDiagram />}
            />
            <Route path="/Testing/Folder" element={<FolderStructure />} />
            <Route path="/Testing/Api" element={<ApiTesting />} />
            <Route path="/Testing/Input" element={<InputTesing />} />
            <Route path="/Product/Post" element={<PostFeatures />} />
            <Route path="/Product" element={<Product />} />
            <Route path="/Dashboard/Old" element={<Dashboard />} />
            {/* <Route path="/Workflow" element={<UserManagement />} /> */}
            <Route path="/ShadowIT" element={<ShadowITOverView />} />
            <Route path="/BrowserActivity" element={<BrowserActivity />} />
            <Route path="/AuditLogs" element={<ActivityLogs />} />
            <Route path="/NewFlow" element={<NewFlow />} />
            <Route path="/NewFlowV2" element={<NewFlowV2 />} />
            <Route path="/NewFlowV3" element={<NewFlowV3 />} />
            <Route path="/NewFlowV4" element={<NewFlowV4 />} />
            <Route path="/WorkFlowBuilder" element={<WorkFlowBuilder />} />
            <Route path="/WorkFlow/TemplateBuilder" element={<TemplateMaker />} />
            <Route path="/ScheduledTrigger" element={<ScheduledTrigger />} />
            <Route path="/DepartmentCategory" element={<DepartmentCategory />} />
            <Route path="/Workflow/OffBoarding" element={<OffBoardingWorkFlow />} />
            <Route path="/Workflow/OffBoarding/:type" element={<ManualOrGroupTriggerOffboarding />} />
            <Route path="/Custom/Template" element={<CustomeTemplate />} />
            <Route
              path="/Workflow/CreateWorkflow"
              element={<ManageWorkFlow />}
            />
            <Route path="/Workflow/Template" element={<ManageWorkFlowNew />} />
            <Route path="/Workflow" element={<ManageWorkFlowNew />} />
            {/* <Route path="/Workflow" element={<ManageWorkFlow />} /> */}
            <Route path="/Workflow/OnBoard" element={<OnBoard />} />
            <Route path="/Workflow/OffBoard" element={<OffBoarding />} />
            <Route path="/Agent" element={<Agent />} />
            <Route
              path="/UserManagement/WorkFlow"
              element={<OnBoardingWorkFlowManagement />}
            />
            <Route
              path="/AppConsolidationReport"
              element={<AppConsolidationReports />}
            />
            {/* <Route path="/UsersList" element={<UsersList />} /> */}
            <Route path="/UsersList" element={<UsersLicenseHarvest />} />
            <Route path="/ContentSprawl" element={<ContentSprawl />} />
            <Route path="/SaaSManagementOld" element={<SaaSManagementOld />} />
            <Route path="/SpentAnalytics" element={<SpentAnalytics />} />
            <Route path="/Reports/:type" element={<Reports />} />
            <Route path="/Testing" element={<Testing />} />
            <Route path="/oauth/oauth" element={<Oauth />} />
            <Route path="/Admin" element={<Admin />} />
            <Route path="/MyAccount" element={<MyAccount />} />
            <Route path="/oauth/addcloud" element={<AddCloud />} />
            <Route path="/AppCategory" element={<AppCategory />} />
            <Route path="/Analytics" element={<DashboardAnalytics />} />
            <Route path="/SaaS/Domains" element={<SaaSDomains />} />
            <Route path="/SaaS/ResourceApps" element={<ResourceApps />} />
            <Route path="/SaaS/ShadowIT" element={<ShadowIT />} />
            <Route
              path="/SaaS/ConnectedApps/New"
              element={<ResourceAppsNew />}
            />
            <Route
              path="/SaaS/ResourceApps/List"
              element={<ResourceAppsList />}
            />
            <Route
              path="/SaaS/ConnectedApps/List/New"
              element={<ResourceAppsListNew />}
            />
            <Route
              path="/SaaS/UserManagement"
              element={<SaaSUserManagement />}
            />
            <Route path="/SaaS/TeamsGroups" element={<SaaSGroupManagement />} />
            <Route
              path="/SaaS/TeamsGroups/:type/List"
              element={<SaaSTeamsGroupsList />}
            />
            <Route
              path="/SaaS/License/:licenseName/:licenseId"
              element={<SaaSLicensesUsersList />}
            />
            <Route path="/SaaSManagement/Menu" element={<SaaSMenu />} />
            <Route path="/SaaSManagement" element={<SaaSManagement />} />
            <Route path="/SaaS/License" element={<SaaSLicenseManagement />} />
            <Route path="/SaaS/Assessments" element={<SaaSAssessments />} />
            <Route
              path="/SaaS/Assessments/Users"
              element={<SaaSAssessmentsUsers />}
            />
            <Route element={<GaurdRouter roles={["Admin"]} />}>
              <Route path="/Migrations/Content" element={<Content />} />
              <Route path="/Migrations/Collaborations" element={<Message />} />
              <Route path="/Migrations/Email" element={<Email />} />
              <Route path="/Migrations/WhiteBoard" element={<Canvas />} />
              <Route path="/Migrations" element={<Migrations />} />
              <Route path="/Integrations/:type" element={<Integrations />} />
              <Route path="/Settings" element={<Settings />} />
              <Route path="/Settings/BrowserExtensionConfig" element={<BrowserExtensionConfig />} />
              <Route path="/OrgChart" element={<OrgChart />} />
              <Route path="/Blog/Admin/PostNewBlog" element={<PostNewBlog />} />
            </Route>
            <Route path="*" element={<Error404 />} />
          </Route>
          <Route path="/Applications" element={<Applications />} />
          <Route path="/ReCalendar" element={<ReCalendar />} />
          <Route path="/Demo" element={<Applications />} />
          <Route path="/Demo/Insights" element={<DemosAppInsights />} />
          <Route path="/Applications/Insights" element={<DemosAppInsights />} />
        </Routes>
      </Router>
    </>
  );
}

export default App;