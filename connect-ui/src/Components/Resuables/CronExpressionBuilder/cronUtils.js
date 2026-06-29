
export const isValidCronExpression = (cronExpression) => {
    if (!cronExpression || typeof cronExpression !== "string") {
        return false;
    }

    const parts = cronExpression.trim().split(/\s+/);

    // Accept both 5-field and 7-field cron expressions
    if (parts.length < 5 || parts.length > 7) {
        return false;
    }

    let seconds, minute, hour, dayOfMonth, month, dayOfWeek, year;

    if (parts.length >= 7) {
        // 7-field format: seconds minutes hours dayOfMonth month dayOfWeek year
        [seconds, minute, hour, dayOfMonth, month, dayOfWeek, year] = parts;
        if (!validateField(seconds, 0, 59)) return false;
    } else {
        // 5-field format: minutes hours dayOfMonth month dayOfWeek
        [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    }

    if (!validateField(minute, 0, 59)) return false;

    if (!validateField(hour, 0, 23)) return false;

    if (!validateField(dayOfMonth, 1, 31, true)) return false;

    if (!validateField(month, 1, 12, true)) return false;

    if (!validateDayOfWeekField(dayOfWeek)) return false;

    if (year && !validateField(year, 1970, 2099, true)) return false;

    return true;
};

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const isValidDayOfWeekToken = (token) => {
    const t = String(token).trim().toUpperCase();
    if (DAY_NAMES.includes(t)) return true;
    const num = Number(t);
    return !isNaN(num) && num >= 0 && num <= 7;
};

const validateDayOfWeekField = (field) => {
    if (field === "*" || field === "?") return true;
    if (field.includes(",")) {
        return field.split(",").every((t) => isValidDayOfWeekToken(t));
    }
    if (field.includes("-")) {
        const [start, end] = field.split("-").map((s) => s.trim());
        return isValidDayOfWeekToken(start) && isValidDayOfWeekToken(end);
    }
    return isValidDayOfWeekToken(field);
};

const validateField = (field, min, max, allowWildcard = false) => {
    if (allowWildcard && (field === "*" || field === "?")) {
        return true;
    }

    // Handle step values like "1/1" (every day)
    if (field.includes("/")) {
        const [range, step] = field.split("/");
        const stepNum = Number(step);
        if (isNaN(stepNum) || stepNum < 1) return false;

        if (range === "*" || range === "1") return true;
        if (range.includes("-")) {
            const [start, end] = range.split("-").map(Number);
            return (
                !isNaN(start) &&
                !isNaN(end) &&
                start >= min &&
                end <= max &&
                start <= end
            );
        }
        // Handle single number with step like "1/1"
        const rangeNum = Number(range);
        if (!isNaN(rangeNum) && rangeNum >= min && rangeNum <= max) {
            return true;
        }
    }

    if (field.includes("-")) {
        const [start, end] = field.split("-").map(Number);
        return (
            !isNaN(start) &&
            !isNaN(end) &&
            start >= min &&
            end <= max &&
            start <= end
        );
    }

    if (field.includes(",")) {
        const values = field.split(",").map(Number);
        return values.every(
            (val) => !isNaN(val) && val >= min && val <= max
        );
    }

    const num = Number(field);
    return !isNaN(num) && num >= min && num <= max;
};

export const getCronDescription = (cronExpression) => {
    if (!isValidCronExpression(cronExpression)) {
        return "Invalid cron expression";
    }

    const parts = cronExpression.trim().split(/\s+/);

    let minute, hour, dayOfMonth, month, dayOfWeek;
    let year;

    if (parts.length >= 7) {
        minute = parts[1];
        hour = parts[2];
        dayOfMonth = parts[3];
        month = parts[4];
        dayOfWeek = parts[5];
        year = parts[6]; // ✅ added
    } else if (parts.length >= 5) {
        minute = parts[0];
        hour = parts[1];
        dayOfMonth = parts[2];
        month = parts[3];
        dayOfWeek = parts[4];
    } else {
        return "Invalid cron expression";
    }

    const daysOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];

    const formatTime = (h, m) => {
        const hr = parseInt(h);
        const min = parseInt(m);
        const period = hr >= 12 ? "PM" : "AM";
        let displayHour = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
        return `${displayHour}:${min.toString().padStart(2, "0")} ${period}`;
    };

    const timeStr = formatTime(hour, minute);

    if (
        year &&
        dayOfWeek === "?" &&
        dayOfMonth !== "*" &&
        month !== "*"
    ) {
        const monthNames = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ];

        const getOrdinal = (n) => {
            const s = ["th", "st", "nd", "rd"];
            const v = n % 100;
            return n + (s[(v - 20) % 10] || s[v] || s[0]);
        };

        const monthName = monthNames[parseInt(month, 10) - 1];
        const day = getOrdinal(parseInt(dayOfMonth, 10));

        return `Once on ${monthName} ${day}, ${year} at ${timeStr}`;
    }

    if (dayOfWeek !== "*" && dayOfWeek !== "?") {
        const dayNameMap = {
            "SUN": "Sunday", "MON": "Monday", "TUE": "Tuesday", "WED": "Wednesday",
            "THU": "Thursday", "FRI": "Friday", "SAT": "Saturday"
        };
        const days = dayOfWeek.split(",").map((d) => {
            const trimmed = d.trim().toUpperCase();
            if (dayNameMap[trimmed]) {
                return dayNameMap[trimmed];
            }
            const dayNum = parseInt(trimmed);
            if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) {
                return daysOfWeek[dayNum];
            }
            return trimmed;
        }).join(", ");
        return `Weekly on ${days} at ${timeStr}`;
    } else if (dayOfMonth !== "*" && dayOfMonth !== "?" && dayOfMonth !== "1/1") {
        const dates = dayOfMonth.split(",").join(", ");
        return `Monthly on day ${dates} at ${timeStr}`;
    } else {
        return `Daily at ${timeStr}`;
    }
};


export const getNextOccurrence = (cronExpression, fromDate = new Date()) => {
    if (!isValidCronExpression(cronExpression)) {
        return null;
    }

    const parts = cronExpression.trim().split(/\s+/);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const next = new Date(fromDate);
    next.setSeconds(0);
    next.setMilliseconds(0);

    return next;
};
