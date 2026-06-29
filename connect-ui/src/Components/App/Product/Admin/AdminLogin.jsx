import React, { useState } from "react";
import { cloudImageMapper } from "../../../helpers/helpers";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import axios from "axios";
const AdminLogin = () => {
  const [loginDetails, setLoginDetails] = useState({
    email: "",
    password: "",
  });
  const getFormInputs = (input, inputFrom) => {
    setLoginDetails({ ...loginDetails, [inputFrom]: input });
  };
  const submitForm = async () => {
    const login = await axios.post(
      `http://localhost:8011/user/login`,
      loginDetails
    );
  };
  return (
    <div className="cf_product_login_div">
      <div className="cf_product_login_div_loginPannel">
        <div className="cf_product_login_div_loginPannel_title">
          <img src={cloudImageMapper("CloudFuze")} alt="" />
        </div>
        <div className="cf_product_login_div_loginPannel_title_heading">
          <h2>CloudFuze Product Portal Admin Login</h2>
        </div>
        <div className="cf_product_login_div_loginPannel_login_form">
          <div>
            <TextInput
              type="email"
              placeHolder="Email *"
              inputName="email"
              autoFocus={true}
              getInputText={(val, name) => getFormInputs(val, name)}
            />
          </div>
          <div>
            <TextInput
              type="password"
              placeHolder="Password *"
              inputName="password"
              getInputText={(val, name) => getFormInputs(val, name)}
            />
          </div>
          <div>
            <ButtonComponent
              isLoading={false}
              isDisabled={false}
              buttonName="Login"
              buttonClickAction={() => submitForm()}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
