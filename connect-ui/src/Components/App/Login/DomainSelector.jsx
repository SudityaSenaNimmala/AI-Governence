import React, { useState } from "react";
import CF_LOGO from "../../../assets/images/CF_LOGO.png";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import { checkDomainExist } from "./AuthActions/AuthActions";
import { env, notifyToast, parentDomain } from "../../helpers/utils";

const DomainSelector = (props) => {
  const [domainName, setDomainName] = useState({
    domainName: "",
  });

  const [isLoading, setIsLoading] = useState(false);
  const buttonClickAction = async () => {
    setIsLoading(true);
    let checkDomain = await checkDomainExist(domainName?.domainName);
    if (checkDomain?.res === "Domain Already register") {
      window.location = `${window?.location?.protocol}//${domainName?.domainName}.${parentDomain}/CloudFuze#login`;
      setIsLoading(false);
    } else {
      setIsLoading(false);
      notifyToast("error", "Domain Not Registerd With Us...!");
    }
  };

  const getDomainInputData = (input) => {
    setDomainName({
      domainName: input,
    });
  };

  return (
    <div className="cf_domain_placer" style={{ gap: "20px" }}>
      <div className="cf_domain_icon_placer">
        <img src={CF_LOGO} alt="CF Logo" />
      </div>
      <div
        className="cf_domain_icon_placer"
        style={{ height: "5%", marginTop: "0px" }}
      >
        <h5>Enter Domain</h5>
      </div>
      <div className="cf_input_wrapper" style={{ marginTop: "10px" }}>
        <TextInput
          type="text"
          inputWidth="100%"
          placeHolder="Domain Name *"
          inputName="domainName"
          autoFocus={true}
          getInputText={(val) => getDomainInputData(val)}
        />
        <ButtonComponent
          isLoading={isLoading}
          isDisabled={!domainName?.domainName?.length > 0}
          buttonName="Proceed"
          buttonClickAction={() => buttonClickAction()}
        />
      </div>
    </div>
  );
};

export default DomainSelector;
