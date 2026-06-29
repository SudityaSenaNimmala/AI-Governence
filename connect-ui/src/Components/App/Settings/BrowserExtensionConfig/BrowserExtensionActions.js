import { axiosRequest } from "../../../helpers/apiRequest";

export const getOrgLevelBrowserExtensionConfig = async () => {
    const res = await axiosRequest({
        method: "POST",
        path: "/browserExtension/internal/configuration",
        body: {
            email: null,
            userId: null,
            domain: null,
            role: null,
            department: null,
            location: null,
            division: null,
        },
        isDev: true,
    });
    return res;
};

/**
 * Save full browser extension configuration (BrowserExtensionConfiguration).
 * Body: { id?, email?, userId?, domain?, role?, department?, location?, division?, blockedDomains }
 */
export const saveBrowserExtensionConfig = async (config = {}) => {
    const body = {
        id: config.id ?? config._id ?? null,
        email: config.email ?? null,
        userId: config.userId ?? null,
        domain: config.domain ?? null,
        role: config.role ?? null,
        department: config.department ?? null,
        location: config.location ?? null,
        division: config.division ?? null,
        blockedDomains: Array.isArray(config.blockedDomains) ? config.blockedDomains : [],
    };
    const res = await axiosRequest({
        method: "POST",
        path: "/browserExtension/configs/save",
        body,
        isDev: true,
    });
    return res;
};