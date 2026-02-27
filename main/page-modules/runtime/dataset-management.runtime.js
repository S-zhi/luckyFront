/* Runtime module extracted from app.js for lazy loading. */
(function registerDatasetManagementRuntime(global) {
    if (!global) return;

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


    global.__LP_initDatasetManagementPage = initDatasetManagementPage;
})(window);
