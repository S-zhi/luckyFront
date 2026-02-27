let runtimeLoaded = null;

function loadRuntimeScript(url, globalInitKey) {
    if (runtimeLoaded) return runtimeLoaded;

    runtimeLoaded = new Promise((resolve, reject) => {
        if (typeof window[globalInitKey] === 'function') {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => {
            if (typeof window[globalInitKey] === 'function') {
                resolve();
                return;
            }
            reject(new Error('模型管理运行时加载失败：初始化函数缺失。'));
        };
        script.onerror = () => {
            reject(new Error('模型管理运行时脚本加载失败。'));
        };
        document.head.appendChild(script);
    });

    return runtimeLoaded;
}

function exposeContextToWindow(context = {}) {
    Object.keys(context).forEach((key) => {
        window[key] = context[key];
    });
}

export async function initModelManagementPage(context = {}) {
    const runtimeUrl = new URL('./runtime/model-management.runtime.js', import.meta.url).toString();
    await loadRuntimeScript(runtimeUrl, '__LP_initModelManagementPage');
    exposeContextToWindow(context);

    const initFn = window.__LP_initModelManagementPage;
    if (typeof initFn !== 'function') {
        throw new Error('模型管理初始化函数不可用。');
    }
    initFn();
}
