import { useState } from "react";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import { notifyToast, validateEmail, validatePassword } from "../../helpers/utils";
import { forgotPasswordRequest } from "./AuthActions/AuthActions";

const ForgotPassword = ({ onBack }) => {
  const [step, setStep] = useState("email"); // "email" | "reset"
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestReset = async () => {
    if (!validateEmail(email)) {
      notifyToast("error", "Please enter a valid email address.");
      return;
    }
    setIsLoading(true);
    let res = await forgotPasswordRequest(email);
    setIsLoading(false);
    if (res?.status === "OK" || res?.statusCode === 206) {
      notifyToast("success", "Password reset link sent! Check your email.");
      setStep("reset");
    } else if (res?.statusCode === 404) {
      notifyToast("error", "No account found with this email.");
    } else {
      notifyToast("error", "Failed to send reset email. Please try again.");
    }
  };

  return (
    <div className="cf_domain_placer" style={{ gap: "15px", alignContent: "center", width: "100%" }}>
      <div className="cf_domain_icon_placer">
        <img src={CF_LOGO} alt="CF Logo" />
      </div>

      <div className="cf_domain_icon_placer" style={{ height: "5%", marginTop: "-10px" }}>
        <h5>{step === "email" ? "Forgot Password" : "Reset Password"}</h5>
      </div>

      <p style={{ fontSize: "12px", color: "#666", textAlign: "center", margin: "-10px 0 0 0", width: "100%" }}>
        {step === "email"
          ? "Enter your registered email and we'll send you a reset token."
          : "A reset password link has been sent to your email. If the email is found, a reset link will be sent."}
      </p>

      <div className="cf_input_wrapper ai-center" style={{ width: "100%", marginTop: "20px" }}>
        {step === "email" ? (
          <>
            <TextInput
              type="email"
              placeHolder="Email *"
              inputName="email"
              autoFocus={true}
              getInputText={(val) => setEmail(val)}
            />
            <ButtonComponent
              isLoading={isLoading}
              isDisabled={!validateEmail(email)}
              buttonName="Send Reset Email"
              buttonClickAction={handleRequestReset}
            />
          </>
        ) : (
          <>
            <p style={{ fontSize: "12px", color: "#666", textAlign: "center", margin: "4px 0 0 0" }}>
              Didn&apos;t receive the reset link?{" "}
              <span
                className="cf_resend_link"
                onClick={() => {
                  setStep("email");
                }}
              >
                Resend
              </span>
            </p>
          </>
        )}

        <p style={{ fontSize: "12px", textAlign: "center", margin: "4px 0 0 0" }}>
          <span className="cf_resend_link" onClick={onBack}>
            Back to Login
          </span>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
