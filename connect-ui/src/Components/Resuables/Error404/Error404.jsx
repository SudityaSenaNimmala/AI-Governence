import { useNavigate } from "react-router-dom";
import ButtonComponent from "../InputsComponents/ButtonComponent";
import "./css/404.css";
import { cloudImageMapper } from "../../helpers/helpers";

const Error404 = () => {
  const navigate = useNavigate();

  return (
    <div className="cf_404Container">
      <div className="cf_404Placer" style={{ flexDirection: "column" }}>
        <img
          src={cloudImageMapper("CF")}
          alt="404"
          style={{ width: "100px" }}
        />
        <div className="cf_404Text">404</div>
        <div className="cf_404Text" style={{ fontWeight: "400" }}>
          Page Not Found
        </div>
        <div>
          <p
            className="cf_404Text"
            style={{ fontWeight: "400", fontSize: "1rem" }}
          >
            Oops! The page you're looking for seems to have flown away.
          </p>
        </div>
        <div>
          <ButtonComponent
            inputWidth="140px"
            isLoading={false}
            isDisabled={false}
            buttonName="Take Me Home"
            buttonClickAction={() => navigate("/Dashboard")}
          />
        </div>
      </div>
    </div>
  );
};

export default Error404;
