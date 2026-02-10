initI18n("reset");

// 重置密码表单。
const form = document.querySelector("[data-reset-form]");
// 状态提示元素。
const statusEl = document.querySelector("[data-status]");
// 发送验证码按钮。
const sendCodeButton = document.querySelector("[data-send-code]");
// 提交重置按钮。
const submitButton = document.querySelector("[data-submit]");
// 邮箱输入框。
const emailInput = document.querySelector("#reset-email");
// 验证码输入框。
const codeInput = document.querySelector("#reset-code");
// 新密码输入框。
const passwordInput = document.querySelector("#reset-password");
// 确认新密码输入框。
const confirmInput = document.querySelector("#reset-confirm");
// 密码可见性切换按钮集合。
const toggleButtons = document.querySelectorAll("[data-toggle-target]");

// 设置状态文案与提示语气。
const setStatus = (message, tone = "neutral") => {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
};

// 设置按钮文案。
const setButtonText = (button, text) => {
  if (!button) return;
  const textEl = button.querySelector(".button-text");
  if (textEl) {
    textEl.textContent = text;
  }
};

// 设置按钮加载状态。
const setButtonLoading = (button, isLoading, labels) => {
  if (!button) return;
  button.disabled = isLoading;
  setButtonText(button, isLoading ? labels.loading : labels.default);
};

// 启用或禁用验证码/新密码相关输入框。
const setResetFieldsActive = (isActive) => {
  if (codeInput) {
    codeInput.disabled = !isActive;
  }
  if (passwordInput) {
    passwordInput.disabled = !isActive;
  }
  if (confirmInput) {
    confirmInput.disabled = !isActive;
  }
  if (submitButton) {
    submitButton.disabled = !isActive;
  }
};

// 校验两次输入的密码是否一致。
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

// 模拟接口请求延迟。
const requestStub = (delay = 900) =>
  new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true }), delay);
  });

// 模拟发送验证码接口。
const requestSendCode = async (payload) => {
  /* 接入真实接口时可替换为：
  return fetch("/api/reset/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  */

  return requestStub(800);
};

// 模拟重置密码接口。
const requestReset = async (payload) => {
  /* 接入真实接口时可替换为：
  return fetch("/api/reset/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  */

  return requestStub(1000);
};

// 设置发送验证码按钮加载状态。
const setSendCodeLoading = (isLoading) => {
  setButtonLoading(sendCodeButton, isLoading, {
    loading: t("form.sendCodeLoading", "Sending..."),
    default: t("form.sendCode", "Send code"),
  });
};

// 设置重置按钮加载状态。
const setSubmitLoading = (isLoading) => {
  setButtonLoading(submitButton, isLoading, {
    loading: t("form.submitLoading", "Resetting..."),
    default: t("form.submit", "Reset password"),
  });
};

// 初始化时禁用重置相关输入。
setResetFieldsActive(false);

// 绑定密码显示/隐藏切换。
for (const button of toggleButtons) {
  // 获取当前按钮控制的输入框 id。
  const targetId = button.dataset.toggleTarget;
  // 获取对应的密码输入框。
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) continue;

  // 点击切换密码可见性。
  button.addEventListener("click", () => {
    const isVisible = target.type === "text";
    target.type = isVisible ? "password" : "text";
    button.textContent = isVisible
      ? t("form.toggleShow", "Show")
      : t("form.toggleHide", "Hide");
    button.setAttribute("aria-pressed", String(!isVisible));
  });
}

// 监听密码输入框，实时校验一致性。
if (passwordInput && confirmInput) {
  passwordInput.addEventListener("input", validatePasswordMatch);
  confirmInput.addEventListener("input", validatePasswordMatch);
}

// 点击发送验证码。
if (sendCodeButton && emailInput) {
  sendCodeButton.addEventListener("click", async () => {
    if (!emailInput.checkValidity()) {
      setStatus(
        t("messages.invalid", "Please complete all required fields."),
        "error"
      );
      emailInput.reportValidity();
      return;
    }

    const payload = {
      email: emailInput.value.trim(),
    };

    setSendCodeLoading(true);
    setStatus(
      t("messages.codeSending", "Sending verification code..."),
      "info"
    );

    try {
      const response = await requestSendCode(payload);
      if (response && response.ok) {
        setResetFieldsActive(true);
        setStatus(
          t("messages.codeSent", "Verification code sent. Check your inbox."),
          "success"
        );
        if (codeInput) {
          codeInput.focus();
        }
      } else {
        setStatus(
          t("messages.resetError", "Reset failed in demo mode."),
          "error"
        );
      }
    } catch (error) {
      setStatus(
        t("messages.resetException", "Unable to reset password."),
        "error"
      );
    } finally {
      setSendCodeLoading(false);
    }
  });
}

// 提交重置表单。
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
      email: emailInput ? emailInput.value.trim() : "",
      code: codeInput ? codeInput.value.trim() : "",
      password: passwordInput ? passwordInput.value : "",
      confirmPassword: confirmInput ? confirmInput.value : "",
    };

    setSubmitLoading(true);
    setStatus(t("messages.resetSimulating", "Simulating reset request."), "info");

    try {
      const response = await requestReset(payload);
      if (response && response.ok) {
        setStatus(
          t("messages.resetSuccess", "Password reset simulated. You can sign in now."),
          "success"
        );
      } else {
        setStatus(
          t("messages.resetError", "Reset failed in demo mode."),
          "error"
        );
      }
    } catch (error) {
      setStatus(
        t("messages.resetException", "Unable to reset password."),
        "error"
      );
    } finally {
      setSubmitLoading(false);
    }
  });
}
