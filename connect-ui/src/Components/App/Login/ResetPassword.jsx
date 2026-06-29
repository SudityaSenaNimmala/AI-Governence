import md5 from "md5";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import { notifyToast, validatePassword } from "../../helpers/utils";
import { resetPassword, verifyResetToken } from "./AuthActions/AuthActions";
import "./css/Login.css";

const ResetPassword = () => {
  const { email, token } = useParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState("verifying"); // "verifying" | "valid" | "invalid"
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState({})

  useEffect(() => {
    verifyToken();
  }, []);

  const verifyToken = async () => {
    let res = await verifyResetToken(token, email);
    if (res?.res === "Configure New Password" || res?.statusCode === 202) {
      setStatus("valid");
    } else {
      setStatus("invalid");
    }
  };

  const handleReset = async () => {
    setError({})
    if (validatePassword(newPassword)) {
      setError({
        newPassword: validatePassword(newPassword)
      })
      return;
    }
    if (validatePassword(confirmPassword)) {
      setError({
        confirmPassword: validatePassword(confirmPassword)
      })
      return;
    }
    if (newPassword !== confirmPassword) {
      setError({
        confirmPassword: "Passwords do not match."
      })
      return;
    }
    setIsLoading(true);
    let res = await resetPassword(token, md5(newPassword));
    setIsLoading(false);
    // Backend returns 201 CREATED for success, 400 BAD_REQUEST for expired
    if (res?.res === "Password Reset Success. Please Login" || res?.statusCode === 201) {
      notifyToast("success", "Password reset successfully! Please log in.");
      navigate("/#login");
    } else {
      notifyToast("error", res?.res || "Link expired. Please request a new reset link.");
      setStatus("invalid");
    }
  };

  const EmailBadge = () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "#f2f3ff",
        border: "1px solid #e0e7ff",
        borderRadius: "6px",
        padding: "8px 14px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#001a6f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <span style={{ fontSize: "13px", color: "#001a6f", fontWeight: "500", wordBreak: "break-all" }}>
        {decodeURIComponent(email)}
      </span>
    </div>
  );

  const renderContent = () => {
    if (status === "verifying") {
      return (
        <div className="cf_domain_placer" style={{ gap: "20px", justifyContent: "center" }}>
          <div className="cf_domain_icon_placer">
            <img src={CF_LOGO} alt="CF Logo" />
          </div>
          <div className="cf_domain_icon_placer" style={{ height: "5%", marginTop: "-10px" }}>
            <h5>Verifying your link...</h5>
          </div>
          <div style={{ marginTop: "10px" }}>
            {getCFLoader()}
          </div>
        </div>
      );
    }

    if (status === "invalid") {
      return (
        <div className="cf_domain_placer" style={{ gap: "20px", justifyContent: "center" }}>
          <div className="cf_domain_icon_placer">
            <img src={CF_LOGO} alt="CF Logo" />
          </div>
          <div className="cf_domain_icon_placer" style={{ height: "5%", marginTop: "-10px" }}>
            <h5>Link Invalid or Expired</h5>
          </div>
          <p style={{ fontSize: "12px", color: "#666", textAlign: "center", margin: "-10px 0 0 0", width: "100%" }}>
            This password reset link is no longer valid. Please request a new one.
          </p>
          <div className="cf_input_wrapper ai-center" style={{ width: "100%" }}>
            <ButtonComponent
              buttonName="Back to Login"
              buttonClickAction={() => navigate("/#login")}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="cf_domain_placer" style={{ gap: "20px", justifyContent: "center" }}>
        <div className="cf_domain_icon_placer">
          <img src={CF_LOGO} alt="CF Logo" />
        </div>
        <div className="cf_domain_icon_placer" style={{ height: "5%", marginTop: "-10px" }}>
          <h5>Set New Password</h5>
        </div>
        <p style={{ fontSize: "12px", color: "#666", textAlign: "center", margin: "-10px 0 0 0", width: "100%" }}>
          Enter and confirm your new password for
        </p>
        <div className="cf_input_wrapper" style={{ marginTop: "-10px" }}>
          <EmailBadge />
          <TextInput
            type="password"
            placeHolder="New Password *"
            inputName="newPassword"
            autoFocus={true}
            getInputText={(val) => setNewPassword(val)}
            errorData={error?.newPassword}
          />
          <TextInput
            type="password"
            placeHolder="Confirm Password *"
            inputName="confirmPassword"
            autoFocus={false}
            getInputText={(val) => setConfirmPassword(val)}
            errorData={error?.confirmPassword}
          />
          <ButtonComponent
            isLoading={isLoading}
            isDisabled={!newPassword || !confirmPassword}
            buttonName="Reset Password"
            buttonClickAction={handleReset}
          />
          <p style={{ fontSize: "12px", textAlign: "center", margin: "4px 0 0 0" }}>
            <span className="cf_resend_link" onClick={() => navigate("/#login")}>
              Back to Login
            </span>
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="cf_login_bg">
      <div className="cf_login_bg_part_1">
        <div className="cf_login_bg_part_2">
          <div
            className="cf_login_placer"
            style={{ width: "50%", height: "fit-content", minHeight: "45%" }}
          >
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
