import { axiosRequest } from "../../helpers/apiRequest";

/** Normalizes UI placeholder and builds POST body for `/common/contetnSprawl/:id` and content-sprawl export. */
export const buildContentSprawlListBody = (params = {}) => {
    const {
        contentSprawlId,
        adminCloudId,
        filefolderId,
        parentId: parentIdParam,
        fileFolderType = "ALL",
        pageNo = 1,
        pageSize = 100,
        searchValue = null,
        /** `yyyy-MM-dd|yyyy-MM-dd` — modified date range (list view calendar) */
        modifiedFromDate = null,
        /** `yyyy-MM-dd|yyyy-MM-dd` — viewed-by-me (last accessed) date range */
        viewedByMeTime = null,
        sortCollaborators = null,
        fileSize = null,
        sharing = null,
        riskLevel = null,
        staleType = null,
    } = params;

    const admin =
        adminCloudId != null && String(adminCloudId).trim() !== "" && adminCloudId !== "—"
            ? adminCloudId
            : "ALL";

    const rawParent =
        filefolderId != null && filefolderId !== ""
            ? filefolderId
            : parentIdParam != null && parentIdParam !== ""
                ? parentIdParam
                : null;
    const parentId = rawParent != null && rawParent !== "" ? String(rawParent) : "ALL";

    return {
        contetnSprawlId: contentSprawlId,
        adminCloudId: admin,
        parentId,
        fileFolderType: fileFolderType || "ALL",
        pageNo: Math.max(Number(pageNo) || 1, 1),
        pageSize: Number(pageSize) || 100,
        searchValue: searchValue ?? null,
        modifiedDate: modifiedFromDate ? JSON.stringify([modifiedFromDate]) : null,
        viewedByMeTime: viewedByMeTime ? JSON.stringify([viewedByMeTime]) : null,
        sortCollaborators: sortCollaborators ?? null,
        fileSize: fileSize ?? null,
        sharing: sharing ?? null,
        riskLevel: riskLevel ?? null,
        staleType: staleType ?? null,
        versionId: null,
    };
};

export const getRootLevelData = async (params = {}) => {
    const path = `/common/contetnSprawl/${params.contentSprawlId}`;
    const body = buildContentSprawlListBody(params);
    const res = await axiosRequest({
        method: "POST",
        path,
        body,
        // isDev: true
    });
    return res;
};

export const getRootLevelDataByVersionId = async ({
    contentSprawlId,
    adminCloudId = "ALL",
    filefolderId = null,
    pageNo = 1,
    pageSize = 100,
}) => {
    const path = `/common/contetnSprawl/${contentSprawlId}`;
    const body = {
        contetnSprawlId: contentSprawlId,
        adminCloudId: adminCloudId || "ALL",
        parentId: "ROOT",
        fileFolderType: "ALL",
        pageNo: Math.max(Number(pageNo) || 1, 1),
        pageSize: Number(pageSize) || 100,
        searchValue: null,
        modifiedDate: null,
        sortCollaborators: null,
        fileSize: null,
        sharing: null,
        riskLevel: null,
        staleType: null,
        versionId: filefolderId,
    };
    const res = await axiosRequest({
        method: "POST",
        path,
        body,
        // isDev: true
    });
    return res;
};

export const getDuplicatesForAFilefolder = async ({
    contentSprawlId,
    adminCloudId = "ALL",
    filefolderId = null,
    pageNo = 1,
    pageSize = 100,
}) => {
    const path = `/common/contetnSprawl/${contentSprawlId}`;
    const body = {
        contetnSprawlId: contentSprawlId,
        adminCloudId: adminCloudId || "ALL",
        parentId: "ROOT",
        fileFolderType: "ALL",
        pageNo: Math.max(Number(pageNo) || 1, 1),
        pageSize: Number(pageSize) || 100,
        searchValue: null,
        modifiedDate: null,
        sortCollaborators: null,
        fileSize: null,
        sharing: null,
        riskLevel: null,
        staleType: null,
        versionId: null,
        duplicate: true
    };
    const res = await axiosRequest({
        method: "POST",
        path,
        body,
        // isDev: true
    });
    return res;
};


export const getContentSprawlInfo = async (activeUsers = true, pageNo = 1, pageSize = 100, email = null, isData = "CONTENT") => {
    const emailParam =
        email != null && String(email).trim() !== ""
            ? String(email).trim()
            : "null";
    const res = await axiosRequest({
        method: "GET",
        path: `/common/contetnSprawlInfo?activeUsers=${activeUsers}&pageNo=${pageNo}&pageSize=${pageSize}&email=${emailParam}&type=${isData}`,
    });
    return res;
};

export const getMessageSprawlInfo = async (activeUsers = true, pageNo = 1, pageSize = 100, email = null) => {
    const emailParam =
        email != null && String(email).trim() !== ""
            ? String(email).trim()
            : "null";
    const res = await axiosRequest({
        method: "GET",
        path: `/common/contetnSprawlInfo?activeUsers=${activeUsers}&pageNo=${pageNo}&pageSize=${pageSize}&email=${emailParam}&type=MESSAGE&mergeRowsByEmail=true`,
    });
    return res;
};

export const getEmailSprawlInfo = async (activeUsers = true, pageNo = 1, pageSize = 100, email = null) => {
    const emailParam =
        email != null && String(email).trim() !== ""
            ? String(email).trim()
            : "null";
    const res = await axiosRequest({
        method: "GET",
        path: `/common/contetnSprawlInfo?activeUsers=${activeUsers}&pageNo=${pageNo}&pageSize=${pageSize}&email=${emailParam}&isData=false&mergeRowsByEmail=true&isEmail=true&type=EMAIL`,
    });
    return res;
};

export const getContentSprawlEmails = async (contentSprawlId, body = {}) => {
    const res = await axiosRequest({
        method: "POST",
        path: `/common/emailFolderDetails/${encodeURIComponent(contentSprawlId)}`,
        body,
    });
    return res;
};

export const runScanContentSprawl = async (list, type = "CONTENT") => {
    const res = await axiosRequest({
        method: "POST",
        path: `/common/contentSprawl/run?type=${type}`,
        body: list,
    });
    return res;
};

export const initiateDeltaScan = async (contentSprawlId) => {
    const res = await axiosRequest({
        method: "POST",
        path: `/common/contentSprawl/runDelta/${encodeURIComponent(contentSprawlId)}`,
    });
    return res;
};


export const exportContentSprawlReport = async (params = {}) => {
    const encId = encodeURIComponent(params.contentSprawlId ?? "");
    const path = `/common/contentSprawl/export/${encId}`;
    const body = buildContentSprawlListBody(params);
    const res = await axiosRequest({
        method: "POST",
        path,
        body,
    });
    return res;
};

export const getCollaborators = async (filefolderId = null, contentSprawlId = null) => {
    const res = await axiosRequest({
        method: "GET",
        path: `/common/collabarators?filefolderId=${filefolderId}&contentSprawlId=${contentSprawlId}`,
    });
    return res;
};

export const deletePermissionFromFileFolder = async ({ id }) => {
    const res = await axiosRequest({
        method: "DELETE",
        path: `/common/permission/${encodeURIComponent(id || "")}`,
    });
    return res;
};



export const getContentSprawlMessages = async (contentSprawlId, body = {}) => {
    const res = await axiosRequest({
        method: "POST",
        path: `/common/contetnSprawl/message/${encodeURIComponent(contentSprawlId)}`,
        body,
    });
    return res;
};

export const getChannelMembers = async (channelId = null, contentSprawlId = null) => {
    const res = await axiosRequest({
        method: "GET",
        path: `/common/collabarators?filefolderId=${channelId}&contentSprawlId=${contentSprawlId}`,
    });
    return res;
};

export const getDuplicatesForAFilefolderByChecksum = async (body) => {
    const path = `/common/contetnSprawl/${body?.contetnSprawlId}`;

    const res = await axiosRequest({
        method: "POST",
        path,
        body,
        // isDev: true
    });
    return res;
};
