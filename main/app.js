function bootstrapApp() {
    const mainContent = document.getElementById('main-content');
    const navItems = document.querySelectorAll('.nav-item:not(.has-submenu)');

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

    const TASK_TYPE_MAP = {
        detect: '检测 (Detection)',
        segment: '分割 (Segmentation)',
        classify: '分类 (Classification)',
        pose: '姿态 (Pose)',
        obb: 'OBB',
    };

    const DEFAULT_STORAGE_SERVER_OPTIONS = [
        { value: 'backend', label: '本地存储' },
        { value: 'baidu_network', label: '百度网盘' },
    ];

    const BAIDU_STORAGE_SERVER_VALUES = (() => {
        const configured = window.APP_CONFIG && window.APP_CONFIG.BAIDU_STORAGE_SERVER_VALUES;
        const source = Array.isArray(configured) ? configured : ['baidu_netdisk', 'baidu_network'];
        const normalized = source
            .map((item) => String(item || '').trim().toLowerCase())
            .filter(Boolean);
        if (!normalized.includes('baidu_netdisk')) {
            normalized.push('baidu_netdisk');
        }
        if (!normalized.includes('baidu_network')) {
            normalized.push('baidu_network');
        }
        return new Set(normalized);
    })();

    let storageServerOptionsCache = null;
    let coreServerRecordsCache = null;
    let modelPickerRowsCache = null;
    let modelPickerRowsLoadingPromise = null;
    const pageHtmlCache = new Map();
    const pageModuleCache = new Map();
    const pageStyleLinkCache = new Map();
    const pageStyleLoadPromiseCache = new Map();
    let pageLoadSeq = 0;

    const PAGE_RESOURCE_MANIFEST = {
        'model-management': {
            styles: ['styles/pages/model-management.css'],
            module: './page-modules/model-management.js',
            exportName: 'initModelManagementPage',
        },
        'dataset-management': {
            styles: ['styles/pages/dataset-management.css'],
            module: './page-modules/dataset-management.js',
            exportName: 'initDatasetManagementPage',
        },
        'training-results': {
            styles: ['styles/pages/training-results.css'],
            module: './page-modules/training-results.js',
            exportName: 'initTrainingResultsPage',
        },
        'model-training': {
            styles: ['styles/pages/model-training.css'],
        },
        'model-validation': {
            styles: ['styles/pages/model-validation.css'],
        },
        'model-inference': {
            styles: ['styles/pages/model-inference.css'],
        },
        'extension-tools': {
            styles: ['styles/pages/extension-tools.css'],
            module: './page-modules/extension-tools.js',
            exportName: 'initExtensionToolsPage',
        },
        'coming-soon': {
            styles: ['styles/pages/coming-soon.css'],
        },
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
    const stripTrailingHashFromBaseName = (baseName) => {
        const text = String(baseName || '').trim();
        if (!text) return '';
        return text.replace(/_[a-f0-9]{8,}$/i, '');
    };

    const stripTrailingHashFromWeightName = (weightName) => {
        const text = String(weightName || '').trim();
        if (!text) return '';
        return text.replace(/_[a-f0-9]{8,}(?=\.[^.]+$)/i, '');
    };

    const suggestModelNameFromWeightFile = (filename) => {
        const noExt = trimExtension(filename);
        const noHash = stripTrailingHashFromBaseName(noExt);
        return noHash.replace(/_v?\d+(?:\.\d+)*$/i, '');
    };

    const getFileExtension = (filename) => {
        const text = String(filename || '').trim();
        if (!text) return '';
        const idx = text.lastIndexOf('.');
        if (idx <= 0 || idx === text.length - 1) return '';
        return text.slice(idx).toLowerCase();
    };

    const isTruthyFlag = (value) => {
        if (typeof value === 'boolean') return value;
        const text = String(value || '').trim().toLowerCase();
        return text === '1' || text === 'true' || text === 't' || text === 'yes' || text === 'y';
    };

    const shouldUploadToBaidu = (storageServer) => {
        const value = String(storageServer || '').trim().toLowerCase();
        if (!value) return false;
        if (value === '百度网盘' || value === 'baidu netdisk') return true;
        if (BAIDU_STORAGE_SERVER_VALUES.has(value)) return true;
        return value.includes('baidu');
    };

    const normalizeStorageServerValue = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        if (
            raw === '本地存储'
            || raw === 'local storage'
            || raw === 'local_storage'
            || raw === 'local-storage'
        ) {
            return 'backend';
        }
        if (raw === '百度网盘') return 'baidu_netdisk';
        if (shouldUploadToBaidu(raw)) return 'baidu_netdisk';
        if (raw === 'local' || raw === 'localhost') return 'backend';
        return raw;
    };

    const isRemoteCoreStorageServer = (value) => {
        const normalized = normalizeStorageServerValue(value);
        return Boolean(normalized && normalized !== 'backend' && normalized !== 'baidu_netdisk');
    };

    const resolveModelUploadRoute = (storageServer, {
        syncBaiduWhenRemote = false,
    } = {}) => {
        const requestRemoteCoreUpload = isRemoteCoreStorageServer(storageServer);
        const requestBaiduUpload = shouldUploadToBaidu(storageServer)
            || (requestRemoteCoreUpload && Boolean(syncBaiduWhenRemote));
        return {
            requestRemoteCoreUpload,
            requestBaiduUpload,
        };
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
            values.push('baidu_netdisk');
        }

        if (!values.length) {
            values.push('backend');
        }

        return uniqueStorageServers(values);
    };

    const formatStorageServerLabel = (value) => {
        const normalized = normalizeStorageServerValue(value);
        if (normalized === 'backend') return '本地存储';
        if (normalized === 'baidu_netdisk') return '百度网盘';
        return normalized || '--';
    };

    const getCoreServerStateInfo = (stateValue) => {
        const normalized = String(stateValue || '').trim().toLowerCase();
        if (normalized === 'active') {
            return { key: 'active', label: '运行中' };
        }
        if (normalized === 'inactive') {
            return { key: 'inactive', label: '已停用' };
        }
        return { key: 'unknown', label: '未知' };
    };

    const normalizeCoreServerRecords = (source) => {
        if (!Array.isArray(source)) return [];

        const result = [];
        source.forEach((item) => {
            if (typeof item === 'string') {
                const keyText = String(item || '').trim();
                if (!keyText) return;
                result.push({
                    key: normalizeStorageServerValue(keyText) || keyText,
                    rawKey: keyText,
                    displayName: formatStorageServerLabel(keyText),
                    state: 'unknown',
                    ip: '',
                    port: '',
                });
                return;
            }

            if (!item || typeof item !== 'object') return;

            const rawKey = String(
                item.key
                || item.Key
                || item.name
                || item.Name
                || item.value
                || item.id
                || item.ID
                || '',
            ).trim();
            if (!rawKey) return;

            const key = normalizeStorageServerValue(rawKey) || rawKey;
            const state = getCoreServerStateInfo(item.state || item.State).key;
            const ipRaw = String(item.ip || item.IP || '').trim();
            const portRaw = item.port == null
                ? (item.Port == null ? '' : String(item.Port).trim())
                : String(item.port).trim();

            result.push({
                key,
                rawKey,
                displayName: formatStorageServerLabel(rawKey),
                state,
                ip: /^unknown$/i.test(ipRaw) ? '' : ipRaw,
                port: /^unknown$/i.test(portRaw) ? '' : portRaw,
            });
        });

        const seen = new Set();
        return result.filter((item) => {
            if (!item || !item.key) return false;
            if (seen.has(item.key)) return false;
            seen.add(item.key);
            return true;
        });
    };

    const parseStorageServers = (...sources) => {
        const values = [];
        const appendCsvText = (text) => {
            String(text || '')
                .split(/[,\n，;；]+/g)
                .map((item) => item.trim())
                .filter(Boolean)
                .forEach((item) => {
                    values.push(item);
                });
        };
        const appendSource = (source) => {
            if (Array.isArray(source)) {
                source.forEach((item) => appendSource(item));
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
                            parsed.forEach((item) => appendSource(item));
                            return;
                        }
                    } catch (error) {
                        // Ignore JSON parse errors and treat as plain string.
                    }
                }
                appendCsvText(text);
                return;
            }
            values.push(source);
        };

        sources.forEach((source) => {
            appendSource(source);
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

    const resolveModelWeightFileName = (model) => {
        const candidates = [
            model && model.weight_name,
            model && model.file_name,
            model && model.model_path,
            model && model.weight_path,
            model && model.weightPath,
        ];

        for (let i = 0; i < candidates.length; i += 1) {
            const raw = String(candidates[i] || '').trim();
            if (!raw) continue;
            const normalized = raw.includes('/') || raw.includes('\\')
                ? getPathFileName(raw.replace(/\\/g, '/'))
                : raw;
            if (normalized) return normalized;
        }
        return '';
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

    const BAIDU_MODEL_REMOTE_DIR = '/project/luckyProject/weights';
    const BAIDU_DATASET_REMOTE_DIR = '/project/luckyProject/datasets';

    const buildBaiduRemotePathForModel = (model = {}) => {
        const modelPath = String(model && model.model_path || '').trim();
        if (modelPath && modelPath.toLowerCase().includes('/project/luckyproject/')) {
            return modelPath;
        }

        const weightFileName = resolveModelWeightFileName(model);
        if (!weightFileName) {
            return BAIDU_MODEL_REMOTE_DIR;
        }
        return `${BAIDU_MODEL_REMOTE_DIR}/${weightFileName}`;
    };

    const resolveDatasetFileName = (dataset = {}) => {
        const candidates = [
            dataset && dataset.file_name,
            dataset && dataset.dataset_file_name,
            dataset && dataset.filename,
            dataset && dataset.dataset_path,
            dataset && dataset.path,
        ];
        for (let i = 0; i < candidates.length; i += 1) {
            const raw = String(candidates[i] || '').trim();
            if (!raw) continue;
            const normalized = raw.includes('/') || raw.includes('\\')
                ? getPathFileName(raw.replace(/\\/g, '/'))
                : raw;
            if (normalized) return normalized;
        }
        return '';
    };

    const buildBaiduRemotePathForDataset = (dataset = {}) => {
        const datasetPath = String(dataset && dataset.dataset_path || '').trim();
        if (datasetPath && datasetPath.toLowerCase().includes('/project/luckyproject/')) {
            return datasetPath;
        }
        const fileName = resolveDatasetFileName(dataset);
        if (!fileName) {
            return BAIDU_DATASET_REMOTE_DIR;
        }
        return `${BAIDU_DATASET_REMOTE_DIR}/${fileName}`;
    };

    const getStorageSyncDirection = (sourceStorage, targetStorage) => {
        const source = normalizeStorageServerValue(sourceStorage);
        const target = normalizeStorageServerValue(targetStorage);
        if (!source || !target || source === target) return '';
        if (source === 'backend' && target !== 'backend') return 'upload';
        if (source !== 'backend' && target === 'backend') return 'download';
        return '';
    };

    async function uploadModelFromBackendToStorage({
        modelId,
        targetStorage,
        fallbackFileName = '',
        subdir = '',
    } = {}) {
        const rawTarget = String(targetStorage || '').trim();
        const normalizedTarget = normalizeStorageServerValue(rawTarget);
        if (!normalizedTarget || normalizedTarget === 'backend') {
            throw new Error('目标存储必须是远端/网盘。');
        }
        const requestStorageServer = isRemoteCoreStorageServer(normalizedTarget)
            ? (rawTarget || normalizedTarget)
            : normalizedTarget;

        const { blob, fileName } = await fetchModelBlobById(modelId, fallbackFileName);
        const safeFileName = String(fileName || fallbackFileName || `model-${modelId}`).trim() || `model-${modelId}`;
        const file = new File([blob], safeFileName, {
            type: blob.type || 'application/octet-stream',
            lastModified: Date.now(),
        });

        return uploadFileViaApi('/models/upload', {
            file,
            targetFileName: safeFileName,
            storageServer: requestStorageServer,
            subdir: String(subdir || '').trim() || ((window.APP_CONFIG && window.APP_CONFIG.MODEL_UPLOAD_SUBDIR) || 'web-models'),
            uploadToBaidu: shouldUploadToBaidu(normalizedTarget),
        });
    }

    async function uploadDatasetFromBackendToStorage({
        datasetId,
        targetStorage,
        fallbackFileName = '',
        subdir = '',
    } = {}) {
        const rawTarget = String(targetStorage || '').trim();
        const normalizedTarget = normalizeStorageServerValue(rawTarget);
        if (!normalizedTarget || normalizedTarget === 'backend') {
            throw new Error('目标存储必须是远端/网盘。');
        }
        const requestStorageServer = isRemoteCoreStorageServer(normalizedTarget)
            ? (rawTarget || normalizedTarget)
            : normalizedTarget;

        const { blob, fileName } = await fetchDatasetBlobById(datasetId, fallbackFileName);
        const safeFileName = String(fileName || fallbackFileName || `dataset-${datasetId}`).trim() || `dataset-${datasetId}`;
        const file = new File([blob], safeFileName, {
            type: blob.type || 'application/octet-stream',
            lastModified: Date.now(),
        });

        return uploadFileViaApi('/datasets/upload', {
            file,
            targetFileName: safeFileName,
            storageServer: requestStorageServer,
            subdir: String(subdir || '').trim() || ((window.APP_CONFIG && window.APP_CONFIG.DATASET_UPLOAD_SUBDIR) || 'web-datasets'),
            uploadToBaidu: shouldUploadToBaidu(normalizedTarget),
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

    const formatVersionAsSingleDecimal = (value) => {
        const text = String(value || '').trim();
        if (!text) return '';
        const normalized = text.replace(',', '.').replace(/^v/i, '').trim();
        if (!/^\d+(?:\.\d+)?$/.test(normalized)) return '';

        const num = Number(normalized);
        if (!Number.isFinite(num) || num <= 0) return '';
        return num.toFixed(1);
    };

    const normalizeWeightBaseName = (value) => {
        const text = String(value || '').trim();
        if (!text) return '';
        const normalized = text
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^-+|-+$/g, '');
        return stripTrailingHashFromBaseName(normalized);
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
                ...headers,
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
                throw new Error(message);
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

    async function fetchCoreServerRecords({
        force = false,
    } = {}) {
        if (!force && Array.isArray(coreServerRecordsCache)) {
            return coreServerRecordsCache;
        }

        const coreServerEndpoint = String(
            (window.APP_CONFIG && window.APP_CONFIG.CORE_SERVERS_API)
            || '/core-servers',
        ).trim();
        if (!coreServerEndpoint) {
            coreServerRecordsCache = [];
            return coreServerRecordsCache;
        }

        const data = await apiRequest(coreServerEndpoint, { method: 'GET' });
        const rawList = Array.isArray(data)
            ? data
            : (
                (data && Array.isArray(data.list) && data.list)
                || (data && Array.isArray(data.options) && data.options)
                || (data && Array.isArray(data.data) && data.data)
                || []
            );
        coreServerRecordsCache = normalizeCoreServerRecords(rawList);
        return coreServerRecordsCache;
    }

    const parseModelVersionValue = (model) => {
        const direct = parseVersionAsNumber(model && model.version);
        if (Number.isFinite(direct) && direct > 0) return direct;

        const nameText = String(model && model.name || '').trim();
        const match = nameText.match(/_+v?(\d+(?:\.\d+)*)$/i);
        if (!match || !match[1]) return NaN;

        const fromName = parseVersionAsNumber(match[1]);
        return Number.isFinite(fromName) && fromName > 0 ? fromName : NaN;
    };

    const formatModelVersionLabel = (model) => {
        const rawVersion = String(model && model.version || '').trim();
        if (rawVersion) {
            return rawVersion.replace(/^v/i, '');
        }
        const parsed = parseModelVersionValue(model);
        if (!Number.isFinite(parsed) || parsed <= 0) return '--';
        if (Number.isInteger(parsed)) return parsed.toFixed(1);
        return String(parsed);
    };

    const formatModelPickerDisplay = (model) => {
        const id = Number(model && model.id);
        const safeID = Number.isInteger(id) && id > 0 ? String(id) : '--';
        const name = String(model && model.name || '').trim() || `model-${safeID}`;
        const versionText = formatModelVersionLabel(model);
        return `${name} (ID:${safeID}, version ${versionText})`;
    };

    const pickLatestModel = (items = []) => {
        if (!Array.isArray(items) || !items.length) return null;
        return items.reduce((best, current) => {
            if (!best) return current;
            const bestVersion = parseModelVersionValue(best);
            const currentVersion = parseModelVersionValue(current);
            const currentID = Number(current && current.id);
            const bestID = Number(best && best.id);

            if (Number.isFinite(currentVersion) && !Number.isFinite(bestVersion)) return current;
            if (
                Number.isFinite(currentVersion)
                && Number.isFinite(bestVersion)
                && currentVersion > bestVersion
            ) {
                return current;
            }
            if (
                Number.isFinite(currentVersion)
                && Number.isFinite(bestVersion)
                && currentVersion === bestVersion
                && Number.isInteger(currentID)
                && Number.isInteger(bestID)
                && currentID > bestID
            ) {
                return current;
            }
            if (
                !Number.isFinite(currentVersion)
                && !Number.isFinite(bestVersion)
                && Number.isInteger(currentID)
                && Number.isInteger(bestID)
                && currentID > bestID
            ) {
                return current;
            }
            return best;
        }, null);
    };

    const setPickerHint = (hintEl, message, tone = 'info') => {
        if (!hintEl) return;
        hintEl.textContent = String(message || '').trim();
        hintEl.classList.remove('error', 'success');
        if (tone === 'error' || tone === 'success') {
            hintEl.classList.add(tone);
        }
    };

    async function loadModelsForPicker({
        force = false,
    } = {}) {
        if (!force && Array.isArray(modelPickerRowsCache) && modelPickerRowsCache.length) {
            return modelPickerRowsCache;
        }

        if (!force && modelPickerRowsLoadingPromise) {
            return modelPickerRowsLoadingPromise;
        }

        modelPickerRowsLoadingPromise = (async () => {
            const pageSize = 200;
            const maxPages = 20;
            const allRows = [];
            let total = Infinity;

            for (let page = 1; page <= maxPages; page += 1) {
                const data = await apiRequest('/models', {
                    query: {
                        page,
                        page_size: pageSize,
                    },
                });
                const list = Array.isArray(data && data.list) ? data.list : [];
                const fetchedTotal = Number(data && data.total);
                if (Number.isFinite(fetchedTotal) && fetchedTotal >= 0) {
                    total = fetchedTotal;
                }

                allRows.push(...list);
                if (!list.length || list.length < pageSize || allRows.length >= total) {
                    break;
                }
            }

            const dedupRows = [];
            const seenIDs = new Set();
            allRows.forEach((item) => {
                const id = Number(item && item.id);
                if (Number.isInteger(id) && id > 0) {
                    if (seenIDs.has(id)) return;
                    seenIDs.add(id);
                }
                dedupRows.push(item);
            });

            modelPickerRowsCache = dedupRows;
            return dedupRows;
        })();

        try {
            return await modelPickerRowsLoadingPromise;
        } finally {
            modelPickerRowsLoadingPromise = null;
        }
    }

    const resolveModelByPickerInput = (text, rows = []) => {
        const raw = String(text || '').trim();
        if (!raw) return null;

        const idMatch = raw.match(/(?:^#?(\d+)$|id\s*[:#]?\s*(\d+)|#(\d+))/i);
        const idText = idMatch
            ? (idMatch[1] || idMatch[2] || idMatch[3] || '')
            : '';
        if (idText) {
            const targetID = Number(idText);
            const byID = rows.find((item) => Number(item && item.id) === targetID);
            if (byID) return byID;
        }

        const lower = raw.toLowerCase();
        const exactDisplay = rows.find((item) => formatModelPickerDisplay(item).toLowerCase() === lower);
        if (exactDisplay) return exactDisplay;

        const exactNameList = rows.filter((item) => String(item && item.name || '').trim().toLowerCase() === lower);
        if (exactNameList.length) {
            return pickLatestModel(exactNameList);
        }

        const fuzzyList = rows.filter((item) => {
            const name = String(item && item.name || '').trim().toLowerCase();
            if (!name) return false;
            return name.includes(lower);
        });
        if (fuzzyList.length === 1) {
            return fuzzyList[0];
        }
        return null;
    };

    async function bindModelPicker({
        inputEl,
        datalistEl,
        hiddenIDEl,
        hintEl,
        defaultHint = '',
        forceRefresh = false,
    } = {}) {
        if (!inputEl || !datalistEl || !hiddenIDEl) return;

        const safeHint = String(defaultHint || '').trim();
        setPickerHint(hintEl, '正在加载模型列表...');

        try {
            const rows = await loadModelsForPicker({ force: forceRefresh });
            datalistEl.innerHTML = '';
            rows.forEach((item) => {
                const option = document.createElement('option');
                option.value = formatModelPickerDisplay(item);
                datalistEl.appendChild(option);
            });

            const applySelection = () => {
                const currentText = String(inputEl.value || '').trim();
                if (!currentText) {
                    hiddenIDEl.value = '';
                    setPickerHint(hintEl, safeHint || '支持输入模型名称或 ID。');
                    return;
                }

                const matched = resolveModelByPickerInput(currentText, rows);
                if (!matched) {
                    hiddenIDEl.value = '';
                    setPickerHint(hintEl, '未匹配到模型，请输入精确模型名称或 ID。', 'error');
                    return;
                }

                const id = Number(matched && matched.id);
                hiddenIDEl.value = Number.isInteger(id) && id > 0 ? String(id) : '';
                inputEl.value = formatModelPickerDisplay(matched);
                setPickerHint(hintEl, `已选中：${inputEl.value}`, 'success');
            };

            inputEl.addEventListener('change', applySelection);
            inputEl.addEventListener('blur', applySelection);
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applySelection();
                }
            });

            if (String(inputEl.value || '').trim()) {
                applySelection();
            } else {
                setPickerHint(hintEl, safeHint || `已加载 ${rows.length} 个模型，可输入名称或 ID。`);
            }
        } catch (error) {
            hiddenIDEl.value = '';
            setPickerHint(hintEl, `模型列表加载失败：${error.message}`, 'error');
        }
    }

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

    async function fetchModelBlobById(modelId, fallbackName = '') {
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
                },
                credentials: 'include',
                signal: controller.signal,
            });

            if (!res.ok) {
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
            return { blob, fileName: safeName };
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('下载超时，请检查后端服务状态。');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    async function downloadModelFileById(modelId, fallbackName = '') {
        try {
            const { blob, fileName } = await fetchModelBlobById(modelId, fallbackName);

            const objectUrl = URL.createObjectURL(blob);
            try {
                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                link.remove();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch (error) {
            throw error;
        }
    }

    async function fetchDatasetBlobById(datasetId, fallbackName = '') {
        const id = Number(datasetId);
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error('无效数据集 ID');
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = `${apiBaseUrl}/datasets/${id}/download`;
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: '*/*',
                },
                credentials: 'include',
                signal: controller.signal,
            });

            if (!res.ok) {
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
            const safeName = String(fromHeader || fallbackName || `dataset-${id}`).trim() || `dataset-${id}`;
            return { blob, fileName: safeName };
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('下载超时，请检查后端服务状态。');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    async function downloadDatasetFileById(datasetId, fallbackName = '') {
        try {
            const { blob, fileName } = await fetchDatasetBlobById(datasetId, fallbackName);

            const objectUrl = URL.createObjectURL(blob);
            try {
                const link = document.createElement('a');
                link.href = objectUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                link.remove();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch (error) {
            throw error;
        }
    }

    const normalizeStorageOptions = (source) => {
        if (!Array.isArray(source)) return [];
        const result = [];
        source.forEach((item) => {
            if (typeof item === 'string') {
                const rawValue = item.trim();
                if (!rawValue) return;
                const normalizedValue = normalizeStorageServerValue(rawValue) || rawValue;
                result.push({ value: normalizedValue, label: rawValue });
                return;
            }
            if (!item || typeof item !== 'object') return;
            const stateText = String(item.state || item.State || '').trim().toLowerCase();
            if (stateText === 'inactive') return;
            const rawValue = String(
                item.value
                || item.id
                || item.ID
                || item.key
                || item.Key
                || item.code
                || item.name
                || item.Name
                || '',
            ).trim();
            if (!rawValue) return;

            const value = normalizeStorageServerValue(rawValue) || rawValue;
            const explicitLabel = String(item.label || item.title || '').trim();
            const fallbackLabel = String(
                item.name
                || item.Name
                || item.key
                || item.Key
                || rawValue,
            ).trim() || rawValue;
            const ipRaw = String(item.ip || item.IP || '').trim();
            const portRaw = item.port == null
                ? (item.Port == null ? '' : String(item.Port).trim())
                : String(item.port).trim();
            const ip = /^unknown$/i.test(ipRaw) ? '' : ipRaw;
            const port = /^unknown$/i.test(portRaw) ? '' : portRaw;
            const addrLabel = ip && port ? `${ip}:${port}` : ip;
            const isCoreServerItem = Boolean(
                item.key
                || item.Key
                || item.name
                || item.Name
                || item.ip
                || item.IP,
            );
            const label = String(
                explicitLabel
                    ? explicitLabel
                    : (isCoreServerItem && addrLabel ? `${fallbackLabel}(${addrLabel})` : fallbackLabel),
            ).trim();
            result.push({ value, label: label || value });
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

    const mergeStorageServerOptions = (...sourceLists) => {
        const merged = [];
        const seen = new Set();

        const appendItems = (items) => {
            if (!Array.isArray(items)) return;
            items.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                const value = String(item.value || '').trim();
                if (!value) return;
                const key = value.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                const label = String(item.label || '').trim() || value;
                merged.push({ value, label });
            });
        };

        appendItems(DEFAULT_STORAGE_SERVER_OPTIONS);
        sourceLists.forEach((items) => appendItems(items));
        return merged;
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

        if (safeSelected) {
            const normalizedSelected = normalizeStorageServerValue(safeSelected);
            if (normalizedSelected) {
                const matched = options.find((item) => (
                    normalizeStorageServerValue(item.value) === normalizedSelected
                ));
                if (matched) {
                    selectEl.value = matched.value;
                    return;
                }
            }
        }

        if (!safeSelected && options.length > 0) {
            selectEl.value = options[0].value;
        }
    };

    async function loadStorageServerOptions({
        force = false,
    } = {}) {
        if (!force && storageServerOptionsCache && storageServerOptionsCache.length) {
            return storageServerOptionsCache;
        }

        if (force) {
            storageServerOptionsCache = null;
        }

        const coreServerEndpoint = String(
            (window.APP_CONFIG && window.APP_CONFIG.CORE_SERVERS_API)
            || '/core-servers',
        ).trim();

        if (coreServerEndpoint) {
            try {
                const data = await apiRequest(coreServerEndpoint, { method: 'GET' });
                const fromCoreServers = normalizeStorageOptions(data);
                if (fromCoreServers.length) {
                    storageServerOptionsCache = mergeStorageServerOptions(fromCoreServers);
                    return storageServerOptionsCache;
                }
            } catch (error) {
                // fall through to other sources
            }
        }

        const endpoint = window.APP_CONFIG && window.APP_CONFIG.STORAGE_SERVER_OPTIONS_API;
        if (typeof endpoint === 'string' && endpoint.trim()) {
            try {
                const data = await apiRequest(endpoint.trim(), { method: 'GET' });
                const list = (data && data.list) || (data && data.options) || (data && data.data) || data;
                const fromApi = normalizeStorageOptions(list);
                if (fromApi.length) {
                    storageServerOptionsCache = mergeStorageServerOptions(fromApi);
                    return storageServerOptionsCache;
                }
            } catch (error) {
                // Fall back to defaults when storage options API is unavailable.
            }
        }

        const fromConfig = getConfiguredStorageOptions();
        if (fromConfig) {
            storageServerOptionsCache = mergeStorageServerOptions(fromConfig);
            return storageServerOptionsCache;
        }

        storageServerOptionsCache = mergeStorageServerOptions();
        return storageServerOptionsCache;
    }

    async function populateStorageServerSelects(root = document, {
        force = false,
    } = {}) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const selects = root.querySelectorAll('[data-storage-server-select]');
        if (!selects || selects.length === 0) return;

        const options = await loadStorageServerOptions({ force });
        selects.forEach((selectEl) => {
            const currentValue = selectEl.value || '';
            setSelectOptions(selectEl, options, {
                placeholder: '请选择存储服务',
                selectedValue: currentValue,
            });
        });
    }

    let uploadRequestSeq = 0;

    async function uploadFileViaApi(endpoint, {
        file,
        storageServer,
        subdir,
        uploadToBaidu = false,
        targetFileName = '',
    }) {
        if (!(file instanceof File)) {
            throw new Error('未选择有效文件');
        }

        let fileToUpload = file;
        const safeTargetFileName = String(targetFileName || '').trim();
        if (safeTargetFileName && safeTargetFileName !== file.name) {
            fileToUpload = new File([file], safeTargetFileName, {
                type: file.type || 'application/octet-stream',
                lastModified: file.lastModified || Date.now(),
            });
        }

        const requestId = `upload-${Date.now()}-${++uploadRequestSeq}`;
        const logPrefix = `[LuckyFront][Upload][${requestId}]`;
        const requestRemoteCoreUpload = isRemoteCoreStorageServer(storageServer);
        const requestMeta = {
            endpoint,
            file_name: fileToUpload.name,
            file_size: fileToUpload.size,
            file_type: fileToUpload.type || 'application/octet-stream',
            storage_server: storageServer || '',
            subdir: subdir || '',
            upload_to_baidu: Boolean(uploadToBaidu),
            remote_core_upload: requestRemoteCoreUpload,
            artifact_name: safeTargetFileName || '',
            renamed_from: file.name !== fileToUpload.name ? file.name : '',
        };

        console.info(`${logPrefix} request`, requestMeta);

        const form = new FormData();
        form.append('file', fileToUpload);
        if (subdir) form.append('subdir', subdir);
        if (storageServer) form.append('storage_server', storageServer);
        if (uploadToBaidu) form.append('upload_to_baidu', 'true');
        if (safeTargetFileName) form.append('artifact_name', safeTargetFileName);

        try {
            const response = await apiRequest(endpoint, {
                method: 'POST',
                formData: form,
            });
            console.info(`${logPrefix} response`, response);
            return response;
        } catch (error) {
            console.error(`${logPrefix} failed`, {
                message: error && error.message ? error.message : String(error),
                request: requestMeta,
            });
            throw error;
        }
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
    let datasetMetadataEditModalRefs = null;
    let storageSyncModalRefs = null;
    let dangerConfirmModalRefs = null;

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
                    <span class="property-meta" data-property-meta>0 个字段</span>
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
                            <label for="model-meta-weight-name">权重文件名 <span class="required-mark" aria-hidden="true">*</span></label>
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
                            <input id="model-meta-storage-servers" name="storage_servers" class="form-control" type="text" placeholder="backend, baidu_netdisk" />
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
                    throw new Error('选择“不是基础模型”时，必须填写基础模型ID。');
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

    function ensureDatasetMetadataEditModal() {
        if (datasetMetadataEditModalRefs) return datasetMetadataEditModalRefs;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay dataset-metadata-edit-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="modal-card dataset-metadata-edit-card">
                <div class="modal-header">
                    <h3 data-dataset-metadata-title>编辑数据集元信息</h3>
                    <button class="btn-icon" type="button" data-dataset-metadata-close title="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <p class="modal-subtitle">
                    更新接口：
                    <code>PATCH /v1/datasets/:id</code>
                </p>
                <div class="form-divider"></div>
                <form data-dataset-metadata-form>
                    <div class="form-grid-2">
                        <div class="form-group">
                            <label for="dataset-meta-name">名称 <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="dataset-meta-name" name="name" class="form-control" type="text" required />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-version">版本（可选）</label>
                            <input id="dataset-meta-version" name="version" class="form-control" type="text" placeholder="v1.0.0" />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-task-type">任务类型 <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="dataset-meta-task-type" name="task_type" class="form-control" type="text" required />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-format">数据集格式 <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="dataset-meta-format" name="dataset_format" class="form-control" type="text" required />
                        </div>
                        <div class="form-group form-span-2">
                            <label for="dataset-meta-path">数据集路径 <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="dataset-meta-path" name="dataset_path" class="form-control" type="text" required />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-file-name">文件名 file_name <span class="required-mark" aria-hidden="true">*</span></label>
                            <input id="dataset-meta-file-name" name="file_name" class="form-control" type="text" required />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-size-mb">大小 size_mb（可选）</label>
                            <input id="dataset-meta-size-mb" name="size_mb" class="form-control" type="number" min="0.01" step="0.001" />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-num-classes">类别数 num_classes（可选）</label>
                            <input id="dataset-meta-num-classes" name="num_classes" class="form-control" type="number" min="1" step="1" />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-config-path">配置路径 config_path（可选）</label>
                            <input id="dataset-meta-config-path" name="config_path" class="form-control" type="text" />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-train-count">train_count（可选）</label>
                            <input id="dataset-meta-train-count" name="train_count" class="form-control" type="number" min="0" step="1" />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-val-count">val_count（可选）</label>
                            <input id="dataset-meta-val-count" name="val_count" class="form-control" type="number" min="0" step="1" />
                        </div>
                        <div class="form-group">
                            <label for="dataset-meta-test-count">test_count（可选）</label>
                            <input id="dataset-meta-test-count" name="test_count" class="form-control" type="number" min="0" step="1" />
                        </div>
                        <div class="form-group form-span-2">
                            <label for="dataset-meta-class-names">类别名 class_names（JSON 或逗号分隔）</label>
                            <textarea id="dataset-meta-class-names" name="class_names" class="form-control model-textarea" rows="2" placeholder='["cat","dog"] 或 cat,dog'></textarea>
                        </div>
                        <div class="form-group form-span-2">
                            <label for="dataset-meta-storage-servers">存储服务（逗号分隔）</label>
                            <input id="dataset-meta-storage-servers" name="storage_servers" class="form-control" type="text" placeholder="backend, baidu_netdisk" />
                        </div>
                        <div class="form-group form-span-2">
                            <label for="dataset-meta-description">描述（可选）</label>
                            <textarea id="dataset-meta-description" name="description" class="form-control model-textarea" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="dataset-metadata-edit-feedback alert info" data-dataset-metadata-feedback hidden></div>
                    <div class="form-actions modal-actions">
                        <button class="btn btn-secondary" type="button" data-dataset-metadata-close>取消</button>
                        <button class="btn btn-primary" type="submit">
                            <i class="fa-solid fa-floppy-disk"></i>
                            保存修改
                        </button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        const titleEl = overlay.querySelector('[data-dataset-metadata-title]');
        const formEl = overlay.querySelector('[data-dataset-metadata-form]');
        const feedbackEl = overlay.querySelector('[data-dataset-metadata-feedback]');
        const closeBtns = overlay.querySelectorAll('[data-dataset-metadata-close]');
        const nameInput = overlay.querySelector('#dataset-meta-name');
        const versionInput = overlay.querySelector('#dataset-meta-version');
        const taskTypeInput = overlay.querySelector('#dataset-meta-task-type');
        const formatInput = overlay.querySelector('#dataset-meta-format');
        const pathInput = overlay.querySelector('#dataset-meta-path');
        const fileNameInput = overlay.querySelector('#dataset-meta-file-name');
        const sizeMbInput = overlay.querySelector('#dataset-meta-size-mb');
        const numClassesInput = overlay.querySelector('#dataset-meta-num-classes');
        const configPathInput = overlay.querySelector('#dataset-meta-config-path');
        const trainCountInput = overlay.querySelector('#dataset-meta-train-count');
        const valCountInput = overlay.querySelector('#dataset-meta-val-count');
        const testCountInput = overlay.querySelector('#dataset-meta-test-count');
        const classNamesInput = overlay.querySelector('#dataset-meta-class-names');
        const storageServersInput = overlay.querySelector('#dataset-meta-storage-servers');
        const descriptionInput = overlay.querySelector('#dataset-meta-description');
        let resolver = null;

        const setFeedback = (message, tone = 'info') => {
            if (!feedbackEl) return;
            if (!message) {
                feedbackEl.hidden = true;
                feedbackEl.className = 'dataset-metadata-edit-feedback alert info';
                feedbackEl.textContent = '';
                return;
            }
            feedbackEl.hidden = false;
            feedbackEl.className = `dataset-metadata-edit-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
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

        const parseOptionalNonNegativeInt = (raw, field) => {
            const text = String(raw || '').trim();
            if (!text) return null;
            const num = Number(text);
            if (!Number.isInteger(num) || num < 0) {
                throw new Error(`\`${field}\` 必须是大于等于 0 的整数。`);
            }
            return num;
        };

        const parseOptionalPositiveInt = (raw, field) => {
            const text = String(raw || '').trim();
            if (!text) return null;
            const num = Number(text);
            if (!Number.isInteger(num) || num <= 0) {
                throw new Error(`\`${field}\` 必须是大于 0 的整数。`);
            }
            return num;
        };

        const parseOptionalPositiveFloat = (raw, field) => {
            const text = String(raw || '').trim();
            if (!text) return null;
            const num = Number(text.replace(',', '.'));
            if (!Number.isFinite(num) || num <= 0) {
                throw new Error(`\`${field}\` 必须是大于 0 的数字。`);
            }
            return Number(num.toFixed(3));
        };

        const parseClassNames = (raw) => {
            const text = String(raw || '').trim();
            if (!text) return [];
            if (text.startsWith('[') && text.endsWith(']')) {
                try {
                    const parsed = JSON.parse(text);
                    if (!Array.isArray(parsed)) {
                        throw new Error('`class_names` 不是数组。');
                    }
                    return parsed
                        .map((item) => String(item == null ? '' : item).trim())
                        .filter(Boolean);
                } catch (error) {
                    throw new Error('`class_names` JSON 解析失败，请输入 JSON 数组或逗号分隔文本。');
                }
            }
            return text
                .split(/[\n,，]/g)
                .map((item) => item.trim())
                .filter(Boolean);
        };

        const buildPatchPayload = () => {
            const name = String(nameInput && nameInput.value || '').trim();
            const taskType = String(taskTypeInput && taskTypeInput.value || '').trim();
            const datasetFormat = String(formatInput && formatInput.value || '').trim();
            const datasetPath = String(pathInput && pathInput.value || '').trim();
            const fileName = String(fileNameInput && fileNameInput.value || '').trim();
            if (!name) throw new Error('`name` 不能为空。');
            if (!taskType) throw new Error('`task_type` 不能为空。');
            if (!datasetFormat) throw new Error('`dataset_format` 不能为空。');
            if (!datasetPath) throw new Error('`dataset_path` 不能为空。');
            if (!fileName) throw new Error('`file_name` 不能为空。');

            const payload = {
                name,
                task_type: taskType,
                dataset_format: datasetFormat,
                dataset_path: datasetPath,
                file_name: fileName,
            };

            const version = String(versionInput && versionInput.value || '').trim();
            if (version) payload.version = version;

            const sizeMb = parseOptionalPositiveFloat(sizeMbInput && sizeMbInput.value, 'size_mb');
            if (sizeMb != null) payload.size_mb = sizeMb;

            const numClasses = parseOptionalPositiveInt(numClassesInput && numClassesInput.value, 'num_classes');
            if (numClasses != null) payload.num_classes = numClasses;

            const trainCount = parseOptionalNonNegativeInt(trainCountInput && trainCountInput.value, 'train_count');
            if (trainCount != null) payload.train_count = trainCount;
            const valCount = parseOptionalNonNegativeInt(valCountInput && valCountInput.value, 'val_count');
            if (valCount != null) payload.val_count = valCount;
            const testCount = parseOptionalNonNegativeInt(testCountInput && testCountInput.value, 'test_count');
            if (testCount != null) payload.test_count = testCount;

            const classNames = parseClassNames(classNamesInput && classNamesInput.value);
            if (classNames.length) {
                payload.class_names = classNames;
            }

            payload.config_path = toNullableString(configPathInput && configPathInput.value);
            payload.description = toNullableString(descriptionInput && descriptionInput.value);

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

        datasetMetadataEditModalRefs = {
            open({
                dataset = {},
                title = '',
            } = {}) {
                setFeedback('');

                const datasetName = String(dataset && dataset.name || '').trim();
                const datasetId = Number(dataset && dataset.id);
                const defaultTitle = datasetName
                    ? `编辑数据集 - ${datasetName}`
                    : (Number.isInteger(datasetId) && datasetId > 0 ? `编辑数据集 - #${datasetId}` : '编辑数据集元信息');
                titleEl.textContent = String(title || defaultTitle).trim() || '编辑数据集元信息';

                nameInput.value = String(dataset && dataset.name || '').trim();
                versionInput.value = String(dataset && dataset.version || '').trim();
                taskTypeInput.value = String(dataset && dataset.task_type || '').trim();
                formatInput.value = String(
                    (dataset && dataset.dataset_format)
                    || (dataset && dataset.format)
                    || '',
                ).trim();
                pathInput.value = String(
                    (dataset && dataset.dataset_path)
                    || (dataset && dataset.path)
                    || '',
                ).trim();
                fileNameInput.value = resolveDatasetFileName(dataset);

                const sizeCandidates = [
                    dataset && dataset.size_mb,
                    dataset && dataset.dataset_size_mb,
                    dataset && dataset.sizeMB,
                    dataset && dataset.size,
                ];
                let resolvedSizeMb = '';
                for (let i = 0; i < sizeCandidates.length; i += 1) {
                    const num = Number(sizeCandidates[i]);
                    if (Number.isFinite(num) && num > 0) {
                        resolvedSizeMb = String(num);
                        break;
                    }
                }
                sizeMbInput.value = resolvedSizeMb;

                const numClasses = Number(dataset && dataset.num_classes);
                numClassesInput.value = Number.isInteger(numClasses) && numClasses > 0 ? String(numClasses) : '';
                configPathInput.value = String(dataset && dataset.config_path || '').trim();

                const trainCount = Number(dataset && dataset.train_count);
                trainCountInput.value = Number.isInteger(trainCount) && trainCount >= 0 ? String(trainCount) : '';
                const valCount = Number(dataset && dataset.val_count);
                valCountInput.value = Number.isInteger(valCount) && valCount >= 0 ? String(valCount) : '';
                const testCount = Number(dataset && dataset.test_count);
                testCountInput.value = Number.isInteger(testCount) && testCount >= 0 ? String(testCount) : '';

                const classNamesRaw = dataset && dataset.class_names;
                let classNamesText = '';
                if (Array.isArray(classNamesRaw)) {
                    classNamesText = classNamesRaw.map((item) => String(item).trim()).filter(Boolean).join(', ');
                } else if (typeof classNamesRaw === 'string') {
                    const text = classNamesRaw.trim();
                    if (text.startsWith('[') && text.endsWith(']')) {
                        try {
                            const parsed = JSON.parse(text);
                            if (Array.isArray(parsed)) {
                                classNamesText = parsed.map((item) => String(item).trim()).filter(Boolean).join(', ');
                            } else {
                                classNamesText = text;
                            }
                        } catch (error) {
                            classNamesText = text;
                        }
                    } else {
                        classNamesText = text;
                    }
                }
                classNamesInput.value = classNamesText;

                const storageServers = parseStorageServers(
                    dataset && dataset.storage_servers,
                    dataset && dataset.storage_server,
                );
                storageServersInput.value = storageServers.join(', ');
                descriptionInput.value = String(dataset && dataset.description || '').trim();

                overlay.hidden = false;
                if (nameInput) nameInput.focus();

                return new Promise((resolve) => {
                    resolver = resolve;
                });
            },
        };

        return datasetMetadataEditModalRefs;
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
                <p class="modal-subtitle">仅支持两种方向：本地（backend）→ 远端/网盘，或远端/网盘 → 本地（backend）。</p>
                <div class="form-divider"></div>
                <div class="storage-sync-current" data-storage-sync-current></div>
                <form data-storage-sync-form>
                    <div class="form-grid-2 storage-sync-select-grid">
                        <div class="form-group">
                            <label for="storage-sync-source">从哪里同步 <span class="required-mark" aria-hidden="true">*</span></label>
                            <select id="storage-sync-source" name="source_storage" class="form-control" data-storage-source-select required>
                                <option value="">请选择来源存储</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="storage-sync-target">同步到哪里 <span class="required-mark" aria-hidden="true">*</span></label>
                            <select id="storage-sync-target" name="target_storage" class="form-control" data-storage-target-select required>
                                <option value="">请选择目标存储</option>
                            </select>
                        </div>
                    </div>
                    <p class="storage-sync-note" data-storage-sync-note></p>
                    <div class="storage-sync-download-fields" data-storage-download-fields hidden>
                        <h4>百度网盘下载参数</h4>
                        <div class="form-grid-2">
                            <div class="form-group form-span-2">
                                <label for="storage-sync-remote-path">网盘文件路径 remote_path <span class="required-mark" aria-hidden="true">*</span></label>
                                <input id="storage-sync-remote-path" name="remote_path" class="form-control" type="text" data-storage-remote-path placeholder="/project/luckyProject/weights/model.pt" />
                            </div>
                            <div class="form-group">
                                <label for="storage-sync-category">下载类别 category</label>
                                <select id="storage-sync-category" name="category" class="form-control" data-storage-category>
                                    <option value="weights">weights</option>
                                    <option value="models">models</option>
                                    <option value="datasets">datasets</option>
                                    <option value="dataset">dataset</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="storage-sync-subdir">本地子目录 subdir（可选）</label>
                                <input id="storage-sync-subdir" name="subdir" class="form-control" type="text" data-storage-subdir placeholder="sync" />
                            </div>
                            <div class="form-group form-span-2">
                                <label for="storage-sync-file-name">保存文件名 file_name（可选）</label>
                                <input id="storage-sync-file-name" name="file_name" class="form-control" type="text" data-storage-file-name placeholder="model.pt" />
                            </div>
                        </div>
                    </div>
                    <div class="form-actions modal-actions">
                        <button class="btn btn-secondary" type="button" data-storage-sync-cancel>取消</button>
                        <button class="btn btn-primary" type="submit" data-storage-sync-submit>
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
        const submitBtn = overlay.querySelector('[data-storage-sync-submit]');
        const sourceSelect = overlay.querySelector('[data-storage-source-select]');
        const targetSelect = overlay.querySelector('[data-storage-target-select]');
        const noteEl = overlay.querySelector('[data-storage-sync-note]');
        const downloadFieldsEl = overlay.querySelector('[data-storage-download-fields]');
        const remotePathInput = overlay.querySelector('[data-storage-remote-path]');
        const categorySelect = overlay.querySelector('[data-storage-category]');
        const subdirInput = overlay.querySelector('[data-storage-subdir]');
        const fileNameInput = overlay.querySelector('[data-storage-file-name]');
        let optionLabelMap = new Map();
        let modalCurrentServers = new Set();
        let modalAllOptions = [];
        let resolver = null;

        const getOptionLabel = (value) => {
            const key = normalizeStorageServerValue(value);
            if (!key) return '';
            return optionLabelMap.get(key) || formatStorageServerLabel(key);
        };

        const setSelectItems = (selectEl, options, placeholder) => {
            if (!selectEl) return;
            const optionMarkup = options.map((item) => (
                `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`
            )).join('');
            selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${optionMarkup}`;
        };

        const getTargetOptions = (sourceStorage) => {
            const source = normalizeStorageServerValue(sourceStorage);
            if (!source) return [];

            if (source === 'backend') {
                return modalAllOptions.filter((item) => {
                    const normalizedValue = normalizeStorageServerValue(item.value);
                    if (!normalizedValue || normalizedValue === 'backend') return false;
                    return !modalCurrentServers.has(normalizedValue);
                });
            }

            const backendOption = modalAllOptions.find((item) => normalizeStorageServerValue(item.value) === 'backend');
            if (backendOption) return [backendOption];
            return [{ value: 'backend', label: getOptionLabel('backend') }];
        };

        const needsBaiduDownload = (sourceStorage, targetStorage) => {
            const direction = getStorageSyncDirection(sourceStorage, targetStorage);
            return direction === 'download'
                && shouldUploadToBaidu(sourceStorage)
                && normalizeStorageServerValue(targetStorage) === 'backend';
        };

        const updateSubmitState = () => {
            if (!submitBtn) return;
            const sourceStorage = normalizeStorageServerValue(sourceSelect && sourceSelect.value);
            const targetStorage = normalizeStorageServerValue(targetSelect && targetSelect.value);
            submitBtn.disabled = !sourceStorage || !targetStorage;
        };

        const refreshTargetOptions = ({ preferredTarget = '' } = {}) => {
            const sourceStorage = normalizeStorageServerValue(sourceSelect && sourceSelect.value);
            const targetOptions = getTargetOptions(sourceStorage);
            setSelectItems(
                targetSelect,
                targetOptions,
                targetOptions.length ? '请选择目标存储' : '暂无可选目标存储',
            );

            const normalizedPreferred = normalizeStorageServerValue(preferredTarget);
            const preferredOption = normalizedPreferred
                ? targetOptions.find((item) => normalizeStorageServerValue(item.value) === normalizedPreferred)
                : null;
            if (
                targetSelect
                && preferredOption
            ) {
                targetSelect.value = preferredOption.value;
            } else if (targetSelect && targetOptions.length) {
                targetSelect.value = targetOptions[0].value;
            }

            updateSubmitState();
            return targetOptions;
        };

        const updateDownloadFieldsVisibility = () => {
            const sourceStorage = normalizeStorageServerValue(sourceSelect && sourceSelect.value);
            const targetStorage = normalizeStorageServerValue(targetSelect && targetSelect.value);
            const direction = getStorageSyncDirection(sourceStorage, targetStorage);
            const shouldShow = needsBaiduDownload(sourceStorage, targetStorage);
            if (downloadFieldsEl) {
                downloadFieldsEl.hidden = !shouldShow;
            }
            if (remotePathInput) {
                remotePathInput.required = shouldShow;
            }

            if (noteEl) {
                if (!sourceStorage || !targetStorage) {
                    noteEl.textContent = '请选择来源和目标存储。';
                } else if (!direction) {
                    noteEl.textContent = '仅支持“本地 -> 远端/网盘”或“远端/网盘 -> 本地”。';
                } else if (direction === 'upload') {
                    noteEl.textContent = '将先从本地读取模型文件，再调用 /v1/models/upload 上传到目标存储。';
                } else if (shouldShow) {
                    noteEl.textContent = '将调用 /v1/baidu/download 下载到本地（backend），并更新存储标记。';
                } else {
                    noteEl.textContent = '当前仅支持“百度网盘 -> 本地”的下载传输；其它远端下载接口暂未接入。';
                }
            }
            updateSubmitState();
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
                const formData = new FormData(formEl);
                const sourceStorage = normalizeStorageServerValue(formData.get('source_storage'));
                const targetStorage = normalizeStorageServerValue(formData.get('target_storage'));
                if (!sourceStorage || !targetStorage) return;
                if (sourceStorage === targetStorage) {
                    return;
                }
                const direction = getStorageSyncDirection(sourceStorage, targetStorage);
                if (!direction) {
                    return;
                }

                const requiresDownload = needsBaiduDownload(sourceStorage, targetStorage);
                const remotePath = String(formData.get('remote_path') || '').trim();
                if (requiresDownload && !remotePath) {
                    if (remotePathInput) {
                        remotePathInput.reportValidity();
                    }
                    return;
                }

                const result = {
                    sourceStorage,
                    targetStorage,
                    download: requiresDownload ? {
                        remotePath,
                        category: String(formData.get('category') || 'weights').trim() || 'weights',
                        subdir: String(formData.get('subdir') || '').trim(),
                        fileName: String(formData.get('file_name') || '').trim(),
                    } : null,
                };
                closeModal(result);
            });
        }

        if (sourceSelect) {
            sourceSelect.addEventListener('change', () => {
                refreshTargetOptions();
                updateDownloadFieldsVisibility();
            });
        }
        if (targetSelect) targetSelect.addEventListener('change', updateDownloadFieldsVisibility);

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
            open({
                title,
                currentStorageServers = [],
                allStorageOptions = [],
                defaultSourceStorage = '',
                defaultTargetStorage = '',
                defaultRemotePath = '',
                defaultCategory = 'weights',
                defaultSubdir = 'sync',
                defaultFileName = '',
            } = {}) {
                const safeTitle = String(title || '存储同步').trim() || '存储同步';
                titleEl.textContent = safeTitle;

                const normalizedServers = uniqueStorageServers(currentStorageServers);
                if (!normalizedServers.length) {
                    normalizedServers.push('backend');
                }
                const mergedAllOptions = mergeStorageServerOptions(allStorageOptions);
                if (mergedAllOptions.length) {
                    const seenNormalized = new Set();
                    modalAllOptions = mergedAllOptions.filter((item) => {
                        const normalizedValue = normalizeStorageServerValue(item.value) || item.value;
                        if (!normalizedValue) return false;
                        if (seenNormalized.has(normalizedValue)) return false;
                        seenNormalized.add(normalizedValue);
                        return true;
                    });
                } else {
                    modalAllOptions = DEFAULT_STORAGE_SERVER_OPTIONS;
                }
                optionLabelMap = new Map();
                modalAllOptions.forEach((item) => {
                    optionLabelMap.set(normalizeStorageServerValue(item.value), item.label);
                });
                normalizedServers.forEach((value) => {
                    const normalizedValue = normalizeStorageServerValue(value);
                    if (!optionLabelMap.has(normalizedValue)) {
                        optionLabelMap.set(normalizedValue, formatStorageServerLabel(normalizedValue));
                    }
                });

                const serverText = normalizedServers.length
                    ? normalizedServers.map((value) => getOptionLabel(value)).join(' / ')
                    : '--';
                currentEl.textContent = `当前存储标记：${serverText}`;

                modalCurrentServers = new Set(normalizedServers.map((value) => normalizeStorageServerValue(value)));
                const sourceOptions = normalizedServers.map((value) => ({
                    value,
                    label: getOptionLabel(value),
                }));

                setSelectItems(sourceSelect, sourceOptions, sourceOptions.length ? '请选择来源存储' : '暂无来源存储');
                const sourceCandidate = normalizeStorageServerValue(defaultSourceStorage);
                if (sourceSelect) {
                    const matchedSourceOption = sourceOptions.find((item) => (
                        item.value === sourceCandidate
                        || normalizeStorageServerValue(item.value) === sourceCandidate
                    ));
                    sourceSelect.value = matchedSourceOption
                        ? matchedSourceOption.value
                        : (sourceOptions[0] ? sourceOptions[0].value : '');
                }
                const targetOptions = refreshTargetOptions({
                    preferredTarget: normalizeStorageServerValue(defaultTargetStorage),
                });

                if (remotePathInput) {
                    remotePathInput.value = String(defaultRemotePath || '').trim();
                }
                if (categorySelect) {
                    const safeCategory = String(defaultCategory || 'weights').trim() || 'weights';
                    categorySelect.value = safeCategory;
                    if (categorySelect.value !== safeCategory) {
                        categorySelect.value = 'weights';
                    }
                }
                if (subdirInput) {
                    subdirInput.value = String(defaultSubdir || '').trim();
                }
                if (fileNameInput) {
                    fileNameInput.value = String(defaultFileName || '').trim();
                }

                if (submitBtn) {
                    submitBtn.disabled = !sourceOptions.length || !targetOptions.length;
                }
                updateDownloadFieldsVisibility();
                overlay.hidden = false;
                return new Promise((resolve) => {
                    resolver = resolve;
                });
            },
        };

        return storageSyncModalRefs;
    }

    function ensureDangerConfirmModal() {
        if (dangerConfirmModalRefs) return dangerConfirmModalRefs;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay danger-confirm-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="modal-card danger-confirm-card">
                <div class="modal-header">
                    <h3 data-danger-confirm-title>确认操作</h3>
                    <button class="btn-icon" type="button" data-danger-confirm-cancel title="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <p class="modal-subtitle" data-danger-confirm-subtitle></p>
                <div class="form-divider"></div>
                <div class="warning-box danger-confirm-box">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <div class="danger-confirm-content">
                        <div class="danger-confirm-message" data-danger-confirm-message></div>
                        <code class="danger-confirm-detail" data-danger-confirm-detail hidden></code>
                        <p class="danger-confirm-note" data-danger-confirm-note hidden></p>
                    </div>
                </div>
                <div class="form-actions modal-actions">
                    <button class="btn btn-secondary" type="button" data-danger-confirm-cancel>取消</button>
                    <button class="btn btn-danger" type="button" data-danger-confirm-submit>
                        <i class="fa-solid fa-trash"></i>
                        确认删除
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const titleEl = overlay.querySelector('[data-danger-confirm-title]');
        const subtitleEl = overlay.querySelector('[data-danger-confirm-subtitle]');
        const messageEl = overlay.querySelector('[data-danger-confirm-message]');
        const detailEl = overlay.querySelector('[data-danger-confirm-detail]');
        const noteEl = overlay.querySelector('[data-danger-confirm-note]');
        const submitBtn = overlay.querySelector('[data-danger-confirm-submit]');
        const cancelBtns = overlay.querySelectorAll('[data-danger-confirm-cancel]');
        let resolver = null;

        const closeModal = (confirmed = false) => {
            overlay.hidden = true;
            if (resolver) {
                const cb = resolver;
                resolver = null;
                cb(Boolean(confirmed));
            }
        };

        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                closeModal(true);
            });
        }

        cancelBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                closeModal(false);
            });
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(false);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.hidden) {
                closeModal(false);
            }
        });

        dangerConfirmModalRefs = {
            open({
                title = '确认操作',
                subtitle = '',
                message = '',
                detail = '',
                note = '',
                confirmText = '确认',
            } = {}) {
                titleEl.textContent = String(title || '确认操作').trim() || '确认操作';

                const safeSubtitle = String(subtitle || '').trim();
                if (subtitleEl) {
                    subtitleEl.hidden = !safeSubtitle;
                    subtitleEl.textContent = safeSubtitle;
                }

                if (messageEl) {
                    messageEl.textContent = String(message || '').trim() || '请确认是否继续。';
                }

                const safeDetail = String(detail || '').trim();
                if (detailEl) {
                    detailEl.hidden = !safeDetail;
                    detailEl.textContent = safeDetail;
                }

                const safeNote = String(note || '').trim();
                if (noteEl) {
                    noteEl.hidden = !safeNote;
                    noteEl.textContent = safeNote;
                }

                if (submitBtn) {
                    submitBtn.innerHTML = `<i class="fa-solid fa-trash"></i> ${escapeHtml(String(confirmText || '确认').trim() || '确认')}`;
                }

                overlay.hidden = false;
                if (submitBtn) submitBtn.focus();
                return new Promise((resolve) => {
                    resolver = resolve;
                });
            },
        };

        return dangerConfirmModalRefs;
    }

    const getPageManifest = (pageName) => PAGE_RESOURCE_MANIFEST[pageName] || {};

    const invalidateStorageServerCaches = () => {
        coreServerRecordsCache = null;
        storageServerOptionsCache = null;
    };

    const buildLazyPageContext = () => ({
        BAIDU_DATASET_REMOTE_DIR,
        BAIDU_MODEL_REMOTE_DIR,
        BAIDU_STORAGE_SERVER_VALUES,
        DEFAULT_API_BASE_URL,
        DEFAULT_STORAGE_SERVER_OPTIONS,
        PAGE_RESOURCE_MANIFEST,
        TASK_TYPE_MAP,
        apiBaseUrl,
        apiRequest,
        bindModelPicker,
        buildBaiduRemotePathForDataset,
        buildBaiduRemotePathForModel,
        buildPropertyGridHtml,
        buildQuery,
        bytesToMB,
        clearAlert,
        configuredBaseUrl,
        downloadDatasetFileById,
        downloadFromBaiduToLocal,
        downloadModelFileById,
        ensureDangerConfirmModal,
        ensureDatasetMetadataEditModal,
        ensureModelMetadataEditModal,
        ensurePropertyModal,
        ensureStorageSyncModal,
        escapeHtml,
        fetchCoreServerRecords,
        fetchDatasetBlobById,
        fetchModelBlobById,
        formatDateTime,
        formatFileSize,
        formatModelPickerDisplay,
        formatModelVersionLabel,
        formatPropertyPrimitive,
        formatSizeMB,
        formatStorageServerLabel,
        formatTaskType,
        formatVersionAsSingleDecimal,
        getConfiguredStorageOptions,
        getCoreServerStateInfo,
        getCreatedEntityId,
        getFileExtension,
        getPageManifest,
        getPathFileName,
        getPropertyTypeLabel,
        getStorageServersForSync,
        getStorageSyncDirection,
        invalidateStorageServerCaches,
        isRemoteCoreStorageServer,
        isTruthyFlag,
        loadModelsForPicker,
        loadStorageServerOptions,
        mergeStorageServerOptions,
        normalizeCoreServerRecords,
        normalizePropertyPayload,
        normalizeStorageOptions,
        normalizeStorageServerValue,
        normalizeWeightBaseName,
        openPropertyModal,
        parseAttachmentFileName,
        parseModelVersionValue,
        parseStorageServers,
        parseVersionAsNumber,
        pickLatestModel,
        populateStorageServerSelects,
        resolveDatasetFileName,
        resolveModelByPickerInput,
        resolveModelUploadRoute,
        resolveModelWeightFileName,
        setPickerHint,
        setSelectOptions,
        setupDropzone,
        shouldUploadToBaidu,
        showAlert,
        stripTrailingHashFromBaseName,
        stripTrailingHashFromWeightName,
        suggestModelNameFromWeightFile,
        syncStorageServersForEntity,
        timeoutMs,
        trimExtension,
        uniqueStorageServers,
        updateStorageServersForEntity,
        uploadDatasetFromBackendToStorage,
        uploadFileViaApi,
        uploadModelFromBackendToStorage,
    });

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const loadPageTemplate = async (pageName) => {
        if (pageHtmlCache.has(pageName)) return pageHtmlCache.get(pageName);
        const response = await fetch(`pages/${pageName}.html`);
        if (!response.ok) throw new Error('Page not found');
        const html = await response.text();
        pageHtmlCache.set(pageName, html);
        return html;
    };

    const ensurePageStyles = async (pageName) => {
        const manifest = getPageManifest(pageName);
        const styles = Array.isArray(manifest.styles) ? manifest.styles : [];
        const activeStyleSet = new Set(styles.map((item) => String(item || '').trim()).filter(Boolean));

        pageStyleLinkCache.forEach((linkEl, href) => {
            if (!linkEl) return;
            linkEl.disabled = !activeStyleSet.has(href);
        });

        await Promise.all(Array.from(activeStyleSet).map((href) => {
            let linkEl = pageStyleLinkCache.get(href);
            if (!linkEl) {
                linkEl = document.createElement('link');
                linkEl.rel = 'stylesheet';
                linkEl.href = href;
                linkEl.setAttribute('data-page-style', href);
                pageStyleLinkCache.set(href, linkEl);
                document.head.appendChild(linkEl);

                const stylePromise = new Promise((resolve) => {
                    linkEl.addEventListener('load', () => resolve(), { once: true });
                    linkEl.addEventListener('error', () => resolve(), { once: true });
                });
                pageStyleLoadPromiseCache.set(href, stylePromise);
            }
            linkEl.disabled = false;
            return pageStyleLoadPromiseCache.get(href) || Promise.resolve();
        }));
    };

    const loadPageModule = async (pageName) => {
        const manifest = getPageManifest(pageName);
        const modulePath = String(manifest.module || '').trim();
        if (!modulePath) return null;

        if (pageModuleCache.has(modulePath)) {
            return pageModuleCache.get(modulePath);
        }

        const loadedModule = await import(modulePath);
        pageModuleCache.set(modulePath, loadedModule);
        return loadedModule;
    };

    const initPageByName = async (pageName) => {
        if (pageName === 'model-training') {
            initModelTrainingPage();
            return;
        }

        if (pageName === 'model-inference') {
            initModelInferencePage();
            return;
        }

        const manifest = getPageManifest(pageName);
        if (manifest.module) {
            const pageModule = await loadPageModule(pageName);
            const exportName = String(manifest.exportName || '').trim();
            const initFn = pageModule && pageModule[exportName];
            if (typeof initFn === 'function') {
                await initFn(buildLazyPageContext());
                return;
            }
        }

        initTableFeatures();
    };

    // Function to load page content
    async function loadPage(pageName) {
        try {
            pageLoadSeq += 1;
            const seq = pageLoadSeq;
            document.body.dataset.page = pageName;
            const [html] = await Promise.all([
                loadPageTemplate(pageName),
                ensurePageStyles(pageName),
            ]);
            if (seq !== pageLoadSeq) return;

            mainContent.style.opacity = '0';
            await sleep(140);
            if (seq !== pageLoadSeq) return;
            mainContent.innerHTML = `<section class="page-section active fade-in">${html}</section>`;
            mainContent.style.opacity = '1';

            await initPageByName(pageName);
        } catch (error) {
            console.error('Error loading page:', error);
            mainContent.innerHTML = `<div class="alert error">Failed to load content: ${escapeHtml(error.message)}</div>`;
        }
    }

    function initModelTrainingPage() {
        const baseModelInput = document.querySelector('[data-training-base-model-input]');
        const baseModelList = document.querySelector('[data-training-base-model-list]');
        const baseModelIDInput = document.querySelector('[data-training-base-model-id]');
        const baseModelHint = document.querySelector('[data-training-base-model-hint]');

        bindModelPicker({
            inputEl: baseModelInput,
            datalistEl: baseModelList,
            hiddenIDEl: baseModelIDInput,
            hintEl: baseModelHint,
            defaultHint: '可输入模型名称或 ID 检索；留空表示从零训练。',
            forceRefresh: true,
        });
    }

    function initModelInferencePage() {
        const modelInput = document.querySelector('[data-inference-model-input]');
        const modelList = document.querySelector('[data-inference-model-list]');
        const modelIDInput = document.querySelector('[data-inference-model-id]');
        const modelHint = document.querySelector('[data-inference-model-hint]');

        bindModelPicker({
            inputEl: modelInput,
            datalistEl: modelList,
            hiddenIDEl: modelIDInput,
            hintEl: modelHint,
            defaultHint: '可输入模型名称或 ID 检索并选中。',
            forceRefresh: true,
        });
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

    // Initial Load
    loadPage('model-management');

    // Handle Navigation
    navItems.forEach((item) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            const page = item.getAttribute('data-page');
            document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));
            item.classList.add('active');
            const parentSubmenu = item.closest('.submenu');
            if (parentSubmenu) {
                const groupHeader = parentSubmenu.previousElementSibling;
                if (groupHeader && groupHeader.classList.contains('has-submenu')) {
                    groupHeader.classList.add('active');
                }
            }

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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
    bootstrapApp();
}
