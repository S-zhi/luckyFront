/* Runtime module extracted from app.js for lazy loading. */
(function registerModelManagementRuntime(global) {
    if (!global) return;

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


    global.__LP_initModelManagementPage = initModelManagementPage;
})(window);
