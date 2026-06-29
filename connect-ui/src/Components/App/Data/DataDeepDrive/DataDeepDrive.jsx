import { ArrowDownUp, ChevronDown, ChevronRight, Link2, ListTree, Lock, MoveDown, MoveUp, Table, Users } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BiFilterAlt } from "react-icons/bi";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { cloudImageMapper, getFileIconsNew } from "../../../helpers/helpers";
import { formatEnumLabel, getBreadCrumbRoot, getSizeFormatted, globalDebounce, notifyToast } from "../../../helpers/utils";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import { getCFLoader, getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { deletePermissionFromFileFolder, getCollaborators, getDuplicatesForAFilefolder, getRootLevelData, getRootLevelDataByVersionId } from "../DataDashboardActions";
import CollaboratorsPopup from "./CollaboratorsPopup";
import DisplayDuplicates from "./DisplayDuplicates";
import VersionFiles from "./VersionFiles";
import "./DataDeepDrive.css";
import DataFolderDisplay from "./DataFolderDisplay";
const DEFAULT_PLATFORM = {
    platform: "Google Drive",
    health: 82,
    files: "980K",
    duplicates: "4,200",
    sensitive: "120",
    external: "340",
    lastScan: "2 hrs ago",
    status: "Healthy",
};

const DriveIcon = ({ vendorName = "GOOGLE_SHARED_DRIVES", width = "28px", height = "28px" }) => (
    <img src={cloudImageMapper(vendorName === "GOOGLE_WORKSPACE" ? "GOOGLE_WORKSPACE" : vendorName)} alt="drive" style={{ width: width, height: height, objectFit: "contain" }} />
);

const FolderIcon = ({ width = "20px", height = "20px" }) => (
    <img src={cloudImageMapper("folder")} alt="folder" style={{ width: width, height: height }} />
);

const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
    } catch {
        return dateStr || "—";
    }
};

/** Rank for sorting by sensitivity: Critical/High first, then Medium, then Low, then empty */
const getSensitivityRank = (item) => {
    const r = (item?.riskLevel || "").toUpperCase();
    if (r === "CRITICAL") return 0;
    if (r === "HIGH") return 1;
    if (r === "MEDIUM") return 2;
    if (r === "LOW") return 3;
    return 4;
};

const sortBySensitivity = (list) => (list || []).slice().sort((a, b) => getSensitivityRank(a) - getSensitivityRank(b));

/** Normalize API item to table row shape; root items may have name: null */
const normalizeRow = (item, level = 0, vendorName = "") => {
    const name = item.name ?? (item.root ? "Shared Drive" : item.path?.split("/").filter(Boolean).pop()) ?? "—";
    const isDrive = item.root === true || item.driveType === "DRIVE";
    const isFile = (item.type || "").toUpperCase() === "FILE";
    const isFolder =
        !isFile &&
        (item.type === "FOLDER" || item.type === "folder" || item.root === true || item.driveType === "DRIVE" || item.type === "SHARED_DRIVE");
    return {
        ...item,
        level,
        displayName: name,
        owner: item.createdBy ?? "—",
        size: item?.fileSize ? getSizeFormatted(item?.fileSize ?? 0) : "—",
        sharing: item?.externalCollabs ? "External" : "Internal",
        sensitivity: item.riskLevel ?? "—",
        processStatus: item.processStatus ?? "—",
        modified: formatDate(item.modifiedDate),
        createdDate: formatDate(item.createdDate),
        viewedByMeTime: formatDate(item.viewedByMeTime),
        extcollabsCount: item.extcollabsCount ?? 0,
        listOfCollabsIds: item.listOfCollabsIds ?? [],
        totalCollaborators: vendorName === "MICROSOFT_OFFICE_365" ? item.collabarationCount : (item.collabarationCount > 0 ? item.collabarationCount - 1 : 0),
        containAnnonimouslink: item.containAnnonimouslink === true,
        isExpandable: item.type === "FOLDER" || item.driveType === "DRIVE" || item.type === "SHARED_DRIVE",
        isFolder,
        icon: isDrive ? "drive" : "folder",
        type: item.type,
        staleType: item.staleType,
        versionCount: item.versionCount > 1 ? item.versionCount : 0,
        // totalVersionSize: getSizeFormatted(43888),
        totalVersionSize: item?.totalVersionSize ? getSizeFormatted(item?.totalVersionSize) : "",
        externalCollabs: item?.externalCollabs,
        lastAcessByTime: item.lastAcessByTime ? formatDate(item.lastAcessByTime) : null,
        lastAcessEmail: item.lastAcessEmail ? item.lastAcessEmail : null,
    };
};


const getRelativeImage = (action, row, vendorName = "GOOGLE_SHARED_DRIVES") => {
    if (row.root === true) {
        if (row.type === "DRIVE" && vendorName === "MICROSOFT_OFFICE_365") {
            action = "drive"
            vendorName = "ONEDRIVE_BUSINESS_ADMIN"
        } else if (row.type === "SITE" && vendorName === "MICROSOFT_OFFICE_365") {
            action = "site"
        } else {
            return <DriveIcon vendorName={vendorName} width="20px" height="20px" />;
        }
    } else {

        if (row.type === "DRIVE" && vendorName === "MICROSOFT_OFFICE_365") {
            action = "folder"
        }
        if (row.type === "SHARED_DRIVE") {
            action = "drive"
        }
    }
    const actionLower = (action || "").toLowerCase();
    switch (actionLower) {
        case "drive":
            return <DriveIcon width="20px" height="20px" vendorName={vendorName} />;
        case "site":
            return <img src={getFileIconsNew(row.displayName, "site", true)} alt="file" style={{ width: "20px", height: "20px", objectFit: "contain" }} />;
        case "folder":
            return <img src={getFileIconsNew(row.displayName, "folder")} alt="file" style={{ width: "20px", height: "20px", objectFit: "contain" }} />;
        case "file":
            return <img src={getFileIconsNew(row.displayName)} alt="file" style={{ width: "20px", height: "20px", objectFit: "contain" }} />;
        default:
            return <img src={getFileIconsNew(row.displayName)} alt="file" style={{ width: "20px", height: "20px", objectFit: "contain" }} />;
    }
}

const PAGE_SIZE = 100;

const MODIFIED_DATE_OPTIONS = [
    { key: "", value: "Modified" },
    { key: "DESC", value: "Newest first" },
    { key: "ASC", value: "Oldest first" },
];
const SORT_COLLABORATORS_OPTIONS = [
    { key: "", value: "Collaborators" },
    { key: "DESC", value: "Most first" },
    { key: "ASC", value: "Least first" },
];
const SHARING_OPTIONS = [
    { key: "", value: "All" },
    { key: "INTERNAL", value: "Internal" },
    { key: "EXTERNAL", value: "External" },
];
/** Cycle: "" -> "DESC" (MoveDown) -> "ASC" (MoveUp) -> "" (ArrowDownUp) */
const nextSortCycle = (current) => (current === "" ? "DESC" : current === "DESC" ? "ASC" : "");
const SortCycleIcon = ({ value, size = 14 }) => {
    if (value === "DESC") return <MoveDown size={size} aria-hidden />;
    if (value === "ASC") return <MoveUp size={size} aria-hidden />;
    return <ArrowDownUp size={size} aria-hidden />;
};

const RISK_LEVEL_OPTIONS = [
    { key: "", value: "All" },
    { key: "LOW", value: "Low" },
    { key: "MEDIUM", value: "Medium" },
    { key: "HIGH", value: "High" },
];

const STALE_TYPE_OPTIONS = [
    { key: "", value: "All" },
    { key: "DAYS_90", value: "90 days" },
    { key: "DAYS_180", value: "180 days" },
    { key: "DAYS_360", value: "360 days" },
];

const formatCount = (n) => {
    const val = Number(n);
    if (Number.isNaN(val)) return "0";
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
    return String(val);
};

const DataDeepDrive = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { contentSprawlId } = useParams();
    const scrollWrapRef = useRef(null);
    const [platform, setPlatform] = useState({});
    const [expanded, setExpanded] = useState({});
    const [search, setSearch] = useState("");
    const debouncedSetSearch = useMemo(() => globalDebounce((value) => setSearch(value ?? ""), 300), []);
    const [viewType, setViewType] = useState("list"); // "table" | "list"
    /** List view: breadcrumb path. [] = root; each entry = one level in (id, filefolderId, displayName). */
    const [listViewPath, setListViewPath] = useState([]);
    const listViewPathRef = useRef(listViewPath);
    listViewPathRef.current = listViewPath;
    const [isDataLoading, setIsDataLoading] = useState(false);
    const [loadingChildren, setLoadingChildren] = useState({});
    const [rootLevelData, setRootLevelData] = useState([]);
    const [subSitesData, setSubSitesData] = useState({});
    const [subSitesPagination, setSubSitesPagination] = useState({});
    const [collaboratorsPopupOpen, setCollaboratorsPopupOpen] = useState(false);
    const [collaboratorsList, setCollaboratorsList] = useState([]);
    const [collaboratorsItemName, setCollaboratorsItemName] = useState("");
    const [collaboratorsFilefolderId, setCollaboratorsFilefolderId] = useState(null);
    const [collaboratorsVendorName, setCollaboratorsVendorName] = useState("");
    const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [modifiedDateSort, setModifiedDateSort] = useState("");
    /** List view: `yyyy-MM-dd|yyyy-MM-dd` or null — Modified date / range from calendar */
    const [listModifiedDateRange, setListModifiedDateRange] = useState(null);
    /** List view: `yyyy-MM-dd|yyyy-MM-dd` or null — Last accessed range */
    const [listLastAccessedDateRange, setListLastAccessedDateRange] = useState(null);
    const [sortCollaboratorsSort, setSortCollaboratorsSort] = useState("");
    const [fileSizeSort, setFileSizeSort] = useState("");
    const [sharingFilter, setSharingFilter] = useState("");
    const [riskLevelFilter, setRiskLevelFilter] = useState("");
    const [staleTypeFilter, setStaleTypeFilter] = useState("");
    const navigatingIntoFolderRef = useRef(null);
    const prevContentSprawlIdRef = useRef(null);
    const [versionsForAFilefolder, setVersionsForAFilefolder] = useState([]);
    const [versionPopupOpen, setVersionPopupOpen] = useState(false);
    const [versionItemName, setVersionItemName] = useState("");
    const [versionsLoading, setVersionsLoading] = useState(false);
    const [duplicatesPopupOpen, setDuplicatesPopupOpen] = useState(false);
    const [duplicatesData, setDuplicatesData] = useState({ data: [], totalDocuments: 0 });
    const [duplicatesLoading, setDuplicatesLoading] = useState(false);
    const [filterConfig, setFilterConfig] = useState({});
    /** Stack of saved filter snapshots – one entry per folder level navigated into */
    const filterStackRef = useRef([]);
    const toggleExpand = (row) => {
        const id = row.id;
        const nextExpanded = !expanded[id];
        setExpanded((prev) => ({ ...prev, [id]: nextExpanded }));
        if (nextExpanded && row.filefolderId && !subSitesData[row.filefolderId]) {
            fetchSubSites(row.filefolderId, 1);
        }
    };

    const getApiFilterParams = useCallback((overrides = {}) => {
        const hasActiveFilter = !!(
            (overrides.searchValue !== undefined ? overrides.searchValue : search)?.trim() ||
            modifiedDateSort ||
            listModifiedDateRange ||
            listLastAccessedDateRange ||
            sortCollaboratorsSort ||
            fileSizeSort ||
            sharingFilter ||
            riskLevelFilter ||
            staleTypeFilter
        );
        const base = {
            contentSprawlId,
            adminCloudId: platform?.adminCloudId || "ALL",
            pageNo: overrides.pageNo ?? 1,
            pageSize: overrides.pageSize ?? PAGE_SIZE,
            filefolderId: hasActiveFilter ? "ROOT" : overrides.filefolderId ?? null,
            searchValue: (overrides.searchValue !== undefined ? overrides.searchValue : search)?.trim() || null,
            modifiedDate: listModifiedDateRange ? null : modifiedDateSort || null,
            modifiedFromDate: listModifiedDateRange || null,
            viewedByMeTime: listLastAccessedDateRange || null,
            sortCollaborators: sortCollaboratorsSort || null,
            fileSize: fileSizeSort || null,
            sharing: sharingFilter || null,
            riskLevel: riskLevelFilter || null,
            staleType: staleTypeFilter || null,
        };
        return { ...base, ...overrides };
    }, [contentSprawlId, platform?.adminCloudId, search, modifiedDateSort, listModifiedDateRange, listLastAccessedDateRange, sortCollaboratorsSort, fileSizeSort, sharingFilter, riskLevelFilter, staleTypeFilter]);

    const fetchRootLevelData = useCallback(async () => {
        setIsDataLoading(true);
        const params = getApiFilterParams({ pageNo: 1, pageSize: 100 });
        localStorage.setItem("contentSprawl_filterConfig", JSON.stringify(params));
        const res = await getRootLevelData(params);
        if (res?.status === "OK") {
            setRootLevelData(res?.res?.data ?? []);
        } else {
            setRootLevelData([]);
        }
        setIsDataLoading(false);
    }, [contentSprawlId, getApiFilterParams]);

    const fetchSubSites = useCallback(async (filefolderId, pageNo = 1, targetContentSprawlId = contentSprawlId) => {
        setIsPageLoading(true);
        setLoadingChildren((prev) => ({ ...prev, [filefolderId]: true }));
        const params = getApiFilterParams({ filefolderId, pageNo, pageSize: PAGE_SIZE, contentSprawlId: targetContentSprawlId });
        localStorage.setItem("contentSprawl_filterConfig", JSON.stringify(params));
        const res = await getRootLevelData(params);
        setLoadingChildren((prev) => ({ ...prev, [filefolderId]: false }));
        if (res?.status === "OK") {
            setIsPageLoading(false);
            const newData = res?.res?.data ?? [];
            const totalFromApi = res?.res?.totalFilesFolder ?? res?.res?.totalDocuments ?? 0;
            const totalDocuments = totalFromApi || (newData.length >= PAGE_SIZE ? (pageNo * PAGE_SIZE) + 1 : pageNo * PAGE_SIZE);
            setSubSitesData((prev) => {
                const existing = pageNo === 1 ? [] : (prev[filefolderId] ?? []);
                const merged = pageNo === 1 ? newData : [...existing, ...newData];
                return { ...prev, [filefolderId]: merged };
            });
            setSubSitesPagination((prev) => ({
                ...prev,
                [filefolderId]: { pageNo, totalDocuments, pageSize: PAGE_SIZE },
            }));
        } else if (pageNo === 1) {
            setIsPageLoading(false);
            setSubSitesData((prev) => ({ ...prev, [filefolderId]: [] }));
            setSubSitesPagination((prev) => ({ ...prev, [filefolderId]: { pageNo: 1, totalDocuments: 0, pageSize: PAGE_SIZE } }));
        }
    }, [contentSprawlId, getApiFilterParams,]);

    const hasMore = useCallback((filefolderId) => {
        const p = subSitesPagination[filefolderId];
        if (!p) return false;
        return (p.pageNo * p.pageSize) < p.totalDocuments;
    }, [subSitesPagination]);

    /** Payload for POST `/common/contentSprawl/export/...` — same filters as current list view. */
    const getListExportPayload = () => {
        return filterConfig;
    };

    const getExpandedFilefolderIds = useCallback(() => {
        const ids = [];
        rootLevelData.forEach((item) => {
            if (expanded[item.id] && item.filefolderId) ids.push(item.filefolderId);
        });
        Object.keys(subSitesData).forEach((ffId) => {
            (subSitesData[ffId] || []).forEach((child) => {
                if (expanded[child.id] && child.filefolderId) ids.push(child.filefolderId);
            });
        });
        return ids;
    }, [rootLevelData, subSitesData, expanded]);

    const handleScrollRef = useRef(null);
    handleScrollRef.current = () => {
        const scrollEl = scrollWrapRef.current?.closest?.(".cf_main_content_place") || scrollWrapRef.current;
        if (!scrollEl) return;
        const { scrollTop, clientHeight, scrollHeight } = scrollEl;
        if (scrollTop + clientHeight < scrollHeight - 200) return;

        let toLoad = null;
        if (viewType === "list" && listViewPath.length > 0) {
            const currentFilefolderId = listViewPath[listViewPath.length - 1]?.filefolderId;
            if (currentFilefolderId && hasMore(currentFilefolderId) && !loadingChildren[currentFilefolderId]) {
                toLoad = currentFilefolderId;
            }
        } else {
            const expandedIds = getExpandedFilefolderIds();
            toLoad = expandedIds.find((ffId) => hasMore(ffId) && !loadingChildren[ffId]) ?? null;
        }
        if (toLoad) fetchSubSites(toLoad, (subSitesPagination[toLoad]?.pageNo ?? 1) + 1);
    };

    useEffect(() => {
        const wrapEl = scrollWrapRef.current;
        const scrollEl = wrapEl?.closest?.(".cf_main_content_place") || wrapEl;
        if (!scrollEl) return;
        const onScroll = () => handleScrollRef.current?.();
        scrollEl.addEventListener("scroll", onScroll, { passive: true });
        return () => scrollEl.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        const fromState = location.state?.platform;
        const fromStorage = (() => {
            try {
                const raw = localStorage.getItem("contentSprawl_" + contentSprawlId);
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        })();
        const source = fromState || fromStorage;
        if (source) {
            const platformtoDate = {
                platform: source.email ?? source.platform ?? "—",
                totalFiles: source.totalFilesFolder ?? 0,
                staleFiles: (source.filesCount90days + source.filesCount180days + source.filesCount365days),
                externalFiles: source.externalCount ?? 0,
                publicLinks: source.publicLinkCount ?? 0,
                sensitiveFiles: source.sensitiveCount ?? 0,
                duplicatesCount: source.duplicateCount ?? source.duplicatesCount ?? source.duplicateFilesCount ?? 0,
                lastScan: source.modifiedTime ? new Date(source.modifiedTime).toLocaleString() : "—",
                vendorName: source.vendorName ?? "—",
                adminCloudId: source.adminCloudId ?? "—",
                totalSize: source.totalSize ?? 0,
                totalVersionSize: source.totalVersionSize ?? 0,
                type: source.type ?? "—",
            };
            setPlatform(platformtoDate);
        }
    }, [contentSprawlId, location.state?.platform]);

    useEffect(() => {
        if (!contentSprawlId) return;

        const sprawlChanged =
            prevContentSprawlIdRef.current !== null &&
            prevContentSprawlIdRef.current !== contentSprawlId;

        const markSprawlSeen = () => {
            prevContentSprawlIdRef.current = contentSprawlId;
        };

        if (navigatingIntoFolderRef.current) {
            const { filefolderId } = navigatingIntoFolderRef.current;
            navigatingIntoFolderRef.current = null;
            setExpanded({});
            fetchSubSites(filefolderId, 1);
            markSprawlSeen();
            return;
        }

        if (sprawlChanged) {
            setListViewPath([]);
            setExpanded({});
            fetchRootLevelData();
            markSprawlSeen();
            return;
        }

        /* Filter / search change only: keep list-view breadcrumb and refetch the current folder */
        if (viewType === "list") {
            const path = listViewPathRef.current;
            if (path.length > 0) {
                const currentFid = path[path.length - 1]?.filefolderId;
                if (currentFid) {
                    setExpanded({});
                    fetchSubSites(currentFid, 1);
                    markSprawlSeen();
                    return;
                }
            }
        }

        setListViewPath([]);
        setExpanded({});
        fetchRootLevelData();
        markSprawlSeen();
    }, [
        contentSprawlId,
        search,
        modifiedDateSort,
        listModifiedDateRange,
        listLastAccessedDateRange,
        sortCollaboratorsSort,
        fileSizeSort,
        sharingFilter,
        riskLevelFilter,
        staleTypeFilter,
        viewType,
        fetchRootLevelData,
        fetchSubSites,
    ]);

    const childrenOf = (filefolderId) => subSitesData[filefolderId] ?? [];
    const isLoadingChildren = (filefolderId) => loadingChildren[filefolderId] === true;

    // List view: current level items (folder-inside-folder navigation)
    const listViewCurrentItemsRaw =
        listViewPath.length === 0
            ? rootLevelData
            : (subSitesData[listViewPath[listViewPath.length - 1]?.filefolderId] ?? []);

    const listViewCurrentItems = useMemo(() => {
        let items = listViewCurrentItemsRaw;
        const rangeBounds = (pipeStr) => {
            if (!pipeStr || typeof pipeStr !== "string" || !pipeStr.includes("|")) return null;
            const [a, b] = pipeStr.split("|").map((s) => s.trim());
            if (!a || !b) return null;
            const lo = new Date(`${a}T00:00:00`).getTime();
            const hi = new Date(`${b}T23:59:59.999`).getTime();
            if (Number.isNaN(lo) || Number.isNaN(hi)) return null;
            return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
        };
        const modBounds = rangeBounds(listModifiedDateRange);
        if (modBounds) {
            items = items.filter((it) => {
                const t = it.modifiedDate ? new Date(it.modifiedDate).getTime() : NaN;
                return !Number.isNaN(t) && t >= modBounds.lo && t <= modBounds.hi;
            });
        }
        const accBounds = rangeBounds(listLastAccessedDateRange);
        if (accBounds) {
            items = items.filter((it) => {
                const t = it.viewedByMeTime ? new Date(it.viewedByMeTime).getTime() : NaN;
                return !Number.isNaN(t) && t >= accBounds.lo && t <= accBounds.hi;
            });
        }
        return items;
    }, [listViewCurrentItemsRaw, listModifiedDateRange, listLastAccessedDateRange]);
    const listViewLoading =
        listViewPath.length > 0 &&
        loadingChildren[listViewPath[listViewPath.length - 1]?.filefolderId] === true;

    const handleListFolderClick = (row) => {
        if ((!row.isFolder && row.type !== "SITE" && row.type !== "DRIVE") || !row.filefolderId) return;
        const targetContentSprawlId = row.root && row.contentSprawlId ? row.contentSprawlId : contentSprawlId;
        if (row.root && row.contentSprawlId && row.contentSprawlId !== contentSprawlId) {
            navigate(`/Data/${row.contentSprawlId}`, { state: location.state });
        }
        const displayName =
            row.root && (platform?.vendorName === "GOOGLE_WORKSPACE" || platform?.vendorName === "MICROSOFT_OFFICE_365") ? getBreadCrumbRoot(row.driveType, platform?.vendorName) : row.displayName ? row.displayName : platform?.platform ? platform.platform : row.displayName;
        // Save current filters so they can be restored when navigating back
        filterStackRef.current = [
            ...filterStackRef.current,
            {
                search,
                modifiedDateSort,
                listModifiedDateRange,
                listLastAccessedDateRange,
                sortCollaboratorsSort,
                fileSizeSort,
                sharingFilter,
                riskLevelFilter,
                staleTypeFilter,
            },
        ];
        navigatingIntoFolderRef.current = { filefolderId: row.filefolderId };
        setSearch("");
        setModifiedDateSort("");
        setListModifiedDateRange(null);
        setListLastAccessedDateRange(null);
        setSortCollaboratorsSort("");
        setFileSizeSort("");
        setSharingFilter("");
        setRiskLevelFilter("");
        setStaleTypeFilter("");
        fetchSubSites(row.filefolderId, 1, targetContentSprawlId);
        setListViewPath((prev) => [...prev, { id: row.id, filefolderId: row.filefolderId, displayName }]);
    };

    const handleListBreadcrumbClick = (index) => {
        const currentDepth = listViewPath.length;
        // Restore the saved filters for the level we're navigating back to
        if (index < currentDepth && filterStackRef.current.length > 0) {
            const saved = filterStackRef.current[index] || filterStackRef.current[0];
            filterStackRef.current = filterStackRef.current.slice(0, index);
            setSearch(saved.search ?? "");
            setModifiedDateSort(saved.modifiedDateSort ?? "");
            setListModifiedDateRange(saved.listModifiedDateRange ?? null);
            setListLastAccessedDateRange(saved.listLastAccessedDateRange ?? null);
            setSortCollaboratorsSort(saved.sortCollaboratorsSort ?? "");
            setFileSizeSort(saved.fileSizeSort ?? "");
            setSharingFilter(saved.sharingFilter ?? "");
            setRiskLevelFilter(saved.riskLevelFilter ?? "");
            setStaleTypeFilter(saved.staleTypeFilter ?? "");
        }
        setListViewPath((prev) => prev.slice(0, index));
    };

    // When in list view, ensure the current folder's children are loaded (e.g. after breadcrumb click from an empty folder)
    // useEffect(() => {
    //     if (viewType !== "list" || listViewPath.length === 0) return;
    //     const currentFilefolderId = listViewPath[listViewPath.length - 1]?.filefolderId;
    //     if (!currentFilefolderId) return;
    //     if (subSitesData[currentFilefolderId] === undefined) {
    //         fetchSubSites(currentFilefolderId, 1);
    //     }
    // }, [viewType, listViewPath, subSitesData, fetchSubSites]);

    // Reset list path when switching to table so list view starts at root next time
    const setViewTypeAndResetListPath = (type) => {
        if (type === "table") setListViewPath([]);
        setViewType(type);
    };

    const renderRow = (item, level = 0) => {
        const row = normalizeRow(item, level);
        const childItems = childrenOf(row.filefolderId);
        const hasChildren = row.isExpandable;
        const isExpanded = expanded[row.id];
        const loading = hasChildren && isExpanded && isLoadingChildren(row.filefolderId);
        const showExpandArrow = level === 0 ? hasChildren : (row.type === "FOLDER" && hasChildren);

        return (
            <React.Fragment key={row.id}>
                <tr className="deep-drive__table-row">
                    <td style={{ paddingLeft: 12 + level * 24 }}>
                        <span className="deep-drive__name-cell">
                            {showExpandArrow ? (
                                <button
                                    type="button"
                                    className="deep-drive__expand-btn"
                                    onClick={(e) => { e.stopPropagation(); toggleExpand(row); }}
                                    aria-expanded={isExpanded}
                                >
                                    {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                </button>
                            ) : (
                                <span className="deep-drive__expand-placeholder" />
                            )}
                            {getRelativeImage(row.type, row, platform?.vendorName)}

                            <span className="deep-drive__name-text">{level === 0 && row.root && platform?.platform ? platform.platform : row.displayName}</span>
                            {row.containAnnonimouslink && (
                                <span className="deep-drive__anon-link-icon" title="Anonymous link">
                                    <Link2 size={14} color="red" />
                                </span>
                            )}
                        </span>
                    </td>
                    <td>{level === 0 && row.root && platform?.platform ? platform.platform : row.owner}</td>
                    <td>{row.size}</td>
                    <td>
                        {
                            row.root ? "-" :
                                <span className={`deep-drive__pill deep-drive__pill--${(row.sharing || "internal").toLowerCase()}`}>
                                    {row.sharing === "Internal" ? <Users size={10} /> : <Lock size={10} />}
                                    <span>{row.sharing}</span>
                                </span>
                        }
                    </td>
                    <td>
                        {row.sensitivity && row.sensitivity !== "—" ? (
                            <span className={`deep-drive__pill deep-drive__pill--${String(row.sensitivity).toLowerCase()}`} style={{ fontSize: "10px" }}>
                                {row.sensitivity}
                            </span>
                        ) : (
                            "—"
                        )}
                    </td>
                    <td
                        style={{ textAlign: "center" }}
                        className={row.totalCollaborators > 0 ? "cf_make_link" : ""}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (row.totalCollaborators > 0) handleOpenCollaborators(row.filefolderId, row.displayName);
                        }}
                    >
                        {row.totalCollaborators ?? "—"}
                    </td>
                    <td style={{ paddingLeft: "10px" }}>{row.staleType === "DAYS_90" ? "90 days" : row.staleType === "DAYS_180" ? "180 days" : row.staleType === "DAYS_360" ? "360 days" : row.staleType === "DAYS_365" ? "365 days" : "—"}</td>
                    <td style={{ paddingLeft: "10px" }}>{row.modified}</td>
                </tr>
                {hasChildren && isExpanded && loading && childItems.length === 0 && (
                    <tr className="deep-drive__table-row deep-drive__loading-row">
                        <td colSpan={7} style={{ paddingLeft: 12 + (level + 1) * 24 }}>
                            <span className="deep-drive__row-loading">{getCFTextLoader()}</span>
                        </td>
                    </tr>
                )}
                {hasChildren && isExpanded && childItems.map((child) => renderRow(child, level + 1))}
                {hasChildren && isExpanded && loading && childItems.length > 0 && (
                    <tr className="deep-drive__table-row deep-drive__loading-row">
                        <td colSpan={7} style={{ paddingLeft: 12 + (level + 1) * 24 }}>
                            <span className="deep-drive__row-loading">{getCFTextLoader()}</span>
                        </td>
                    </tr>
                )}
            </React.Fragment>
        );
    };

    const handleOpenCollaborators = (filefolderId, itemName) => {
        setCollaboratorsItemName(itemName ?? "");
        setCollaboratorsFilefolderId(filefolderId);
        setCollaboratorsVendorName(platform?.platform ?? "");
        setCollaboratorsList([]);
        setCollaboratorsPopupOpen(true);
        setCollaboratorsLoading(true);
        getCollaborators(filefolderId, contentSprawlId).then((res) => {
            setCollaboratorsLoading(false);
            if (res?.status === "OK") {
                const data = res?.res?.data ?? res?.res ?? [];
                setCollaboratorsList(Array.isArray(data) ? data : []);
            } else {
                setCollaboratorsList([]);
            }
        }).catch(() => {
            setCollaboratorsLoading(false);
            setCollaboratorsList([]);
        });
    };

    const decrementCollaboratorCountInData = useCallback((filefolderId, isExternal, riskUpdates) => {
        const applyUpdates = (item) => ({
            ...item,
            collabarationCount: Math.max(0, (item.collabarationCount || 0) - (isExternal ? 0 : 1)),
            extcollabsCount: Math.max(0, (item.extcollabsCount || 0) - (isExternal ? 1 : 0)),
            ...riskUpdates,
        });
        setRootLevelData((prev) =>
            prev.map((item) => item.filefolderId === filefolderId ? applyUpdates(item) : item)
        );
        setSubSitesData((prev) => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
                const arr = next[key] || [];
                const idx = arr.findIndex((item) => item.filefolderId === filefolderId);
                if (idx >= 0) {
                    next[key] = arr.map((it, i) => i === idx ? applyUpdates(it) : it);
                    break;
                }
            }
            return next;
        });
    }, []);

    const handleRevokeCollaboratorAccess = (collaborator) => {
        const filefolderId = collaboratorsFilefolderId ?? collaborator.filefolderId;
        const isExternal = collaborator.externalCollabarator === true;
        setIsPageLoading(true);
        deletePermissionFromFileFolder({ id: collaborator?.id }).then((res) => {
            if (res?.status === "OK") {
                setIsPageLoading(false);
                notifyToast("success", "Collaborator access revoked successfully");
                const remaining = collaboratorsList.filter((c) => c.collabartionId !== collaborator.collabartionId);
                setCollaboratorsList(remaining);

                let riskUpdates;
                if (remaining.length <= 0) {
                    riskUpdates = { riskLevel: "LOW", containAnnonimouslink: false, externalCollabs: false };
                } else if (remaining.some((c) => c.externalCollabarator)) {
                    riskUpdates = { riskLevel: "HIGH", externalCollabs: true, containAnnonimouslink: remaining.some((c) => c.containAnnonimousLink) };
                } else if (remaining.some((c) => c.type === "LINK")) {
                    riskUpdates = { riskLevel: "MEDIUM", externalCollabs: false, containAnnonimouslink: true };
                } else {
                    riskUpdates = { riskLevel: "LOW", containAnnonimouslink: false, externalCollabs: false };
                }

                if (filefolderId) decrementCollaboratorCountInData(filefolderId, isExternal, riskUpdates);
            } else {
                notifyToast("error", res?.res ?? "Failed to revoke collaborator access");
                setIsPageLoading(false);
            }
        }).catch(() => {
            notifyToast("error", "Failed to revoke collaborator access");
            setIsPageLoading(false);
        });
    };


    const fetchVersionsForAFilefolder = async (filefolderId) => {
        setVersionsLoading(true);
        setVersionsForAFilefolder([]);
        const res = await getRootLevelDataByVersionId({
            contentSprawlId,
            adminCloudId: platform?.adminCloudId ?? "ALL",
            filefolderId,
        });
        if (res?.status === "OK") {
            setVersionsLoading(false);
            setVersionsForAFilefolder(res?.res?.data ?? []);
        } else {
            setVersionsLoading(false);
            setVersionsForAFilefolder([]);
        }
    };

    const handleOpenVersions = (filefolderId, itemName) => {
        setVersionItemName(itemName ?? "");
        setVersionPopupOpen(true);
        fetchVersionsForAFilefolder(filefolderId);
    };

    const fetchDuplicatesForAFilefolder = async () => {
        setDuplicatesLoading(true);
        setDuplicatesPopupOpen(true);
        const res = await getDuplicatesForAFilefolder({
            contentSprawlId,
            adminCloudId: platform?.adminCloudId ?? "ALL",
        });
        if (res?.status === "OK") {
            const list = Array.isArray(res?.res?.data) ? res?.res?.data : (res?.res?.data ?? []);
            const total = res?.res?.totalDocuments ?? res?.res?.data?.totalDocuments ?? 0;
            setDuplicatesData({ data: list, totalDocuments: total });
            setDuplicatesLoading(false);
        }
    };

    return (
        <div className="cf_main_container">
            <SideNav activeTab="Data Hub" subMenuActive="Content Sprawl" />
            <div className="cf_main_content_place">
                <TopNav pageName="Data Deep Dive" backLink="/Data" activeTab="Data" />
                <div className="cf_main_content_place_main deep-drive">
                    <div className="deep-drive__scroll-wrap" ref={scrollWrapRef}>
                        <header className="deep-drive__header">
                            <div className="deep-drive__header-left">
                                <div className="deep-drive__header-left-icon">
                                    <DriveIcon vendorName={platform.vendorName === "GOOGLE_WORKSPACE" ? platform.type === "SHARED_DRIVE" ? "GOOGLE_WORKSPACE" : platform.type === "DRIVE" ? "GOOGLE_WORKSPACE" : platform.vendorName : platform.vendorName} />
                                </div>
                                <div>
                                    <h1 className="deep-drive__title">{platform.platform}</h1>
                                    {/* <span>{platform.type}</span> */}
                                </div>
                            </div>
                            <div className="deep-drive__header-right">
                                <span className="deep-drive__last-scan">Last scan: {platform.lastScan}</span>
                            </div>
                        </header>

                        <div className="deep-drive__cards" style={{ marginTop: "20px" }}>
                            <div className="deep-drive__stat-card" style={{ position: "relative" }}>
                                <span className="deep-drive__stat-label">Total Files/Folders</span>
                                <span className="deep-drive__stat-value">{platform.totalFiles}{" "}<span style={{ fontSize: "12px", color: "#5f6368", fontWeight: "500" }}>({getSizeFormatted(platform.totalSize ?? 0)})</span></span>
                                {/* <span className="deep-drive__stat-value" style={{ fontSize: "12px", position: "absolute", bottom: "5px", right: "5px", color: "#5f6368" }}>
                                    {platform.vendorName === "MICROSOFT_OFFICE_365" ? "" : <span>Versions Size: <span style={{ fontWeight: "500" }}>{getSizeFormatted(platform.totalVersionSize ?? 0)}</span> </span>}
                                </span> */}
                            </div>

                            <div className="deep-drive__stat-card">
                                <span className="deep-drive__stat-label">Shared Externally</span>
                                <span className="deep-drive__stat-value">{platform.externalFiles}</span>
                            </div>
                            <div className="deep-drive__stat-card">
                                <span className="deep-drive__stat-label">Public Links</span>
                                <span className="deep-drive__stat-value">{platform.publicLinks}</span>
                            </div>
                            {/* <div className="deep-drive__stat-card">
                                <span className="deep-drive__stat-label">Sensitive Files</span>
                                <span className="deep-drive__stat-value">{platform.sensitiveFiles}</span>
                            </div> */}
                            {
                                platform.vendorName === "BOX_BUSINESS" || platform.vendorName === "MICROSOFT_OFFICE_365" ? (
                                    <div className="deep-drive__stat-card" style={{ position: "relative" }}>
                                        <span className="deep-drive__stat-label">Data Size</span>
                                        <span className="deep-drive__stat-value">{getSizeFormatted(platform.totalSize ?? 0)}</span>
                                        <span className="deep-drive__stat-value" style={{ fontSize: "12px", position: "absolute", bottom: "5px", right: "5px", color: "#5f6368" }}>
                                            {platform.vendorName === "MICROSOFT_OFFICE_365" ? "" : <span>Versions Size: <span style={{ fontWeight: "500" }}>{getSizeFormatted(platform.totalVersionSize ?? 0)}</span> </span>}
                                        </span>
                                    </div>) :
                                    (<div className="deep-drive__stat-card">
                                        <span className="deep-drive__stat-label">Stale Content</span>
                                        <span className="deep-drive__stat-value">{platform.staleFiles}</span>
                                    </div>)
                            }
                            <div className="deep-drive__stat-card">
                                <span className="deep-drive__stat-label">Duplicates</span>
                                <span className={`deep-drive__stat-value ${platform.duplicatesCount > 0 ? "cf_make_link" : ""}`}
                                    onClick={fetchDuplicatesForAFilefolder}
                                >{formatCount(platform.duplicatesCount ?? 0)}</span>
                                {/* <button type="button" className="data-dashboard__btn data-dashboard__btn--review">
                                    <span className="data-dashboard__btn-icon" aria-hidden>📋</span>
                                    Review Duplicates
                                </button> */}
                            </div>
                        </div>

                        <div className="deep-drive__toolbar CF_d-flex" style={{ marginTop: "20px" }}>
                            <SearchComponent
                                autoOpen
                                defaultVal={search}
                                canResetDefaultVal
                                inputPlaceHolder="Search files and folders..."
                                onInputSearch={({ searchInput }) => debouncedSetSearch(searchInput)}
                                customStyles={{ minWidth: "240px" }}
                            />
                            <span style={{ marginLeft: "auto" }}></span>
                            <div className="cf_new_dashboard_info_pannel_title cf_new_dashboard_info_pannel_title_alignment" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: "0", width: "fit-content" }}>
                                {/* <div className="cf_graph_toggler" style={{ backgroundColor: "#f2f3ff" }}>
                                    <div className={`cf_graph_toggler_item blueActive ${viewType === "list" ? "cf_graph_toggler_item_active cf_active_blue" : ""}`} onClick={() => setViewTypeAndResetListPath("list")} style={{ gap: "6px" }}>
                                        <ListTree size={14} />
                                    </div>
                                    <div className={`cf_graph_toggler_item blueActive ${viewType === "table" ? "cf_graph_toggler_item_active cf_active_blue" : ""}`} onClick={() => setViewTypeAndResetListPath("table")} style={{ gap: "6px" }}>
                                        <Table size={14} />
                                    </div>
                                </div> */}
                            </div>
                        </div>

                        <div className="deep-drive__table-card" style={{ marginTop: "20px" }}>
                            {viewType === "table" ? (
                                <table className="deep-drive__table">
                                    <thead>
                                        <tr>
                                            <th><span className="deep-drive__th-content"><span>Name</span></span></th>
                                            <th><span className="deep-drive__th-content"><span>Owner</span></span></th>
                                            <th style={{ paddingLeft: "10px" }}>
                                                <span className="deep-drive__th-content">
                                                    <span>Size</span>
                                                    <button
                                                        type="button"
                                                        className="deep-drive__sort-cycle-btn"
                                                        onClick={() => setFileSizeSort((prev) => nextSortCycle(prev))}
                                                        title={fileSizeSort === "DESC" ? "Largest first" : fileSizeSort === "ASC" ? "Smallest first" : "Sort by Size"}
                                                    >
                                                        <SortCycleIcon value={fileSizeSort} size={14} />
                                                    </button>
                                                </span>
                                            </th>
                                            <th>
                                                <span className="deep-drive__th-content">
                                                    <span>Sharing</span>
                                                    <CustomDropDown
                                                        customDropDownStyles={{ width: "120px", right: 0 }}
                                                        defaultVal={SHARING_OPTIONS.find((o) => o.key === sharingFilter) || SHARING_OPTIONS[0]}
                                                        dropDownList={SHARING_OPTIONS}
                                                        selectFilter={(data) => setSharingFilter(data?.key ?? "")}
                                                    >
                                                        <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap"><BiFilterAlt size={14} aria-hidden /></span>
                                                    </CustomDropDown>
                                                </span>
                                            </th>
                                            <th>
                                                <span className="deep-drive__th-content">
                                                    <span>Sensitivity</span>
                                                    <CustomDropDown
                                                        customDropDownStyles={{ width: "120px", right: 0 }}
                                                        defaultVal={RISK_LEVEL_OPTIONS.find((o) => o.key === riskLevelFilter) || RISK_LEVEL_OPTIONS[0]}
                                                        dropDownList={RISK_LEVEL_OPTIONS}
                                                        selectFilter={(data) => setRiskLevelFilter(data?.key ?? "")}
                                                    >
                                                        <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap"><BiFilterAlt size={14} aria-hidden /></span>
                                                    </CustomDropDown>
                                                </span>
                                            </th>
                                            <th style={{ textAlign: "center" }}>
                                                <span className="deep-drive__th-content">
                                                    <span>Collaborators</span>
                                                    <button
                                                        type="button"
                                                        className="deep-drive__sort-cycle-btn"
                                                        onClick={() => setSortCollaboratorsSort((prev) => nextSortCycle(prev))}
                                                        title={sortCollaboratorsSort === "DESC" ? "Most first" : sortCollaboratorsSort === "ASC" ? "Least first" : "Sort by Collaborators"}
                                                    >
                                                        <SortCycleIcon value={sortCollaboratorsSort} size={14} />
                                                    </button>
                                                </span>
                                            </th>
                                            <th>
                                                {
                                                    platform.vendorName === "BOX_BUSINESS" ? (<span className="deep-drive__th-content">
                                                        <span>Versions Count</span>
                                                    </span>) :
                                                        (<span className="deep-drive__th-content">
                                                            <span>Stale</span>
                                                            <CustomDropDown
                                                                customDropDownStyles={{ width: "120px", right: 0 }}
                                                                defaultVal={STALE_TYPE_OPTIONS.find((o) => o.key === staleTypeFilter) || STALE_TYPE_OPTIONS[0]}
                                                                dropDownList={STALE_TYPE_OPTIONS}
                                                                selectFilter={(data) => setStaleTypeFilter(data?.key ?? "")}
                                                            >
                                                                <span className="CF_Pointer CF_d-flex ai-center deep-drive__th-icon-wrap"><BiFilterAlt size={14} aria-hidden /></span>
                                                            </CustomDropDown>
                                                        </span>)
                                                }
                                            </th>
                                            <th style={{ paddingLeft: "10px" }}>
                                                <span className="deep-drive__th-content">
                                                    <span>Modified</span>
                                                    <button
                                                        type="button"
                                                        className="deep-drive__sort-cycle-btn"
                                                        onClick={() => {
                                                            setListModifiedFromDate(null);
                                                            setListLastAccessedFromDate(null);
                                                            setModifiedDateSort((prev) => nextSortCycle(prev));
                                                        }}
                                                        title={modifiedDateSort === "DESC" ? "Newest first" : modifiedDateSort === "ASC" ? "Oldest first" : "Sort by Modified"}
                                                    >
                                                        <SortCycleIcon value={modifiedDateSort} size={14} />
                                                    </button>
                                                </span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {isDataLoading ? (
                                            <tr>
                                                <td colSpan={7} className="deep-drive__loading-cell">
                                                    {getCFTextLoader()}
                                                </td>
                                            </tr>
                                        ) : rootLevelData.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="deep-drive__empty-cell">
                                                    No folders or drives found.
                                                </td>
                                            </tr>
                                        ) : (
                                            rootLevelData.map((item) => renderRow(item, 0))
                                        )}
                                    </tbody>
                                </table>
                            ) : (
                                <DataFolderDisplay
                                    contentSprawlId={contentSprawlId}
                                    getExportPayload={getListExportPayload}
                                    breadcrumbPath={listViewPath}
                                    currentItems={listViewCurrentItems}
                                    isLoading={listViewLoading}
                                    platform={platform}
                                    onBreadcrumbClick={handleListBreadcrumbClick}
                                    onFolderClick={handleListFolderClick}
                                    onCollaboratorsClick={handleOpenCollaborators}
                                    normalizeRow={normalizeRow}
                                    getRelativeImage={getRelativeImage}
                                    isRootLoading={isDataLoading}
                                    onOpenVersions={handleOpenVersions}
                                    filterConfig={{
                                        sharing: { options: SHARING_OPTIONS, value: sharingFilter, onChange: (data) => setSharingFilter(data?.key ?? "") },
                                        sensitivity: { options: RISK_LEVEL_OPTIONS, value: riskLevelFilter, onChange: (data) => setRiskLevelFilter(data?.key ?? "") },
                                        staleType: { options: STALE_TYPE_OPTIONS, value: staleTypeFilter, onChange: (data) => setStaleTypeFilter(data?.key ?? "") },
                                        collaboratorsSort: { value: sortCollaboratorsSort, onCycle: () => setSortCollaboratorsSort((prev) => nextSortCycle(prev)) },
                                        listDateFilters: {
                                            modifiedFrom: {
                                                value: listModifiedDateRange,
                                                onChange: (rangeStr) => {
                                                    setListModifiedDateRange(rangeStr);
                                                    if (rangeStr) setModifiedDateSort("");
                                                },
                                            },
                                            lastAccessedFrom: {
                                                value: listLastAccessedDateRange,
                                                onChange: (rangeStr) => setListLastAccessedDateRange(rangeStr),
                                            },
                                        },
                                        sizeSort: { value: fileSizeSort, onCycle: () => setFileSizeSort((prev) => nextSortCycle(prev)) },
                                    }}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <CollaboratorsPopup
                isOpen={collaboratorsPopupOpen}
                onClose={() => setCollaboratorsPopupOpen(false)}
                collaborators={collaboratorsList}
                itemName={collaboratorsItemName}
                isLoading={collaboratorsLoading}
                onRevokeAccess={handleRevokeCollaboratorAccess}
            />
            <VersionFiles
                isOpen={versionPopupOpen}
                onClose={() => setVersionPopupOpen(false)}
                itemName={versionItemName}
                versions={versionsForAFilefolder}
                isLoading={versionsLoading}
                getRelativeImage={getRelativeImage}
            />
            <DisplayDuplicates
                isOpen={duplicatesPopupOpen}
                onClose={() => setDuplicatesPopupOpen(false)}
                duplicatesData={duplicatesData}
                getRelativeImage={getRelativeImage}
                isLoading={duplicatesLoading}
                user={platform.platform}
            />
            {isPageLoading && getCFLoader()}
        </div>
    );
};

export default DataDeepDrive;
