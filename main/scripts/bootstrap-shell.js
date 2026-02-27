async function fetchFragment(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`加载页面片段失败：${url}`);
    }
    return response.text();
}

async function loadScript(url) {
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.defer = false;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`加载脚本失败：${url}`));
        document.body.appendChild(script);
    });
}

async function mountShell() {
    const root = document.getElementById('app-shell-root');
    if (!root) {
        throw new Error('页面入口节点不存在：#app-shell-root');
    }

    const shellUrl = new URL('../layout/app-shell.html', import.meta.url).toString();
    const navUrl = new URL('../layout/sidebar-nav.html', import.meta.url).toString();

    const [shellHtml, navHtml] = await Promise.all([
        fetchFragment(shellUrl),
        fetchFragment(navUrl),
    ]);

    root.innerHTML = shellHtml;
    const navSlot = root.querySelector('[data-shell-sidebar-nav]');
    if (!navSlot) {
        throw new Error('页面壳缺少导航插槽：data-shell-sidebar-nav');
    }
    navSlot.innerHTML = navHtml;
}

try {
    await mountShell();
    await loadScript(new URL('../config.js', import.meta.url).toString());
    await loadScript(new URL('../app.js', import.meta.url).toString());
} catch (error) {
    const root = document.getElementById('app-shell-root');
    if (root) {
        root.innerHTML = `<div class="alert error" style="margin:24px;">${String(error && error.message || '页面初始化失败')}</div>`;
    }
    console.error(error);
}
