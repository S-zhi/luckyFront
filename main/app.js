document.addEventListener('DOMContentLoaded', () => {
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
        },
        'dataset-management': {
            styles: ['styles/pages/dataset-management.css'],
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
        apiBaseUrl,
        timeoutMs,
        apiRequest,
        escapeHtml,
        clearAlert,
        showAlert,
        openPropertyModal,
        bindModelPicker,
        fetchCoreServerRecords,
        getCoreServerStateInfo,
        formatStorageServerLabel,
        normalizeStorageServerValue,
        formatDateTime,
        ensureDangerConfirmModal,
        invalidateStorageServerCaches,
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
        if (pageName === 'model-management') {
            initModelManagementPage();
            return;
        }

        if (pageName === 'dataset-management') {
            initDatasetManagementPage();
            return;
        }

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
                initFn(buildLazyPageContext());
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
        const modelPathInput = document.querySelector('#model-path');
        const modelImplTypeInput = document.querySelector('#model-impl-type');
        const modelSyncBaiduWhenRemoteCheckbox = document.querySelector('#model-sync-baidu-when-remote');

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
        let versionSuggestSeq = 0;
        const modelDefaultFileHint = '支持拖拽/点选，提交时会先调用文件上传接口，再写入模型元数据。';

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

        const getVersionBadgeClass = () => 'secondary';

        const formatVersionText = (model) => {
            const directCandidates = [
                model && model.version,
                model && model.model_version,
                model && model.ver,
            ];

            for (let i = 0; i < directCandidates.length; i += 1) {
                const candidate = directCandidates[i];
                if (candidate == null) continue;
                const rawText = String(candidate).trim();
                if (!rawText) continue;

                const normalized = rawText
                    .replace(/^version\s*/i, '')
                    .replace(/^v/i, '');

                if (/^\d+$/.test(normalized)) {
                    return `${normalized}.0`;
                }
                if (/^\d+(?:\.\d+)+$/.test(normalized)) {
                    return normalized;
                }

                const numeric = Number(normalized);
                if (Number.isFinite(numeric) && numeric > 0) {
                    return Number.isInteger(numeric) ? numeric.toFixed(1) : String(numeric);
                }
            }

            const nameText = String(model && model.name || '').trim();
            const fromNameMatch = nameText.match(/_v?(\d+(?:\.\d+)*)$/i);
            if (fromNameMatch && fromNameMatch[1]) {
                return fromNameMatch[1];
            }

            return '--';
        };

        const resolveModelSizeValue = (model) => {
            const candidates = [
                model && model.size_mb,
                model && model.weight_size_mb,
                model && model.sizeMB,
                model && model.sizeMb,
                model && model.size,
            ];
            for (let i = 0; i < candidates.length; i += 1) {
                const value = Number(candidates[i]);
                if (Number.isFinite(value) && value >= 0) return value;
            }
            return null;
        };

        const resolveModelCreatedAt = (model) => {
            const candidates = [
                model && model.created_at,
                model && model.createdAt,
                model && model.created_time,
                model && model.createdTime,
                model && model.create_time,
                model && model.createTime,
                model && model.upload_time,
                model && model.uploadTime,
            ];
            for (let i = 0; i < candidates.length; i += 1) {
                const value = candidates[i];
                if (value) return value;
            }
            return '';
        };

        const getModelNameLabels = (model) => {
            const rawSource = model && model.storage_server;
            let source = [];
            if (Array.isArray(rawSource)) {
                source = rawSource;
            } else if (typeof rawSource === 'string') {
                const text = rawSource.trim();
                if (!text) return [];
                try {
                    const parsed = JSON.parse(text);
                    if (!Array.isArray(parsed)) return [];
                    source = parsed;
                } catch (error) {
                    return [];
                }
            } else {
                return [];
            }
            const result = [];
            for (let i = 0; i < source.length; i += 1) {
                const text = String(source[i] == null ? '' : source[i]).trim();
                if (!text) continue;
                if (result.includes(text)) continue;
                result.push(text);
            }
            return result;
        };

        const getLabelColorIndex = (label) => {
            const text = String(label || '');
            let hash = 0;
            for (let i = 0; i < text.length; i += 1) {
                hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
            }
            return hash % 6;
        };

        const prettifyToken = (value = '') => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            const normalized = raw.toLowerCase();

            const specialMap = {
                yolo: 'YOLO',
                resnet: 'ResNet',
                vit: 'ViT',
                unet: 'UNet',
                bert: 'BERT',
                clip: 'CLIP',
                sam: 'SAM',
                cnn: 'CNN',
                rnn: 'RNN',
                lstm: 'LSTM',
                transformer: 'Transformer',
                pytorch: 'PyTorch',
                torch: 'PyTorch',
                ultralytics: 'Ultralytics',
                onnxruntime: 'ONNX Runtime',
                onnx: 'ONNX',
                tensorrt: 'TensorRT',
                tensorflow: 'TensorFlow',
                paddle: 'PaddlePaddle',
                paddlepaddle: 'PaddlePaddle',
                openvino: 'OpenVINO',
            };
            if (specialMap[normalized]) return specialMap[normalized];

            return normalized.replace(/\b\w/g, (ch) => ch.toUpperCase());
        };

        const inferFrameworkFromPath = (pathValue) => {
            const pathText = String(pathValue || '').toLowerCase().trim();
            if (!pathText) return '';
            if (/\.(pt|pth|ckpt)$/.test(pathText)) return 'PyTorch';
            if (/\.(onnx)$/.test(pathText)) return 'ONNX';
            if (/\.(engine|trt)$/.test(pathText)) return 'TensorRT';
            if (/\.(pb|h5|keras)$/.test(pathText)) return 'TensorFlow';
            return '';
        };

        const resolveAlgorithmFramework = (model) => {
            const implRaw = String(
                model && (
                    model.impl_type
                    || model.implType
                    || model.algorithm
                    || model.algorithm_name
                    || model.algorithmName
                    || ''
                ) || '',
            ).trim();

            const frameworkRaw = String(
                model && (
                    model.framework
                    || model.framework_name
                    || model.frameworkName
                    || ''
                ) || '',
            ).trim();

            let algorithm = '';
            let framework = '';

            if (implRaw) {
                const normalized = implRaw.toLowerCase();
                const chunks = normalized
                    .split(/[_\-/\s]+/g)
                    .map((item) => item.trim())
                    .filter(Boolean);

                if (chunks.length >= 2) {
                    algorithm = prettifyToken(chunks[0]);
                    framework = prettifyToken(chunks[chunks.length - 1]);
                } else if (chunks.length === 1) {
                    algorithm = prettifyToken(chunks[0]);
                }
            }

            if (!algorithm) {
                const fromName = String(model && model.name || '').trim().toLowerCase();
                const token = fromName.split(/[_\-\s]+/g).find(Boolean) || '';
                algorithm = prettifyToken(token);
            }

            if (!framework) {
                framework = prettifyToken(frameworkRaw);
            }

            if (!framework) {
                framework = inferFrameworkFromPath(
                    (model && model.model_path)
                    || (model && model.weight_name)
                    || (model && model.file_name)
                    || '',
                );
            }

            if (!algorithm) algorithm = 'Unknown';
            if (!framework) framework = 'Unknown';

            return { algorithm, framework };
        };

        const getStatusMeta = (model) => {
            const sizeValue = resolveModelSizeValue(model);
            if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
                return { cls: 'error', text: '不可用' };
            }
            return { cls: 'success', text: '可用' };
        };

        const renderRows = () => {
            if (!Array.isArray(state.rows) || state.rows.length === 0) {
                renderPlaceholderRow('暂无模型数据');
                return;
            }

            const maxVersionByName = new Map();
            state.rows.forEach((model) => {
                const nameKey = String(model && model.name || '').trim().toLowerCase();
                if (!nameKey) return;
                const versionNumber = parseVersionFromModelRecord(model);
                if (!Number.isFinite(versionNumber) || versionNumber <= 0) return;
                const prev = maxVersionByName.get(nameKey);
                if (!Number.isFinite(prev) || versionNumber > prev) {
                    maxVersionByName.set(nameKey, versionNumber);
                }
            });

            const html = state.rows.map((model) => {
                const modelName = escapeHtml(model.name || '--');
                const versionText = formatVersionText(model);
                const version = escapeHtml(versionText === '--' ? 'version --' : `version ${versionText}`);
                const versionBadgeClass = getVersionBadgeClass(model.version);
                const modelNameKey = String(model && model.name || '').trim().toLowerCase();
                const modelVersionNumber = parseVersionFromModelRecord(model);
                const maxVersion = maxVersionByName.get(modelNameKey);
                const isLatest = Number.isFinite(modelVersionNumber)
                    && modelVersionNumber > 0
                    && Number.isFinite(maxVersion)
                    && modelVersionNumber >= maxVersion;
                const impl = resolveAlgorithmFramework(model);
                const algorithmText = escapeHtml(impl.algorithm);
                const frameworkText = escapeHtml(impl.framework);
                const taskType = escapeHtml(formatTaskType(model.task_type));
                const sizeText = escapeHtml(formatSizeMB(resolveModelSizeValue(model)));
                const createdAt = escapeHtml(formatDateTime(resolveModelCreatedAt(model)));
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
                                    ${isLatest ? '<span class="badge latest sm">latest</span>' : ''}
                                </div>
                                ${nameLabelsHtml}
                            </div>
                        </td>
                        <td>
                            <div class="tech-stack">
                                <span class="tag">${algorithmText}</span>
                                <span class="tag">${frameworkText}</span>
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
                                    <button class="btn-icon delete" title="删除模型" data-model-action="delete" data-model-id="${rowId}"><i class="fa-solid fa-trash"></i></button>
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
                                        throw new Error('未找到有效模型 ID，无法更新。');
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
                    const fallbackFileName = String(
                        currentModel.weight_name ||
                        currentModel.file_name ||
                        getPathFileName(currentModel.model_path) ||
                        `model-${modelId}`,
                    ).trim();
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
                    const currentServers = parseStorageServers(
                        currentModel.storage_servers,
                        currentModel.storage_server,
                    );
                    if (!currentServers.length) {
                        currentServers.push('backend');
                    }
                    const modelPath = String(currentModel.model_path || '').trim();
                    const allStorageOptions = await loadStorageServerOptions({ force: true });
                    const currentNormalizedSet = new Set(currentServers.map((value) => normalizeStorageServerValue(value)));
                    const normalizedAllOptions = normalizeStorageOptions(allStorageOptions);
                    const allOptionValues = uniqueStorageServers(normalizedAllOptions.map((item) => item.value));
                    const availableRemoteTargets = allOptionValues.filter((value) => {
                        const normalizedValue = normalizeStorageServerValue(value);
                        return normalizedValue && normalizedValue !== 'backend' && !currentNormalizedSet.has(normalizedValue);
                    });

                    let defaultSourceStorage = currentServers[0] || '';
                    if (currentServers.includes('backend')) {
                        defaultSourceStorage = 'backend';
                    } else if (currentServers.includes('baidu_netdisk')) {
                        defaultSourceStorage = 'baidu_netdisk';
                    }

                    let defaultTargetStorage = '';
                    if (normalizeStorageServerValue(defaultSourceStorage) === 'backend') {
                        if (availableRemoteTargets.includes('baidu_netdisk')) {
                            defaultTargetStorage = 'baidu_netdisk';
                        } else {
                            defaultTargetStorage = availableRemoteTargets[0] || '';
                        }
                    } else {
                        defaultTargetStorage = 'backend';
                    }

                    const defaultRemotePath = buildBaiduRemotePathForModel(currentModel);
                    const defaultFileName = resolveModelWeightFileName(currentModel) || getPathFileName(modelPath);

                    const syncModal = ensureStorageSyncModal();
                    const syncPlan = await syncModal.open({
                        title: `模型同步 - ${modelName}`,
                        currentStorageServers: currentServers,
                        allStorageOptions,
                        defaultSourceStorage,
                        defaultTargetStorage,
                        defaultRemotePath,
                        defaultCategory: 'weights',
                        defaultSubdir: 'sync',
                        defaultFileName,
                    });
                    if (!syncPlan) return;

                    const sourceStorage = normalizeStorageServerValue(syncPlan.sourceStorage);
                    const targetStorage = normalizeStorageServerValue(syncPlan.targetStorage);
                    const downloadPlan = syncPlan.download || null;
                    if (!sourceStorage || !targetStorage) {
                        showAlert(messageSlot, `模型“${modelName}”同步失败：请选择来源和目标存储。`, 'error');
                        return;
                    }
                    if (!currentNormalizedSet.has(sourceStorage)) {
                        showAlert(messageSlot, `模型“${modelName}”同步失败：来源存储不在当前模型的已存储范围内。`, 'error');
                        return;
                    }
                    const syncDirection = getStorageSyncDirection(sourceStorage, targetStorage);
                    if (!syncDirection) {
                        showAlert(messageSlot, `模型“${modelName}”同步失败：仅支持“本地 -> 远端/网盘”或“远端/网盘 -> 本地”。`, 'error');
                        return;
                    }
                    if (syncDirection === 'upload' && currentNormalizedSet.has(targetStorage)) {
                        showAlert(messageSlot, `模型“${modelName}”同步失败：目标存储已存在，无需重复同步。`, 'error');
                        return;
                    }

                    actionBtn.disabled = true;
                    try {
                        const messageParts = [];

                        if (syncDirection === 'upload') {
                            const fallbackFileName = resolveModelWeightFileName(currentModel) || `model-${modelId}.pt`;
                            const uploadResult = await uploadModelFromBackendToStorage({
                                modelId,
                                targetStorage,
                                fallbackFileName,
                                subdir: (window.APP_CONFIG && window.APP_CONFIG.MODEL_UPLOAD_SUBDIR) || 'web-models',
                            });

                            const requestBaiduUpload = shouldUploadToBaidu(targetStorage);
                            const requestRemoteCoreUpload = isRemoteCoreStorageServer(targetStorage);
                            let effectiveTargetStorage = targetStorage;

                            if (requestBaiduUpload) {
                                const baiduUploaded = isTruthyFlag(uploadResult && uploadResult.baidu_uploaded);
                                if (!baiduUploaded) {
                                    throw new Error('上传到百度网盘失败，请检查后端百度网盘配置。');
                                }
                            }
                            if (requestRemoteCoreUpload) {
                                const coreUploaded = isTruthyFlag(uploadResult && uploadResult.core_uploaded);
                                if (!coreUploaded) {
                                    throw new Error(`已选择远程服务器 ${targetStorage}，但远程上传失败（core_uploaded=false）。`);
                                }
                                const returnedCoreKey = String(uploadResult && uploadResult.core_server_key || '').trim();
                                if (returnedCoreKey) {
                                    effectiveTargetStorage = normalizeStorageServerValue(returnedCoreKey);
                                }
                            }

                            const remotePath = requestBaiduUpload
                                ? String(uploadResult && (uploadResult.baidu_path || uploadResult.saved_path) || '').trim()
                                : (requestRemoteCoreUpload
                                    ? String(uploadResult && (uploadResult.core_remote_path || uploadResult.saved_path) || '').trim()
                                    : String(uploadResult && uploadResult.saved_path || '').trim());
                            const targetLabel = requestRemoteCoreUpload
                                ? String(uploadResult && uploadResult.core_server_key || targetStorage).trim() || targetStorage
                                : formatStorageServerLabel(targetStorage);
                            if (remotePath) {
                                messageParts.push(`已上传到${targetLabel}：${remotePath}`);
                            } else {
                                messageParts.push(`已完成上传到${targetLabel}`);
                            }

                            const serversToAdd = [effectiveTargetStorage].filter((value) => !currentNormalizedSet.has(value));
                            if (serversToAdd.length) {
                                await syncStorageServersForEntity('models', modelId, serversToAdd);
                                messageParts.push(`已更新存储标记：${serversToAdd.map(formatStorageServerLabel).join('、')}`);
                            }
                        } else {
                            if (!shouldUploadToBaidu(sourceStorage)) {
                                throw new Error(`当前仅支持从百度网盘下载到本地，暂不支持从 ${formatStorageServerLabel(sourceStorage)} 下载。`);
                            }
                            if (!downloadPlan || !String(downloadPlan.remotePath || '').trim()) {
                                throw new Error('请选择百度网盘文件路径后再同步到本地。');
                            }

                            const downloadResult = await downloadFromBaiduToLocal(downloadPlan);
                            const localPath = String(downloadResult && downloadResult.local_path || '').trim();
                            if (localPath) {
                                messageParts.push(`已下载到本地：${localPath}`);
                            } else {
                                messageParts.push('已完成百度网盘下载到本地');
                            }
                            const serversToAdd = [targetStorage].filter((value) => !currentNormalizedSet.has(value));
                            if (serversToAdd.length) {
                                await syncStorageServersForEntity('models', modelId, serversToAdd);
                                messageParts.push(`已更新存储标记：${serversToAdd.map(formatStorageServerLabel).join('、')}`);
                            }
                        }

                        showAlert(messageSlot, `模型“${modelName}”同步成功：${messageParts.join('；')}。`, 'info');
                        await fetchModels();
                    } catch (error) {
                        showAlert(messageSlot, `模型“${modelName}”同步失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                    return;
                }

                if (action === 'delete') {
                    const modelName = String(currentModel.name || '').trim() || `#${modelId}`;
                    const fileName = resolveModelWeightFileName(currentModel);
                    if (!fileName) {
                        showAlert(messageSlot, `模型“${modelName}”缺少 weight_name/file_name，无法调用删除接口。`, 'error');
                        return;
                    }

                    const confirmModal = ensureDangerConfirmModal();
                    const confirmed = await confirmModal.open({
                        title: '删除模型',
                        subtitle: '将调用 DELETE /v1/models/by-filename，并尝试删除后端本地权重文件。',
                        message: `确认删除模型“${modelName}”吗？该操作不可撤销。`,
                        detail: `file_name = ${fileName}`,
                        note: '注：该接口只能删除本地存储（backend）中的内容，不会删除百度网盘等远端存储文件。',
                        confirmText: '确认删除',
                    });
                    if (!confirmed) return;

                    actionBtn.disabled = true;
                    try {
                        const result = await apiRequest('/models/by-filename', {
                            method: 'DELETE',
                            query: { file_name: fileName },
                        });
                        const deletedRecords = Number(result && result.deleted_records);
                        const localFileDeleted = result && typeof result === 'object' && result.local_file_deleted;
                        const summaryParts = [];
                        if (Number.isFinite(deletedRecords) && deletedRecords >= 0) {
                            summaryParts.push(`数据库记录删除 ${deletedRecords} 条`);
                        }
                        if (localFileDeleted === true) {
                            summaryParts.push('本地权重文件已删除');
                        } else if (localFileDeleted === false) {
                            summaryParts.push('本地权重文件未删除');
                        }

                        const baseMessage = String(result && result.message || '').trim() || '删除成功';
                        const extraMessage = summaryParts.length ? `（${summaryParts.join('，')}）` : '';
                        showAlert(messageSlot, `模型“${modelName}”${baseMessage}${extraMessage}。`, 'info');
                        await fetchModels();
                    } catch (error) {
                        showAlert(messageSlot, `模型“${modelName}”删除失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                    return;
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

        const normalizeModelSeriesName = (value) => {
            const text = String(value || '').trim().toLowerCase();
            if (!text) return '';
            return text
                .replace(/_+v?\d+(?:\.\d+)*$/i, '')
                .replace(/_+$/g, '');
        };

        const isSameModelSeries = (candidateName, targetName) => {
            const candidate = String(candidateName || '').trim().toLowerCase();
            const target = String(targetName || '').trim().toLowerCase();
            if (!candidate || !target) return false;
            if (candidate === target) return true;

            const candidateBase = normalizeModelSeriesName(candidate);
            const targetBase = normalizeModelSeriesName(target);
            if (!candidateBase || !targetBase) return false;
            return candidateBase === targetBase;
        };

        const parseVersionFromModelRecord = (model) => {
            const direct = parseVersionAsNumber(model && model.version);
            if (Number.isFinite(direct) && direct > 0) return direct;

            const nameText = String(model && model.name || '').trim();
            const nameMatch = nameText.match(/_+v?(\d+(?:\.\d+)*)$/i);
            if (!nameMatch || !nameMatch[1]) return NaN;

            const fromName = parseVersionAsNumber(nameMatch[1]);
            return Number.isFinite(fromName) && fromName > 0 ? fromName : NaN;
        };

        const fetchVersionSuggestionForModelName = async (modelName) => {
            const safeName = String(modelName || '').trim();
            if (!safeName) return '1.0';

            const candidates = [];
            try {
                const data = await apiRequest('/models', {
                    query: {
                        page: 1,
                        page_size: 200,
                        keyword: safeName,
                    },
                });
                const list = Array.isArray(data && data.list) ? data.list : [];
                list.forEach((item) => candidates.push(item));
            } catch (error) {
                // 网络异常时回退当前页数据，避免阻塞导入流程。
            }

            if (Array.isArray(state.rows)) {
                state.rows.forEach((item) => candidates.push(item));
            }

            const versionNumbers = candidates
                .filter((item) => isSameModelSeries(item && item.name, safeName))
                .map((item) => parseVersionFromModelRecord(item))
                .filter((value) => Number.isFinite(value) && value > 0);

            const maxVersion = versionNumbers.length ? Math.max(...versionNumbers) : 0;
            const nextVersion = maxVersion > 0 ? (maxVersion + 1) : 1;
            return nextVersion.toFixed(1);
        };

        const refreshModelSizeField = () => {
            if (!modelSizeInput) return;
            if (!selectedModelFile) {
                modelSizeInput.value = '';
                return;
            }
            modelSizeInput.value = bytesToMB(selectedModelFile.size);
        };

        const refreshComputedWeightName = () => {
            if (!modelPathInput) return;
            const modelName = normalizeWeightBaseName(modelNameInput && modelNameInput.value);
            if (!modelName) {
                modelPathInput.value = '';
                return;
            }

            const versionText = formatVersionAsSingleDecimal(modelVersionInput && modelVersionInput.value);
            const fileExt = getFileExtension(selectedModelFile && selectedModelFile.name)
                || getFileExtension(modelPathInput.value)
                || '.pt';
            const versionSuffix = versionText ? `_v${versionText}` : '';
            const computed = `${modelName}${versionSuffix}${fileExt}`;
            modelPathInput.value = stripTrailingHashFromWeightName(computed);
        };

        const normalizeVersionInput = ({
            allowEmpty = false,
        } = {}) => {
            if (!modelVersionInput) {
                return { ok: true, text: '', number: NaN };
            }

            const rawText = String(modelVersionInput.value || '').trim();
            if (!rawText) {
                modelVersionInput.setCustomValidity(allowEmpty ? '' : '请输入版本号（x.x）。');
                return { ok: allowEmpty, text: '', number: NaN };
            }

            const versionText = formatVersionAsSingleDecimal(rawText);
            if (!versionText) {
                modelVersionInput.setCustomValidity('版本格式必须为 x.x，例如 1.0。');
                return { ok: false, text: '', number: NaN };
            }

            modelVersionInput.value = versionText;
            modelVersionInput.setCustomValidity('');
            return { ok: true, text: versionText, number: Number(versionText) };
        };

        const applySuggestedVersionFromName = async ({
            force = false,
        } = {}) => {
            if (!modelNameInput || !modelVersionInput) return;

            const modelName = String(modelNameInput.value || '').trim();
            if (!modelName) return;

            const currentVersionText = String(modelVersionInput.value || '').trim();
            const canOverwrite = force || !currentVersionText || modelVersionInput.dataset.autoFilled === '1';
            if (!canOverwrite) return;

            const requestSeq = ++versionSuggestSeq;
            const suggestedVersion = await fetchVersionSuggestionForModelName(modelName);
            if (requestSeq !== versionSuggestSeq) return;

            modelVersionInput.value = suggestedVersion;
            modelVersionInput.dataset.autoFilled = '1';
            modelVersionInput.setCustomValidity('');
            refreshComputedWeightName();
        };

        const scheduleVersionSuggestion = ({
            force = false,
        } = {}) => {
            clearTimeout(versionSuggestTimer);
            versionSuggestTimer = setTimeout(() => {
                applySuggestedVersionFromName({ force }).catch(() => {});
            }, 280);
        };

        const openImportModal = async () => {
            if (!importModal) return;
            importModal.hidden = false;
            setImportFeedback('');
            await populateStorageServerSelects(importModal, { force: true });
            versionSuggestSeq += 1;
            if (modelVersionInput) {
                modelVersionInput.dataset.autoFilled = '1';
                modelVersionInput.setCustomValidity('');
            }
            refreshModelSizeField();
            refreshComputedWeightName();
            const firstInput = importModal.querySelector('input[name="name"]');
            if (firstInput) firstInput.focus();
        };

        const closeImportModal = () => {
            if (!importModal) return;
            importModal.hidden = true;
            setImportFeedback('');
            clearTimeout(versionSuggestTimer);
            versionSuggestSeq += 1;
            selectedModelFile = null;
            if (importForm) importForm.reset();
            if (modelVersionInput) {
                modelVersionInput.dataset.autoFilled = '1';
                modelVersionInput.setCustomValidity('');
            }
            refreshModelSizeField();
            refreshComputedWeightName();
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
                    modelNameInput.value = suggestModelNameFromWeightFile(file.name);
                }
                refreshModelSizeField();
                scheduleVersionSuggestion();
                refreshComputedWeightName();
                if (modelImplTypeInput && !modelImplTypeInput.value.trim()) {
                    const ext = (file.name.split('.').pop() || '').toLowerCase();
                    if (ext === 'onnx') modelImplTypeInput.value = 'onnxruntime';
                    if (ext === 'pt' || ext === 'pth' || ext === 'ckpt') modelImplTypeInput.value = 'pytorch';
                    if (ext === 'engine' || ext === 'trt') modelImplTypeInput.value = 'tensorrt';
                    if (ext === 'bin') modelImplTypeInput.value = 'binary_model';
                }
            },
        });

        if (modelNameInput) {
            modelNameInput.addEventListener('input', () => {
                clearTimeout(versionSuggestTimer);
                scheduleVersionSuggestion();
                refreshComputedWeightName();
            });
            modelNameInput.addEventListener('blur', () => {
                clearTimeout(versionSuggestTimer);
                applySuggestedVersionFromName({ force: false }).catch(() => {});
                refreshComputedWeightName();
            });
        }

        if (modelVersionInput) {
            modelVersionInput.addEventListener('input', () => {
                modelVersionInput.dataset.autoFilled = '0';
                modelVersionInput.setCustomValidity('');
                refreshComputedWeightName();
            });
            modelVersionInput.addEventListener('blur', () => {
                normalizeVersionInput({ allowEmpty: true });
                refreshComputedWeightName();
            });
        }

        if (importForm) {
            importForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (
                    modelNameInput
                    && modelVersionInput
                    && String(modelNameInput.value || '').trim()
                    && !String(modelVersionInput.value || '').trim()
                ) {
                    await applySuggestedVersionFromName({ force: true });
                }
                normalizeVersionInput({ allowEmpty: true });
                refreshComputedWeightName();
                if (!importForm.checkValidity()) {
                    importForm.reportValidity();
                    return;
                }

                const submitBtn = importForm.querySelector('[data-model-import-submit]');
                const originalSubmitText = submitBtn ? submitBtn.innerHTML : '';

                const formData = new FormData(importForm);
                const versionResult = normalizeVersionInput();
                if (!versionResult.ok) {
                    if (modelVersionInput) {
                        modelVersionInput.reportValidity();
                    }
                    setImportFeedback('版本格式必须为 x.x，例如 1.0。', 'error');
                    return;
                }

                if (!(selectedModelFile instanceof File)) {
                    setImportFeedback('请先选择模型文件后再提交。', 'error');
                    return;
                }

                const sizeMbRaw = String(formData.get('size_mb') || '').trim();
                const sizeMb = Number(sizeMbRaw.replace(',', '.'));
                if (!Number.isFinite(sizeMb) || sizeMb <= 0) {
                    setImportFeedback('`size_mb` 必须是大于 0 的数字。', 'error');
                    return;
                }

                let resolvedStorageServer = normalizeStorageServerValue(formData.get('storage_server'))
                    || String(formData.get('storage_server') || '').trim();
                const requestedStorageServers = uniqueStorageServers([resolvedStorageServer, 'backend']);
                const resolvedWeightName = stripTrailingHashFromWeightName(String(
                    formData.get('model_path')
                    || (modelPathInput && modelPathInput.value)
                    || '',
                ).trim());
                if (!resolvedWeightName) {
                    setImportFeedback('请先填写模型名称并确认版本，系统会自动生成保存权重名称。', 'error');
                    return;
                }

                let resolvedModelPath = resolvedWeightName;
                let resolvedSizeMb = sizeMb;
                const syncBaiduWhenRemote = modelSyncBaiduWhenRemoteCheckbox
                    ? isTruthyFlag(formData.get('sync_baidu_when_remote'))
                    : false;
                const { requestBaiduUpload, requestRemoteCoreUpload } = resolveModelUploadRoute(
                    resolvedStorageServer,
                    { syncBaiduWhenRemote },
                );
                let baiduUploaded = false;
                let coreUploaded = false;
                let coreServerKey = '';

                const payload = {
                    name: String(formData.get('name') || '').trim(),
                    storage_server: resolvedStorageServer,
                    model_path: resolvedModelPath,
                    weight_name: resolvedWeightName,
                    storage_servers: requestedStorageServers,
                    impl_type: String(formData.get('impl_type') || '').trim(),
                    size_mb: resolvedSizeMb,
                    version: versionResult.number,
                    task_type: String(formData.get('task_type') || '').trim(),
                };

                const description = String(formData.get('description') || '').trim();
                if (description) {
                    payload.description = description;
                }
                if (!payload.description) {
                    payload.description = `Selected local file: ${selectedModelFile.name}`;
                }

                try {
                    if (submitBtn) {
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 导入中';
                    }

                    setImportFeedback('正在上传模型文件...', 'info');
                    const uploadResult = await uploadFileViaApi('/models/upload', {
                        file: selectedModelFile,
                        targetFileName: resolvedWeightName,
                        storageServer: resolvedStorageServer,
                        subdir: (window.APP_CONFIG && window.APP_CONFIG.MODEL_UPLOAD_SUBDIR) || 'web-models',
                        uploadToBaidu: requestBaiduUpload,
                    });

                    baiduUploaded = isTruthyFlag(uploadResult && uploadResult.baidu_uploaded);
                    if (requestBaiduUpload && !baiduUploaded) {
                        throw new Error('已选择百度网盘，但网盘上传失败，请检查后端百度网盘配置。');
                    }
                    coreUploaded = isTruthyFlag(uploadResult && uploadResult.core_uploaded);
                    coreServerKey = String(uploadResult && uploadResult.core_server_key || '').trim();
                    if (requestRemoteCoreUpload && !coreUploaded) {
                        throw new Error('已选择远程服务器，但远程上传失败（core_uploaded=false）。');
                    }
                    if (requestRemoteCoreUpload && coreServerKey) {
                        resolvedStorageServer = coreServerKey;
                        payload.storage_server = resolvedStorageServer;
                        payload.storage_servers = uniqueStorageServers([resolvedStorageServer, 'backend']);
                    }

                    const baiduPath = String(uploadResult && uploadResult.baidu_path || '').trim();
                    const coreRemotePath = String(uploadResult && uploadResult.core_remote_path || '').trim();
                    const savedPath = String(uploadResult && uploadResult.saved_path || '').trim();
                    const preferredPath = requestRemoteCoreUpload
                        ? (coreRemotePath || savedPath)
                        : (requestBaiduUpload ? (baiduPath || savedPath) : savedPath);
                    if (preferredPath) {
                        resolvedModelPath = String(preferredPath);
                        payload.model_path = resolvedModelPath;
                    }

                    if (!payload.model_path) {
                        throw new Error('文件上传成功但未返回保存路径(saved_path)');
                    }
                    if (requestRemoteCoreUpload && requestBaiduUpload) {
                        const remoteLabel = String(coreServerKey || resolvedStorageServer || '').trim();
                        const remoteDetail = coreRemotePath ? `（远端路径：${coreRemotePath}）` : '';
                        const detail = baiduPath ? `（网盘路径：${baiduPath}）` : '';
                        setImportFeedback(`文件上传成功，已同步到远程服务器 ${remoteLabel}${remoteDetail}，并同步到百度网盘${detail}，正在创建模型记录...`, 'info');
                    } else if (requestBaiduUpload) {
                        const detail = baiduPath ? `（网盘路径：${baiduPath}）` : '';
                        setImportFeedback(`文件上传成功，已同步到百度网盘${detail}，正在创建模型记录...`, 'info');
                    } else if (requestRemoteCoreUpload) {
                        const remoteLabel = String(coreServerKey || resolvedStorageServer || '').trim();
                        const detail = coreRemotePath ? `（远端路径：${coreRemotePath}）` : '';
                        setImportFeedback(`文件上传成功，已同步到远程服务器 ${remoteLabel}${detail}，正在创建模型记录...`, 'info');
                    } else {
                        setImportFeedback('文件上传成功，正在创建模型记录...', 'info');
                    }

                    const createdModel = await apiRequest('/models', {
                        method: 'POST',
                        body: payload,
                    });

                    let syncWarning = '';
                    const createdModelId = getCreatedEntityId(createdModel);
                    const storageServersForSync = uniqueStorageServers([
                        'backend',
                        ...getStorageServersForSync(resolvedStorageServer, {
                            requestBaiduUpload,
                            baiduUploaded,
                        }),
                    ]);
                    const storageServerText = storageServersForSync.join(', ');

                    if (createdModelId) {
                        try {
                            await syncStorageServersForEntity('models', createdModelId, storageServersForSync);
                        } catch (syncError) {
                            syncWarning = `模型已创建，但存储服务同步失败：${syncError.message}`;
                        }
                    } else {
                        syncWarning = '模型已创建，但未获取到记录 ID，无法同步存储服务。';
                    }

                    showAlert(
                        messageSlot,
                        syncWarning || `模型导入成功（storage_servers: ${storageServerText}），列表已刷新。`,
                        syncWarning ? 'error' : 'info',
                    );
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

        populateStorageServerSelects(importModal);
        updateSortIndicator();
        fetchModels();
    }

    function initDatasetManagementPage() {
        const table = document.querySelector('[data-dataset-table]');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const searchInput = document.querySelector('[data-dataset-search-input]');
        const searchBtn = document.querySelector('[data-dataset-search-btn]');
        const uploadOpenBtn = document.querySelector('[data-dataset-upload-open]');
        const refreshBtn = document.querySelector('[data-dataset-refresh-btn]');
        const pageSizeSelect = document.querySelector('[data-dataset-page-size]');
        const totalItemsSpan = document.querySelector('[data-dataset-total-items]');
        const paginationControls = document.querySelector('[data-dataset-pagination]');
        const messageSlot = document.querySelector('[data-dataset-message]');
        const sizeSortHeader = document.querySelector('[data-dataset-sort="size"]');
        const datasetApiBase = document.querySelector('[data-dataset-api-base]');

        const uploadModal = document.querySelector('[data-dataset-upload-modal]');
        const uploadCloseBtns = document.querySelectorAll('[data-dataset-upload-close]');
        const uploadForm = document.querySelector('[data-dataset-upload-form]');
        const uploadFeedback = document.querySelector('[data-dataset-upload-feedback]');
        const datasetFileDropzone = document.querySelector('[data-dataset-file-dropzone]');
        const datasetFileInput = document.querySelector('[data-dataset-file-input]');
        const datasetFileHint = document.querySelector('[data-dataset-file-hint]');
        const datasetNameInput = document.querySelector('#dataset-name');
        const datasetVersionInput = document.querySelector('#dataset-version');
        const datasetSizeInput = document.querySelector('#dataset-size-mb');
        const datasetPathInput = document.querySelector('#dataset-path');
        const datasetFormatInput = document.querySelector('#dataset-format');
        const datasetStorageServerSelect = document.querySelector('#dataset-storage-server');

        if (datasetApiBase) {
            datasetApiBase.textContent = apiBaseUrl;
        }

        const state = {
            page: 1,
            pageSize: Number(pageSizeSelect && pageSizeSelect.value) || 10,
            keyword: '',
            sizeSort: '',
            total: 0,
            rows: [],
            loading: false,
        };

        let searchTimer = null;
        let selectedDatasetFile = null;
        let datasetVersionSuggestTimer = null;
        let datasetVersionSuggestSeq = 0;
        const datasetDefaultFileHint = '支持拖拽/点选，提交时会先调用文件上传接口，再写入数据集元数据。';

        const setLoadingState = (loading) => {
            state.loading = loading;
            [
                searchBtn,
                uploadOpenBtn,
                refreshBtn,
                pageSizeSelect,
            ].forEach((el) => {
                if (el) el.disabled = loading;
            });
        };

        const renderPlaceholderRow = (message) => {
            tbody.innerHTML = `<tr><td colspan="7" class="table-state">${escapeHtml(message)}</td></tr>`;
        };

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

        const formatDatasetSizeForInput = (rawMb) => {
            const value = Number(rawMb);
            if (!Number.isFinite(value) || value <= 0) return '0.01';
            const normalized = Math.max(value, 0.01);
            return normalized >= 100
                ? String(Number(normalized.toFixed(0)))
                : String(Number(normalized.toFixed(2)));
        };

        const refreshDatasetSizeField = () => {
            if (!datasetSizeInput) return;
            datasetSizeInput.readOnly = true;
            if (!(selectedDatasetFile instanceof File)) {
                datasetSizeInput.value = '';
                return;
            }
            const sizeMb = Math.max(Number(bytesToMB(selectedDatasetFile.size)), 0.01);
            datasetSizeInput.value = formatDatasetSizeForInput(sizeMb);
        };

        const normalizeDatasetSeriesName = (value) => {
            const text = String(value || '').trim().toLowerCase();
            if (!text) return '';
            return text
                .replace(/_+v?\d+(?:\.\d+)*$/i, '')
                .replace(/_+$/g, '');
        };

        const isSameDatasetSeries = (candidateName, targetName) => {
            const candidate = String(candidateName || '').trim().toLowerCase();
            const target = String(targetName || '').trim().toLowerCase();
            if (!candidate || !target) return false;
            if (candidate === target) return true;

            const candidateBase = normalizeDatasetSeriesName(candidate);
            const targetBase = normalizeDatasetSeriesName(target);
            if (!candidateBase || !targetBase) return false;
            return candidateBase === targetBase;
        };

        const parseVersionFromDatasetRecord = (dataset) => {
            const direct = parseVersionAsNumber(dataset && dataset.version);
            if (Number.isFinite(direct) && direct > 0) return direct;

            const nameText = String(dataset && dataset.name || '').trim();
            const nameMatch = nameText.match(/_+v?(\d+(?:\.\d+)*)$/i);
            if (!nameMatch || !nameMatch[1]) return NaN;

            const fromName = parseVersionAsNumber(nameMatch[1]);
            return Number.isFinite(fromName) && fromName > 0 ? fromName : NaN;
        };

        const fetchVersionSuggestionForDatasetName = async (datasetName) => {
            const safeName = String(datasetName || '').trim();
            if (!safeName) return '1.0';

            const candidates = [];
            try {
                const data = await apiRequest('/datasets', {
                    query: {
                        page: 1,
                        page_size: 200,
                        keyword: safeName,
                    },
                });
                const list = Array.isArray(data && data.list) ? data.list : [];
                list.forEach((item) => candidates.push(item));
            } catch (error) {
                // 网络异常时回退当前页数据，避免阻塞上传流程。
            }

            if (Array.isArray(state.rows)) {
                state.rows.forEach((item) => candidates.push(item));
            }

            const versionNumbers = candidates
                .filter((item) => isSameDatasetSeries(item && item.name, safeName))
                .map((item) => parseVersionFromDatasetRecord(item))
                .filter((value) => Number.isFinite(value) && value > 0);

            const maxVersion = versionNumbers.length ? Math.max(...versionNumbers) : 0;
            const nextVersion = maxVersion > 0 ? (maxVersion + 1) : 1;
            return nextVersion.toFixed(1);
        };

        const applySuggestedDatasetVersion = async ({
            force = false,
        } = {}) => {
            if (!datasetNameInput || !datasetVersionInput) return;

            const datasetName = String(datasetNameInput.value || '').trim();
            const currentVersionText = String(datasetVersionInput.value || '').trim();
            const canOverwrite = force || !currentVersionText || datasetVersionInput.dataset.autoFilled === '1';
            if (!canOverwrite) return;

            if (!datasetName) {
                datasetVersionInput.value = '1.0';
                datasetVersionInput.dataset.autoFilled = '1';
                return;
            }

            const requestSeq = ++datasetVersionSuggestSeq;
            const suggestedVersion = await fetchVersionSuggestionForDatasetName(datasetName);
            if (requestSeq !== datasetVersionSuggestSeq) return;

            datasetVersionInput.value = suggestedVersion || '1.0';
            datasetVersionInput.dataset.autoFilled = '1';
        };

        const scheduleDatasetVersionSuggestion = ({
            force = false,
        } = {}) => {
            clearTimeout(datasetVersionSuggestTimer);
            datasetVersionSuggestTimer = setTimeout(() => {
                applySuggestedDatasetVersion({ force }).catch(() => {});
            }, 280);
        };

        const resolveDatasetSizeValue = (dataset) => {
            const candidates = [
                dataset && dataset.size_mb,
                dataset && dataset.dataset_size_mb,
                dataset && dataset.sizeMB,
                dataset && dataset.sizeMb,
                dataset && dataset.size,
            ];
            for (let i = 0; i < candidates.length; i += 1) {
                const value = Number(candidates[i]);
                if (Number.isFinite(value) && value >= 0) return value;
            }
            return null;
        };

        const resolveDatasetCreatedAt = (dataset) => {
            const candidates = [
                dataset && dataset.created_at,
                dataset && dataset.createdAt,
                dataset && dataset.created_time,
                dataset && dataset.createdTime,
                dataset && dataset.create_time,
                dataset && dataset.createTime,
                dataset && dataset.upload_time,
                dataset && dataset.uploadTime,
            ];
            for (let i = 0; i < candidates.length; i += 1) {
                const value = candidates[i];
                if (value) return value;
            }
            return '';
        };

        const resolveDatasetSampleCount = (dataset) => {
            const directCandidates = [
                dataset && dataset.sample_count,
                dataset && dataset.samples,
                dataset && dataset.num_samples,
                dataset && dataset.total_samples,
                dataset && dataset.total_count,
            ];
            for (let i = 0; i < directCandidates.length; i += 1) {
                const value = Number(directCandidates[i]);
                if (Number.isFinite(value) && value >= 0) return Math.round(value);
            }

            const train = Number(dataset && dataset.train_count);
            const val = Number(dataset && dataset.val_count);
            const test = Number(dataset && dataset.test_count);
            const hasAny = [train, val, test].some((value) => Number.isFinite(value) && value >= 0);
            if (!hasAny) return null;
            return [train, val, test].reduce((sum, value) => {
                if (!Number.isFinite(value) || value < 0) return sum;
                return sum + Math.round(value);
            }, 0);
        };

        const formatDatasetVersionText = (dataset) => {
            const candidates = [
                dataset && dataset.version,
                dataset && dataset.dataset_version,
                dataset && dataset.ver,
            ];
            for (let i = 0; i < candidates.length; i += 1) {
                const raw = String(candidates[i] == null ? '' : candidates[i]).trim();
                if (!raw) continue;
                if (/^v/i.test(raw)) return raw;
                if (/^\d/.test(raw)) return `v${raw}`;
                return raw;
            }
            return '--';
        };

        const formatDatasetCount = (value) => {
            const num = Number(value);
            if (!Number.isFinite(num) || num < 0) return '--';
            return Math.round(num).toLocaleString('en-US');
        };

        const getDatasetStatusMeta = (dataset) => {
            const sizeValue = resolveDatasetSizeValue(dataset);
            const hasPath = Boolean(String(dataset && dataset.dataset_path || '').trim());
            if (Number.isFinite(sizeValue) && sizeValue > 0 && hasPath) {
                return { cls: 'success', text: '可用' };
            }
            if (hasPath) {
                return { cls: 'processing', text: '已登记' };
            }
            return { cls: 'error', text: '不可用' };
        };

        const getDatasetLabelColorIndex = (label) => {
            const text = String(label || '');
            let hash = 0;
            for (let i = 0; i < text.length; i += 1) {
                hash = ((hash * 31) + text.charCodeAt(i)) >>> 0;
            }
            return hash % 6;
        };

        const getDatasetNameLabels = (dataset) => {
            const storageServers = parseStorageServers(
                dataset && dataset.storage_servers,
                dataset && dataset.storage_server,
            );
            return storageServers.map((value) => formatStorageServerLabel(value));
        };

        const getDatasetStorageAndFormatTags = (dataset) => {
            const tags = [];
            const storageServers = parseStorageServers(
                dataset && dataset.storage_servers,
                dataset && dataset.storage_server,
            );
            storageServers.forEach((value) => {
                tags.push(formatStorageServerLabel(value));
            });
            const formatText = String(
                (dataset && dataset.dataset_format)
                || (dataset && dataset.format)
                || '',
            ).trim();
            if (formatText) tags.push(formatText);
            if (!tags.length) tags.push('--');
            return tags;
        };

        const renderRows = () => {
            if (!Array.isArray(state.rows) || state.rows.length === 0) {
                renderPlaceholderRow('暂无数据集数据');
                return;
            }

            const html = state.rows.map((dataset) => {
                const datasetName = escapeHtml(dataset && dataset.name || '--');
                const versionText = formatDatasetVersionText(dataset);
                const version = escapeHtml(versionText);
                const sampleCount = escapeHtml(formatDatasetCount(resolveDatasetSampleCount(dataset)));
                const sizeText = escapeHtml(formatSizeMB(resolveDatasetSizeValue(dataset)));
                const createdAt = escapeHtml(formatDateTime(resolveDatasetCreatedAt(dataset)));
                const status = getDatasetStatusMeta(dataset);
                const rowId = Number(dataset && dataset.id) || '';
                const tags = getDatasetStorageAndFormatTags(dataset);
                const tagsHtml = tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
                const nameLabels = getDatasetNameLabels(dataset);
                const nameLabelsHtml = nameLabels.length
                    ? `<div class="model-name-labels">${nameLabels.map((label) => (
                        `<span class="model-name-chip model-name-chip-${getDatasetLabelColorIndex(label)}">${escapeHtml(label)}</span>`
                    )).join('')}</div>`
                    : '';

                return `
                    <tr data-dataset-row-id="${rowId}">
                        <td>
                            <div class="name-cell">
                                <div class="name-main">
                                    <span class="model-name-text">${datasetName}</span>
                                    <span class="badge secondary sm">${version}</span>
                                </div>
                                ${nameLabelsHtml}
                            </div>
                        </td>
                        <td>
                            <div class="tech-stack">
                                ${tagsHtml}
                            </div>
                        </td>
                        <td>${sampleCount}</td>
                        <td>${sizeText}</td>
                        <td><span class="badge ${status.cls}">${status.text}</span></td>
                        <td>${createdAt}</td>
                        <td>
                            <div class="action-wrapper">
                                <button class="btn-icon action-toggle" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                                <div class="action-menu">
                                    <button class="btn-icon" title="属性" data-dataset-action="properties" data-dataset-id="${rowId}"><i class="fa-solid fa-circle-info"></i></button>
                                    <button class="btn-icon download" title="下载数据集文件" data-dataset-action="download-file" data-dataset-id="${rowId}"><i class="fa-solid fa-download"></i></button>
                                    <button class="btn-icon cloud" title="同步存储服务" data-dataset-action="cloud-sync" data-dataset-id="${rowId}"><i class="fa-solid fa-cloud-arrow-up"></i></button>
                                    <button class="btn-icon delete" title="删除数据集" data-dataset-action="delete" data-dataset-id="${rowId}"><i class="fa-solid fa-trash"></i></button>
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
                fetchDatasets();
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
                    fetchDatasets();
                });
                paginationControls.appendChild(btn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.disabled = state.page >= totalPages || state.loading;
            nextBtn.addEventListener('click', () => {
                if (state.page >= totalPages) return;
                state.page += 1;
                fetchDatasets();
            });
            paginationControls.appendChild(nextBtn);
        };

        const updateSortIndicator = () => {
            if (!sizeSortHeader) return;
            sizeSortHeader.classList.remove('asc', 'desc');
            if (state.sizeSort === 'asc') sizeSortHeader.classList.add('asc');
            if (state.sizeSort === 'desc') sizeSortHeader.classList.add('desc');
        };

        async function fetchDatasets() {
            setLoadingState(true);
            renderPaginationControls();
            renderPlaceholderRow('数据集列表加载中...');
            clearAlert(messageSlot);

            try {
                const query = {
                    page: state.page,
                    page_size: state.pageSize,
                    keyword: state.keyword,
                };
                if (state.sizeSort) {
                    query.size_sort = state.sizeSort;
                }

                const data = await apiRequest('/datasets', { query });
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
                renderPlaceholderRow('数据集数据加载失败');
                renderPaginationControls();
                if (totalItemsSpan) {
                    totalItemsSpan.textContent = '0';
                }
                showAlert(messageSlot, `加载数据集失败: ${error.message}`, 'error');
            } finally {
                setLoadingState(false);
                renderPaginationControls();
            }
        }

        const applySearch = () => {
            state.keyword = String(searchInput && searchInput.value || '').trim();
            state.page = 1;
            fetchDatasets();
        };

        const openModal = async () => {
            if (!uploadModal) return;
            uploadModal.hidden = false;
            setFeedback('');
            await populateStorageServerSelects(uploadModal, { force: true });
            datasetVersionSuggestSeq += 1;
            if (datasetVersionInput) {
                datasetVersionInput.dataset.autoFilled = '1';
                if (!String(datasetVersionInput.value || '').trim()) {
                    datasetVersionInput.value = '1.0';
                }
            }
            refreshDatasetSizeField();
            if (datasetNameInput) datasetNameInput.focus();
        };

        const closeModal = () => {
            if (!uploadModal) return;
            uploadModal.hidden = true;
            selectedDatasetFile = null;
            setFeedback('');
            clearTimeout(datasetVersionSuggestTimer);
            datasetVersionSuggestSeq += 1;
            if (uploadForm) uploadForm.reset();
            if (datasetVersionInput) {
                datasetVersionInput.dataset.autoFilled = '1';
            }
            refreshDatasetSizeField();
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
                refreshDatasetSizeField();
                if (datasetPathInput && !datasetPathInput.value.trim()) {
                    datasetPathInput.value = `/uploads/datasets/${file.name}`;
                }
                if (datasetFormatInput && !datasetFormatInput.value.trim()) {
                    const ext = (file.name.split('.').pop() || '').toLowerCase();
                    if (ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === 'tgz' || ext === '7z') {
                        datasetFormatInput.value = 'archive';
                    }
                }
                scheduleDatasetVersionSuggestion({ force: true });
            },
        });

        if (datasetNameInput) {
            datasetNameInput.addEventListener('input', () => {
                clearTimeout(datasetVersionSuggestTimer);
                scheduleDatasetVersionSuggestion();
            });
            datasetNameInput.addEventListener('blur', () => {
                clearTimeout(datasetVersionSuggestTimer);
                applySuggestedDatasetVersion({ force: false }).catch(() => {});
            });
        }

        if (datasetVersionInput) {
            datasetVersionInput.addEventListener('input', () => {
                datasetVersionInput.dataset.autoFilled = '0';
            });
        }

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

        if (uploadOpenBtn) {
            uploadOpenBtn.addEventListener('click', openModal);
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                fetchDatasets();
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                const next = Number(e.target.value);
                state.pageSize = Number.isFinite(next) && next > 0 ? next : 10;
                state.page = 1;
                fetchDatasets();
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
                fetchDatasets();
            });
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

        const resolveDatasetRecordForEdit = async (detailPayload) => {
            const idCandidate = Number(detailPayload && (detailPayload.id || detailPayload.dataset_id));
            const name = String(detailPayload && detailPayload.name || '').trim();

            if (Number.isInteger(idCandidate) && idCandidate > 0) {
                const matchedInState = state.rows.find((item) => Number(item && item.id) === idCandidate);
                if (matchedInState) return matchedInState;
            }

            const query = {
                page: 1,
                page_size: 50,
            };
            if (name) {
                query.name = name;
            } else if (Number.isInteger(idCandidate) && idCandidate > 0) {
                query.keyword = String(idCandidate);
            } else {
                throw new Error('缺少数据集标识，无法编辑。');
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
                throw new Error('未解析到有效数据集 ID。');
            }
            return matched;
        };

        if (tbody) {
            tbody.addEventListener('click', async (e) => {
                const actionBtn = e.target.closest('[data-dataset-action]');
                if (!actionBtn) return;

                const action = String(actionBtn.dataset.datasetAction || '').trim();
                const datasetId = Number(actionBtn.dataset.datasetId);
                const currentDataset = state.rows.find((item) => Number(item.id) === datasetId);
                const wrapper = actionBtn.closest('.action-wrapper');
                if (wrapper) wrapper.classList.remove('expanded');

                if (!currentDataset) {
                    showAlert(messageSlot, '未找到对应数据集，请刷新后重试。', 'error');
                    return;
                }

                if (action === 'properties') {
                    const showDatasetPropertyModal = (datasetDetail) => {
                        const detail = datasetDetail && typeof datasetDetail === 'object' ? datasetDetail : currentDataset;
                        const detailId = Number(detail && detail.id);
                        const effectiveId = Number.isInteger(detailId) && detailId > 0 ? detailId : datasetId;
                        const datasetName = String(detail && detail.name || '').trim() || `#${effectiveId}`;
                        const propertyTitle = `数据集属性 - ${datasetName}`;
                        openPropertyModal(propertyTitle, detail, {
                            editAction: {
                                label: '编辑数据集元信息',
                                handler: async (detailPayload) => {
                                    const sourceDataset = await resolveDatasetRecordForEdit(detailPayload || detail);
                                    const editModal = ensureDatasetMetadataEditModal();
                                    const patchPayload = await editModal.open({
                                        dataset: sourceDataset,
                                        title: `编辑数据集元信息 - ${datasetName}`,
                                    });
                                    if (!patchPayload) return;

                                    const submitIdRaw = Number(sourceDataset && sourceDataset.id);
                                    const submitId = Number.isInteger(submitIdRaw) && submitIdRaw > 0
                                        ? submitIdRaw
                                        : effectiveId;
                                    if (!Number.isInteger(submitId) || submitId <= 0) {
                                        throw new Error('未找到有效数据集 ID，无法更新。');
                                    }

                                    const updatedDataset = await apiRequest(`/datasets/${submitId}`, {
                                        method: 'PATCH',
                                        body: patchPayload,
                                    });

                                    const updatedName = String(updatedDataset && updatedDataset.name || datasetName).trim() || datasetName;
                                    showAlert(messageSlot, `数据集“${updatedName}”元信息更新成功。`, 'info');
                                    showDatasetPropertyModal(updatedDataset || sourceDataset);
                                    await fetchDatasets();
                                },
                            },
                        });
                    };

                    showDatasetPropertyModal(currentDataset);
                    return;
                }

                if (action === 'download-file') {
                    const datasetName = String(currentDataset.name || '').trim() || `#${datasetId}`;
                    const fallbackFileName = resolveDatasetFileName(currentDataset) || `dataset-${datasetId}`;
                    actionBtn.disabled = true;
                    try {
                        await downloadDatasetFileById(datasetId, fallbackFileName);
                        showAlert(messageSlot, `数据集“${datasetName}”下载已开始。`, 'info');
                    } catch (error) {
                        showAlert(messageSlot, `数据集“${datasetName}”下载失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                    return;
                }

                if (action === 'cloud-sync') {
                    const datasetName = String(currentDataset.name || '').trim() || `#${datasetId}`;
                    const currentServers = parseStorageServers(
                        currentDataset.storage_servers,
                        currentDataset.storage_server,
                    );
                    if (!currentServers.length) {
                        currentServers.push('backend');
                    }
                    const datasetPath = String(currentDataset.dataset_path || '').trim();
                    const allStorageOptions = await loadStorageServerOptions({ force: true });
                    const currentNormalizedSet = new Set(currentServers.map((value) => normalizeStorageServerValue(value)));
                    const normalizedAllOptions = normalizeStorageOptions(allStorageOptions);
                    const allOptionValues = uniqueStorageServers(normalizedAllOptions.map((item) => item.value));
                    const availableRemoteTargets = allOptionValues.filter((value) => {
                        const normalizedValue = normalizeStorageServerValue(value);
                        return normalizedValue && normalizedValue !== 'backend' && !currentNormalizedSet.has(normalizedValue);
                    });

                    let defaultSourceStorage = currentServers[0] || '';
                    if (currentServers.includes('backend')) {
                        defaultSourceStorage = 'backend';
                    } else if (currentServers.includes('baidu_netdisk')) {
                        defaultSourceStorage = 'baidu_netdisk';
                    }

                    let defaultTargetStorage = '';
                    if (normalizeStorageServerValue(defaultSourceStorage) === 'backend') {
                        if (availableRemoteTargets.includes('baidu_netdisk')) {
                            defaultTargetStorage = 'baidu_netdisk';
                        } else {
                            defaultTargetStorage = availableRemoteTargets[0] || '';
                        }
                    } else {
                        defaultTargetStorage = 'backend';
                    }

                    const defaultRemotePath = buildBaiduRemotePathForDataset(currentDataset);
                    const defaultFileName = resolveDatasetFileName(currentDataset) || getPathFileName(datasetPath);

                    const syncModal = ensureStorageSyncModal();
                    const syncPlan = await syncModal.open({
                        title: `数据集同步 - ${datasetName}`,
                        currentStorageServers: currentServers,
                        allStorageOptions,
                        defaultSourceStorage,
                        defaultTargetStorage,
                        defaultRemotePath,
                        defaultCategory: 'datasets',
                        defaultSubdir: 'sync',
                        defaultFileName,
                    });
                    if (!syncPlan) return;

                    const sourceStorage = normalizeStorageServerValue(syncPlan.sourceStorage);
                    const targetStorage = normalizeStorageServerValue(syncPlan.targetStorage);
                    const downloadPlan = syncPlan.download || null;
                    if (!sourceStorage || !targetStorage) {
                        showAlert(messageSlot, `数据集“${datasetName}”同步失败：请选择来源和目标存储。`, 'error');
                        return;
                    }
                    if (!currentNormalizedSet.has(sourceStorage)) {
                        showAlert(messageSlot, `数据集“${datasetName}”同步失败：来源存储不在当前数据集的已存储范围内。`, 'error');
                        return;
                    }
                    const syncDirection = getStorageSyncDirection(sourceStorage, targetStorage);
                    if (!syncDirection) {
                        showAlert(messageSlot, `数据集“${datasetName}”同步失败：仅支持“本地 -> 远端/网盘”或“远端/网盘 -> 本地”。`, 'error');
                        return;
                    }
                    if (syncDirection === 'upload' && currentNormalizedSet.has(targetStorage)) {
                        showAlert(messageSlot, `数据集“${datasetName}”同步失败：目标存储已存在，无需重复同步。`, 'error');
                        return;
                    }

                    actionBtn.disabled = true;
                    try {
                        const messageParts = [];

                        if (syncDirection === 'upload') {
                            const fallbackFileName = resolveDatasetFileName(currentDataset) || `dataset-${datasetId}.zip`;
                            const uploadResult = await uploadDatasetFromBackendToStorage({
                                datasetId,
                                targetStorage,
                                fallbackFileName,
                                subdir: (window.APP_CONFIG && window.APP_CONFIG.DATASET_UPLOAD_SUBDIR) || 'web-datasets',
                            });

                            const requestBaiduUpload = shouldUploadToBaidu(targetStorage);
                            const requestRemoteCoreUpload = isRemoteCoreStorageServer(targetStorage);
                            let effectiveTargetStorage = targetStorage;

                            if (requestBaiduUpload) {
                                const baiduUploaded = isTruthyFlag(uploadResult && uploadResult.baidu_uploaded);
                                if (!baiduUploaded) {
                                    throw new Error('上传到百度网盘失败，请检查后端百度网盘配置。');
                                }
                            }
                            if (requestRemoteCoreUpload) {
                                const coreUploaded = isTruthyFlag(uploadResult && uploadResult.core_uploaded);
                                if (!coreUploaded) {
                                    throw new Error(`已选择远程服务器 ${targetStorage}，但远程上传失败（core_uploaded=false）。`);
                                }
                                const returnedCoreKey = String(uploadResult && uploadResult.core_server_key || '').trim();
                                if (returnedCoreKey) {
                                    effectiveTargetStorage = normalizeStorageServerValue(returnedCoreKey);
                                }
                            }

                            const remotePath = requestBaiduUpload
                                ? String(uploadResult && (uploadResult.baidu_path || uploadResult.saved_path) || '').trim()
                                : (requestRemoteCoreUpload
                                    ? String(uploadResult && (uploadResult.core_remote_path || uploadResult.saved_path) || '').trim()
                                    : String(uploadResult && uploadResult.saved_path || '').trim());
                            const targetLabel = requestRemoteCoreUpload
                                ? String(uploadResult && uploadResult.core_server_key || targetStorage).trim() || targetStorage
                                : formatStorageServerLabel(targetStorage);
                            if (remotePath) {
                                messageParts.push(`已上传到${targetLabel}：${remotePath}`);
                            } else {
                                messageParts.push(`已完成上传到${targetLabel}`);
                            }

                            const serversToAdd = [effectiveTargetStorage].filter((value) => !currentNormalizedSet.has(value));
                            if (serversToAdd.length) {
                                await syncStorageServersForEntity('datasets', datasetId, serversToAdd);
                                messageParts.push(`已更新存储标记：${serversToAdd.map(formatStorageServerLabel).join('、')}`);
                            }
                        } else {
                            if (!shouldUploadToBaidu(sourceStorage)) {
                                throw new Error(`当前仅支持从百度网盘下载到本地，暂不支持从 ${formatStorageServerLabel(sourceStorage)} 下载。`);
                            }
                            if (!downloadPlan || !String(downloadPlan.remotePath || '').trim()) {
                                throw new Error('请选择百度网盘文件路径后再同步到本地。');
                            }

                            const downloadResult = await downloadFromBaiduToLocal(downloadPlan);
                            const localPath = String(downloadResult && downloadResult.local_path || '').trim();
                            if (localPath) {
                                messageParts.push(`已下载到本地：${localPath}`);
                            } else {
                                messageParts.push('已完成百度网盘下载到本地');
                            }
                            const serversToAdd = [targetStorage].filter((value) => !currentNormalizedSet.has(value));
                            if (serversToAdd.length) {
                                await syncStorageServersForEntity('datasets', datasetId, serversToAdd);
                                messageParts.push(`已更新存储标记：${serversToAdd.map(formatStorageServerLabel).join('、')}`);
                            }
                        }

                        showAlert(messageSlot, `数据集“${datasetName}”同步成功：${messageParts.join('；')}。`, 'info');
                        await fetchDatasets();
                    } catch (error) {
                        showAlert(messageSlot, `数据集“${datasetName}”同步失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                    return;
                }

                if (action === 'delete') {
                    const datasetName = String(currentDataset.name || '').trim() || `#${datasetId}`;
                    const fileName = resolveDatasetFileName(currentDataset);
                    if (!fileName) {
                        showAlert(messageSlot, `数据集“${datasetName}”缺少 file_name，无法调用删除接口。`, 'error');
                        return;
                    }

                    const confirmModal = ensureDangerConfirmModal();
                    const confirmed = await confirmModal.open({
                        title: '删除数据集',
                        subtitle: '将调用 DELETE /v1/datasets/by-filename，并尝试删除后端本地数据集文件。',
                        message: `确认删除数据集“${datasetName}”吗？该操作不可撤销。`,
                        detail: `file_name = ${fileName}`,
                        note: '注：该接口只能删除本地存储（backend）中的内容，不会删除百度网盘等远端存储文件。',
                        confirmText: '确认删除',
                    });
                    if (!confirmed) return;

                    actionBtn.disabled = true;
                    try {
                        const result = await apiRequest('/datasets/by-filename', {
                            method: 'DELETE',
                            query: { file_name: fileName },
                        });
                        const deletedRecords = Number(result && result.deleted_records);
                        const localFileDeleted = result && typeof result === 'object' && result.local_file_deleted;
                        const summaryParts = [];
                        if (Number.isFinite(deletedRecords) && deletedRecords >= 0) {
                            summaryParts.push(`数据库记录删除 ${deletedRecords} 条`);
                        }
                        if (localFileDeleted === true) {
                            summaryParts.push('本地数据集文件已删除');
                        } else if (localFileDeleted === false) {
                            summaryParts.push('本地数据集文件未删除');
                        }

                        const baseMessage = String(result && result.message || '').trim() || '删除成功';
                        const extraMessage = summaryParts.length ? `（${summaryParts.join('，')}）` : '';
                        showAlert(messageSlot, `数据集“${datasetName}”${baseMessage}${extraMessage}。`, 'info');
                        await fetchDatasets();
                    } catch (error) {
                        showAlert(messageSlot, `数据集“${datasetName}”删除失败：${error.message}`, 'error');
                    } finally {
                        actionBtn.disabled = false;
                    }
                    return;
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
                if (!(selectedDatasetFile instanceof File)) {
                    setFeedback('请先选择数据集文件后再提交。', 'error');
                    return;
                }

                const versionRaw = String(formData.get('version') || '').trim();
                const resolvedVersion = versionRaw || '1.0';
                if (!versionRaw && datasetVersionInput) {
                    datasetVersionInput.value = resolvedVersion;
                    datasetVersionInput.dataset.autoFilled = '1';
                }

                const sizeMb = Math.max(Number(bytesToMB(selectedDatasetFile.size)), 0.01);
                if (datasetSizeInput) {
                    datasetSizeInput.value = formatDatasetSizeForInput(sizeMb);
                }

                let resolvedStorageServer = normalizeStorageServerValue(formData.get('storage_server'))
                    || String(formData.get('storage_server') || '').trim();
                let resolvedDatasetPath = String(formData.get('dataset_path') || '').trim();
                let resolvedSizeMb = sizeMb;
                let resolvedFileName = String(selectedDatasetFile.name || '').trim();
                const requestBaiduUpload = shouldUploadToBaidu(resolvedStorageServer);
                let baiduUploaded = false;

                const payload = {
                    name: String(formData.get('name') || '').trim(),
                    storage_server: resolvedStorageServer,
                    task_type: String(formData.get('task_type') || '').trim(),
                    dataset_format: String(formData.get('dataset_format') || '').trim(),
                    dataset_path: resolvedDatasetPath,
                    version: resolvedVersion,
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
                        resolvedStorageServer = normalizeStorageServerValue(uploadResult.storage_server)
                            || String(uploadResult.storage_server || '').trim();
                        payload.storage_server = resolvedStorageServer;
                        if (datasetStorageServerSelect) {
                            datasetStorageServerSelect.value = resolvedStorageServer;
                        }
                    }
                    if (requestBaiduUpload) {
                        payload.storage_server = resolvedStorageServer;
                    }

                    const uploadedBytes = Number(uploadResult && uploadResult.size);
                    if (Number.isFinite(uploadedBytes) && uploadedBytes >= 0) {
                        resolvedSizeMb = Math.max(Number(bytesToMB(uploadedBytes)), 0.01);
                        payload.size_mb = resolvedSizeMb;
                        if (datasetSizeInput) {
                            datasetSizeInput.value = formatDatasetSizeForInput(resolvedSizeMb);
                        }
                    }

                    const serverFileName = String(
                        uploadResult && (
                            uploadResult.file_name
                            || uploadResult.filename
                            || getPathFileName(uploadResult.saved_path)
                        ) || '',
                    ).trim();
                    if (serverFileName) {
                        resolvedFileName = serverFileName;
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

                    if (!resolvedFileName) {
                        resolvedFileName = getPathFileName(resolvedDatasetPath);
                    }
                    if (resolvedFileName) {
                        payload.file_name = resolvedFileName;
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
                        syncWarning = '数据集已创建，但未获取到记录 ID，无法同步存储服务。';
                    }

                    showAlert(messageSlot, syncWarning || '数据集上传成功，列表已刷新。', syncWarning ? 'error' : 'info');
                    closeModal();
                    state.page = 1;
                    fetchDatasets();
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

        populateStorageServerSelects(uploadModal);
        updateSortIndicator();
        fetchDatasets();
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
});
