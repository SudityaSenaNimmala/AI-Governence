window.addEventListener("message", (event) => {
    console.log("📩 Message from page:", event.data);
    if (event.source !== window) return;
    if (event.data?.source === "CF_MANAGE_LOGIN" && event.data.action === "LOGIN_SUCCESS") {
        console.log("✅ Forwarding token to background");
        chrome.runtime.sendMessage({
            action: "saveLoginData",
            data: event.data.data
        });
    }
});
