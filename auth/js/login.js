initI18n("login");

const DEFAULT_API_BASE_URL = "http://localhost:8080/v1";
const runtimeBaseUrl = window.localStorage.getItem("LP_API_BASE_URL") || "";
const configuredBaseUrl =
  runtimeBaseUrl || (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "";
const apiBaseUrl = (configuredBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
const timeoutMs =
  Number(window.APP_CONFIG && window.APP_CONFIG.API_TIMEOUT_MS) || 15000;
const redirectDelayMs = 800;
const mainPageUrl = new URL("../../main/index.html", window.location.href).href;
const authSession = window.LP_AUTH || null;

const form = document.querySelector("[data-login-form]");
const statusEl = document.querySelector("[data-status]");
const submitButton = document.querySelector("[data-submit]");

// setStatus updates the login status message and visual tone.
const setStatus = (message, tone = "neutral") => {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
};

// setLoading toggles the submit button loading state and label.
const setLoading = (isLoading) => {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  const textEl = submitButton.querySelector(".button-text");
  if (textEl) {
    textEl.textContent = isLoading
      ? t("form.submitLoading", "Signing in...")
      : t("form.submit", "Sign in");
  }
};

// redirectToMain navigates to the main dashboard after login succeeds.
const redirectToMain = () => {
  window.setTimeout(() => {
    if (authSession && typeof authSession.redirectToMain === "function") {
      authSession.redirectToMain();
      return;
    }
    window.location.assign(mainPageUrl);
  }, redirectDelayMs);
};

// requestLogin sends the sign-in request to the backend API.
const requestLogin = async (payload) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : null;

    return { response, data };
  } finally {
    window.clearTimeout(timeoutId);
  }
};

if (form) {
  if (authSession && typeof authSession.hasValidSession === "function" && authSession.hasValidSession()) {
    redirectToMain();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      setStatus(
        t("messages.invalid", "Please complete all required fields."),
        "error"
      );
      form.reportValidity();
      return;
    }

    const payload = {
      email: form.email.value.trim(),
      password: form.password.value,
      remember: form.remember.checked,
    };

    setLoading(true);
    setStatus(t("messages.simulating", "Signing in..."), "info");

    try {
      const { response, data } = await requestLogin(payload);

      if (response.ok) {
        const accessToken = String((data && data.token) || "").trim();
        if (!accessToken) {
          setStatus("Sign in succeeded but no access token was returned.", "error");
          return;
        }
        if (authSession && typeof authSession.saveSession === "function") {
          authSession.saveSession({
            token: accessToken,
            user: data && data.user,
            permissions: data && data.permissions,
          });
        }
        setStatus(
          (data && (data.message || data.msg)) ||
            t("messages.success", "Sign in successful."),
          "success"
        );
        redirectToMain();
        return;
      }

      setStatus(
        (data && (data.message || data.msg || data.error)) ||
          t("messages.error", "Sign in failed."),
        "error"
      );
    } catch (error) {
      const isTimeout = error && error.name === "AbortError";
      setStatus(
        isTimeout
          ? "Request timed out. Please try again."
          : error.message || t("messages.exception", "Unable to complete sign in."),
        "error"
      );
    } finally {
      setLoading(false);
    }
  });
}
