const i18nState = { data: null };

const getLocale = () => {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("lang");
  const htmlLang = document.documentElement.lang;
  const browserLang = navigator.language || "en";
  const raw = (override || htmlLang || browserLang).toLowerCase();
  return raw.startsWith("zh") ? "zh" : "en";
};

const getValue = (source, path) => {
  if (!source || !path) return undefined;
  return path.split(".").reduce((acc, key) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
      return acc[key];
    }
    return undefined;
  }, source);
};

const t = (key, fallback = "") => {
  const value = getValue(i18nState.data, key);
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return fallback;
};

const applyI18n = (data) => {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = getValue(data, element.dataset.i18n);
    if (typeof value === "string" || typeof value === "number") {
      element.textContent = String(value);
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const value = getValue(data, element.dataset.i18nPlaceholder);
    if (typeof value === "string" || typeof value === "number") {
      element.setAttribute("placeholder", String(value));
    }
  });
};

const loadI18n = async (namespace) => {
  const locale = getLocale();
  const response = await fetch(`../i18n/${namespace}.${locale}.json`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load i18n.");
  }
  return response.json();
};

const initI18n = async (namespace) => {
  try {
    i18nState.data = await loadI18n(namespace);
    applyI18n(i18nState.data);
  } catch (error) {
    console.error("i18n initialization failed:", error);
  }
};

window.i18n = {
  state: i18nState,
  getLocale,
  getValue,
  t,
  applyI18n,
  loadI18n,
  initI18n,
};

window.t = t;
window.initI18n = initI18n;
