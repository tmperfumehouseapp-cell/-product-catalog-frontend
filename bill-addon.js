/* bill-addon.js: adds a "Make Bill" link to the catalog menu and the admin page.
   Add ONE line before </body> in index.html and add_product.html:
       <script src="bill-addon.js"></script>
   Change BILL_URL if your ledger lives somewhere else. */
(function () {
    'use strict';

    var BILL_URL = 'https://fourpirates.tmfragrance.com/visitor/product-api/bill/';
    var FLAG = 'tpAdminSeen';   // remembered in this browser only, set after the admin page is unlocked
    var ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>';

    function flagSet() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } }
    function setFlag() { try { localStorage.setItem(FLAG, '1'); } catch (e) {} }

    /* ---------- admin page (add_product.html) ---------- */
    function initAdmin(gate) {
        var done = false;

        function addLinks() {
            if (done) return;
            done = true;
            setFlag();

            var nav = document.querySelector('.admin-nav');
            if (nav && !document.getElementById('billLink')) {
                var a = document.createElement('a');
                a.className = 'admin-nav-link';
                a.id = 'billLink';
                a.href = BILL_URL;
                a.style.textDecoration = 'none';
                a.innerHTML = ICON + ' Make Bill';
                nav.appendChild(a);
            }

            var dnav = document.getElementById('adminDrawerNav');
            if (dnav && !document.getElementById('billDrawerLink')) {
                var d = document.createElement('a');
                d.className = 'drawer-link';
                d.id = 'billDrawerLink';
                d.href = BILL_URL;
                d.style.textDecoration = 'none';
                d.textContent = 'Make Bill';
                dnav.appendChild(d);
            }
        }

        // The admin page is the owner's side, so the link is added straight away (no unlock needed).
        addLinks();
    }

    /* ---------- catalog menu (index.html) ---------- */
    function initCatalog(drawer) {
        if (!flagSet() || document.getElementById('drawerBillWrap')) return;
        var nav = document.getElementById('drawerNav');
        var wrap = document.createElement('div');
        wrap.className = 'drawer-nav';
        wrap.id = 'drawerBillWrap';
        wrap.innerHTML = '<a class="drawer-link" id="drawerBillLink" href="' + BILL_URL + '">Make Bill</a>';
        if (nav && nav.parentNode) nav.parentNode.insertBefore(wrap, nav.nextSibling);
        else drawer.appendChild(wrap);

        var st = document.createElement('style');
        st.textContent = '#drawerBillWrap .drawer-link::before { content: "\\20B9"; }';
        document.head.appendChild(st);
    }

    function start() {
        var gate = document.getElementById('passwordGate');
        if (gate) { initAdmin(gate); return; }
        var drawer = document.getElementById('drawer');
        if (drawer) initCatalog(drawer);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();