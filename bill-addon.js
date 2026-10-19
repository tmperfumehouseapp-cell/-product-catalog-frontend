/* bill-addon.js: adds a "Make Bill" link to the ADMIN page only (add_product.html),
   and only AFTER the admin password has been accepted (nothing is shown on the locked screen).
   The public catalog (index.html) does not load this file and shows no Make Bill link.
   Add ONE line before </body> in add_product.html:
       <script src="bill-addon.js"></script>
   BILL_URL points to the bill page hosted on HOSTINGER, in the same folder as api.php
   (visitor/product-api/bill/). Page and api.php share one origin, so there is no proxy,
   CORS or cookie problem. */
(function () {
    'use strict';

    var BILL_URL = 'bill/index.html';
    var ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>';

    function addLinks() {
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

    function removeLinks() {
        ['billLink', 'billDrawerLink'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
    }

    function start() {
        // Admin page only: it has the password gate. Anywhere else (the public catalog) do nothing.
        var gate = document.getElementById('passwordGate');
        if (!gate) return;

        // The admin page hides the password gate (display:none) only after the server has
        // accepted the password, and shows it again if the password is rejected / session ends.
        // So: gate hidden = unlocked = show Make Bill; gate visible = locked = no Make Bill.
        function sync() {
            var unlocked = gate.style.display === 'none';
            if (unlocked) addLinks(); else removeLinks();
        }
        new MutationObserver(sync).observe(gate, { attributes: true, attributeFilter: ['style'] });
        sync();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();