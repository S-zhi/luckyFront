window.APP_CONFIG = {
    // Default for local backend testing. Change this for other environments.
    // You can also override at runtime via localStorage key: LP_API_BASE_URL
    // e.g. localStorage.setItem('LP_API_BASE_URL', 'https://api.example.com/v1')
    API_BASE_URL: "http://localhost:8080/v1",
    API_TIMEOUT_MS: 15000,
    // Optional: set API path/url to fetch storage server options dynamically.
    // If set, runtime will try this API first, then fall back to STORAGE_SERVER_OPTIONS.
    // STORAGE_SERVER_OPTIONS_API: "/storage-servers",
    STORAGE_SERVER_OPTIONS: [
        { value: "backend", label: "本地存储 (backend)" },
        { value: "baidu_netdisk", label: "百度网盘 (baidu_netdisk)" },
        { value: "oss", label: "对象存储 OSS (oss)" },
        { value: "s3", label: "对象存储 S3 (s3)" }
    ],
    // Values in storage_server that should trigger `upload_to_baidu=true`.
    BAIDU_STORAGE_SERVER_VALUES: ["baidu_netdisk"],
    MODEL_UPLOAD_SUBDIR: "web-models",
    DATASET_UPLOAD_SUBDIR: "web-datasets",
};
