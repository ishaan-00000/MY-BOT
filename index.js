const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const config = require('./settings.json');
const express = require('express');
const http = require('http');
const https = require('https');
const setupLeaveRejoin = require('./leaveRejoin');

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

let bot = null;
let activeIntervals = [];
let reconnectTimeout = null;
let isReconnecting = false;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: []
};

// Health check endpoint for monitoring
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${config.name || 'Minecraft Bot'} Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: #0f172a; 
            color: #f8fafc; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            margin: 0; 
            overflow: hidden;
          }
          .container {
            background: #1e293b;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 0 50px rgba(45, 212, 191, 0.2);
            text-align: center;
            width: 400px;
            border: 1px solid #334155;
          }
          h1 { margin-bottom: 30px; font-size: 24px; color: #ccfbf1; display: flex; align-items: center; justify-content: center; gap: 10px; }
          .stat-card {
            background: #0f172a;
            padding: 15px;
            margin: 15px 0;
            border-radius: 12px;
            border-left: 5px solid #2dd4bf;
            text-align: left;
            box-shadow: 5px 5px 15px rgba(0, 0, 0, 0.3);
          }
          .label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
          .value { font-size: 18px; font-weight: bold; color: #2dd4bf; margin-top: 5px; }
          .status-dot { 
            height: 12px; width: 12px; 
            border-radius: 50%; 
            display: inline-block; 
            margin-right: 8px;
            background-color: currentColor;
          }
          .pulse { animation: pulse 2s infinite; }
          @keyframes pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
          .btn-guide {
            display: inline-block; margin-top: 20px; padding: 12px 24px; 
            background: #2dd4bf; color: #0f172a; text-decoration: none; 
            border-radius: 8px; font-weight: bold; 
          }
        </style>
      </head>
      <body>
        <div class="container" id="main-container">
          <h1>
            <span id="live-indicator" class="status-dot pulse" style="color: #ef4444;"></span> 
            ${config.name || 'AFK Bot'}
          </h1>
          
          <div class="stat-card">
            <div class="label">Status</div>
            <div class="value" id="status-text">Connecting...</div>
          </div>

          <div class="stat-card">
            <div class="label">Uptime</div>
            <div class="value" id="uptime-text">0h 0m 0s</div>
          </div>

          <div class="stat-card">
            <div class="label">Coordinates</div>
            <div class="value" id="coords-text">Waiting...</div>
          </div>

          <div class="stat-card">
            <div class="label">Server</div>
            <div class="value">${config.server.ip}</div>
          </div>

          <a href="/tutorial" class="btn-guide">View Setup Guide</a>
        </div>

        <script>
          const formatUptime = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return \`\${h}h \${m}m \${s}s\`;
          };

          const updateStats = async () => {
            try {
              const res = await fetch('/health');
              const data = await res.json();
              
              const statusText = document.getElementById('status-text');
              const uptimeText = document.getElementById('uptime-text');
              const coordsText = document.getElementById('coords-text');
              const liveDot = document.getElementById('live-indicator');

              if (data.status === 'connected') {
                statusText.innerHTML = '<span class="status-dot" style="color: #4ade80;"></span> Online & Running';
                statusText.style.color = '#2dd4bf';
                liveDot.style.color = '#4ade80';
              } else {
                statusText.innerHTML = '<span class="status-dot" style="color: #f87171;"></span> Cycling / Offline';
                statusText.style.color = '#f87171';
                liveDot.style.color = '#f87171';
              }

              uptimeText.innerText = formatUptime(data.uptime);

              if (data.coords) {
                coordsText.innerText = \`Coords: \${Math.floor(data.coords.x)}, \${Math.floor(data.coords.y)}, \${Math.floor(data.coords.z)}\`;
              } else {
                coordsText.innerText = 'Unknown Location';
              }

            } catch (e) {
              document.getElementById('status-text').innerText = 'System Offline';
              document.getElementById('live-indicator').style.color = '#64748b';
            }
          };

          setInterval(updateStats, 1000);
          updateStats();
        </script>
      </body>
    </html>
  `);
});

app.get('/tutorial', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>${config.name} - Setup Guide</title>
        <style>
          body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #cbd5e1; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
          h1, h2 { color: #2dd4bf; }
          h1 { border-bottom: 2px solid #334155; padding-bottom: 10px; }
          .card { background: #1e293b; padding: 25px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #334155; }
          a { color: #38bdf8; text-decoration: none; }
          code { background: #334155; padding: 2px 6px; border-radius: 4px; color: #e2e8f0; font-family: monospace; }
          .btn-home { display: inline-block; margin-bottom: 20px; padding: 8px 16px; background: #334155; color: white; border-radius: 6px; text-decoration: none; }
        </style>
      </head>
      <body>
        <a href="/" class="btn-home">Back to Dashboard</a>
        <h1>Setup Guide</h1>
        <div class="card">
          <h2>Server Configuration</h2>
          <ol>
            <li>Enable <strong>Cracked</strong> mode on your server (if using offline bot account).</li>
            <li>Install plugins: <code>ViaVersion</code>, <code>ViaBackwards</code> if using mixed client versions.</li>
          </ol>
        </div>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: botState.connected ? 'connected' : 'disconnected',
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: (bot && bot.entity) ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
  });
});

app.get('/ping', (req, res) => res.send('pong'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] HTTP server started on port ${PORT}`);
});

// Self-ping to keep free cloud tiers awake
const SELF_PING_INTERVAL = 10 * 60 * 1000;
function startSelfPing() {
  setInterval(() => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const client = url.startsWith('https') ? https : http;

    client.get(`${url}/ping`, (res) => {}).on('error', (err) => {
      console.log(`[KeepAlive] Ping issue: ${err.message}`);
    });
  }, SELF_PING_INTERVAL);
  console.log('[KeepAlive] Self-ping system active.');
}
startSelfPing();

// ============================================================
// BOT LIFECYCLE MANAGEMENT
// ============================================================
function clearAllIntervals() {
  activeIntervals.forEach(id => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function createBot() {
  if (isReconnecting) {
    console.log('[Bot] Connection creation already in progress, skipping...');
    return;
  }

  // Teardown previous bot completely to stop memory leaks
  if (bot) {
    clearAllIntervals();
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {
      // Ignore cleanup error
    }
    bot = null;
  }

  console.log(`[Bot] Connecting to ${config.server.ip}:${config.server.port}...`);

  try {
    bot = mineflayer.createBot({
      username: config['bot-account'].username,
      password: config['bot-account'].password || undefined,
      auth: config['bot-account'].type,
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
      hideErrors: false,
      checkTimeoutInterval: 120000
    });

    bot.loadPlugin(pathfinder);

    // Give leaveRejoin full management over AFK cycling and reconnect queues
    setupLeaveRejoin(bot, () => {
      isReconnecting = false;
      createBot();
    });

    // Fallback connection timeout if bot hangs before spawn
    const connectionTimeout = setTimeout(() => {
      if (!botState.connected) {
        console.log('[Bot] Timeout - No spawn event received in 60s');
        try { bot.end(); } catch (e) {}
      }
    }, 60000);

    bot.once('spawn', () => {
      clearTimeout(connectionTimeout);
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;

      console.log(`[Bot] [+] Successfully spawned on server!`);

      // Initialize plugins & movement
      const mcData = require('minecraft-data')(bot.version || config.server.version);
      const defaultMove = new Movements(bot, mcData);
      initializeModules(bot, mcData, defaultMove);

      // Safe post-spawn commands
      setTimeout(() => {
        if (bot && botState.connected) {
          bot.chat('/gamerule sendCommandFeedback false');
          bot.chat('/gamemode creative');
        }
      }, 3000);
    });

    bot.on('end', (reason) => {
      console.log(`[Bot] Disconnected: ${reason || 'Unknown reason'}`);
      botState.connected = false;
      clearAllIntervals();
    });

    bot.on('kicked', (reason) => {
      console.log('[KICK]', typeof reason === 'string' ? reason : JSON.stringify(reason));
    });

    bot.on('error', (err) => {
      console.log(`[Bot] Error: ${err.message}`);
      botState.errors.push({ type: 'error', message: err.message, time: Date.now() });
    });

  } catch (err) {
    console.log(`[Bot] Failed to initiate instance: ${err.message}`);
    // Retry after 5s if instantiating crashes
    setTimeout(() => {
      isReconnecting = false;
      createBot();
    }, 5000);
  }
}

// ============================================================
// MODULE INITIALIZATION
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  let authDone = false;

  // Single unified chat-auth handler
  bot.on('messagestr', (msg) => {
    const message = msg.toLowerCase();

    if (!authDone) {
      if (message.includes('/register') || message.includes('register')) {
        authDone = true;
        bot.chat('/register Perzuu Perzuu');
        console.log('[Auth] Register executed');
        return;
      }

      if (message.includes('/login') || message.includes('login')) {
        authDone = true;
        bot.chat('/login Perzuu');
        console.log('[Auth] Login executed');
        return;
      }
    }
  });

  // Pathfinder destination
  if (config.position && config.position.enabled) {
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new GoalBlock(config.position.x, config.position.y, config.position.z));
  }

  // Optional sneaking
  if (config.utils && config.utils['anti-afk'] && config.utils['anti-afk'].sneak) {
    bot.setControlState('sneak', true);
  }

  // Optional plugin modules if present in project
  if (config.modules) {
    if (config.modules.avoidMobs && typeof avoidMobs === 'function') avoidMobs(bot);
    if (config.modules.combat && typeof combatModule === 'function') combatModule(bot, mcData);
    if (config.modules.beds && typeof bedModule === 'function') bedModule(bot, mcData);
    if (config.modules.chat && typeof chatModule === 'function') chatModule(bot);
  }
}

// Start bot
createBot();
