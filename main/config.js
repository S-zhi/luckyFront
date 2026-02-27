window.APP_CONFIG = {
    // Default for local backend testing. Change this for other environments.
    // You can also override at runtime via localStorage key: LP_API_BASE_URL
    // e.g. localStorage.setItem('LP_API_BASE_URL', 'https://api.example.com/v1')
    API_BASE_URL: "http://localhost:8080/v1",
    API_TIMEOUT_MS: 15000,
    // 存储服务统一从 GET /v1/core-servers 获取（会自动拼接 API_BASE_URL）。
    CORE_SERVERS_API: "/core-servers",
    // 可选兜底配置：仅在 core-servers 接口不可用时使用。
    STORAGE_SERVER_OPTIONS: [],
    // Values in storage_server that should trigger `upload_to_baidu=true`.
    BAIDU_STORAGE_SERVER_VALUES: ["baidu_netdisk"],
    MODEL_UPLOAD_SUBDIR: "web-models",
    DATASET_UPLOAD_SUBDIR: "web-datasets",
};
