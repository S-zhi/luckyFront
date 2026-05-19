// auth-session.js manages frontend auth session persistence and redirects.
(function attachAuthSessionApi(windowObject) {
    const ACCESS_TOKEN_KEY = 'LP_ACCESS_TOKEN';
    const USER_KEY = 'LP_CURRENT_USER';
    const PERMISSIONS_KEY = 'LP_PERMISSIONS';

    // getStorage safely returns localStorage when the browser allows access.
    function getStorage() {
        try {
            return windowObject.localStorage;
        } catch (error) {
            return null;
        }
    }

    // readJson reads a JSON value from storage and falls back on parse failure.
    function readJson(storage, key, fallback) {
        if (!storage) return fallback;
        const raw = storage.getItem(key);
        if (!raw) return fallback;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return fallback;
        }
    }

    // writeJson serializes a JSON value into storage.
    function writeJson(storage, key, value) {
        if (!storage) return;
        storage.setItem(key, JSON.stringify(value));
    }

    // parseJwtPayload decodes the JWT payload so the frontend can inspect expiry.
    function parseJwtPayload(token) {
        const text = String(token || '').trim();
        if (!text) return null;
        const parts = text.split('.');
        if (parts.length < 2) return null;

        try {
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padding = '='.repeat((4 - (base64.length % 4 || 4)) % 4);
            const json = windowObject.atob(`${base64}${padding}`);
            return JSON.parse(json);
        } catch (error) {
            return null;
        }
    }

    // getAccessToken returns the current persisted bearer token.
    function getAccessToken() {
        const storage = getStorage();
        if (!storage) return '';
        return String(storage.getItem(ACCESS_TOKEN_KEY) || '').trim();
    }

    // getStoredUser returns the persisted user profile.
    function getStoredUser() {
        return readJson(getStorage(), USER_KEY, null);
    }

    // getStoredPermissions returns the persisted permission list.
    function getStoredPermissions() {
        return readJson(getStorage(), PERMISSIONS_KEY, []);
    }

    // isTokenExpired checks whether the stored JWT is already expired.
    function isTokenExpired(token) {
        const payload = parseJwtPayload(token);
        if (!payload || typeof payload.exp !== 'number') {
            return !String(token || '').trim();
        }
        return payload.exp * 1000 <= Date.now();
    }

    // saveSession persists the latest token, user profile, and permissions.
    function saveSession(session) {
        const storage = getStorage();
        if (!storage) return;

        const token = String(session && session.token || '').trim();
        if (!token) return;

        storage.setItem(ACCESS_TOKEN_KEY, token);
        writeJson(storage, USER_KEY, session && session.user ? session.user : null);
        writeJson(storage, PERMISSIONS_KEY, Array.isArray(session && session.permissions) ? session.permissions : []);
    }

    // clearSession removes all persisted auth-related frontend state.
    function clearSession() {
        const storage = getStorage();
        if (!storage) return;
        storage.removeItem(ACCESS_TOKEN_KEY);
        storage.removeItem(USER_KEY);
        storage.removeItem(PERMISSIONS_KEY);
    }

    // hasValidSession reports whether the frontend currently holds a usable token.
    function hasValidSession() {
        const token = getAccessToken();
        if (!token) return false;
        if (isTokenExpired(token)) {
            clearSession();
            return false;
        }
        return true;
    }

    // isAuthPage reports whether the current document lives under the auth directory.
    function isAuthPage() {
        return /\/auth\//.test(String(windowObject.location.pathname || ''));
    }

    // buildLoginUrl resolves the login page URL from the current page.
    function buildLoginUrl() {
        if (isAuthPage()) {
            return new URL('login_page.html', windowObject.location.href).href;
        }
        return new URL('../auth/html/login_page.html', windowObject.location.href).href;
    }

    // buildMainUrl resolves the main dashboard URL from the current page.
    function buildMainUrl() {
        if (isAuthPage()) {
            return new URL('../../main/index.html', windowObject.location.href).href;
        }
        return new URL('index.html', windowObject.location.href).href;
    }

    // redirectToLogin navigates the browser back to the login page.
    function redirectToLogin() {
        windowObject.location.replace(buildLoginUrl());
    }

    // redirectToMain navigates the browser to the main dashboard.
    function redirectToMain() {
        windowObject.location.assign(buildMainUrl());
    }

    // requireSession ensures protected pages are only visible to signed-in users.
    function requireSession() {
        if (hasValidSession()) return true;
        redirectToLogin();
        return false;
    }

    windowObject.LP_AUTH = {
        saveSession,
        clearSession,
        getAccessToken,
        getStoredUser,
        getStoredPermissions,
        hasValidSession,
        redirectToLogin,
        redirectToMain,
        requireSession,
    };
})(window);
