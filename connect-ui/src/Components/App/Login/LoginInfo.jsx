import React from "react";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";

const LoginInfo = (props) => {
  return (
    <>
      <div
        className="cf_login_content_placer"
        style={{ gap: "10px", justifyContent: "space-between" }}
      >
        <div className="cf_domain_icon_placer" style={{ marginTop: "15px" }}>
          <img src={CF_LOGO} alt="CF Logo" />
        </div>
        <h1 style={{ marginTop: "25px" }}>Welcome to CloudFuze Website</h1>
        <p>
          Your one-stop solution for managing cloud office environments, SaaS
          expenses, and more.
        </p>
        <div className="cf_login_button_placer">
          <ButtonComponent
            buttonName="Get Started"
            buttonClickAction={() => props.changeViewState("DOMAIN_SELECTION")}
          />
        </div>
      </div>
      {/* <button
            className="cf_login_button"
            onClick={() => props.changeViewState("DOMAIN_SELECTION")}
          >
            Get Start
          </button> */}
    </>
  );
};

export default LoginInfo;
