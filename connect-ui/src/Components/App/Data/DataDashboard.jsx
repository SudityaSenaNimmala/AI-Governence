import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileDown, ScanSearch, ShieldCheck } from "lucide-react";
import DataDashboardTop from "./DataDashboardTop";
import DataDashboardBottom from "./DataDashboardBottom";
import "./DataDashboard.css";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getContentSprawlInfo } from "./DataDashboardActions";
import RunScanContentSprawlPopup from "./RunScanContentSprawlPopup";

const DataDashboard = () => {
    const navigate = useNavigate();
    const [platformData, setPlatformData] = useState([]);
    const [totalDocuments, setTotalDocuments] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [actionsDone, setActionsDone] = useState(21);
    const [totalActions, setTotalActions] = useState(38);
    const [pagination, setPagination] = useState({
        pageNo: 1,
        pageSize: 100,
        totalDocuments: 0,
        totalPages: 1,
    });
    const [runScanPopupOpen, setRunScanPopupOpen] = useState(false);

    const fetchContentSprawlInfo = async (pageNo = pagination?.pageNo, pageSize = pagination?.pageSize) => {
        setIsLoading(true);
        const res = await getContentSprawlInfo(true, pageNo, pageSize);
        if (res?.status === "OK") {
            const payload = res?.res ?? {};
            setPlatformData(payload?.data ?? []);
            setPagination({
                pageNo,
                pageSize,
                totalDocuments: payload?.totalDocuments ?? 0,
                totalPages: Math.ceil((payload?.totalDocuments ?? 0) / pageSize) || 1,
            });
            setTotalDocuments(payload?.totalDocuments ?? 0);
            setIsLoading(false);
        } else {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchContentSprawlInfo();
    }, []);

    const lastScanFormatted = useMemo(() => {
        const latest = (platformData || []).reduce((best, p) => {
            const t = p?.modifiedTime ? new Date(p.modifiedTime).getTime() : 0;
            return t > (best ? new Date(best).getTime() : 0) ? p.modifiedTime : best;
        }, null);
        return latest
            ? new Date(latest).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
            })
            : "—";
    }, [platformData]);

    const progressPercent = totalActions > 0 ? Math.round((actionsDone / totalActions) * 100) : 0;

    return (
        <div className="cf_main_container">
            <SideNav activeTab="Data" subMenuActive="Content Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Content Sprawl" />
                <div
                    className="cf_main_content_place_main CF_d-flex"
                    style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
                >
                    {/* Data Sprawl header */}
                    <header className="data-sprawl-header">
                        <div className="data-sprawl-header__left">
                            <h1 className="data-sprawl-header__title">Content Sprawl</h1>
                            <p className="data-sprawl-header__subtitle">
                                Last scan: {lastScanFormatted}
                            </p>
                        </div>
                        <div className="data-sprawl-header__right">
                            {/* <div className="data-sprawl-header__progress-wrap">
                                <div className="data-sprawl-header__progress-track">
                                    <div
                                        className="data-sprawl-header__progress-fill"
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                                <span className="data-sprawl-header__progress-text">
                                    {actionsDone} of {totalActions} actions done
                                </span>
                            </div> */}
                            <ActionButton
                                buttonType="button"
                                buttonClickAction={() => navigate("/Data/Policy")}
                                customClass="data-sprawl-header__btn data-sprawl-header__btn--secondary changeButtonColorOnHover"
                                title="Policies"
                            >
                                <ShieldCheck size={18} />
                                Policies
                            </ActionButton>
                            <ActionButton
                                buttonType="button"
                                buttonClickAction={() => setRunScanPopupOpen(true)}
                                customClass="data-sprawl-header__btn data-sprawl-header__btn--primary"
                                title="Run Scan"
                            >
                                <ScanSearch size={18} />
                                Run Scan
                            </ActionButton>
                        </div>
                    </header>

                    <RunScanContentSprawlPopup
                        isOpen={runScanPopupOpen}
                        setIsOpen={setRunScanPopupOpen}
                        pageSize={pagination.pageSize}
                        onScanSuccess={() => fetchContentSprawlInfo(1, 100)}
                    />

                    <DataDashboardTop platformData={platformData} totalDocuments={totalDocuments} />
                    <DataDashboardBottom platformData={platformData} isLoading={isLoading} pagination={pagination} fetchContentSprawlInfo={fetchContentSprawlInfo} />
                </div>
            </div>
        </div>
    );
};

export default DataDashboard;
