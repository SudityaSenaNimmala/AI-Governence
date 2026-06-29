import { axiosRequest } from "../../../helpers/apiRequest";
import { POLICY_TYPE } from "./dataPolicyConstants";

const POLICY_PATH = "/common/contentSprawl/policy";

export const deriveDocumentTypeFields = (policies) => ({
    external: policies.some((p) => p.policyType === POLICY_TYPE.EXTERNAL_SHARING)
        ? POLICY_TYPE.EXTERNAL_SHARING
        : null,
    stale: policies.some((p) => p.policyType === POLICY_TYPE.STALE_CONTENT)
        ? POLICY_TYPE.STALE_CONTENT
        : null,
    duplicate: policies.some((p) => p.policyType === POLICY_TYPE.DUPLICATE_FILES)
        ? POLICY_TYPE.DUPLICATE_FILES
        : null,
});

/** GET returns an array of {@link ContentSprawlPolicy} documents. */
export const fetchContentSprawlPolicies = async () => {
    return axiosRequest({ method: "GET", path: POLICY_PATH });
};

/** Upsert: same POST as create; send full body including `id` when updating. */
export const saveContentSprawlPolicyDocument = async (body) => {
    return axiosRequest({ method: "POST", path: POLICY_PATH, body });
};
