function randomMs(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function setupLeaveRejoin(bot, createBot) {
    let leaveTimer = null;
    let jumpTimer = null;
    let jumpOffTimer = null;
    let reconnectTimer = null;

    let stopped = false;
    let reconnectAttempts = 0;
    let lastLogAt = 0;

    function logThrottled(msg, minGapMs = 2000) {
        const now = Date.now();
        if (now - lastLogAt >= minGapMs) {
            lastLogAt = now;
            console.log(msg);
        }
    }

    function cleanup() {
        stopped = true;

        if (leaveTimer) clearTimeout(leaveTimer);
        if (jumpTimer) clearTimeout(jumpTimer);
        if (jumpOffTimer) clearTimeout(jumpOffTimer);
        if (reconnectTimer) clearTimeout(reconnectTimer);

        leaveTimer = jumpTimer = jumpOffTimer = reconnectTimer = null;

        bot.removeListener('end', onEnd);
        bot.removeListener('kicked', onKicked);
        bot.removeListener('error', onError);
    }

    function scheduleNextJump() {
        if (stopped || !bot.entity) return;

        bot.setControlState('jump', true);
        jumpOffTimer = setTimeout(() => {
            if (bot && bot.entity) bot.setControlState('jump', false);
        }, 350);

        // Natural random jump intervals (20s to 90s)
        const nextJump = randomMs(20000, 90000);
        jumpTimer = setTimeout(scheduleNextJump, nextJump);
    }

    function scheduleReconnect(reason = 'end') {
        if (reconnectTimer) return; // Prevent duplicate timers

        let delay = randomMs(3000, 8000);
        reconnectAttempts++;
        if (reconnectAttempts > 3) delay += 5000;
        delay = Math.min(delay, 15000);

        logThrottled(`[AFK] Rejoining server in ${Math.round(delay / 1000)}s (reason: ${reason})`);

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (typeof createBot === 'function') {
                createBot();
            }
        }, delay);
    }

    bot.once('spawn', () => {
        reconnectAttempts = 0;
        cleanup();
        stopped = false;

        bot.on('end', onEnd);
        bot.on('kicked', onKicked);
        bot.on('error', onError);

        // Stay on server for 2 to 6 minutes before cycling
        const stayTime = randomMs(120000, 360000);
        logThrottled(`[AFK] Connected. Cycle scheduled in ${Math.round(stayTime / 1000)} seconds.`);

        scheduleNextJump();

        leaveTimer = setTimeout(() => {
            if (stopped) return;
            logThrottled('[AFK] Cycle triggered: Leaving server intentionally...');
            bot.intentionalAFKQuit = true;
            cleanup();

            try {
                bot.quit();
            } catch (e) {}

            scheduleReconnect('afk-cycle');
        }, stayTime);
    });

    function onEnd() {
        if (bot.intentionalAFKQuit) return;
        cleanup();
        scheduleReconnect('unexpected-drop');
    }

    function onKicked(reason) {
        if (bot.intentionalAFKQuit) return;
        cleanup();
        scheduleReconnect('kicked');
    }

    function onError(err) {
        // 'end' event usually follows error, but clean up listeners
        cleanup();
        scheduleReconnect('socket-error');
    }
}

module.exports = setupLeaveRejoin;
