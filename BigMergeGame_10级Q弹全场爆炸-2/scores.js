(() => {
    const BEST_KEY = "bigmerge.localBest.v3";
    const DEVICE_KEY = "bigmerge.deviceId.v2";
    const display = document.getElementById("best-score");

    function getDeviceId() {
        try {
            let id = localStorage.getItem(DEVICE_KEY);
            if (!id) {
                id = crypto.randomUUID
                    ? crypto.randomUUID()
                    : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
                localStorage.setItem(DEVICE_KEY, id);
            }
            return id;
        } catch (_) {
            return "temporary";
        }
    }

    const deviceId = getDeviceId();
    function readBest() {
        try {
            const current = Number(localStorage.getItem(BEST_KEY)) || 0;
            const legacy = JSON.parse(localStorage.getItem("bigmerge.localBest.v2") || "{}");
            return Math.max(current, Number(legacy[deviceId]) || 0);
        } catch (_) {
            return 0;
        }
    }

    function saveBest(score) {
        const best = Math.max(readBest(), Math.floor(Number(score) || 0));
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (_) { }
        display.textContent = String(best);
    }

    display.textContent = String(readBest());
    window.saveGameScore = saveBest;
})();
