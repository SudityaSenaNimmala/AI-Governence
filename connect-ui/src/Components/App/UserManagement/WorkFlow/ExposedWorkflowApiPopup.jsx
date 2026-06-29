import { Copy } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import Popup from "../../../Resuables/Popup/Popup";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCfApiBaseUri } from "../../../helpers/apiRequest";
import { copyToClipboard } from "../../../helpers/utils";
import "./ExposedWorkflowApiPopup.css";

/** Matches backend @PostMapping("/expose/{userId}/{workFlowId}") relative to API base (adjust if controller has a class-level prefix). */
const buildExposePath = (userId, workFlowId) => {
    const uid = encodeURIComponent(userId ?? "");
    const wid = encodeURIComponent(workFlowId ?? "");
    return `/client/workflow/${wid}`;
};

/** Placeholder — replace with the JWT from Settings → CloudFuze Access Token. */
const CF_TOKEN_PLACEHOLDER = "<your_token>";
const cfTokenHeaderLine = `CF-TOKEN: ${CF_TOKEN_PLACEHOLDER}`;

const ExposedWorkflowApiPopup = ({ exposeContext, toggleOpen }) => {
    const isOpen = exposeContext != null && typeof exposeContext === "object";

    const fullUrl = useMemo(() => {
        const base = getCfApiBaseUri().replace(/\/$/, "");
        const path = buildExposePath(exposeContext?.userId, exposeContext?.workFlowId);
        return `${base}${path}`;
    }, [exposeContext?.userId, exposeContext?.workFlowId]);

    const sampleBodyJson = useMemo(
        () =>
            JSON.stringify(["user1@company.com", "user2@company.com"], null, 2),
        []
    );

    const curlExample = useMemo(() => {
        let oneLine;
        try {
            oneLine = JSON.stringify(JSON.parse(sampleBodyJson));
        } catch {
            oneLine = sampleBodyJson.replace(/\s+/g, " ").trim();
        }
        const q = (s) => s.replace(/'/g, "'\\''");
        return `curl -X POST '${q(fullUrl)}' \\\n  -H 'CF-TOKEN: Bearer ${CF_TOKEN_PLACEHOLDER}' \\\n  --data-raw '${q(oneLine)}'`;
    }, [fullUrl, sampleBodyJson]);

    const handleCopy = (text, label) => {
        copyToClipboard(text, label);
    };

    return (
        <Popup
            toggleOpen={toggleOpen}
            options={{
                isOpen,
                title: "Exposed API — Manual workflow",
                type: "side",
                popupWidth: "60%",
                popupHeight: "calc(100% - 0px)",
                popupTop: "00px",
                maxHeight: "100%",
                overflowY: "auto",
                parentStyles: {
                    justifyContent: "flex-end",
                },
            }}
        >
            <div className="exposed-api-popup" style={{ padding: "15px" }}>
                <p className="exposed-api-popup__intro">
                    <strong>POST</strong> to the URL below. Path parameters identify the workflow owner and workflow. The
                    request body is a JSON <strong>array of email strings</strong> (<code>List&lt;String&gt;</code>) for
                    users to run the workflow against.
                </p>

                <div className="exposed-api-popup__block">
                    <div className="exposed-api-popup__block-head">
                        <span className="exposed-api-popup__label">Endpoint (POST)</span>
                        <ActionButton
                            buttonType="button"
                            title="Copy URL"
                            buttonClickAction={() => handleCopy(fullUrl, "URL")}
                            customClass="exposed-api-popup__copy-btn"
                        >
                            <Copy size={14} />
                        </ActionButton>
                    </div>
                    <pre className="exposed-api-popup__code">{fullUrl}</pre>
                </div>

                <div className="exposed-api-popup__block">
                    <div className="exposed-api-popup__block-head">
                        <span className="exposed-api-popup__label">Headers</span>
                        <ActionButton
                            buttonType="button"
                            title="Copy header line"
                            buttonClickAction={() => handleCopy(cfTokenHeaderLine, "Header")}
                            customClass="exposed-api-popup__copy-btn"
                        >
                            <Copy size={14} />
                        </ActionButton>
                    </div>
                    <pre className="exposed-api-popup__code">{cfTokenHeaderLine}</pre>
                    <p className="exposed-api-popup__hint">
                        Send <code>CF-TOKEN</code> with value <code>Bearer</code> followed by a space and your client
                        access token (JWT). Generate or rotate the token under{" "}
                        <Link to="/Settings" className="exposed-api-popup__settings-link">
                            Settings → CloudFuze Access Token
                        </Link>
                        . The token is shown only once when created; use the same format in API clients and cURL (
                        replace <code>{CF_TOKEN_PLACEHOLDER}</code>).
                    </p>
                </div>

                <div className="exposed-api-popup__block">
                    <div className="exposed-api-popup__block-head">
                        <span className="exposed-api-popup__label">Request body (JSON array of emails)</span>
                        <ActionButton
                            buttonType="button"
                            title="Copy JSON"
                            buttonClickAction={() => handleCopy(sampleBodyJson, "JSON")}
                            customClass="exposed-api-popup__copy-btn"
                        >
                            <Copy size={14} />
                        </ActionButton>
                    </div>
                    <pre className="exposed-api-popup__code exposed-api-popup__code--scroll">{sampleBodyJson}</pre>
                    <p className="exposed-api-popup__hint">
                        Replace sample addresses with real recipient emails.
                    </p>
                </div>

                <div className="exposed-api-popup__block">
                    <div className="exposed-api-popup__block-head">
                        <span className="exposed-api-popup__label">cURL example</span>
                        <ActionButton
                            buttonType="button"
                            title="Copy cURL"
                            buttonClickAction={() => handleCopy(curlExample, "cURL")}
                            customClass="exposed-api-popup__copy-btn"
                        >
                            <Copy size={14} />
                        </ActionButton>
                    </div>
                    <pre className="exposed-api-popup__code exposed-api-popup__code--scroll exposed-api-popup__code--small">
                        {curlExample}
                    </pre>
                </div>
            </div>
        </Popup>
    );
};

export default ExposedWorkflowApiPopup;
