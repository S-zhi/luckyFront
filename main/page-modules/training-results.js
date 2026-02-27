export function initTrainingResultsPage(ctx = {}) {
    const {
        apiBaseUrl = '',
        apiRequest,
        escapeHtml = (value) => String(value == null ? '' : value),
        clearAlert = () => {},
        showAlert = () => {},
        openPropertyModal = () => {},
    } = ctx;

    if (typeof apiRequest !== 'function') return;
        const table = document.querySelector('[data-training-table]');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const searchInput = document.querySelector('[data-training-search-input]');
        const searchBtn = document.querySelector('[data-training-search-btn]');
        const modelIdInput = document.querySelector('[data-training-filter-model-id]');
        const datasetIdInput = document.querySelector('[data-training-filter-dataset-id]');
        const statusSelect = document.querySelector('[data-training-filter-status]');
        const resetBtn = document.querySelector('[data-training-filter-reset]');
        const refreshBtn = document.querySelector('[data-training-refresh-btn]');
        const pageSizeSelect = document.querySelector('[data-training-page-size]');
        const totalItemsSpan = document.querySelector('[data-training-total-items]');
        const paginationControls = document.querySelector('[data-training-pagination]');
        const messageSlot = document.querySelector('[data-training-message]');
        const apiBaseLabel = document.querySelector('[data-training-api-base]');

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
        };
        let searchTimer = null;

        const setLoadingState = (loading) => {
            state.loading = loading;
            [
                searchInput,
                searchBtn,
                modelIdInput,
                datasetIdInput,
                statusSelect,
                resetBtn,
                refreshBtn,
                pageSizeSelect,
            ].forEach((el) => {
                if (el) el.disabled = loading;
            });
        };

        const renderPlaceholderRow = (message) => {
            tbody.innerHTML = `<tr><td colspan="7" class="table-state">${escapeHtml(message)}</td></tr>`;
        };

        const parsePositiveInteger = (raw) => {
            const num = Number(raw);
            if (!Number.isInteger(num) || num <= 0) return null;
            return num;
        };

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

        const formatMetricValue = (value) => {
            const num = Number(value);
            if (Number.isFinite(num)) {
                const precision = Math.abs(num) >= 1 ? 3 : 4;
                return num.toFixed(precision).replace(/\.?0+$/, '');
            }
            return String(value);
        };

        const buildMetricTags = (item) => {
            const detail = parseMetricDetail(item && (item.metric_detail || item.metricDetail || item.metrics));
            if (!detail) return [];
            return Object.entries(detail)
                .filter(([key, val]) => key && val != null && val !== '')
                .slice(0, 4)
                .map(([key, val]) => `${key}: ${formatMetricValue(val)}`);
        };

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

            const normalized = String(statusValue == null ? '' : statusValue).trim().toLowerCase();
            if (!normalized) return { cls: 'secondary', text: '未知' };
            if (normalized.includes('success') || normalized.includes('completed') || normalized.includes('成功')) {
                return { cls: 'success', text: '成功' };
            }
            if (normalized.includes('running') || normalized.includes('processing') || normalized.includes('训练中')) {
                return { cls: 'processing', text: '训练中' };
            }
            if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('失败')) {
                return { cls: 'error', text: '失败' };
            }
            if (normalized.includes('interrupt') || normalized.includes('stopped') || normalized.includes('中断')) {
                return { cls: 'warning', text: '已中断' };
            }
            return { cls: 'secondary', text: String(statusValue) };
        };

        const truncateMiddle = (text, maxLength = 54) => {
            const str = String(text || '');
            if (str.length <= maxLength) return str;
            const keep = Math.max(8, Math.floor((maxLength - 3) / 2));
            return `${str.slice(0, keep)}...${str.slice(-keep)}`;
        };

        const renderRows = () => {
            if (!Array.isArray(state.rows) || state.rows.length === 0) {
                renderPlaceholderRow('暂无训练结果');
                return;
            }

            const html = state.rows.map((item) => {
                const taskIdRaw = item.id ?? item.training_id ?? item.task_id ?? '--';
                const modelIdRaw = item.model_id ?? item.training_model_id ?? '--';
                const datasetIdRaw = item.dataset_id ?? item.training_dataset_id ?? '--';
                const datasetVersionRaw = item.dataset_version ?? item.dataset_ver ?? '--';
                const status = getTrainingStatusMeta(item.training_status ?? item.status);
                const metricTags = buildMetricTags(item);
                const metricsHtml = metricTags.length
                    ? metricTags.map((tagText) => `<span class="tag">${escapeHtml(tagText)}</span>`).join('')
                    : '<span class="tag">--</span>';
                const weightPath = String(item.weight_path || item.weightPath || '').trim();
                const weightPathDisplay = weightPath ? escapeHtml(truncateMiddle(weightPath)) : '--';
                const cometUrl = String(item.comet_log_url || item.comet_url || '').trim();
                const datasetVersionText = String(datasetVersionRaw == null ? '--' : datasetVersionRaw).trim() || '--';
                const datasetBadgeText = datasetVersionText === '--'
                    ? '--'
                    : (datasetVersionText.toLowerCase().startsWith('v') ? datasetVersionText : `v${datasetVersionText}`);
                const datasetNameText = datasetIdRaw === '--' ? '--' : `#${datasetIdRaw}`;
                const encodedWeightPath = encodeURIComponent(weightPath);
                const encodedCometUrl = encodeURIComponent(cometUrl);
                const encodedDetail = encodeURIComponent(JSON.stringify(item || {}));

                return `
                    <tr>
                        <td>${escapeHtml(String(taskIdRaw))}</td>
                        <td>${escapeHtml(String(modelIdRaw))}</td>
                        <td>
                            <div class="name-cell">
                                <span>${escapeHtml(String(datasetNameText))}</span>
                                <span class="badge secondary sm">${escapeHtml(datasetBadgeText)}</span>
                            </div>
                        </td>
                        <td>
                            <div class="tech-stack">${metricsHtml}</div>
                        </td>
                        <td><span class="badge ${status.cls}">${escapeHtml(status.text)}</span></td>
                        <td title="${escapeHtml(weightPath)}">${weightPathDisplay}</td>
                        <td>
                            <div class="action-wrapper">
                                <button class="btn-icon action-toggle" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
                                <div class="action-menu">
                                    <button
                                        class="btn-icon"
                                        title="属性"
                                        data-training-action="properties"
                                        data-training-detail="${escapeHtml(encodedDetail)}"
                                    >
                                        <i class="fa-solid fa-circle-info"></i>
                                    </button>
                                    <button
                                        class="btn-icon download"
                                        title="复制权重路径"
                                        data-training-action="copy-weight-path"
                                        data-training-path="${escapeHtml(encodedWeightPath)}"
                                    >
                                        <i class="fa-solid fa-copy"></i>
                                    </button>
                                    <button
                                        class="btn-icon"
                                        title="${cometUrl ? '打开 Comet 日志' : '无 Comet 日志'}"
                                        data-training-action="open-comet"
                                        data-training-comet-url="${escapeHtml(encodedCometUrl)}"
                                        ${cometUrl ? '' : 'disabled'}
                                    >
                                        <i class="fa-solid fa-chart-line"></i>
                                    </button>
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
                fetchTrainingResults();
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
                    fetchTrainingResults();
                });
                paginationControls.appendChild(btn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.disabled = state.page >= totalPages || state.loading;
            nextBtn.addEventListener('click', () => {
                if (state.page >= totalPages) return;
                state.page += 1;
                fetchTrainingResults();
            });
            paginationControls.appendChild(nextBtn);
        };

        async function fetchTrainingResults() {
            setLoadingState(true);
            renderPaginationControls();
            renderPlaceholderRow('训练结果加载中...');
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
                renderPlaceholderRow('训练结果加载失败');
                renderPaginationControls();
                if (totalItemsSpan) {
                    totalItemsSpan.textContent = '0';
                }
                showAlert(messageSlot, `加载训练结果失败: ${error.message}`, 'error');
            } finally {
                setLoadingState(false);
                renderPaginationControls();
            }
        }

        const applyFilters = () => {
            const keyword = String(searchInput && searchInput.value || '').trim();
            const modelIdRaw = String(modelIdInput && modelIdInput.value || '').trim();
            const datasetIdRaw = String(datasetIdInput && datasetIdInput.value || '').trim();
            const modelId = modelIdRaw ? parsePositiveInteger(modelIdRaw) : null;
            const datasetId = datasetIdRaw ? parsePositiveInteger(datasetIdRaw) : null;

            if (modelIdRaw && modelId == null) {
                showAlert(messageSlot, '模型ID 需为大于 0 的整数。', 'error');
                return;
            }
            if (datasetIdRaw && datasetId == null) {
                showAlert(messageSlot, '数据集ID 需为大于 0 的整数。', 'error');
                return;
            }

            state.keyword = keyword;
            state.modelId = modelId;
            state.datasetId = datasetId;
            state.status = String(statusSelect && statusSelect.value || '').trim();
            state.page = 1;
            fetchTrainingResults();
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

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
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
                fetchTrainingResults();
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                const next = Number(e.target.value);
                state.pageSize = Number.isFinite(next) && next > 0 ? next : 10;
                state.page = 1;
                fetchTrainingResults();
            });
        }

        const decodeDataValue = (value) => {
            const raw = String(value || '');
            if (!raw) return '';
            try {
                return decodeURIComponent(raw);
            } catch (error) {
                return raw;
            }
        };

        if (tbody) {
            tbody.addEventListener('click', async (e) => {
                const actionBtn = e.target.closest('[data-training-action]');
                if (!actionBtn) return;

                const wrapper = actionBtn.closest('.action-wrapper');
                if (wrapper) wrapper.classList.remove('expanded');

                const action = actionBtn.dataset.trainingAction;
                if (action === 'properties') {
                    const raw = decodeDataValue(actionBtn.dataset.trainingDetail);
                    let detail = {};
                    try {
                        detail = raw ? JSON.parse(raw) : {};
                    } catch (error) {
                        detail = { raw };
                    }
                    const titleId = detail && (detail.id ?? detail.training_id ?? detail.task_id);
                    const title = titleId != null ? `训练结果属性 - #${titleId}` : '训练结果属性';
                    openPropertyModal(title, detail, {
                        editAction: {
                            label: '尝试修改',
                            handler: async () => {
                                showAlert(messageSlot, '训练结果记录当前仅提供 POST/GET，后端暂无更新接口，暂不能直接修改。', 'info');
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
                }
            });
        }

        fetchTrainingResults();
}
