(() => {
    const $ = id => document.getElementById(id);
    const guestNameInput = $('guest-name');
    const accountNameInput = $('account-name');
    const accountPasswordInput = $('account-password');
    const authMessage = $('auth-message');
    const identityDisplay = $('identity-display');
    const localBestDisplay = $('best-score');
    const personalBestDisplay = $('personal-best');
    const leaderboard = $('leaderboard-list');
    const MAX_NAME = 18;
    const LOCAL_BEST_KEY = 'bigmerge.localBest.v2';
    const DEVICE_ID_KEY = 'bigmerge.deviceId.v2';
    const TOKEN_KEY = 'bigmerge.session.v2';
    const NAME_KEY = 'bigmerge.guestName.v2';

    const safeLoad = (key, fallback) => {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
        catch (_) { return fallback; }
    };
    const safeStore = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (_) { }
    };
    const getDeviceId = () => {
        try {
            let id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch (_) { return 'temporary-' + Math.random().toString(36).slice(2); }
    };
    const deviceId = getDeviceId();
    const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
    const guestName = () => {
        try { return localStorage.getItem(NAME_KEY) || '访客' + deviceId.slice(-4); }
        catch (_) { return '访客' + deviceId.slice(-4); }
    };
    const setMessage = (message, error = false) => {
        authMessage.textContent = message;
        authMessage.classList.toggle('error', error);
    };
    const request = async (url, options = {}) => {
        const headers = {...(options.headers || {})};
        if (options.body) headers['Content-Type'] = 'application/json';
        if (token()) headers.Authorization = 'Bearer ' + token();
        const response = await fetch(url, {...options, headers});
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '服务器错误 (' + response.status + ')');
        return data;
    };
    const localBest = () => {
        const all = safeLoad(LOCAL_BEST_KEY, {});
        return Math.max(0, Number(all[deviceId]) || 0);
    };
    const updateLocalBest = score => {
        const all = safeLoad(LOCAL_BEST_KEY, {});
        all[deviceId] = Math.max(Number(all[deviceId]) || 0, score);
        safeStore(LOCAL_BEST_KEY, all);
        localBestDisplay.textContent = String(all[deviceId]);
    };

    window.saveGameScore = async score => {
        updateLocalBest(score);
        try {
            await request('/api/scores', {method: 'POST', body: JSON.stringify({
                score, deviceId, displayName: guestName()
            })});
            await refreshProfile();
            await refreshLeaderboard();
        } catch (_) {
            setMessage('分数已保存在本机；连接游戏服务器后会同步到排行榜。');
        }
    };

    async function refreshProfile() {
        localBestDisplay.textContent = String(localBest());
        try {
            const query = new URLSearchParams({deviceId, displayName: guestName()});
            const profile = await request('/api/me?' + query.toString());
            identityDisplay.textContent = (profile.kind === 'account' ? '账号：' : '访客：') + profile.displayName;
            personalBestDisplay.textContent = String(Math.max(profile.best || 0, 0));
            const isAccount = profile.kind === 'account';
            $('account-panel').classList.toggle('hidden', isAccount);
            $('logout-btn').classList.toggle('hidden', !isAccount);
            $('guest-panel').classList.toggle('hidden', isAccount);
            if (!isAccount) guestNameInput.value = guestName();
            $('server-status').textContent = '已连接排行榜';
            $('server-status').classList.remove('offline');
        } catch (_) {
            identityDisplay.textContent = '访客：' + guestName();
            personalBestDisplay.textContent = String(localBest());
            $('server-status').textContent = '本机模式 · 排行榜需连接服务器';
            $('server-status').classList.add('offline');
            $('account-panel').classList.remove('hidden');
            $('guest-panel').classList.remove('hidden');
            $('logout-btn').classList.add('hidden');
        }
    }

    async function refreshLeaderboard() {
        try {
            const data = await request('/api/leaderboard?deviceId=' + encodeURIComponent(deviceId));
            leaderboard.replaceChildren();
            if (!data.entries.length) {
                const li = document.createElement('li');
                li.className = 'empty-rank'; li.textContent = '还没有分数记录'; leaderboard.append(li);
            }
            data.entries.forEach((entry, index) => {
                const li = document.createElement('li');
                const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(index + 1);
                const name = document.createElement('span'); name.className = 'rank-name'; name.textContent = entry.displayName;
                const points = document.createElement('strong'); points.textContent = String(entry.score);
                li.append(rank, name, points); leaderboard.append(li);
            });
        } catch (_) {
            leaderboard.replaceChildren();
            const li = document.createElement('li');
            li.className = 'empty-rank'; li.textContent = '启动并连接游戏服务器后显示全服排行'; leaderboard.append(li);
        }
    }

    $('guest-name-save').addEventListener('click', async () => {
        const name = guestNameInput.value.trim().slice(0, MAX_NAME);
        if (!name) return setMessage('请输入一个访客名字。', true);
        try {
            const data = await request('/api/guest/name', {method: 'POST', body: JSON.stringify({deviceId, displayName: name})});
            localStorage.setItem(NAME_KEY, data.displayName);
            setMessage('访客名字已保存。'); await refreshProfile(); await refreshLeaderboard();
        } catch (_) {
            try { localStorage.setItem(NAME_KEY, name); } catch (_) { }
            setMessage('名字保存在本机；连接服务器后会同步。'); await refreshProfile();
        }
    });

    async function authenticate(kind) {
        const username = accountNameInput.value.trim();
        const password = accountPasswordInput.value;
        if (!username || !password) return setMessage('请输入账号和密码。', true);
        try {
            const data = await request('/api/auth/' + kind, {method: 'POST', body: JSON.stringify({username, password, deviceId})});
            localStorage.setItem(TOKEN_KEY, data.token);
            setMessage(kind === 'register' ? '账号创建成功。' : '登录成功。');
            accountPasswordInput.value = ''; await refreshProfile(); await refreshLeaderboard();
        } catch (error) { setMessage(error.message, true); }
    }
    $('register-btn').addEventListener('click', () => authenticate('register'));
    $('login-btn').addEventListener('click', () => authenticate('login'));
    $('logout-btn').addEventListener('click', async () => {
        try { localStorage.removeItem(TOKEN_KEY); } catch (_) { }
        setMessage('已退出账号。'); await refreshProfile(); await refreshLeaderboard();
    });
    $('leaderboard-refresh').addEventListener('click', refreshLeaderboard);

    refreshProfile();
    refreshLeaderboard();
})();
