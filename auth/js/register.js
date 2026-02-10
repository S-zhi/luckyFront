initI18n("register");

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

// TODO : Replace with real API integration.
const requestRegister = async (payload) => {
  // Placeholder for API integration:
  // return fetch("/api/register", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });

  return new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true }), 1000);
  });
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
    setStatus(
      t("messages.simulating", "Simulating request. Ready to connect the backend."),
      "info"
    );

    try {
      const response = await requestRegister(payload);
      if (response && response.ok) {
        setStatus(
          t("messages.success", "Stub response received. Backend can be wired now."),
          "success"
        );
      } else {
        setStatus(
          t("messages.error", "Stub response only. No backend connected."),
          "error"
        );
      }
    } catch (error) {
      setStatus(t("messages.exception", "Unable to simulate the request."), "error");
    } finally {
      setLoading(false);
    }
  });
}
