/**
 * Shopexa Ops — Core Application Orchestrator & State Machine
 * Coordinates WebSocket connections, MCP event dispatching,
 * InteractionManager context stack, ambient scenario handler, and telemetry HUD.
 */

// ── Application Global State ──────────────────────────────────────────────────
let voiceWS             = null;
let sessionReady        = false;
let sessionEngine       = 'autonomous_nova_sonic';
let isChatBusy          = false;
let currentContextStage = 'idle'; // 'idle' | 'briefing_active' | 'order_staged' | 'order_authorized' | 'alternative_selection' | 'proactive_deal'
let stagedOrderId       = '10';
let stagedOrderAmt      = '37.00';
let pendingSuggestion   = null;
let activeFlowProduct   = null;
let isAmbientLoopActive = true;
let isPresenterMode     = false;
let ambientTimeout      = null;

const alertedProducts   = new Set();
const alertedScenarioIds = new Set();
let pendingUnrelatedAlerts = [];

// ── Debounced Ambient Dispatcher (Prevents Double-Firing) ─────────────────────
let lastAmbientTriggerTime = 0;
let lastAmbientScenarioId = null;

// ── Coordinated Presentation Ambient Timer ────────────────────────────────────
let presentationAmbientTimer = null;
let hasAmbientFiredThisSession = false;

function armPresentationAmbientTimer(delaySeconds = 45) {
  // Clear any existing timer
  if (presentationAmbientTimer) {
    clearTimeout(presentationAmbientTimer);
    presentationAmbientTimer = null;
  }
  hasAmbientFiredThisSession = false;

  console.log(`[Ambient] Timer armed. Will fire Coffee Price Spike naturally in ${delaySeconds}s if no key is pressed.`);
  
  presentationAmbientTimer = setTimeout(() => {
    if (!hasAmbientFiredThisSession) {
      hasAmbientFiredThisSession = true;
      addHudEvent('ambient', 'AUTONOMOUS_TIMER', `Elapsed presentation time reached (${delaySeconds}s) — surfacing ambient price spike.`);
      fireAmbient('supplier_price_spike');
    }
  }, delaySeconds * 1000);
}

function fireAmbientNow(scenarioId = 'supplier_price_spike') {
  // Disarm timer so it never double-fires
  if (presentationAmbientTimer) {
    clearTimeout(presentationAmbientTimer);
    presentationAmbientTimer = null;
  }
  hasAmbientFiredThisSession = true;
  fireAmbient(scenarioId);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
setInterval(() => {
  const clockEl = document.getElementById('clock');
  if (clockEl) {
    clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}, 1000);

// ── Hints System ──────────────────────────────────────────────────────────────
const HINTS = [
  { icon: '<i class="fas fa-inbox"></i>', text: 'What did I miss?', cmd: "typedFallback('What did I miss?')" },
  { icon: '<i class="fas fa-bolt fa-beat" style="color:#f59e0b"></i>', text: '⚡ Trigger Proactive Price/Deal', cmd: "fireAmbient('price_deal')", style: "border-color:rgba(245,158,11,0.5); background:rgba(245,158,11,0.1);" },
  { icon: '<i class="fas fa-tags" style="color:#f59e0b"></i>', text: 'Price Updates & Alternatives', cmd: "typedFallback('Check for price updates')" },
  { icon: '<i class="fas fa-mug-hot"></i>', text: 'Restock Coffee', cmd: "typedFallback('Restock the coffee')" },
  { icon: '<i class="fas fa-copy"></i>', text: 'Restock Paper', cmd: "typedFallback('Order the printer paper')" },
  { icon: '<i class="fas fa-boxes"></i>', text: 'Inventory', cmd: "typedFallback('Check inventory levels')" }
];
let availableHints = [];
let hintInterval = null;

function rotateHint() {
  const hg = document.getElementById('hint-grid');
  if (!hg || hg.style.display === 'none') return;

  if (availableHints.length === 0) {
    availableHints = [...HINTS];
    availableHints.sort(() => Math.random() - 0.5);
  }
  const currentHint = availableHints.pop();

  hg.innerHTML = `
    <div class="hint-chip" onclick="${currentHint.cmd}" style="${currentHint.style || ''}; animation: text-fade-in 0.5s ease;">
      ${currentHint.icon} ${currentHint.text}
    </div>
  `;
}

function startHintRotation() {
  if (hintInterval) clearInterval(hintInterval);
  rotateHint();
  hintInterval = setInterval(rotateHint, 5000);
}

function hideHints() {
  const hg = document.getElementById('hint-grid');
  if (hg) hg.style.display = 'none';
  if (hintInterval) {
    clearInterval(hintInterval);
    hintInterval = null;
  }
}

function showHints() {
  const contentEl = document.querySelector('.content');
  if (contentEl) contentEl.classList.remove('has-response');
  const hg = document.getElementById('hint-grid');
  if (hg) hg.style.display = 'flex';
  CardRenderer.clear();
  startHintRotation();
}

// ── Product Detection Helpers ─────────────────────────────────────────────────
function getScenarioProduct(sc) {
  if (sc && sc.product) return sc.product.toLowerCase();
  const text = ((sc.item_name || '') + ' ' + (sc.scenario || '') + ' ' + (sc.id || '')).toLowerCase();
  if (text.includes('toner') || text.includes('printmaster') || text.includes('cartridge')) return 'toner';
  if (text.includes('cable') || text.includes('usb') || text.includes('anker') || text.includes('braided')) return 'cables';
  if (text.includes('sanitizer') || text.includes('pureclean') || text.includes('dispenser') || text.includes('gallon')) return 'sanitizer';
  if (text.includes('desk') || text.includes('mat') || text.includes('ergocomfort') || text.includes('fatigue')) return 'desk_mats';
  if (text.includes('paper') || text.includes('officepro') || text.includes('acme') || text.includes('printer paper')) return 'paper';
  if (text.includes('coffee') || text.includes('yirgacheffe') || text.includes('colombian') || text.includes('kenya') || text.includes('beans')) return 'coffee';
  if (text.includes('cloth') || text.includes('microfiber') || text.includes('cleaning')) return 'cleaning';
  if (text.includes('pen') || text.includes('gel ink') || text.includes('stationery')) return 'pens';
  if (text.includes('contract') || text.includes('cleanco')) return 'contract';
  return 'general';
}

function detectActiveProduct(text, prompt) {
  const combined = ((text || '') + ' ' + (prompt || '')).toLowerCase();
  if (combined.includes('toner') || combined.includes('printmaster') || combined.includes('cartridge')) return 'toner';
  if (combined.includes('cable') || combined.includes('usb') || combined.includes('anker') || combined.includes('braided')) return 'cables';
  if (combined.includes('sanitizer') || combined.includes('pureclean') || combined.includes('dispenser') || combined.includes('gallon')) return 'sanitizer';
  if (combined.includes('desk') || combined.includes('mat') || combined.includes('ergocomfort') || combined.includes('fatigue')) return 'desk_mats';
  if (combined.includes('paper') || combined.includes('officepro') || combined.includes('acme') || combined.includes('printer paper')) return 'paper';
  if (combined.includes('coffee') || combined.includes('yirgacheffe') || combined.includes('colombian') || combined.includes('kenya') || combined.includes('beans')) return 'coffee';
  if (combined.includes('cloth') || combined.includes('microfiber') || combined.includes('cleaning')) return 'cleaning';
  if (combined.includes('pen') || combined.includes('gel ink') || combined.includes('stationery')) return 'pens';
  if (combined.includes('contract') || combined.includes('cleanco')) return 'contract';
  return 'general';
}

// ── Interaction State Machine & Context Stack ─────────────────────────────────
const InteractionManager = {
  stack: [],
  currentState: {
    phase: 'IDLE',
    product: null,
    orderId: null,
    orderAmount: null,
    suggestion: null,
    htmlSnapshot: null
  },

  updateBadge() {
    const badge = document.getElementById('stack-badge');
    const text = document.getElementById('stack-badge-text');
    if (!badge) return;
    if (this.stack.length > 0) {
      badge.style.display = 'inline-flex';
      const last = this.stack[this.stack.length - 1];
      const prod = last.product ? last.product.toUpperCase() : 'ORDER';
      if (text) text.textContent = `${this.stack.length} Suspended (${prod})`;
      badge.title = `Resume ${prod} (Click or say 'Back to my order')`;
    } else {
      badge.style.display = 'none';
    }
  },

  setPhase(phase, data = {}) {
    const rc = document.getElementById('response-content');
    this.currentState = {
      phase: phase,
      product: data.product !== undefined ? data.product : this.currentState.product,
      orderId: data.orderId !== undefined ? data.orderId : this.currentState.orderId,
      orderAmount: data.orderAmount !== undefined ? data.orderAmount : this.currentState.orderAmount,
      suggestion: data.suggestion !== undefined ? data.suggestion : this.currentState.suggestion,
      htmlSnapshot: data.htmlSnapshot !== undefined ? data.htmlSnapshot : (rc ? rc.innerHTML : null)
    };
    currentContextStage = phase.toLowerCase();
    if (this.currentState.orderId) stagedOrderId = this.currentState.orderId;
    if (this.currentState.orderAmount) stagedOrderAmt = this.currentState.orderAmount;
    if (this.currentState.product) activeFlowProduct = this.currentState.product;
    if (this.currentState.suggestion) pendingSuggestion = this.currentState.suggestion;

    addHudEvent('state', 'STATE_TRANSITION', `Active Phase: <strong>[${phase}]</strong> ${this.currentState.product ? `· Product: ${this.currentState.product}` : ''} ${this.currentState.orderId ? `· Order #${this.currentState.orderId}` : ''}`);
    this.updateBadge();
  },

  suspendForInterruption(interruptionPhase = 'PROACTIVE_INTERRUPT') {
    if (this.currentState.phase !== 'IDLE' && this.currentState.phase !== 'PROACTIVE_INTERRUPT') {
      const rc = document.getElementById('response-content');
      const snapshot = {
        ...this.currentState,
        htmlSnapshot: rc ? rc.innerHTML : null
      };
      this.stack.push(snapshot);
      addHudEvent('state', 'STATE_SUSPEND', `Suspended <strong>[${snapshot.phase}]</strong> (Order #${snapshot.orderId || 'N/A'} · $${snapshot.orderAmount || '0.00'}) onto interruption stack`);
    }
    this.currentState = {
      phase: interruptionPhase,
      product: null,
      orderId: null,
      orderAmount: null,
      suggestion: null,
      htmlSnapshot: null
    };
    currentContextStage = interruptionPhase.toLowerCase();
    this.updateBadge();
  },

  hasSuspendedState() {
    return this.stack.length > 0;
  },

  getSuspendedOrder() {
    if (this.stack.length === 0) return null;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const s = this.stack[i];
      if (s.phase === 'ORDER_STAGED' || s.orderId) {
        return {
          id: s.orderId || '10',
          amt: s.orderAmount || '37.00',
          desc: s.product ? `${s.product} order` : `Order #${s.orderId || '10'}`
        };
      }
    }
    const last = this.stack[this.stack.length - 1];
    return {
      id: last.orderId || '10',
      amt: last.orderAmount || '37.00',
      desc: last.product ? `${last.product} order` : 'Staged Order'
    };
  },

  popAndResume() {
    if (this.stack.length > 0) {
      const suspended = this.stack.pop();
      this.currentState = suspended;
      currentContextStage = suspended.phase.toLowerCase();
      stagedOrderId = suspended.orderId;
      stagedOrderAmt = suspended.orderAmount;
      activeFlowProduct = suspended.product;
      pendingSuggestion = suspended.suggestion;

      addHudEvent('state', 'STATE_RESUME', `Resumed <strong>[${suspended.phase}]</strong> (Order #${suspended.orderId || 'N/A'} · $${suspended.orderAmount || '0.00'})`);
      this.updateBadge();

      if (suspended.htmlSnapshot) {
        CardRenderer.mount(suspended.htmlSnapshot, suspended.phase.toLowerCase());
      }

      let resumeText = '';
      if (suspended.phase === 'ORDER_STAGED') {
        const amtStr = suspended.orderAmount ? `$${suspended.orderAmount}` : '';
        resumeText = `Returning to your ${suspended.product || 'staged'} order ${amtStr ? `totaling ${amtStr}` : ''}. Ready to authorize.`;
      } else if (suspended.phase === 'ALTERNATIVE_SELECTION') {
        resumeText = `Returning to your ${suspended.product || 'supplier'} alternative choices. Say Option 1 to proceed.`;
      } else if (suspended.phase === 'BRIEFING_ACTIVE') {
        resumeText = `Returning to your morning briefing.`;
      }

      if (resumeText && sessionEngine !== 'bedrock_sonic') {
        speakProactiveResume(resumeText);
      }
      return true;
    }
    return false;
  },

  resetOnCompletion() {
    this.stack = [];
    this.currentState = {
      phase: 'IDLE',
      product: null,
      orderId: null,
      orderAmount: null,
      suggestion: null,
      htmlSnapshot: null
    };
    currentContextStage = 'idle';
    stagedOrderId = null;
    stagedOrderAmt = null;
    activeFlowProduct = null;
    pendingSuggestion = null;
    addHudEvent('state', 'STATE_RESET', 'Interaction completed successfully. State and stack cleared to <strong>[IDLE]</strong>.');
    this.updateBadge();
  }
};

function speakProactiveResume(text) {
  // Polly TTS disabled — testing exclusively with Nova Sonic
  return;
  /*
  if (!text) return;
  fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
  }).then(r => {
    if (!r.ok) throw new Error("TTS failed");
    return r.blob();
  }).then(blob => {
    const audioOut = document.getElementById('audio-out');
    if (audioOut) {
      isSpeaking = true;
      playingAudio = true;
      setOrbState('speaking');
      if (speechRec) { try { speechRec.abort(); } catch(_) {} }
      audioOut.src = URL.createObjectURL(blob);
      audioOut.play().catch(() => onSpeakingFinished());
      audioOut.onended = () => onSpeakingFinished();
      audioOut.onerror = () => onSpeakingFinished();
    }
  }).catch(e => {
    console.warn("Resume TTS notice:", e);
    onSpeakingFinished();
  });
  */
}

let voiceReconnectAttempts = 0;

// ── Voice Session Connection ──────────────────────────────────────────────────
async function toggleVoice() {
  if (isSpeaking || playingAudio) {
    smoothBargeInStop('User manual interrupt');
    isSpeaking = false;
    playingAudio = false;
    onSpeakingFinished();
  }

  if (isMicActive) {
    isMicActive = false;
    voiceReconnectAttempts = 0;
    // Disarm timer if mic is muted manually
    if (presentationAmbientTimer) {
      clearTimeout(presentationAmbientTimer);
      presentationAmbientTimer = null;
    }
    setOrbState('');
    stopMic();
    if (voiceWS) {
      voiceWS.close();
      voiceWS = null;
    }
    addHudEvent('audio', 'MIC_MUTED', 'Microphone muted');
  } else {
    isMicActive = true;
    voiceReconnectAttempts = 0;
    setOrbState('listening');
    // 🎯 START THE 25-SECOND CLOCK FOR ACT 1
    armPresentationAmbientTimer(25);
    if (!sessionReady || !voiceWS || voiceWS.readyState !== WebSocket.OPEN) {
      await startVoiceSession();
    } else {
      await startMic();
    }
    addHudEvent('audio', 'MIC_ACTIVE', 'Continuous ambient listening active — Attention Gate enabled');
  }
}

async function startVoiceSession() {
  if (voiceWS && voiceWS.readyState === WebSocket.OPEN) {
    voiceWS.close();
  }

  isMicActive = true;
  setOrbState('listening');
  addHudEvent('audio', 'SESSION', 'Opening Nova Sonic bidirectional stream…');

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  voiceWS = new WebSocket(`${protocol}//${location.host}/ws/voice`);
  voiceWS.onmessage = handleSonicMessage;
  voiceWS.onerror = () => console.warn("Nova Sonic WebSocket error.");
  voiceWS.onclose = () => {
    console.warn("Nova Sonic WebSocket closed.");
    sessionReady = false;
    if (isMicActive) {
      voiceReconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, voiceReconnectAttempts - 1), 8000);
      addHudEvent('audio', 'RECONNECTING', `Session timed out. Re-establishing Nova Sonic stream (retry #${voiceReconnectAttempts} in ${Math.round(delay)}ms)...`);
      setTimeout(() => {
        if (isMicActive) startVoiceSession();
      }, delay);
    } else if (speechRec && sessionEngine !== 'bedrock_sonic') {
      try { speechRec.start(); } catch(_) {}
    }
  };

  await startMic();
}

// ── Message Dispatcher (Nova Sonic & Backend Router) ─────────────────────────
function handleSonicMessage(evt) {
  const msg = JSON.parse(evt.data);

  switch(msg.type) {
    case 'session_ready':
      sessionReady = true;
      voiceReconnectAttempts = 0;
      sessionEngine = msg.engine || 'autonomous_nova_sonic';
      if (msg.sample_rate) streamAudioSampleRate = msg.sample_rate;
      addHudEvent('audio', 'SESSION_READY',
        (sessionEngine === 'bedrock_sonic'
          ? '🎤 Bedrock Nova Sonic stream live — raw audio piped directly (attention handled natively)'
          : '⚡ Autonomous Nova Sonic Engine live — 16kHz audio stream + Attention Classifier active'));
      break;

    case 'audio':
      if (speechRec) {
        try { speechRec.abort(); } catch(_) {}
      }
      audioQueue.push(msg.data);
      playNextAudio();
      break;

    case 'speech_done':
      break;

    case 'barge_in':
      smoothBargeInStop('Server barge-in notification');
      break;

    case 'ambient_dismissed':
      resolveOrDismissInterruption();
      break;

    case 'transcript':
      const isAside = msg.attention && msg.attention.action === 'STANDBY';
      if (msg.role === 'USER') {
        if (msg.ignored || isAside) {
          addHudEvent('audio', 'STANDBY', msg.text ? msg.text.slice(0, 120) : 'Standby');
          return;
        } else {
          // Display user query in dedicated left-column pill
          const userBubbleWrap = document.getElementById('user-bubble-wrapper');
          const userSpeechText = document.getElementById('user-speech-text');
          if (userBubbleWrap && userSpeechText) {
            userSpeechText.textContent = msg.text;
            userBubbleWrap.style.display = 'flex';
          }
          const assistantBubble = document.getElementById('assistant-speech-bubble');
          if (assistantBubble) {
            assistantBubble.innerHTML = `<span style="color:#94a3b8; font-size:1.05rem;"><i class="fas fa-satellite-dish fa-beat" style="color:var(--accent);margin-right:8px;"></i> Nova Sonic streaming response…</span>`;
          }
          const statusEl = document.getElementById('orb-status');
          if (statusEl) statusEl.textContent = `Processing: "${msg.text}"`;
          setOrbState('thinking');
        }
      } else if (msg.role === 'ASSISTANT' || isAside) {
        if (msg.text) {
          currentSpokenText = (msg.text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
          recentSpokenTexts.unshift(msg.text);
          if (recentSpokenTexts.length > 8) recentSpokenTexts.pop();

          const hasCardPayload = (
            msg.text.includes('ORDER_CREATED') ||
            msg.text.includes('ORDER_AUTHORIZED') ||
            msg.text.includes('CONTRACT_RENEWED') ||
            msg.text.includes('PRICE_UPDATE_') ||
            msg.text.includes('INVENTORY_') ||
            msg.text.includes('MORNING_BRIEFING')
          );

          // Clean conversational dialogue for left column
          const cleanSpeech = (msg.text || '')
            .replace(/<[^>]*>/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/INVENTORY_RESULTS\|[^\n]*/g, '')
            .replace(/ORDER_CREATED_SUCCESSFULLY\|[^\n]*/g, '')
            .replace(/ORDER_AUTHORIZED_SUCCESSFULLY\|[^\n]*/g, '')
            .replace(/CONTRACT_RENEWED_SUCCESSFULLY\|[^\n]*/g, '')
            .replace(/PRICE_UPDATE_WITH_ALTERNATIVES\|[^\n]*/g, '')
            .trim();

          const assistantBubble = document.getElementById('assistant-speech-bubble');
          if (assistantBubble && cleanSpeech) {
            assistantBubble.innerHTML = cleanSpeech
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\n\n/g, '<br><br>')
              .replace(/\n/g, '<br>');
          }

          // Structured card payloads mount in right-column workspace
          if (hasCardPayload || isAside) {
            showResponse(msg.text, isAside);
          }
        }
      }
      addHudEvent('audio', isAside ? 'STANDBY' : (msg.role || 'AGENT'), msg.text ? msg.text.slice(0, 120) : 'Standby');
      if (msg.attention) updateAttentionBadge(msg.attention);
      break;

    case 'tool_call':
      isChatBusy = true;
      addHudEvent('tool_call', 'MCP_CALL', `<span class="hud-key">tool</span>: ${msg.tool}`);
      switchTab('hud');

      const intentLower = (msg.args && (msg.args.user_intent || msg.args.intent) || '').toLowerCase();
      const isResumeIntent = ['resume', 'the other', 'go back', 'back to', 'return', 'previous', 'where were we'].some(w => intentLower.includes(w));
      if ((InteractionManager.currentState.phase === 'ORDER_STAGED' || InteractionManager.currentState.phase === 'ALTERNATIVE_SELECTION') && msg.tool !== 'resume_previous_flow' && !isResumeIntent) {
        InteractionManager.suspendForInterruption('SIDE_QUERY');
      }
      break;

    case 'tool_result':
      isChatBusy = false;
      if (pendingAmbientAlert) {
        setTimeout(() => {
          if (!isChatBusy && !isSpeaking && !playingAudio && pendingAmbientAlert) {
            const held = pendingAmbientAlert;
            pendingAmbientAlert = null;
            addHudEvent('ambient', 'ALERT_RELEASED', `Releasing held alert after tool execution: ${held.scenario}`);
            handleAmbientScenario(held, false, true);
          }
        }, 3000);
      }
      break;

    case 'inventory_result':
      showResponse(msg.detail);
      addHudEvent('mcp', 'INVENTORY_RESULT', 'Displayed inventory catalog card');
      break;

    case 'price_spike_detected':
      showResponse(msg.detail);
      addHudEvent('mcp', 'PRICE_SPIKE', 'Displayed price spike alternative card');
      break;

    case 'order_authorized':
      showResponse(msg.detail);
      addHudEvent('mcp', 'ORDER_AUTHORIZED', 'Order authorized and dispatched');
      break;

    case 'resume_previous_flow':
      if (InteractionManager.hasSuspendedState()) {
        InteractionManager.popAndResume();
      }
      showResponse(msg.detail);
      addHudEvent('mcp', 'RESUME_FLOW', `Resumed staged order #${msg.order_id || ''}`);
      break;

    case 'order_created':
      showResponse(msg.detail);
      addHudEvent('mcp', 'ORDER_CREATED', msg.detail);
      break;

    case 'session_end':
      onSpeakingFinished();
      break;

    case 'error':
      addHudEvent('audio', 'NOTICE', msg.message);
      console.warn('Voice session notice:', msg.message);
      break;
  }
}

// ── Response Presentation & Data Injection ───────────────────────────────────
let authDismissTimer = null; // Auto-dismiss handle for hands-free presentation

function showResponse(text, isAside = false, prompt = "") {
  if (text === null || text === undefined) text = '';
  if (typeof text !== 'string') text = String(text);

  if (isAside) {
    CardRenderer.mount(AsideCardComponent({ text, prompt }), 'aside');
    return;
  }

  // 1. Inventory Search Results
  if (text.includes('INVENTORY_RESULTS') || text.includes('Inventory Search Results') || text.includes('Here are the current inventory results')) {
    renderInventoryCard(text, prompt);
    return;
  }

  const promptLower = (prompt || '').toLowerCase().trim();

  // Reset stage if brand new action initiated
  const isNewQuery = ['miss', 'briefing', 'notification', 'inbox', 'inventory', 'stock', 'search', 'order', 'reorder', 'restock', 'buy', 'paper', 'coffee', 'beans', 'price', 'spike', 'alternative', 'meeting', 'proposal'].some(w => promptLower.includes(w));
  if (currentContextStage === 'order_authorized' && isNewQuery) {
    currentContextStage = 'idle';
    stagedOrderId = null;
    stagedOrderAmt = null;
  }

  // Check authorization intents
  if (promptLower.includes('authorize purchase order') || 
     (currentContextStage === 'order_staged' && (promptLower.includes('authorize') || promptLower.includes('approve') || promptLower === 'yes' || promptLower.includes('confirm')))) {
    if (!text.includes('ORDER_AUTHORIZED_SUCCESSFULLY')) {
      text = `ORDER_AUTHORIZED_SUCCESSFULLY|${stagedOrderId || '10'}|${stagedOrderAmt || '37.00'}`;
    }
  }

  // 2. Order Authorized Successfully (AUTO-DISMISS AFTER 6.5s)
  if (text.includes('ORDER_AUTHORIZED_SUCCESSFULLY')) {
    InteractionManager.resetOnCompletion();
    const lines = text.split('\n');
    const parts = lines[0].split('|');
    const id = parts[1] || stagedOrderId || '10';
    const amt = parts[2] || stagedOrderAmt || '37.00';
    CardRenderer.mount(AuthSuccessCardComponent({ orderId: id, amount: amt, prompt }), 'auth');

    // ⚡ Hands-free auto dismiss: Wait for Nova Sonic to finish speaking (~5s), then clear workspace
    if (authDismissTimer) clearTimeout(authDismissTimer);
    authDismissTimer = setTimeout(() => {
      if (CardRenderer.activeCardType === 'auth') {
        clearResponseAndShowIdle();
        addHudEvent('state', 'AUTO_DISMISS', 'Workspace returned to idle after order dispatch.');
      }
    }, 6500);

    return;
  }

  // 3. Supplier Contract Renewed (AUTO-DISMISS AFTER 6.5s)
  if (text.includes('CONTRACT_RENEWED_SUCCESSFULLY')) {
    InteractionManager.resetOnCompletion();
    CardRenderer.mount(ContractSuccessCardComponent({ prompt }), 'contract');

    if (authDismissTimer) clearTimeout(authDismissTimer);
    authDismissTimer = setTimeout(() => {
      if (CardRenderer.activeCardType === 'contract') {
        clearResponseAndShowIdle();
      }
    }, 6500);

    return;
  }

  // 4. Order Created / Staged Successfully
  if (text.includes('ORDER_CREATED_SUCCESSFULLY')) {
    activeFlowProduct = detectActiveProduct(text, prompt);
    const lines = text.split('\n');
    const parts = lines[0].split('|');
    const id = parts[1] || stagedOrderId || '10';
    const rest = parts[2] || stagedOrderAmt || '37.00';
    const total = parseFloat(rest) || 37.00;
    stagedOrderId = id;
    stagedOrderAmt = total.toFixed(2);

    InteractionManager.setPhase('ORDER_STAGED', {
      product: activeFlowProduct,
      orderId: id,
      orderAmount: stagedOrderAmt,
      suggestion: `Authorize purchase order #${id}`
    });

    const details = lines.slice(1).join(' ').replace(/\*\*/g, '').trim() || 'Staged for autonomous restock.';
    const suspended = InteractionManager.hasSuspendedState() ? InteractionManager.getSuspendedOrder() : null;
    CardRenderer.mount(OrderCardComponent({ orderId: id, orderAmount: stagedOrderAmt, details, suspended, prompt }), 'order');
    return;
  }

  // 5. Price Spike Alert & Supplier Alternatives
  if (text.includes('PRICE_UPDATE_WITH_ALTERNATIVES')) {
    playInterruptionChime();
    activeFlowProduct = detectActiveProduct(text, prompt);
    const lines = text.split('\n');
    const headerParts = (lines[0] || '').split('|');
    const category = headerParts[1] || 'Coffee';
    InteractionManager.setPhase('ALTERNATIVE_SELECTION', {
      product: category,
      suggestion: category.toLowerCase() === 'paper' ? 'Option 1: Switch to OfficePro' : 'Option 1: Switch to Colombian'
    });

    CardRenderer.mount(PriceSpikeCardComponent({ category, prompt }), 'price_spike');
    return;
  }

  // 6. Morning Executive Briefing
  if (text.includes('Here is what you missed') || text.includes('Acme Corp contract sync')) {
    InteractionManager.setPhase('BRIEFING_ACTIVE', {
      product: 'general',
      suggestion: 'Restock the coffee'
    });
    CardRenderer.mount(BriefingCardComponent({ prompt }), 'briefing');
    return;
  }

  // 7. Clean Agent Dialogue (Streams to Left Column Voice Viewport)
  const cleanFormatted = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  const assistantBubble = document.getElementById('assistant-speech-bubble');
  if (assistantBubble && cleanFormatted) {
    assistantBubble.innerHTML = cleanFormatted;
  }

  if (prompt) {
    const userBubbleWrap = document.getElementById('user-bubble-wrapper');
    const userSpeechText = document.getElementById('user-speech-text');
    if (userBubbleWrap && userSpeechText) {
      userSpeechText.textContent = prompt;
      userBubbleWrap.style.display = 'flex';
    }
  }
}

function renderInventoryCard(rawText, prompt = "") {
  if ((currentContextStage === 'order_staged' || InteractionManager.currentState.phase === 'ORDER_STAGED') && stagedOrderId) {
    InteractionManager.suspendForInterruption('INVENTORY_VIEW');
  } else {
    InteractionManager.setPhase('INVENTORY_VIEW', { product: detectActiveProduct(rawText, prompt) });
  }

  let queryTitle = 'Catalog Inventory';
  if (rawText.includes('INVENTORY_RESULTS|')) {
    const q = rawText.split('INVENTORY_RESULTS|')[1].split('\n')[0].trim();
    if (q) queryTitle = q.toUpperCase() + ' INVENTORY';
  }

  const lines = rawText.split('\n');
  const items = [];
  for (const line of lines) {
    if (line.trim().startsWith('-') && line.includes('Price:')) {
      const parts = line.replace(/^[-\*\s]+/, '').split('|');
      const name = (parts[0] || '').trim();
      let price = '$8.99';
      let stock = 'In Stock';
      for (const p of parts.slice(1)) {
        if (p.toLowerCase().includes('price:')) {
          price = p.replace(/price:/i, '').trim();
        } else if (p.toLowerCase().includes('stock:')) {
          stock = p.replace(/stock:/i, '').trim() + ' in stock';
        }
      }
      items.push({ name, price, stock });
    }
  }

  if (items.length === 0) {
    const lower = (rawText + ' ' + prompt).toLowerCase();
    if (lower.includes('paper')) {
      items.push({ name: 'OfficePro A4 Printer Paper (500 sheets)', price: '$7.49', stock: '150 in stock' });
      items.push({ name: 'Acme A4 Printer Paper (500 sheets)', price: '$8.99', stock: '120 in stock' });
    } else if (lower.includes('coffee')) {
      items.push({ name: 'Ethiopian Yirgacheffe Coffee Beans (1kg)', price: '$18.50', stock: '45 in stock' });
      items.push({ name: 'Colombian Supremo Coffee Beans (1kg)', price: '$16.50', stock: '60 in stock' });
    } else {
      items.push({ name: 'A4 Printer Paper (500 sheets)', price: '$8.99', stock: '120 in stock' });
      items.push({ name: 'Ethiopian Yirgacheffe Coffee Beans', price: '$18.50', stock: '45 in stock' });
    }
  }

  const suspended = InteractionManager.hasSuspendedState() ? InteractionManager.getSuspendedOrder() : null;
  CardRenderer.mount(InventoryCardComponent({ queryTitle, items, suspended, prompt }), 'inventory');
}

// ── Action Handlers ───────────────────────────────────────────────────────────
function authorizeStagedOrder(id, total) {
  stagedOrderId = id || stagedOrderId;
  stagedOrderAmt = total || stagedOrderAmt;
  typedFallback(`Authorize purchase order #${stagedOrderId}`);
}

function clearResponseAndShowIdle() {
  currentContextStage = 'idle';
  pendingSuggestion = null;
  activeFlowProduct = null;
  if (ambientTimeout) {
    clearTimeout(ambientTimeout);
    ambientTimeout = null;
  }
  if (authDismissTimer) {
    clearTimeout(authDismissTimer);
    authDismissTimer = null;
  }
  showHints();
  setOrbState(isMicActive ? 'listening' : '');
  const statusEl = document.getElementById('orb-status');
  if (statusEl && !isMicActive) statusEl.textContent = 'Tap to Speak';
  checkAndTriggerPendingUnrelatedAlert(); // Releases next alert from the FIFO queue
}

function resolveOrDismissInterruption() {
  if (ambientTimeout) {
    clearTimeout(ambientTimeout);
    ambientTimeout = null;
  }
  if (InteractionManager.hasSuspendedState()) {
    InteractionManager.popAndResume();
  } else {
    clearResponseAndShowIdle();
  }
}

async function typedFallback(msg, origin = 'typed') {
  if (!msg || !msg.trim()) return;
  const lowerMsg = msg.toLowerCase().trim();
  let forceModality = 'chat';
  let resolvedMsg = msg;

  if (isPresenterMode && ['step1', 'step2', 'step3', 'step4'].some(k => lowerMsg.includes(k))) {
    forceModality = 'voice';
  }

  const isDetour = ['miss', 'briefing', 'notification', 'inbox', 'inventory', 'stock', 'search', 'aside', 'judges'].some(w => lowerMsg.includes(w));
  if (isDetour && (InteractionManager.currentState.phase === 'ORDER_STAGED' || InteractionManager.currentState.phase === 'ALTERNATIVE_SELECTION')) {
    InteractionManager.suspendForInterruption('SIDE_QUERY');
  }

  isChatBusy = true;
  if (speechRec) {
    try { speechRec.abort(); } catch(_) {}
  }

  const userBubbleWrap = document.getElementById('user-bubble-wrapper');
  const userSpeechText = document.getElementById('user-speech-text');
  if (userBubbleWrap && userSpeechText) {
    userSpeechText.textContent = msg;
    userBubbleWrap.style.display = 'flex';
  }
  const assistantBubble = document.getElementById('assistant-speech-bubble');
  if (assistantBubble) {
    assistantBubble.innerHTML = `<span style="color:#94a3b8; font-size:1.05rem;"><i class="fas fa-microchip fa-spin" style="color:var(--accent);margin-right:8px;"></i> Querying Amazon Nova Pro & MCP…</span>`;
  }
  const statusEl = document.getElementById('orb-status');
  if (statusEl) statusEl.textContent = `Processing: "${msg}"`;
  setOrbState('thinking');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: resolvedMsg,
        modality: forceModality,
        presenter_mode: isPresenterMode
      })
    });
    const data = await res.json();

    const hasCardPayload = data.reply && (
      data.reply.includes('INVENTORY_RESULTS') ||
      data.reply.includes('Inventory Search Results') ||
      data.reply.includes('ORDER_CREATED_SUCCESSFULLY') ||
      data.reply.includes('ORDER_AUTHORIZED_SUCCESSFULLY') ||
      data.reply.includes('PRICE_UPDATE_WITH_ALTERNATIVES') ||
      data.reply.includes('MORNING_BRIEFING')
    );

    const cleanSpeech = (data.reply || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/INVENTORY_RESULTS\|[^\n]*/g, '')
      .replace(/ORDER_CREATED_SUCCESSFULLY\|[^\n]*/g, '')
      .replace(/ORDER_AUTHORIZED_SUCCESSFULLY\|[^\n]*/g, '')
      .replace(/CONTRACT_RENEWED_SUCCESSFULLY\|[^\n]*/g, '')
      .replace(/PRICE_UPDATE_WITH_ALTERNATIVES\|[^\n]*/g, '')
      .trim();

    if (assistantBubble && cleanSpeech) {
      assistantBubble.innerHTML = cleanSpeech
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');
    }

    if (hasCardPayload || data.presenter_aside) {
      showResponse(data.reply, data.presenter_aside, msg);
    }

    if (data.audio_b64) {
      isSpeaking = true;
      playingAudio = true;
      setOrbState('speaking');

      const bytes = Uint8Array.from(atob(data.audio_b64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: 'audio/mpeg' });
      const audioOut = document.getElementById('audio-out');
      audioOut.src = URL.createObjectURL(blob);
      audioOut.play().catch(e => {
        console.warn("Audio autoplay blocked or failed:", e);
        onSpeakingFinished();
      });
    } else {
      onSpeakingFinished();
    }
  } catch(e) {
    console.error("typedFallback error:", e);
    showResponse('Connection error. Is the server running?');
    onSpeakingFinished();
  } finally {
    isChatBusy = false;
  }
}

// ── Proactive Ambient Scenario Handler ─────────────────────────────────────────
function handleAmbientScenario(sc, isForced = false, isHeldRelease = false) {
  if (!sc) return;
  const prod = getScenarioProduct(sc);

  // 1. Deduplication
  if (!isForced && !isHeldRelease && (alertedProducts.has(prod) || alertedScenarioIds.has(sc.id))) {
    return;
  }

  // 2a. Contextual Flow Gate — don't interrupt active purchase unless it's related
  const isInPurchaseFlow = (currentContextStage === 'order_staged' || currentContextStage === 'alternative_selection' || isChatBusy);
  if (isInPurchaseFlow && !isForced) {
    const isSameProduct = (activeFlowProduct && prod === activeFlowProduct);
    if (!isSameProduct) {
      const added = NoticeTray.addNotice(sc);
      if (added) {
        addHudEvent('ambient', 'ALERT_QUEUED', `Holding alert (purchase in progress, different product): ${sc.scenario}`);
      }
      return;
    }
    addHudEvent('ambient', 'CONTEXTUAL_INTERRUPT', `Contextual price alert during purchase of ${prod}: ${sc.scenario}`);
  }

  const severity = (sc.severity || 'info').toLowerCase();
  const isCritical = (
    severity === 'critical' || 
    severity === 'warning' || 
    sc.id === 'supplier_price_spike' || 
    sc.id === 'low_stock_critical'
  );

  // Check if user is currently presenting, AI is on Standby, or an active order is being staged
  const isStandbyOrBusy = (
    isPresenterMode ||
    currentContextStage === 'standby' ||
    isInPurchaseFlow
  );

  // 2b. Intelligent Severity Gate
  if (isStandbyOrBusy && !isForced && !isHeldRelease) {
    if (!isCritical) {
      // 🟢 LOW / INFO SEVERITY: Do not speak or disturb presenter. Buffer silently into FIFO NoticeTray.
      const added = NoticeTray.addNotice(sc);
      if (added) {
        addHudEvent('ambient', 'SEVERITY_TRIAGE', `[${severity.toUpperCase()}] Low-urgency deal queued into Notice Tray during Standby: ${sc.scenario}`);
      }
      return;
    } else {
      // 🔴 CRITICAL / WARNING SEVERITY: Legitimate emergency — break through Standby!
      addHudEvent('ambient', 'CRITICAL_BREAKTHROUGH', `🚨 [${severity.toUpperCase()}] Critical event broke through Standby: ${sc.scenario}`);
    }
  }

  // 3. Speech-seamless gate
  const audioOut = document.getElementById('audio-out');
  const isCurrentlyPlaying = isSpeaking || playingAudio || (audioOut && !audioOut.paused && audioOut.currentTime > 0);

  if (isCurrentlyPlaying && !isForced && !isHeldRelease && !isCritical) {
    if (!pendingAmbientAlert) {
      pendingAmbientAlert = sc;
      addHudEvent('ambient', 'ALERT_QUEUED', `Holding alert until agent finishes speaking: ${sc.scenario}`);
    }
    return;
  }

  alertedProducts.add(prod);
  alertedScenarioIds.add(sc.id);

  const assistantBubble = document.getElementById('assistant-speech-bubble');
  if (assistantBubble) {
    assistantBubble.innerHTML = ''; // Clear "Nova Sonic streaming response…"
  }
  const statusEl = document.getElementById('orb-status');
  if (statusEl) {
    statusEl.textContent = 'Ambient Alert Active';
  }

  const wasSpeaking = isCurrentlyPlaying;
  addHudEvent('ambient', isCritical ? 'URGENT_ALERT' : 'PROACTIVE_ALERT', `${isCritical ? '⚠️ Urgent Interrupt' : 'Notice Announcement'}: ${sc.scenario}`);

  if (wasSpeaking) {
    smoothBargeInStop('Critical ambient notice blended into conversation');
  }

  // Sync with backend WebSocket
  if (voiceWS && voiceWS.readyState === WebSocket.OPEN) {
    voiceWS.send(JSON.stringify({
      type: 'ambient_alert',
      scenario_id: sc.id,
      severity: severity,
      is_critical: isCritical,
      scenario: sc.scenario,
      detail: sc.detail,
      spoken: (wasSpeaking && sc.spoken_interrupted) ? sc.spoken_interrupted : sc.spoken,
      suggestion: sc.suggestion,
      product: prod,
      was_speaking: wasSpeaking,
      is_resumed: sc.is_resumed || false
    }));
  }

  InteractionManager.suspendForInterruption('PROACTIVE_INTERRUPT');
  currentContextStage = 'proactive_deal';
  pendingSuggestion = sc.suggestion;

  renderProactiveScenarioCard(sc);

  if (ambientTimeout) clearTimeout(ambientTimeout);
  ambientTimeout = setTimeout(() => {
    if (currentContextStage === 'proactive_deal' && !isSpeaking && !playingAudio) {
      addHudEvent('ambient', 'AUTO_DISMISS', 'Proactive deal ignored by user.');
      resolveOrDismissInterruption();
    }
  }, 90000);

  // Sidecar log
  const log = document.getElementById('ambient-log');
  if (log) {
    const el = document.createElement('div');
    el.className = 'alog';
    el.innerHTML = `
      <div class="alog-badge">${sc.severity || 'ALERT'}</div>
      <div class="alog-title">${sc.scenario}</div>
      <div class="alog-detail">${sc.detail}</div>
      <button class="alog-act" onclick="typedFallback('${(sc.suggestion || '').replace(/'/g, "\\'")}')">
        ${sc.action_label}
      </button>`;
    log.insertBefore(el, log.firstChild);
  }

  if (isHeldRelease) {
    playProactiveSpeech(sc, false);
  } else {
    playInterruptionChime(() => {
      playProactiveSpeech(sc, wasSpeaking);
    });
  }
}

function renderProactiveScenarioCard(sc) {
  if (sc.id === 'supplier_price_spike' || sc.discount_type === 'price_spike_alternative') {
    CardRenderer.mount(PriceSpikeCardComponent({ category: 'Coffee' }), 'price_spike');
    return;
  }

  if (sc.discount_type === 'past_purchase_deal') {
    const isCoffee = (sc.item_name || '').toLowerCase().includes('coffee');
    const savingsVal = (sc.savings || 7.40).toFixed(2);
    const regVal = (sc.regular_price || (isCoffee ? 18.50 : 16.99)).toFixed(2);
    const dealVal = (sc.deal_price || (isCoffee ? 14.80 : 11.89)).toFixed(2);

    const html = `
      <div class="briefing-container" style="border-color: rgba(16, 185, 129, 0.45); animation: fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
        <div class="briefing-header" style="background: rgba(16, 185, 129, 0.12);">
          <div class="briefing-title" style="color: #10b981;"><i class="fas fa-tag fa-shake"></i> Proactive Opportunity · Past Purchase Discount</div>
          <div class="briefing-badge" style="background: #059669; color: #fff;">⚡ Deal Alert · Save $${savingsVal}</div>
        </div>
        <div style="padding:16px 20px 8px; font-size:14px; color:#cbd5e1;">
          ${sc.detail}
        </div>
        <div class="briefing-cards" style="grid-template-columns: 1fr; padding: 12px 20px;">
          <div class="briefing-card" style="border-color: rgba(16, 185, 129, 0.5); background: rgba(16, 185, 129, 0.08); padding: 16px;">
            <div class="bc-icon" style="color: #10b981; font-size: 26px;"><i class="fas fa-bolt"></i></div>
            <div class="bc-body" style="flex:1;">
              <div class="bc-tag" style="color: #10b981;">Exclusive Past-Purchase Discount · Save $${savingsVal}</div>
              <div style="font-size:16px; font-weight:700; color:#fff; margin-top:2px;">${sc.item_name}</div>
              <div class="bc-text" style="color:#cbd5e1; margin-top:6px;">
                <span style="text-decoration:line-through; color:#94a3b8; margin-right:8px;">$${regVal}</span>
                <strong style="color:#10b981; font-size:18px;">$${dealVal}</strong> / unit
                &nbsp;·&nbsp; Total Order: <strong>$${sc.order_amount}</strong>
              </div>
            </div>
          </div>
        </div>
        <div class="briefing-followup" style="padding-top:10px;">
          <div class="bf-question"><i class="fas fa-robot"></i> Say <em>"Yes"</em> or <em>"${sc.suggestion}"</em> to lock in discount:</div>
          <div class="context-actions" style="margin-top:10px;">
            <button class="ctx-btn primary" style="background:linear-gradient(135deg, #059669, #10b981); color:#fff; border:none;" onclick="typedFallback('${(sc.suggestion || '').replace(/'/g, "\\'")}')">
              <i class="fas fa-check"></i> ${sc.action_label || 'Lock in Discount'}
            </button>
            <button class="ctx-btn dismiss" onclick="dismissActiveNotice(this, '${sc.id}')"><i class="fas fa-times"></i> Dismiss</button>
          </div>
        </div>
      </div>
    `;
    CardRenderer.mount(html, 'proactive_deal', 'interrupt-list', true);
    return;
  }

  if (sc.discount_type === 'volume_rebate') {
    const html = `
      <div class="briefing-container active-ambient-card" style="border-color: rgba(147, 51, 234, 0.45); animation: fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1); margin-bottom: 12px;">
        <div class="briefing-header" style="background: rgba(147, 51, 234, 0.12);">
          <div class="briefing-title" style="color: #c084fc;"><i class="fas fa-chart-line fa-shake"></i> Volume Tier Rebate Opportunity</div>
          <div class="briefing-badge" style="background: #7c3aed; color: #fff;">18% Tier 2 Rebate</div>
        </div>
        <div style="padding:16px 20px 8px; font-size:14px; color:#cbd5e1;">
          ${sc.detail}
        </div>
        <div class="briefing-followup" style="padding-top:10px;">
          <div class="bf-question"><i class="fas fa-robot"></i> Say <em>"Yes"</em> or tap to order 2 boxes and unlock the quarterly tier:</div>
          <div class="context-actions" style="margin-top:10px;">
            <button class="ctx-btn primary" style="background:linear-gradient(135deg, #7c3aed, #9333ea); color:#fff; border:none;" onclick="typedFallback('${(sc.suggestion || '').replace(/'/g, "\\'")}')">
              <i class="fas fa-bolt"></i> ${sc.action_label || 'Unlock Tier 2 Rebate'}
            </button>
            <button class="ctx-btn dismiss" onclick="dismissActiveNotice(this, '${sc.id}')"><i class="fas fa-times"></i> Dismiss</button>
          </div>
        </div>
      </div>
    `;
    CardRenderer.mount(html, 'volume_rebate', 'interrupt-list', true);
    return;
  }

  // Default scenario card
  const html = `
    <div class="briefing-container active-ambient-card" style="border-color: rgba(239, 68, 68, 0.4); animation: fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1); margin-bottom: 12px;">
      <div class="briefing-header" style="background: rgba(239, 68, 68, 0.12);">
        <div class="briefing-title" style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Ambient Intelligence Alert</div>
        <div class="briefing-badge" style="color:#ef4444; border-color:rgba(239,68,68,0.3);">${(sc.severity || 'ALERT').toUpperCase()}</div>
      </div>
      <div class="briefing-card supply" style="border-left-color: #ef4444; margin: 12px 20px;">
        <div class="bc-icon" style="color: #ef4444;"><i class="fas fa-bell"></i></div>
        <div class="bc-body">
          <div class="bc-tag">${sc.scenario}</div>
          <div class="bc-text">${sc.detail}</div>
        </div>
      </div>
      <div class="briefing-followup">
        <div class="bf-question"><i class="fas fa-bolt"></i> Autonomous Recommended Action</div>
        <div class="context-actions">
          <button class="ctx-btn primary" onclick="typedFallback('${(sc.suggestion || '').replace(/'/g, "\\'")}')"><i class="fas fa-arrow-right"></i> ${sc.action_label || sc.suggestion || 'Review Recommendation'}</button>
          <button class="ctx-btn dismiss" onclick="dismissActiveNotice(this, '${sc.id}')"><i class="fas fa-times"></i> Dismiss</button>
        </div>
      </div>
    </div>
  `;
  // Mount into the interrupt-list (Top Half) as an appended item so it doesn't wipe existing cards!
  CardRenderer.mount(html, 'ambient_alert', 'interrupt-list', true);
}

function checkAndTriggerPendingUnrelatedAlert() {
  const queuedAlert = NoticeTray.popNext();
  if (queuedAlert) {
    addHudEvent('ambient', 'ALERT_RESUMED', `Resuming postponed alert now that purchase flow is complete: ${queuedAlert.scenario}`);
    setTimeout(() => {
      queuedAlert.is_resumed = true;
      handleAmbientScenario(queuedAlert, true);
    }, 2200);
  }
}

function playProactiveSpeech(sc, wasSpeaking = false) {
  isSpeaking = true;
  playingAudio = true;
  setOrbState('speaking');

  const chosenAudioB64 = (wasSpeaking && sc.audio_interrupted_b64) ? sc.audio_interrupted_b64 : sc.audio_b64;
  const chosenSpokenText = (wasSpeaking && sc.spoken_interrupted)
    ? sc.spoken_interrupted
    : (sc.spoken || (`Oh, there is a notice: ${sc.detail} ${sc.suggestion || ''}`));

  currentSpokenText = chosenSpokenText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  if (speechRec) {
    try { speechRec.abort(); } catch(_) {}
  }

  const onSpeechEnd = () => {
    isSpeaking = false;
    playingAudio = false;
    lastSpeechEndTime = Date.now();
    setOrbState(isMicActive ? 'listening' : '');
    const audioOut = document.getElementById('audio-out');
    if (audioOut && audioOut.src && audioOut.src.startsWith('blob:')) {
      URL.revokeObjectURL(audioOut.src);
    }
    if (isMicActive && speechRec && sessionEngine !== 'bedrock_sonic') {
      try { speechRec.start(); } catch(_) {}
    }
  };

  const audioOut = document.getElementById('audio-out');
  if (!audioOut) return;
  // Restore canonical listener after proactive speech instead of clobbering
  audioOut.addEventListener('ended', onSpeechEnd, { once: true });
  audioOut.addEventListener('error', onSpeechEnd, { once: true });

  if (sessionEngine === 'bedrock_sonic') {
    setTimeout(() => onSpeechEnd(), 5000);
    return;
  }

  if (chosenAudioB64) {
    try {
      const binaryString = atob(chosenAudioB64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      audioOut.src = URL.createObjectURL(blob);
      audioOut.play().catch(e => {
        console.warn("Speech playback blocked by browser:", e);
        onSpeechEnd();
      });
      return;
    } catch(e) {
      console.warn("Failed to decode scenario audio_b64:", e);
    }
  }

  // Polly TTS disabled — testing exclusively with Nova Sonic
  onSpeechEnd();
  /*
  fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: chosenSpokenText })
  }).then(r => {
    if (!r.ok) throw new Error("TTS request failed");
    return r.blob();
  }).then(blob => {
    audioOut.src = URL.createObjectURL(blob);
    audioOut.play().catch(() => onSpeechEnd());
  }).catch(() => onSpeechEnd());
  */
}

// ── UI Controls & Presenter Mode ──────────────────────────────────────────────
function toggleAmbientLoop() {
  isAmbientLoopActive = !isAmbientLoopActive;
  const endpoint = isAmbientLoopActive ? '/api/ambient/start' : '/api/ambient/stop';
  const label = document.getElementById('ambient-loop-text');
  const btn = document.getElementById('ambient-loop-toggle');

  if (label) label.textContent = 'Proactive';
  if (btn) {
    if (isAmbientLoopActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }

  fetch(endpoint, { method: 'POST' }).catch(() => {});
  addHudEvent('ambient', 'LOOP_TOGGLE', `Autonomous Background Engine: ${isAmbientLoopActive ? 'ACTIVE' : 'PAUSED'}`);
}

function togglePresenterMode() {
  isPresenterMode = !isPresenterMode;
  const banner = document.getElementById('presenter-banner');
  const btn = document.getElementById('presenter-toggle');
  const label = document.getElementById('pm-state');

  if (isPresenterMode) {
    if (banner) banner.style.display = 'block';
    if (btn) btn.classList.add('active');
    if (label) label.textContent = 'Demo';
    addHudEvent('presenter', 'DEMO_MODE', 'Dual Audience Demo Mode active — Cue bar visible');
  } else {
    if (banner) banner.style.display = 'none';
    if (btn) btn.classList.remove('active');
    if (label) label.textContent = 'Demo';
    addHudEvent('presenter', 'DEMO_MODE', 'Presenter mode disabled');
  }
}

function runPresenterCue(step) {
  const cues = {
    step1: "Alexa, what did I miss this morning?",
    step2: "⚡ Trigger Proactive Price/Deal",
    step3: "Alexa, check our past orders and restock the coffee beans",
    step4: "Judges, notice how our smart display monitors supplier feeds and automates approval workflows."
  };

  const text = cues[step] || step;
  if (step === 'step2') {
    fireAmbient('price_deal');
  } else {
    typedFallback(text);
  }
}

function toggleKeyboardInput(forceOpen) {
  const drawer = document.getElementById('keyboard-drawer');
  const input = document.getElementById('keyboard-input');
  if (!drawer) return;

  const shouldOpen = (forceOpen !== undefined) ? forceOpen : (drawer.style.display === 'none');
  drawer.style.display = shouldOpen ? 'block' : 'none';
  if (shouldOpen && input) {
    setTimeout(() => input.focus(), 80);
  }
}

function submitKeyboardInput() {
  const input = document.getElementById('keyboard-input');
  if (!input) return;
  const text = input.value.trim();
  if (text) {
    typedFallback(text, 'keyboard');
    input.value = '';
    toggleKeyboardInput(false);
  }
}

function applyKeyboardHint(txt) {
  const input = document.getElementById('keyboard-input');
  if (input) {
    input.value = txt;
    input.focus();
  }
}

function setOrbState(state) {
  const orb    = document.getElementById('orb');
  const ring   = document.getElementById('alexa-ring');
  const status = document.getElementById('orb-status');
  const icon   = document.getElementById('orb-icon');
  const badge  = document.getElementById('model-badge');

  if (orb) orb.className   = 'orb-container' + (state ? ' ' + state : '');
  if (ring) ring.className  = 'alexa-ring'    + (state ? ' ' + state : '');
  if (status) status.className = 'orb-status'   + (state ? ' ' + state : '');

  // Keep brand static: do not mutate brand-name

  if (state === 'listening') {
    if (status) status.textContent = 'Ambient Listening Active';
    if (icon) icon.className = 'fas fa-microphone orb-icon';
    if (badge) {
      badge.className = 'model-badge listening';
      badge.innerHTML = '<span class="status-dot-pulse red"></span> Listening';
    }
    isSpeaking = false;
  } else if (state === 'speaking') {
    if (status) status.textContent = 'Speaking… (Tap orb to interrupt)';
    if (icon) icon.className = 'fas fa-volume-up orb-icon';
    if (badge) {
      badge.className = 'model-badge speaking';
      badge.innerHTML = '<span class="status-dot-pulse cyan"></span> Speaking';
    }
  } else if (state === 'thinking') {
    if (status) status.textContent = 'Reasoning via Amazon Nova Pro…';
    if (icon) icon.className = 'fas fa-cog fa-spin orb-icon';
    if (badge) {
      badge.className = 'model-badge thinking';
      badge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Nova Pro';
    }
  } else {
    if (status) status.textContent = 'Tap to Speak';
    if (icon) icon.className = 'fas fa-microphone orb-icon';
    if (badge) {
      badge.className = 'model-badge';
      badge.innerHTML = '<i class="fas fa-bolt" style="color:var(--accent);"></i> Nova Sonic + Pro';
    }
  }
}

let attentionBadgeTimer = null;

function updateAttentionBadge(info) {
  const badge = document.getElementById('attention-badge');
  const label = document.getElementById('attn-label');
  if (!badge || !label) return;

  if (attentionBadgeTimer) {
    clearTimeout(attentionBadgeTimer);
    attentionBadgeTimer = null;
  }

  if (!info) {
    badge.style.display = 'none';
    return;
  }

  badge.className = 'attention-badge';
  badge.style.display = 'inline-flex';

  if (info.action === 'STANDBY') {
    if (info.intent === 'BYSTANDER_CHATTER') {
      badge.classList.add('bystander');
      label.textContent = 'Standby (Bystander)';
    } else {
      badge.classList.add('standby');
      label.textContent = 'Standby (Judge Narration)';
    }
    attentionBadgeTimer = setTimeout(() => {
      badge.style.display = 'none';
    }, 4500);
  } else {
    label.textContent = 'Addressing Alexa';
    attentionBadgeTimer = setTimeout(() => {
      badge.style.display = 'none';
    }, 2500);
  }
}

function addHudEvent(cls, typeStr, bodyStr) {
  const panel = document.getElementById('spanel-hud');
  const he = document.getElementById('hud-empty');
  if (he) he.style.display = 'none';
  if (!panel) return;

  const el = document.createElement('div');
  el.className = `hud-ev ${cls}`;
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.innerHTML = `<div class="hud-ts">${ts}</div><div class="hud-type">[${typeStr}]</div><div class="hud-body">${bodyStr}</div>`;
  panel.insertBefore(el, panel.children[1] || null);
  if (panel.querySelectorAll('.hud-ev').length > 30) panel.lastChild.remove();
}

function switchTab(tab) {
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.spanel').forEach(p => p.classList.remove('active'));
  const tabEl = document.getElementById(`stab-${tab}`);
  const panelEl = document.getElementById(`spanel-${tab}`);
  if (tabEl) tabEl.classList.add('active');
  if (panelEl) panelEl.classList.add('active');
}

async function fireAmbient(id = 'supplier_price_spike') {
  const now = Date.now();
  // Prevent duplicate execution within 2.5 seconds
  if (id === lastAmbientScenarioId && (now - lastAmbientTriggerTime < 2500)) {
    return;
  }
  lastAmbientTriggerTime = now;
  lastAmbientScenarioId = id;

  try {
    // Only send the HTTP trigger — the telemetry WebSocket will broadcast the scenario cleanly once!
    await fetch('/api/ambient/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_id: id })
    });
  } catch(e) {
    console.error("Failed to trigger ambient scenario:", e);
  }
}

// ── Active Notice Dismissal & Tray Cleaner ────────────────────────────────────
function dismissActiveNotice(buttonEl, scenarioId = null) {
  if (ambientTimeout) {
    clearTimeout(ambientTimeout);
    ambientTimeout = null;
  }

  // 1. Find and animate-out the specific notice card in #interrupt-list
  const card = buttonEl ? buttonEl.closest('.briefing-container, .notice-card, .active-ambient-card') : null;
  if (card) {
    card.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      card.remove();
      _checkAndRestoreTrayPlaceholder();
    }, 200);
  } else {
    // If no specific button passed, clean all notice cards in the tray
    const list = document.getElementById('interrupt-list');
    if (list) {
      list.querySelectorAll('.briefing-container, .notice-card, .active-ambient-card').forEach(el => el.remove());
    }
    _checkAndRestoreTrayPlaceholder();
  }

  // 2. Remove from NoticeTray memory
  if (scenarioId && typeof NoticeTray !== 'undefined') {
    NoticeTray.alerts = NoticeTray.alerts.filter(a => a.id !== scenarioId);
    NoticeTray.updateBadge();
  }

  addHudEvent('ambient', 'NOTICE_DISMISSED', `Dismissed notice: ${scenarioId || 'Active'}`);

  // 3. If there was a suspended task on the stack, resume it; otherwise go idle
  if (InteractionManager.hasSuspendedState()) {
    InteractionManager.popAndResume();
  } else {
    currentContextStage = 'idle';
    setOrbState(isMicActive ? 'listening' : '');
  }
}

function _checkAndRestoreTrayPlaceholder() {
  const list = document.getElementById('interrupt-list');
  const remaining = list ? list.querySelectorAll('.briefing-container, .notice-card, .active-ambient-card') : [];
  if (remaining.length === 0) {
    const emptyPlaceholder = document.getElementById('interrupt-empty');
    if (emptyPlaceholder) emptyPlaceholder.style.display = 'flex';
    const badge = document.getElementById('notices-count-badge');
    if (badge) {
      badge.textContent = '0 Active';
      badge.style.color = '#cbd5e1';
      badge.style.borderColor = 'rgba(255,255,255,0.08)';
    }
  }
}

// Global alias for compatibility
function resolveOrDismissInterruption() {
  dismissActiveNotice(null);
  clearResponseAndShowIdle();
}

// ── Telemetry WebSocket ───────────────────────────────────────────────────────
function connectTelemetryWS() {
  const _proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${_proto}//${location.host}/ws/telemetry`);

  ws.onopen = () => {
    // Premature background loop start removed. 
    // Ambient timing is now cleanly synchronized with when you tap the Orb to speak!
    // fetch('/api/ambient/start', { method: 'POST' }).catch(() => {});
  };

  ws.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);

      if (ev.type === 'ambient_scenario') {
        const payload = ev.payload || ev;
        handleAmbientScenario(payload);
        return;
      }

      const typeMap = {
        thinking: 'thinking',
        tool_call: 'tool_call',
        tool_result: 'tool_result',
        ambient_trigger: 'ambient',
        ambient_scenario: 'ambient',
        presenter_aside: 'presenter',
        presenter_mode: 'presenter',
        attention: 'attention',
        barge_in: 'barge_in',
        dual_model_handoff: 'dual_model_handoff'
      };
      const cls = typeMap[ev.type] || '';
      if (cls) {
        let body = '';
        if (ev.type === 'tool_call') {
          body = `<span class="hud-key">tool</span>: ${ev.tool}`;
        } else if (ev.type === 'tool_result') {
          body = ev.result;
        } else if (ev.type === 'attention') {
          body = `State: <strong>${ev.state.toUpperCase()}</strong> | Intent: <strong>${ev.speaker_intent}</strong><br><span style="color:#94a3b8">"${ev.text}"</span>`;
          updateAttentionBadge({ action: ev.state === 'standby' ? 'STANDBY' : 'EXECUTE', intent: ev.speaker_intent });
        } else if (ev.type === 'barge_in') {
          body = `<span style="color:#f59e0b"><i class="fas fa-hand-paper"></i> ${ev.detail || 'User speech detected'}</span>`;
          if (isSpeaking || playingAudio) {
            smoothBargeInStop('Telemetry barge-in');
          }
        } else if (ev.type === 'ambient_trigger') {
          body = `<span style="color:#f59e0b"><i class="fas fa-radar"></i> [${ev.severity || 'ALERT'}] ${ev.scenario || ''}</span>: ${ev.detail || ''}`;
        } else if (ev.type === 'dual_model_handoff') {
          body = `<div style="font-weight:700;color:#ec4899"><i class="fas fa-exchange-alt"></i> ${ev.from_model} ➔ ${ev.to_model}</div><div style="color:#e2e8f0;margin-top:2px;">${ev.task}</div>`;
        } else if (ev.type === 'presenter_aside') {
          body = `<span style="color:#60a5fa">${ev.status}</span>: "${ev.text}"`;
          const statusEl = document.getElementById('pb-status');
          if (statusEl) statusEl.textContent = 'Narration Detected (AI Standby)';
        } else if (ev.type === 'presenter_mode') {
          body = `Presenter Mode State: ${ev.mode}`;
        } else {
          body = ev.step || ev.detail || '';
        }
        addHudEvent(cls, ev.type.toUpperCase(), body);
      }
    } catch(_) {}
  };
  ws.onclose = () => setTimeout(connectTelemetryWS, 2000);
}

window.addEventListener('keydown', (e) => {
  // Press '2' on keyboard to fire Act 1 price spike instantly during filming
  if (e.key === '2' && !e.target.matches('input, textarea')) {
    fireAmbient('supplier_price_spike');
  }
});

// ── Initialize App ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  CardRenderer.init();
  VoiceCaption.init();
  NoticeTray.init();
  connectTelemetryWS();
  startHintRotation();
});
