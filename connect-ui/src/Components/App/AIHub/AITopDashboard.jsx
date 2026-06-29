import { Activity, DollarSign, Target, User } from "lucide-react";
import { formatCurrencyShort } from "../../helpers/utils";
import { useEffect, useMemo, useState } from "react";
import { getAIHubData } from "./AIHubActions";
import { aggregateDemoUserMetrics, DEMO_AI_HUB_USERS } from "./aiHubDemoData";

const AITopDashboard = () => {
    const [isDataLoading, setIsDataLoading] = useState(false);

    const demoMetrics = useMemo(() => aggregateDemoUserMetrics(DEMO_AI_HUB_USERS), []);

    useEffect(() => {
        fetchApiHubData();
    }, []);

    const fetchApiHubData = async () => {
        setIsDataLoading(true);
        const res = await getAIHubData();
        if (res?.status === "OK") {
            setIsDataLoading(false);
            // res?.res available when wiring live metrics from /copilot/adoption/performance-metrics
        } else {
            setIsDataLoading(false);
        }
    };

    const showMetrics = !isDataLoading;
    const totalUsers = showMetrics ? demoMetrics.totalUsers : 0;
    const activeUsers = showMetrics ? demoMetrics.activeUsers : 0;
    const monthlySpend = showMetrics ? demoMetrics.monthlySpend : 0;
    const avgProductivity = showMetrics ? demoMetrics.avgProductivity : 0;

    return (
        <div className="cf_new_dashboard_resourceApps_container">
            <div className="cf_new_dashboard_info_pannel CF_Pointer"
            >
                <div
                    className="cf_new_dashboard_info_pannel_title"
                    style={{ gap: "8px" }}
                >
                    <p>Total Users</p>
                    <span style={{ marginLeft: "auto" }}></span>
                    <User size={16} strokeWidth={2} color="#64748b" />
                </div>
                <div className="cf_new_dashboard_info_pannel_body">
                    <p className="cf_new_dashboard_Data">{totalUsers}</p>
                    {/* <p className="cf_new_dashboard_pannel_info">Integrated Apps</p> */}
                </div>
            </div>
            <div className="cf_new_dashboard_info_pannel CF_Pointer"
            >
                <div
                    className="cf_new_dashboard_info_pannel_title"
                    style={{ gap: "8px" }}
                >
                    <p>Active Users</p>

                    <span style={{ marginLeft: "auto" }}></span>
                    <Activity size={16} strokeWidth={2} color="#64748b" />
                </div>
                <div className="cf_new_dashboard_info_pannel_body">
                    <p className="cf_new_dashboard_Data" style={{ color: "#16a34a" }}>
                        {activeUsers}
                    </p>
                    {/* <p className="cf_new_dashboard_pannel_info">From unused licenses</p> */}
                </div>
            </div>
            <div className="cf_new_dashboard_info_pannel CF_Pointer"
            >
                <div
                    className="cf_new_dashboard_info_pannel_title"
                    style={{ gap: "8px" }}
                >
                    <p>Monthly Spend</p>
                    <span style={{ marginLeft: "auto" }}></span>
                    <DollarSign size={16} strokeWidth={2} color="#64748b" />
                </div>
                <div className="cf_new_dashboard_info_pannel_body">
                    <p className="cf_new_dashboard_Data" style={{ color: "#001a6f" }}>
                        ${formatCurrencyShort(!isDataLoading ? 1417.5 : 0) ?? 0 ?? 0}
                    </p>
                    {/* <p className="cf_new_dashboard_pannel_info">
                        Annual SaaS subscription costs
                    </p> */}
                </div>
            </div>
            <div className="cf_new_dashboard_info_pannel CF_Pointer"
            >
                <div
                    className="cf_new_dashboard_info_pannel_title"
                    style={{ gap: "8px" }}
                >
                    <p>Avg Productivity</p>
                    <span style={{ marginLeft: "auto" }}></span>
                    <Target size={16} strokeWidth={2} color="#64748b" />
                </div>
                <div className="cf_new_dashboard_info_pannel_body">
                    <p className="cf_new_dashboard_Data">{avgProductivity}</p>
                    {/* <p className="cf_new_dashboard_pannel_info">
                        Across all applications
                    </p> */}
                </div>
            </div>
        </div>
    );
};

export default AITopDashboard;