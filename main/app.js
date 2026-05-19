document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.getElementById('main-content');
    const navItems = document.querySelectorAll('.nav-item:not(.has-submenu)');
    const authSession = window.LP_AUTH || null;
    const CURRENT_PAGE_STORAGE_KEY = 'LP_CURRENT_PAGE';

    const DEFAULT_API_BASE_URL = 'http://localhost:8080/v1';
    let runtimeBaseUrl = '';
    try {
        runtimeBaseUrl = window.localStorage.getItem('LP_API_BASE_URL') || '';
    } catch (err) {
        runtimeBaseUrl = '';
    }
    const configuredBaseUrl = runtimeBaseUrl || (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL);
    const apiBaseUrl = (configuredBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    const timeoutMs = Number(window.APP_CONFIG && window.APP_CONFIG.API_TIMEOUT_MS) || 15000;
    const baiduOAuthBindEndpoint = String(
        (window.APP_CONFIG && window.APP_CONFIG.BAIDU_OAUTH_BIND_ENDPOINT) || '/baidu/oauth/token',
    ).trim() || '/baidu/oauth/token';
    const baiduOAuthDocUrl = String(
        (window.APP_CONFIG && window.APP_CONFIG.BAIDU_OAUTH_DOC_URL) || 'https://pan.baidu.com/union/doc/6l0ryrjzv',
    ).trim() || 'https://pan.baidu.com/union/doc/6l0ryrjzv';

    const TASK_TYPE_MAP = {
        detect: '检测 (Detection)',
        segment: '分割 (Segmentation)',
        classify: '分类 (Classification)',
        pose: '姿态 (Pose)',
        obb: 'OBB',
    };

    const DEFAULT_STORAGE_SERVER_OPTIONS = [
        { value: 'backend', label: '本地存储 (backend)' },
        { value: 'baiduNetDisk', label: '百度网盘 (baiduNetDisk)' },
        { value: 'oss', label: '对象存储 OSS (oss)' },
        { value: 's3', label: '对象存储 S3 (s3)' },
    ];

    const BAIDU_STORAGE_SERVER_CANONICAL = 'baiduNetDisk';

    const BAIDU_STORAGE_SERVER_VALUES = (() => {
        const configured = window.APP_CONFIG && window.APP_CONFIG.BAIDU_STORAGE_SERVER_VALUES;
        const source = Array.isArray(configured) ? configured : [BAIDU_STORAGE_SERVER_CANONICAL, 'baidu_netdisk'];
        const normalized = source
            .map((item) => String(item || '').trim().toLowerCase())
            .filter(Boolean);
        if (!normalized.includes('baidunetdisk')) {
            normalized.push('baidunetdisk');
        }
        if (!normalized.includes('baidu_netdisk')) {
            normalized.push('baidu_netdisk');
        }
        return new Set(normalized);
    })();

    let storageServerOptionsCache = null;
    let storageServerOptionsLoadError = null;

    // getAccessToken returns the current stored access token for API requests.
    const getAccessToken = () => {
        if (!authSession || typeof authSession.getAccessToken !== 'function') return '';
        return String(authSession.getAccessToken() || '').trim();
    };

    // applyCurrentUserProfile writes the stored user profile into the sidebar.
    const applyCurrentUserProfile = () => {
        if (!authSession || typeof authSession.getStoredUser !== 'function') return;
        const user = authSession.getStoredUser();
        if (!user || typeof user !== 'object') return;

        const avatarEl = document.querySelector('[data-current-user-avatar]');
        const nameEl = document.querySelector('[data-current-user-name]');
        const emailEl = document.querySelector('[data-current-user-email]');
        const statusEl = document.querySelector('[data-current-user-status]');
        const fullName = String(user.fullName || user.nickname || user.username || user.name || user.email || 'User').trim();
        const email = String(user.email || '').trim();
        const role = String(user.role || 'user').trim();
        const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'User';

        if (avatarEl) {
            avatarEl.textContent = fullName.slice(0, 1).toUpperCase() || 'U';
        }
        if (nameEl) {
            nameEl.textContent = fullName;
        }
        if (emailEl) {
            emailEl.textContent = email || 'unknown@luckey.studio';
        }
        if (statusEl) {
            statusEl.textContent = roleLabel;
        }
    };

    // buildAuthHeaders appends the bearer token to outgoing API headers.
    const buildAuthHeaders = (headers = {}) => {
        const nextHeaders = { ...headers };
        const token = getAccessToken();
        if (token && !nextHeaders.Authorization) {
            nextHeaders.Authorization = `Bearer ${token}`;
        }
        return nextHeaders;
    };

    // handleUnauthorizedAccess clears stale session data and returns to login.
    const handleUnauthorizedAccess = () => {
        if (authSession && typeof authSession.clearSession === 'function') {
            authSession.clearSession();
        }
        if (authSession && typeof authSession.redirectToLogin === 'function') {
            authSession.redirectToLogin();
        }
    };

    // normalizeDashboardPageName maps removed pages to their replacement destinations.
    const normalizeDashboardPageName = (pageName) => {
        const safePageName = String(pageName || '').trim();
        if (safePageName === 'training-results' || safePageName === 'model-training') {
            return 'model-validation';
        }
        return safePageName;
    };

    // persistCurrentPage stores the current dashboard page so refresh can restore it.
    const persistCurrentPage = (pageName) => {
        const safePageName = normalizeDashboardPageName(pageName);
        if (!safePageName) return;
        try {
            window.localStorage.setItem(CURRENT_PAGE_STORAGE_KEY, safePageName);
        } catch (error) {
            // Ignore storage failures and keep runtime behavior unchanged.
        }
    };

    // readPersistedCurrentPage returns the last stored dashboard page name.
    const readPersistedCurrentPage = () => {
        try {
            return String(window.localStorage.getItem(CURRENT_PAGE_STORAGE_KEY) || '').trim();
        } catch (error) {
            return '';
        }
    };

    // isSupportedDashboardPage checks whether a page name matches an existing sidebar destination.
    const isSupportedDashboardPage = (pageName) => {
        const safePageName = normalizeDashboardPageName(pageName);
        if (!safePageName) return false;
        return Array.from(navItems).some((item) => String(item.getAttribute('data-page') || '').trim() === safePageName);
    };

    // updateActiveNavigation synchronizes sidebar active styles with the current page.
    const updateActiveNavigation = (pageName) => {
        const safePageName = normalizeDashboardPageName(pageName);
        navItems.forEach((item) => {
            const itemPage = String(item.getAttribute('data-page') || '').trim();
            item.classList.toggle('active', itemPage === safePageName);
        });
    };

    const escapeHtml = (value) => {
        const str = String(value == null ? '' : value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const formatTaskType = (taskType) => {
        const key = String(taskType || '').toLowerCase();
        return TASK_TYPE_MAP[key] || (taskType || '--');
    };

    const formatSizeMB = (raw) => {
        const size = Number(raw);
        if (!Number.isFinite(size) || size < 0) return '--';
        if (size >= 1024) {
            return `${(size / 1024).toFixed(2)} GB`;
        }
        if (size >= 100) {
            return `${size.toFixed(0)} MB`;
        }
        if (size >= 10) {
            return `${size.toFixed(1)} MB`;
        }
        return `${size.toFixed(2)} MB`;
    };

    const formatDateTime = (value) => {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    };

    const formatDuration = (rawSeconds) => {
        const totalSeconds = Math.max(0, Math.round(Number(rawSeconds) || 0));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    const bytesToMB = (bytes) => {
        const value = Number(bytes) / (1024 * 1024);
        if (!Number.isFinite(value) || value <= 0) return '0.01';
        return value >= 100 ? value.toFixed(0) : value.toFixed(2);
    };

    const formatFileSize = (bytes) => {
        const num = Number(bytes);
        if (!Number.isFinite(num) || num < 0) return '--';
        if (num >= 1024 * 1024 * 1024) {
            return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }
        if (num >= 1024 * 1024) {
            return `${(num / (1024 * 1024)).toFixed(2)} MB`;
        }
        if (num >= 1024) {
            return `${(num / 1024).toFixed(1)} KB`;
        }
        return `${num} B`;
    };

    const trimExtension = (filename) => filename.replace(/\.[^.]+$/, '');

    const isTruthyFlag = (value) => {
        if (typeof value === 'boolean') return value;
        const text = String(value || '').trim().toLowerCase();
        return text === '1' || text === 'true' || text === 't' || text === 'yes' || text === 'y';
    };

    const shouldUploadToBaidu = (storageServer) => {
        const value = String(storageServer || '').trim().toLowerCase();
        if (!value) return false;
        if (BAIDU_STORAGE_SERVER_VALUES.has(value)) return true;
        return value.includes('baidu');
    };

    const normalizeStorageServerValue = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        if (shouldUploadToBaidu(raw)) return BAIDU_STORAGE_SERVER_CANONICAL;
        if (raw === 'local' || raw === 'localhost') return 'backend';
        return raw;
    };

    const uniqueStorageServers = (values = []) => {
        const result = [];
        const seen = new Set();
        values.forEach((item) => {
            const normalized = normalizeStorageServerValue(item);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            result.push(normalized);
        });
        return result;
    };

    const getCreatedEntityId = (data) => {
        const candidates = [
            data && data.id,
            data && data.data && data.data.id,
            data && data.model && data.model.id,
            data && data.dataset && data.dataset.id,
            data && data.result && data.result.id,
        ];

        for (let i = 0; i < candidates.length; i += 1) {
            const id = Number(candidates[i]);
            if (Number.isInteger(id) && id > 0) {
                return id;
            }
        }
        return null;
    };

    async function syncStorageServersForEntity(entityPathPrefix, entityId, storageServers = []) {
        return updateStorageServersForEntity(entityPathPrefix, entityId, 'add', storageServers);
    }

    async function updateStorageServersForEntity(entityPathPrefix, entityId, action = 'add', storageServers = []) {
        const normalizedId = Number(entityId);
        if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
            throw new Error('未获取到新建记录的 id');
        }

        const servers = uniqueStorageServers(storageServers);
        const safeAction = String(action || 'add').trim() || 'add';
        if (!servers.length && safeAction !== 'set') return;

        await apiRequest(`/${entityPathPrefix}/${normalizedId}/storage-server`, {
            method: 'PATCH',
            body: {
                action: safeAction,
                storage_servers: servers,
            },
        });
    }

    const getStorageServersForSync = (storageServer, {
        requestBaiduUpload = false,
        baiduUploaded = false,
    } = {}) => {
        const normalized = normalizeStorageServerValue(storageServer);
        const values = [];

        if (normalized) {
            values.push(normalized);
        }

        if (requestBaiduUpload && baiduUploaded) {
            values.push(BAIDU_STORAGE_SERVER_CANONICAL);
        }

        if (!values.length) {
            values.push('backend');
        }

        return uniqueStorageServers(values);
    };

    const formatStorageServerLabel = (value) => {
        const normalized = normalizeStorageServerValue(value);
        if (normalized === 'backend') return '本地 (backend)';
        if (normalized === BAIDU_STORAGE_SERVER_CANONICAL) return '百度网盘 (baiduNetDisk)';
        return normalized || '--';
    };

    const parseStorageServers = (...sources) => {
        const values = [];
        sources.forEach((source) => {
            if (Array.isArray(source)) {
                source.forEach((item) => values.push(item));
                return;
            }
            if (source == null) return;
            if (typeof source === 'string') {
                const text = source.trim();
                if (!text) return;
                if (text.startsWith('[') && text.endsWith(']')) {
                    try {
                        const parsed = JSON.parse(text);
                        if (Array.isArray(parsed)) {
                            parsed.forEach((item) => values.push(item));
                            return;
                        }
                    } catch (error) {
                        // Ignore JSON parse errors and treat as plain string.
                    }
                }
                values.push(text);
                return;
            }
            values.push(source);
        });
        return uniqueStorageServers(values);
    };

    const getPathFileName = (path) => {
        const text = String(path || '').trim();
        if (!text) return '';
        const normalized = text.split('?')[0].replace(/\/+$/, '');
        const chunks = normalized.split('/');
        return String(chunks[chunks.length - 1] || '').trim();
    };

    async function downloadFromBaiduToLocal({
        remotePath,
        category = 'weights',
        subdir = '',
        fileName = '',
    } = {}) {
        const safeRemotePath = String(remotePath || '').trim();
        if (!safeRemotePath) {
            throw new Error('`remote_path` 不能为空');
        }

        const payload = {
            remote_path: safeRemotePath,
            category: String(category || 'weights').trim() || 'weights',
        };
        const safeSubdir = String(subdir || '').trim();
        const safeFileName = String(fileName || '').trim();
        if (safeSubdir) payload.subdir = safeSubdir;
        if (safeFileName) payload.file_name = safeFileName;

        return apiRequest('/baidu/download', {
            method: 'POST',
            body: payload,
        });
    }

    function setupDropzone({
        zone,
        fileInput,
        hintEl,
        defaultHint,
        onFile,
    }) {
        if (!zone || !fileInput) return;

        const setHint = (text) => {
            if (!hintEl) return;
            hintEl.textContent = text || defaultHint || '';
        };

        setHint(defaultHint);

        const pickFile = () => fileInput.click();

        zone.addEventListener('click', () => {
            pickFile();
        });

        zone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pickFile();
            }
        });

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('is-dragover');
        });

        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (!zone.contains(e.relatedTarget)) {
                zone.classList.remove('is-dragover');
            }
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('is-dragover');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            onFile(file);
            setHint(`已选择文件：${file.name}（${formatFileSize(file.size)}）`);
        });

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                setHint(defaultHint);
                return;
            }
            onFile(file);
            setHint(`已选择文件：${file.name}（${formatFileSize(file.size)}）`);
        });
    }

    const buildQuery = (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value == null || value === '') return;
            query.set(key, String(value));
        });
        const text = query.toString();
        return text ? `?${text}` : '';
    };

    const parseVersionAsNumber = (value) => {
        const text = String(value || '').trim();
        if (!text) return NaN;

        const normalized = text.replace(',', '.').replace(/^v/i, '').trim();
        const direct = Number(normalized);
        if (Number.isFinite(direct)) return direct;

        const prefixMatch = normalized.match(/^\d+(?:\.\d+)?/);
        if (!prefixMatch) return NaN;

        const prefixNum = Number(prefixMatch[0]);
        return Number.isFinite(prefixNum) ? prefixNum : NaN;
    };

    const inferFrameworkFromValue = (value) => {
        const text = String(value || '').trim().toLowerCase();
        if (!text) return '';
        if (text === 'pytorch' || text.includes('torch')) return 'pytorch';
        if (text === 'onnxruntime' || text === 'onnx' || text.includes('onnx')) return 'onnxruntime';
        if (text === 'tensorrt' || text === 'trt' || text.includes('tensorrt')) return 'tensorrt';
        if (text === 'tensorflow' || text === 'tf' || text.includes('tensorflow')) return 'tensorflow';
        if (text === 'paddle' || text.includes('paddle')) return 'paddle';
        if (text === 'openvino' || text.includes('openvino')) return 'openvino';
        if (text === 'ncnn' || text.includes('ncnn')) return 'ncnn';
        return '';
    };

    const inferFrameworkFromFileName = (fileName) => {
        const ext = String(fileName || '').split('.').pop().trim().toLowerCase();
        if (!ext) return '';
        if (ext === 'pt' || ext === 'pth' || ext === 'ckpt') return 'pytorch';
        if (ext === 'onnx') return 'onnxruntime';
        if (ext === 'engine' || ext === 'trt') return 'tensorrt';
        return '';
    };

    const resolveModelFramework = (algorithmId, fileName) => (
        inferFrameworkFromValue(algorithmId) || inferFrameworkFromFileName(fileName)
    );

    const getFileExtensionWithDot = (fileName) => {
        const text = String(fileName || '').trim();
        const idx = text.lastIndexOf('.');
        if (idx <= 0 || idx === text.length - 1) return '';
        return text.slice(idx);
    };

    const sanitizeFilePart = (value, fallback = 'model') => {
        const raw = String(value || '').trim();
        const normalized = raw
            .replace(/\s+/g, '_')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        return normalized || fallback;
    };

    const buildModelUploadFileName = ({ name, version, originalFileName }) => {
        const safeName = sanitizeFilePart(name, 'model');
        const versionText = String(version || '').trim().replace(/^v/i, '');
        const safeVersion = sanitizeFilePart(versionText, '1');
        const ext = getFileExtensionWithDot(originalFileName);
        return `${safeName}_v${safeVersion}${ext}`;
    };

    const parseVersionParts = (value) => {
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return null;
        const normalized = raw.replace(/^v/i, '');
        const match = normalized.match(/^(\d+)(?:\.(\d+))?/);
        if (!match) return null;
        const major = Number(match[1]);
        if (!Number.isInteger(major) || major < 0) return null;
        const minorText = match[2] || '';
        const minor = minorText ? Number(minorText) : 0;
        if (!Number.isInteger(minor) || minor < 0) return null;
        return {
            major,
            minor,
            hasMinor: minorText.length > 0,
        };
    };

    const compareVersionParts = (a, b) => {
        if (!a && !b) return 0;
        if (!a) return -1;
        if (!b) return 1;
        if (a.major !== b.major) return a.major - b.major;
        return a.minor - b.minor;
    };

    const getNextVersionTextFromModels = (models = []) => {
        let latest = null;
        models.forEach((model) => {
            const parts = parseVersionParts(model && model.version);
            if (!parts) return;
            if (!latest || compareVersionParts(parts, latest) > 0) {
                latest = parts;
            }
        });

        if (!latest) return 'v1.0';
        if (!latest.hasMinor) return `v${latest.major}.1`;

        const nextMinor = latest.minor + 1;
        return `v${latest.major}.${nextMinor}`;
    };

    async function apiRequest(path, {
        method = 'GET',
        query = {},
        body,
        formData,
        headers = {},
    } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const isAbsolute = /^https?:\/\//i.test(path);
            const normalizedPath = isAbsolute
                ? path
                : `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
            const url = `${normalizedPath}${buildQuery(query)}`;

            const finalHeaders = {
                Accept: 'application/json',
                ...buildAuthHeaders(headers),
            };
            const options = {
                method,
                headers: finalHeaders,
                signal: controller.signal,
            };

            if (formData instanceof FormData) {
                options.body = formData;
                delete options.headers['Content-Type'];
            } else if (body !== undefined) {
                let normalizedBody = body;
                const isModelsEndpoint = /\/models(?:\/\d+)?$/i.test(normalizedPath);
                if (
                    isModelsEndpoint &&
                    normalizedBody &&
                    typeof normalizedBody === 'object' &&
                    !Array.isArray(normalizedBody) &&
                    normalizedBody.version != null
                ) {
                    const parsedVersion = parseVersionAsNumber(normalizedBody.version);
                    if (Number.isFinite(parsedVersion)) {
                        normalizedBody = { ...normalizedBody, version: parsedVersion };
                    } else {
                        const nextBody = { ...normalizedBody };
                        delete nextBody.version;
                        normalizedBody = nextBody;
                    }
                }
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(normalizedBody);
            }

            const res = await fetch(url, options);
            const text = await res.text();
            let data = null;

            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (err) {
                    data = text;
                }
            }

            if (!res.ok) {
                const message = data && typeof data === 'object' && data.error
                    ? data.error
                    : `请求失败 (${res.status})`;
                const error = new Error(message);
                error.status = res.status;
                error.responseData = data;
                if (res.status === 401) {
                    handleUnauthorizedAccess();
                }
                throw error;
            }

            return data;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('请求超时，请检查后端服务状态。');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    // buildVideoFrameDownloadUrl returns the ZIP download URL for a video's frame results.
    const buildVideoFrameDownloadUrl = (video) => {
        const id = Number(video && video.id);
        if (!Number.isInteger(id) || id <= 0) return '';
        if (!video || !video.frame_capture_completed) return '';

        const explicitUrl = String(video.frame_download_url || '').trim();
        if (explicitUrl) {
            return explicitUrl;
        }
        return `${apiBaseUrl}/videos/${id}/frames/fixed/download`;
    };

    const parseAttachmentFileName = (contentDisposition) => {
        const header = String(contentDisposition || '').trim();
        if (!header) return '';

        const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match && utf8Match[1]) {
            try {
                return decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ''));
            } catch (error) {
                return utf8Match[1].trim().replace(/^["']|["']$/g, '');
            }
        }

        const plainMatch = header.match(/filename=([^;]+)/i);
        if (!plainMatch || !plainMatch[1]) return '';
        return plainMatch[1].trim().replace(/^["']|["']$/g, '');
    };

    async function downloadModelFileById(modelId, fallbackName = '') {
        const id = Number(modelId);
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error('无效模型 ID');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = `${apiBaseUrl}/models/${id}/download`;
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: '*/*',
                    ...buildAuthHeaders(),
                },
                credentials: 'include',
                signal: controller.signal,
            });

            if (!res.ok) {
                if (res.status === 401) {
                    handleUnauthorizedAccess();
                }
                let message = `下载失败 (${res.status})`;
                try {
                    const text = await res.text();
                    if (text) {
                        try {
                            const data = JSON.parse(text);
                            if (data && data.error) message = String(data.error);
                        } catch (error) {
                            message = text;
                        }
                    }
                } catch (error) {
                    // ignore secondary parse errors
                }
                throw new Error(message);
            }

            const blob = await res.blob();
            if (!blob || blob.size <= 0) {
                throw new Error('下载内容为空');
            }

            const fromHeader = parseAttachmentFileName(res.headers.get('Content-Disposition'));
            const safeName = String(fromHeader || fallbackName || `model-${id}`).trim() || `model-${id}`;

            const objectUrl = URL.createObjectURL(blob);
            try {
                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = safeName;
                document.body.appendChild(link);
                link.click();
                link.remove();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('下载超时，请检查后端服务状态。');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    const normalizeStorageOptions = (source) => {
        const normalizeSourceToArray = (input) => {
            if (Array.isArray(input)) return input;
            if (!input || typeof input !== 'object') return [];

            // Support object-map style payloads, e.g.:
            // { "backend": {...}, "remote-a": {...} }
            return Object.entries(input).map(([key, value]) => {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    return {
                        ...value,
                        name: value.name || value.Name || key,
                        value: value.value || value.Value || value.name || value.Name || key,
                        state: value.state || value.State || value.status || value.Status || '',
                    };
                }
                if (typeof value === 'string') {
                    return { name: value, value };
                }
                return { name: key, value: key };
            });
        };

        const sourceArray = normalizeSourceToArray(source);
        if (!sourceArray.length) return [];
        const result = [];
        sourceArray.forEach((item) => {
            if (typeof item === 'string') {
                const value = normalizeStorageServerValue(item);
                if (!value) return;
                result.push({ value, label: formatStorageServerLabel(value) });
                return;
            }
            if (!item || typeof item !== 'object') return;
            const stateText = String(item.state || item.State || item.status || item.Status || '').trim().toLowerCase();
            if (stateText === 'inactive') return;
            const rawValue = String(
                item.value
                || item.Value
                || item.name
                || item.Name
                || item.id
                || item.key
                || item.code
                || item.server_name
                || item.storage_server
                || item.storageServer
                || '',
            ).trim();
            const value = normalizeStorageServerValue(rawValue);
            if (!value) return;
            const label = String(
                item.label
                || item.Label
                || item.title
                || item.display_name
                || item.displayName
                || item.name
                || item.Name
                || '',
            ).trim();
            result.push({ value, label: label || formatStorageServerLabel(value) });
        });

        const unique = [];
        const seen = new Set();
        result.forEach((item) => {
            if (seen.has(item.value)) return;
            seen.add(item.value);
            unique.push(item);
        });
        return unique;
    };

    const getConfiguredStorageOptions = () => {
        const configured = window.APP_CONFIG && window.APP_CONFIG.STORAGE_SERVER_OPTIONS;
        const options = normalizeStorageOptions(configured);
        return options.length ? options : null;
    };

    const setSelectOptions = (selectEl, options, {
        placeholder = '请选择',
        selectedValue = '',
    } = {}) => {
        if (!selectEl) return;
        const safeSelected = String(selectedValue || '');
        const optionMarkup = options.map((item) => (
            `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`
        )).join('');

        selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${optionMarkup}`;
        if (safeSelected && options.some((item) => item.value === safeSelected)) {
            selectEl.value = safeSelected;
            return;
        }

        if (!safeSelected && options.length > 0) {
            selectEl.value = options[0].value;
        }
    };

    async function loadStorageServerOptions() {
        if (storageServerOptionsCache && storageServerOptionsCache.length) {
            return storageServerOptionsCache;
        }

        const configuredEndpoint = window.APP_CONFIG && window.APP_CONFIG.STORAGE_SERVER_OPTIONS_API;
        const endpoint = (typeof configuredEndpoint === 'string' && configuredEndpoint.trim())
            ? configuredEndpoint.trim()
            : '/core-servers';
        if (endpoint) {
            try {
                const data = await apiRequest(endpoint, { method: 'GET' });
                const list = (data && data.list)
                    || (data && data.options)
                    || (data && data.items)
                    || (data && data.core_servers)
                    || (data && data.storage_servers)
                    || (data && data.data && data.data.list)
                    || (data && data.data && data.data.items)
                    || (data && data.data && data.data.core_servers)
                    || (data && data.data)
                    || data;
                const fromApi = normalizeStorageOptions(list);
                if (fromApi.length) {
                    storageServerOptionsCache = fromApi;
                    storageServerOptionsLoadError = null;
                    return storageServerOptionsCache;
                }
                throw new Error('存储服务列表为空');
            } catch (error) {
                storageServerOptionsLoadError = `无法加载存储服务：${error.message}`;
                throw new Error(storageServerOptionsLoadError);
            }
        }

        const fromConfig = getConfiguredStorageOptions();
        if (fromConfig) {
            storageServerOptionsCache = fromConfig;
            storageServerOptionsLoadError = null;
            return storageServerOptionsCache;
        }

        storageServerOptionsCache = DEFAULT_STORAGE_SERVER_OPTIONS;
        storageServerOptionsLoadError = null;
        return storageServerOptionsCache;
    }

    // filterStorageOptionsForScope limits storage server options for specific form scopes.
    function filterStorageOptionsForScope(options = [], scope = '') {
        const safeScope = String(scope || '').trim().toLowerCase();
        if (safeScope !== 'model') return Array.isArray(options) ? options : [];

        return (Array.isArray(options) ? options : []).filter((item) => {
            const value = normalizeStorageServerValue(item && item.value);
            return value === 'backend' || value === BAIDU_STORAGE_SERVER_CANONICAL;
        });
    }

    // populateStorageServerSelects loads and applies storage server options for form selects.
    async function populateStorageServerSelects(root = document) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const selects = root.querySelectorAll('[data-storage-server-select]');
        if (!selects || selects.length === 0) return;

        try {
            const options = await loadStorageServerOptions();
            selects.forEach((selectEl) => {
                const currentValue = selectEl.value || '';
                const scope = String(selectEl.dataset.storageServerScope || '').trim();
                const scopedOptions = filterStorageOptionsForScope(options, scope);
                setSelectOptions(selectEl, scopedOptions, {
                    placeholder: '请选择存储服务',
                    selectedValue: currentValue,
                });
                selectEl.disabled = false;
            });
        } catch (error) {
            const message = String(error && error.message || '存储服务加载失败').trim();
            selects.forEach((selectEl) => {
                selectEl.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
                selectEl.value = '';
                selectEl.disabled = true;
                selectEl.title = message;
            });
            throw error;
        }
    }

    async function uploadFileViaApi(endpoint, {
        file,
        storageServer,
        subdir,
        uploadToBaidu = false,
    }) {
        if (!(file instanceof File)) {
            throw new Error('未选择有效文件');
        }

        const form = new FormData();
        form.append('file', file, file.name);
        if (subdir) form.append('subdir', subdir);
        if (storageServer) form.append('storage_server', storageServer);
        if (uploadToBaidu) form.append('upload_to_baidu', 'true');

        return apiRequest(endpoint, {
            method: 'POST',
            formData: form,
        });
    }

    async function createModelWithFileViaApi({
        file,
        model,
        uploadFileName = '',
        uploadToBaidu = false,
    }) {
        if (!(file instanceof File)) {
            throw new Error('未选择有效文件');
        }

        const form = new FormData();
        const effectiveFileName = String(uploadFileName || '').trim() || file.name;
        form.append('file', file, effectiveFileName);
        if (model && typeof model === 'object') {
            form.append('model', JSON.stringify(model));
        }
        if (uploadToBaidu) form.append('upload_to_baidu', 'true');

        return apiRequest('/models', {
            method: 'POST',
            formData: form,
        });
    }

    function showAlert(container, message, tone = 'info') {
        if (!container) return;
        container.innerHTML = `<div class="alert ${tone === 'error' ? 'error' : 'info'}">${escapeHtml(message)}</div>`;
    }

    function clearAlert(container) {
        if (!container) return;
        container.innerHTML = '';
    }

    let propertyModalRefs = null;
    let modelMetadataEditModalRefs = null;
    let storageSyncModalRefs = null;

    function ensurePropertyModal() {
        if (propertyModalRefs) return propertyModalRefs;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay property-modal-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="modal-card property-modal-card">
                <div class="modal-header">
                    <h3 data-property-title>属性详情</h3>
                    <button class="btn-icon" type="button" data-property-close title="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="form-divider"></div>
                <div class="property-toolbar">
                    <span class="property-meta" data-property-meta>0 涓瓧娈?/span>
                    <div class="property-toolbar-actions">
                        <button class="btn btn-secondary" type="button" data-property-edit hidden>
                            <i class="fa-solid fa-pen"></i>
                            编辑
                        </button>
                        <button class="btn btn-secondary" type="button" data-property-copy>
                            <i class="fa-solid fa-copy"></i>
                            复制 JSON
                        </button>
                    </div>
                </div>
                <div class="property-grid" data-property-grid></div>
                <details class="property-raw-panel">
                    <summary>查看原始 JSON</summary>
                    <pre class="property-json-block" data-property-json>{}</pre>
                </details>
                <div class="form-actions modal-actions">
                    <button class="btn btn-secondary" type="button" data-property-close>关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const titleEl = overlay.querySelector('[data-property-title]');
        const metaEl = overlay.querySelector('[data-property-meta]');
        const gridEl = overlay.querySelector('[data-property-grid]');
        const jsonEl = overlay.querySelector('[data-property-json]');
        const copyBtn = overlay.querySelector('[data-property-copy]');
        const editBtn = overlay.querySelector('[data-property-edit]');
        const closeBtns = overlay.querySelectorAll('[data-property-close]');
        let currentJsonText = '{}';
        let currentDetailPayload = {};
        let currentEditHandler = null;

        const closeModal = () => {
            overlay.hidden = true;
        };

        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                if (!currentJsonText) return;
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(currentJsonText);
                        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> 已复制';
                        setTimeout(() => {
                            copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> 复制 JSON';
                        }, 1200);
                    } else {
                        window.prompt('复制 JSON：', currentJsonText);
                    }
                } catch (error) {
                    window.prompt('复制 JSON：', currentJsonText);
                }
            });
        }

        if (editBtn) {
            editBtn.addEventListener('click', async () => {
                if (typeof currentEditHandler !== 'function') return;
                editBtn.disabled = true;
                const original = editBtn.innerHTML;
                editBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 处理中';
                try {
                    await currentEditHandler(currentDetailPayload);
                } finally {
                    editBtn.disabled = false;
                    editBtn.innerHTML = original;
                }
            });
        }

        closeBtns.forEach((btn) => btn.addEventListener('click', closeModal));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.hidden) closeModal();
        });

        propertyModalRefs = {
            overlay,
            titleEl,
            metaEl,
            gridEl,
            jsonEl,
            copyBtn,
            editBtn,
            closeModal,
            setJsonText: (text) => {
                currentJsonText = text;
            },
            setDetailPayload: (payload) => {
                currentDetailPayload = payload;
            },
            setEditAction: (editAction) => {
                currentEditHandler = editAction && typeof editAction.handler === 'function'
                    ? editAction.handler
                    : null;
                if (!editBtn) return;
                if (currentEditHandler) {
                    editBtn.hidden = false;
                    const label = String((editAction && editAction.label) || '编辑').trim() || '编辑';
                    editBtn.innerHTML = `<i class="fa-solid fa-pen"></i> ${escapeHtml(label)}`;
                } else {
                    editBtn.hidden = true;
                    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> 编辑';
                }
            },
        };
        return propertyModalRefs;
    }

    const getPropertyTypeLabel = (value) => {
        if (value == null) return 'null';
        if (Array.isArray(value)) return `array(${value.length})`;
        return typeof value;
    };

    const formatPropertyPrimitive = (value) => {
        if (value == null) return 'null';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return '';
    };

    const normalizePropertyPayload = (detail) => {
        if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
            return detail;
        }
        return { value: detail };
    };

    const buildPropertyGridHtml = (payload) => {
        const entries = Object.entries(payload || {});
        if (!entries.length) {
            return '<div class="property-empty">暂无字段信息</div>';
        }
        return entries.map(([key, value]) => {
            const typeLabel = getPropertyTypeLabel(value);
            const keyText = escapeHtml(String(key));
            const typeText = escapeHtml(typeLabel);
            if (value != null && typeof value === 'object') {
                const prettyValue = escapeHtml(JSON.stringify(value, null, 2));
                return `
                    <article class="property-item">
                        <div class="property-item-head">
                            <span class="property-item-key">${keyText}</span>
                            <span class="property-item-type">${typeText}</span>
                        </div>
                        <pre class="property-item-code">${prettyValue}</pre>
                    </article>
                `;
            }
            const simpleValue = escapeHtml(formatPropertyPrimitive(value));
            return `
                <article class="property-item">
                    <div class="property-item-head">
                        <span class="property-item-key">${keyText}</span>
                        <span class="property-item-type">${typeText}</span>
                    </div>
                    <div class="property-item-text">${simpleValue || '--'}</div>
                </article>
            `;
        }).join('');
    };

    function openPropertyModal(title, detail, options = {}) {
        const refs = ensurePropertyModal();
        const safeTitle = String(title || '属性详情').trim() || '属性详情';
        refs.titleEl.textContent = safeTitle;

        const payload = normalizePropertyPayload(detail);
        const jsonText = JSON.stringify(payload, null, 2);
        refs.jsonEl.textContent = jsonText;
        refs.gridEl.innerHTML = buildPropertyGridHtml(payload);
        refs.metaEl.textContent = `${Object.keys(payload).length} 个字段`;
        refs.setJsonText(jsonText);
        refs.setDetailPayload(payload);
        refs.setEditAction(options.editAction || null);

        refs.overlay.hidden = false;
    }

    function ensureModelMetadataEditModal() {
        if (modelMetadataEditModalRefs) return modelMetadataEditModalRefs;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay model-metadata-edit-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="modal-card model-metadata-edit-card">
                <div class="modal-header">
                    <h3 data-model-metadata-title>编辑模型元信息</h3>
                    <button class="btn-icon" type="button" data-model-metadata-close title="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <p class="modal-subtitle">
                    更新接口：
                    <code>PATCH /v1/models/:id</code>
                </p>
                <div class="form-divider"></div>
                <form data-model-metadata-form>
                    <div class="form-grid-2">
                        <div class="form-group">
                            <label for="model-meta-name">名称 <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="model-meta-name" name="name" class="form-control" type="text" required />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-version">版本（可选）</label>
                            <input id="model-meta-version" name="version" class="form-control" type="text" placeholder="1.0 或 v1.0.0" />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-task-type">任务类型 <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="model-meta-task-type" name="task_type" class="form-control" type="text" required />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-weight-name">权重文件名<span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="model-meta-weight-name" name="weight_name" class="form-control" type="text" required />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-is-base">是否基础模型 <span class="required-mark" aria-hidden="true">*</span></label>
                            <select id="model-meta-is-base" name="is_base_model" class="form-control" required>
                                <option value="yes">是</option>
                                <option value="no">否</option>
                            </select>
                        </div>
                        <div class="form-group" data-model-meta-base-id-group hidden>
                            <label for="model-meta-base-id">基础模型ID <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="model-meta-base-id" name="base_model_id" class="form-control" type="number" min="1" step="1" />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-algorithm">算法ID（可空）</label>
                            <input id="model-meta-algorithm" name="algorithm_id" class="form-control" type="text" />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-framework">框架（可空）</label>
                            <input id="model-meta-framework" name="framework" class="form-control" type="text" />
                        </div>
                    <div class="form-group form-span-2">
                        <label for="model-meta-storage-servers">存储服务（逗号分隔）</label>
                        <input id="model-meta-storage-servers" name="storage_servers" class="form-control" type="text" placeholder="backend, baiduNetDisk" />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-paper">论文链接（可空）</label>
                            <input id="model-meta-paper" name="paper" class="form-control" type="text" />
                        </div>
                        <div class="form-group">
                            <label for="model-meta-params-url">参数链接（可空）</label>
                            <input id="model-meta-params-url" name="params_url" class="form-control" type="text" />
                        </div>
                        <div class="form-group form-span-2">
                            <label for="model-meta-description">描述（可空）</label>
                            <textarea id="model-meta-description" name="description" class="form-control model-textarea" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="model-metadata-edit-feedback alert info" data-model-metadata-feedback hidden></div>
                    <div class="form-actions modal-actions">
                        <button class="btn btn-secondary" type="button" data-model-metadata-close>取消</button>
                        <button class="btn btn-primary" type="submit">
                            <i class="fa-solid fa-floppy-disk"></i>
                            保存修改
                        </button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        const titleEl = overlay.querySelector('[data-model-metadata-title]');
        const formEl = overlay.querySelector('[data-model-metadata-form]');
        const feedbackEl = overlay.querySelector('[data-model-metadata-feedback]');
        const closeBtns = overlay.querySelectorAll('[data-model-metadata-close]');
        const nameInput = overlay.querySelector('#model-meta-name');
        const versionInput = overlay.querySelector('#model-meta-version');
        const taskTypeInput = overlay.querySelector('#model-meta-task-type');
        const weightNameInput = overlay.querySelector('#model-meta-weight-name');
        const isBaseModelSelect = overlay.querySelector('#model-meta-is-base');
        const baseModelIdGroup = overlay.querySelector('[data-model-meta-base-id-group]');
        const baseModelIdInput = overlay.querySelector('#model-meta-base-id');
        const algorithmInput = overlay.querySelector('#model-meta-algorithm');
        const frameworkInput = overlay.querySelector('#model-meta-framework');
        const storageServersInput = overlay.querySelector('#model-meta-storage-servers');
        const paperInput = overlay.querySelector('#model-meta-paper');
        const paramsUrlInput = overlay.querySelector('#model-meta-params-url');
        const descriptionInput = overlay.querySelector('#model-meta-description');
        let resolver = null;

        const updateBaseModelIdVisibility = () => {
            const selected = String(isBaseModelSelect && isBaseModelSelect.value || 'yes').trim();
            const shouldShow = selected === 'no';
            if (baseModelIdGroup) {
                baseModelIdGroup.hidden = !shouldShow;
            }
            if (baseModelIdInput) {
                baseModelIdInput.required = shouldShow;
                if (!shouldShow) {
                    baseModelIdInput.value = '';
                }
            }
        };

        const setFeedback = (message, tone = 'info') => {
            if (!feedbackEl) return;
            if (!message) {
                feedbackEl.hidden = true;
                feedbackEl.className = 'model-metadata-edit-feedback alert info';
                feedbackEl.textContent = '';
                return;
            }
            feedbackEl.hidden = false;
            feedbackEl.className = `model-metadata-edit-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            feedbackEl.textContent = message;
        };

        const closeModal = (value = null) => {
            overlay.hidden = true;
            setFeedback('');
            if (resolver) {
                const cb = resolver;
                resolver = null;
                cb(value);
            }
        };

        const toNullableString = (value) => {
            const text = String(value || '').trim();
            return text ? text : null;
        };

        const getVersionInputText = (value) => {
            if (value == null || value === '') return '';
            return String(value).trim();
        };

        const buildPatchPayload = () => {
            const name = String(nameInput && nameInput.value || '').trim();
            const taskType = String(taskTypeInput && taskTypeInput.value || '').trim();
            const weightName = String(weightNameInput && weightNameInput.value || '').trim();
            const version = parseVersionAsNumber(versionInput && versionInput.value);

            if (!name) {
                throw new Error('`name` 不能为空。');
            }
            if (!taskType) {
                throw new Error('`task_type` 不能为空。');
            }
            if (!weightName) {
                throw new Error('`weight_name` 不能为空。');
            }

            const payload = {
                name,
                task_type: taskType,
                weight_name: weightName,
                algorithm_id: toNullableString(algorithmInput && algorithmInput.value),
                description: toNullableString(descriptionInput && descriptionInput.value),
                framework: toNullableString(frameworkInput && frameworkInput.value),
                paper: toNullableString(paperInput && paperInput.value),
                params_url: toNullableString(paramsUrlInput && paramsUrlInput.value),
            };

            if (Number.isFinite(version)) {
                payload.version = version;
            }

            const isBaseModel = String(isBaseModelSelect && isBaseModelSelect.value || 'yes').trim();
            if (isBaseModel === 'no') {
                const baseModelRaw = String(baseModelIdInput && baseModelIdInput.value || '').trim();
                if (!baseModelRaw) {
                    throw new Error('选择“非基础模型”时，必须填写基础模型ID。');
                }
                const baseModelID = Number(baseModelRaw);
                if (!Number.isInteger(baseModelID) || baseModelID <= 0) {
                    throw new Error('`base_model_id` 必须是大于 0 的整数。');
                }
                payload.base_model_id = baseModelID;
            } else {
                payload.base_model_id = 0;
            }

            const storageRaw = String(storageServersInput && storageServersInput.value || '').trim();
            const storageParts = storageRaw
                ? storageRaw.split(/[\n,，]/g).map((item) => item.trim()).filter(Boolean)
                : [];
            payload.storage_servers = parseStorageServers(storageParts);

            return payload;
        };

        if (formEl) {
            formEl.addEventListener('submit', (e) => {
                e.preventDefault();
                try {
                    const payload = buildPatchPayload();
                    closeModal(payload);
                } catch (error) {
                    setFeedback(error.message || '表单校验失败。', 'error');
                }
            });
        }

        if (isBaseModelSelect) {
            isBaseModelSelect.addEventListener('change', () => {
                updateBaseModelIdVisibility();
            });
        }

        closeBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                closeModal(null);
            });
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(null);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.hidden) closeModal(null);
        });

        modelMetadataEditModalRefs = {
            open({
                model = {},
                title = '',
            } = {}) {
                setFeedback('');

                const modelName = String(model && model.name || '').trim();
                const modelId = Number(model && model.id);
                const defaultTitle = modelName
                    ? `编辑模型 - ${modelName}`
                    : (Number.isInteger(modelId) && modelId > 0 ? `编辑模型 - #${modelId}` : '编辑模型元信息');
                titleEl.textContent = String(title || defaultTitle).trim() || '编辑模型元信息';

                nameInput.value = String(model && model.name || '').trim();
                versionInput.value = getVersionInputText(model && model.version);
                taskTypeInput.value = String(model && model.task_type || '').trim();
                weightNameInput.value = String(
                    (model && model.weight_name) ||
                    (model && model.file_name) ||
                    getPathFileName(model && model.model_path),
                ).trim();

                const baseModelID = model && model.base_model_id;
                const baseModelNum = Number(baseModelID);
                const isNonBaseModel = Number.isInteger(baseModelNum) && baseModelNum > 0;
                if (isBaseModelSelect) {
                    isBaseModelSelect.value = isNonBaseModel ? 'no' : 'yes';
                }
                baseModelIdInput.value = isNonBaseModel ? String(baseModelNum) : '';
                updateBaseModelIdVisibility();

                algorithmInput.value = String(model && model.algorithm_id || '').trim();
                frameworkInput.value = String(model && model.framework || '').trim();
                paperInput.value = String(model && model.paper || '').trim();
                paramsUrlInput.value = String(model && model.params_url || '').trim();
                descriptionInput.value = String(model && model.description || '').trim();

                const storageServers = parseStorageServers(
                    model && model.storage_servers,
                    model && model.storage_server,
                );
                storageServersInput.value = storageServers.join(', ');

                overlay.hidden = false;
                if (nameInput) nameInput.focus();

                return new Promise((resolve) => {
                    resolver = resolve;
                });
            },
        };

        return modelMetadataEditModalRefs;
    }

    function ensureStorageSyncModal() {
        if (storageSyncModalRefs) return storageSyncModalRefs;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay storage-sync-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="modal-card storage-sync-card">
                <div class="modal-header">
                    <h3 data-storage-sync-title>存储同步</h3>
                    <button class="btn-icon" type="button" data-storage-sync-cancel title="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <p class="modal-subtitle">模型同步仅支持本地与百度网盘之间双向同步。</p>
                <div class="form-divider"></div>
                <div class="storage-sync-current" data-storage-sync-current></div>
                <form data-storage-sync-form>
                    <div class="storage-sync-options">
                        <label class="storage-sync-option">
                            <input type="radio" name="sync_direction" value="to_baidu">
                            <span class="storage-sync-option-main">本地 -> 百度网盘</span>
                            <span class="storage-sync-option-sub">追加存储标记：baiduNetDisk</span>
                        </label>
                        <label class="storage-sync-option">
                            <input type="radio" name="sync_direction" value="to_backend">
                            <span class="storage-sync-option-main">百度网盘 -> 本地</span>
                            <span class="storage-sync-option-sub">按当前模型网盘路径下载到固定 weights 目录，并追加存储标记：backend</span>
                        </label>
                    </div>
                    <div class="form-actions modal-actions">
                        <button class="btn btn-secondary" type="button" data-storage-sync-cancel>取消</button>
                        <button class="btn btn-primary" type="submit">
                            <i class="fa-solid fa-cloud-arrow-up"></i>
                            确认同步
                        </button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        const titleEl = overlay.querySelector('[data-storage-sync-title]');
        const currentEl = overlay.querySelector('[data-storage-sync-current]');
        const formEl = overlay.querySelector('[data-storage-sync-form]');
        const cancelBtns = overlay.querySelectorAll('[data-storage-sync-cancel]');
        const radioInputs = overlay.querySelectorAll('input[name="sync_direction"]');
        let resolver = null;
        let currentDefaultRemotePath = '';

        const needsBaiduDownload = (direction) => direction === 'to_backend';

        const getSelectedDirection = () => {
            const checked = overlay.querySelector('input[name="sync_direction"]:checked');
            return checked ? String(checked.value || '').trim() : '';
        };

        const closeModal = (value = null) => {
            overlay.hidden = true;
            if (resolver) {
                const cb = resolver;
                resolver = null;
                cb(value);
            }
        };

        if (formEl) {
            formEl.addEventListener('submit', (e) => {
                e.preventDefault();
                const direction = getSelectedDirection();
                if (!direction) return;

                const requiresDownload = needsBaiduDownload(direction);
                const remotePath = String(currentDefaultRemotePath || '').trim();
                if (requiresDownload && !remotePath) {
                    window.alert('当前模型缺少网盘路径，无法同步到本地。');
                    return;
                }

                const result = {
                    direction,
                    download: requiresDownload ? {
                        remotePath,
                        category: 'weights',
                    } : null,
                };
                closeModal(result);
            });
        }

        cancelBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                closeModal(null);
            });
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(null);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.hidden) {
                closeModal(null);
            }
        });

        storageSyncModalRefs = {
            overlay,
            titleEl,
            currentEl,
            radioInputs,
            open({
                title,
                currentStorageServers = [],
                defaultDirection = '',
                defaultRemotePath = '',
            } = {}) {
                const safeTitle = String(title || '存储同步').trim() || '存储同步';
                titleEl.textContent = safeTitle;

                const normalizedServers = uniqueStorageServers(currentStorageServers);
                const serverText = normalizedServers.length
                    ? normalizedServers.map(formatStorageServerLabel).join(' / ')
                    : '--';
                currentEl.textContent = `当前存储标记：${serverText}`;

                const candidate = String(defaultDirection || '').trim();
                const fallback = normalizedServers.includes(BAIDU_STORAGE_SERVER_CANONICAL) ? 'to_backend' : 'to_baidu';
                const selectedDirection = candidate || fallback;
                radioInputs.forEach((radio) => {
                    radio.checked = radio.value === selectedDirection;
                });
                currentDefaultRemotePath = String(defaultRemotePath || '').trim();

                overlay.hidden = false;
                return new Promise((resolve) => {
                    resolver = resolve;
                });
            },
        };

        return storageSyncModalRefs;
    }

    // Function to load page content
    async function loadPage(pageName) {
        const safePageName = normalizeDashboardPageName(pageName);
        if (!safePageName) return;

        try {
            const response = await fetch(`pages/${safePageName}.html`);
            if (!response.ok) throw new Error('Page not found');
            const html = await response.text();

            mainContent.style.opacity = '0';

            setTimeout(() => {
                mainContent.innerHTML = `<section class="page-section active fade-in">${html}</section>`;
                mainContent.style.opacity = '1';
                persistCurrentPage(safePageName);
                updateActiveNavigation(safePageName);

                if (safePageName === 'model-management') {
                    initModelManagementPage();
                    return;
                }

                if (safePageName === 'dataset-management') {
                    initDatasetManagementPage();
                    return;
                }

                if (safePageName === 'model-validation') {
                    initTrainingLogPage();
                    return;
                }

                if (safePageName === 'baidu-netdisk-binding') {
                    initBaiduNetdiskBindingPage();
                    return;
                }

                if (safePageName === 'video-slicing') {
                    initVideoSlicingPage();
                    return;
                }

                if (safePageName === 'srt-generation') {
                    initSRTGenerationPage();
                    return;
                }

                if (safePageName === 'model-inference') {
                    initModelInferencePage();
                    return;
                }

                initTableFeatures();
            }, 200);
        } catch (error) {
            console.error('Error loading page:', error);
            mainContent.innerHTML = `<div class="alert error">Failed to load content: ${escapeHtml(error.message)}</div>`;
        }
    }

    function initModelManagementPage() {
        const table = document.querySelector('[data-model-table]');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const searchInput = document.querySelector('[data-model-search-input]');
        const searchBtn = document.querySelector('[data-model-search-btn]');
        const filterTaskTypeSelect = document.querySelector('[data-model-filter-task-type]');
        const filterResetBtn = document.querySelector('[data-model-filter-reset]');
        const importBtn = document.querySelector('[data-model-import-open]');
        const refreshBtn = document.querySelector('[data-model-refresh-btn]');
        const pageSizeSelect = document.querySelector('[data-model-page-size]');
        const totalItemsSpan = document.querySelector('[data-model-total-items]');
        const paginationControls = document.querySelector('[data-model-pagination]');
        const messageSlot = document.querySelector('[data-model-message]');
        const sizeSortHeader = document.querySelector('[data-model-sort="size"]');
        const apiBaseLabel = document.querySelector('[data-model-api-base]');

        const importModal = document.querySelector('[data-model-import-modal]');
        const importForm = document.querySelector('[data-model-import-form]');
        const importCloseBtns = document.querySelectorAll('[data-model-import-close]');
        const importFeedback = document.querySelector('[data-model-import-feedback]');
        const modelFileDropzone = document.querySelector('[data-model-file-dropzone]');
        const modelFileInput = document.querySelector('[data-model-file-input]');
        const modelFileHint = document.querySelector('[data-model-file-hint]');
        const modelNameInput = document.querySelector('#model-name');
        const modelVersionInput = document.querySelector('#model-version');
        const modelSizeInput = document.querySelector('#model-size-mb');
        const modelImplTypeInput = document.querySelector('#model-impl-type');
        const modelStorageServerSelect = document.querySelector('#model-storage-server');

        if (apiBaseLabel) {
            apiBaseLabel.textContent = apiBaseUrl;
        }

        const state = {
            page: 1,
            pageSize: Number(pageSizeSelect && pageSizeSelect.value) || 10,
            keyword: '',
            taskType: '',
            sizeSort: '',
            total: 0,
            rows: [],
            loading: false,
        };

        let searchTimer = null;
        let selectedModelFile = null;
        let versionSuggestTimer = null;
        let versionSuggestToken = 0;
        const modelDefaultFileHint = '';

        const setLoadingState = (loading) => {
            state.loading = loading;
            [
                searchBtn,
                importBtn,
                refreshBtn,
                pageSizeSelect,
                filterTaskTypeSelect,
                filterResetBtn,
            ].forEach((el) => {
                if (el) el.disabled = loading;
            });
        };

        const renderPlaceholderRow = (message) => {
            tbody.innerHTML = `<tr><td colspan="7" class="table-state">${escapeHtml(message)}</td></tr>`;
        };

        const fetchNextModelVersionByName = async (modelName) => {
            const safeName = String(modelName || '').trim();
            if (!safeName) return 'v1.0';

            const pageSize = 100;
            const allModels = [];
            let page = 1;
            let total = 0;

            while (page <= 20) {
                const data = await apiRequest('/models', {
                    query: {
                        name: safeName,
                        page,
                        page_size: pageSize,
                    },
                });
                const list = Array.isArray(data && data.list) ? data.list : [];
                if (!list.length) break;
                allModels.push(...list);
                total = Number(data && data.total);
                if (!Number.isFinite(total) || allModels.length >= total) break;
                page += 1;
            }

            return getNextVersionTextFromModels(allModels);
        };

        const suggestVersionForModelName = async () => {
            if (!modelNameInput || !modelVersionInput) return;
            const safeName = String(modelNameInput.value || '').trim();
            if (!safeName) return;

            const currentToken = ++versionSuggestToken;
            try {
                const nextVersion = await fetchNextModelVersionByName(safeName);
                if (currentToken !== versionSuggestToken) return;
                modelVersionInput.value = nextVersion;
            } catch (error) {
                if (currentToken !== versionSuggestToken) return;
                console.warn('Failed to suggest model version:', error);
            }
        };

        const scheduleVersionSuggestion = () => {
            if (versionSuggestTimer) {
                clearTimeout(versionSuggestTimer);
            }
            versionSuggestTimer = setTimeout(() => {
                suggestVersionForModelName();
            }, 300);
        };

        const getVersionBadgeClass = (version) => {
            const normalized = String(version || '').toLowerCase();
            if (normalized.includes('latest')) return 'success';
            if (normalized.includes('basic')) return 'secondary';
            return 'secondary';
        };

        const normalizeLabelSource = (value) => {
            if (Array.isArray(value)) return value;
            if (typeof value !== 'string') return [];
            const trimmed = value.trim();
            if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                return [];
            }
        };

        const getModelNameLabels = (model) => {
            const sources = [
                model && model.labels,
                model && model.tags,
                model && model.label_list,
                model && model.tag_list,
                model && model.storage_servers,
                model && model.storage_server,
            ];
            const result = [];
            sources.forEach((source) => {
                normalizeLabelSource(source).forEach((item) => {
                    let text = '';
                    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
                        text = String(item).trim();
                    } else if (item && typeof item === 'object') {
                        text = String(item.label || item.name || item.value || item.code || '').trim();
                    }
                    if (!text) return;
                    result.push(text);
                });
            });
            return Array.from(new Set(result));
        };

        const getLabelColorIndex = (label) => {
            const text = String(label || '');
            let hash = 0;
            for (let i = 0; i < text.length; i += 1) {
                hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
            }
            return hash % 6;
        };

        const getModelResolvedPath = (model) => String(
            model && (model.model_path || model.saved_path || model.resolved_path || ''),
        ).trim();

        const getModelWeightFileName = (model) => String(
            (model && model.weight_name) ||
            (model && model.file_name) ||
            getPathFileName(getModelResolvedPath(model)),
        ).trim();

        const getModelAlgorithmLabel = (model) => String(
            (model && model.algorithm_id) ||
            (model && model.impl_type) ||
            (model && model.framework) ||
            '',
        ).trim() || 'Unknown';

        const getModelWeightSizeMB = (model) => (
            model && (model.weight_size_mb ?? model.size_mb)
        );

        const getModelCreatedTime = (model) => (
            model && (model.create_time || model.created_at)
        );

        const getStatusMeta = (model) => {
            const hasCoreFields = Boolean(
                model &&
                model.name &&
                getModelWeightFileName(model) &&
                getModelAlgorithmLabel(model) &&
                model.task_type,
            );
            if (hasCoreFields) {
                return { cls: 'success', text: '可用' };
            }
            return { cls: 'error', text: '不支持' };
        };

        const renderRows = () => {
            if (!Array.isArray(state.rows) || state.rows.length === 0) {
                renderPlaceholderRow('暂无模型数据');
                return;
            }

            const html = state.rows.map((model) => {
                const modelName = escapeHtml(model.name || '--');
                const version = model.version ? escapeHtml(model.version) : 'No Version';
                const versionBadgeClass = getVersionBadgeClass(model.version);
                const implType = escapeHtml(getModelAlgorithmLabel(model));
                const taskType = escapeHtml(formatTaskType(model.task_type));
                const sizeText = escapeHtml(formatSizeMB(getModelWeightSizeMB(model)));
                const createdAt = escapeHtml(formatDateTime(getModelCreatedTime(model)));
                const status = getStatusMeta(model);
                const rowId = Number(model.id) || '';
                const nameLabels = getModelNameLabels(model);
                const nameLabelsHtml = nameLabels.length
                    ? `<div class="model-name-labels">${nameLabels.map((label) => (
                        `<span class="model-name-chip model-name-chip-${getLabelColorIndex(label)}">${escapeHtml(label)}</span>`
                    )).join('')}</div>`
                    : '';

                return `
                    <tr data-model-row-id="${rowId}">
                        <td>
                            <div class="name-cell">
                                <div class="name-main">
                                    <span class="model-name-text">${modelName}</span>
                                    <span class="badge ${versionBadgeClass} sm">${version}</span>
                                </div>
                                ${nameLabelsHtml}
                            </div>
                        </td>
                        <td>
                            <div class="tech-stack">
                                <span class="tag">${implType}</span>
                            </div>
                        </td>
                        <td>${taskType}</td>
                        <td>${sizeText}</td>
                        <td>${createdAt}</td>
                        <td><span class="badge ${status.cls}">${status.text}</span></td>
                        <td>
                            <div class="action-wrapper">
                                <button class="btn-icon action-toggle" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                                <div class="action-menu">
                                    <button class="btn-icon" title="属性" data-model-action="properties" data-model-id="${rowId}"><i class="fa-solid fa-circle-info"></i></button>
                                    <button class="btn-icon download" title="下载模型文件" data-model-action="download-file" data-model-id="${rowId}"><i class="fa-solid fa-download"></i></button>
                                    <button class="btn-icon cloud" title="同步存储服务" data-model-action="cloud-sync" data-model-id="${rowId}"><i class="fa-solid fa-cloud-arrow-up"></i></button>
                                    <button class="btn-icon delete" title="删除" data-model-action="delete" data-model-id="${rowId}"><i class="fa-solid fa-trash"></i></button>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = html;
        };

        const renderPaginationControls = () => {
            if (!paginationControls) return;

            const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
            if (state.page > totalPages) {
                state.page = totalPages;
            }

            paginationControls.innerHTML = '';

            const prevBtn = document.createElement('button');
            prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            prevBtn.disabled = state.page <= 1 || state.loading;
            prevBtn.addEventListener('click', () => {
                if (state.page <= 1) return;
                state.page -= 1;
                fetchModels();
            });
            paginationControls.appendChild(prevBtn);

            let startPage = Math.max(1, state.page - 2);
            let endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) {
                startPage = Math.max(1, endPage - 4);
            }

            for (let i = startPage; i <= endPage; i += 1) {
                const btn = document.createElement('button');
                btn.textContent = String(i);
                if (i === state.page) btn.classList.add('active');
                btn.disabled = state.loading;
                btn.addEventListener('click', () => {
                    if (state.page === i) return;
                    state.page = i;
                    fetchModels();
                });
                paginationControls.appendChild(btn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.disabled = state.page >= totalPages || state.loading;
            nextBtn.addEventListener('click', () => {
                if (state.page >= totalPages) return;
                state.page += 1;
                fetchModels();
            });
            paginationControls.appendChild(nextBtn);
        };

        const updateSortIndicator = () => {
            if (!sizeSortHeader) return;
            sizeSortHeader.classList.remove('asc', 'desc');
            if (state.sizeSort === 'asc') sizeSortHeader.classList.add('asc');
            if (state.sizeSort === 'desc') sizeSortHeader.classList.add('desc');
        };

        async function fetchModels() {
            setLoadingState(true);
            renderPaginationControls();
            renderPlaceholderRow('模型列表加载中...');
            clearAlert(messageSlot);

            try {
                const query = {
                    page: state.page,
                    page_size: state.pageSize,
                    keyword: state.keyword,
                };
                if (state.taskType) {
                    query.task_type = state.taskType;
                }
                if (state.sizeSort) {
                    query.size_sort = state.sizeSort;
                }

                const data = await apiRequest('/models', { query });
                const list = Array.isArray(data && data.list) ? data.list : [];
                const total = Number(data && data.total);

                state.rows = list;
                state.total = Number.isFinite(total) ? total : list.length;

                renderRows();
                renderPaginationControls();

                if (totalItemsSpan) {
                    totalItemsSpan.textContent = String(state.total);
                }
            } catch (error) {
                state.rows = [];
                state.total = 0;
                renderPlaceholderRow('模型数据加载失败');
                renderPaginationControls();
                if (totalItemsSpan) {
                    totalItemsSpan.textContent = '0';
                }
                showAlert(messageSlot, `加载模型失败: ${error.message}`, 'error');
            } finally {
                setLoadingState(false);
                renderPaginationControls();
            }
        }

        const applySearch = () => {
            state.keyword = (searchInput && searchInput.value || '').trim();
            state.taskType = String(filterTaskTypeSelect && filterTaskTypeSelect.value || '').trim();
            state.page = 1;
            fetchModels();
        };

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    applySearch();
                }, 1500);
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                clearTimeout(searchTimer);
                applySearch();
            });
        }
        if (searchBtn) {
            searchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                clearTimeout(searchTimer);
                applySearch();
            });
        }

        if (filterTaskTypeSelect) {
            filterTaskTypeSelect.addEventListener('change', () => {
                clearTimeout(searchTimer);
                applySearch();
            });
        }

        if (filterResetBtn) {
            filterResetBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                if (filterTaskTypeSelect) filterTaskTypeSelect.value = '';
                clearTimeout(searchTimer);
                applySearch();
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                fetchModels();
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                const next = Number(e.target.value);
                state.pageSize = Number.isFinite(next) && next > 0 ? next : 10;
                state.page = 1;
                fetchModels();
            });
        }

        if (sizeSortHeader) {
            sizeSortHeader.addEventListener('click', () => {
                if (state.sizeSort === '') {
                    state.sizeSort = 'asc';
                } else if (state.sizeSort === 'asc') {
                    state.sizeSort = 'desc';
                } else {
                    state.sizeSort = '';
                }
                state.page = 1;
                updateSortIndicator();
                fetchModels();
            });
        }

        if (tbody) {
            tbody.addEventListener('click', async (e) => {
                const actionBtn = e.target.closest('[data-model-action]');
                if (!actionBtn) return;

                const action = actionBtn.dataset.modelAction;
                const modelId = Number(actionBtn.dataset.modelId);
                const currentModel = state.rows.find((item) => Number(item.id) === modelId);
                const wrapper = actionBtn.closest('.action-wrapper');
                if (wrapper) {
                    wrapper.classList.remove('expanded');
                }

                if (!currentModel) {
                    showAlert(messageSlot, '未找到对应模型，请刷新后重试。', 'error');
                    return;
                }

                if (action === 'properties') {
                    const showModelPropertyModal = (modelDetail) => {
                        const detail = modelDetail && typeof modelDetail === 'object' ? modelDetail : currentModel;
                        const detailId = Number(detail && detail.id);
                        const effectiveId = Number.isInteger(detailId) && detailId > 0 ? detailId : modelId;
                        const modelName = String(detail && detail.name || '').trim() || `#${effectiveId}`;
                        const propertyTitle = `模型属性 - ${modelName}`;
                        openPropertyModal(propertyTitle, detail, {
                            editAction: {
                                label: '编辑模型元信息',
                                handler: async (detailPayload) => {
                                    const sourceModel = detailPayload && typeof detailPayload === 'object'
                                        ? detailPayload
                                        : detail;
                                    const editModal = ensureModelMetadataEditModal();
                                    const patchPayload = await editModal.open({
                                        model: sourceModel,
                                        title: `编辑模型元信息 - ${modelName}`,
                                    });
                                    if (!patchPayload) return;

                                    const submitIdRaw = Number(sourceModel && sourceModel.id);
                                    const submitId = Number.isInteger(submitIdRaw) && submitIdRaw > 0
                                        ? submitIdRaw
                                        : effectiveId;
                                    if (!Number.isInteger(submitId) || submitId <= 0) {
                                        throw new Error('未找到有效模型ID，无法更新。');
                                    }

                                    const updatedModel = await apiRequest(`/models/${submitId}`, {
                                        method: 'PATCH',
                                        body: patchPayload,
                                    });

                                    const updatedName = String(updatedModel && updatedModel.name || modelName).trim() || modelName;
                                    showAlert(messageSlot, `模型“${updatedName}”元信息更新成功。`, 'info');
                                    showModelPropertyModal(updatedModel || sourceModel);
                                    await fetchModels();
                                },
                            },
                        });
                    };

                    showModelPropertyModal(currentModel);
                    return;
                }

                if (action === 'download-file' || action === 'copy-path') {
                    const modelName = String(currentModel.name || '').trim() || `#${modelId}`;
                    const fallbackFileName = getModelWeightFileName(currentModel) || `model-${modelId}`;
                    actionBtn.disabled = true;
                    try {
                        await downloadModelFileById(modelId, fallbackFileName);
                        showAlert(messageSlot, `模型“${modelName}”下载已开始。`, 'info');
                    } catch (error) {
                        showAlert(messageSlot, `模型“${modelName}”下载失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                    return;
                }

                if (action === 'cloud-sync') {
                    const modelName = String(currentModel.name || '').trim() || `#${modelId}`;
                    const currentServers = uniqueStorageServers([
                        ...(Array.isArray(currentModel.storage_servers) ? currentModel.storage_servers : []),
                        currentModel.storage_server,
                    ]);
                    const modelPath = getModelResolvedPath(currentModel);
                    const syncModal = ensureStorageSyncModal();
                    const syncPlan = await syncModal.open({
                        title: `模型同步 - ${modelName}`,
                        currentStorageServers: currentServers,
                        defaultRemotePath: modelPath,
                    });
                    if (!syncPlan) return;

                    const direction = String(syncPlan.direction || '').trim();
                    const downloadPlan = syncPlan.download || null;

                    const directionToServers = {
                        to_baidu: [BAIDU_STORAGE_SERVER_CANONICAL],
                        to_backend: ['backend'],
                    };
                    const plannedServers = uniqueStorageServers(directionToServers[direction] || []);
                    const serversToAdd = plannedServers.filter((value) => !currentServers.includes(value));

                    const needsDownload = direction === 'to_backend';

                    actionBtn.disabled = true;
                    try {
                        let downloadResult = null;
                        if (needsDownload) {
                            if (!downloadPlan || !String(downloadPlan.remotePath || '').trim()) {
                                throw new Error('请选择百度网盘文件路径后再同步到本地。');
                            }
                            downloadResult = await downloadFromBaiduToLocal(downloadPlan);
                        }

                        if (serversToAdd.length) {
                            await syncStorageServersForEntity('models', modelId, serversToAdd);
                        }

                        const messageParts = [];
                        if (downloadResult) {
                            const localPath = String(downloadResult.local_path || '').trim();
                            if (localPath) {
                                messageParts.push(`已下载到本地：${localPath}`);
                            } else {
                                messageParts.push('已完成百度网盘下载到本地');
                            }
                        }
                        if (serversToAdd.length) {
                            const syncedLabel = serversToAdd.map(formatStorageServerLabel).join('、');
                            messageParts.push(`已更新存储标记：${syncedLabel}`);
                        }
                        if (!messageParts.length) {
                            messageParts.push('无需更新存储标记');
                        }
                        showAlert(messageSlot, `模型“${modelName}”同步成功：${messageParts.join('；')}。`, 'info');

                        if (serversToAdd.length) {
                            await fetchModels();
                        }
                    } catch (error) {
                        showAlert(messageSlot, `模型“${modelName}”同步失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                    return;
                }

                if (action === 'delete') {
                    const modelName = String(currentModel.name || '').trim() || `#${modelId}`;
                    const fileName = getModelWeightFileName(currentModel);
                    if (!fileName) {
                        showAlert(messageSlot, `模型“${modelName}”缺少 weight_name，无法调用删除接口。`, 'error');
                        return;
                    }
                    const confirmed = window.confirm(`确认删除模型“${modelName}”及其文件吗？`);
                    if (!confirmed) return;

                    actionBtn.disabled = true;
                    try {
                        const deleteResult = await apiRequest('/models/by-filename', {
                            method: 'DELETE',
                            query: { file_name: fileName },
                        });
                        const deletedRecords = Number(deleteResult && deleteResult.deleted_records);
                        const updatedRecords = Number(deleteResult && deleteResult.updated_records);
                        const summary = Number.isFinite(deletedRecords) || Number.isFinite(updatedRecords)
                            ? `deleted_records=${Number.isFinite(deletedRecords) ? deletedRecords : 0}, updated_records=${Number.isFinite(updatedRecords) ? updatedRecords : 0}`
                            : 'delete success';
                        showAlert(messageSlot, `模型“${modelName}”删除成功：${summary}`, 'info');
                        await fetchModels();
                    } catch (error) {
                        showAlert(messageSlot, `模型“${modelName}”删除失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                }
            });
        }

        const setImportFeedback = (message, tone = 'info') => {
            if (!importFeedback) return;
            if (!message) {
                importFeedback.hidden = true;
                importFeedback.className = 'model-import-feedback alert info';
                importFeedback.textContent = '';
                return;
            }
            importFeedback.hidden = false;
            importFeedback.className = `model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            importFeedback.textContent = message;
        };

        const openImportModal = async () => {
            if (!importModal) return;
            importModal.hidden = false;
            setImportFeedback('');
            try {
                await populateStorageServerSelects(importModal);
            } catch (error) {
                setImportFeedback(String(error && error.message || '存储服务加载失败'), 'error');
            }
            const firstInput = importModal.querySelector('input[name="name"]');
            if (firstInput) firstInput.focus();
        };

        const closeImportModal = () => {
            if (!importModal) return;
            importModal.hidden = true;
            setImportFeedback('');
            selectedModelFile = null;
            versionSuggestToken += 1;
            if (versionSuggestTimer) {
                clearTimeout(versionSuggestTimer);
                versionSuggestTimer = null;
            }
            if (importForm) importForm.reset();
            if (modelFileHint) {
                modelFileHint.textContent = modelDefaultFileHint;
            }
        };

        if (importBtn) {
            importBtn.addEventListener('click', openImportModal);
        }

        importCloseBtns.forEach((btn) => {
            btn.addEventListener('click', closeImportModal);
        });

        if (importModal) {
            importModal.addEventListener('click', (e) => {
                if (e.target === importModal) {
                    closeImportModal();
                }
            });
        }

        setupDropzone({
            zone: modelFileDropzone,
            fileInput: modelFileInput,
            hintEl: modelFileHint,
            defaultHint: modelDefaultFileHint,
            onFile: (file) => {
                selectedModelFile = file;
                if (modelNameInput && !modelNameInput.value.trim()) {
                    modelNameInput.value = trimExtension(file.name);
                }
                if (modelSizeInput && !modelSizeInput.value) {
                    modelSizeInput.value = bytesToMB(file.size);
                }
                if (modelImplTypeInput && !modelImplTypeInput.value.trim()) {
                    const ext = (file.name.split('.').pop() || '').toLowerCase();
                    if (ext === 'onnx') modelImplTypeInput.value = 'onnxruntime';
                    if (ext === 'pt' || ext === 'pth' || ext === 'ckpt') modelImplTypeInput.value = 'pytorch';
                    if (ext === 'engine' || ext === 'trt') modelImplTypeInput.value = 'tensorrt';
                    if (ext === 'bin') modelImplTypeInput.value = 'binary_model';
                }
                if (modelNameInput && modelNameInput.value.trim()) {
                    scheduleVersionSuggestion();
                }
            },
        });

        if (modelNameInput) {
            modelNameInput.addEventListener('input', () => {
                scheduleVersionSuggestion();
            });
        }

        if (importForm) {
            importForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!importForm.checkValidity()) {
                    importForm.reportValidity();
                    return;
                }

                const submitBtn = importForm.querySelector('[data-model-import-submit]');
                const originalSubmitText = submitBtn ? submitBtn.innerHTML : '';

                const formData = new FormData(importForm);
                const sizeMb = Number(formData.get('size_mb'));
                const versionRaw = String(formData.get('version') || '').trim();
                const versionNum = parseVersionAsNumber(versionRaw);

                if (!Number.isFinite(sizeMb) || sizeMb <= 0) {
                    setImportFeedback('`size_mb` 必须是大于 0 的数字。', 'error');
                    return;
                }

                if (!(selectedModelFile instanceof File)) {
                    setImportFeedback('请选择要上传的模型文件，后端现在要求通过 file 字段提交文件内容。', 'error');
                    return;
                }

                let resolvedStorageServer = String(formData.get('storage_server') || '').trim();
                let resolvedSizeMb = sizeMb;
                const requestBaiduUpload = shouldUploadToBaidu(resolvedStorageServer);
                let baiduUploaded = false;
                const implType = String(formData.get('impl_type') || '').trim();
                const storageServers = requestBaiduUpload
                    ? ['backend']
                    : uniqueStorageServers([resolvedStorageServer]);
                const resolvedFramework = resolveModelFramework(
                    implType,
                    selectedModelFile && selectedModelFile.name,
                );
                const modelName = String(formData.get('name') || '').trim();
                const uploadFileName = buildModelUploadFileName({
                    name: modelName,
                    version: versionRaw,
                    originalFileName: selectedModelFile && selectedModelFile.name,
                });

                const payload = {
                    name: modelName,
                    task_type: String(formData.get('task_type') || '').trim(),
                    algorithm_id: implType,
                    weight_size_mb: resolvedSizeMb,
                    weight_name: uploadFileName,
                    storage_server: JSON.stringify(storageServers),
                    storage_servers: storageServers,
                    base_model_id: 0,
                };

                if (resolvedFramework) {
                    payload.framework = resolvedFramework;
                }

                if (Number.isFinite(versionNum)) {
                    payload.version = versionNum;
                }

                const description = String(formData.get('description') || '').trim();
                if (description) {
                    payload.description = description;
                }
                if (selectedModelFile && !payload.description) {
                    payload.description = `Selected local file: ${uploadFileName}`;
                }

                try {
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 导入中';
                    }
                    setImportFeedback('正在上传模型文件并创建模型记录...', 'info');
                    const createdModel = await createModelWithFileViaApi({
                        file: selectedModelFile,
                        model: payload,
                        uploadFileName,
                        uploadToBaidu: requestBaiduUpload,
                    });

                    const createdStorageServers = parseStorageServers(
                        createdModel && createdModel.storage_servers,
                        createdModel && createdModel.storage_server,
                    );
                    if (createdStorageServers.length) {
                        resolvedStorageServer = createdStorageServers[0];
                        if (modelStorageServerSelect) {
                            modelStorageServerSelect.value = resolvedStorageServer;
                        }
                    }

                    baiduUploaded = createdStorageServers.some(
                        (server) => normalizeStorageServerValue(server) === BAIDU_STORAGE_SERVER_CANONICAL,
                    );

                    const returnedSizeMb = Number(
                        createdModel && (createdModel.weight_size_mb ?? createdModel.size_mb),
                    );
                    if (Number.isFinite(returnedSizeMb) && returnedSizeMb > 0) {
                        resolvedSizeMb = returnedSizeMb;
                        if (modelSizeInput) {
                            modelSizeInput.value = String(resolvedSizeMb);
                        }
                    }

                    let syncWarning = '';
                    const createdModelId = getCreatedEntityId(createdModel);
                    const storageServersForSync = getStorageServersForSync(resolvedStorageServer, {
                        requestBaiduUpload,
                        baiduUploaded,
                    });

                    if (createdModelId) {
                        try {
                            await syncStorageServersForEntity('models', createdModelId, storageServersForSync);
                        } catch (syncError) {
                            syncWarning = `模型已创建，但存储服务同步失败：${syncError.message}`;
                        }
                    } else {
                        syncWarning = '模型已创建，但未获取到记录ID，无法同步存储服务。';
                    }

                    showAlert(messageSlot, syncWarning || '模型导入成功，列表已刷新。', syncWarning ? 'error' : 'info');
                    closeImportModal();
                    state.page = 1;
                    fetchModels();
                } catch (error) {
                    setImportFeedback(`导入失败: ${error.message}`, 'error');
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalSubmitText;
                    }
                }
            });
        }

        populateStorageServerSelects(importModal).catch((error) => {
            showAlert(messageSlot, String(error && error.message || '存储服务加载失败'), 'error');
        });
        updateSortIndicator();
        fetchModels();
    }

    // initModelInferencePage wires service connect, healthz probe, and predict actions.
    function initModelInferencePage() {
        const connectForm = document.querySelector('[data-inference-connect-form]');
        const predictForm = document.querySelector('[data-inference-predict-form]');
        if (!connectForm || !predictForm) return;

        const accessTypeInputs = connectForm.querySelectorAll('input[name="access_type"]');
        const dockerGroup = connectForm.querySelector('[data-inference-docker-group]');
        const checkBtn = document.querySelector('[data-inference-check-btn]');
        const startBtn = document.querySelector('[data-inference-start-btn]');
        const runBtn = document.querySelector('[data-inference-run-btn]');
        const connectStatus = document.querySelector('[data-inference-connect-status]');
        const predictStatus = document.querySelector('[data-inference-predict-status]');
        const configStatus = document.querySelector('[data-inference-config-status]');
        const apiBaseLabel = document.querySelector('[data-inference-api-base]');
        const fileDropzone = document.querySelector('[data-inference-file-dropzone]');
        const fileInput = document.querySelector('[data-inference-file-input]');
        const fileHint = document.querySelector('[data-inference-file-hint]');
        const configSearchInput = document.querySelector('[data-inference-config-search-input]');
        const configSearchBtn = document.querySelector('[data-inference-config-search-btn]');
        const configRefreshBtn = document.querySelector('[data-inference-config-refresh-btn]');
        const configSaveOpenBtn = document.querySelector('[data-inference-config-save-open]');
        const configTable = document.querySelector('[data-inference-config-table]');
        const configTbody = configTable ? configTable.querySelector('tbody') : null;
        const configTotalEl = document.querySelector('[data-inference-config-total]');
        const configActiveLabel = document.querySelector('[data-inference-config-active-label]');
        const configModal = document.querySelector('[data-inference-config-modal]');
        const configModalTitle = document.querySelector('[data-inference-config-modal-title]');
        const configModalForm = document.querySelector('[data-inference-config-modal-form]');
        const configModalNameInput = document.querySelector('#inference-config-name');
        const configModalDescriptionInput = document.querySelector('#inference-config-description');
        const configModalFeedback = document.querySelector('[data-inference-config-modal-feedback]');
        const configModalCloseBtns = document.querySelectorAll('[data-inference-config-modal-close]');

        const placeholder = document.querySelector('[data-inference-placeholder]');
        const output = document.querySelector('[data-inference-output]');
        const resultBadge = document.querySelector('[data-inference-result-badge]');
        const previewImage = document.querySelector('[data-inference-preview-image]');
        const previewCanvas = document.querySelector('[data-inference-preview-canvas]');
        const baseUrlEl = document.querySelector('[data-inference-result-base-url]');
        const healthzUrlEl = document.querySelector('[data-inference-result-healthz-url]');
        const predictUrlEl = document.querySelector('[data-inference-result-predict-url]');
        const resultCountEl = document.querySelector('[data-inference-result-count]');
        const resultTbody = document.querySelector('[data-inference-result-tbody]');
        const rawJsonEl = document.querySelector('[data-inference-raw-json]');

        let selectedFile = null;
        let previewObjectUrl = '';
        let configSearchTimer = null;
        let activeConfigId = 0;
        let activeConfigName = '';
        const configState = {
            keyword: '',
            rows: [],
            loading: false,
        };

        if (apiBaseLabel) {
            apiBaseLabel.textContent = apiBaseUrl;
        }

        const revokePreviewUrl = () => {
            if (!previewObjectUrl) return;
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = '';
        };

        const clearPreviewCanvas = () => {
            if (!previewCanvas) return;
            const ctx = previewCanvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, previewCanvas.width || 0, previewCanvas.height || 0);
        };

        // drawInferenceBoxes draws returned bbox_xyxy rectangles over the preview image.
        const drawInferenceBoxes = (rows) => {
            if (!previewImage || !previewCanvas) return;
            const imageRect = previewImage.getBoundingClientRect();
            const naturalWidth = Number(previewImage.naturalWidth || 0);
            const naturalHeight = Number(previewImage.naturalHeight || 0);
            const displayWidth = Math.round(imageRect.width);
            const displayHeight = Math.round(imageRect.height);
            if (!naturalWidth || !naturalHeight || !displayWidth || !displayHeight) {
                clearPreviewCanvas();
                return;
            }

            previewCanvas.width = displayWidth;
            previewCanvas.height = displayHeight;
            previewCanvas.style.width = `${displayWidth}px`;
            previewCanvas.style.height = `${displayHeight}px`;

            const ctx = previewCanvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, displayWidth, displayHeight);

            const scaleX = displayWidth / naturalWidth;
            const scaleY = displayHeight / naturalHeight;
            ctx.lineWidth = 2;
            ctx.font = '12px JetBrains Mono, monospace';
            ctx.textBaseline = 'top';

            (Array.isArray(rows) ? rows : []).forEach((item, index) => {
                const bbox = Array.isArray(item && item.bbox_xyxy) ? item.bbox_xyxy : [];
                if (bbox.length !== 4) return;
                const [x1, y1, x2, y2] = bbox.map((value) => Number(value));
                if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) return;

                const left = x1 * scaleX;
                const top = y1 * scaleY;
                const width = Math.max(0, (x2 - x1) * scaleX);
                const height = Math.max(0, (y2 - y1) * scaleY);
                const color = index % 2 === 0 ? '#ff8a3d' : '#1f8a70';
                const className = String((item && item.class_name) || `class_${item && item.class_id}`);
                const confidence = Number(item && item.confidence);
                const label = Number.isFinite(confidence)
                    ? `${className} ${(confidence * 100).toFixed(1)}%`
                    : className;

                ctx.strokeStyle = color;
                ctx.strokeRect(left, top, width, height);

                const textWidth = Math.ceil(ctx.measureText(label).width);
                const textX = left;
                const textY = Math.max(0, top - 20);
                ctx.fillStyle = color;
                ctx.fillRect(textX, textY, textWidth + 10, 18);
                ctx.fillStyle = '#ffffff';
                ctx.fillText(label, textX + 5, textY + 3);
            });
        };

        const getSelectedAccessType = () => {
            const checked = Array.from(accessTypeInputs).find((input) => input.checked);
            return String((checked && checked.value) || 'docker').trim();
        };

        const syncAccessMode = () => {
            const isDocker = getSelectedAccessType() === 'docker';
            if (dockerGroup) {
                dockerGroup.style.display = isDocker ? '' : 'none';
            }
            if (startBtn) {
                startBtn.innerHTML = isDocker
                    ? '<i class="fa-solid fa-play"></i> 启动并探活'
                    : '<i class="fa-solid fa-plug-circle-check"></i> 远程探活';
            }
        };

        const readConnectPayload = () => {
            const formData = new FormData(connectForm);
            return {
                access_type: String(formData.get('access_type') || '').trim(),
                base_url: String(formData.get('base_url') || '').trim(),
                healthz_path: String(formData.get('healthz_path') || '').trim(),
                predict_path: String(formData.get('predict_path') || '').trim(),
                docker_command: String(formData.get('docker_command') || '').trim(),
                startup_timeout_second: Number(formData.get('startup_timeout_second') || 30) || 30,
            };
        };

        const setBusy = (elements, busy) => {
            elements.forEach((element) => {
                if (element) element.disabled = busy;
            });
        };

        const setInlineStatus = (container, message, tone = 'info') => {
            if (!container) return;
            if (!message) {
                container.innerHTML = '';
                return;
            }
            container.innerHTML = `<div class="alert ${tone === 'error' ? 'error' : 'info'}">${escapeHtml(message)}</div>`;
        };

        // setConfigModalFeedback updates the save-config modal feedback banner.
        const setConfigModalFeedback = (message, tone = 'info') => {
            if (!configModalFeedback) return;
            if (!message) {
                configModalFeedback.hidden = true;
                configModalFeedback.className = 'model-import-feedback alert info';
                configModalFeedback.textContent = '';
                return;
            }
            configModalFeedback.hidden = false;
            configModalFeedback.className = `model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            configModalFeedback.textContent = message;
        };

        // setConfigActiveLabel renders the currently loaded config name.
        const setConfigActiveLabel = () => {
            if (!configActiveLabel) return;
            if (activeConfigId > 0 && activeConfigName) {
                configActiveLabel.textContent = `当前已加载配置：${activeConfigName}`;
                return;
            }
            configActiveLabel.textContent = '当前未加载保存配置';
        };

        // renderConfigPlaceholder renders a placeholder row in the config table.
        const renderConfigPlaceholder = (message) => {
            if (!configTbody) return;
            configTbody.innerHTML = `<tr><td colspan="6" class="table-state">${escapeHtml(message)}</td></tr>`;
        };

        // collectInferenceConfigPayload collects the current connect and predict form values.
        const collectInferenceConfigPayload = () => {
            const connectPayload = readConnectPayload();
            const predictData = new FormData(predictForm);
            return {
                access_type: connectPayload.access_type,
                base_url: connectPayload.base_url,
                healthz_path: connectPayload.healthz_path,
                predict_path: connectPayload.predict_path,
                docker_command: connectPayload.docker_command,
                startup_timeout_second: connectPayload.startup_timeout_second,
                conf: Number(predictData.get('conf') || 0.25) || 0.25,
                imgsz: Number(predictData.get('imgsz') || 640) || 640,
                classes: String(predictData.get('classes') || '').trim(),
            };
        };

        // applyInferenceConfig writes a saved config back into the current forms.
        const applyInferenceConfig = (config) => {
            if (!config || typeof config !== 'object') return;
            const setValue = (selector, value) => {
                const input = document.querySelector(selector);
                if (input) input.value = value == null ? '' : String(value);
            };

            const nextAccessType = String(config.access_type || 'docker').trim() || 'docker';
            accessTypeInputs.forEach((input) => {
                input.checked = input.value === nextAccessType;
            });
            syncAccessMode();

            setValue('#inference-base-url', config.base_url);
            setValue('#inference-docker-command', config.docker_command);
            setValue('#inference-healthz-path', config.healthz_path);
            setValue('#inference-predict-path', config.predict_path);
            setValue('#inference-startup-timeout', config.startup_timeout_second);
            setValue('#inference-conf', config.conf);
            setValue('#inference-imgsz', config.imgsz);
            setValue('#inference-classes', config.classes);

            activeConfigId = Number(config.id) || 0;
            activeConfigName = String(config.name || '').trim();
            setConfigActiveLabel();
            setInlineStatus(configStatus, `已加载配置：${activeConfigName || '未命名推理配置'}`, 'info');
        };

        // renderConfigRows renders the saved inference config table.
        const renderConfigRows = () => {
            if (!configTbody) return;
            if (!Array.isArray(configState.rows) || configState.rows.length === 0) {
                renderConfigPlaceholder('暂无保存的推理配置');
                if (configTotalEl) configTotalEl.textContent = '0';
                return;
            }

            configTbody.innerHTML = configState.rows.map((item) => {
                const id = Number(item && item.id) || 0;
                const isActive = id > 0 && id === activeConfigId;
                const detail = escapeHtml(encodeURIComponent(JSON.stringify(item || {})));
                const name = escapeHtml(item && item.name || '--');
                const accessType = escapeHtml(item && item.access_type || '--');
                const baseUrl = escapeHtml(item && item.base_url || '--');
                const paramsText = escapeHtml(`conf=${item && item.conf != null ? item.conf : '--'}｜imgsz=${item && item.imgsz != null ? item.imgsz : '--'}｜classes=${item && item.classes ? item.classes : '--'}`);
                const updatedAt = escapeHtml(formatDateTime(item && item.updated_at));
                return `
                    <tr${isActive ? ' class="is-active-config-row"' : ''}>
                        <td>
                            <div class="config-name-cell">
                                <strong>${name}</strong>
                                <span>${escapeHtml(item && item.description || '')}</span>
                            </div>
                        </td>
                        <td>${accessType}</td>
                        <td>${baseUrl}</td>
                        <td>${paramsText}</td>
                        <td>${updatedAt}</td>
                        <td>
                            <div class="table-inline-actions">
                                <button class="btn btn-secondary btn-sm" type="button" data-inference-config-action="load" data-inference-config-detail="${detail}">加载</button>
                                <button class="btn btn-secondary btn-sm" type="button" data-inference-config-action="delete" data-inference-config-id="${id}" data-inference-config-name="${name}">删除</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
            if (configTotalEl) configTotalEl.textContent = String(configState.rows.length);
        };

        // openConfigModal opens the save-config modal in create or update mode.
        const openConfigModal = () => {
            if (!configModal) return;
            configModal.hidden = false;
            setConfigModalFeedback('');
            if (configModalForm) configModalForm.reset();
            const activeConfig = configState.rows.find((item) => Number(item && item.id) === activeConfigId);
            if (activeConfig) {
                if (configModalNameInput) configModalNameInput.value = String(activeConfig.name || '').trim();
                if (configModalDescriptionInput) configModalDescriptionInput.value = String(activeConfig.description || '').trim();
            }
            if (configModalTitle) {
                configModalTitle.textContent = activeConfigId > 0 ? '更新推理配置' : '保存推理配置';
            }
            if (configModalNameInput) configModalNameInput.focus();
        };

        // closeConfigModal closes and resets the save-config modal.
        const closeConfigModal = () => {
            if (!configModal) return;
            configModal.hidden = true;
            if (configModalForm) configModalForm.reset();
            setConfigModalFeedback('');
        };

        // fetchInferenceConfigs loads saved configs from the backend.
        const fetchInferenceConfigs = async () => {
            configState.loading = true;
            renderConfigPlaceholder('推理配置加载中...');
            try {
                const data = await apiRequest('/inference/configs', {
                    query: {
                        page: 1,
                        page_size: 50,
                        keyword: configState.keyword,
                    },
                });
                configState.rows = Array.isArray(data && data.list) ? data.list : [];
                renderConfigRows();
            } catch (error) {
                configState.rows = [];
                renderConfigPlaceholder('推理配置加载失败');
                setInlineStatus(configStatus, `加载推理配置失败: ${error.message}`, 'error');
            } finally {
                configState.loading = false;
            }
        };

        const renderResultRows = (rows) => {
            if (!resultTbody) return;
            if (!Array.isArray(rows) || rows.length === 0) {
                resultTbody.innerHTML = '<tr><td colspan="4" class="table-state">未返回检测结果</td></tr>';
                return;
            }
            resultTbody.innerHTML = rows.map((item) => {
                const bbox = Array.isArray(item && item.bbox_xyxy)
                    ? item.bbox_xyxy.map((value) => Number(value).toFixed(2)).join(', ')
                    : '--';
                const confidence = Number(item && item.confidence);
                return `
                    <tr>
                        <td>${escapeHtml(item && item.class_id)}</td>
                        <td>${escapeHtml(item && item.class_name)}</td>
                        <td>${Number.isFinite(confidence) ? confidence.toFixed(6) : '--'}</td>
                        <td>${escapeHtml(bbox)}</td>
                    </tr>
                `;
            }).join('');
        };

        const fillResultSummary = (serviceInfo, rows) => {
            const currentPayload = readConnectPayload();
            if (baseUrlEl) baseUrlEl.textContent = (serviceInfo && serviceInfo.base_url) || '--';
            if (healthzUrlEl) {
                healthzUrlEl.textContent = `${((serviceInfo && serviceInfo.base_url) || currentPayload.base_url || '--')}${String(currentPayload.healthz_path || '/healthz')}`;
            }
            if (predictUrlEl) predictUrlEl.textContent = (serviceInfo && serviceInfo.predict_url) || '--';
            if (resultCountEl) resultCountEl.textContent = String(Array.isArray(rows) ? rows.length : 0);
        };

        const showResultState = (statusText, badgeClass = 'secondary') => {
            if (resultBadge) {
                resultBadge.textContent = statusText;
                resultBadge.className = `badge ${badgeClass}`;
            }
        };

        const runConnect = async () => {
            setInlineStatus(connectStatus, '正在校验推理服务...', 'info');
            setBusy([checkBtn, startBtn, runBtn], true);
            try {
                const data = await apiRequest('/inference/connect', {
                    method: 'POST',
                    body: readConnectPayload(),
                });
                showResultState('已连接', 'success');
                setInlineStatus(connectStatus, String((data && data.message) || '推理服务连接成功'), 'info');
                fillResultSummary(data, []);
                return data;
            } catch (error) {
                showResultState('连接失败', 'error');
                setInlineStatus(connectStatus, error.message || '推理服务连接失败', 'error');
                throw error;
            } finally {
                setBusy([checkBtn, startBtn, runBtn], false);
            }
        };

        accessTypeInputs.forEach((input) => input.addEventListener('change', syncAccessMode));
        syncAccessMode();

        setupDropzone({
            zone: fileDropzone,
            fileInput,
            hintEl: fileHint,
            defaultHint: '点击上传待推理图片，或拖拽到这里',
            onFile: (file) => {
                selectedFile = file;
                revokePreviewUrl();
                clearPreviewCanvas();
                previewObjectUrl = URL.createObjectURL(file);
                if (previewImage) {
                    previewImage.src = previewObjectUrl;
                }
            },
        });

        if (previewImage) {
            previewImage.addEventListener('load', () => {
                clearPreviewCanvas();
            });
        }

        if (checkBtn) {
            checkBtn.addEventListener('click', async () => {
                await runConnect();
            });
        }

        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                await runConnect();
            });
        }

        if (configSearchInput) {
            configSearchInput.addEventListener('input', () => {
                clearTimeout(configSearchTimer);
                configSearchTimer = setTimeout(() => {
                    configState.keyword = String(configSearchInput.value || '').trim();
                    fetchInferenceConfigs();
                }, 300);
            });
        }

        if (configSearchBtn) {
            configSearchBtn.addEventListener('click', () => {
                configState.keyword = String(configSearchInput && configSearchInput.value || '').trim();
                fetchInferenceConfigs();
            });
        }

        if (configRefreshBtn) {
            configRefreshBtn.addEventListener('click', () => {
                fetchInferenceConfigs();
            });
        }

        if (configSaveOpenBtn) {
            configSaveOpenBtn.addEventListener('click', openConfigModal);
        }

        configModalCloseBtns.forEach((btn) => {
            btn.addEventListener('click', closeConfigModal);
        });

        if (configModal) {
            configModal.addEventListener('click', (event) => {
                if (event.target === configModal) {
                    closeConfigModal();
                }
            });
        }

        if (configModalForm) {
            configModalForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!configModalForm.checkValidity()) {
                    configModalForm.reportValidity();
                    return;
                }

                const submitBtn = configModalForm.querySelector('[data-inference-config-modal-submit]');
                const originalSubmitText = submitBtn ? submitBtn.innerHTML : '';
                const payload = collectInferenceConfigPayload();
                payload.name = String(configModalNameInput && configModalNameInput.value || '').trim();
                payload.description = String(configModalDescriptionInput && configModalDescriptionInput.value || '').trim();

                try {
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中';
                    }
                    setConfigModalFeedback('正在保存推理配置...', 'info');
                    const result = await apiRequest(
                        activeConfigId > 0 ? `/inference/configs/${activeConfigId}` : '/inference/configs',
                        {
                            method: activeConfigId > 0 ? 'PATCH' : 'POST',
                            body: payload,
                        },
                    );
                    activeConfigId = Number(result && result.id) || 0;
                    activeConfigName = String(result && result.name || payload.name || '').trim();
                    setConfigActiveLabel();
                    setInlineStatus(configStatus, `推理配置已保存：${activeConfigName || '未命名推理配置'}`, 'info');
                    closeConfigModal();
                    await fetchInferenceConfigs();
                } catch (error) {
                    setConfigModalFeedback(`保存失败: ${error.message}`, 'error');
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalSubmitText;
                    }
                }
            });
        }

        predictForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!(selectedFile instanceof File)) {
                setInlineStatus(predictStatus, '请先上传待推理图片', 'error');
                return;
            }

            setBusy([checkBtn, startBtn, runBtn], true);
            setInlineStatus(predictStatus, '正在执行真实推理，请稍候...', 'info');
            showResultState('推理中', 'processing');

            const connectPayload = readConnectPayload();
            const formData = new FormData(predictForm);
            formData.append('file', selectedFile, selectedFile.name);
            Object.entries(connectPayload).forEach(([key, value]) => {
                formData.append(key, value == null ? '' : String(value));
            });

            try {
                const data = await apiRequest('/inference/predict', {
                    method: 'POST',
                    formData,
                });
                const rows = Array.isArray(data && data.result) ? data.result : [];
                if (placeholder) placeholder.hidden = true;
                if (output) output.hidden = false;
                renderResultRows(rows);
                fillResultSummary(data && data.service, rows);
                drawInferenceBoxes(rows);
                if (rawJsonEl) {
                    rawJsonEl.textContent = JSON.stringify(rows, null, 2);
                }
                showResultState('推理完成', rows.length ? 'success' : 'secondary');
                setInlineStatus(predictStatus, String((data && data.message) || '推理完成'), 'info');
            } catch (error) {
                if (placeholder) placeholder.hidden = false;
                if (output) output.hidden = true;
                clearPreviewCanvas();
                showResultState('推理失败', 'error');
                setInlineStatus(predictStatus, error.message || '推理失败', 'error');
            } finally {
                setBusy([checkBtn, startBtn, runBtn], false);
            }
        });

        if (configTbody) {
            configTbody.addEventListener('click', async (event) => {
                const actionBtn = event.target.closest('[data-inference-config-action]');
                if (!actionBtn) return;

                const action = String(actionBtn.dataset.inferenceConfigAction || '').trim();
                if (action === 'load') {
                    const raw = decodePayloadValue(actionBtn.dataset.inferenceConfigDetail);
                    let detail = {};
                    try {
                        detail = raw ? JSON.parse(raw) : {};
                    } catch (error) {
                        detail = {};
                    }
                    applyInferenceConfig(detail);
                    return;
                }

                if (action === 'delete') {
                    const id = Number(actionBtn.dataset.inferenceConfigId);
                    const name = decodePayloadValue(actionBtn.dataset.inferenceConfigName) || '该配置';
                    if (!Number.isInteger(id) || id <= 0) {
                        setInlineStatus(configStatus, '无效的推理配置 ID', 'error');
                        return;
                    }
                    if (!window.confirm(`确认删除推理配置“${name}”吗？`)) {
                        return;
                    }
                    try {
                        await apiRequest(`/inference/configs/${id}`, {
                            method: 'DELETE',
                        });
                        if (id === activeConfigId) {
                            activeConfigId = 0;
                            activeConfigName = '';
                            setConfigActiveLabel();
                        }
                        setInlineStatus(configStatus, `已删除推理配置：${name}`, 'info');
                        await fetchInferenceConfigs();
                    } catch (error) {
                        setInlineStatus(configStatus, `删除推理配置失败: ${error.message}`, 'error');
                    }
                }
            });
        }

        setConfigActiveLabel();
        fetchInferenceConfigs();
    }

    // initBaiduNetdiskBindingPage wires the authorization-code binding form and result view.
    function initBaiduNetdiskBindingPage() {
        const form = document.querySelector('[data-baidu-bind-form]');
        if (!form) return;

        const feedbackEl = document.querySelector('[data-baidu-bind-feedback]');
        const resultEl = document.querySelector('[data-baidu-bind-result]');
        const summaryEl = document.querySelector('[data-baidu-bind-result-summary]');
        const filePanelEl = document.querySelector('[data-baidu-bind-file-panel]');
        const fileListEl = document.querySelector('[data-baidu-bind-file-list]');
        const submitBtn = document.querySelector('[data-baidu-bind-submit]');
        const endpointLabelEl = document.querySelector('[data-baidu-bind-endpoint-label]');
        const docLinkEl = document.querySelector('a[href="https://pan.baidu.com/union/doc/6l0ryrjzv"]');

        if (endpointLabelEl) {
            endpointLabelEl.textContent = baiduOAuthBindEndpoint;
        }
        if (docLinkEl) {
            docLinkEl.href = baiduOAuthDocUrl;
        }

        // setBindingFeedback updates the bind status message area.
        const setBindingFeedback = (message, tone = 'info') => {
            if (!feedbackEl) return;
            if (!message) {
                feedbackEl.hidden = true;
                feedbackEl.className = 'model-import-feedback alert info';
                feedbackEl.textContent = '';
                return;
            }
            feedbackEl.hidden = false;
            feedbackEl.className = `model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            feedbackEl.textContent = message;
        };

        // extractDirectoryFiles pulls a file list from common backend response shapes.
        const extractDirectoryFiles = (value) => {
            if (!value || typeof value !== 'object') return [];

            const candidates = [
                value.files,
                value.directory_files,
                value.items,
                value.list,
                value.data && value.data.files,
                value.data && value.data.directory_files,
                value.data && value.data.items,
                value.data && value.data.list,
            ];

            for (let i = 0; i < candidates.length; i += 1) {
                if (Array.isArray(candidates[i])) {
                    return candidates[i];
                }
            }

            return [];
        };

        // extractDirectoryPath pulls the configured/current directory path from common response shapes.
        const extractDirectoryPath = (value) => {
            if (!value || typeof value !== 'object') return '';

            const candidates = [
                value.directory,
                value.dir,
                value.path,
                value.current_directory,
                value.configured_directory,
                value.baidu_directory,
                value.storage_path,
                value.data && value.data.directory,
                value.data && value.data.dir,
                value.data && value.data.path,
                value.data && value.data.current_directory,
                value.data && value.data.configured_directory,
                value.data && value.data.baidu_directory,
                value.data && value.data.storage_path,
            ];

            for (let i = 0; i < candidates.length; i += 1) {
                const candidate = String(candidates[i] || '').trim();
                if (candidate) return candidate;
            }

            return '';
        };

        // renderDirectoryResult shows the current configured directory and file list without refreshing the page.
        const renderDirectoryResult = (value) => {
            if (!summaryEl || !filePanelEl || !fileListEl) return;

            const directoryPath = extractDirectoryPath(value);
            const files = extractDirectoryFiles(value);

            if (!directoryPath && files.length === 0) {
                summaryEl.hidden = true;
                summaryEl.innerHTML = '';
                filePanelEl.hidden = true;
                fileListEl.innerHTML = '';
                return;
            }

            const summaryItems = [];
            if (directoryPath) {
                summaryItems.push(`
                    <div class="property-item">
                        <span class="property-label">当前配置目录</span>
                        <code class="property-value">${escapeHtml(directoryPath)}</code>
                    </div>
                `);
            }
            summaryItems.push(`
                <div class="property-item">
                    <span class="property-label">文件数量</span>
                    <span class="property-value">${files.length}</span>
                </div>
            `);
            summaryEl.innerHTML = summaryItems.join('');
            summaryEl.hidden = false;

            if (!files.length) {
                filePanelEl.hidden = true;
                fileListEl.innerHTML = '';
                return;
            }

            fileListEl.innerHTML = files.map((file) => {
                if (file && typeof file === 'object') {
                    const name = String(
                        file.name || file.filename || file.file_name || file.path || file.fs_id || JSON.stringify(file),
                    ).trim();
                    const size = file.size != null ? ` (${escapeHtml(formatFileSize(file.size))})` : '';
                    return `<li><code>${escapeHtml(name || '--')}</code>${size}</li>`;
                }
                return `<li><code>${escapeHtml(String(file))}</code></li>`;
            }).join('');
            filePanelEl.hidden = false;
        };

        // setBindingResult writes the latest backend response into the result panel.
        const setBindingResult = (value) => {
            if (!resultEl) return;
            if (value == null || value === '') {
                resultEl.textContent = '等待提交凭证...';
                renderDirectoryResult(null);
                return;
            }
            if (typeof value === 'string') {
                resultEl.textContent = value;
                renderDirectoryResult(null);
                return;
            }
            resultEl.textContent = JSON.stringify(value, null, 2);
            renderDirectoryResult(value);
        };

        // parseBaiduTokenCredential normalizes a raw token credential string into a POST payload.
        const parseBaiduTokenCredential = (rawCredential) => {
            const raw = String(rawCredential || '').trim();
            if (!raw) {
                throw new Error('请输入百度 Access Token 凭证。');
            }

            const payload = {
                credential: raw,
                raw_credential: raw,
            };

            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const accessToken = String(parsed.access_token || '').trim();
                    const refreshToken = String(parsed.refresh_token || '').trim();
                    const scope = String(parsed.scope || '').trim();
                    const sessionKey = String(parsed.session_key || '').trim();
                    const sessionSecret = String(parsed.session_secret || '').trim();
                    const expiresIn = Number(parsed.expires_in);

                    payload.credential = parsed;
                    if (accessToken) payload.access_token = accessToken;
                    if (refreshToken) payload.refresh_token = refreshToken;
                    if (scope) payload.scope = scope;
                    if (sessionKey) payload.session_key = sessionKey;
                    if (sessionSecret) payload.session_secret = sessionSecret;
                    if (Number.isFinite(expiresIn) && expiresIn >= 0) payload.expires_in = expiresIn;
                    return payload;
                }
            } catch (error) {
                // Treat non-JSON input as a plain access_token string.
            }

            payload.access_token = raw;
            return payload;
        };

        setBindingFeedback('');
        setBindingResult('');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData(form);
            const payload = parseBaiduTokenCredential(formData.get('credential'));

            submitBtn.disabled = true;
            setBindingFeedback('正在上传百度 Access Token 凭证...', 'info');

            try {
                const result = await apiRequest(baiduOAuthBindEndpoint, {
                    method: 'POST',
                    body: payload,
                });
                setBindingResult(result);
                setBindingFeedback('百度网盘凭证上传成功，请核对后端返回结果。', 'info');
            } catch (error) {
                setBindingResult(error && error.responseData ? error.responseData : String(error && error.message || '请求失败'));
                setBindingFeedback(`上传失败：${error.message}`, 'error');
            } finally {
                submitBtn.disabled = false;
            }
        });
    }

    function initDatasetManagementPage() {
        const messageSlot = document.querySelector('[data-dataset-message]');
        const uploadOpenBtn = document.querySelector('[data-dataset-upload-open]');
        const uploadModal = document.querySelector('[data-dataset-upload-modal]');
        const uploadCloseBtns = document.querySelectorAll('[data-dataset-upload-close]');
        const uploadForm = document.querySelector('[data-dataset-upload-form]');
        const uploadFeedback = document.querySelector('[data-dataset-upload-feedback]');
        const datasetApiBase = document.querySelector('[data-dataset-api-base]');
        const datasetFileDropzone = document.querySelector('[data-dataset-file-dropzone]');
        const datasetFileInput = document.querySelector('[data-dataset-file-input]');
        const datasetFileHint = document.querySelector('[data-dataset-file-hint]');
        const datasetNameInput = document.querySelector('#dataset-name');
        const datasetSizeInput = document.querySelector('#dataset-size-mb');
        const datasetPathInput = document.querySelector('#dataset-path');
        const datasetFormatInput = document.querySelector('#dataset-format');
        const datasetStorageServerSelect = document.querySelector('#dataset-storage-server');
        const datasetTable = document.querySelector('.data-table');
        const datasetTbody = datasetTable && datasetTable.querySelector('tbody');

        let selectedDatasetFile = null;
        const datasetDefaultFileHint = '支持拖拽/点选，提交时会先调用文件上传接口，再写入数据集元数据。';

        if (datasetApiBase) {
            datasetApiBase.textContent = apiBaseUrl;
        }

        const setFeedback = (message, tone = 'info') => {
            if (!uploadFeedback) return;
            if (!message) {
                uploadFeedback.hidden = true;
                uploadFeedback.className = 'model-import-feedback alert info';
                uploadFeedback.textContent = '';
                return;
            }
            uploadFeedback.hidden = false;
            uploadFeedback.className = `model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            uploadFeedback.textContent = message;
        };

        const openModal = async () => {
            if (!uploadModal) return;
            uploadModal.hidden = false;
            setFeedback('');
            try {
                await populateStorageServerSelects(uploadModal);
            } catch (error) {
                setFeedback(String(error && error.message || '存储服务加载失败'), 'error');
            }
            if (datasetNameInput) datasetNameInput.focus();
        };

        const closeModal = () => {
            if (!uploadModal) return;
            uploadModal.hidden = true;
            selectedDatasetFile = null;
            setFeedback('');
            if (uploadForm) uploadForm.reset();
            if (datasetFileHint) {
                datasetFileHint.textContent = datasetDefaultFileHint;
            }
        };

        setupDropzone({
            zone: datasetFileDropzone,
            fileInput: datasetFileInput,
            hintEl: datasetFileHint,
            defaultHint: datasetDefaultFileHint,
            onFile: (file) => {
                selectedDatasetFile = file;
                if (datasetNameInput && !datasetNameInput.value.trim()) {
                    datasetNameInput.value = trimExtension(file.name);
                }
                if (datasetSizeInput && !datasetSizeInput.value) {
                    datasetSizeInput.value = bytesToMB(file.size);
                }
                if (datasetPathInput && !datasetPathInput.value.trim()) {
                    datasetPathInput.value = `/uploads/datasets/${file.name}`;
                }
                if (datasetFormatInput && !datasetFormatInput.value.trim()) {
                    const ext = (file.name.split('.').pop() || '').toLowerCase();
                    if (ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === 'tgz' || ext === '7z') {
                        datasetFormatInput.value = 'archive';
                    }
                }
            },
        });

        if (uploadOpenBtn) {
            uploadOpenBtn.addEventListener('click', openModal);
        }

        uploadCloseBtns.forEach((btn) => {
            btn.addEventListener('click', closeModal);
        });

        if (uploadModal) {
            uploadModal.addEventListener('click', (e) => {
                if (e.target === uploadModal) {
                    closeModal();
                }
            });
        }

        const collectDatasetRowDetail = (row) => {
            if (!row) return {};
            const cells = row.querySelectorAll('td');
            const name = (row.querySelector('.name-cell > span:first-child') || {}).textContent || '';
            const version = (row.querySelector('.name-cell .badge') || {}).textContent || '';
            const storageAndFormat = Array.from(row.querySelectorAll('.tech-stack .tag'))
                .map((el) => String(el.textContent || '').trim())
                .filter(Boolean);
            const sampleCount = cells[2] ? String(cells[2].textContent || '').trim() : '';
            const size = cells[3] ? String(cells[3].textContent || '').trim() : '';
            const status = cells[4] ? String(cells[4].textContent || '').trim() : '';
            const uploadTime = cells[5] ? String(cells[5].textContent || '').trim() : '';
            const rowDatasetId = Number(row.dataset.datasetId || row.dataset.id || 0);
            return {
                id: Number.isInteger(rowDatasetId) && rowDatasetId > 0 ? rowDatasetId : undefined,
                name: String(name).trim(),
                version: String(version).trim(),
                storage_and_format: storageAndFormat,
                sample_count: sampleCount,
                size,
                status,
                upload_time: uploadTime,
            };
        };

        const resolveDatasetRecordForEdit = async (detailPayload) => {
            const idCandidate = Number(detailPayload && (detailPayload.id || detailPayload.dataset_id));
            const name = String(detailPayload && detailPayload.name || '').trim();
            const query = {
                page: 1,
                page_size: 20,
            };
            if (name) {
                query.name = name;
            } else if (Number.isInteger(idCandidate) && idCandidate > 0) {
                query.keyword = String(idCandidate);
            } else {
                throw new Error('缺少数据集标识，无法修改。');
            }

            const data = await apiRequest('/datasets', { query });
            const list = Array.isArray(data && data.list) ? data.list : [];
            if (!list.length) {
                throw new Error('未找到对应数据集记录。');
            }

            const matched = list.find((item) => {
                const itemName = String(item && item.name || '').trim();
                const itemId = Number(item && item.id);
                if (name && itemName === name) return true;
                return Number.isInteger(idCandidate) && idCandidate > 0 && itemId === idCandidate;
            }) || list[0];

            const resolvedId = Number(matched && matched.id);
            if (!Number.isInteger(resolvedId) || resolvedId <= 0) {
                throw new Error('未解析到有效数据集ID。');
            }

            return matched;
        };

        if (datasetTbody) {
            datasetTbody.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('[data-dataset-action]');
                if (!actionBtn) return;

                const action = String(actionBtn.dataset.datasetAction || '').trim();
                const row = actionBtn.closest('tr');
                const wrapper = actionBtn.closest('.action-wrapper');
                if (wrapper) wrapper.classList.remove('expanded');

                const detail = collectDatasetRowDetail(row);
                const displayName = detail.name || '数据集';

                if (action === 'properties') {
                    const propertyTitle = `数据集属性 - ${displayName}`;
                    openPropertyModal(propertyTitle, detail, {
                        editAction: {
                            label: '修改存储服务',
                            handler: async (detailPayload) => {
                                const resolvedDataset = await resolveDatasetRecordForEdit(detailPayload || detail);
                                const datasetId = Number(resolvedDataset && resolvedDataset.id);
                                const datasetName = String(resolvedDataset && resolvedDataset.name || displayName).trim() || displayName;
                                const existingServers = parseStorageServers(
                                    resolvedDataset && resolvedDataset.storage_servers,
                                    resolvedDataset && resolvedDataset.storage_server,
                                );
                                const input = window.prompt(
                                    '请输入 storage_server（多个值用逗号分隔，例如 backend,baiduNetDisk）',
                                    existingServers.join(', '),
                                );
                                if (input === null) return;

                                const parsed = String(input)
                                    .split(/[\n,，]/g)
                                    .map((item) => item.trim())
                                    .filter(Boolean);
                                const nextServers = parseStorageServers(parsed);
                                if (!nextServers.length) {
                                    const confirmed = window.confirm('将清空该数据集的 storage_server，是否继续？');
                                    if (!confirmed) return;
                                }

                                await updateStorageServersForEntity('datasets', datasetId, 'set', nextServers);
                                showAlert(messageSlot, `数据集“${datasetName}”存储服务已更新。`, 'info');
                            },
                        },
                    });
                    return;
                }

                if (action === 'cloud-sync') {
                    showAlert(messageSlot, `“${displayName}”的压缩上传接口暂未接入，已预留操作入口。`, 'info');
                    return;
                }

                if (action === 'delete') {
                    showAlert(messageSlot, `删除“${displayName}”接口暂未接入。`, 'info');
                }
            });
        }

        if (uploadForm) {
            uploadForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!uploadForm.checkValidity()) {
                    uploadForm.reportValidity();
                    return;
                }

                const submitBtn = uploadForm.querySelector('[data-dataset-upload-submit]');
                const originalSubmitText = submitBtn ? submitBtn.innerHTML : '';

                const formData = new FormData(uploadForm);
                const sizeMb = Number(formData.get('size_mb'));
                if (!Number.isFinite(sizeMb) || sizeMb <= 0) {
                    setFeedback('`size_mb` 必须是大于 0 的数字。', 'error');
                    return;
                }

                let resolvedStorageServer = String(formData.get('storage_server') || '').trim();
                let resolvedDatasetPath = String(formData.get('dataset_path') || '').trim();
                let resolvedSizeMb = sizeMb;
                const requestBaiduUpload = shouldUploadToBaidu(resolvedStorageServer);
                let baiduUploaded = false;

                const payload = {
                    name: String(formData.get('name') || '').trim(),
                    storage_server: resolvedStorageServer,
                    task_type: String(formData.get('task_type') || '').trim(),
                    dataset_format: String(formData.get('dataset_format') || '').trim(),
                    dataset_path: resolvedDatasetPath,
                    version: String(formData.get('version') || '').trim(),
                    size_mb: resolvedSizeMb,
                };

                const description = String(formData.get('description') || '').trim();
                const configPath = String(formData.get('config_path') || '').trim();
                if (description) payload.description = description;
                if (configPath) payload.config_path = configPath;
                if (selectedDatasetFile && !payload.description) {
                    payload.description = `Selected local file: ${selectedDatasetFile.name}`;
                }

                try {
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 上传中';
                    }

                    if (selectedDatasetFile) {
                        setFeedback('正在上传数据集文件...', 'info');
                        const uploadResult = await uploadFileViaApi('/datasets/upload', {
                            file: selectedDatasetFile,
                            storageServer: resolvedStorageServer,
                            subdir: (window.APP_CONFIG && window.APP_CONFIG.DATASET_UPLOAD_SUBDIR) || 'web-datasets',
                            uploadToBaidu: requestBaiduUpload,
                        });

                        baiduUploaded = isTruthyFlag(uploadResult && uploadResult.baidu_uploaded);
                        if (requestBaiduUpload && !baiduUploaded) {
                            throw new Error('已选择百度网盘，但网盘上传失败，请检查后端百度网盘配置。');
                        }

                        const preferredPath = requestBaiduUpload
                            ? (uploadResult && (uploadResult.baidu_path || uploadResult.saved_path))
                            : (uploadResult && uploadResult.saved_path);
                        if (preferredPath) {
                            resolvedDatasetPath = String(preferredPath);
                            payload.dataset_path = resolvedDatasetPath;
                            if (datasetPathInput) {
                                datasetPathInput.value = resolvedDatasetPath;
                            }
                        }

                        if (!requestBaiduUpload && uploadResult && uploadResult.storage_server) {
                            resolvedStorageServer = String(uploadResult.storage_server);
                            payload.storage_server = resolvedStorageServer;
                            if (datasetStorageServerSelect) {
                                datasetStorageServerSelect.value = resolvedStorageServer;
                            }
                        }
                        if (requestBaiduUpload) {
                            payload.storage_server = resolvedStorageServer;
                        }

                        const uploadedBytes = Number(uploadResult && uploadResult.size);
                        if (Number.isFinite(uploadedBytes) && uploadedBytes > 0) {
                            resolvedSizeMb = Number(bytesToMB(uploadedBytes));
                            payload.size_mb = resolvedSizeMb;
                            if (datasetSizeInput) {
                                datasetSizeInput.value = String(resolvedSizeMb);
                            }
                        }

                        if (!payload.dataset_path) {
                            throw new Error('文件上传成功但未返回保存路径(saved_path)');
                        }
                        if (requestBaiduUpload) {
                            const baiduPath = uploadResult && uploadResult.baidu_path ? String(uploadResult.baidu_path) : '';
                            const detail = baiduPath ? `（网盘路径：${baiduPath}）` : '';
                            setFeedback(`文件上传成功，已同步到百度网盘${detail}，正在创建数据集记录...`, 'info');
                        } else {
                            setFeedback('文件上传成功，正在创建数据集记录...', 'info');
                        }
                    }

                    const createdDataset = await apiRequest('/datasets', {
                        method: 'POST',
                        body: payload,
                    });

                    let syncWarning = '';
                    const createdDatasetId = getCreatedEntityId(createdDataset);
                    const storageServersForSync = getStorageServersForSync(resolvedStorageServer, {
                        requestBaiduUpload,
                        baiduUploaded,
                    });

                    if (createdDatasetId) {
                        try {
                            await syncStorageServersForEntity('datasets', createdDatasetId, storageServersForSync);
                        } catch (syncError) {
                            syncWarning = `数据集已创建，但存储服务同步失败：${syncError.message}`;
                        }
                    } else {
                        syncWarning = '数据集已创建，但未获取到记录ID，无法同步存储服务。';
                    }

                    showAlert(messageSlot, syncWarning || '数据集元数据上传成功。可继续在列表中管理。', syncWarning ? 'error' : 'info');
                    closeModal();
                } catch (error) {
                    setFeedback(`上传失败: ${error.message}`, 'error');
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalSubmitText;
                    }
                }
            });
        }

        populateStorageServerSelects(uploadModal).catch((error) => {
            showAlert(messageSlot, String(error && error.message || '存储服务加载失败'), 'error');
        });
        initTableFeatures();
    }

    function initVideoSlicingPage() {
        const table = document.querySelector('[data-video-table]');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const searchInput = document.querySelector('[data-video-search-input]');
        const searchBtn = document.querySelector('[data-video-search-btn]');
        const refreshBtn = document.querySelector('[data-video-refresh-btn]');
        const uploadOpenBtn = document.querySelector('[data-video-upload-open]');
        const pageSizeSelect = document.querySelector('[data-video-page-size]');
        const totalItemsEl = document.querySelector('[data-video-total-items]');
        const paginationControls = document.querySelector('[data-video-pagination]');
        const messageSlot = document.querySelector('[data-video-message]');

        const uploadModal = document.querySelector('[data-video-upload-modal]');
        const uploadCloseBtns = document.querySelectorAll('[data-video-upload-close]');
        const uploadForm = document.querySelector('[data-video-upload-form]');
        const uploadFeedback = document.querySelector('[data-video-upload-feedback]');
        const videoFileDropzone = document.querySelector('[data-video-file-dropzone]');
        const videoFileInput = document.querySelector('[data-video-file-input]');
        const videoFileHint = document.querySelector('[data-video-file-hint]');
        const videoNameInput = document.querySelector('#video-name');
        const videoFileNameInput = document.querySelector('#video-file-name');

        const previewModal = document.querySelector('[data-video-preview-modal]');
        const previewCloseBtns = document.querySelectorAll('[data-video-preview-close]');
        const previewTitle = document.querySelector('[data-video-preview-title]');
        const previewMeta = document.querySelector('[data-video-preview-meta]');
        const previewPlayer = document.querySelector('[data-video-preview-player]');
        const sliceModal = document.querySelector('[data-video-slice-modal]');
        const sliceCloseBtns = document.querySelectorAll('[data-video-slice-close]');
        const sliceTitle = document.querySelector('[data-video-slice-title]');
        const sliceForm = document.querySelector('[data-video-slice-form]');
        const sliceFeedback = document.querySelector('[data-video-slice-feedback]');
        const sliceDurationInput = document.querySelector('#video-slice-duration');
        const sliceResults = document.querySelector('[data-video-slice-results]');
        const sliceResultsMeta = document.querySelector('[data-video-slice-results-meta]');
        const sliceResultList = document.querySelector('[data-video-slice-result-list]');
        const frameCollections = document.querySelector('[data-video-frame-collections]');
        const frameCollectionsMeta = document.querySelector('[data-video-frame-collections-meta]');
        const frameCollectionsList = document.querySelector('[data-video-frame-collections-list]');

        const state = {
            page: 1,
            pageSize: Number(pageSizeSelect && pageSizeSelect.value) || 10,
            keyword: '',
            total: 0,
            rows: [],
            loading: false,
        };

        let searchTimer = null;
        let selectedVideoFile = null;
        let activeSliceVideo = null;
        const defaultFileHint = '支持 mp4 / mov / mkv / avi / mpeg / webm';

        const setLoadingState = (loading) => {
            state.loading = loading;
            [searchInput, searchBtn, refreshBtn, uploadOpenBtn, pageSizeSelect].forEach((el) => {
                if (el) el.disabled = loading;
            });
        };

        const renderPlaceholderRow = (message) => {
            tbody.innerHTML = `<tr><td colspan="5" class="table-state">${escapeHtml(message)}</td></tr>`;
        };

        const setUploadFeedback = (message, tone = 'info') => {
            if (!uploadFeedback) return;
            if (!message) {
                uploadFeedback.hidden = true;
                uploadFeedback.className = 'model-import-feedback alert info';
                uploadFeedback.textContent = '';
                return;
            }
            uploadFeedback.hidden = false;
            uploadFeedback.className = `model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            uploadFeedback.textContent = message;
        };

        // setSliceFeedback updates the frame capture modal feedback banner.
        const setSliceFeedback = (message, tone = 'info') => {
            if (!sliceFeedback) return;
            if (!message) {
                sliceFeedback.hidden = true;
                sliceFeedback.className = 'model-import-feedback alert info';
                sliceFeedback.textContent = '';
                return;
            }
            sliceFeedback.hidden = false;
            sliceFeedback.className = `model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            sliceFeedback.textContent = message;
        };

        const renderRows = () => {
            if (!Array.isArray(state.rows) || state.rows.length === 0) {
                renderPlaceholderRow('暂无视频数据');
                return;
            }

            tbody.innerHTML = state.rows.map((video) => {
                const id = Number(video.id) || 0;
                const title = escapeHtml(video.name || '--');
                const originalFileName = escapeHtml(video.original_file_name || video.file_name || '--');
                const thumbnailUrl = escapeHtml(video.thumbnail_url || '');
                const streamUrl = escapeHtml(video.stream_url || '');
                const durationText = escapeHtml(formatDuration(video.duration_seconds));
                const sizeText = escapeHtml(formatSizeMB(video.size_mb));
                const createdAt = escapeHtml(formatDateTime(video.created_at));
                const description = escapeHtml(video.description || '');
                return `
                    <tr data-video-row-id="${id}">
                        <td>
                            <div class="video-listing">
                                <button class="video-thumb-button" type="button" data-video-action="preview" data-video-id="${id}" data-video-stream-url="${streamUrl}" data-video-title="${title}" data-video-thumb-url="${thumbnailUrl}" data-video-meta="${escapeHtml(`原文件：${originalFileName}${description ? `｜${description}` : ''}`)}">
                                    <img class="video-thumb-image" src="${thumbnailUrl}" alt="${title}" loading="lazy" />
                                </button>
                                <div class="video-copy">
                                    <div class="video-name">${title}</div>
                                    <div class="video-file-name">${originalFileName}</div>
                                </div>
                            </div>
                        </td>
                        <td>${durationText}</td>
                        <td>${sizeText}</td>
                        <td>${createdAt}</td>
                        <td>
                            <div class="video-row-actions">
                                <div class="action-wrapper">
                                    <button class="btn-icon action-toggle" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                                    <div class="action-menu">
                                        <button class="btn-icon" title="预览视频" data-video-action="preview" data-video-id="${id}" data-video-stream-url="${streamUrl}" data-video-title="${title}" data-video-thumb-url="${thumbnailUrl}" data-video-meta="${escapeHtml(`原文件：${originalFileName}${description ? `｜${description}` : ''}`)}"><i class="fa-solid fa-play"></i></button>
                                        <button class="btn-icon" title="固定间隔抽帧" data-video-action="slice-fixed" data-video-id="${id}"><i class="fa-solid fa-camera-retro"></i></button>
                                        <button class="btn-icon" title="下载抽帧结果" data-video-action="download-frames" data-video-id="${id}"><i class="fa-solid fa-file-zipper"></i></button>
                                        <button class="btn-icon" title="查看属性" data-video-action="properties" data-video-detail="${escapeHtml(encodeURIComponent(JSON.stringify(video || {})))}"><i class="fa-solid fa-circle-info"></i></button>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        };

        const renderPaginationControls = () => {
            if (!paginationControls) return;
            const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
            if (state.page > totalPages) state.page = totalPages;
            paginationControls.innerHTML = '';

            const prevBtn = document.createElement('button');
            prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            prevBtn.disabled = state.page <= 1 || state.loading;
            prevBtn.addEventListener('click', () => {
                if (state.page <= 1) return;
                state.page -= 1;
                fetchVideos();
            });
            paginationControls.appendChild(prevBtn);

            let startPage = Math.max(1, state.page - 2);
            let endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) {
                startPage = Math.max(1, endPage - 4);
            }

            for (let i = startPage; i <= endPage; i += 1) {
                const btn = document.createElement('button');
                btn.textContent = String(i);
                if (i === state.page) btn.classList.add('active');
                btn.disabled = state.loading;
                btn.addEventListener('click', () => {
                    if (state.page === i) return;
                    state.page = i;
                    fetchVideos();
                });
                paginationControls.appendChild(btn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.disabled = state.page >= totalPages || state.loading;
            nextBtn.addEventListener('click', () => {
                if (state.page >= totalPages) return;
                state.page += 1;
                fetchVideos();
            });
            paginationControls.appendChild(nextBtn);
        };

        // hideSliceResults clears the current frame result list.
        const hideSliceResults = () => {
            if (sliceResults) sliceResults.hidden = true;
            if (sliceResultsMeta) sliceResultsMeta.textContent = '';
            if (sliceResultList) sliceResultList.innerHTML = '';
        };

        // hideFrameCollections clears the current list of existing frame intervals.
        const hideFrameCollections = () => {
            if (frameCollections) frameCollections.hidden = true;
            if (frameCollectionsMeta) frameCollectionsMeta.textContent = '';
            if (frameCollectionsList) frameCollectionsList.innerHTML = '';
        };

        // closeSliceModal resets and hides the fixed-interval frame modal.
        const closeSliceModal = () => {
            if (!sliceModal) return;
            sliceModal.hidden = true;
            activeSliceVideo = null;
            if (sliceForm) sliceForm.reset();
            setSliceFeedback('');
            hideFrameCollections();
            hideSliceResults();
        };

        // buildFramePreviewUrl appends a cache-busting token to frame image URLs.
        const buildFramePreviewUrl = (imageUrl, index) => {
            const safeUrl = String(imageUrl || '').trim();
            if (!safeUrl) return '';
            const marker = safeUrl.includes('?') ? '&' : '?';
            return `${safeUrl}${marker}preview=${Date.now()}_${index}`;
        };

        // renderSliceResults renders the newly generated frame images in the modal.
        const renderSliceResults = (intervalSeconds, frames = [], outputDir = '', downloadUrl = '') => {
            if (!sliceResults || !sliceResultsMeta || !sliceResultList) return;
            sliceResults.hidden = false;
            const safeOutputDir = String(outputDir || '').trim();
            sliceResultsMeta.textContent = `抽帧间隔：${intervalSeconds}s，共生成 ${frames.length} 张图片${safeOutputDir ? `，输出目录：${safeOutputDir}` : ''}`;
            sliceResultList.innerHTML = frames.map((item, index) => {
                const fileName = escapeHtml(item && item.file_name || `frame_${index + 1}.jpg`);
                const timestampText = escapeHtml(formatDuration(item && item.timestamp_seconds));
                const sizeText = escapeHtml(formatSizeMB(item && item.size_mb));
                const rawImageUrl = String(item && item.image_url || '').trim();
                const imageUrl = escapeHtml(rawImageUrl);
                const previewImageUrl = escapeHtml(buildFramePreviewUrl(rawImageUrl, index));
                const imagePath = escapeHtml(item && item.image_path || '');
                return `
                    <div class="video-slice-result-item">
                        <div class="video-slice-result-thumb">
                            <img src="${previewImageUrl}" alt="${fileName}" loading="lazy" onerror="this.hidden=true; this.parentElement.classList.add('is-error');" />
                            <span class="video-slice-result-thumb-fallback">预览不可见</span>
                        </div>
                        <div class="video-slice-result-copy">
                            <div class="video-slice-result-name">${fileName}</div>
                            <div class="video-slice-result-meta">时间点：${timestampText}｜大小：${sizeText}</div>
                            <div class="video-slice-result-path">${imagePath}</div>
                        </div>
                        <a class="btn btn-secondary btn-sm" href="${imageUrl}" target="_blank" rel="noopener noreferrer">
                            <i class="fa-solid fa-image"></i>
                            查看原图
                        </a>
                    </div>
                `;
            }).join('');
        };

        // renderFrameCollections renders all existing frame interval results for the current video.
        const renderFrameCollections = (collections = []) => {
            if (!frameCollections || !frameCollectionsMeta || !frameCollectionsList) return;
            frameCollections.hidden = false;
            frameCollectionsMeta.textContent = collections.length
                ? `当前视频已有 ${collections.length} 组抽帧结果，可按不同抽帧时长查看或下载。`
                : '当前视频还没有抽帧结果。';
            frameCollectionsList.innerHTML = collections.map((item) => {
                const intervalSeconds = Number(item && item.interval_seconds) || 0;
                const frameCount = Number(item && item.frame_count) || 0;
                const outputDir = escapeHtml(item && item.output_dir || '');
                const downloadUrl = escapeHtml(item && item.download_url || '');
                return `
                    <div class="video-frame-collection-item">
                        <div class="video-frame-collection-copy">
                            <div class="video-slice-result-name">${escapeHtml(`${intervalSeconds}s 抽帧`)}</div>
                            <div class="video-slice-result-meta">图片数量：${escapeHtml(String(frameCount))}</div>
                            <div class="video-slice-result-path">${outputDir}</div>
                        </div>
                        <div class="video-frame-collection-actions">
                            <button class="btn btn-secondary btn-sm" type="button" data-video-action="load-frame-collection" data-video-interval="${intervalSeconds}">
                                <i class="fa-solid fa-images"></i>
                                查看结果
                            </button>
                            <a class="btn btn-secondary btn-sm" href="${downloadUrl}" target="_blank" rel="noopener noreferrer">
                                <i class="fa-solid fa-file-zipper"></i>
                                下载
                            </a>
                        </div>
                    </div>
                `;
            }).join('');
        };

        // openSliceModal prepares the fixed-interval frame modal for the selected video.
        const openSliceModal = (video) => {
            if (!sliceModal) return;
            activeSliceVideo = video && typeof video === 'object' ? video : null;
            sliceModal.hidden = false;
            setSliceFeedback('');
            hideFrameCollections();
            hideSliceResults();
            if (sliceForm) sliceForm.reset();
            const storedInterval = Number(activeSliceVideo && activeSliceVideo.frame_interval_seconds);
            if (sliceDurationInput) sliceDurationInput.value = Number.isInteger(storedInterval) && storedInterval > 0 ? String(storedInterval) : '1';
            if (sliceTitle) {
                const safeName = activeSliceVideo && activeSliceVideo.name ? String(activeSliceVideo.name) : '固定间隔抽帧';
                sliceTitle.textContent = `固定间隔抽帧 - ${safeName}`;
            }
            if (sliceDurationInput) sliceDurationInput.focus();
        };

        const loadExistingSlices = async (video, targetInterval = 0) => {
            const targetId = Number(video && video.id);
            if (!Number.isInteger(targetId) || targetId <= 0) {
                return;
            }

            try {
                setSliceFeedback('检测到已完成抽帧，正在读取图片路径...', 'info');
                const result = await apiRequest(`/videos/${targetId}/frames/fixed`, {
                    method: 'GET',
                    query: targetInterval > 0 ? { interval_seconds: targetInterval } : {},
                });
                const frames = Array.isArray(result && result.frames) ? result.frames : [];
                const intervalSeconds = Number(result && result.interval_seconds) || Number(video && video.frame_interval_seconds) || 0;
                const outputDir = String(result && result.frame_output_dir || video && video.frame_output_dir || '').trim();
                const downloadUrl = String(result && result.download_url || video && video.frame_download_url || '').trim();
                const returnedVideo = result && result.video ? result.video : null;
                if (returnedVideo && Number(returnedVideo.id)) {
                    state.rows = state.rows.map((item) => (
                        Number(item && item.id) === Number(returnedVideo.id)
                            ? returnedVideo
                            : item
                    ));
                    renderRows();
                }
                if (frames.length) {
                    renderSliceResults(intervalSeconds, frames, outputDir, downloadUrl);
                    setSliceFeedback('已返回已有抽帧图片路径。', 'info');
                } else {
                    setSliceFeedback('当前记录标记为已抽帧，但没有读取到图片文件。', 'error');
                }
            } catch (error) {
                setSliceFeedback(`读取已有图片路径失败: ${error.message}`, 'error');
            }
        };

        // loadFrameCollections fetches all existing frame interval results for the selected video.
        const loadFrameCollections = async (video) => {
            const targetId = Number(video && video.id);
            if (!Number.isInteger(targetId) || targetId <= 0) {
                return;
            }

            try {
                const result = await apiRequest(`/videos/${targetId}/frames/collections`, {
                    method: 'GET',
                });
                const collections = Array.isArray(result && result.collections) ? result.collections : [];
                renderFrameCollections(collections);
            } catch (error) {
                hideFrameCollections();
                setSliceFeedback(`读取抽帧结果列表失败: ${error.message}`, 'error');
            }
        };

        const closePreviewModal = () => {
            if (!previewModal) return;
            previewModal.hidden = true;
            if (previewPlayer) {
                previewPlayer.pause();
                previewPlayer.removeAttribute('src');
                previewPlayer.removeAttribute('poster');
                previewPlayer.load();
            }
            if (previewMeta) previewMeta.textContent = '';
        };

        const openPreviewModal = ({ title, streamUrl, thumbUrl, meta }) => {
            if (!previewModal || !previewPlayer) return;
            previewModal.hidden = false;
            if (previewTitle) previewTitle.textContent = title || '视频预览';
            if (previewMeta) previewMeta.textContent = meta || '';
            previewPlayer.src = streamUrl || '';
            if (thumbUrl) {
                previewPlayer.poster = thumbUrl;
            } else {
                previewPlayer.removeAttribute('poster');
            }
            previewPlayer.load();
        };

        const decodePayloadValue = (raw) => {
            const text = String(raw || '');
            if (!text) return '';
            try {
                return decodeURIComponent(text);
            } catch (error) {
                return text;
            }
        };

        async function fetchVideos() {
            setLoadingState(true);
            renderPaginationControls();
            renderPlaceholderRow('视频列表加载中...');
            clearAlert(messageSlot);

            try {
                const data = await apiRequest('/videos', {
                    query: {
                        page: state.page,
                        page_size: state.pageSize,
                        keyword: state.keyword,
                    },
                });
                const list = Array.isArray(data && data.list) ? data.list : [];
                const total = Number(data && data.total);
                state.rows = list;
                state.total = Number.isFinite(total) ? total : list.length;
                renderRows();
                renderPaginationControls();
                if (totalItemsEl) totalItemsEl.textContent = String(state.total);
            } catch (error) {
                state.rows = [];
                state.total = 0;
                renderPlaceholderRow('视频数据加载失败');
                renderPaginationControls();
                if (totalItemsEl) totalItemsEl.textContent = '0';
                showAlert(messageSlot, `加载视频失败: ${error.message}`, 'error');
            } finally {
                setLoadingState(false);
                renderPaginationControls();
            }
        }

        const applySearch = () => {
            state.keyword = String(searchInput && searchInput.value || '').trim();
            state.page = 1;
            fetchVideos();
        };

        const openUploadModal = () => {
            if (!uploadModal) return;
            uploadModal.hidden = false;
            setUploadFeedback('');
            if (videoNameInput) videoNameInput.focus();
        };

        const closeUploadModal = () => {
            if (!uploadModal) return;
            uploadModal.hidden = true;
            selectedVideoFile = null;
            setUploadFeedback('');
            if (uploadForm) uploadForm.reset();
            if (videoFileHint) videoFileHint.textContent = defaultFileHint;
        };

        setupDropzone({
            zone: videoFileDropzone,
            fileInput: videoFileInput,
            hintEl: videoFileHint,
            defaultHint: defaultFileHint,
            onFile: (file) => {
                selectedVideoFile = file;
                if (videoNameInput && !videoNameInput.value.trim()) {
                    videoNameInput.value = trimExtension(file.name);
                }
                if (videoFileNameInput) {
                    videoFileNameInput.value = file.name;
                }
            },
        });

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    applySearch();
                }, 300);
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                clearTimeout(searchTimer);
                applySearch();
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                clearTimeout(searchTimer);
                applySearch();
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                fetchVideos();
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                const next = Number(e.target.value);
                state.pageSize = Number.isFinite(next) && next > 0 ? next : 10;
                state.page = 1;
                fetchVideos();
            });
        }

        if (uploadOpenBtn) {
            uploadOpenBtn.addEventListener('click', openUploadModal);
        }

        uploadCloseBtns.forEach((btn) => {
            btn.addEventListener('click', closeUploadModal);
        });

        if (uploadModal) {
            uploadModal.addEventListener('click', (e) => {
                if (e.target === uploadModal) {
                    closeUploadModal();
                }
            });
        }

        previewCloseBtns.forEach((btn) => {
            btn.addEventListener('click', closePreviewModal);
        });

        if (previewModal) {
            previewModal.addEventListener('click', (e) => {
                if (e.target === previewModal) {
                    closePreviewModal();
                }
            });
        }

        sliceCloseBtns.forEach((btn) => {
            btn.addEventListener('click', closeSliceModal);
        });

        if (sliceModal) {
            sliceModal.addEventListener('click', (e) => {
                if (e.target === sliceModal) {
                    closeSliceModal();
                }
            });
        }

        if (uploadForm) {
            uploadForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!uploadForm.checkValidity()) {
                    uploadForm.reportValidity();
                    return;
                }
                if (!(selectedVideoFile instanceof File)) {
                    setUploadFeedback('请选择要导入的视频文件。', 'error');
                    return;
                }

                const submitBtn = uploadForm.querySelector('[data-video-upload-submit]');
                const originalSubmitText = submitBtn ? submitBtn.innerHTML : '';
                const form = new FormData();
                form.append('file', selectedVideoFile, selectedVideoFile.name);
                form.append('name', String(videoNameInput && videoNameInput.value || '').trim());
                form.append('description', String(uploadForm.querySelector('#video-description') && uploadForm.querySelector('#video-description').value || '').trim());

                try {
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 导入中';
                    }
                    setUploadFeedback('正在上传视频并生成封面...', 'info');
                    await apiRequest('/videos/upload', {
                        method: 'POST',
                        formData: form,
                    });
                    showAlert(messageSlot, '视频导入成功。', 'info');
                    closeUploadModal();
                    state.page = 1;
                    fetchVideos();
                } catch (error) {
                    setUploadFeedback(`导入失败: ${error.message}`, 'error');
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalSubmitText;
                    }
                }
            });
        }

        if (sliceForm) {
            sliceForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (!activeSliceVideo || !Number(activeSliceVideo.id)) {
                    setSliceFeedback('未找到待抽帧的视频记录。', 'error');
                    return;
                }
                if (!sliceForm.checkValidity()) {
                    sliceForm.reportValidity();
                    return;
                }

                const rawDuration = String(sliceDurationInput && sliceDurationInput.value || '').trim();
                const durationSeconds = Number(rawDuration);
                if (!Number.isInteger(durationSeconds) || durationSeconds < 1) {
                    setSliceFeedback('抽帧间隔必须是大于等于 1 的整数秒，不支持小数。', 'error');
                    return;
                }

                const submitBtn = sliceForm.querySelector('[data-video-slice-submit]');
                const originalSubmitText = submitBtn ? submitBtn.innerHTML : '';

                try {
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 抽帧中';
                    }
                    setSliceFeedback('正在按固定间隔抽帧，请稍候...', 'info');
                    const result = await apiRequest(`/videos/${Number(activeSliceVideo.id)}/frames/fixed`, {
                        method: 'POST',
                        body: {
                            interval_seconds: durationSeconds,
                        },
                    });
                    const frames = Array.isArray(result && result.frames) ? result.frames : [];
                    const returnedVideo = result && result.video ? result.video : null;
                    if (returnedVideo && Number(returnedVideo.id)) {
                        activeSliceVideo = returnedVideo;
                        state.rows = state.rows.map((item) => (
                            Number(item && item.id) === Number(returnedVideo.id)
                                ? returnedVideo
                                : item
                        ));
                        renderRows();
                    }
                    await loadFrameCollections(returnedVideo || activeSliceVideo);
                    renderSliceResults(
                        durationSeconds,
                        frames,
                        String(result && result.frame_output_dir || returnedVideo && returnedVideo.frame_output_dir || '').trim(),
                        String(result && result.download_url || returnedVideo && returnedVideo.frame_download_url || '').trim(),
                    );
                    setSliceFeedback(String(result && result.message || `抽帧完成，已生成 ${frames.length} 张图片。`), 'info');
                } catch (error) {
                    hideSliceResults();
                    setSliceFeedback(`抽帧失败: ${error.message}`, 'error');
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalSubmitText;
                    }
                }
            });
        }

        if (frameCollectionsList) {
            frameCollectionsList.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('[data-video-action="load-frame-collection"]');
                if (!actionBtn) return;
                const targetInterval = Number(actionBtn.dataset.videoInterval);
                if (!activeSliceVideo || !Number(activeSliceVideo.id) || !Number.isInteger(targetInterval) || targetInterval < 1) {
                    setSliceFeedback('未找到可加载的抽帧时长。', 'error');
                    return;
                }
                if (sliceDurationInput) {
                    sliceDurationInput.value = String(targetInterval);
                }
                loadExistingSlices(activeSliceVideo, targetInterval);
            });
        }

        if (tbody) {
            tbody.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('[data-video-action]');
                if (!actionBtn) return;

                const wrapper = actionBtn.closest('.action-wrapper');
                if (wrapper) wrapper.classList.remove('expanded');

                const action = String(actionBtn.dataset.videoAction || '').trim();
                if (action === 'preview') {
                    openPreviewModal({
                        title: decodePayloadValue(actionBtn.dataset.videoTitle),
                        streamUrl: decodePayloadValue(actionBtn.dataset.videoStreamUrl),
                        thumbUrl: decodePayloadValue(actionBtn.dataset.videoThumbUrl),
                        meta: decodePayloadValue(actionBtn.dataset.videoMeta),
                    });
                    return;
                }

                if (action === 'slice-fixed') {
                    const targetId = Number(actionBtn.dataset.videoId);
                    const currentVideo = state.rows.find((item) => Number(item && item.id) === targetId);
                    if (!currentVideo) {
                        showAlert(messageSlot, '未找到对应视频，请刷新后重试。', 'error');
                        return;
                    }
                    openSliceModal(currentVideo);
                    loadFrameCollections(currentVideo);
                    if (currentVideo && currentVideo.frame_capture_completed) {
                        loadExistingSlices(currentVideo);
                    }
                    return;
                }

                if (action === 'download-frames') {
                    const targetId = Number(actionBtn.dataset.videoId);
                    const currentVideo = state.rows.find((item) => Number(item && item.id) === targetId);
                    if (!currentVideo) {
                        showAlert(messageSlot, '未找到对应视频，请刷新后重试。', 'error');
                        return;
                    }
                    openSliceModal(currentVideo);
                    setSliceFeedback('请选择要下载的抽帧时长。', 'info');
                    loadFrameCollections(currentVideo);
                    if (currentVideo && currentVideo.frame_capture_completed) {
                        loadExistingSlices(currentVideo);
                    }
                    return;
                }

                if (action === 'properties') {
                    const raw = decodePayloadValue(actionBtn.dataset.videoDetail);
                    let detail = {};
                    try {
                        detail = raw ? JSON.parse(raw) : {};
                    } catch (error) {
                        detail = { raw };
                    }
                    const title = detail && detail.id ? `视频属性 - #${detail.id}` : '视频属性';
                    openPropertyModal(title, detail);
                }
            });
        }

        fetchVideos();
    }

    // initTrainingLogPage initializes the training log editor and list management page.
    function initTrainingLogPage() {
        const table = document.querySelector('[data-training-table]');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const searchInput = document.querySelector('[data-training-search-input]');
        const searchBtn = document.querySelector('[data-training-search-btn]');
        const modelIdInput = document.querySelector('[data-training-filter-model-id]');
        const datasetIdInput = document.querySelector('[data-training-filter-dataset-id]');
        const statusSelect = document.querySelector('[data-training-filter-status]');
        const resetFilterBtn = document.querySelector('[data-training-filter-reset]');
        const refreshBtn = document.querySelector('[data-training-refresh-btn]');
        const pageSizeSelect = document.querySelector('[data-training-page-size]');
        const totalItemsSpan = document.querySelector('[data-training-total-items]');
        const paginationControls = document.querySelector('[data-training-pagination]');
        const messageSlot = document.querySelector('[data-training-message]');
        const apiBaseLabel = document.querySelector('[data-training-api-base]');
        const formEl = document.querySelector('[data-training-log-form]');
        const formIdInput = document.querySelector('[data-training-log-id]');
        const formNameInput = document.querySelector('#training-log-name');
        const formStatusInput = document.querySelector('#training-log-status');
        const formModelIdInput = document.querySelector('#training-log-model-id');
        const formDatasetIdInput = document.querySelector('#training-log-dataset-id');
        const formDatasetVersionInput = document.querySelector('#training-log-dataset-version');
        const formWeightPathInput = document.querySelector('#training-log-weight-path');
        const formCometUrlInput = document.querySelector('#training-log-comet-url');
        const formMetricsInput = document.querySelector('#training-log-metrics');
        const formTrainingMarkdownInput = document.querySelector('#training-log-markdown');
        const formCometMarkdownInput = document.querySelector('#training-log-comet-markdown');
        const formFeedback = document.querySelector('[data-training-log-form-feedback]');
        const submitBtn = document.querySelector('[data-training-log-submit-btn]');
        const resetFormBtns = document.querySelectorAll('[data-training-log-reset-btn]');

        if (apiBaseLabel) {
            apiBaseLabel.textContent = apiBaseUrl;
        }

        const state = {
            page: 1,
            pageSize: Number(pageSizeSelect && pageSizeSelect.value) || 10,
            keyword: '',
            modelId: null,
            datasetId: null,
            status: '',
            total: 0,
            rows: [],
            loading: false,
            editingId: null,
        };
        let searchTimer = null;

        // setFormFeedback renders editor feedback inside the training log card.
        const setFormFeedback = (message, tone = 'info') => {
            if (!formFeedback) return;
            if (!message) {
                formFeedback.hidden = true;
                formFeedback.className = 'model-import-feedback';
                formFeedback.textContent = '';
                return;
            }
            formFeedback.hidden = false;
            formFeedback.className = `model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
            formFeedback.textContent = message;
        };

        // setLoadingState disables list controls during remote requests.
        const setLoadingState = (loading) => {
            state.loading = Boolean(loading);
            [
                searchInput,
                searchBtn,
                modelIdInput,
                datasetIdInput,
                statusSelect,
                resetFilterBtn,
                refreshBtn,
                pageSizeSelect,
            ].forEach((el) => {
                if (el) el.disabled = state.loading;
            });
        };

        // setSubmitButtonState updates the editor button label for create/update mode.
        const setSubmitButtonState = () => {
            if (!submitBtn) return;
            submitBtn.innerHTML = state.editingId
                ? '<i class="fa-solid fa-floppy-disk"></i> 更新训练日志'
                : '<i class="fa-solid fa-floppy-disk"></i> 保存训练日志';
        };

        // renderPlaceholderRow shows a placeholder row in the training log table.
        const renderPlaceholderRow = (message) => {
            tbody.innerHTML = `<tr><td colspan="7" class="table-state">${escapeHtml(message)}</td></tr>`;
        };

        // parsePositiveInteger parses an integer form or filter field that must stay positive.
        const parsePositiveInteger = (raw) => {
            const num = Number.parseInt(String(raw || '').trim(), 10);
            if (!Number.isInteger(num) || num <= 0) return null;
            return num;
        };

        // parseMetricDetail converts persisted metric JSON into an object for rendering.
        const parseMetricDetail = (metricDetail) => {
            if (metricDetail && typeof metricDetail === 'object') return metricDetail;
            if (typeof metricDetail !== 'string') return null;
            const trimmed = metricDetail.trim();
            if (!trimmed) return null;
            try {
                const parsed = JSON.parse(trimmed);
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch (error) {
                return null;
            }
        };

        // formatMetricValue formats metric numbers for compact chip display.
        const formatMetricValue = (value) => {
            const num = Number(value);
            if (Number.isFinite(num)) {
                const precision = Math.abs(num) >= 1 ? 3 : 4;
                return num.toFixed(precision).replace(/\.?0+$/, '');
            }
            return String(value);
        };

        // buildMetricTags creates the metric chips for each training log row.
        const buildMetricTags = (item) => {
            const detail = parseMetricDetail(item && (item.metric_detail || item.metricDetail || item.metrics));
            if (!detail) return [];
            return Object.entries(detail)
                .filter(([key, val]) => key && val != null && val !== '')
                .slice(0, 4)
                .map(([key, val]) => `${key}: ${formatMetricValue(val)}`);
        };

        // getTrainingStatusMeta maps backend status codes into badge styles.
        const getTrainingStatusMeta = (statusValue) => {
            const num = Number(statusValue);
            if (Number.isFinite(num)) {
                const code = Math.trunc(num);
                if (code === 0) return { cls: 'warning', text: '待开始' };
                if (code === 1) return { cls: 'processing', text: '训练中' };
                if (code === 2) return { cls: 'success', text: '成功' };
                if (code === 3) return { cls: 'error', text: '失败' };
                if (code === 4) return { cls: 'warning', text: '已中断' };
            }
            return { cls: 'secondary', text: '未知' };
        };

        // truncateMiddle shortens long file paths without losing the head or tail.
        const truncateMiddle = (text, maxLength = 52) => {
            const str = String(text || '');
            if (str.length <= maxLength) return str;
            const keep = Math.max(8, Math.floor((maxLength - 3) / 2));
            return `${str.slice(0, keep)}...${str.slice(-keep)}`;
        };

        // decodeDataValue decodes URI-encoded payloads stored in action button datasets.
        const decodeDataValue = (value) => {
            const raw = String(value || '');
            if (!raw) return '';
            try {
                return decodeURIComponent(raw);
            } catch (error) {
                return raw;
            }
        };

        // resetTrainingLogForm clears the editor and exits update mode.
        const resetTrainingLogForm = () => {
            if (formEl && typeof formEl.reset === 'function') {
                formEl.reset();
            }
            if (formIdInput) formIdInput.value = '';
            if (formDatasetVersionInput) formDatasetVersionInput.value = '1.000';
            if (formStatusInput) formStatusInput.value = '2';
            state.editingId = null;
            setSubmitButtonState();
            setFormFeedback('');
        };

        // fillTrainingLogForm loads one existing training log back into the editor.
        const fillTrainingLogForm = (item) => {
            const resolvedId = Number(item && item.id);
            state.editingId = Number.isFinite(resolvedId) && resolvedId > 0 ? resolvedId : null;
            if (formIdInput) formIdInput.value = state.editingId ? String(state.editingId) : '';
            if (formNameInput) formNameInput.value = String(item && item.training_name || '').trim();
            if (formStatusInput) formStatusInput.value = String(item && item.training_status != null ? item.training_status : 2);
            if (formModelIdInput) formModelIdInput.value = String(item && item.model_id != null ? item.model_id : '');
            if (formDatasetIdInput) formDatasetIdInput.value = String(item && item.dataset_id != null ? item.dataset_id : '');
            if (formDatasetVersionInput) formDatasetVersionInput.value = String(item && item.dataset_version != null ? item.dataset_version : '1.000');
            if (formWeightPathInput) formWeightPathInput.value = String(item && item.weight_path || '').trim();
            if (formCometUrlInput) formCometUrlInput.value = String(item && item.comet_log_url || '').trim();
            if (formMetricsInput) {
                const parsedMetrics = parseMetricDetail(item && item.metric_detail);
                formMetricsInput.value = parsedMetrics ? JSON.stringify(parsedMetrics, null, 2) : '';
            }
            if (formTrainingMarkdownInput) formTrainingMarkdownInput.value = String(item && item.training_log_markdown || '');
            if (formCometMarkdownInput) formCometMarkdownInput.value = String(item && item.comet_log_markdown || '');
            setSubmitButtonState();
            setFormFeedback(`已载入训练日志 #${state.editingId || '--'}，可直接修改后保存。`, 'info');
            if (formEl && typeof formEl.scrollIntoView === 'function') {
                formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };

        // buildTrainingLogPayload validates the editor and produces the API payload.
        const buildTrainingLogPayload = () => {
            const trainingName = String(formNameInput && formNameInput.value || '').trim();
            const modelId = parsePositiveInteger(formModelIdInput && formModelIdInput.value);
            const datasetId = parsePositiveInteger(formDatasetIdInput && formDatasetIdInput.value);
            const datasetVersion = Number(String(formDatasetVersionInput && formDatasetVersionInput.value || '').trim() || '0');
            const trainingStatus = Number.parseInt(String(formStatusInput && formStatusInput.value || '2').trim(), 10);
            const weightPath = String(formWeightPathInput && formWeightPathInput.value || '').trim();
            const cometLogUrl = String(formCometUrlInput && formCometUrlInput.value || '').trim();
            const trainingLogMarkdown = String(formTrainingMarkdownInput && formTrainingMarkdownInput.value || '');
            const cometLogMarkdown = String(formCometMarkdownInput && formCometMarkdownInput.value || '');
            const metricsText = String(formMetricsInput && formMetricsInput.value || '').trim();

            if (!trainingName) throw new Error('日志名称不能为空。');
            if (modelId == null) throw new Error('模型 ID 需为大于 0 的整数。');
            if (datasetId == null) throw new Error('数据集 ID 需为大于 0 的整数。');
            if (!Number.isFinite(datasetVersion) || datasetVersion < 0) throw new Error('数据集版本需为大于等于 0 的数字。');
            if (!Number.isInteger(trainingStatus) || trainingStatus < 0 || trainingStatus > 4) throw new Error('训练状态无效。');

            let metricDetail = {};
            if (metricsText) {
                try {
                    metricDetail = JSON.parse(metricsText);
                } catch (error) {
                    throw new Error('核心指标 JSON 格式不正确。');
                }
            }

            return {
                training_name: trainingName,
                model_id: modelId,
                dataset_id: datasetId,
                dataset_version: datasetVersion,
                training_status: trainingStatus,
                metric_detail: metricDetail,
                weight_path: weightPath,
                comet_log_url: cometLogUrl,
                training_log_markdown: trainingLogMarkdown,
                comet_log_markdown: cometLogMarkdown,
            };
        };

        // renderRows renders fetched training logs into the table body.
        const renderRows = () => {
            if (!Array.isArray(state.rows) || state.rows.length === 0) {
                renderPlaceholderRow('暂无训练日志');
                return;
            }

            const html = state.rows.map((item) => {
                const logId = item.id ?? '--';
                const trainingName = String(item.training_name || '').trim() || `训练记录 #${logId}`;
                const status = getTrainingStatusMeta(item.training_status ?? item.status);
                const metricTags = buildMetricTags(item);
                const metricsHtml = metricTags.length
                    ? metricTags.map((tagText) => `<span class="tag">${escapeHtml(tagText)}</span>`).join('')
                    : '<span class="tag">--</span>';
                const weightPath = String(item.weight_path || '').trim();
                const cometUrl = String(item.comet_log_url || '').trim();
                const infoTags = [];
                if (String(item.training_log_markdown || '').trim()) infoTags.push('训练MD');
                if (String(item.comet_log_markdown || '').trim()) infoTags.push('Comet MD');
                if (cometUrl) infoTags.push('Comet URL');
                const infoHtml = infoTags.length
                    ? infoTags.map((tagText) => `<span class="tag">${escapeHtml(tagText)}</span>`).join('')
                    : '<span class="tag">无附加记录</span>';
                const detailPayload = encodeURIComponent(JSON.stringify(item || {}));
                const encodedCometUrl = encodeURIComponent(cometUrl);
                const encodedWeightPath = encodeURIComponent(weightPath);
                const encodedName = encodeURIComponent(trainingName);
                const updatedAt = formatDateTime(item.update_time || item.create_time);
                const datasetVersionText = String(item.dataset_version == null ? '--' : item.dataset_version).trim() || '--';

                return `
                    <tr>
                        <td>
                            <div class="name-cell">
                                <div class="name-main">
                                    <span class="model-name-text">${escapeHtml(trainingName)}</span>
                                    <span class="badge secondary sm">#${escapeHtml(String(logId))}</span>
                                </div>
                                <span title="${escapeHtml(weightPath)}">${escapeHtml(weightPath ? truncateMiddle(weightPath) : '--')}</span>
                            </div>
                        </td>
                        <td>
                            <div class="name-cell">
                                <span>模型 #${escapeHtml(String(item.model_id ?? '--'))}</span>
                                <span>数据集 #${escapeHtml(String(item.dataset_id ?? '--'))} / v${escapeHtml(datasetVersionText)}</span>
                            </div>
                        </td>
                        <td><div class="tech-stack">${metricsHtml}</div></td>
                        <td><span class="badge ${status.cls}">${escapeHtml(status.text)}</span></td>
                        <td><div class="tech-stack">${infoHtml}</div></td>
                        <td>${escapeHtml(updatedAt)}</td>
                        <td>
                            <div class="action-wrapper">
                                <button class="btn-icon action-toggle" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                                <div class="action-menu">
                                    <button class="btn-icon" title="编辑" data-training-action="edit" data-training-detail="${escapeHtml(detailPayload)}">
                                        <i class="fa-solid fa-pen"></i>
                                    </button>
                                    <button class="btn-icon" title="属性" data-training-action="properties" data-training-detail="${escapeHtml(detailPayload)}">
                                        <i class="fa-solid fa-circle-info"></i>
                                    </button>
                                    <button class="btn-icon download" title="复制权重路径" data-training-action="copy-weight-path" data-training-path="${escapeHtml(encodedWeightPath)}" ${weightPath ? '' : 'disabled'}>
                                        <i class="fa-solid fa-copy"></i>
                                    </button>
                                    <button class="btn-icon" title="打开 Comet 日志" data-training-action="open-comet" data-training-comet-url="${escapeHtml(encodedCometUrl)}" ${cometUrl ? '' : 'disabled'}>
                                        <i class="fa-solid fa-chart-line"></i>
                                    </button>
                                    <button class="btn-icon delete" title="删除" data-training-action="delete" data-training-id="${escapeHtml(String(logId))}" data-training-name="${escapeHtml(encodedName)}">
                                        <i class="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = html;
        };

        // renderPaginationControls renders training log pagination controls.
        const renderPaginationControls = () => {
            if (!paginationControls) return;

            const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
            if (state.page > totalPages) {
                state.page = totalPages;
            }

            paginationControls.innerHTML = '';

            const prevBtn = document.createElement('button');
            prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            prevBtn.disabled = state.page <= 1 || state.loading;
            prevBtn.addEventListener('click', () => {
                if (state.page <= 1) return;
                state.page -= 1;
                fetchTrainingLogs();
            });
            paginationControls.appendChild(prevBtn);

            let startPage = Math.max(1, state.page - 2);
            let endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) {
                startPage = Math.max(1, endPage - 4);
            }

            for (let i = startPage; i <= endPage; i += 1) {
                const btn = document.createElement('button');
                btn.textContent = String(i);
                if (i === state.page) btn.classList.add('active');
                btn.disabled = state.loading;
                btn.addEventListener('click', () => {
                    if (state.page === i) return;
                    state.page = i;
                    fetchTrainingLogs();
                });
                paginationControls.appendChild(btn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.disabled = state.page >= totalPages || state.loading;
            nextBtn.addEventListener('click', () => {
                if (state.page >= totalPages) return;
                state.page += 1;
                fetchTrainingLogs();
            });
            paginationControls.appendChild(nextBtn);
        };

        // fetchTrainingLogs loads the current training log page from the backend.
        async function fetchTrainingLogs() {
            setLoadingState(true);
            renderPaginationControls();
            renderPlaceholderRow('训练日志加载中...');
            clearAlert(messageSlot);

            try {
                const query = {
                    page: state.page,
                    page_size: state.pageSize,
                    keyword: state.keyword,
                };
                if (state.modelId != null) query.training_model_id = state.modelId;
                if (state.datasetId != null) query.training_dataset_id = state.datasetId;
                if (state.status !== '') query.training_status = state.status;

                const data = await apiRequest('/training-results', { query });
                const list = Array.isArray(data && data.list) ? data.list : [];
                const total = Number(data && data.total);

                state.rows = list;
                state.total = Number.isFinite(total) ? total : list.length;
                renderRows();
                renderPaginationControls();
                if (totalItemsSpan) {
                    totalItemsSpan.textContent = String(state.total);
                }
            } catch (error) {
                state.rows = [];
                state.total = 0;
                renderPlaceholderRow('训练日志加载失败');
                renderPaginationControls();
                if (totalItemsSpan) {
                    totalItemsSpan.textContent = '0';
                }
                showAlert(messageSlot, `加载训练日志失败: ${error.message}`, 'error');
            } finally {
                setLoadingState(false);
                renderPaginationControls();
            }
        }

        // applyFilters applies the current list filters and reloads the table.
        const applyFilters = () => {
            const keyword = String(searchInput && searchInput.value || '').trim();
            const modelIdRaw = String(modelIdInput && modelIdInput.value || '').trim();
            const datasetIdRaw = String(datasetIdInput && datasetIdInput.value || '').trim();
            const nextModelId = modelIdRaw ? parsePositiveInteger(modelIdRaw) : null;
            const nextDatasetId = datasetIdRaw ? parsePositiveInteger(datasetIdRaw) : null;

            if (modelIdRaw && nextModelId == null) {
                showAlert(messageSlot, '模型ID 需为大于 0 的整数。', 'error');
                return;
            }
            if (datasetIdRaw && nextDatasetId == null) {
                showAlert(messageSlot, '数据集ID 需为大于 0 的整数。', 'error');
                return;
            }

            state.keyword = keyword;
            state.modelId = nextModelId;
            state.datasetId = nextDatasetId;
            state.status = String(statusSelect && statusSelect.value || '').trim();
            state.page = 1;
            fetchTrainingLogs();
        };

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    applyFilters();
                }, 300);
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                clearTimeout(searchTimer);
                applyFilters();
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                clearTimeout(searchTimer);
                applyFilters();
            });
        }

        [modelIdInput, datasetIdInput].forEach((inputEl) => {
            if (!inputEl) return;
            inputEl.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                clearTimeout(searchTimer);
                applyFilters();
            });
            inputEl.addEventListener('change', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    applyFilters();
                }, 300);
            });
        });

        if (statusSelect) {
            statusSelect.addEventListener('change', () => {
                clearTimeout(searchTimer);
                applyFilters();
            });
        }

        if (resetFilterBtn) {
            resetFilterBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                if (modelIdInput) modelIdInput.value = '';
                if (datasetIdInput) datasetIdInput.value = '';
                if (statusSelect) statusSelect.value = '';
                clearTimeout(searchTimer);
                applyFilters();
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                fetchTrainingLogs();
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                const next = Number(e.target.value);
                state.pageSize = Number.isFinite(next) && next > 0 ? next : 10;
                state.page = 1;
                fetchTrainingLogs();
            });
        }

        resetFormBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                resetTrainingLogForm();
            });
        });

        if (formEl) {
            formEl.addEventListener('submit', async (e) => {
                e.preventDefault();
                setFormFeedback('');

                let payload = null;
                try {
                    payload = buildTrainingLogPayload();
                } catch (error) {
                    setFormFeedback(String(error && error.message || '表单校验失败。'), 'error');
                    return;
                }

                const targetId = state.editingId;
                const endpoint = targetId ? `/training-results/${targetId}` : '/training-results';
                const method = targetId ? 'PATCH' : 'POST';
                if (submitBtn) submitBtn.disabled = true;

                try {
                    await apiRequest(endpoint, {
                        method,
                        body: JSON.stringify(payload),
                    });
                    setFormFeedback(targetId ? '训练日志更新成功。' : '训练日志保存成功。', 'info');
                    resetTrainingLogForm();
                    fetchTrainingLogs();
                } catch (error) {
                    setFormFeedback(`${targetId ? '更新' : '保存'}训练日志失败: ${error.message}`, 'error');
                } finally {
                    if (submitBtn) submitBtn.disabled = false;
                }
            });
        }

        if (tbody) {
            tbody.addEventListener('click', async (e) => {
                const actionBtn = e.target.closest('[data-training-action]');
                if (!actionBtn) return;

                const wrapper = actionBtn.closest('.action-wrapper');
                if (wrapper) wrapper.classList.remove('expanded');

                const action = actionBtn.dataset.trainingAction;
                if (action === 'edit' || action === 'properties') {
                    const raw = decodeDataValue(actionBtn.dataset.trainingDetail);
                    let detail = {};
                    try {
                        detail = raw ? JSON.parse(raw) : {};
                    } catch (error) {
                        detail = { raw };
                    }

                    if (action === 'edit') {
                        fillTrainingLogForm(detail);
                        return;
                    }

                    const titleId = detail && detail.id;
                    const title = titleId != null ? `训练日志属性 - #${titleId}` : '训练日志属性';
                    openPropertyModal(title, detail, {
                        editAction: {
                            label: '加载到表单',
                            handler: async () => {
                                fillTrainingLogForm(detail);
                            },
                        },
                    });
                    return;
                }

                if (action === 'copy-weight-path') {
                    const path = decodeDataValue(actionBtn.dataset.trainingPath);
                    if (!path) {
                        showAlert(messageSlot, '当前记录没有可复制的权重路径。', 'error');
                        return;
                    }
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(path);
                            showAlert(messageSlot, `权重路径已复制: ${path}`, 'info');
                        } else {
                            window.prompt('复制权重路径：', path);
                            showAlert(messageSlot, '浏览器不支持自动复制，请手动复制路径。', 'info');
                        }
                    } catch (error) {
                        window.prompt('复制权重路径：', path);
                        showAlert(messageSlot, '复制失败，请手动复制路径。', 'error');
                    }
                    return;
                }

                if (action === 'open-comet') {
                    const cometUrl = decodeDataValue(actionBtn.dataset.trainingCometUrl);
                    if (!cometUrl) {
                        showAlert(messageSlot, '当前记录没有 Comet 日志链接。', 'error');
                        return;
                    }
                    window.open(cometUrl, '_blank', 'noopener,noreferrer');
                    return;
                }

                if (action === 'delete') {
                    const id = parsePositiveInteger(actionBtn.dataset.trainingId);
                    const name = decodeDataValue(actionBtn.dataset.trainingName);
                    if (id == null) {
                        showAlert(messageSlot, '训练日志 ID 无效。', 'error');
                        return;
                    }
                    const confirmed = window.confirm(`确认删除训练日志“${name || `#${id}`}”吗？`);
                    if (!confirmed) return;

                    try {
                        await apiRequest(`/training-results/${id}`, { method: 'DELETE' });
                        if (state.editingId === id) {
                            resetTrainingLogForm();
                        }
                        showAlert(messageSlot, `训练日志“${name || `#${id}`}”已删除。`, 'info');
                        fetchTrainingLogs();
                    } catch (error) {
                        showAlert(messageSlot, `删除训练日志失败: ${error.message}`, 'error');
                    }
                }
            });
        }

        resetTrainingLogForm();
        fetchTrainingLogs();
    }

    // Generic table features for non-model pages
    function initTableFeatures() {
        const table = document.querySelector('.data-table');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const originalRows = Array.from(tbody.querySelectorAll('tr'));
        let currentRows = [...originalRows];

        let currentPage = 1;
        let pageSize = 10;
        let sortColIndex = -1;
        let sortAsc = true;
        let sortType = 'string';

        const searchInput = document.querySelector('.search-bar input');
        const pageSizeSelect = document.querySelector('.page-size-select');
        const totalItemsSpan = document.getElementById('total-items');
        const paginationControls = document.querySelector('.pagination-controls');

        function renderTable() {
            const totalItems = currentRows.length;
            const totalPages = Math.ceil(totalItems / pageSize) || 1;

            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const start = (currentPage - 1) * pageSize;
            const end = start + pageSize;
            const pageRows = currentRows.slice(start, end);

            tbody.innerHTML = '';
            pageRows.forEach((row) => tbody.appendChild(row));

            if (totalItemsSpan) totalItemsSpan.textContent = String(totalItems);
            renderPaginationControls(totalPages);
        }

        function renderPaginationControls(totalPages) {
            if (!paginationControls) return;
            paginationControls.innerHTML = '';

            const prevBtn = document.createElement('button');
            prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            prevBtn.disabled = currentPage === 1;
            prevBtn.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage -= 1;
                    renderTable();
                }
            });
            paginationControls.appendChild(prevBtn);

            let startPage = Math.max(1, currentPage - 2);
            let endPage = Math.min(totalPages, startPage + 4);

            if (endPage - startPage < 4) {
                startPage = Math.max(1, endPage - 4);
            }

            for (let i = startPage; i <= endPage; i += 1) {
                const btn = document.createElement('button');
                btn.textContent = String(i);
                if (i === currentPage) btn.classList.add('active');
                btn.addEventListener('click', () => {
                    currentPage = i;
                    renderTable();
                });
                paginationControls.appendChild(btn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.disabled = currentPage === totalPages;
            nextBtn.addEventListener('click', () => {
                if (currentPage < totalPages) {
                    currentPage += 1;
                    renderTable();
                }
            });
            paginationControls.appendChild(nextBtn);
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                currentRows = originalRows.filter((row) => row.textContent.toLowerCase().includes(term));
                if (sortColIndex !== -1) {
                    sortRows();
                }
                currentPage = 1;
                renderTable();
            });
        }

        const headers = document.querySelectorAll('.data-table th[data-sort]');
        headers.forEach((header) => {
            header.addEventListener('click', () => {
                const type = header.getAttribute('data-sort');
                const colIndex = Array.from(header.parentNode.children).indexOf(header);

                if (sortColIndex === colIndex) {
                    sortAsc = !sortAsc;
                } else {
                    sortColIndex = colIndex;
                    sortAsc = true;
                    sortType = type;
                }

                headers.forEach((h) => h.classList.remove('asc', 'desc'));
                header.classList.toggle('asc', sortAsc);
                header.classList.toggle('desc', !sortAsc);

                sortRows();
                renderTable();
            });
        });

        function sortRows() {
            currentRows.sort((a, b) => {
                const aCell = a.children[sortColIndex].textContent.trim();
                const bCell = b.children[sortColIndex].textContent.trim();

                let valA;
                let valB;

                if (sortType === 'number') {
                    valA = parseFloat(aCell.replace(/,/g, '')) || 0;
                    valB = parseFloat(bCell.replace(/,/g, '')) || 0;
                } else if (sortType === 'date') {
                    valA = new Date(aCell).getTime();
                    valB = new Date(bCell).getTime();
                } else {
                    valA = aCell.toLowerCase();
                    valB = bCell.toLowerCase();
                }

                if (valA < valB) return sortAsc ? -1 : 1;
                if (valA > valB) return sortAsc ? 1 : -1;
                return 0;
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                pageSize = parseInt(e.target.value, 10);
                currentPage = 1;
                renderTable();
            });
        }

        renderTable();
    }

    // resolveInitialPage chooses the page restored after a full refresh.
    const resolveInitialPage = () => {
        const persistedPage = readPersistedCurrentPage();
        if (isSupportedDashboardPage(persistedPage)) {
            return persistedPage;
        }
        return 'model-management';
    };

    // Initial Load
    applyCurrentUserProfile();
    loadPage(resolveInitialPage());

    // Handle Navigation
    navItems.forEach((item) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            const page = item.getAttribute('data-page');

            if (page) {
                loadPage(page);
            }
        });
    });

    // Toggle Submenu
    const navGroups = document.querySelectorAll('.nav-group .has-submenu');
    navGroups.forEach((group) => {
        group.addEventListener('click', () => {
            const submenu = group.nextElementSibling;
            const arrow = group.querySelector('.arrow');
            if (submenu) {
                const isVisible = submenu.style.display === 'block';
                submenu.style.display = isVisible ? 'none' : 'block';
                arrow.style.transform = isVisible ? 'rotate(-90deg)' : 'rotate(0deg)';
            }
        });
    });

    // Global Event Delegation for Dynamic Content
    document.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.action-toggle');

        if (toggleBtn) {
            const wrapper = toggleBtn.closest('.action-wrapper');

            document.querySelectorAll('.action-wrapper.expanded').forEach((w) => {
                if (w !== wrapper) w.classList.remove('expanded');
            });

            if (wrapper) {
                wrapper.classList.toggle('expanded');
            }
            return;
        }

        if (!e.target.closest('.action-wrapper')) {
            document.querySelectorAll('.action-wrapper.expanded').forEach((w) => {
                w.classList.remove('expanded');
            });
        }
    });

    // ==================== SRT Generation Page ====================
    function initSRTGenerationPage() {
        const table = document.querySelector('[data-srt-table]');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const searchInput = document.querySelector('[data-srt-search-input]');
        const searchBtn = document.querySelector('[data-srt-search-btn]');
        const refreshBtn = document.querySelector('[data-srt-refresh-btn]');
        const pageSizeSelect = document.querySelector('[data-srt-page-size]');
        const totalItemsEl = document.querySelector('[data-srt-total-items]');
        const paginationControls = document.querySelector('[data-srt-pagination]');
        const messageSlot = document.querySelector('[data-srt-message]');

        const state = {
            page: 1,
            pageSize: Number(pageSizeSelect && pageSizeSelect.value) || 10,
            keyword: '',
            total: 0,
            rows: [],
            loading: false,
        };

        let searchTimer = null;

        const setLoadingState = (loading) => {
            state.loading = loading;
            [searchInput, searchBtn, refreshBtn, pageSizeSelect].forEach((el) => {
                if (el) el.disabled = loading;
            });
        };

        const renderPlaceholderRow = (message) => {
            tbody.innerHTML = `<tr><td colspan="5" class="table-state">${escapeHtml(message)}</td></tr>`;
        };

        const renderSRTStatus = (video) => {
            if (video.srt_completed) {
                return '<span class="badge badge-success">已完成</span>';
            }
            if (video.srt_status === 'processing') {
                return '<span class="badge badge-warning">处理中...</span>';
            }
            if (video.srt_status === 'failed') {
                return '<span class="badge badge-error">失败</span>';
            }
            return '<span class="badge badge-muted">未生成</span>';
        };

        const renderSlotStatus = (video) => {
            if (video.slot_filling_completed) {
                return '<span class="badge badge-success">已完成</span>';
            }
            if (video.srt_completed && video.frame_capture_completed) {
                return '<span class="badge badge-info">可填充</span>';
            }
            return '<span class="badge badge-muted">待满足条件</span>';
        };

        const renderRows = () => {
            if (!Array.isArray(state.rows) || state.rows.length === 0) {
                renderPlaceholderRow('暂无视频数据');
                return;
            }

            tbody.innerHTML = state.rows.map((video) => {
                const id = Number(video.id) || 0;
                const title = escapeHtml(video.name || '--');
                const originalFileName = escapeHtml(video.original_file_name || video.file_name || '--');
                const durationText = escapeHtml(formatDuration(video.duration_seconds));
                const srtStatus = renderSRTStatus(video);
                const slotStatus = renderSlotStatus(video);
                const canGenerateSRT = !video.srt_completed && video.srt_status !== 'processing';
                const canFillSlots = video.srt_completed && video.frame_capture_completed && !video.slot_filling_completed;
                const srtDownloadUrl = video.srt_download_url || '';
                const slotDownloadUrl = video.slot_download_url || '';

                return `
                    <tr data-srt-row-id="${id}">
                        <td>
                            <div class="video-listing">
                                <div class="video-copy">
                                    <div class="video-name">${title}</div>
                                    <div class="video-file-name">${originalFileName}</div>
                                </div>
                            </div>
                        </td>
                        <td>${durationText}</td>
                        <td>${srtStatus}</td>
                        <td>${slotStatus}</td>
                        <td>
                            <div class="video-row-actions">
                                ${canGenerateSRT ? `<button class="btn btn-primary btn-sm" data-srt-action="generate" data-srt-id="${id}">
                                    <i class="fa-solid fa-closed-captioning"></i> 生成SRT
                                </button>` : ''}
                                ${canFillSlots ? `<button class="btn btn-secondary btn-sm" data-srt-action="fill-slots" data-srt-id="${id}">
                                    <i class="fa-solid fa-puzzle-piece"></i> 槽位填充
                                </button>` : ''}
                                ${srtDownloadUrl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(srtDownloadUrl)}" download>
                                    <i class="fa-solid fa-download"></i> SRT
                                </a>` : ''}
                                ${slotDownloadUrl ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(slotDownloadUrl)}" download>
                                    <i class="fa-solid fa-download"></i> 槽位
                                </a>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        };

        const renderPaginationControls = () => {
            if (!paginationControls) return;
            const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
            if (state.page > totalPages) state.page = totalPages;
            paginationControls.innerHTML = '';

            const prevBtn = document.createElement('button');
            prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            prevBtn.disabled = state.page <= 1 || state.loading;
            prevBtn.addEventListener('click', () => {
                if (state.page <= 1) return;
                state.page -= 1;
                fetchSRTVideos();
            });
            paginationControls.appendChild(prevBtn);

            let startPage = Math.max(1, state.page - 2);
            let endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) {
                startPage = Math.max(1, endPage - 4);
            }

            for (let i = startPage; i <= endPage; i += 1) {
                const btn = document.createElement('button');
                btn.textContent = String(i);
                if (i === state.page) btn.classList.add('active');
                btn.disabled = state.loading;
                btn.addEventListener('click', () => {
                    if (state.page === i) return;
                    state.page = i;
                    fetchSRTVideos();
                });
                paginationControls.appendChild(btn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.disabled = state.page >= totalPages || state.loading;
            nextBtn.addEventListener('click', () => {
                if (state.page >= totalPages) return;
                state.page += 1;
                fetchSRTVideos();
            });
            paginationControls.appendChild(nextBtn);
        };

        async function fetchSRTVideos() {
            setLoadingState(true);
            renderPaginationControls();
            renderPlaceholderRow('视频列表加载中...');
            clearAlert(messageSlot);

            try {
                const data = await apiRequest('/videos', {
                    query: {
                        page: state.page,
                        page_size: state.pageSize,
                        keyword: state.keyword,
                    },
                });
                const list = Array.isArray(data && data.list) ? data.list : [];
                const total = Number(data && data.total);
                state.rows = list;
                state.total = Number.isFinite(total) ? total : list.length;
                renderRows();
                renderPaginationControls();
                if (totalItemsEl) totalItemsEl.textContent = String(state.total);
            } catch (error) {
                state.rows = [];
                state.total = 0;
                renderPlaceholderRow('视频数据加载失败');
                renderPaginationControls();
                if (totalItemsEl) totalItemsEl.textContent = '0';
                showAlert(messageSlot, `加载视频失败: ${error.message}`, 'error');
            } finally {
                setLoadingState(false);
                renderPaginationControls();
            }
        }

        const applySearch = () => {
            state.keyword = String(searchInput && searchInput.value || '').trim();
            state.page = 1;
            fetchSRTVideos();
        };

        if (searchBtn) {
            searchBtn.addEventListener('click', applySearch);
        }
        if (searchInput) {
            searchInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') applySearch();
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                fetchSRTVideos();
            });
        }
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', () => {
                state.pageSize = Number(pageSizeSelect.value) || 10;
                state.page = 1;
                fetchSRTVideos();
            });
        }

        // Delegate click events for SRT actions
        document.addEventListener('click', async (e) => {
            const generateBtn = e.target.closest('[data-srt-action="generate"]');
            if (generateBtn) {
                const videoId = generateBtn.getAttribute('data-srt-id');
                if (!videoId) return;
                generateBtn.disabled = true;
                generateBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';
                try {
                    await apiRequest(`/videos/${videoId}/srt/generate`, { method: 'POST' });
                    showAlert(messageSlot, 'SRT 生成成功！', 'success');
                } catch (error) {
                    showAlert(messageSlot, `SRT 生成失败: ${error.message}`, 'error');
                } finally {
                    fetchSRTVideos();
                }
                return;
            }

            const fillSlotsBtn = e.target.closest('[data-srt-action="fill-slots"]');
            if (fillSlotsBtn) {
                const videoId = fillSlotsBtn.getAttribute('data-srt-id');
                if (!videoId) return;
                fillSlotsBtn.disabled = true;
                fillSlotsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 填充中...';
                try {
                    const result = await apiRequest(`/videos/${videoId}/srt/fill-slots`, {
                        method: 'POST',
                        body: JSON.stringify({}),
                    });
                    const filledCount = result && result.slot_count ? result.slot_count : 0;
                    showAlert(messageSlot, `槽位填充成功！共匹配 ${filledCount} 张图片`, 'success');
                } catch (error) {
                    showAlert(messageSlot, `槽位填充失败: ${error.message}`, 'error');
                } finally {
                    fetchSRTVideos();
                }
                return;
            }
        });

        fetchSRTVideos();
    }
});
