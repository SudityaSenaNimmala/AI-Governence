import { Bell, Calendar1, Check } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import moment from "moment";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import {
  getNotificationsList,
  markNotificationAsDone,
} from "../../App/UserManagement/UserManagementActions/UserManagementActions";
import {
  getDateFormatted,
  getMomentAgo,
  makeFirstLetterCapital,
} from "../../helpers/utils";
import { getCFTextLoader } from "../Loaders/Loaders";
import ActionButton from "../InputsComponents/ActionButton";
import {
  SET_MAPPED_PAIRS,
  SET_UPDATE_JOB_PARAMS,
} from "../../../GlobalContext/action.types";

const Notifications = () => {
  const [notificationList, setNotificationList] = useState([]);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { cloudsList } = { ...globalContext };
  const { billingSummary } = globalContext;
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState({
    pageSize: 50,
    currentPage: 1,
    hasMore: false,
  });

  useEffect(() => {
    if (
      globalContext?.mappedPairs?.length === 0 ||
      globalContext?.jobParams === ""
    ) {
      fetchNotifications();
    }
    if (!isNaN(+globalContext?.jobParams)) {
      let FIVE_MINUTES = 5 * 60 * 1000;
      if (new Date().getTime() - +globalContext?.jobParams > FIVE_MINUTES) {
        fetchNotifications();
      }
    }
    if (globalContext?.mappedPairs?.length > 0) {
      setNotificationList(globalContext?.mappedPairs);
    }
  }, []);

  useEffect(() => {
    if (globalContext?.jobParams === "RERUN_NOTIFICATIONS") {
      fetchNotifications();
    }
  }, [globalContext?.jobParams]);

  const getNotifications = () => {
    if (Object.keys(billingSummary?.calenderData).length === 0) {
      return;
    }
    let commingRenewals = [];
    let data = billingSummary?.calenderData || [];
    let thirtyDays = 30 * 24 * 60 * 60 * 1000;
    console.log("data", data);
    data?.map((rs) => {
      let nextThirtyDays = new Date().getTime() + thirtyDays;
      let checkD = new Date(+rs?.renewalDate).getTime();
      if (checkD < nextThirtyDays) {
        if (
          commingRenewals?.find((d) => d?.adminCloudId === rs?.adminCloudId)
        ) {
        } else {
          commingRenewals.push({
            title: "Renewal",
            icon: rs?.vendorName,
            adminCloudId: rs?.adminCloudId,
            externalProviderName: rs?.externalProviderName,
            message: `Renewal on ${moment(+checkD).format("MMM DD YYYY")}`,
          });
        }
      }
    });
    setNotificationList(commingRenewals.reverse());
  };

  const fetchNotifications = async (pageNo = 1, pageSize = 10) => {
    setIsLoading(true);
    let res = await getNotificationsList(pageNo, pageSize);
    if (res?.status === "OK") {
      setPagination({
        pageSize: pageSize,
        currentPage: pageNo,
        hasMore: res?.res?.length === pageSize,
      });
      if (pageNo === 1) {
        dispatch({
          type: SET_MAPPED_PAIRS,
          payload: [...res?.res],
        });
        setNotificationList(res?.res);
      } else {
        setNotificationList([...notificationList, ...res?.res]);
        dispatch({
          type: SET_MAPPED_PAIRS,
          payload: [...notificationList, ...res?.res],
        });
      }
      dispatch({
        type: SET_UPDATE_JOB_PARAMS,
        payload: "" + new Date().getTime(),
      });
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const generateMessageForNotification = (item) => {
    if (item?.type === "LICENCE_RENEWAL") {
      return `Your license is expiring on ${moment(item?.expiryDate).format(
        "MMM DD YYYY"
      )}`;
    } else if (item?.type === "SHADOW_APP") {
      return `Found a new shadow app ${item?.ntype}`;
    }
    return item?.message;
  };

  const handleClearNotification = async (id, isAll = false) => {
    let cpNotificationList = [...notificationList];
    if (isAll) {
      cpNotificationList = [];
    } else {
      cpNotificationList = cpNotificationList?.filter(
        (item) => item?.id !== id
      );
    }
    setNotificationList(cpNotificationList);
    let res = await markNotificationAsDone(id, isAll);
    if (res?.status === "OK") {
      fetchNotifications(1, pagination?.pageSize);
    }
  };

  return (
    <div
      className="cf_renewal_calendar cf_notification_container"
      style={{ width: "40px", height: "40px", position: "relative" }}
    >
      <Bell size={20} strokeWidth={2} color="#64748b" />
      {notificationList?.length > 0 ? (
        notificationList?.length == 10 ? (
          <div className="cf_notification_count" style={{ padding: "4px" }}>
            +9
          </div>
        ) : (
          <div className="cf_notification_count">{notificationList.length}</div>
        )
      ) : (
        ""
      )}
      <div className="cf_notification_dropdown">
        <div className="cf_notification_dropdown_title">
          <p>Notifications</p>
          <span style={{ marginLeft: "auto" }}></span>
          {notificationList?.length > 0 ? (
            <p
              className="cf_make_link"
              style={{ fontSize: "12px", fontWeight: "500" }}
              onClick={() => handleClearNotification("", true)}
            >
              Mark all as read
            </p>
          ) : (
            ""
          )}
        </div>
        <div className="cf_notification_dropdown_body">
          {notificationList?.length === 0 ? (
            <div
              className="cf_notification_dropdown_item CF_d-flex ai-center"
              style={{ justifyContent: "center" }}
            >
              <p>No Notifications</p>
            </div>
          ) : (
            ""
          )}
          {notificationList?.map((item, index) => {
            return (
              <div key={item?.id} className="cf_notification_dropdown_item">
                <div className="cf_newFlow_trigger_pannel_header_icon">
                  <img
                    src={cloudImageMapper(
                      cloudsList?.find(
                        (cloud) => cloud?.id === item?.adminCloudId
                      )?.providerName
                    )}
                    style={{
                      width: "20px",
                      height: "20px",
                      objectFit: "contain",
                    }}
                    alt={item?.adminCloudId}
                  />
                </div>
                <div className="cf_notification_dropdown_item_message">
                  <div
                    className="CF_d-flex ai-center"
                    style={{ width: "100%" }}
                  >
                    <div className="cf_notification_category">
                      <p>
                        {item?.type
                          ?.split("_")
                          ?.map((word) => makeFirstLetterCapital(word))
                          ?.join(" ")}
                      </p>
                    </div>
                    <span style={{ marginLeft: "auto" }}></span>
                    <p
                      style={{
                        fontSize: "10px",
                        color: "#64748b",
                        fontWeight: "500",
                      }}
                      title={item?.localDateTime}
                    >
                      {getMomentAgo(item?.localDateTime)}
                    </p>
                  </div>
                  <p
                    className="cf_notification_dropdown_item_message_title"
                    title={generateMessageForNotification(item)}
                  >
                    {generateMessageForNotification(item)}
                  </p>
                </div>
                <ActionButton
                  customClass={`changeButtonColorOnHover cf_notification_markAsDoneButton`}
                  buttonType="button"
                  buttonClickAction={() => handleClearNotification(item?.id)}
                  title="Mark as Done"
                  customStyles={{
                    backgroundColor: "#ddd",
                    width: "25px",
                    height: "25px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0px",
                  }}
                >
                  <Check size={12} />
                </ActionButton>
              </div>
            );
          })}

          {pagination?.hasMore && !isLoading && notificationList?.length > 0 ? (
            <div
              className="cf_notification_dropdown_item"
              style={{ padding: "10px", justifyContent: "center" }}
            >
              <p
                className="cf_make_link"
                onClick={() =>
                  fetchNotifications(
                    pagination?.currentPage + 1,
                    pagination?.pageSize
                  )
                }
              >
                Load More
              </p>
            </div>
          ) : (
            ""
          )}

          {isLoading ? (
            <div
              className="cf_notification_dropdown_item"
              style={{ padding: "10px", justifyContent: "center" }}
            >
              {getCFTextLoader()}
            </div>
          ) : (
            ""
          )}
        </div>
      </div>
    </div>
  );
};

export default Notifications;
// return (
// <div key={index} className="cf_notification_dropdown_item">
{
  /* <div className="cf_notification_dropdown_item_icon"> */
}
{
  /* <div className="cf_notification_dropdown_item_icon_calendar"> */
}
{
  /* <Calendar1 /> */
}
{
  /* </div> */
}
{
  /* <img
        src={cloudImageMapper(item.icon)}
        alt="icon"
        style={{ width: "30px", height: "30px" }}
      /> */
}
{
  /* </div>   */
}
//     <div className="cf_notification_dropdown_item_message">
//       <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
//         <Calendar1 size={15} strokeWidth={2} color="#0062ff" />
//         <p
//           className="cf_notification_dropdown_item_message_title"
//           title={getCloudName(item.icon)}
//           style={{ fontSize: "12px" }}
//         >
//           {item.icon === "OTHERS"
//             ? item.externalProviderName
//             : getCloudName(item.icon)}
//         </p>
//       </div>
//       <p
//         className="cf_notification_dropdown_item_message_text"
//         style={{ fontWeight: "400", paddingLeft: "18px" }}
//       >
//         {item.message}
//       </p>
//     </div>
//   </div>
// );
