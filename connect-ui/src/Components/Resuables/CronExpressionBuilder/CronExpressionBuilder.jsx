import React, { useState, useEffect, useCallback } from "react";
import "./css/CronExpressionBuilder.css";
import { Clock, Calendar, Repeat, X, CalendarCheck, MoveLeft } from "lucide-react";
import ActionButton from "../InputsComponents/ActionButton";

const CronExpressionBuilder = ({
    defaultValue = null,
    timeFormat = "24",
    onClose = () => { },
    onSave = () => { },
    isOnlyOnce = false,
}) => {
    const [scheduleType, setScheduleType] = useState(isOnlyOnce ? "ONCE" : "DAILY");
    const [time, setTime] = useState({ hour: 9, minute: 0 });
    const [selectedDays, setSelectedDays] = useState([]);
    const [selectedDates, setSelectedDates] = useState([]);
    const [selectedDateTime, setSelectedDateTime] = useState({
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        day: new Date().getDate(),
        hour: 9,
        minute: 0,
    });
    const [cronExpression, setCronExpression] = useState("");

    const daysOfWeek = [
        { label: "Sunday", value: 0, short: "Sun", cronName: "SUN" },
        { label: "Monday", value: 1, short: "Mon", cronName: "MON" },
        { label: "Tuesday", value: 2, short: "Tue", cronName: "TUE" },
        { label: "Wednesday", value: 3, short: "Wed", cronName: "WED" },
        { label: "Thursday", value: 4, short: "Thu", cronName: "THU" },
        { label: "Friday", value: 5, short: "Fri", cronName: "FRI" },
        { label: "Saturday", value: 6, short: "Sat", cronName: "SAT" },
    ];

    const monthDays = Array.from({ length: 31 }, (_, i) => i + 1);

    /** Cron expression must always have more than 6 parts (7 fields: second minute hour day month dayOfWeek year) */
    const hasMoreThanSixParts = (expr) => (expr || "").trim().split(/\s+/).length > 6;

    useEffect(() => {
        if (defaultValue) {
            parseCronExpression(defaultValue);
        }
    }, [defaultValue]);

    const parseCronExpression = (cron) => {
        try {
            const parts = cron.split(" ");
            let minute, hour, dayOfMonth, month, dayOfWeek, year;

            if (parts.length >= 7) {
                minute = parts[1];
                hour = parts[2];
                dayOfMonth = parts[3];
                month = parts[4];
                dayOfWeek = parts[5];
                year = parts[6];
            } else if (parts.length >= 5) {
                minute = parts[0];
                hour = parts[1];
                dayOfMonth = parts[2];
                month = parts[3];
                dayOfWeek = parts[4];
                year = parts[5] || "*";
            } else {
                return;
            }

            setTime({
                hour: parseInt(hour),
                minute: parseInt(minute),
            });

            // Check if it's a one-time schedule (has specific year and month)
            if (year !== "*" && year !== "?" && month !== "*" && month !== "?" && dayOfMonth !== "*" && dayOfMonth !== "?") {
                setScheduleType("ONCE");
                const parsedYear = parseInt(year);
                const parsedMonth = parseInt(month);
                const parsedDay = parseInt(dayOfMonth);

                if (!isNaN(parsedYear) && !isNaN(parsedMonth) && !isNaN(parsedDay)) {
                    setSelectedDateTime({
                        year: parsedYear,
                        month: parsedMonth,
                        day: parsedDay,
                        hour: parseInt(hour),
                        minute: parseInt(minute),
                    });
                }
            } else if (dayOfWeek !== "*" && dayOfWeek !== "?") {
                setScheduleType("WEEKLY");
                // Handle both numeric (0,1,2) and day name (MON,TUE,WED) formats
                const dayNameMap = {
                    "SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6,
                    "SUNDAY": 0, "MONDAY": 1, "TUESDAY": 2, "WEDNESDAY": 3, "THURSDAY": 4, "FRIDAY": 5, "SATURDAY": 6
                };
                const days = dayOfWeek.split(",").map((d) => {
                    const trimmed = d.trim().toUpperCase();
                    // Check if it's a day name
                    if (dayNameMap[trimmed] !== undefined) {
                        return dayNameMap[trimmed];
                    }
                    // Otherwise try to parse as number
                    return parseInt(trimmed);
                }).filter((d) => !isNaN(d));
                setSelectedDays(days);
            } else if (dayOfMonth !== "*" && dayOfMonth !== "?" && dayOfMonth !== "1/1") {
                setScheduleType("MONTHLY");
                // Only take the first date if multiple are present (single date selection)
                const firstDate = dayOfMonth.includes(",")
                    ? parseInt(dayOfMonth.split(",")[0])
                    : parseInt(dayOfMonth);
                setSelectedDates([firstDate]);
            } else {
                setScheduleType("DAILY");
            }
        } catch (error) {
            console.error("Error parsing cron expression:", error);
        }
    };

    const generateCronExpression = useCallback(() => {
        let expression = "";

        switch (scheduleType) {
            case "DAILY":
                expression = `0 ${time.minute} ${time.hour} 1/1 * ? *`;
                break;

            case "WEEKLY":
                if (selectedDays.length === 0) {
                    // Fallback to DAILY so expression always has more than 6 parts
                    expression = `0 ${time.minute} ${time.hour} 1/1 * ? *`;
                } else {
                    // Convert day numbers to day names (MON, TUE, WED, etc.)
                    const daysStr = selectedDays
                        .sort((a, b) => a - b)
                        .map((day) => daysOfWeek[day]?.cronName || daysOfWeek[day]?.short.toUpperCase())
                        .join(",");
                    expression = `0 ${time.minute} ${time.hour} ? * ${daysStr} *`;
                }
                break;

            case "MONTHLY":
                if (selectedDates.length === 0) {
                    // Fallback to DAILY so expression always has more than 6 parts
                    expression = `0 ${time.minute} ${time.hour} 1/1 * ? *`;
                } else {
                    // Only use the first selected date (single date selection)
                    const dateStr = selectedDates[0];
                    expression = `0 ${time.minute} ${time.hour} ${dateStr} * ? *`;
                }
                break;

            case "ONCE":
                // Generate cron expression for one-time execution: 0 minute hour day month ? year
                expression = `0 ${selectedDateTime.minute} ${selectedDateTime.hour} ${selectedDateTime.day} ${selectedDateTime.month} ? ${selectedDateTime.year}`;
                break;

            default:
                // Fallback to DAILY so expression always has more than 6 parts
                expression = `0 ${time.minute} ${time.hour} 1/1 * ? *`;
        }

        return expression;
    }, [scheduleType, time, selectedDays, selectedDates, selectedDateTime]);

    useEffect(() => {
        const cron = generateCronExpression();
        setCronExpression(hasMoreThanSixParts(cron) ? cron : `0 ${time.minute} ${time.hour} 1/1 * ? *`);
    }, [generateCronExpression]);

    const handleTimeChange = (field, value) => {
        setTime((prev) => ({
            ...prev,
            [field]: parseInt(value),
        }));
    };

    const toggleDay = (dayValue) => {
        setSelectedDays((prev) => {
            if (prev.includes(dayValue)) {
                return prev.filter((d) => d !== dayValue);
            } else {
                return [...prev, dayValue];
            }
        });
    };

    const toggleDate = (date) => {
        setSelectedDates((prev) => {
            // Only allow one date selection - replace if already selected, otherwise set
            if (prev.includes(date)) {
                return []; // Deselect if clicking the same date
            } else {
                return [date]; // Set only this date
            }
        });
    };

    const formatTime = (hour, minute) => {
        if (timeFormat === "12") {
            const period = hour >= 12 ? "PM" : "AM";
            const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
            return `${displayHour.toString().padStart(2, "0")}:${minute
                .toString()
                .padStart(2, "0")} ${period}`;
        }
        return `${hour.toString().padStart(2, "0")}:${minute
            .toString()
            .padStart(2, "0")}`;
    };

    const getScheduleDescription = () => {
        switch (scheduleType) {
            case "DAILY":
                return `Daily at ${formatTime(time.hour, time.minute)}`;
            case "WEEKLY":
                if (selectedDays.length === 0) {
                    return "Select days of the week";
                }
                const dayLabels = selectedDays
                    .sort((a, b) => a - b)
                    .map((d) => daysOfWeek[d].short)
                    .join(", ");
                return `Weekly on ${dayLabels} at ${formatTime(time.hour, time.minute)}`;
            case "MONTHLY":
                if (selectedDates.length === 0) {
                    return "Select date of the month";
                }
                // Only show the first (and only) selected date
                const date = selectedDates[0];
                const suffix =
                    date === 1 || date === 21 || date === 31
                        ? "st"
                        : date === 2 || date === 22
                            ? "nd"
                            : date === 3 || date === 23
                                ? "rd"
                                : "th";
                return `Monthly on the ${date}${suffix} at ${formatTime(time.hour, time.minute)}`;
            case "ONCE":
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const dateSuffix =
                    selectedDateTime.day === 1 || selectedDateTime.day === 21 || selectedDateTime.day === 31
                        ? "st"
                        : selectedDateTime.day === 2 || selectedDateTime.day === 22
                            ? "nd"
                            : selectedDateTime.day === 3 || selectedDateTime.day === 23
                                ? "rd"
                                : "th";
                return `Once on ${monthNames[selectedDateTime.month - 1]} ${selectedDateTime.day}${dateSuffix}, ${selectedDateTime.year} at ${formatTime(selectedDateTime.hour, selectedDateTime.minute)}`;
            default:
                return "";
        }
    };

    const handleDateTimeChange = (field, value) => {
        const num = parseInt(value, 10);
        setSelectedDateTime((prev) => {
            const next = { ...prev, [field]: num };
            if (field === "year" && num === currentYear) {
                if (prev.month < currentMonth) next.month = currentMonth;
                if (next.month === currentMonth && prev.day < currentDay) next.day = currentDay;
            }
            if (field === "month" && prev.year === currentYear && num === currentMonth && prev.day < currentDay) {
                next.day = currentDay;
            }
            if (field === "day" && prev.year === currentYear && prev.month === currentMonth && num < currentDay) {
                next.day = currentDay;
            }
            if (field === "hour" && isSelectedDateToday()) {
                if (num === currentHour && prev.minute < currentMinute) next.minute = currentMinute;
            }
            if (field === "minute" && isSelectedDateToday() && prev.hour === currentHour && num < currentMinute) {
                next.minute = currentMinute;
            }
            return next;
        });
    };

    const getDaysInMonth = (year, month) => {
        return new Date(year, month, 0).getDate();
    };

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const isSelectedDateToday = () =>
        selectedDateTime.year === currentYear &&
        selectedDateTime.month === currentMonth &&
        selectedDateTime.day === currentDay;

    const isSelectedDateTimeInPast = () => {
        const d = new Date(selectedDateTime.year, selectedDateTime.month - 1, selectedDateTime.day, selectedDateTime.hour, selectedDateTime.minute);
        return d.getTime() <= Date.now();
    };

    useEffect(() => {
        if (scheduleType === "ONCE" && isSelectedDateTimeInPast()) {
            const n = new Date();
            const nextMin = n.getMinutes() + 1;
            const hour = nextMin >= 60 ? Math.min(23, n.getHours() + 1) : n.getHours();
            const minute = nextMin >= 60 ? 0 : nextMin;
            setSelectedDateTime({
                year: n.getFullYear(),
                month: n.getMonth() + 1,
                day: n.getDate(),
                hour,
                minute,
            });
        }
    }, [scheduleType, selectedDateTime.year, selectedDateTime.month, selectedDateTime.day, selectedDateTime.hour, selectedDateTime.minute]);

    const handleSave = () => {
        if (cronExpression && hasMoreThanSixParts(cronExpression) && onSave) {
            onSave(cronExpression);
        }
    };

    const handleClose = () => {
        if (onClose) {
            onClose();
        }
    };

    return (
        <div className="cf_cron_builder_container">
            <div className="cf_cron_builder_header">
                <div className="cf_cron_builder_header_left">
                    <div className="cf_cron_builder_header_icon">
                        <Clock size={18} />
                    </div>
                    <p className="cf_cron_builder_header_title">Schedule Configuration</p>
                </div>
                <div className="cf_cron_builder_header_actions">
                    <button
                        className="cf_cron_close_button"
                        onClick={handleClose}
                    >
                        {
                            isOnlyOnce ? <MoveLeft size={18} />
                                : <X size={18} />
                        }
                    </button>
                </div>
            </div>

            {!isOnlyOnce && <div className="cf_cron_builder_type_selector">
                <button
                    className={`cf_cron_type_button ${scheduleType === "DAILY" ? "active" : ""
                        }`}
                    onClick={() => {
                        setScheduleType("DAILY");
                        setSelectedDays([]);
                        setSelectedDates([]);
                    }}
                >
                    <Repeat size={14} />
                    <span>Daily</span>
                </button>
                <button
                    className={`cf_cron_type_button ${scheduleType === "WEEKLY" ? "active" : ""
                        }`}
                    onClick={() => {
                        setScheduleType("WEEKLY");
                        setSelectedDates([]);
                    }}
                >
                    <Calendar size={14} />
                    <span>Weekly</span>
                </button>
                <button
                    className={`cf_cron_type_button ${scheduleType === "MONTHLY" ? "active" : ""
                        }`}
                    onClick={() => {
                        setScheduleType("MONTHLY");
                        setSelectedDays([]);
                    }}
                >
                    <Calendar size={14} />
                    <span>Monthly</span>
                </button>
                <button
                    className={`cf_cron_type_button ${scheduleType === "ONCE" ? "active" : ""
                        }`}
                    onClick={() => {
                        setScheduleType("ONCE");
                        setSelectedDays([]);
                        setSelectedDates([]);
                    }}
                >
                    <CalendarCheck size={14} />
                    <span>Run Once</span>
                </button>
            </div>}

            {scheduleType === "ONCE" ? (
                <div className="cf_cron_date_time_picker">
                    <div className="cf_cron_date_picker_section">
                        <label className="cf_cron_label">Date</label>
                        <div className="cf_cron_date_inputs">
                            <div className="cf_cron_time_input_group">
                                <label>Year</label>
                                <select
                                    value={selectedDateTime.year}
                                    onChange={(e) => handleDateTimeChange("year", e.target.value)}
                                    className="cf_cron_select"
                                >
                                    {Array.from({ length: 10 }, (_, i) => {
                                        const year = new Date().getFullYear() + i;
                                        return (
                                            <option key={year} value={year}>
                                                {year}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                            <div className="cf_cron_time_input_group">
                                <label>Month</label>
                                <select
                                    value={selectedDateTime.month}
                                    onChange={(e) => {
                                        const newMonth = parseInt(e.target.value);
                                        handleDateTimeChange("month", newMonth);
                                        // Adjust day if it exceeds days in new month
                                        const daysInMonth = getDaysInMonth(selectedDateTime.year, newMonth);
                                        if (selectedDateTime.day > daysInMonth) {
                                            handleDateTimeChange("day", daysInMonth);
                                        }
                                    }}
                                    className="cf_cron_select"
                                >
                                    {[
                                        "January", "February", "March", "April", "May", "June",
                                        "July", "August", "September", "October", "November", "December"
                                    ]
                                        .map((month, index) => ({ month, value: index + 1 }))
                                        .filter(({ value }) => selectedDateTime.year > currentYear || value >= currentMonth)
                                        .map(({ month, value }) => (
                                            <option key={value} value={value}>
                                                {month}
                                            </option>
                                        ))}
                                </select>
                            </div>
                            <div className="cf_cron_time_input_group">
                                <label>Day</label>
                                <select
                                    value={selectedDateTime.day}
                                    onChange={(e) => handleDateTimeChange("day", e.target.value)}
                                    className="cf_cron_select"
                                >
                                    {Array.from({ length: getDaysInMonth(selectedDateTime.year, selectedDateTime.month) }, (_, i) => i + 1)
                                        .filter((day) => {
                                            if (selectedDateTime.year !== currentYear || selectedDateTime.month !== currentMonth) return true;
                                            return day >= currentDay;
                                        })
                                        .map((day) => (
                                            <option key={day} value={day}>
                                                {day}
                                            </option>
                                        ))}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="cf_cron_time_picker">
                        <label className="cf_cron_label">Time</label>
                        <div className="cf_cron_time_inputs">
                            <div className="cf_cron_time_input_group">
                                <label>Hour</label>
                                <select
                                    value={selectedDateTime.hour}
                                    onChange={(e) => handleDateTimeChange("hour", e.target.value)}
                                    className="cf_cron_select"
                                >
                                    {Array.from({ length: 24 }, (_, i) => i)
                                        .filter((h) => !isSelectedDateToday() || h >= currentHour)
                                        .map((i) => (
                                            <option key={i} value={i}>
                                                {timeFormat === "12"
                                                    ? i === 0
                                                        ? "12 AM"
                                                        : i < 12
                                                            ? `${i} AM`
                                                            : i === 12
                                                                ? "12 PM"
                                                                : `${i - 12} PM`
                                                    : i.toString().padStart(2, "0")}
                                            </option>
                                        ))}
                                </select>
                            </div>
                            <div className="cf_cron_time_input_group">
                                <label>Minute</label>
                                <select
                                    value={selectedDateTime.minute}
                                    onChange={(e) => handleDateTimeChange("minute", e.target.value)}
                                    className="cf_cron_select"
                                >
                                    {Array.from({ length: 60 }, (_, i) => i)
                                        .filter((m) => {
                                            if (!isSelectedDateToday()) return true;
                                            if (selectedDateTime.hour > currentHour) return true;
                                            return m >= currentMinute;
                                        })
                                        .map((i) => (
                                            <option key={i} value={i}>
                                                {i.toString().padStart(2, "0")}
                                            </option>
                                        ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="cf_cron_time_picker">
                    <label className="cf_cron_label">Time</label>
                    <div className="cf_cron_time_inputs">
                        <div className="cf_cron_time_input_group">
                            <label>Hour</label>
                            <select
                                value={time.hour}
                                onChange={(e) => handleTimeChange("hour", e.target.value)}
                                className="cf_cron_select"
                            >
                                {Array.from({ length: 24 }, (_, i) => (
                                    <option key={i} value={i}>
                                        {timeFormat === "12"
                                            ? i === 0
                                                ? "12 AM"
                                                : i < 12
                                                    ? `${i} AM`
                                                    : i === 12
                                                        ? "12 PM"
                                                        : `${i - 12} PM`
                                            : i.toString().padStart(2, "0")}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="cf_cron_time_input_group">
                            <label>Minute</label>
                            <select
                                value={time.minute}
                                onChange={(e) => handleTimeChange("minute", e.target.value)}
                                className="cf_cron_select"
                            >
                                {Array.from({ length: 60 }, (_, i) => (
                                    <option key={i} value={i}>
                                        {i.toString().padStart(2, "0")}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {scheduleType === "WEEKLY" && (
                <div className="cf_cron_weekly_selector">
                    <label className="cf_cron_label">Select Days</label>
                    <div className="cf_cron_days_grid">
                        {daysOfWeek.map((day) => (
                            <button
                                key={day.value}
                                className={`cf_cron_day_button ${selectedDays.includes(day.value) ? "selected" : ""
                                    }`}
                                onClick={() => toggleDay(day.value)}
                            >
                                {day.short}
                            </button>
                        ))}
                    </div>
                    {selectedDays.length === 0 && (
                        <p className="cf_cron_error_text">
                            Please select at least one day
                        </p>
                    )}
                </div>
            )}

            {scheduleType === "MONTHLY" && (
                <div className="cf_cron_monthly_selector">
                    <label className="cf_cron_label">Select Date</label>
                    <div className="cf_cron_dates_grid">
                        {monthDays.map((date) => (
                            <button
                                key={date}
                                className={`cf_cron_date_button ${selectedDates.includes(date) ? "selected" : ""
                                    }`}
                                onClick={() => toggleDate(date)}
                            >
                                {date}
                            </button>
                        ))}
                    </div>
                    {selectedDates.length === 0 && (
                        <p className="cf_cron_error_text">
                            Please select a date
                        </p>
                    )}
                </div>
            )}

            <div className="cf_cron_description">
                <p className="cf_cron_description_text">
                    {getScheduleDescription()}
                </p>
            </div>

            {/* <div className="cf_cron_expression_display">
                <label className="cf_cron_label">Cron Expression</label>
                <div className="cf_cron_expression_value">
                    <code>{cronExpression || "Invalid configuration"}</code>
                </div>
            </div> */}

            <div className="cf_cron_builder_footer">
                <ActionButton
                    buttonType="button"
                    buttonClickAction={handleSave}
                    isDisabled={!cronExpression}
                    customStyles={{
                        width: "100%",
                        height: "40px",
                        padding: "12px",
                        fontSize: "14px",
                        fontWeight: "500",
                        backgroundColor: "#0062ff",
                        color: "#ffffff",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                    customClass={!cronExpression ? "cf_cron_save_disabled" : ""}
                >
                    Save
                </ActionButton>
            </div>
        </div>
    );
};

export default CronExpressionBuilder;
