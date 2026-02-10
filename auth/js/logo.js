// Logo 按钮。
const logoButton = document.querySelector("#lucky-logo");
if (logoButton) {
  window.addEventListener("load", () => {
    setTimeout(() => {
      logoButton.classList.add("is-active");
    }, 1000);
  });
}