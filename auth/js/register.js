initI18n("register");

const DEFAULT_API_BASE_URL = "http://localhost:8080/v1";
const runtimeBaseUrl = window.localStorage.getItem("LP_API_BASE_URL") || "";
const configuredBaseUrl =
  runtimeBaseUrl || (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "";
const apiBaseUrl = (configuredBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
const timeoutMs =
  Number(window.APP_CONFIG && window.APP_CONFIG.API_TIMEOUT_MS) || 15000;
const redirectDelayMs = 1200;

const form = document.querySelector("[data-register-form]");
const statusEl = document.querySelector("[data-status]");
const submitButton = document.querySelector("[data-submit]");
const passwordInput = document.querySelector("#password");
const confirmInput = document.querySelector("#confirm-password");
const toggleButtons = document.querySelectorAll("[data-toggle-target]");
const secondaryButtons = document.querySelectorAll("[data-secondary-action]");

const setStatus = (message, tone = "neutral") => {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
};

const setLoading = (isLoading) => {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  const textEl = submitButton.querySelector(".button-text");
  if (textEl) {
    textEl.textContent = isLoading
      ? t("form.submitLoading", "Creating account...")
      : t("form.submit", "Create account");
  }
};

const requestRegister = async (payload) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}/auth/register`, {
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

// redirectToLogin navigates the user to the sign-in page after registration succeeds.
const redirectToLogin = () => {
  window.setTimeout(() => {
    window.location.href = "login_page.html";
  }, redirectDelayMs);
};

const validatePasswordMatch = () => {
  if (!passwordInput || !confirmInput) return true;
  if (!confirmInput.value) {
    confirmInput.setCustomValidity("");
    return true;
  }
  if (confirmInput.value !== passwordInput.value) {
    confirmInput.setCustomValidity(
      t("messages.passwordMismatch", "Passwords do not match.")
    );
    return false;
  }
  confirmInput.setCustomValidity("");
  return true;
};

toggleButtons.forEach((button) => {
  const targetId = button.dataset.toggleTarget;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) return;

  button.addEventListener("click", () => {
    const isVisible = target.type === "text";
    target.type = isVisible ? "password" : "text";
    button.textContent = isVisible
      ? t("form.toggleShow", "Show")
      : t("form.toggleHide", "Hide");
    button.setAttribute("aria-pressed", String(!isVisible));
  });
});

secondaryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setStatus(
      t("messages.secondary", "Secondary flows are not wired yet."),
      "info"
    );
  });
});

if (passwordInput && confirmInput) {
  passwordInput.addEventListener("input", validatePasswordMatch);
  confirmInput.addEventListener("input", validatePasswordMatch);
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    validatePasswordMatch();

    if (!form.checkValidity()) {
      setStatus(
        t("messages.invalid", "Please complete all required fields."),
        "error"
      );
      form.reportValidity();
      return;
    }

    const payload = {
      fullName: form.fullName.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
    };

    setLoading(true);
    setStatus(t("messages.simulating", "Creating account..."), "info");

    try {
      const { response, data } = await requestRegister(payload);

      if (response.ok) {
        setStatus(
          (data && (data.message || data.msg)) ||
            t("messages.success", "Registration successful."),
          "success"
        );
        redirectToLogin();
        return;
      }

      setStatus(
        (data && (data.message || data.msg || data.error)) ||
          t("messages.error", "Registration failed."),
        "error"
      );
    } catch (error) {
      const isTimeout = error && error.name === "AbortError";
      setStatus(
        isTimeout
          ? "Request timed out. Please try again."
          : error.message || t("messages.exception", "Unable to complete registration."),
        "error"
      );
    } finally {
      setLoading(false);
    }
  });
}
