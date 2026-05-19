window.APP_CONFIG = {
    // Default for local backend testing. Change this for other environments.
    // You can also override at runtime via localStorage key: LP_API_BASE_URL
    // e.g. localStorage.setItem('LP_API_BASE_URL', 'https://api.example.com/v1')
    API_BASE_URL: "http://localhost:8080/v1",
    API_TIMEOUT_MS: 15000,
    BAIDU_OAUTH_BIND_ENDPOINT: "/baidu/oauth/token",
    BAIDU_OAUTH_DOC_URL: "https://pan.baidu.com/union/doc/6l0ryrjzv",
    // Optional: set API path/url to fetch storage server options dynamically.
    // If set, runtime will try this API first, then fall back to STORAGE_SERVER_OPTIONS.
    STORAGE_SERVER_OPTIONS_API: "/core-servers",
    STORAGE_SERVER_OPTIONS: [
        { value: "backend", label: "\u672c\u5730\u5b58\u50a8 (backend)" },
        { value: "baiduNetDisk", label: "\u767e\u5ea6\u7f51\u76d8 (baiduNetDisk)" },
        { value: "oss", label: "\u5bf9\u8c61\u5b58\u50a8 OSS (oss)" },
        { value: "s3", label: "\u5bf9\u8c61\u5b58\u50a8 S3 (s3)" }
    ],
    // Values in storage_server that should trigger `upload_to_baidu=true`.
    BAIDU_STORAGE_SERVER_VALUES: ["baiduNetDisk", "baidu_netdisk"],
    MODEL_UPLOAD_SUBDIR: "web-models",
    DATASET_UPLOAD_SUBDIR: "web-datasets",
};
