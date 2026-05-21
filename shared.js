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


  // ── BRAND LOGO (логотип/назва по всьому сайту) ──────────────────────────

  // Застосувати логотип та назву магазину до всіх елементів на сторінці
  applyBrandLogo(logoUrl, shopName) {
    const name = shopName || 'KidsRide';

    // 1. Замінити .logo-mark на img якщо є URL логотипу
    document.querySelectorAll('.logo-mark').forEach(mark => {
      if (logoUrl) {
        mark.innerHTML = '<img src="' + logoUrl + '" alt="' + name + '" style="width:100%;height:100%;object-fit:contain;display:block;border-radius:0;padding:3px">';
        mark.style.background = 'transparent';
        mark.style.boxShadow = 'none';
        mark.style.border = '2px solid rgba(255,107,53,0.2)';
        mark.style.borderRadius = '9px';
      }
    });

    // 2. Оновити назву в header/footer .logo (типова структура: Kids<span>Ride</span>)
    document.querySelectorAll('a.logo, a.logo.footer-logo').forEach(el => {
      const textNode = el.querySelector('span:not([class])') || el.querySelector('span');
      if (textNode && shopName) {
        // Замінюємо лише якщо це текстовий логотип "KidsRide"
        const parent = textNode.parentNode;
        if (parent.classList.contains('logo') || parent.tagName === 'A') {
          // Шукаємо текст з назвою
          Array.from(parent.childNodes).forEach(node => {
            if (node.nodeType === 3 && node.textContent.trim() === 'Kids') {
              node.textContent = name.replace(/ride$/i,'');
            }
          });
          const orange = parent.querySelector('span:not([style])');
          if (orange) orange.textContent = name.match(/[A-Z][a-z]+$/)?.[0] || 'Ride';
        }
      }
    });

    // 3. Оновити .logo-text (адмінка sidebar)
    document.querySelectorAll('.logo-text').forEach(el => {
      el.innerHTML = name;
    });

    // 4. Оновити .mobile-drawer-logo
    document.querySelectorAll('.mobile-drawer-logo').forEach(el => {
      if (shopName) el.innerHTML = '<span style="color:inherit">' + name + '</span>';
    });

    // 5. Оновити favicon (вкладка браузера)
    if (logoUrl) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = logoUrl;
      link.type = logoUrl.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';

      // Apple touch icon теж
      let apple = document.querySelector("link[rel='apple-touch-icon']");
      if (!apple) {
        apple = document.createElement('link');
        apple.rel = 'apple-touch-icon';
        document.head.appendChild(apple);
      }
      apple.href = logoUrl;
    }
  },

  // Завантажити бренд з Supabase і застосувати по всьому сайту
  async initBrand() {
    // Спочатку швидко з localStorage кешу
    try {
      const cached = JSON.parse(localStorage.getItem('kr_brand') || '{}');
      if (cached.logo_url || cached.shop_name) {
        this.applyBrandLogo(cached.logo_url, cached.shop_name);
      }
    } catch(e) {}

    // Потім синхронізуємо з Supabase (джерело правди для всіх пристроїв)
    try {
      const res = await fetch(this._SUPA_URL + '/rest/v1/settings_store?id=eq.1&select=logo_url,shop_name', {
        headers: { 'apikey': this._SUPA_KEY, 'Authorization': 'Bearer ' + this._SUPA_KEY }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data[0]) {
          const b = data[0];
          try { localStorage.setItem('kr_brand', JSON.stringify(b)); } catch(e) {}
          if (b.logo_url || b.shop_name) {
            this.applyBrandLogo(b.logo_url, b.shop_name);
          }
        }
      }
    } catch(e) {}
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

  // ── INIT ──────────────────────────────────────────────────────────────────
  init() {
    this.initBrand();
    this.initStripe();
    this.injectWishStyles();
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
