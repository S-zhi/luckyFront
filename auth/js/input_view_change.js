// 密码可见性切换按钮集合。
const toggleButtons = document.querySelectorAll("[data-toggle-target]");


for (const button of toggleButtons) {
  const targetId = button.dataset.toggleTarget;
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
