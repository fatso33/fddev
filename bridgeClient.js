/**
 * Safe LocalStorage wrapper for restricted or sandboxed iframe environments
 */
const memStorage = {};

export function safeStorageGet(key, fallback = null) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null && val !== undefined) {
        return JSON.parse(val);
      }
    }
  } catch (e) {
    // Fall back to in-memory store
  }
  return memStorage[key] !== undefined ? memStorage[key] : fallback;
}

export function safeStorageSet(key, value) {
  try {
    memStorage[key] = value;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    // Ignore storage write restrictions
  }
}

export function safeStorageGetString(key, fallback = '') {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null && val !== undefined) {
        return val;
      }
    }
  } catch (e) {
    // Fall back to in-memory store
  }
  return memStorage[key] !== undefined ? String(memStorage[key]) : fallback;
}

export function safeStorageSetString(key, value) {
  try {
    memStorage[key] = value;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    // Ignore storage write restrictions
  }
}

let ws = null;
let reconnectInterval = null;
const listeners = new Set();
const statusListeners = new Set();

export function onSimData(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function onConnectionChange(callback) {
  statusListeners.add(callback);
  return () => statusListeners.delete(callback);
}

export function notifyConnection(status) {
  statusListeners.forEach((fn) => {
    try {
      fn(status);
    } catch (err) {
      console.error('[Bridge] Status callback error:', err);
    }
  });
}

export function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    ws.send(payload);
  } else {
    // Simulate immediate local echo if offline/connecting
    console.warn('[FlightDeck Bridge] Queued / WebSocket not connected:', data);
  }
}

export function sendSimCommand(category, eventName, value = 0) {
  send({
    type: 'event',
    category,
    name: eventName,
    event: eventName,
    value
  });
}

export function sendEvent(event, value = 0) {
  sendSimCommand('SIM', event, value);
}

export function connectBridgeWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  notifyConnection(false);

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[FlightDeck] Connected to PC Bridge Server');
      notifyConnection(true);
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
      send({ type: 'requestState' });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        listeners.forEach((fn) => {
          try {
            fn(message);
          } catch (e) {
            console.error('[FlightDeck] Error in simData listener:', e);
          }
        });
      } catch (err) {
        console.warn('[FlightDeck] Non-JSON message received:', event.data);
      }
    };

    ws.onclose = () => {
      notifyConnection(false);
      if (!reconnectInterval) {
        reconnectInterval = setInterval(connectBridgeWebSocket, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error('[FlightDeck] WebSocket error:', err);
      if (ws) ws.close();
    };
  } catch (err) {
    console.error('[FlightDeck] Connection setup failed:', err);
    if (!reconnectInterval) {
      reconnectInterval = setInterval(connectBridgeWebSocket, 3000);
    }
  }
}
