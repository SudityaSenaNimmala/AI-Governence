import * as OTPAuth from "otpauth";
import qr from "qrcode";
import { CircleCheckBig, Shield } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import Popup from "../../../Resuables/Popup/Popup";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { splitAlternate } from "../../../helpers/utils";

export const generateKey = async (a, b, c, d, e) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify([a, b, c, d, e]));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export const validateMFACode = (mfaCode, secretKey) => {
    const tokenStr = String(mfaCode ?? "").trim();
    if (!secretKey) return;
    const secret = OTPAuth.Secret.fromHex(secretKey);
    const delta = OTPAuth.TOTP.validate({
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        token: tokenStr,
        secret,
        window: 1,
    });
    const isVerify = delta !== null;
    return isVerify;
};

const MFA = ({ isPopupOpen = true, onClose = () => { }, mfaStatus, setMfaStatus }) => {
    const navigate = useNavigate();
    const { globalContext } = useContext(GlobalContext);
    const { user } = globalContext;
    const [qrImg, setQrImg] = useState("");
    const [qrURL, setQrURL] = useState("");
    const [tokA, setTokA] = useState("");
    const [secretKey, setSecretKey] = useState("");
    const [isMFAValid, setIsMFAValid] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    useEffect(() => {
        if (user) {
            let randomKey = "";
            if (!mfaStatus?.isEnabled) {
                randomKey = crypto.randomUUID();
                setMfaStatus({ ...mfaStatus, secretKey: randomKey });
            } else {
                randomKey = user?.contentUserId ?? "";
            }
            generateKey(splitAlternate(user.id), splitAlternate(user.email), splitAlternate(user?.publicId), splitAlternate(user.domain), splitAlternate(randomKey)).then((key) => {
                setSecretKey(key);
                generateQrCode(key);
            });
        }
    }, [user]);

    const generateQrCode = async (key) => {
        const secret = OTPAuth.Secret.fromHex(key);
        const totp = new OTPAuth.TOTP({
            issuer: "CloudFuzeManage|" + user.domain,
            label: `${user.email}`,
            algorithm: "SHA1",
            digits: 6,
            period: 30,
            secret,
        });
        const uri = totp.toString();
        setQrURL(uri);
    }

    useEffect(() => {
        if (!qrURL) return;
        qr.toDataURL(qrURL, (err, img_data) => {
            if (!err) setQrImg(img_data);
        });
    }, [qrURL]);

    const validateToken = () => {
        let isVerify = validateMFACode(tokA, secretKey);
        if (isVerify) {
            setIsMFAValid(true);
            setErrorMessage("");
            setMfaStatus({ ...mfaStatus, isValid: true });
        } else {
            setIsMFAValid(false);
            setErrorMessage("Invalid Code");
        }
    };

    return (
        <Popup
            options={{
                isOpen: isPopupOpen,
                title: `Multi-Factor Authentication`,
                popupWidth: "30%",
                // type: "side",
                popupHeight: "fit-content",
                popupTop: "100px",
                maxHeight: "600px",
                overflowY: "auto",
                parentStyles: {
                    // justifyContent: "flex-end",
                },
            }}
            toggleOpen={onClose}
        >
            <div
                style={{
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "20px",
                }}
            >
                {/* <div style={{ display: "flex", justifyContent: "center", color: "#0062ff" }}>
                    <Shield size={40} strokeWidth={2} />
                </div> */}
                <h2
                    style={{
                        margin: 0,
                        fontSize: "18px",
                        fontWeight: 600,
                        color: "#374151",
                        textAlign: "center",
                    }}
                >
                    {!mfaStatus?.isEnabled ? "Enable Multi-Factor Authentication" : "Disable Multi-Factor Authentication"}
                </h2>

                {!mfaStatus?.isEnabled ? <p
                    style={{
                        marginTop: "-10px",
                        fontSize: "14px",
                        color: "#6b7280",
                        textAlign: "center",
                    }}
                >
                    Scan this QR code with your authenticator app
                </p> : ""}

                {!mfaStatus?.isEnabled ? <div
                    style={{
                        width: "fit-content",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        minHeight: "200px",
                        backgroundColor: "#fff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        padding: "4px",
                    }}
                >
                    {isMFAValid ? (
                        <div
                            style={{
                                width: "200px",
                                height: "200px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <CircleCheckBig size={80} color="#22c55e" strokeWidth={1} />
                        </div>
                    ) : qrImg ? (
                        <img
                            src={qrImg}
                            alt="QR Code"
                            style={{ width: "200px", height: "200px", objectFit: "contain" }}
                        />
                    ) : (
                        <div
                            style={{
                                width: "180px",
                                height: "180px",
                                backgroundColor: "#f3f4f6",
                                borderRadius: "8px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#9ca3af",
                                fontSize: "14px",
                            }}
                        >
                            <div
                                className="cf_domainSpinner"
                                style={{ width: "60px", height: "60px" }}
                            ></div>
                        </div>
                    )}
                </div> : ""}

                {!mfaStatus?.isEnabled ? <div
                    style={{
                        width: "100%",
                        padding: "12px 16px",
                        backgroundColor: isMFAValid ? "#dcfce7" : "#f1f5f9",
                        borderRadius: "8px",
                        textAlign: "center",
                        border: isMFAValid ? "1px solid #22c55e" : "1px solid rgba(124, 58, 237, 0.2)",
                    }}
                >
                    <p
                        style={{
                            margin: 0,
                            fontSize: "12px",
                            color: isMFAValid ? "#16a34a" : "#0062ff",
                            lineHeight: 1.5,
                            fontWeight: 500,
                        }}
                    >
                        {isMFAValid
                            ? "MFA configured successfully"
                            : "After scanning, enter the 6-digit code from your authenticator app to confirm setup."}
                    </p>
                </div> : ""}

                {!isMFAValid && (
                    <>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={tokA}
                            placeholder="000000"
                            autoFocus={true}
                            onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, "");
                                setTokA(val);
                            }}
                            style={{
                                width: "100%",
                                padding: "10px 14px",
                                fontSize: "16px",
                                letterSpacing: "8px",
                                textAlign: "center",
                                border: "1px solid #e5e7eb",
                                borderRadius: "6px",
                                boxSizing: "border-box",
                            }}
                        />
                        {errorMessage ? (
                            <div
                                style={{
                                    width: "100%",
                                    padding: "12px 16px",
                                    backgroundColor: "#ffe4e4",
                                    borderRadius: "8px",
                                    textAlign: "center",
                                    border: "1px solid #ff0000",
                                }}
                            >
                                <p
                                    style={{
                                        margin: 0,
                                        fontSize: "12px",
                                        color: "red",
                                        lineHeight: 1.5,
                                        fontWeight: 500,
                                    }}
                                >
                                    {errorMessage}
                                </p>
                            </div>
                        ) : null}
                        <ButtonComponent
                            buttonName="Continue"
                            buttonClickAction={validateToken}
                            inputWidth="100%"
                            isLoading={false}
                            isDisabled={tokA?.length !== 6}
                            customstyles={{
                                color: "#fff",
                                border: "none",
                                borderRadius: "8px",
                            }}
                        />
                    </>
                )}
            </div>
        </Popup>
    );
};

export default MFA;
