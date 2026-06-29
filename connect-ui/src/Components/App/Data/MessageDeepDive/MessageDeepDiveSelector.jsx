import React from "react";
import { useLocation, useParams } from "react-router-dom";
import TeamsMessageDeepDive from "./TeamsMessageDeepDive";
import MessageDeepDive from "./MessageDeepDive";

const getVendorName = (contentSprawlId, location) => {
    const fromState = location.state?.platform?.vendorName;
    if (fromState) return fromState;
    try {
        const raw = localStorage.getItem("contentSprawl_" + contentSprawlId);
        return raw ? JSON.parse(raw)?.vendorName : null;
    } catch {
        return null;
    }
};

const MessageDeepDiveSelector = () => {
    const location = useLocation();
    const { contentSprawlId } = useParams();
    const vendorName = getVendorName(contentSprawlId, location);

    if (vendorName === "MICROSOFT_TEAMS") {
        return <TeamsMessageDeepDive />;
    }
    return <MessageDeepDive />;
};

export default MessageDeepDiveSelector;
