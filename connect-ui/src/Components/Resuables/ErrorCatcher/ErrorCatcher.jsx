import { useEffect, useState } from "react";
import ButtonComponent from "../InputsComponents/ButtonComponent";
import { useNavigate } from "react-router-dom";
import { cloudImageMapper } from "../../helpers/helpers";

const ErrorCatcher = ({ children }) => {
  const [error, setError] = useState(null);
  //   const navigate = useNavigate();

  useEffect(() => {
    const handleError = (event) => {
      setError(event.error || new Error("Unknown Error"));
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", (event) => {
      setError(event.reason || new Error("Unhandled Promise Rejection"));
    });

    return () => {
      window.removeEventListener("error", handleError);
    };
  }, []);

  if (error) {
    return (
      <div className="cf_404Container">
        <div className="cf_404Placer" style={{ flexDirection: "column" }}>
          <img
            src={cloudImageMapper("CF")}
            alt="404"
            style={{ width: "100px" }}
          />
          <div className="cf_404Text" style={{ fontWeight: "400" }}>
            Something went wrong
          </div>
          <div
            className="cf_404Text"
            style={{ fontWeight: "500", fontSize: "1rem", color: "red" }}
          >
            {error.message}
          </div>
          <div>
            <p
              className="cf_404Text"
              style={{ fontWeight: "400", fontSize: "1rem" }}
            >
              Report this error to the support team at{" "}
              <a href="mailto:support@cloudfuze.com"> support@cloudfuze.com </a>
            </p>
          </div>
          <div>
            <ButtonComponent
              inputWidth="140px"
              isLoading={false}
              isDisabled={false}
              buttonName="Take Me Home"
              buttonClickAction={() =>
                (window.location.href = "/CloudFuze/Dashboard")
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return children;
};

export default ErrorCatcher;
