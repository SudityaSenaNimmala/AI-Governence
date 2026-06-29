import { Calendar1, CalendarClock } from "lucide-react";
import CustomRenewalCalendar from "../CustomCalendar/CustomRenewalCalendar";
import { useContext, useEffect, useState, useMemo } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";

const RenewalCalendar = (props) => {
  const { globalContext } = useContext(GlobalContext);
  const { billingSummary } = globalContext;

  const [renewalList, setRenewalList] = useState({});

  useEffect(() => {
    if (billingSummary?.calenderData) {
      setRenewalList(billingSummary?.calenderData);
    }
  }, [billingSummary]);

  // Memoize the date to prevent unnecessary re-renders
  const currentDate = useMemo(() => new Date().getTime(), []);

  return (
    <div
      className="cf_renewal_calendar"
      style={
        props?.action !== "APPINSIGHTS" ? { width: "40px", height: "40px" } : {}
      }
    >
      <CalendarClock size={16} strokeWidth={2} color="#64748b" />

      {/* <Calendar1 size={20} strokeWidth={2} color="#001a6f" /> */}
      <CustomRenewalCalendar
        customDate={currentDate}
        customData={currentDate}
        renewalList={renewalList}
      />
    </div>
  );
};

export default RenewalCalendar;
