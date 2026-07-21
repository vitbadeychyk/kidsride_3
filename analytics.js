/**
 * analytics.js — KidsRide
 *
 * GTM вставляється ОДРАЗУ при завантаженні (синхронно),
 * щоб не пропустити жодної події — особливо важливо для Google Ads.
 *
 * Логіка:
 *  1. Вставляємо GTM-NSDFCZLD синхронно (hardcoded default)
 *  2. Асинхронно зчитуємо settings_seo для резервного ga_id / fb_pixel
 *     (використовується тільки якщо GTM не налаштований в адмінці)
 */
(function () {
  'use strict';

  // ── Константи ──────────────────────────────────────────────────────────────
  var DEFAULT_GTM_ID = 'GTM-NSDFCZLD';   // ваш контейнер GTM
  var SUPA_URL = 'https://gwslintdrtnvbfjvivbb.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3c2xpbnRkcnRudmJmanZpdmJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTU4MTUsImV4cCI6MjA5NzczMTgxNX0.2hhyX_PMrXpBa_Q5DW7KiUjf4Jy9nnBStto47_SVF7k';

  // ── dataLayer ── ініціалізуємо до GTM, щоб події не губились ───────────────
  window.dataLayer = window.dataLayer || [];

  // ── 1. GTM — вставляємо ЗАРАЗ, не чекаємо БД ──────────────────────────────
  injectGTM(DEFAULT_GTM_ID);

  // ── 2. Резервна логіка — тільки якщо GTM-контейнер не налаштований ─────────
  // (наприклад: тестовий режим, або адмін явно прибрав GTM-ID)
  // Асинхронно зчитуємо ga_id / fb_pixel з settings_seo
  fetch(SUPA_URL + '/rest/v1/settings_seo?select=gtm_id,ga_id,fb_pixel&id=eq.1&limit=1', {
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY
    }
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var s = (Array.isArray(data) && data[0]) ? data[0] : {};
      // Якщо в адмінці явно вказано інший GTM ID — нічого не робимо
      // (GTM вже вставлено, повторна вставка зламає відстеження)
      // Резервно — пряма ін'єкція GA4/Pixel тільки якщо GTM повністю відсутній
      var dbGtm = (s.gtm_id || '').trim();
      // Якщо в адмінці є свій GTM — вставляємо його (GTM-NSDFCZLD вже вставлено вище,
      // тому додатковий GTM з БД ігноруємо щоб не дублювати).
      // GA4 та Pixel вставляємо ЗАВЖДИ, якщо вони прописані в БД —
      // незалежно від того, чи є GTM (щоб пряма ін'єкція працювала поруч із GTM).
      if (s.ga_id)     injectGA4(s.ga_id);
      if (s.fb_pixel)  injectMetaPixel(s.fb_pixel);
    })
    .catch(function () {
      // Не ламаємо сторінку — GTM вже вставлено вище
    });

  /* ── Функції ─────────────────────────────────────────────────────────────── */

  function injectGTM(id) {
    if (!id) return;

    // <head> частина GTM — стандартний сніпет від Google
    var headScript = document.createElement('script');
    headScript.innerHTML =
      "(function(w,d,s,l,i){w[l]=w[l]||[];" +
      "w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
      "var f=d.getElementsByTagName(s)[0]," +
      "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';" +
      "j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;" +
      "f.parentNode.insertBefore(j,f);" +
      "})(window,document,'script','dataLayer','" + id + "');";
    // Вставляємо першим елементом <head> — рекомендація Google для GTM
    document.head.insertBefore(headScript, document.head.firstChild);

    // <noscript> частина — вставляємо одразу після <body>
    function appendNoscript() {
      if (!document.body) return;
      var ns = document.createElement('noscript');
      var iframe = document.createElement('iframe');
      iframe.src = 'https://www.googletagmanager.com/ns.html?id=' + id;
      iframe.height = '0';
      iframe.width = '0';
      iframe.style.cssText = 'display:none;visibility:hidden';
      ns.appendChild(iframe);
      document.body.insertBefore(ns, document.body.firstChild);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', appendNoscript);
    } else {
      appendNoscript();
    }
  }

  function injectGA4(id) {
    if (!id) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.appendChild(s);

    var c = document.createElement('script');
    c.innerHTML =
      "window.dataLayer=window.dataLayer||[];" +
      "function gtag(){dataLayer.push(arguments);}" +
      "gtag('js',new Date());" +
      "gtag('config','" + id + "');";
    document.head.appendChild(c);
  }

  function injectMetaPixel(id) {
    if (!id) return;
    var s = document.createElement('script');
    s.innerHTML =
      "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){" +
      "n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
      "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];" +
      "t=b.createElement(e);t.async=!0;t.src=v;" +
      "s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)" +
      "}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
      "fbq('init','" + id + "');" +
      "fbq('track','PageView');";
    document.head.appendChild(s);
  }

})();
