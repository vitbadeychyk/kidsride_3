/**
 * KidsRide — Shared JavaScript Module
 * Підключити на кожній сторінці: <script src="kidsride_shared.js"></script>
 * 
 * Функції:
 * - Кошик через localStorage (додати, видалити, рахувати)
 * - Навігація між сторінками з передачею стану
 * - Toast повідомлення
 * - Wishlist
 * - Лічильник відвідувань (analytics)
 */

// ── CART STORAGE ────────────────────────────────────────────────────────────
const KR = {

  // Отримати кошик
  getCart() {
    try { return JSON.parse(localStorage.getItem('kr_cart') || '[]'); }
    catch { return []; }
  },

  // Зберегти кошик
  saveCart(cart) {
    localStorage.setItem('kr_cart', JSON.stringify(cart));
    this.updateCartBadge();
    this.dispatchCartEvent(cart);
  },

  // Додати товар
  addToCart(product) {
    // product = { id, name, brand, price, color, voltage, age, img, sku }
    const cart = this.getCart();
    // Ключ унікальності: артикул (sku) + колір; якщо немає sku — id + колір
    const existing = cart.find(i => {
      if (product.sku && i.sku) return i.sku === product.sku && i.color === product.color;
      return i.id === product.id && i.color === product.color;
    });
    if (existing) {
      existing.qty = Math.min((existing.qty || 1) + 1, 10);
      // Оновлюємо фото якщо раніше не було
      if (!existing.img && product.img) existing.img = product.img;
    } else {
      cart.push({ ...product, qty: 1, addedAt: Date.now() });
    }
    this.saveCart(cart);
    this.showToast(`✓ "${product.name}" додано в кошик`, 'success');
    this.animateCartBadge();
    return cart;
  },

  // Видалити товар
  removeFromCart(id, color) {
    const cart = this.getCart().filter(i => !(i.id === id && i.color === color));
    this.saveCart(cart);
  },

  // Кількість товарів у кошику
  cartCount() {
    return this.getCart().reduce((s, i) => s + (i.qty || 1), 0);
  },

  // Сума кошика
  cartTotal() {
    return this.getCart().reduce((s, i) => s + i.price * (i.qty || 1), 0);
  },

  // Оновити бейдж кошика у header
  updateCartBadge() {
    const count = this.cartCount();
    document.querySelectorAll('#cartBadge, .cart-badge, [data-cart-badge]').forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? 'flex' : 'none';
    });
  },

  // Анімація бейджа
  animateCartBadge() {
    document.querySelectorAll('#cartBadge, .cart-badge').forEach(el => {
      el.style.transform = 'scale(1.6)';
      setTimeout(() => el.style.transform = '', 300);
    });
  },

  // Dispatch event для інших компонентів
  dispatchCartEvent(cart) {
    window.dispatchEvent(new CustomEvent('kr:cartUpdated', { detail: { cart } }));
  },

  // ── WISHLIST ──────────────────────────────────────────────────────────────
  getWishlist() {
    try { return JSON.parse(localStorage.getItem('kr_wishlist') || '[]'); }
    catch { return []; }
  },

  toggleWishlist(product) {
    const list = this.getWishlist();
    const idx = list.findIndex(i => i.id === product.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      this.showToast('🤍 Видалено зі списку бажань');
    } else {
      list.push({ ...product, addedAt: Date.now() });
      this.showToast('❤️ Додано до списку бажань', 'success');
    }
    localStorage.setItem('kr_wishlist', JSON.stringify(list));
    this.updateWishBadge();
    window.dispatchEvent(new CustomEvent('kr:wishlistUpdated', { detail: { list } }));
    return idx < 0; // true = added
  },

  isWished(productId) {
    return this.getWishlist().some(i => i.id === productId);
  },

  // Кількість товарів у списку бажань
  wishCount() {
    return this.getWishlist().length;
  },

  // Оновити бейдж списку бажань у header + червоне сердечко
  updateWishBadge() {
    const count = this.wishCount();
    document.querySelectorAll('#wishBadge, .wish-badge, [data-wish-badge]').forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? 'flex' : 'none';
    });
    document.querySelectorAll('#wishBtn, [data-wish-btn]').forEach(el => {
      el.classList.toggle('has-wish', count > 0);
    });
    // Позначити сердечка карток товару як liked (тих, у кого співпадає data-id)
    const ids = new Set(this.getWishlist().map(p => String(p.id)));
    document.querySelectorAll('.p-card').forEach(card => {
      const cardId = card.getAttribute('data-id');
      if (!cardId) return;
      const wish = card.querySelector('.p-wish');
      if (!wish) return;
      wish.classList.toggle('liked', ids.has(String(cardId)));
    });
  },

  // Інʼєктувати CSS для червоного сердечка в header
  injectWishStyles() {
    if (document.getElementById('kr-wish-style')) return;
    const s = document.createElement('style');
    s.id = 'kr-wish-style';
    s.textContent = `
      .ic-btn.has-wish svg{stroke:#ef4444;fill:#ef4444;transition:all .2s}
      .ic-btn .badge.wish-badge,
      #wishBadge{background:#ef4444;color:#fff}
      .kr-user-btn:hover{border-color:var(--orange);color:var(--orange)}
      .kr-logout-btn:hover{background:#fef2f2}
    `;
    document.head.appendChild(s);
  },

  // ── СЕСІЯ КОРИСТУВАЧА ─────────────────────────────────────────────────────
  // Отримати поточного користувача з localStorage (Supabase сесія).
  // Сесія зберігається під ключем 'kr_admin_session' (використовується для всіх користувачів).
  getCurrentUser() {
    try {
      const s = localStorage.getItem('kr_admin_session');
      if (!s) return null;
      const session = JSON.parse(s);
      if (session.expires_at && Date.now() / 1000 > session.expires_at) {
        localStorage.removeItem('kr_admin_session');
        return null;
      }
      return session.user || null;
    } catch { return null; }
  },

  logout() {
    localStorage.removeItem('kr_admin_session');
    localStorage.setItem('kr_signed_out', '1');
    this.showToast('Ви вийшли з акаунту');
    setTimeout(() => location.reload(), 600);
  },

  // Замінити кнопку "Увійти" в header іменем користувача з випадаючим меню
  updateAuthUI() {
    const user = this.getCurrentUser();

    // Усі посилання "Увійти" в header (.h-right)
    const links = document.querySelectorAll('.h-right a[href="auth.html"]');
    links.forEach(link => {
      const text = (link.textContent || '').trim();
      if (text !== 'Увійти') return;

      // Якщо користувач вийшов — повернути оригінальну кнопку
      if (!user) {
        if (link.dataset.krAuthSwapped === '1') {
          link.style.display = '';
          link.dataset.krAuthSwapped = '0';
          const next = link.nextElementSibling;
          if (next && next.classList.contains('kr-user-menu')) next.remove();
        }
        return;
      }

      if (link.dataset.krAuthSwapped === '1') return;

      const name = (user.email || '').split('@')[0] || 'Профіль';
      const initial = name.charAt(0).toUpperCase();

      const pill = document.createElement('div');
      pill.className = 'kr-user-menu';
      pill.style.cssText = 'position:relative;display:inline-block;margin-left:6px';
      pill.innerHTML = `
        <button class="kr-user-btn" type="button" style="display:flex;align-items:center;gap:8px;padding:5px 12px 5px 5px;border:1.5px solid var(--border);background:white;border-radius:100px;cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;color:var(--navy);transition:all .2s">
          <span style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--orange),#ff8a4d);color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">${initial}</span>
          <span class="kr-user-name" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="kr-user-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:white;border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.12);padding:8px;min-width:220px;z-index:1000">
          <div style="padding:8px 12px;border-bottom:1px solid var(--border);margin-bottom:6px">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700">Акаунт</div>
            <div style="font-size:13px;font-weight:700;color:var(--navy);margin-top:2px;word-break:break-all">${user.email || ''}</div>
          </div>
          <button type="button" class="kr-logout-btn" style="width:100%;text-align:left;background:none;border:none;padding:9px 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#ef4444;display:flex;align-items:center;gap:8px;transition:background .15s">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Вийти
          </button>
        </div>
      `;

      link.dataset.krAuthSwapped = '1';
      link.style.display = 'none';
      link.parentNode.insertBefore(pill, link.nextSibling);

      const btn = pill.querySelector('.kr-user-btn');
      const dd = pill.querySelector('.kr-user-dropdown');
      const logoutBtn = pill.querySelector('.kr-logout-btn');

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
      });
      logoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.logout();
      });
      document.addEventListener('click', () => { dd.style.display = 'none'; });
    });
  },

  // ── TOAST ─────────────────────────────────────────────────────────────────
  showToast(msg, type = '') {
    // Знайти або створити контейнер
    let container = document.getElementById('kr-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'kr-toast-container';
      container.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        z-index:9999;display:flex;flex-direction:column;gap:8px;
        align-items:center;pointer-events:none;
      `;
      document.body.appendChild(container);
    }

    const colors = { success: '#27AE60', error: '#e53935', warning: '#F59E0B', '': '#1B2A4A' };
    const toast = document.createElement('div');
    toast.style.cssText = `
      background:${colors[type] || colors['']};color:white;
      padding:11px 20px;border-radius:100px;
      font-family:'Nunito',sans-serif;font-weight:700;font-size:13px;
      box-shadow:0 8px 24px rgba(0,0,0,.2);white-space:nowrap;
      animation:krToastIn .3s ease;pointer-events:none;
    `;
    toast.textContent = msg;

    if (!document.getElementById('kr-toast-style')) {
      const style = document.createElement('style');
      style.id = 'kr-toast-style';
      style.textContent = '@keyframes krToastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(style);
    }

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .3s';
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  },

  // ── NAVIGATION ────────────────────────────────────────────────────────────
  pages: {
    home:     'kidsride_v2.html',
    catalog:  'kidsride_catalog.html',
    product:  'kidsride_product.html',
    cart:     'kidsride_cart.html',
    checkout: 'kidsride_checkout.html',
    admin:    'kidsride_admin.html',
  },

  go(page, params = {}) {
    let url = this.pages[page] || page;
    const query = new URLSearchParams(params).toString();
    if (query) url += '?' + query;
    window.location.href = url;
  },

  goToProduct(productId) {
    this.go('product', { id: productId });
  },

  goToCart() {
    this.go('cart');
  },

  goToCheckout() {
    this.go('checkout');
  },

  // ── ANALYTICS (local + Supabase tracking) ────────────────────────────────
  _SUPA_URL: 'https://xczrzdbikkycgpnvolib.supabase.co',
  _SUPA_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjenJ6ZGJpa2t5Y2dwbnZvbGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjUyMTgsImV4cCI6MjA5MjkwMTIxOH0.2ClxkizpRUdaJaHndjsH4RIb_lnIJ_imrTRYBNhTqkQ',

  _visitorId() {
    let v = localStorage.getItem('kr_visitor_id');
    if (!v) { v = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('kr_visitor_id', v); }
    return v;
  },
  _sessionId() {
    let s = sessionStorage.getItem('kr_session_id');
    if (!s) { s = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('kr_session_id', s); }
    return s;
  },
  _detectDevice() {
    const ua = navigator.userAgent.toLowerCase();
    if (/ipad|tablet|playbook|silk|kindle/.test(ua)) return 'tablet';
    if (/mobi|iphone|ipod|android.*mobile|blackberry|phone/.test(ua)) return 'mobile';
    return 'desktop';
  },
  _detectSource() {
    const ref = document.referrer || '';
    if (!ref) return 'direct';
    try {
      const h = new URL(ref).hostname.replace(/^www\./,'');
      const here = window.location.hostname.replace(/^www\./,'');
      if (h === here) return 'direct';
      if (/google\./.test(h)) return 'google';
      if (/instagram\.com/.test(h)) return 'instagram';
      if (/facebook\.com|fb\./.test(h)) return 'facebook';
      if (/youtube\.com|youtu\.be/.test(h)) return 'youtube';
      if (/tiktok\.com/.test(h)) return 'tiktok';
      if (/bing\./.test(h)) return 'bing';
      return h;
    } catch { return 'direct'; }
  },

  trackVisit() {
    // Локальна копія (як було)
    try {
      const visits = JSON.parse(localStorage.getItem('kr_visits') || '[]');
      visits.push({ page: window.location.pathname, ts: Date.now(), ref: document.referrer });
      if (visits.length > 500) visits.splice(0, visits.length - 500);
      localStorage.setItem('kr_visits', JSON.stringify(visits));
    } catch {}

    // Не логуємо адмін-сторінки
    const path = window.location.pathname || '/';
    if (/^\/?(admin|auth)/i.test(path) || /admin\.html|auth\.html/i.test(path)) return;

    // Анти-дубль за 10 секунд для тієї ж сторінки в межах сесії
    try {
      const key = 'kr_pv_last_' + path;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 10000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {}

    const payload = {
      path,
      referrer: document.referrer || null,
      source: this._detectSource(),
      device: this._detectDevice(),
      visitor_id: this._visitorId(),
      session_id: this._sessionId(),
      ua: (navigator.userAgent || '').slice(0, 200)
    };

    try {
      fetch(this._SUPA_URL + '/rest/v1/page_views', {
        method: 'POST',
        keepalive: true,
        headers: {
          'apikey': this._SUPA_KEY,
          'Authorization': 'Bearer ' + this._SUPA_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      }).catch(()=>{});
    } catch {}
  },

  // ── FORMAT ────────────────────────────────────────────────────────────────
  formatPrice(n) {
    return Math.round(n).toLocaleString('uk-UA') + ' ₴';
  },


  // ── STRIPE SYNC ──────────────────────────────────────────────────────────
  _applyStripe(s) {
    var el = document.getElementById('kr-stripe-css');
    if (!el) {
      el = document.createElement('style');
      el.id = 'kr-stripe-css';
      document.head.appendChild(el);
    }
    el.textContent = '.header,.header#hdr{border-top:' + s.h + 'px solid ' + s.c + ' !important}';
    try { localStorage.setItem('kr_stripe', JSON.stringify(s)); } catch(e) {}
  },

  async initStripe() {
    // Apply cached value immediately (fast, avoids waiting for network)
    try {
      const cached = JSON.parse(localStorage.getItem('kr_stripe') || '{"h":12,"c":"#1B2A4A"}');
      this._applyStripe(cached);
    } catch(e) {}
    // Fetch from Supabase — source of truth shared across all devices
    try {
      const res = await fetch(this._SUPA_URL + '/rest/v1/settings?select=value&key=eq.site_stripe', {
        headers: { 'apikey': this._SUPA_KEY, 'Authorization': 'Bearer ' + this._SUPA_KEY }
      });
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows[0] && rows[0].value) {
          this._applyStripe(JSON.parse(rows[0].value));
        }
      }
    } catch(e) {}
  },

  // ── GLOBAL SEARCH (universal overlay for any page) ────────────────────────
  openGlobalSearch() {
    let overlay = document.getElementById('_krSearchOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '_krSearchOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;backdrop-filter:blur(4px)';
      overlay.innerHTML = `
        <div style="background:white;border-radius:16px;padding:20px;width:calc(100% - 32px);max-width:560px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
          <div style="display:flex;gap:10px">
            <input id="_krSearchInput" type="text" placeholder="Пошук електромобілів, моделей, брендів…"
              style="flex:1;padding:13px 16px;border:2px solid #e5e7eb;border-radius:10px;font-size:15px;font-family:inherit;outline:none;transition:border-color .2s"
              onfocus="this.style.borderColor='#ff6b35'" onblur="this.style.borderColor='#e5e7eb'">
            <button onclick="KR._doSearch()" style="padding:13px 20px;background:#ff6b35;color:white;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;font-family:inherit">Знайти</button>
          </div>
          <button onclick="document.getElementById('_krSearchOverlay').style.display='none'" style="margin-top:12px;width:100%;padding:9px;background:#f3f4f6;border:none;border-radius:8px;color:#6b7280;font-size:13px;cursor:pointer;font-family:inherit">Закрити</button>
        </div>`;
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
      document.body.appendChild(overlay);
      const inp = overlay.querySelector('#_krSearchInput');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') KR._doSearch(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.style.display = 'none'; });
    }
    overlay.style.display = 'flex';
    setTimeout(() => { const inp = document.getElementById('_krSearchInput'); if (inp) inp.focus(); }, 50);
  },
  _doSearch() {
    const inp = document.getElementById('_krSearchInput');
    const q = (inp ? inp.value : '').trim();
    if (q) window.location.href = 'catalog.html?search=' + encodeURIComponent(q);
  },


  // ── BRANDING / LOGO ──────────────────────────────────────────────────────
  _KR_LOGO_PRESETS: [
    { id: 'default', name: 'Екран',        svg: '<path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="2"/><circle cx="12" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>' },
    { id: 'star',    name: 'Зірка',        svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    { id: 'rocket',  name: 'Ракета',       svg: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m3.5 14.5 2.5-2.5 7.5-7.5s4-4 8 0-4 8-4 8l-7.5 7.5-2.5 2.5"/>' },
    { id: 'crown',   name: 'Корона',       svg: '<path d="M2 20h20M4 20V8l4 4 4-8 4 8 4-4v12"/>' },
    { id: 'lightning', name: 'Блискавка', svg: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>' },
    { id: 'bicycle', name: 'Велосипед',    svg: '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M6 15h6l3-6h3M9 9l3 6"/>' },
    { id: 'gift',    name: 'Подарунок',    svg: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>' },
    { id: 'heart',   name: 'Серце',        svg: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' },
    { id: 'wand',    name: 'Чарівна паличка', svg: '<path d="m15 4 5 5-11 11-5-5z"/><path d="M2 18l2 4M14 2l4 4M20 7l1.5-1.5M19 12l2-1M17 17l1.5 2"/>' },
    { id: 'scooter', name: 'Самокат',      svg: '<circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M5 17h8V8h3l3 9"/><path d="M13 8l2-5h2"/>' },
    { id: 'shield',  name: 'Щит зі зіркою', svg: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polygon points="12 7 13.5 10.5 17 11 14.5 13.5 15.5 17 12 15 8.5 17 9.5 13.5 7 11 10.5 10.5 12 7"/>' },
    { id: 'planet',  name: 'Планета',      svg: '<circle cx="12" cy="12" r="5"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' },
    { id: 'balloon', name: 'Кулька',       svg: '<path d="M12 22V16"/><circle cx="12" cy="10" r="8"/><path d="M8 16.93C4.5 15.5 2 12.5 2 10"/>' },
    { id: 'paw',     name: 'Лапка',        svg: '<circle cx="8.5" cy="7.5" r="1.5"/><circle cx="15.5" cy="7.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/><circle cx="18.5" cy="11.5" r="1.5"/><path d="M12 23c-3.5 0-6-2.5-6-5.5 0-2 1.5-3.5 4-4h4c2.5.5 4 2 4 4C18 20.5 15.5 23 12 23z"/>' },
    { id: 'car',     name: 'Авто',         svg: '<path d="M5 17H3a1 1 0 0 1-1-1v-4l2-5h16l2 5v4a1 1 0 0 1-1 1h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 9h14"/>' },
  ],

  loadSiteLogo() {
    try {
      const cached = localStorage.getItem('kr_branding');
      if (cached) this._applyBranding(JSON.parse(cached));
    } catch(e) {}
    fetch(this._SUPA_URL + '/rest/v1/settings?select=value&key=eq.site_branding', {
      headers: { 'apikey': this._SUPA_KEY, 'Authorization': 'Bearer ' + this._SUPA_KEY }
    }).then(r => r.json()).then(rows => {
      if (!rows || !rows[0] || !rows[0].value) return;
      try {
        const b = JSON.parse(rows[0].value);
        localStorage.setItem('kr_branding', rows[0].value);
        this._applyBranding(b);
      } catch(e) {}
    }).catch(() => {});
  },

  _applyBranding(b) {
    if (!b) return;
    const preset = this._KR_LOGO_PRESETS.find(p => p.id === b.presetId) || this._KR_LOGO_PRESETS[0];
    const storeName = b.storeName || 'KidsRide';

    if (b.mode === 'image' && b.imageUrl) {
      document.querySelectorAll('[data-logo-wrap]').forEach(el => {
        el.innerHTML = '<img src="' + b.imageUrl + '" alt="' + storeName + '" style="height:40px;width:auto;object-fit:contain;display:block;max-width:200px">';
      });
    } else {
      const iconSvg = preset.svg;
      document.querySelectorAll('[data-logo-mark]').forEach(el => {
        el.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + iconSvg + '</svg>';
      });
      const half = storeName === 'KidsRide' ? 4 : Math.ceil(storeName.length * 0.55);
      const n1 = storeName.slice(0, half), n2 = storeName.slice(half);
      document.querySelectorAll('[data-logo-name]').forEach(el => {
        el.innerHTML = '<span style="color:inherit">' + n1 + '<span>' + n2 + '</span></span>';
      });
      if (b.bgColor) {
        document.querySelectorAll('.logo-mark').forEach(el => {
          el.style.background = b.bgColor;
          el.style.boxShadow = '0 4px 12px ' + b.bgColor + '55';
        });
      }
      this._updateFavicon(iconSvg, b.bgColor || '#FF6B35');
    }
  },

  _updateFavicon(iconPaths, bg) {
    const svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"' + bg + '\"/><svg x=\"6\" y=\"6\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">' + iconPaths + '</svg></svg>';
    const safesvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="' + bg + '"/><svg x="6" y="6" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + iconPaths + '</svg></svg>';
    const url = 'data:image/svg+xml,' + encodeURIComponent(safesvg);
    let el = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel*="icon"]');
    if (!el) { el = document.createElement('link'); el.rel = 'icon'; el.type = 'image/svg+xml'; document.head.appendChild(el); }
    el.href = url;
  },

  // ── INIT ──────────────────────────────────────────────────────────────────
  init() {
    this.initStripe();
    this.injectWishStyles();
    this.loadSiteLogo();
    this.updateCartBadge();
    this.updateWishBadge();
    this.updateAuthUI();
    this.trackVisit();

    // Активний пункт навігації
    const path = window.location.pathname;
    document.querySelectorAll('nav a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href && path.includes(href.replace('./', '').split('?')[0])) {
        a.classList.add('active');
      }
    });

    // Header scroll
    window.addEventListener('scroll', () => {
      const hdr = document.querySelector('.header, #hdr');
      if (hdr) hdr.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
  },
};

// Автоматичний запуск
document.addEventListener('DOMContentLoaded', () => KR.init());
