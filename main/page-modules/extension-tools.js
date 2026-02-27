export function initExtensionToolsPage(ctx = {}) {
    const {
        apiBaseUrl = '',
        timeoutMs = 15000,
        escapeHtml = (value) => String(value == null ? '' : value),
        clearAlert = () => {},
        showAlert = () => {},
        fetchCoreServerRecords,
        getCoreServerStateInfo = () => ({ key: 'unknown', label: '未知' }),
        formatStorageServerLabel = (value) => String(value || '--'),
        normalizeStorageServerValue = (value) => String(value || '').trim().toLowerCase(),
        formatDateTime = (value) => String(value || ''),
        ensureDangerConfirmModal,
        invalidateStorageServerCaches = () => {},
    } = ctx;

    if (typeof fetchCoreServerRecords !== 'function') return;

    const table = document.querySelector('[data-core-server-table]');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    const stateFilterSelect = document.querySelector('[data-core-server-state-filter]');
    const addOpenBtn = document.querySelector('[data-core-server-add-open]');
    const refreshBtn = document.querySelector('[data-core-server-page-refresh]');
    const messageSlot = document.querySelector('[data-core-server-message]');
    const summaryEl = document.querySelector('[data-core-server-summary]');
    const endpointEl = document.querySelector('[data-core-server-endpoint]');
    const modal = document.querySelector('[data-core-server-modal]');
    const modalTitleEl = document.querySelector('[data-core-server-modal-title]');
    const modalSubtitleEl = document.querySelector('[data-core-server-modal-subtitle]');
    const modalCloseBtns = document.querySelectorAll('[data-core-server-modal-close]');
    const form = document.querySelector('[data-core-server-form]');
    const feedbackEl = document.querySelector('[data-core-server-form-feedback]');
    const submitBtn = document.querySelector('[data-core-server-form-submit]');
    const keyInput = document.querySelector('#core-server-key');
    const ipInput = document.querySelector('#core-server-ip');
    const portInput = document.querySelector('#core-server-port');

    const coreServerEndpoint = String(
        (window.APP_CONFIG && window.APP_CONFIG.CORE_SERVERS_API)
        || '/core-servers',
    ).trim() || '/core-servers';
    const coreServerBaseEndpoint = coreServerEndpoint.replace(/\/+$/, '') || '/core-servers';
    const absoluteEndpoint = /^https?:\/\//i.test(coreServerBaseEndpoint)
        ? coreServerBaseEndpoint
        : `${apiBaseUrl}${coreServerBaseEndpoint.startsWith('/') ? '' : '/'}${coreServerBaseEndpoint}`;
    const endpointText = `GET ${absoluteEndpoint} | POST ${absoluteEndpoint} | PATCH ${absoluteEndpoint}/:key | DELETE ${absoluteEndpoint}/:key`;
    if (endpointEl) {
        endpointEl.textContent = endpointText;
    }

    const buildCoreServerItemEndpoint = (key) => (
        `${coreServerBaseEndpoint}/${encodeURIComponent(String(key || '').trim())}`
    );

    const normalizePortText = (value) => String(value == null ? '' : value).trim();
    const validatePort = (value) => {
        const text = normalizePortText(value);
        if (!/^\d+$/.test(text)) {
            return { ok: false, text, message: '端口必须是 1-65535 的整数。' };
        }
        const num = Number(text);
        if (!Number.isInteger(num) || num < 1 || num > 65535) {
            return { ok: false, text, message: '端口必须在 1-65535 之间。' };
        }
        return { ok: true, text: String(num), number: num };
    };

    const requestCoreServerMutation = async (path, {
        method = 'POST',
        body = undefined,
    } = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const isAbsolute = /^https?:\/\//i.test(path);
            const normalizedPath = isAbsolute
                ? path
                : `${apiBaseUrl}${String(path || '').startsWith('/') ? '' : '/'}${String(path || '')}`;

            const res = await fetch(normalizedPath, {
                method,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: body == null ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });

            const raw = await res.text();
            let data = null;
            if (raw) {
                try {
                    data = JSON.parse(raw);
                } catch (error) {
                    data = raw;
                }
            }

            if (!res.ok) {
                const codeLabelMap = {
                    400: '参数错误',
                    404: '核心服务器不存在',
                    409: '新增/改名冲突',
                    500: 'Redis 未初始化或内部错误',
                };
                const detail = data && typeof data === 'object' && data.error
                    ? String(data.error)
                    : '';
                const fallback = codeLabelMap[res.status] || `请求失败 (${res.status})`;
                throw new Error(detail ? `${fallback}：${detail}` : fallback);
            }

            return data;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                throw new Error('请求超时，请检查后端服务状态。');
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    };

    let allRecords = [];
    let formMode = 'add';
    let editingOldKey = '';
    let editingSnapshot = null;

    const setPlaceholder = (message) => {
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="5" class="table-state">${escapeHtml(message)}</td></tr>`;
    };

    const setFormFeedback = (message, tone = 'info') => {
        if (!feedbackEl) return;
        if (!message) {
            feedbackEl.hidden = true;
            feedbackEl.className = 'core-server-form-feedback model-import-feedback';
            feedbackEl.textContent = '';
            return;
        }
        feedbackEl.hidden = false;
        feedbackEl.className = `core-server-form-feedback model-import-feedback alert ${tone === 'error' ? 'error' : 'info'}`;
        feedbackEl.textContent = message;
    };

    const applyFormMode = () => {
        if (formMode === 'edit') {
            if (modalTitleEl) modalTitleEl.textContent = '编辑存储服务';
            const patchTarget = editingOldKey
                ? `${absoluteEndpoint}/${encodeURIComponent(editingOldKey)}`
                : `${absoluteEndpoint}/:key`;
            if (modalSubtitleEl) modalSubtitleEl.textContent = `通过 PATCH ${patchTarget} 更新存储服务`;
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> 保存修改';
            }
            return;
        }

        if (modalTitleEl) modalTitleEl.textContent = '新增存储服务';
        if (modalSubtitleEl) modalSubtitleEl.textContent = `通过 POST ${absoluteEndpoint} 添加存储服务`;
        if (submitBtn) {
            submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> 提交';
        }
    };

    const openModal = ({
        mode = 'add',
        record = null,
    } = {}) => {
        if (!modal || !form) return;
        formMode = mode;
        editingOldKey = '';
        editingSnapshot = null;
        form.reset();
        setFormFeedback('');

        if (mode === 'edit' && record) {
            const rawKey = String(record.rawKey || record.key || '').trim();
            const ipText = String(record.ip || '').trim();
            const portText = normalizePortText(record.port);
            editingOldKey = rawKey;
            editingSnapshot = {
                key: rawKey,
                ip: ipText,
                port: portText,
            };
            if (keyInput) keyInput.value = rawKey;
            if (ipInput) ipInput.value = ipText;
            if (portInput) portInput.value = portText;
        }

        applyFormMode();
        modal.hidden = false;
        if (keyInput) keyInput.focus();
    };

    const closeModal = () => {
        if (!modal || !form) return;
        modal.hidden = true;
        form.reset();
        setFormFeedback('');
        formMode = 'add';
        editingOldKey = '';
        editingSnapshot = null;
    };

    const renderTableRows = () => {
        if (!tbody) return;

        const filterState = String(stateFilterSelect && stateFilterSelect.value || 'all')
            .trim()
            .toLowerCase();
        const visibleRows = allRecords.filter((item) => (
            filterState === 'all' ? true : item.state === filterState
        ));

        const activeCount = allRecords.filter((item) => item.state === 'active').length;
        const inactiveCount = allRecords.filter((item) => item.state === 'inactive').length;
        const unknownCount = allRecords.filter((item) => item.state === 'unknown').length;
        const updatedAt = formatDateTime(new Date());
        if (summaryEl) {
            summaryEl.textContent = `共 ${allRecords.length} 个存储服务（运行中 ${activeCount}，已停用 ${inactiveCount}，未知 ${unknownCount}），更新时间：${updatedAt}`;
        }

        if (!visibleRows.length) {
            setPlaceholder('当前筛选条件下无存储服务');
            return;
        }

        tbody.innerHTML = visibleRows.map((item) => {
            const stateInfo = getCoreServerStateInfo(item.state);
            const keyText = String(item.rawKey || item.key || '').trim() || '--';
            const displayName = formatStorageServerLabel(keyText);
            const addressText = item.ip && item.port
                ? `${item.ip}:${item.port}`
                : (item.ip || 'unknown');

            return `
                <tr>
                    <td>
                        <div class="core-server-name-cell">
                            <span class="core-server-name">${escapeHtml(displayName)}</span>
                        </div>
                    </td>
                    <td><code class="core-server-key">${escapeHtml(keyText)}</code></td>
                    <td><span class="core-server-address-text">${escapeHtml(addressText)}</span></td>
                    <td><span class="extension-server-state ${escapeHtml(stateInfo.key)}">${escapeHtml(stateInfo.label)}</span></td>
                    <td>
                        <div class="core-server-row-actions">
                            <button
                                class="btn-icon"
                                type="button"
                                data-core-server-action="edit"
                                data-core-server-key="${escapeHtml(keyText)}"
                                title="编辑存储服务"
                            >
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button
                                class="btn-icon delete"
                                type="button"
                                data-core-server-action="delete"
                                data-core-server-key="${escapeHtml(keyText)}"
                                title="删除存储服务"
                            >
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const refreshCoreServers = async ({
        force = false,
    } = {}) => {
        clearAlert(messageSlot);
        setPlaceholder('存储服务列表加载中...');

        const originalBtnText = refreshBtn ? refreshBtn.innerHTML : '';
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 刷新中';
        }

        try {
            allRecords = await fetchCoreServerRecords({ force });
            renderTableRows();
        } catch (error) {
            allRecords = [];
            setPlaceholder('存储服务列表加载失败');
            showAlert(messageSlot, `加载存储服务失败: ${error.message}`, 'error');
            if (summaryEl) {
                summaryEl.textContent = '存储服务加载失败，请检查后端状态后重试。';
            }
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = originalBtnText || '<i class="fa-solid fa-rotate"></i> 刷新';
            }
        }
    };

    const submitForm = async () => {
        if (!form || !submitBtn) return;
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const key = String(formData.get('key') || '').trim();
        const ip = String(formData.get('ip') || '').trim();
        const portValidation = validatePort(formData.get('port'));

        if (!key || !ip || !portValidation.text) {
            setFormFeedback('key、ip、port 不能为空。', 'error');
            return;
        }
        if (!portValidation.ok) {
            setFormFeedback(portValidation.message, 'error');
            return;
        }
        if (formMode === 'edit' && !editingOldKey) {
            setFormFeedback('未获取到路径参数 key，无法更新。', 'error');
            return;
        }

        let requestPath = coreServerBaseEndpoint;
        let method = 'POST';
        let body = {
            key,
            ip,
            port: portValidation.text,
        };

        if (formMode === 'edit') {
            method = 'PATCH';
            requestPath = buildCoreServerItemEndpoint(editingOldKey);
            body = {};
            if (!editingSnapshot || key !== editingSnapshot.key) {
                body.key = key;
            }
            if (!editingSnapshot || ip !== editingSnapshot.ip) {
                body.ip = ip;
            }
            if (!editingSnapshot || portValidation.text !== normalizePortText(editingSnapshot.port)) {
                body.port = portValidation.text;
            }
            if (Object.keys(body).length === 0) {
                setFormFeedback('未检测到字段变更。', 'info');
                return;
            }
        }

        const originalSubmitText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 提交中';
        setFormFeedback('');

        try {
            await requestCoreServerMutation(requestPath, { method, body });
            invalidateStorageServerCaches();
            await refreshCoreServers({ force: true });
            const actionText = formMode === 'edit' ? '更新' : '新增';
            showAlert(messageSlot, `存储服务“${key}”${actionText}成功。`, 'info');
            closeModal();
        } catch (error) {
            setFormFeedback(`提交失败: ${error.message}`, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalSubmitText;
        }
    };

    if (stateFilterSelect) {
        stateFilterSelect.addEventListener('change', renderTableRows);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshCoreServers({ force: true });
        });
    }

    if (addOpenBtn) {
        addOpenBtn.addEventListener('click', () => {
            openModal({ mode: 'add' });
        });
    }

    if (tbody) {
        tbody.addEventListener('click', async (e) => {
            const actionBtn = e.target.closest('[data-core-server-action]');
            if (!actionBtn) return;

            const action = String(actionBtn.dataset.coreServerAction || '').trim();
            const keyText = String(actionBtn.dataset.coreServerKey || '').trim();
            if (!keyText) {
                showAlert(messageSlot, '未获取到存储服务标识。', 'error');
                return;
            }

            const record = allRecords.find((item) => (
                String(item.rawKey || '').trim() === keyText
                || String(item.key || '').trim() === normalizeStorageServerValue(keyText)
            ));
            if (!record) {
                showAlert(messageSlot, `未找到存储服务 ${keyText}，请刷新后重试。`, 'error');
                return;
            }

            if (action === 'edit') {
                openModal({ mode: 'edit', record });
                return;
            }

            if (action === 'delete') {
                const confirmModal = typeof ensureDangerConfirmModal === 'function'
                    ? ensureDangerConfirmModal()
                    : null;
                if (!confirmModal || typeof confirmModal.open !== 'function') {
                    showAlert(messageSlot, '删除确认弹窗未初始化。', 'error');
                    return;
                }

                const confirmed = await confirmModal.open({
                    title: '删除存储服务',
                    subtitle: `将调用 DELETE ${absoluteEndpoint}/${encodeURIComponent(keyText)}`,
                    message: `确认删除存储服务“${keyText}”吗？`,
                    detail: `key = ${keyText}`,
                    note: '删除后该服务不会再出现在上传和同步的可选项中。',
                    confirmText: '确认删除',
                });
                if (!confirmed) return;

                actionBtn.disabled = true;
                try {
                    await requestCoreServerMutation(buildCoreServerItemEndpoint(keyText), { method: 'DELETE' });
                    invalidateStorageServerCaches();
                    await refreshCoreServers({ force: true });
                    showAlert(messageSlot, `存储服务“${keyText}”删除成功。`, 'info');
                } catch (error) {
                    showAlert(messageSlot, `删除存储服务失败: ${error.message}`, 'error');
                } finally {
                    actionBtn.disabled = false;
                }
            }
        });
    }

    modalCloseBtns.forEach((btn) => {
        btn.addEventListener('click', closeModal);
    });

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitForm();
        });
    }

    refreshCoreServers({ force: true });
}
