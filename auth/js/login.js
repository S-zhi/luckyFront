initI18n("login");

// 登录表单。
const form = document.querySelector("[data-login-form]");
// 状态提示元素。
const statusEl = document.querySelector("[data-status]");
// 提交按钮。
const submitButton = document.querySelector("[data-submit]");


// 设置状态文案与提示语气。
const setStatus = (message, tone = "neutral") => {
  if (!statusEl) return;
  statusEl.hidden = false; 
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
};

// 设置提交按钮加载状态与文案。
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




// 登录请求。等待接入后端真实接口。TODO: 替换为真实接口调用。
const requestLogin = async (payload) => {
  /* 接入真实接口时可替换为：
  return fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  */

  return new Promise((resolve) => {
    // 模拟网络延迟。
    setTimeout(() => resolve({ ok: true }), 2900);
  });
};



// 处理登录表单提交。
if (form) {
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
    setStatus(
      t("messages.simulating", "Simulating request. Ready to connect the backend."),
      "info"
    );

    try {
      const response = await requestLogin(payload);
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
      setStatus(
        t("messages.exception", "Unable to simulate the request."),
        "error"
      );
    } finally {
      setLoading(false);
    }
  });
}



