/**
 * Shopexa Ops — Reusable Component Library & Lifecycle Renderer
 * Pure data-injected components for interactive cards, subtitles, and notices.
 */

// ── 1. Voice Caption Component (Subtitles / Real-Time Voice Overlay) ───────────
const VoiceCaption = {
  element: null,
  textElement: null,
  fadeTimer: null,

  init() {
    this.element = document.getElementById('voice-caption-bar');
    this.textElement = document.getElementById('voice-caption-text');
  },

  show(text, role = 'ASSISTANT') {
    if (!this.element) this.init();
    if (!this.element || !this.textElement) return;

    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    const clean = (text || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/INVENTORY_RESULTS\|[^\n]*/g, '')
      .replace(/ORDER_CREATED_SUCCESSFULLY\|[^\n]*/g, '')
      .replace(/ORDER_AUTHORIZED_SUCCESSFULLY\|[^\n]*/g, '')
      .replace(/PRICE_UPDATE_WITH_ALTERNATIVES\|[^\n]*/g, '')
      .trim();

    if (!clean) return;

    const avatar = this.element.querySelector('.vcb-avatar');
    if (avatar) {
      avatar.innerHTML = role === 'USER' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-satellite-dish"></i>';
    }

    this.textElement.textContent = clean;
    this.element.style.display = 'flex';
    this.element.style.opacity = '1';

    // Auto fade after 7s of no new text
    this.fadeTimer = setTimeout(() => {
      this.clear();
    }, 7000);
  },

  clear() {
    if (!this.element) this.init();
    if (!this.element) return;
    this.element.style.opacity = '0';
    setTimeout(() => {
      if (this.element && this.element.style.opacity === '0') {
        this.element.style.display = 'none';
      }
    }, 300);
  }
};

// ── 2. Notice Tray Component (Pending Interrupted Alerts) ─────────────────────
const NoticeTray = {
  listElement: null,
  emptyElement: null,
  alerts: [],

  init() {
    this.listElement = document.getElementById('interrupt-list');
    this.emptyElement = document.getElementById('interrupt-empty');
  },

  addNotice(sc) {
    if (!this.listElement) this.init();
    if (!sc) return false;

    const prod = (sc.product || '').toLowerCase();
    const id = sc.id;
    const severity = (sc.severity || 'info').toLowerCase();

    // Strict deduplication check
    if (this.alerts.some(a => a.id === id || (prod && a.product && a.product.toLowerCase() === prod))) {
      return false;
    }

    if (this.listElement) {
      if (this.listElement.querySelector(`[data-alert-id="${id}"]`) ||
         (prod && this.listElement.querySelector(`[data-alert-prod="${prod}"]`))) {
        return false;
      }
    }

    this.alerts.push(sc);
    if (this.emptyElement) this.emptyElement.style.display = 'none';
    this.updateBadge();

    const card = document.createElement('div');
    card.className = 'notice-card';
    card.setAttribute('data-alert-id', id);
    card.setAttribute('data-alert-prod', prod);
    card.style.cssText = 'background: rgba(30, 41, 59, 0.85); border-left: 3px solid #f59e0b; padding: 12px; border-radius: 6px; font-size: 0.85rem; color: #cbd5e1; animation: fade-up 0.3s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.3); margin-bottom: 8px;';
    
    card.innerHTML = `
      <div style="color: #f59e0b; font-weight:700; margin-bottom:4px; display:flex; align-items:center; justify-content:space-between;">
         <span><i class="fas fa-exclamation-triangle"></i> ${sc.scenario}</span>
         <button onclick="dismissActiveNotice(this, '${id}')" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:0.9rem; padding:0 4px;" title="Dismiss notice">✕</button>
      </div>
      <div style="font-size:0.8rem; color:#94a3b8; margin-top:2px;">${sc.detail}</div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="ctx-btn primary" style="font-size:0.75rem; padding:4px 10px;" onclick="typedFallback('${(sc.suggestion || '').replace(/'/g, "\\'")}')">
          <i class="fas fa-bolt"></i> ${sc.action_label || 'Review & Act'}
        </button>
        <button class="ctx-btn" style="font-size:0.75rem; padding:4px 8px;" onclick="dismissActiveNotice(this, '${id}')">
          Dismiss
        </button>
      </div>
    `;
    if (this.listElement) this.listElement.appendChild(card);
    return true;
  },

  updateBadge() {
    const badge = document.getElementById('notices-count-badge');
    if (badge) {
      const count = this.alerts.length;
      badge.textContent = `${count} Active`;
      badge.style.color = count > 0 ? '#fbbf24' : '#cbd5e1';
      badge.style.borderColor = count > 0 ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.08)';
    }
  },

  popNext() {
    if (this.alerts.length === 0) return null;
    const sc = this.alerts.shift();
    if (this.listElement) {
      const el = this.listElement.querySelector(`[data-alert-id="${sc.id}"]`);
      if (el) el.remove();
    }
    if (this.alerts.length === 0 && this.emptyElement) {
      this.emptyElement.style.display = 'block';
    }
    this.updateBadge();
    return sc;
  },

  clear() {
    this.alerts = [];
    if (this.listElement) {
      this.listElement.innerHTML = '';
      if (this.emptyElement) {
        this.listElement.appendChild(this.emptyElement);
        this.emptyElement.style.display = 'block';
      }
    }
    this.updateBadge();
  }
};

// ── 3. Pure Reusable Component Templates ──────────────────────────────────────

/**
 * Suspended Task Dock Ribbon (Injected into active cards when earlier task is held)
 */
function SuspendedRibbonComponent(suspended) {
  if (!suspended) return '';
  return `
    <div class="suspended-dock-ribbon">
      <div class="sdr-left">
        <i class="fas fa-layer-group"></i>
        <span>Suspended: <strong>${suspended.desc || 'Order #' + suspended.id} ($${suspended.amt || '0.00'})</strong></span>
      </div>
      <button class="sdr-btn" onclick="InteractionManager.popAndResume()">
        <i class="fas fa-undo-alt"></i> Return to Order
      </button>
    </div>`;
}

/**
 * Real-Time MCP Inventory Results Component
 */
function InventoryCardComponent({ queryTitle = 'Catalog Inventory', items = [], suspended = null, prompt = '' }) {
  const ribbonHtml = SuspendedRibbonComponent(suspended);

  const itemsHtml = items.map(item => `
    <div class="inv-item-card">
      <div>
        <div class="inv-item-title">${item.name}</div>
        <div class="inv-item-meta">
          <span class="inv-item-price">${item.price}</span>
          <span class="inv-stock-tag"><i class="fas fa-check-circle"></i> ${item.stock}</span>
        </div>
      </div>
      <button class="inv-act-btn" onclick="typedFallback('Stage order for ${item.name.replace(/'/g, "\\'")}')">
        <i class="fas fa-cart-plus"></i> Stage Order
      </button>
    </div>
  `).join('');

  return `
    ${prompt ? `<div class="user-query-pill"><i class="fas fa-comment-dots"></i> "${prompt}"</div>` : ''}
    <div class="inventory-container">
      ${ribbonHtml}
      <div class="inv-header">
        <div class="inv-title"><i class="fas fa-boxes"></i> ${queryTitle}</div>
        <div class="inv-badge">Real-Time MCP Catalog</div>
      </div>
      <div class="inv-grid">
        ${itemsHtml}
      </div>
      <div class="context-actions" style="justify-content: center; margin-top: 10px;">
        ${suspended ? `<button class="ctx-btn primary" style="background:#8b5cf6; border-color:#a855f7; color:#fff;" onclick="InteractionManager.popAndResume()"><i class="fas fa-undo"></i> Return to Suspended Order</button>` : ''}
        <button class="ctx-btn" onclick="typedFallback('Check inventory levels')"><i class="fas fa-sync-alt"></i> Refresh</button>
        <button class="ctx-btn dismiss" onclick="resolveOrDismissInterruption()"><i class="fas fa-home"></i> Home</button>
      </div>
    </div>
  `;
}

/**
 * Enterprise Staged Purchase Order Component
 */
function OrderCardComponent({ orderId = '10', orderAmount = '37.00', details = 'Staged for autonomous restock.', suspended = null, prompt = '' }) {
  const ribbonHtml = SuspendedRibbonComponent(suspended);
  const amtFormatted = (parseFloat(orderAmount) || 37.00).toFixed(2);

  return `
    ${prompt ? `<div class="user-query-pill"><i class="fas fa-comment-dots"></i> "${prompt}"</div>` : ''}
    <div class="order-card-v2">
      ${ribbonHtml}
      <div class="oc2-header">
        <div class="oc2-badge"><i class="fas fa-microchip"></i> STAGED VIA MCP TOOL CHAIN</div>
        <div class="oc2-status"><i class="fas fa-clock"></i> Awaiting IAM Approval</div>
      </div>
      <div class="oc2-body">
        <div style="flex:1; padding-right:16px;">
          <div class="oc2-item-title">Purchase Order #${orderId}</div>
          <div class="oc2-item-sub">${details}</div>
        </div>
        <div class="oc2-total-box">
          <div class="oc2-total-label">Total Amount</div>
          <div class="oc2-total-amt">$${amtFormatted}</div>
        </div>
      </div>
      <div class="oc2-actions">
        <button class="oc2-auth-btn" onclick="authorizeStagedOrder('${orderId}', '${amtFormatted}')">
          <i class="fas fa-shield-alt"></i> Authorize & Dispatch via AWS IAM
        </button>
        <button class="oc2-cancel-btn" onclick="clearResponseAndShowIdle()">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
    </div>
  `;
}

/**
 * Price Spike & Supplier Alternatives Comparison Component
 */
function PriceSpikeCardComponent({ category = 'Coffee', prompt = '', alternatives = [], customDetail = '' }) {
  if (category.toLowerCase() === 'paper') {
    return `
      ${prompt ? `<div class="user-query-pill"><i class="fas fa-comment-dots"></i> "${prompt}"</div>` : ''}
      <div class="briefing-container price-spike-card" style="border-color: rgba(245, 158, 11, 0.4);">
        <div class="briefing-header" style="background: rgba(245, 158, 11, 0.12);">
          <div class="briefing-title" style="color: #fbbf24;"><i class="fas fa-exclamation-triangle"></i> Supplier Price Spike Detected</div>
          <div class="briefing-badge" style="background:#dc2626; color:#fff;">Acme Paper +22%</div>
        </div>
        <div style="padding:16px 20px 8px; font-size:14px; color:#cbd5e1;">
          Acme Paper Co. increased <strong>A4 Printer Paper (500 sheets)</strong> from <strong>$8.99</strong> to <strong>$10.95</strong>. I found a cost-effective alternative in the catalog:
        </div>
        <div class="briefing-cards" style="grid-template-columns: 1fr 1fr; gap: 14px; padding: 12px 20px;">
          <div class="briefing-card" style="border-color: rgba(34, 197, 94, 0.5); background: rgba(34, 197, 94, 0.08); cursor: pointer;" onclick="typedFallback('Option 1: Switch to OfficePro')">
            <div class="bc-icon" style="color: #4ade80;"><i class="fas fa-award"></i></div>
            <div class="bc-body">
              <div class="bc-tag" style="color: #4ade80;">Option 1 · Recommended (Save $10.38)</div>
              <div style="font-size:15px; font-weight:700; color:#fff; margin-top:2px;">OfficePro A4 Paper</div>
              <div class="bc-text" style="color:#cbd5e1; margin-top:4px;"><strong>$7.49</strong> / pack · Total $22.47 for 3 packs<br><span style="color:#fbbf24;">★★★★★ 4.7</span> · OfficePro Express</div>
              <button class="ctx-btn primary" style="margin-top:10px; width:100%; justify-content:center;" onclick="event.stopPropagation(); typedFallback('Option 1: Switch to OfficePro')">
                <i class="fas fa-check"></i> Choose OfficePro ($22.47)
              </button>
            </div>
          </div>
          <div class="briefing-card" style="border-color: rgba(148, 163, 184, 0.3); background: rgba(15, 23, 42, 0.6); cursor: pointer;" onclick="typedFallback('Option 2: Keep Original')">
            <div class="bc-icon" style="color: #94a3b8;"><i class="fas fa-redo"></i></div>
            <div class="bc-body">
              <div class="bc-tag" style="color: #94a3b8;">Option 2 · Keep Original</div>
              <div style="font-size:15px; font-weight:700; color:#fff; margin-top:2px;">Acme A4 Printer Paper</div>
              <div class="bc-text" style="color:#cbd5e1; margin-top:4px;"><strong>$10.95</strong> / pack · Total $32.85 for 3 packs<br><span style="color:#fbbf24;">★★★★☆ 4.6</span> · Acme Paper Co.</div>
              <button class="ctx-btn" style="margin-top:10px; width:100%; justify-content:center;" onclick="event.stopPropagation(); typedFallback('Option 2: Keep Original')">
                Keep Original ($32.85)
              </button>
            </div>
          </div>
        </div>
        <div class="briefing-followup" style="padding-top:10px;">
          <div class="bf-question"><i class="fas fa-robot"></i> Say <em>"Option 1"</em> or tap to switch supplier and stage order:</div>
        </div>
      </div>
    `;
  }

  // Coffee Price Spike Card (Default)
  return `
    ${prompt ? `<div class="user-query-pill"><i class="fas fa-comment-dots"></i> "${prompt}"</div>` : ''}
    <div class="briefing-container price-spike-card" style="border-color: rgba(245, 158, 11, 0.4);">
      <div class="briefing-header" style="background: rgba(245, 158, 11, 0.12);">
        <div class="briefing-title" style="color: #fbbf24;"><i class="fas fa-exclamation-triangle"></i> Supplier Price Spike Detected</div>
        <div class="briefing-badge" style="background:#dc2626; color:#fff;">RoastCraft +26%</div>
      </div>
      <div style="padding:16px 20px 8px; font-size:14px; color:#cbd5e1;">
        RoastCraft Supplies increased <strong>Ethiopian Yirgacheffe (1kg)</strong> from <strong>$17.50</strong> to <strong>$22.00</strong>. I found two cost-effective alternatives with next-day delivery:
      </div>
      <div class="briefing-cards" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; padding: 12px 20px;">
        <div class="briefing-card" style="border-color: rgba(34, 197, 94, 0.6); background: rgba(34, 197, 94, 0.08); cursor: pointer;" onclick="typedFallback('Option 1: Switch to Colombian')">
          <div class="bc-icon" style="color: #4ade80;"><i class="fas fa-trophy"></i></div>
          <div class="bc-body">
            <div class="bc-tag" style="color: #4ade80;">Option 1 · Best Value (Save $11)</div>
            <div style="font-size:15px; font-weight:700; color:#fff; margin-top:2px;">Colombian Supremo</div>
            <div class="bc-text" style="color:#cbd5e1; margin-top:4px;"><strong>$16.50</strong> / bag · Total $33.00 (2 bags)<br><span style="color:#fbbf24;">★★★★★ 4.8</span> · Andes Direct</div>
            <button class="ctx-btn primary" style="margin-top:10px; width:100%; justify-content:center;" onclick="event.stopPropagation(); typedFallback('Option 1: Switch to Colombian')">
              <i class="fas fa-check"></i> Choose Colombian ($33)
            </button>
          </div>
        </div>
        <div class="briefing-card" style="border-color: rgba(59, 130, 246, 0.5); background: rgba(59, 130, 246, 0.08); cursor: pointer;" onclick="typedFallback('Option 2: Switch to Kenya AA')">
          <div class="bc-icon" style="color: #60a5fa;"><i class="fas fa-star"></i></div>
          <div class="bc-body">
            <div class="bc-tag" style="color: #60a5fa;">Option 2 · Artisan Reserve (Save $7)</div>
            <div style="font-size:15px; font-weight:700; color:#fff; margin-top:2px;">Kenya AA Reserve</div>
            <div class="bc-text" style="color:#cbd5e1; margin-top:4px;"><strong>$18.50</strong> / bag · Total $37.00 (2 bags)<br><span style="color:#fbbf24;">★★★★★ 4.9</span> · Artisan Mills</div>
            <button class="ctx-btn" style="margin-top:10px; width:100%; justify-content:center;" onclick="event.stopPropagation(); typedFallback('Option 2: Switch to Kenya AA')">
              Choose Kenya AA ($37)
            </button>
          </div>
        </div>
        <div class="briefing-card" style="border-color: rgba(148, 163, 184, 0.3); background: rgba(15, 23, 42, 0.6); cursor: pointer;" onclick="typedFallback('Option 3: Keep Original')">
          <div class="bc-icon" style="color: #94a3b8;"><i class="fas fa-redo"></i></div>
          <div class="bc-body">
            <div class="bc-tag" style="color: #94a3b8;">Option 3 · Original Brand</div>
            <div style="font-size:15px; font-weight:700; color:#fff; margin-top:2px;">Ethiopian Yirgacheffe</div>
            <div class="bc-text" style="color:#cbd5e1; margin-top:4px;"><strong>$22.00</strong> / bag · Total $44.00 (2 bags)<br><span style="color:#fbbf24;">★★★★★ 4.9</span> · RoastCraft (Spike)</div>
            <button class="ctx-btn" style="margin-top:10px; width:100%; justify-content:center;" onclick="event.stopPropagation(); typedFallback('Option 3: Keep Original')">
              Keep Original ($44)
            </button>
          </div>
        </div>
      </div>
      <div class="briefing-followup" style="padding-top:10px;">
        <div class="bf-question"><i class="fas fa-robot"></i> Say <em>"Option 1"</em> or <em>"Switch to Colombian"</em> to stage and authorize:</div>
      </div>
    </div>
  `;
}

/**
 * Morning Executive Briefing Component (Unread MCP Notifications)
 */
function BriefingCardComponent({ prompt = '', unreadCount = '3 unread items' }) {
  return `
    ${prompt ? `<div class="user-query-pill"><i class="fas fa-comment-dots"></i> "${prompt}"</div>` : ''}
    <div class="briefing-container">
      <div class="briefing-header">
        <div class="briefing-title"><i class="fas fa-sparkles"></i> Morning Executive Briefing</div>
        <div class="briefing-badge">${unreadCount}</div>
      </div>
      <div class="briefing-cards">
        <div class="briefing-card calendar">
          <div class="bc-icon"><i class="fas fa-calendar-alt"></i></div>
          <div class="bc-body">
            <div class="bc-tag">Calendar Sync · 4:00 PM</div>
            <div class="bc-text">Acme Corp contract sync moved to <strong>4 PM today</strong>.</div>
          </div>
        </div>
        <div class="briefing-card email">
          <div class="bc-icon"><i class="fas fa-envelope-open-text"></i></div>
          <div class="bc-body">
            <div class="bc-tag">Urgent Email · Supplier Proposal</div>
            <div class="bc-text">Urgent request to review the Q3 supplier proposal by <strong>noon tomorrow</strong>.</div>
          </div>
        </div>
        <div class="briefing-card supply">
          <div class="bc-icon"><i class="fas fa-exclamation-triangle"></i></div>
          <div class="bc-body">
            <div class="bc-tag">Supply Shortage · Breakroom</div>
            <div class="bc-text">The office is out of <strong>Ethiopian Yirgacheffe Coffee Beans</strong> and <strong>Printer Paper</strong>.</div>
          </div>
        </div>
      </div>
      <div class="briefing-followup">
        <div class="bf-question"><i class="fas fa-robot"></i> Would you like me to check your past orders and restock the coffee?</div>
        <div class="context-actions">
          <button class="ctx-btn primary" onclick="typedFallback('Yes, restock the coffee')"><i class="fas fa-mug-hot"></i> Restock Coffee</button>
          <button class="ctx-btn" onclick="typedFallback('Order the printer paper')"><i class="fas fa-copy"></i> Restock Paper</button>
          <button class="ctx-btn" style="border-color:#f59e0b; color:#fbbf24;" onclick="typedFallback('Check for price updates')"><i class="fas fa-tags"></i> Price Alert</button>
          <button class="ctx-btn" onclick="typedFallback('Order both coffee and paper')"><i class="fas fa-boxes"></i> Restock Both</button>
          <button class="ctx-btn dismiss" onclick="resolveOrDismissInterruption()"><i class="fas fa-times"></i> Dismiss</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * AWS IAM Order Authorized Confirmation Component
 */
function AuthSuccessCardComponent({ orderId = '10', amount = '37.00', vendor = 'RoastCraft Supplies', location = 'Office Breakroom', prompt = '' }) {
  return `
    ${prompt ? `<div class="user-query-pill"><i class="fas fa-comment-dots"></i> "${prompt}"</div>` : ''}
    <div class="auth-success-card">
      <div class="asc-icon"><i class="fas fa-check-circle"></i></div>
      <div class="asc-title">Purchase Order #${orderId} Authorized</div>
      <div class="asc-amt">$${amount} · AWS IAM Approved</div>
      <div class="asc-desc">Dispatched to ${vendor} via MCP tool chain. Priority delivery scheduled to ${location}.</div>
      <div style="font-size:0.75rem; color:#94a3b8; margin-top:10px; text-align:center; display:flex; align-items:center; justify-content:center; gap:6px;">
        <i class="fas fa-circle-notch fa-spin text-cyan-400" style="font-size:0.7rem;"></i> 
        <span>Returning to idle automatically…</span>
      </div>
      <div class="context-actions" style="justify-content: center; margin-top: 10px;">
        <button class="ctx-btn primary" onclick="clearResponseAndShowIdle()"><i class="fas fa-check"></i> Done</button>
        <button class="ctx-btn" onclick="typedFallback('Check inventory levels')"><i class="fas fa-boxes"></i> View Inventory</button>
      </div>
    </div>
  `;
}

/**
 * Contract Renewed Confirmation Component
 */
function ContractSuccessCardComponent({ title = 'Supplier Contract Renewed', amount = '$120.00 / mo · Rate Locked', desc = 'Agreement locked for 12 months.', prompt = '' }) {
  return `
    ${prompt ? `<div class="user-query-pill"><i class="fas fa-comment-dots"></i> "${prompt}"</div>` : ''}
    <div class="auth-success-card" style="border-color: rgba(59, 130, 246, 0.4);">
      <div class="asc-icon" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;"><i class="fas fa-file-contract"></i></div>
      <div class="asc-title" style="color: #60a5fa;">${title}</div>
      <div class="asc-amt">${amount}</div>
      <div class="asc-desc">${desc}</div>
      <div class="context-actions" style="justify-content: center; margin-top: 14px;">
        <button class="ctx-btn primary" onclick="clearResponseAndShowIdle()"><i class="fas fa-check"></i> Done</button>
      </div>
    </div>
  `;
}

/**
 * Presenter Narration Aside Component
 */
function AsideCardComponent({ text = '', prompt = '' }) {
  return `
    <div class="aside-card">
      <div class="aside-label"><i class="fas fa-chalkboard-teacher"></i> Presenter Explaining to Judges · AI on Standby</div>
      ${prompt ? `<div class="aside-quote">"${prompt}"</div>` : ''}
      <div class="aside-text">${text}</div>
    </div>
  `;
}

// ── 4. Unified Card Renderer (Central Viewport Lifecycle Manager) ──────────────
const CardRenderer = {
  responseElement: null,
  activeCardType: null,

  init() {
    this.responseElement = document.getElementById('response-content');
  },

  mount(html, cardType = 'generic', targetId = 'response-content', append = false) {
    if (!this.responseElement) this.init();
    const targetElement = targetId === 'response-content' ? this.responseElement : document.getElementById(targetId);
    if (!targetElement) return;

    this.activeCardType = cardType;
    
    if (append) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      wrapper.classList.add('fade-enter');
      targetElement.insertBefore(wrapper, targetElement.firstChild);
    } else {
      targetElement.innerHTML = html;
      targetElement.classList.remove('fade-enter');
      void targetElement.offsetWidth; // trigger reflow
      targetElement.classList.add('fade-enter');
    }

    if (targetId === 'response-content') {
      // Hide empty placeholder in the card dock
      const placeholder = document.getElementById('card-empty-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      // Update Action Workspace Status Badge
      const badge = document.getElementById('card-status-badge');
      if (badge) {
        badge.textContent = cardType.toUpperCase().replace('_', ' ');
        badge.style.color = '#38bdf8';
        badge.style.borderColor = 'rgba(56,189,248,0.4)';
      }

      // Hide hints when card is displayed
      const hintGrid = document.getElementById('hint-grid');
      if (hintGrid) hintGrid.style.display = 'none';
    } else if (targetId === 'interrupt-list') {
      // Hide empty placeholder in the interrupt tray
      const placeholder = document.getElementById('interrupt-empty');
      if (placeholder) placeholder.style.display = 'none';
    }
  },

  hasActiveInteractiveCard() {
    if (!this.responseElement) this.init();
    if (!this.responseElement) return false;
    return !!(
      this.responseElement.querySelector('.order-card-v2') ||
      this.responseElement.querySelector('.inventory-container') ||
      this.responseElement.querySelector('.briefing-container') ||
      this.responseElement.querySelector('.auth-success-card') ||
      this.responseElement.querySelector('.price-spike-card')
    );
  },

  clear() {
    if (!this.responseElement) this.init();
    if (this.responseElement) {
      this.responseElement.innerHTML = '';
    }
    this.activeCardType = null;

    // Restore empty placeholder in the card dock
    const placeholder = document.getElementById('card-empty-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    // Reset status badge
    const badge = document.getElementById('card-status-badge');
    if (badge) {
      badge.textContent = 'Idle';
      badge.style.color = '#cbd5e1';
      badge.style.borderColor = 'rgba(255,255,255,0.08)';
    }

    const hintGrid = document.getElementById('hint-grid');
    if (hintGrid) hintGrid.style.display = 'flex';
  }
};
