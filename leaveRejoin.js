function randomMs(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
}

function setupLeaveRejoin(bot, createBot) {
    // Timers
    let leaveTimer = null
    let jumpTimer = null
    let jumpOffTimer = null
    let reconnectTimer = null

    // State
    let stopped = false
    let reconnectAttempts = 0
    let lastLogAt = 0

    function logThrottled(msg, minGapMs = 2000) {
        const now = Date.now()
        if (now - lastLogAt >= minGapMs) {
            lastLogAt = now
            console.log(msg)
        }
    }

    function cleanup() {
        stopped = true
        
        // 1. Clear all active timers
        if (leaveTimer) clearTimeout(leaveTimer)
        if (jumpTimer) clearTimeout(jumpTimer)
        if (jumpOffTimer) clearTimeout(jumpOffTimer)
        if (reconnectTimer) clearTimeout(reconnectTimer)
        
        leaveTimer = jumpTimer = jumpOffTimer = reconnectTimer = null

        // 2. Remove event listeners to prevent memory leaks across 24/7 restarts
        bot.removeListener('end', onEnd)
        bot.removeListener('kicked', onKicked)
        bot.removeListener('error', onError)
    }

    function scheduleNextJump() {
        if (stopped || !bot.entity) return

        bot.setControlState('jump', true)
        jumpOffTimer = setTimeout(() => {
            bot.setControlState('jump', false)
        }, 300)

        // random jump 20s -> 5m
        const nextJump = randomMs(20000, 5 * 60 * 1000)
        jumpTimer = setTimeout(scheduleNextJump, nextJump)
    }

    // Handles the delay before recreating the bot
    function scheduleReconnect(reason = 'end') {
        if (stopped) return

        let delay = randomMs(2000, 10000)

        reconnectAttempts++
        if (reconnectAttempts > 3) {
            delay += 5000 // Backoff if failing frequently
        }

        // Cap at 15s max
        delay = Math.min(delay, 15000)

        logThrottled(`[AFK] Rejoin scheduled in ${Math.round(delay / 1000)}s (reason: ${reason}, attempt: ${reconnectAttempts})`)

        reconnectTimer = setTimeout(() => {
            if (stopped) return
            try {
                if (typeof createBot === 'function') createBot()
            } catch (e) {
                console.log('[AFK] createBot error:', e?.message || e)
                scheduleReconnect('createBot-error')
            }
        }, delay)
    }

    bot.once('spawn', () => {
        reconnectAttempts = 0
        cleanup() // Clear anything old
        
        // Re-attach listeners for the active bot
        bot.on('end', onEnd)
        bot.on('kicked', onKicked)
        bot.on('error', onError)
        
        stopped = false

        // Stay connected 1-5 minutes
        const stayTime = randomMs(60000, 300000)

        logThrottled(`[AFK] Will leave in ${Math.round(stayTime / 1000)} seconds`)

        scheduleNextJump()

        leaveTimer = setTimeout(() => {
            if (stopped) return
            logThrottled('[AFK] Leaving server intentionally for AFK cycle...')
            
            // Flag to tell index.js NOT to auto-reconnect, because THIS file is handling it
            bot.intentionalAFKQuit = true 
            
            cleanup()
            
            try {
                bot.quit()
            } catch (e) {
                // Ignore socket errors if already disconnected
            }

            // We handle the intentional AFK reconnect timer here
            scheduleReconnect('afk-cycle')
        }, stayTime)
    })

    // --- Named Event Handlers --- 
    // Using named functions allows us to cleanly remove them in cleanup()

    function onEnd() {
        if (bot.intentionalAFKQuit) return // Handled by leaveTimer

        cleanup()
        // If the server crashes or kicks the bot unexpectedly, we let this module 
        // manage the reconnect delay so it shares the same backoff logic.
        scheduleReconnect('unexpected-drop') 
    }

    function onKicked(reason) {
        if (bot.intentionalAFKQuit) return
        console.log(`[AFK] Bot kicked: ${reason}`)
        cleanup()
        scheduleReconnect('kicked')
    }

    function onError(err) {
        console.log(`[AFK] Bot error: ${err?.message || err}`)
        cleanup()
        scheduleReconnect('error')
    }
}

module.exports = setupLeaveRejoin
