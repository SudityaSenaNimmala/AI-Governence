import { useContext, useEffect, useRef, useState } from "react";
import { cloudImageMapper, getRandomArray } from "../../../helpers/helpers";
import { getMaxChar, notifyToast, validateEmail } from "../../../helpers/utils";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import {
  getAssessmentCandidates,
  getAssessments,
  inviteUsersToAssessment,
} from "../DemoActions/DemoActions";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { Check } from "lucide-react";
import OrgSelector from "../../../Resuables/OrgSelector/OrgSelector";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getAssessmentsList } from "../../SaaSManagement/SaaSActions/SaaSActions";
import Popup from "../../../Resuables/Popup/Popup";
import SelectDropDown from "../../../Resuables/SelectDropDown/SelectDropDown";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";

const SaaSAssessmentInvitation = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 100,
    totalPages: 1,
    totalDocuments: 0,
  });
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [assessmentsList, setAssessmentsList] = useState([]);
  const { globalContext } = useContext(GlobalContext);
  const [isVisible, setIsVisible] = useState(false);
  const [selectedAssessment, setSelectedAssessment] = useState({});
  const { memberId, providerName, usersCount, id } = {
    ...globalContext?.saasCloud,
  };
  const [newInvite, setNewInvite] = useState({
    email: "",
    firstName: "",
    lastName: "",
  });

  const fetchAssessmentCandidates = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    assessment = "ALL",
    status = "ALL",
    searchVal = searchFilter
  ) => {
    setIsLoading(true);
    let res = await getAssessmentCandidates(
      id,
      pageNo,
      pageSize,
      assessment,
      status,
      searchVal,
      true
    );
    if (res?.status === "OK" && res?.res) {
      setIsLoading(false);
      setUsersList(res?.res?.data);
      if (pageNo === 1) {
        setPagination({
          ...pagination,
          totalDocuments: res?.res?.totalDocuments,
          totalPages: Math.ceil(res?.res?.totalDocuments / pageSize),
        });
      }
    } else {
      setIsLoading(false);
    }
  };

  const searchDebounce = useRef(null);
  const searchUsersList = async (e) => {
    setSearchFilter(e);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        fetchAssessmentCandidates(1, 100, "ALL", "ALL", e);
      }, 500);
    } else {
      fetchAssessmentCandidates(1, 100, "ALL", "ALL", null);
    }
  };

  useEffect(() => {
    fetchAssessmentsList();
  }, [id]);

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchAssessmentCandidates(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchAssessmentCandidates(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const selectUserAction = (e, data) => {
    if (e.target.checked) {
      if (data === "ALL") {
        setSelectedUsers(usersList);
      } else {
        setSelectedUsers([...selectedUsers, data]);
      }
    } else {
      if (data === "ALL") {
        setSelectedUsers([]);
      } else {
        setSelectedUsers(
          selectedUsers.filter((res) => res?.email !== data?.email)
        );
      }
    }
  };

  const fetchAssessmentsList = async () => {
    setIsPageLoading(true);
    const res = await getAssessments(id, 1, 500);
    if (res?.status === "OK") {
      let newList = [];
      if (res?.res?.data?.length > 0) {
        res?.res?.data?.map((ass) => {
          return newList.push({
            id: ass?.assessmentId,
            name: ass?.assessmentName,
          });
        });
      }
      setSelectedAssessment(newList[0]);
      setAssessmentsList(newList);
      fetchAssessmentCandidates();
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const inviteUsers = async () => {
    // setIsLoading(true);
    if (newInvite?.email) {
      if (!validateEmail(newInvite?.email)) {
        setIsLoading(false);
        return notifyToast("error", "Please enter a valid email");
      }
    }
    setIsVisible(false);
    setIsPageLoading(true);
    let body = {};
    let data = [];
    if (selectedUsers?.length > 0) {
      selectedUsers?.map((res) => {
        data.push({
          assessId: selectedAssessment?.id,
          email: res?.email,
          firstName: res?.firstName,
          lastName: res?.lastName,
        });
      });
    } else {
      data.push({
        assessId: selectedAssessment?.id,
        email: newInvite?.email,
        firstName: newInvite?.firstName,
        lastName: newInvite?.lastName,
      });
    }
    body.invitations = data;
    body.sendEmails = true;
    let res = await inviteUsersToAssessment(id, body);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "Invite sent successfully");
      fetchAssessmentCandidates();
      setSelectedUsers([]);
      setNewInvite({
        email: "",
        firstName: "",
        lastName: "",
      });
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed to send invite");
    }
  };

  return (
    <>
      <div
        className="cf_saas_options"
        style={{ marginTop: "10px", height: "40px", gap: "15px" }}
      >
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          customStyles={{ width: "350px", height: "40px" }}
          customButtonStyles={{
            background: "transparent",
            color: "rgb(255, 255, 255)",
            fontWeight: "bolder",
            height: "35px",
          }}
          inputPlaceHolder={
            providerName == "JIRA"
              ? `Search By Name`
              : `Search By Email Or Name`
          }
          onInputSearch={(e) => searchUsersList(e.searchInput)}
        />
        <span style={{ marginLeft: "auto" }}></span>
        {selectedUsers?.length === 0 ? (
          <ActionButton
            customClass={`changeButtonColorOnHover`}
            customStyles={{
              backgroundColor: "#f2f2f2",
              // padding: "8px 12px",
              height: "35px",
            }}
            buttonType="button"
            buttonClickAction={() => {
              setIsVisible(true);
              setNewInvite({
                email: "",
                firstName: "",
                lastName: "",
              });
            }}
          >
            <p style={{ fontSize: "12px", fontWeight: "500" }}>New Invite</p>
          </ActionButton>
        ) : (
          ""
        )}
        {selectedUsers?.length > 0 ? (
          <ActionButton
            customClass={`changeButtonColorOnHover`}
            customStyles={{
              backgroundColor: "#f2f2f2",
              // padding: "8px 12px",
              height: "35px",
            }}
            buttonType="button"
            buttonClickAction={() => {
              setIsVisible(true);
            }}
          >
            <p style={{ fontSize: "12px", fontWeight: "500" }}>Send Invite</p>
          </ActionButton>
        ) : (
          ""
        )}
      </div>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{
          padding: "10px 0 0 0",
          flexDirection: "column",
          height: "fit-content",
        }}
      >
        <div
          className="cf_new_tables_div"
          style={{
            height: "fit-content",
            overflow: "visible",
          }}
        >
          <table>
            <thead>
              <tr>
                <th style={{ width: "1%" }}>
                  <input
                    type="checkbox"
                    onClick={(e) => {
                      selectUserAction(e, "ALL");
                    }}
                    checked={
                      selectedUsers?.length === usersList?.length &&
                      usersList?.length > 0
                    }
                  />
                </th>
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>First Name</span>
                  </div>
                </th>
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Last Name</span>
                  </div>
                </th>
                <th style={{ width: "100px" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <span>Email</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  <tr>
                    <td colSpan={4}>{getCFTextLoader()}</td>
                  </tr>
                  <tr style={{ visibility: "hidden" }}>
                    <td style={{ width: "1%" }}>
                      <input type="checkbox" name="" id="" />
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>vimalesh.t_cloudfuze...odclub.onmicrosoft.com</p>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
                    </td>
                    <td className="cf_new_table_hide_text">
                      <p>User</p>
                    </td>
                  </tr>
                </>
              ) : (
                usersList?.map((res, index) => (
                  <tr key={index}>
                    <td style={{ width: "1%" }}>
                      <input
                        type="checkbox"
                        onClick={(e) => {
                          selectUserAction(e, {
                            assessId: "",
                            firstName: res?.firstName,
                            lastName: res?.lastName,
                            email: res?.email,
                            custom: [""],
                          });
                        }}
                        checked={selectedUsers?.some(
                          (res1) => res1?.email === res?.email
                        )}
                      />
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <img
                          src={res?.logoUrl ?? cloudImageMapper(providerName)}
                          alt="SLACK"
                        />
                        <p title={res?.firstName}>
                          {getMaxChar(res?.firstName, 45)}
                        </p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p title={res?.lastName}>
                          {getMaxChar(res?.lastName, 45)}
                        </p>
                      </div>
                    </td>
                    <td
                      className="cf_new_table_hide_text"
                      style={{ width: "100px" }}
                    >
                      <div className="cf_ManageClouds_table_image_container">
                        <p title={res?.email}>{getMaxChar(res?.email, 45)}</p>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="cf_new_tables_footer">
          <span>Total: {pagination?.totalDocuments} </span>
          <span style={{ marginLeft: "auto" }}></span>
          <span style={{ opacity: "0.5" }}>
            Showing {pagination?.currentPage} of{" "}
            {pagination?.totalPages ? pagination?.totalPages : 1} Page
          </span>
          <span>
            Showing :{" "}
            <select
              className="cf_message_pagination_select"
              name="pageSize"
              value={pagination?.pageSize}
              onChange={handlePagination}
            >
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="300">300</option>
              <option value="400">400</option>
              <option value="500">500</option>
            </select>
            &nbsp;Rows
          </span>
          <span>
            Go to:{" "}
            <select
              className="cf_message_pagination_select"
              name="currentPage"
              value={pagination?.currentPage}
              onChange={handlePagination}
            >
              {getRandomArray(pagination?.totalPages)?.map((data) => {
                return (
                  <option value={data} key={`${data}_DMS`}>
                    {data}
                  </option>
                );
              })}
            </select>
          </span>
        </div>
      </div>

      {isPageLoading ? getCFLoader() : ""}
      <Popup
        options={{
          isOpen: isVisible,
          title: `Assessment Invitation`,
          popupWidth: "50%",
          popupHeight: `fit-content`,
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "30px",
            ...(selectedUsers?.length > 0 ? { height: "80px" } : {}),
          }}
        >
          {/* <div> */}
          <div style={{ width: "100%" }}>
            <SelectDropDown
              onSelect={(e) => setSelectedAssessment(e)}
              placeHolder="Select Assessment"
              defaultSelected={selectedAssessment}
              inputMaxHeight="160px"
              customDivStyles={{
                ...(selectedUsers?.length > 0
                  ? { width: "48%", top: "210px", position: "absolute" }
                  : { width: "100%" }),
              }}
              dropDownContentStyles={{
                ...(selectedUsers?.length > 0 ? { position: "relative" } : {}),
              }}
              dropDownContent={assessmentsList}
            />
          </div>
          {selectedUsers?.length === 0 ? (
            <>
              <TextInput
                type="text"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={newInvite?.email}
                inputName="name"
                placeHolder={`Email`}
                getInputText={(val) => {
                  setNewInvite({ ...newInvite, email: val });
                }}
              />
              <TextInput
                type="text"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={newInvite?.firstName}
                inputName="name"
                placeHolder={`First Name`}
                getInputText={(val) => {
                  setNewInvite({ ...newInvite, firstName: val });
                }}
              />
              <TextInput
                type="text"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={newInvite?.lastName}
                inputName="name"
                placeHolder={`Last Name`}
                getInputText={(val) => {
                  setNewInvite({ ...newInvite, lastName: val });
                }}
              />
            </>
          ) : (
            ""
          )}
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={
              selectedUsers?.length > 0
                ? false
                : !(
                    newInvite?.email &&
                    newInvite?.firstName &&
                    newInvite?.lastName
                  )
            }
            buttonName="Send Invite"
            buttonClickAction={() => {
              inviteUsers();
            }}
          />
        </div>
        {/* </div> */}
      </Popup>
    </>
  );
};

export default SaaSAssessmentInvitation;
