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
    // product = { id, name, brand, price, color, voltage, age, img }
    const cart = this.getCart();
    const existing = cart.find(i => i.id === product.id && i.color === product.color);
    if (existing) {
      existing.qty = Math.min((existing.qty || 1) + 1, 10);
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
    return idx < 0; // true = added
  },

  isWished(productId) {
    return this.getWishlist().some(i => i.id === productId);
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

  // ── ANALYTICS (local tracking) ────────────────────────────────────────────
  trackVisit() {
    try {
      const visits = JSON.parse(localStorage.getItem('kr_visits') || '[]');
      visits.push({
        page: window.location.pathname,
        ts: Date.now(),
        ref: document.referrer,
        ua: navigator.userAgent.substring(0, 80),
      });
      // Зберігати тільки останні 500 візитів
      if (visits.length > 500) visits.splice(0, visits.length - 500);
      localStorage.setItem('kr_visits', JSON.stringify(visits));
    } catch {}
  },

  // ── FORMAT ────────────────────────────────────────────────────────────────
  formatPrice(n) {
    return Math.round(n).toLocaleString('uk-UA') + ' ₴';
  },

  // ── INIT ──────────────────────────────────────────────────────────────────
  init() {
    this.updateCartBadge();
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
