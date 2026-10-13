/* =========================================================
   PRODUCTS.JS
   Categories, brands, product grid, filter drawer, search-filtering.
   Only used on products.html. Requires common.js loaded first
   (uses its API_BASE, escapeHtml, searchInput, searchBox, titleRow,
   drawerNav, updateHeroForSearch from that shared scope).
   ========================================================= */

/* =========================================================
   SAME-NAME MERGE (client safety net)
   "Azzaro" + "azzaro" + "AZZARO " show as ONE filter option.
   Only case/space differences are merged here, because the API
   (case-insensitive MySQL) returns all of them for one value.
   Real typos (herrara/herrera) are fixed in Admin -> Scan for duplicates.
   ========================================================= */
function sameNameKey(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/* list: [{ [field]: 'Azzaro', count: 7, ...}] -> merged, most-used spelling kept */
function mergeSameNames(list, field) {
    if (!Array.isArray(list)) return [];
    const map = new Map();
    list.forEach(item => {
        const name = item[field];
        const key = sameNameKey(name);
        if (!key) return;
        const count = Number(item.count) || 0;
        const cur = map.get(key);
        if (!cur) {
            map.set(key, { ...item, [field]: String(name).trim(), count, _best: count });
        } else {
            cur.count += count;
            if (count > cur._best) {
                const keepThumb = cur.thumb;
                Object.assign(cur, item, { [field]: String(name).trim(), count: cur.count, _best: count });
                if (!cur.thumb && keepThumb) cur.thumb = keepThumb;
            } else if (!cur.thumb && item.thumb) {
                cur.thumb = item.thumb;
            }
        }
    });
    return [...map.values()].map(({ _best, ...rest }) => rest);
}

const grid = document.getElementById('productGrid');
const categoryRow = document.getElementById('categoryRow');
const brandFilterEl = document.getElementById('brandFilter');
// A single <select> can't hold "Fossil,Casio" — assigning a CSV silently
// became "" and cleared the whole filter. This shim stores ANY value,
// while options/appendChild still use the hidden select underneath.
const brandFilter = {
    _v: '',
    get value() { return this._v; },
    set value(v) { this._v = v || ''; },
    get options() { return brandFilterEl ? brandFilterEl.options : []; },
    appendChild(o) { if (brandFilterEl) brandFilterEl.appendChild(o); },
    addEventListener(t, fn) { if (brandFilterEl) brandFilterEl.addEventListener(t, fn); }
};
const genderFilter = document.getElementById('genderFilter');
const resultsCount = document.getElementById('resultsCount');
const loadMoreBtn = document.getElementById('loadMoreBtn');

/* ---- (kept from the original file — currently inert since no
   #viewToggleBtn exists in the markup; harmless either way) ---- */
const viewToggleBtn = document.getElementById('viewToggleBtn');
if (viewToggleBtn) {
    viewToggleBtn.addEventListener('click', () => {
        const isList = grid.classList.toggle('list-view');
        viewToggleBtn.classList.toggle('active', isList);
    });
}

let currentPage = 1;
let currentProducts = [];
let selectedCategory = '';
let debounceTimer;

/* =========================================================
   METAFIELD (CATEGORY DETAILS) FILTERS
   Each category has its own custom fields (Admin -> Categories),
   e.g. Sunglasses: Frame, Lens Colour; Watches: Movement, Case Size.
   Only the SELECTED category's fields are offered as filters.
   metaFilter = { fieldKey: [normalised value, ...] }
     - values inside one field are OR   (Round OR Square)
     - different fields are AND         (Round AND Black)
   metaData   = the selected category's fields + every product's values
   ========================================================= */
let metaFilter = {};
let metaData = null;
const metaCache = new Map();          /* category key -> metaData */
const META_TTL = 30 * 60 * 1000;      /* cached product values live 30 min in this browser */

/* Categories that use the built-in details (not Admin -> Categories fields):
   same keys/labels the product page shows under "Specifications". */
const LEGACY_META = {
    watch: [['movement','Movement'],['case_diameter','Case Size'],['case_material','Case Material'],['dial_color','Dial Color'],
            ['glass_type','Glass'],['strap_material','Strap'],['water_resistance','Water Resistance'],['clasp_type','Clasp'],['warranty','Warranty']],
    perfume: [['fragrance','Fragrance'],['family','Family'],['formulation','Formulation'],['bottle_size','Bottle Size']],
    shoes: [['colour','Colour'],['material','Upper Material'],['shoe_type','Shoe Type'],['sole','Sole'],['closure','Closure'],
            ['quality','Quality'],['fit','Fit'],['occasion','Occasion'],['in_box','In the Box']],
    sunglasses: [['size','Size'],['model','Millimeter'],['frame_colour','Lens Colour'],['frame_shape','Frame']]
};

function legacyMetaKind(name) {
    const c = String(name || '').trim().toLowerCase();
    if (c.includes('watch')) return 'watch';
    if (c.includes('perfume') || c.includes('fragrance') || c.includes('attar')) return 'perfume';
    if (c.includes('shoe') || c.includes('sneaker') || c.includes('footwear')) return 'shoes';
    if (c.includes('sunglass') || c.includes('goggle') || c.includes('eyewear')) return 'sunglasses';
    return null;
}

/* one product's metafield values: custom fields first, else the built-in details */
async function fetchProductMeta(id, kind) {
    if (!kind) {
        const d = await (await fetch(`${API_BASE}/product_meta.php?product_id=${encodeURIComponent(id)}`)).json();
        if (!d || !d.success) throw new Error('meta');
        return d.values || {};
    }
    const d = await (await fetch(`${API_BASE}/get_product.php?id=${encodeURIComponent(id)}`)).json();
    if (!d || !d.success || !d.product) throw new Error('product');
    const p = d.product;
    if (kind === 'sunglasses' && p.details_kind !== 'sunglasses') {
        try {
            const s = await (await fetch(`${API_BASE}/get_sunglasses_details.php?product_id=${encodeURIComponent(id)}`)).json();
            if (s && s.success && s.details) return s.details;
        } catch (e) { /* fall through to whatever get_product gave */ }
    }
    return p.details || {};
}

function hasMetaSelection() {
    return Object.keys(metaFilter).some(k => Array.isArray(metaFilter[k]) && metaFilter[k].length);
}

/* filters are only applied once the category's values are loaded */
function metaActive() {
    return !!(metaData && metaData.ready && metaData.ck === sameNameKey(selectedCategory) && hasMetaSelection());
}

/* skipKey: ignore that field (used for per-field counts) */
function metaMatches(p, skipKey) {
    for (const key of Object.keys(metaFilter)) {
        const sel = metaFilter[key];
        if (key === skipKey || !Array.isArray(sel) || !sel.length) continue;
        const v = p.vals[key];
        if (!v || !sel.includes(v)) return false;
    }
    return true;
}

function metaMatchingIds() {
    return new Set(metaData.products.filter(p => metaMatches(p)).map(p => p.id));
}

function metaNotify(md) {
    if (metaData === md && window.__renderMeta) window.__renderMeta();
}

/* Drop selections that no longer exist (field removed / value gone) */
function pruneMeta(md) {
    if (metaData !== md || !md.ready) return;
    const keys = md.fields.map(f => f.key);
    Object.keys(metaFilter).forEach(k => {
        if (!keys.includes(k)) { delete metaFilter[k]; return; }
        const have = md.display[k] || {};
        const kept = (metaFilter[k] || []).filter(v => have[v]);
        if (kept.length) metaFilter[k] = kept; else delete metaFilter[k];
    });
}

function loadMetaForCategory(category) {
    const ck = sameNameKey(category);
    if (!ck) { metaData = null; metaFilter = {}; return Promise.resolve(); }
    if (metaCache.has(ck)) { metaData = metaCache.get(ck); return metaData.promise; }

    const md = { ck, fields: [], products: [], display: {}, ready: false, promise: null, kind: null, done: 0, total: 0 };
    metaCache.set(ck, md);
    metaData = md;

    md.promise = (async () => {
        /* 1. which fields does this category have? */
        try {
            const r = await (await fetch(`${API_BASE}/manage_categories.php`)).json();
            const cat = r && r.success && Array.isArray(r.categories)
                ? r.categories.find(c => sameNameKey(c.name) === ck) : null;
            md.fields = cat && Array.isArray(cat.fields) ? cat.fields.filter(f => f && f.key && f.label) : [];
        } catch (e) { md.fields = []; }

        /* no custom fields -> the built-in details of Perfume / Watches / Shoes / Sunglasses */
        if (!md.fields.length) {
            md.kind = legacyMetaKind(category);
            if (md.kind) md.fields = LEGACY_META[md.kind].map(([key, label]) => ({ key, label }));
        }

        if (!md.fields.length) { md.ready = true; pruneMeta(md); metaNotify(md); return; }
        metaNotify(md);   /* show the sections with "Loading..." */

        /* 2. every product of the category */
        const prods = [];
        try {
            let page = 1, more = true;
            while (more && page <= 30) {
                const params = new URLSearchParams();
                params.set('category', category);
                params.set('page', page);
                const d = await (await fetch(`${API_BASE}/get_products.php?${params.toString()}`)).json();
                if (!d.success) break;
                (d.products || []).forEach(p => prods.push({
                    id: String(p.id), brand: p.brand || '', gender: String(p.gender || '').toLowerCase(), vals: {}
                }));
                more = !!d.hasMore;
                page++;
            }
        } catch (e) { /* keep what we have */ }

        /* 3. each product's metafield values (cached per tab for 10 min) */
        const SKEY = 'catalogMeta2:' + ck + ':' + (md.kind || 'custom');
        let vals = {};
        try {
            const c = JSON.parse(localStorage.getItem(SKEY));
            if (c && c.t && Date.now() - c.t < META_TTL && c.v) vals = c.v;
        } catch (e) { vals = {}; }

        const need = prods.filter(p => !(p.id in vals));
        md.total = need.length;
        md.done = 0;
        let idx = 0, failed = false;
        async function worker() {
            while (idx < need.length) {
                const p = need[idx++];
                try {
                    vals[p.id] = await fetchProductMeta(p.id, md.kind);
                } catch (e) { failed = true; }
                md.done++;
                if (md.done % 25 === 0) metaNotify(md);   /* progress text */
            }
        }
        await Promise.all(Array.from({ length: Math.min(10, need.length) }, worker));
        if (!failed) {
            try { localStorage.setItem(SKEY, JSON.stringify({ t: Date.now(), v: vals })); } catch (e) {}
        }

        /* 4. normalise: "Black" / "black " / "BLACK" become ONE option */
        const spell = {};   /* field -> normKey -> { raw: count } */
        prods.forEach(p => {
            const pv = vals[p.id] || {};
            md.fields.forEach(f => {
                const raw = pv[f.key];
                const s = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
                if (!s) return;
                const k = sameNameKey(s);
                p.vals[f.key] = k;
                const m = (spell[f.key] = spell[f.key] || {});
                const o = (m[k] = m[k] || {});
                o[s] = (o[s] || 0) + 1;
            });
        });
        md.fields = md.fields.filter(f => {
            const m = spell[f.key] || {};
            const distinct = Object.keys(m).length;
            const withValue = prods.filter(p => p.vals[f.key]).length;
            /* a field where almost every product has its own value (e.g. Fragrance = the perfume's own name)
               would be a 400-item list, not a filter */
            return distinct > 0 && !(withValue >= 12 && distinct > withValue * 0.7);
        });
        md.fields.forEach(f => {
            md.display[f.key] = {};
            const m = spell[f.key] || {};
            Object.keys(m).forEach(k => {
                md.display[f.key][k] = Object.keys(m[k]).sort((a, b) => m[k][b] - m[k][a])[0];
            });
        });
        md.products = prods;
        md.ready = true;
        pruneMeta(md);
        metaNotify(md);
    })();
    return md.promise;
}

/* ONE request chain for "everything in the current scope"
   (category + brand(s) + gender + search), used by stories and metafield filters */
async function fetchAllScoped() {
    const brandsSel = brandFilter.value ? brandFilter.value.split(',').filter(Boolean) : [];
    const brandRuns = brandsSel.length > 1 ? brandsSel : [null];
    const out = [];
    const seen = new Set();
    for (const b of brandRuns) {
        let p = 1, more = true;
        while (more && p <= 30) {
            const params = buildParams(p);
            if (b) params.set('brand', b);
            const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Failed to load');
            (d.products || []).forEach(pr => {
                const id = String(pr.id);
                if (!seen.has(id)) { seen.add(id); out.push(pr); }
            });
            more = !!d.hasMore;
            p++;
        }
    }
    return out;
}

/*
 * Set by the filter-drawer IIFE further down.
 * Called whenever selected category changes.
 */
let refreshFilterDrawerForCategory = null;

/* =========================================================
   PERSIST FILTER STATE
   ========================================================= */
const FILTER_KEY = 'catalogFilters';

function saveFilterState() {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify({
        search: searchInput.value,
        category: selectedCategory,
        brand: brandFilter.value,
        gender: genderFilter.value,
        meta: hasMetaSelection() ? metaFilter : null
    }));
    updateUrlFromFilters();
}

/* Keep the address bar in sync with the active filters so any
   filtered view can be copied straight from the URL bar and pasted
   into a story icon / banner link, e.g.
   products.html?category=Perfume&brand=Azzaro */
function updateUrlFromFilters() {
    const params = new URLSearchParams();
    if (selectedCategory) params.set('category', selectedCategory);
    if (brandFilter.value) params.set('brand', brandFilter.value);
    if (genderFilter.value) params.set('gender', genderFilter.value);
    if (hasMetaSelection()) params.set('meta', JSON.stringify(metaFilter));
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (storyFilterId) params.set('story', storyFilterId);

    const qs = params.toString();
    const url = window.location.pathname + (qs ? '?' + qs : '');
    try {
        history.replaceState(null, '', url);
    } catch (e) { /* file:// or sandbox — ignore */ }
}

function loadFilterState() {
    try {
        return JSON.parse(sessionStorage.getItem(FILTER_KEY)) || null;
    } catch (e) {
        return null;
    }
}

/* =========================================================
   PRICE
   ========================================================= */
function formatPrice(price) {
    return 'Rs. ' + Math.round(price).toLocaleString('en-IN');
}

/* =========================================================
   SKELETON
   ========================================================= */
function skeletonHtml(count) {
    return Array.from({ length: count }).map(() => `
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
        </div>
    `).join('');
}

/* =========================================================
   CATEGORIES
   ========================================================= */
async function loadCategories() {
    try {
        const res = await fetch(`${API_BASE}/get_categories.php`);
        const data = await res.json();
        if (!data.success) return;
        data.categories = mergeSameNames(data.categories, 'category');

        // Category icon images — used by the "All <Category>" story circle
        window.__catThumbs = {};
        data.categories.forEach(c => { if (c.thumb) window.__catThumbs[c.category] = c.thumb; });

        // BRAND story circles — scoped to the selected category:
        // no category -> all brands; Perfume -> only perfume brands; etc.
        // The filter drawer rebuilds them via window.__rebuildBrandCircles
        // every time the category / gender / search scope changes.
        // Circles show the admin-uploaded brand icon when one exists,
        // otherwise the brand's first letter.
        const brandLetter = (name) => escapeHtml(String(name).trim().charAt(0).toUpperCase());

        /* Brand circles are retired — stories live at the top now and
           brands are filtered from the Filter drawer. The rebuild/sync
           hooks below stay as safe no-ops for the drawer code. */
        categoryRow.style.display = 'none';

        function currentBrands() {
            return brandFilter.value ? brandFilter.value.split(',').filter(Boolean) : [];
        }

        window.__syncBrandCircles = function (selected) {
            const sel = Array.isArray(selected) ? selected : currentBrands();
            categoryRow.querySelectorAll('.story-item').forEach(item => {
                const isAll = !item.dataset.brand;
                const on = isAll ? sel.length === 0 : sel.includes(item.dataset.brand);
                const circle = item.querySelector('.story-circle');
                circle.classList.toggle('active', on);
                const check = circle.querySelector('.story-check');
                if (on && !isAll && !check) {
                    circle.insertAdjacentHTML('beforeend', '<div class="story-check"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>');
                } else if ((!on || isAll) && check) {
                    check.remove();
                }
                item.querySelector('.story-label').classList.toggle('active', on);
            });
        };

        window.__rebuildBrandCircles = function (list) {
            return; /* brand circles removed — brands live in the Filter drawer */
            const brands = Array.isArray(list) ? list : [];

            categoryRow.innerHTML = `
                <div class="story-item" data-brand="">
                    <div class="story-circle all-circle"><span class="brand-letter brand-letter-all">ALL</span></div>
                    <div class="story-label">All Brands</div>
                </div>
            ` + brands.map(b => `
                <div class="story-item" data-brand="${escapeHtml(b.brand)}">
                    <div class="story-circle">${
                        brandIconMap[b.brand]
                            ? `<img src="${escapeHtml(brandIconMap[b.brand])}" alt="${escapeHtml(b.brand)}" loading="lazy">`
                            : `<span class="brand-letter">${brandLetter(b.brand)}</span>`
                    }</div>
                    <div class="story-label">${escapeHtml(b.brand)}</div>
                </div>
            `).join('');

            categoryRow.querySelectorAll('.story-item').forEach(item => {
                item.addEventListener('click', () => {
                    const brand = item.dataset.brand;
                    let sel = currentBrands();
                    if (!brand) {
                        sel = [];
                    } else if (sel.includes(brand)) {
                        sel = sel.filter(b => b !== brand);
                    } else {
                        sel.push(brand);
                    }
                    if (window.__applyBrandSelection) {
                        window.__applyBrandSelection(sel.join(','));
                    } else {
                        brandFilter.value = sel.join(',');
                    }
                    window.__syncBrandCircles(sel);
                    saveFilterState();
                    resetAndReload();
                });
            });

            window.__syncBrandCircles();
        };



        // Segment pill bar UNDER the circles — both control the same filter
        /* segRow lives statically inside #controlBox (categories on top,
           stories below, one card) — created in products.html */
        let segRow = document.getElementById('segRow');
        if (!segRow) {
            segRow = document.createElement('div');
            segRow.id = 'segRow';
            categoryRow.insertAdjacentElement('beforebegin', segRow);
        }
        segRow.innerHTML = `<div class="seg-bar"><span class="seg-slider"></span>${
            data.categories.map(c => `
                <button type="button" class="seg-btn" data-category="${escapeHtml(c.category)}">${escapeHtml(c.category)}</button>
            `).join('')
        }</div>`;
        const segSlider = segRow.querySelector('.seg-slider');
        function positionSegSlider(btn) {
            if (!segSlider) return;
            if (!btn) { segSlider.style.opacity = '0'; return; }
            segSlider.style.opacity = '1';
            segSlider.style.width = btn.offsetWidth + 'px';
            segSlider.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
            /* Center the active tab INSIDE the bar only — never scroll the
               page. (scrollIntoView here was yanking the whole page up on
               every mobile URL-bar resize while scrolling.) */
            const segBarEl = btn.closest('.seg-bar');
            if (segBarEl && segBarEl.scrollWidth > segBarEl.clientWidth) {
                segBarEl.scrollTo({
                    left: btn.offsetLeft - (segBarEl.clientWidth - btn.offsetWidth) / 2,
                    behavior: 'smooth'
                });
            }
        }
        window.addEventListener('resize', () => {
            positionSegSlider(segRow.querySelector('.seg-btn.active'));
        });

        const drawerLinks = data.categories.map(c => `
            <a class="drawer-link" data-category="${escapeHtml(c.category)}">
                <span class="drawer-icon">${c.thumb ? `<img src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.category)}">` : ''}</span>
                ${escapeHtml(c.category)}
            </a>
        `).join('');

        drawerNav.innerHTML = drawerLinks;

        const footerCollection = document.getElementById('footerCollection');
        if (footerCollection) {
            const footerLinks = data.categories.map(c => `
                <a href="index.html?category=${encodeURIComponent(c.category)}" class="footer-link">${escapeHtml(c.category)}</a>
            `).join('');
            footerCollection.innerHTML = `
                <a href="index.html" class="footer-link">All Category</a>
            ` + footerLinks;
        }

        function applyActiveState(category) {
            drawerNav.querySelectorAll('.drawer-link').forEach(l => l.classList.remove('active'));

            const drawerMatch = drawerNav.querySelector(`.drawer-link[data-category="${CSS.escape(category)}"]`);
            if (drawerMatch) drawerMatch.classList.add('active');

            // keep the segment bar in sync with the circles
            segRow.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
            const segMatch = segRow.querySelector(`.seg-btn[data-category="${CSS.escape(category)}"]`);
            if (segMatch) segMatch.classList.add('active');
            positionSegSlider(segMatch);
        }
        window.__applySegActive = applyActiveState;

        async function selectCategory(category) {
            if (sameNameKey(category) !== sameNameKey(selectedCategory)) metaFilter = {};
            selectedCategory = category;
            if (window.__onCategoryChangedStories) window.__onCategoryChangedStories();
            searchInput.value = '';
            updateHeroForSearch();
            searchBox.classList.remove('expanded');
            titleRow.classList.remove('search-open');

            applyActiveState(category);

            if (refreshFilterDrawerForCategory) {
                await refreshFilterDrawerForCategory(category);
            }

            saveFilterState();
            resetAndReload();
        }



        window.__selectCategory = selectCategory;

        segRow.querySelectorAll('.seg-btn').forEach(btn => {
            btn.addEventListener('click', () => selectCategory(btn.dataset.category));
        });

        drawerNav.querySelectorAll('.drawer-link').forEach(link => {
            link.addEventListener('click', () => {
                selectCategory(link.dataset.category);
                closeDrawer();
            });
        });

        const saved = loadFilterState();
        if (saved && saved.category) {
            selectedCategory = saved.category;
            applyActiveState(saved.category);
        }
    } catch (err) {
        // Categories failing silently is fine.
    }
}

/* =========================================================
   BRANDS
   ========================================================= */
async function loadBrands() {
    try {
        const res = await fetch(`${API_BASE}/get_brands.php`);
        const data = await res.json();
        if (!data.success) return;

        mergeSameNames(data.brands, 'brand').forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.brand;
            opt.textContent = `${b.brand} (${b.count})`;
            brandFilter.appendChild(opt);
        });
    } catch (err) {
        // Brand filter stays empty.
    }
}

/* =========================================================
   PRODUCT PARAMS
   ========================================================= */
function buildParams(page) {
    const params = new URLSearchParams();

    if (searchInput.value.trim()) {
        params.set('search', searchInput.value.trim());
    }
    if (selectedCategory) {
        params.set('category', selectedCategory);
    }
    if (genderFilter.value) {
        params.set('gender', genderFilter.value);
    }
    if (brandFilter.value) {
        params.set('brand', brandFilter.value);
    }
    params.set('page', page);

    return params;
}

/* =========================================================
   LOAD PRODUCTS
   ========================================================= */
async function loadProducts(page = 1, append = false) {
    if (!append) {
        grid.innerHTML = skeletonHtml(8);
        currentProducts = [];
    } else {
        loadMoreBtn.disabled = true;
        loadMoreBtn.textContent = 'Loading...';
    }

    try {
        /* Active story and/or metafield filters: fetch every page of the
           current scope once and keep only the matching products. */
        const storyOn = !!(storyFilterIds && storyFilterIds.length);
        const metaOn = metaActive();
        if (storyOn || metaOn) {
            let wanted = null;
            if (storyOn) wanted = new Set(storyFilterIds.map(String));
            if (metaOn) {
                const m = metaMatchingIds();
                wanted = wanted ? new Set([...wanted].filter(id => m.has(id))) : m;
            }
            const all = await fetchAllScoped();
            currentProducts = all.filter(pr => wanted.has(String(pr.id)));
            currentPage = 1;
            renderProducts(currentProducts);
            resultsCount.textContent = `${currentProducts.length} product${currentProducts.length === 1 ? '' : 's'}` + (storyOn ? ' in this story' : '');
            loadMoreBtn.style.display = 'none';
            return;
        }

        const brandsSel = brandFilter.value ? brandFilter.value.split(',').filter(Boolean) : [];
        let data;

        if (brandsSel.length > 1) {
            // Several brands checked: one request per brand, merged.
            const results = await Promise.all(brandsSel.map(async (b) => {
                const params = buildParams(page);
                params.set('brand', b);
                const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
                return res.json();
            }));
            const ok = results.filter(r => r && r.success);
            if (!ok.length) throw new Error('Failed to load');
            data = {
                success: true,
                products: ok.flatMap(r => r.products || []),
                total: ok.reduce((s, r) => s + (r.total || 0), 0),
                page: page,
                hasMore: ok.some(r => r.hasMore)
            };
        } else {
            const params = buildParams(page);
            const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
            data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to load');
        }

        currentProducts = append ? currentProducts.concat(data.products) : data.products;
        currentPage = data.page;

        renderProducts(currentProducts);

        resultsCount.textContent = `${currentProducts.length} of ${data.total} product${data.total === 1 ? '' : 's'}`;
        loadMoreBtn.style.display = data.hasMore ? 'inline-block' : 'none';
    } catch (err) {
        grid.innerHTML = `<div class="empty">Couldn't load products. ${escapeHtml(err.message)}</div>`;
    } finally {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load More';
    }
}

/* =========================================================
   RENDER PRODUCTS
   ========================================================= */
function renderProducts(products) {
    if (products.length === 0) {
        grid.innerHTML = `
            <div class="empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <div>No products found. Try a different filter.</div>
            </div>
        `;
        return;
    }

    grid.innerHTML = products.map(p => `
        <a class="card" href="product.html?id=${p.id}">
            <div class="card-img-wrap">
                <img src="${p.image ? escapeHtml(p.image) : ''}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0">
            </div>
            <div class="card-body">
                <span class="brand-label">${escapeHtml(p.brand)}</span>
                <h3>${escapeHtml(p.name)}</h3>
                <div class="price-row">
                    <div class="price">${formatPrice(p.price)}</div>
                    <div class="meta"><span class="tag">${escapeHtml(p.gender)}</span></div>
                </div>
            </div>
        </a>
    `).join('');
}

/*
 * When a product card is clicked, clear the saved search term before
 * navigating away — otherwise the search box shows the old term again
 * the next time products.html loads (e.g. via the back button).
 * Category/brand/gender filters are left as-is, since those are
 * meant to stick around when browsing within a category.
 */
grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;

    const existing = loadFilterState() || {};
    if (existing.search) {
        existing.search = '';
        sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
    }
});

/* =========================================================
   RESET + RELOAD
   ========================================================= */
function resetAndReload() {
    saveFilterState();
    loadProducts(1, false);
}

/* =========================================================
   SEARCH — live filtering as you type, 300ms debounce
   ========================================================= */
searchInput.addEventListener('input', () => {
    updateHeroForSearch();

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        resetAndReload();
    }, 300);
});

/* =========================================================
   FILTER EVENTS
   ========================================================= */
genderFilter.addEventListener('change', resetAndReload);
brandFilter.addEventListener('change', resetAndReload);

/* =========================================================
   LOAD MORE
   ========================================================= */
loadMoreBtn.addEventListener('click', () => {
    loadProducts(currentPage + 1, true);
});

/* =========================================================
   RESTORE URL CATEGORY / SEARCH
   ========================================================= */
const urlParams = new URLSearchParams(window.location.search);
const urlCategory = urlParams.get('category');
const urlSearch = urlParams.get('search');
const urlBrand = urlParams.get('brand');

if (urlBrand) {
    // Arriving via a brand link (e.g. the homepage brand wall):
    // apply the brand, drop leftover search. The category is derived
    // from the brand's own products in init() so the filter drawer
    // shows only that department's brands.
    const existing = loadFilterState() || {};
    existing.brand = urlBrand;
    existing.category = '';
    existing.search = '';
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
}

if (urlCategory) {
    const existing = loadFilterState() || {};
    existing.category = urlCategory;
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
} else if (urlSearch) {
    // A header search with no category in the URL means "search everywhere" —
    // clear out any category left over from previous browsing so the search
    // isn't silently scoped to whatever category was last selected.
    const existing = loadFilterState() || {};
    existing.category = '';
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
}

if (urlSearch) {
    const existing = loadFilterState() || {};
    existing.search = urlSearch;
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
}

const urlGender = urlParams.get('gender');
if (urlGender) {
    const existing = loadFilterState() || {};
    existing.gender = urlGender;
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
}

const urlMeta = urlParams.get('meta');
if (urlMeta) {
    try {
        const m = JSON.parse(urlMeta);
        if (m && typeof m === 'object' && !Array.isArray(m)) {
            const existing = loadFilterState() || {};
            existing.meta = m;
            sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
        }
    } catch (e) { /* bad meta param — ignore */ }
}

/* =========================================================
   RESTORE SAVED FILTERS
   ========================================================= */
const savedFilters = loadFilterState();

if (savedFilters) {
    searchInput.value = savedFilters.search || '';
    updateHeroForSearch();
}

/* =========================================================
   INITIALIZATION
   ========================================================= */
/* =========================================================
   STORY ICONS — category-scoped circles at the top:
   - First circle is always "All <Category>" (photo = the
     category icon set in admin), selected by default.
   - Icons show only under their own category (blank = all).
   - An icon with selected product ids filters the grid to
     exactly those products; an icon with a link opens it.
   ========================================================= */
let storyIconsData = [];
let storyFilterIds = null;   /* array of product ids when a story is active */
let storyFilterId = null;    /* the active story icon id */

async function loadStoryIcons() {
    try {
        const res = await fetch(`${API_BASE}/get_story_icons.php`);
        const data = await res.json();
        if (data.success && Array.isArray(data.icons)) storyIconsData = data.icons;
    } catch (e) {
        console.log('Story icons failed:', e);
    }
    renderStoryIconsRow();
}

function clearStoryFilter(reload) {
    const had = !!storyFilterId || brandFilter.value || genderFilter.value || searchInput.value.trim() || hasMetaSelection();
    storyFilterIds = null;
    storyFilterId = null;
    /* "All <Category>" = clean slate for that category */
    brandFilter.value = '';
    genderFilter.value = '';
    searchInput.value = '';
    metaFilter = {};
    if (window.__applyBrandSelection) window.__applyBrandSelection('');
    renderStoryIconsRow();
    saveFilterState();
    if (reload && had) resetAndReload();
    else updateUrlFromFilters();
}

function applyStoryFilter(icon) {
    storyFilterId = String(icon.id);
    storyFilterIds = String(icon.product_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    renderStoryIconsRow();
    updateUrlFromFilters();
    resetAndReload();
}

/* A link-type story that points at products.html applies its filters
   IN PLACE (no page reload) — same feel as product stories. */
function applyStoryLink(icon) {
    const qs = String(icon.link || '').split('?')[1] || '';
    const p = new URLSearchParams(qs);

    storyFilterId = String(icon.id);
    storyFilterIds = null;

    brandFilter.value = p.get('brand') || '';
    genderFilter.value = p.get('gender') || '';
    searchInput.value = p.get('search') || '';
    metaFilter = {};
    if (window.__applyBrandSelection) window.__applyBrandSelection(brandFilter.value);

    const cat = p.get('category');
    if (cat && cat !== selectedCategory && window.__selectCategory) {
        window.__selectCategory(cat);
        return;
    }

    renderStoryIconsRow();
    saveFilterState();
    resetAndReload();
}

/* Called whenever the selected category changes */
window.__onCategoryChangedStories = function () {
    if (storyFilterId) {
        const icon = storyIconsData.find(s => String(s.id) === String(storyFilterId));
        if (!icon || (icon.category && icon.category !== selectedCategory)) {
            storyFilterIds = null;
            storyFilterId = null;
        }
    }
    renderStoryIconsRow();
};

function renderStoryIconsRow() {
    const row = document.getElementById('storiesRow');
    if (!row) return;

    const icons = storyIconsData.filter(s => !s.category || s.category === selectedCategory);

    if (window.__refreshShopBanner) window.__refreshShopBanner();

    if (!icons.length && !selectedCategory) {
        row.style.display = 'none';
        const cbdHide = document.getElementById('controlBoxDivider');
        if (cbdHide) cbdHide.style.display = 'none';
        return;
    }

    const catThumb = (window.__catThumbs && window.__catThumbs[selectedCategory]) || '';
    const allLabel = selectedCategory ? 'All ' + selectedCategory : 'All Products';
    const allActive = !storyFilterId;

    let html = `
        <div class="story-c story-c-all ${allActive ? '' : 'dim'}" data-story-all="1">
            <div class="story-c-ring">
                <div class="story-c-inner"></div>
                ${catThumb
                    ? `<img class="story-c-img" src="${escapeHtml(catThumb)}" alt="${escapeHtml(allLabel)}">`
                    : `<span class="story-c-img story-c-alltxt">ALL</span>`}
            </div>
            <div class="story-c-label">${escapeHtml(allLabel)}</div>
        </div>
    `;

    html += icons.map(s => {
        const hasProducts = String(s.product_ids || '').trim() !== '';
        const active = String(storyFilterId) === String(s.id);
        const inner = `
            <div class="story-c-ring">
                <div class="story-c-inner"></div>
                <img class="story-c-img" src="${escapeHtml(s.image)}" alt="${escapeHtml(s.title)}" loading="lazy">
            </div>
            <div class="story-c-label">${escapeHtml(s.title)}</div>
        `;
        if (hasProducts) {
            return `<div class="story-c ${active ? '' : 'dim'}" data-story-id="${s.id}">${inner}</div>`;
        }
        if (String(s.link || '').indexOf('products.html') !== -1) {
            return `<div class="story-c ${active ? '' : 'dim'}" data-story-link="${s.id}">${inner}</div>`;
        }
        return `<a class="story-c dim" href="${escapeHtml(s.link || '#')}">${inner}</a>`;
    }).join('');

    row.innerHTML = html;
    row.style.display = 'flex';
    if (window.__refreshShopBanner) window.__refreshShopBanner();
    const cbd = document.getElementById('controlBoxDivider');
    if (cbd) cbd.style.display = 'block';

    const allEl = row.querySelector('[data-story-all]');
    if (allEl) allEl.addEventListener('click', () => clearStoryFilter(true));

    row.querySelectorAll('[data-story-id]').forEach(el => {
        el.addEventListener('click', () => {
            const icon = storyIconsData.find(s => String(s.id) === el.dataset.storyId);
            if (!icon) return;
            if (String(storyFilterId) === String(icon.id)) clearStoryFilter(true);
            else applyStoryFilter(icon);
        });
    });

    row.querySelectorAll('[data-story-link]').forEach(el => {
        el.addEventListener('click', () => {
            const icon = storyIconsData.find(s => String(s.id) === el.dataset.storyLink);
            if (!icon) return;
            if (String(storyFilterId) === String(icon.id)) clearStoryFilter(true);
            else applyStoryLink(icon);
        });
    });
}

/* =========================================================
   SHOP BANNER CAROUSEL (slot between categories and toolbar)
   Separate banners per story / per category / general:
     1) a story is tapped and it has banners   -> those
     2) a category is selected and it has banners -> those
     3) otherwise                               -> general banners
   Targets come from shop_banner_targets.php (set in Admin -> Shop Banner).
   ========================================================= */
let shopBannerAll = [];
let shopBannerTargets = {};
let shopBannerKey = null;      /* what's currently shown, avoids re-render flicker */
let shopBannerTimer = null;
let shopBannerIdx = 0;
let shopBannerCount = 0;
let shopBannerLoaded = false;

async function loadShopBanner() {
    const wrap = document.getElementById('shopBanner');
    const track = document.getElementById('shopBannerTrack');
    if (!wrap || !track) return;

    try {
        const [bRes, tRes] = await Promise.all([
            fetch(`${API_BASE}/get_shop_banners.php`).then(r => r.json()),
            fetch(`${API_BASE}/shop_banner_targets.php`).then(r => r.json()).catch(() => null)
        ]);
        shopBannerAll = bRes && bRes.success && Array.isArray(bRes.banners) ? bRes.banners : [];
        shopBannerTargets = {};
        if (tRes && tRes.success && Array.isArray(tRes.targets)) {
            tRes.targets.forEach(t => { shopBannerTargets[String(t.banner_id)] = t; });
        }
    } catch (e) {
        console.log('Shop banner failed:', e);
        return;
    }
    shopBannerLoaded = true;
    if (!shopBannerAll.length) return;

    /* Manual heights from admin (stored on every row, same values) */
    const hMobile = parseInt(shopBannerAll[0].height_mobile, 10) || 0;
    const hDesktop = parseInt(shopBannerAll[0].height_desktop, 10) || 0;
    if (hMobile > 0) {
        wrap.style.setProperty('--sb-h-m', hMobile + 'px');
        wrap.classList.add('sb-fixed-m');
    }
    if (hDesktop > 0) {
        wrap.style.setProperty('--sb-h-d', hDesktop + 'px');
        wrap.classList.add('sb-fixed-d');
    }

    /* Swipe — bound once */
    let touchX = null;
    wrap.addEventListener('touchstart', (e) => {
        touchX = e.touches[0].clientX;
        clearInterval(shopBannerTimer);
    }, { passive: true });
    wrap.addEventListener('touchend', (e) => {
        if (touchX !== null && shopBannerCount > 1) {
            const dx = e.changedTouches[0].clientX - touchX;
            if (Math.abs(dx) > 40) shopBannerShow(shopBannerIdx + (dx < 0 ? 1 : -1));
        }
        touchX = null;
        shopBannerStart();
    }, { passive: true });

    shopBannerKey = null;
    renderShopBanner();
}

function shopBannerPick() {
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const typeOf = b => (shopBannerTargets[String(b.id)] || {}).target_type || 'all';
    const t = b => shopBannerTargets[String(b.id)] || {};

    if (storyFilterId) {
        const list = shopBannerAll.filter(b => typeOf(b) === 'story' && String(t(b).story_id) === String(storyFilterId));
        if (list.length) return { key: 'story:' + storyFilterId, list };
    }
    if (selectedCategory) {
        const list = shopBannerAll.filter(b => typeOf(b) === 'category' && same(t(b).category, selectedCategory));
        if (list.length) return { key: 'cat:' + String(selectedCategory).toLowerCase(), list };
    }
    return { key: 'all', list: shopBannerAll.filter(b => typeOf(b) === 'all') };
}

function shopBannerShow(i) {
    const track = document.getElementById('shopBannerTrack');
    const dotsEl = document.getElementById('shopBannerDots');
    if (!track || !shopBannerCount) return;
    shopBannerIdx = (i + shopBannerCount) % shopBannerCount;
    track.style.transform = `translateX(-${shopBannerIdx * 100}%)`;
    if (dotsEl) dotsEl.querySelectorAll('.shop-banner-dot').forEach((d, di) => d.classList.toggle('active', di === shopBannerIdx));
}

function shopBannerStart() {
    clearInterval(shopBannerTimer);
    if (shopBannerCount > 1) shopBannerTimer = setInterval(() => shopBannerShow(shopBannerIdx + 1), 4000);
}

function renderShopBanner() {
    const wrap = document.getElementById('shopBanner');
    const track = document.getElementById('shopBannerTrack');
    const dotsEl = document.getElementById('shopBannerDots');
    if (!wrap || !track || !shopBannerLoaded) return;

    const { key, list } = shopBannerPick();
    if (key === shopBannerKey) return;
    shopBannerKey = key;

    clearInterval(shopBannerTimer);
    shopBannerCount = list.length;
    shopBannerIdx = 0;

    if (!list.length) {
        wrap.style.display = 'none';
        track.innerHTML = '';
        if (dotsEl) dotsEl.innerHTML = '';
        return;
    }

    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    track.innerHTML = list.map(b => {
        const img = `<img src="${escapeHtml(b.image)}" alt="Banner" loading="lazy">`;
        return b.link
            ? `<a class="shop-banner-slide" href="${escapeHtml(b.link)}">${img}</a>`
            : `<div class="shop-banner-slide">${img}</div>`;
    }).join('');
    void track.offsetWidth;          /* apply the reset before re-enabling the slide animation */
    track.style.transition = '';

    wrap.style.display = 'block';

    if (!dotsEl) return;
    if (list.length < 2) {
        dotsEl.style.display = 'none';
        dotsEl.innerHTML = '';
        return;
    }
    dotsEl.style.display = '';
    dotsEl.innerHTML = list.map((_, i) =>
        `<button type="button" class="shop-banner-dot ${i === 0 ? 'active' : ''}" data-sb-dot="${i}" aria-label="Go to banner ${i + 1}"></button>`
    ).join('');
    dotsEl.querySelectorAll('.shop-banner-dot').forEach(d => {
        d.addEventListener('click', () => {
            shopBannerShow(Number(d.dataset.sbDot));
            shopBannerStart();
        });
    });
    shopBannerStart();
}
window.__refreshShopBanner = renderShopBanner;

/* =========================================================
   DESKTOP LAYOUT: move the toolbar row (product count + WhatsApp
   capsule) into the grid column, so the FILTER sidebar starts
   directly under the categories bar and WhatsApp sits beside it:
       categories (full width)
       filter | whatsapp
       filter | products
   Mobile keeps the original full-width toolbar row.
   ========================================================= */
(function relocateToolbarForDesktop() {
    const toolbar = document.querySelector('.toolbar-row');
    const container = document.querySelector('.page-layout .container');
    if (!toolbar || !container) return;

    const homeMarker = document.createComment('toolbar-home');
    toolbar.parentNode.insertBefore(homeMarker, toolbar);

    const mq = window.matchMedia('(min-width: 900px)');

    function place() {
        if (mq.matches) {
            container.insertBefore(toolbar, container.firstChild);
        } else if (homeMarker.parentNode) {
            homeMarker.parentNode.insertBefore(toolbar, homeMarker.nextSibling);
        }
    }

    place();
    if (mq.addEventListener) mq.addEventListener('change', place);
    else mq.addListener(place);
})();

async function init() {
    loadShopBanner();
    await loadStoryIcons();
    await loadCategories();
    await loadBrands();

    if (savedFilters) {
        if (savedFilters.brand) {
            brandFilter.value = savedFilters.brand;
        }
        if (savedFilters.gender) {
            genderFilter.value = savedFilters.gender;
        }
        if (savedFilters.meta && typeof savedFilters.meta === 'object') {
            metaFilter = savedFilters.meta;
        }
    }
    if (window.__syncBrandCircles) window.__syncBrandCircles();

    // A search that exactly matches a brand name (e.g. "casio") becomes
    // a brand filter — so the filter drawer shows it checked and every
    // count reflects it.
    const searchTerm = (searchInput.value || '').trim().toLowerCase();
    if (searchTerm && !brandFilter.value) {
        const match = Array.from(brandFilter.options || [])
            .find(o => o.value && o.value.toLowerCase() === searchTerm);
        if (match) {
            brandFilter.value = match.value;
            searchInput.value = '';
            const st = loadFilterState() || {};
            st.brand = match.value;
            st.search = '';
            sessionStorage.setItem(FILTER_KEY, JSON.stringify(st));
            if (typeof updateHeroForSearch === 'function') updateHeroForSearch();
        }
    }

    // Brand arrived via URL with no category: find which department(s)
    // this brand lives in. One department -> select it, so the brand
    // list, counts and story circles all scope to it.
    if (urlBrand && !selectedCategory) {
        try {
            const res = await fetch(`${API_BASE}/get_products.php?brand=${encodeURIComponent(urlBrand)}&page=1`);
            const data = await res.json();
            if (data.success && Array.isArray(data.products) && data.products.length) {
                const cats = [...new Set(data.products.map(p => p.category).filter(Boolean))];
                if (cats.length === 1) {
                    selectedCategory = cats[0];
                    const st = loadFilterState() || {};
                    st.category = cats[0];
                    sessionStorage.setItem(FILTER_KEY, JSON.stringify(st));
                    if (window.__applySegActive) window.__applySegActive(cats[0]);
                }
            }
        } catch (e) { /* keep global scope */ }
    }

    if (refreshFilterDrawerForCategory) {
        await refreshFilterDrawerForCategory(selectedCategory);
    }

    /* Arriving via a story link (?story=ID) — apply that story's filter */
    const urlStory = urlParams.get('story');
    if (urlStory) {
        const icon = storyIconsData.find(s => String(s.id) === String(urlStory));
        if (icon && String(icon.product_ids || '').trim() !== '') {
            storyFilterId = String(icon.id);
            storyFilterIds = String(icon.product_ids).split(',').map(s => s.trim()).filter(Boolean);
        } else if (icon) {
            storyFilterId = String(icon.id);
            storyFilterIds = null;
        }
    }
    renderStoryIconsRow();

    loadProducts(1, false);

    /* No hero element on products.html — loadHeroSlider() from
       common.js already ran once at load and no-op'd via its own
       guard, so nothing further to do here. */
}

init();

/* =========================================================
   FILTER DRAWER
   ========================================================= */
(function () {
    const openBtn = document.getElementById('filterToggleBtn');
    const drawer = document.getElementById('filterDrawer');
    const overlay = document.getElementById('filterDrawerOverlay');
    const closeBtn = document.getElementById('filterDrawerClose');
    const genderBody = document.getElementById('fdGender');
    const brandBody = document.getElementById('fdBrand');
    const clearBtn = document.getElementById('fdClearBtn');
    const metaWrap = document.getElementById('fdMetaWrap');

    if (!openBtn || !drawer) return;

    let brandList = [];
    let genderCounts = null;

    const GENDER_OPTIONS = [
        { value: 'men', label: 'Men' },
        { value: 'women', label: 'Women' },
        { value: 'unisex', label: 'Unisex' }
    ];

    const BRAND_VISIBLE = 8;
    const META_VISIBLE = 8;

    function openDrawerPanel() {
        drawer.classList.add('open');
        overlay.classList.add('open');
        renderGender();
        renderBrand();
        renderMeta();
    }

    function closeDrawerPanel() {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
    }

    openBtn.addEventListener('click', () => {
        // Re-render option lists from the live filter values so the
        // active brand/gender always shows checked when the drawer opens.
        renderGender();
        renderBrand();
        openDrawerPanel();
        loadMetaForCategory(selectedCategory);   /* no-op if already loaded */
        renderMeta();
    });
    closeBtn.addEventListener('click', closeDrawerPanel);
    overlay.addEventListener('click', closeDrawerPanel);

    /* One delegated handler: Gender, Brand AND the metafield sections
       (which are built later) all collapse/expand with their arrow. */
    const drawerBody = document.querySelector('.filter-drawer-body');
    if (drawerBody) {
        drawerBody.addEventListener('click', (e) => {
            const head = e.target.closest('.fd-section-head');
            if (!head || !drawerBody.contains(head)) return;
            const body = document.getElementById(head.dataset.target);
            head.classList.toggle('collapsed');
            if (body) body.classList.toggle('collapsed');
        });
    }

    async function fetchGenderCounts() {
        if (genderCounts) return genderCounts;
        genderCounts = {};
        const brandsSel = brandFilter.value ? brandFilter.value.split(',').filter(Boolean) : [''];
        await Promise.all(GENDER_OPTIONS.map(async (g) => {
            try {
                // One request per selected brand (server filters a single
                // brand at a time) — totals summed across them.
                const totals = await Promise.all(brandsSel.map(async (b) => {
                    const params = new URLSearchParams();
                    params.set('gender', g.value);
                    if (selectedCategory) params.set('category', selectedCategory);
                    if (b) params.set('brand', b);
                    const st = (searchInput.value || '').trim();
                    if (st) params.set('search', st);
                    params.set('page', '1');
                    const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
                    const data = await res.json();
                    return data.success ? (data.total || 0) : null;
                }));
                genderCounts[g.value] = totals.some(t => t === null) && !totals.some(t => t > 0)
                    ? null
                    : totals.reduce((s, t) => s + (t || 0), 0);
            } catch (e) {
                genderCounts[g.value] = null;
            }
        }));
        return genderCounts;
    }

    async function fetchBrandList(category) {
        const gender = genderFilter.value;
        const search = (searchInput.value || '').trim();

        if (!category && !gender && !search) {
            try {
                const res = await fetch(`${API_BASE}/get_brands.php`);
                const data = await res.json();
                brandList = data.success ? mergeSameNames(data.brands, 'brand').sort((a, b) => a.brand.localeCompare(b.brand, undefined, { sensitivity: 'base' })) : [];
            } catch (e) {
                brandList = [];
            }
            return;
        }

        try {
            let products = [];
            let page = 1;
            let hasMore = true;

            while (hasMore && page <= 30) {
                const params = new URLSearchParams();
                if (category) params.set('category', category);
                if (gender) params.set('gender', gender);
                if (search) params.set('search', search);
                params.set('page', page);
                const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
                const data = await res.json();
                if (!data.success) break;
                products = products.concat(data.products);
                hasMore = !!data.hasMore;
                page++;
            }

            const counts = {};
            products.forEach(p => {
                if (!p.brand) return;
                counts[p.brand] = (counts[p.brand] || 0) + 1;
            });
            brandList = mergeSameNames(
                Object.keys(counts).map(brand => ({ brand, count: counts[brand] })),
                'brand'
            ).sort((a, b) => a.brand.localeCompare(b.brand, undefined, { sensitivity: 'base' }));
        } catch (e) {
            brandList = [];
        }
    }

    function pruneInvalidBrandSelection() {
        const valid = new Map(brandList.map(b => [sameNameKey(b.brand), b.brand]));
        const kept = [...new Set(selectedBrands().map(b => valid.get(sameNameKey(b))).filter(Boolean))];
        brandFilter.value = kept.join(',');
        if (window.__syncBrandCircles) window.__syncBrandCircles(kept);
    }

    function optionRow(name, value, label, count, checked, extraClass) {
        const countHtml = (count === null || count === undefined) ? '' : `<span class="fd-count">[${count}]</span>`;
        return `<label class="fd-option${extraClass ? ' ' + extraClass : ''}">
            <input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''}>
            ${escapeHtml(label)}${countHtml}
        </label>`;
    }

    async function renderGender() {
        genderBody.innerHTML = GENDER_OPTIONS.map(g =>
            optionRow('fdGenderOpt', g.value, g.label, undefined, genderFilter.value === g.value)
        ).join('');
        bindExclusiveGroup(genderBody, 'fdGenderOpt', (val) => {
            genderFilter.value = val;
            refreshForCategory(selectedCategory);
            renderMeta();
            resetAndReload();
        });

        const counts = await fetchGenderCounts();

        // Every gender at zero (and none selected) -> hide the whole
        // GENDER section, heading included. Any availability -> show it.
        const genderSection = genderBody.closest('.fd-section');
        const known = GENDER_OPTIONS.map(g => counts[g.value]).filter(c => c !== null && c !== undefined);
        const allZero = known.length === GENDER_OPTIONS.length && known.every(c => c === 0);
        if (genderSection) {
            genderSection.style.display = (allZero && !genderFilter.value) ? 'none' : '';
        }

        genderBody.querySelectorAll('input[name="fdGenderOpt"]').forEach(input => {
            const row = input.closest('.fd-option');
            const countEl = row.querySelector('.fd-count');
            const c = counts[input.value];
            // No products for this gender under the current filters ->
            // hide the option entirely (unless it's the one selected).
            if (c === 0 && genderFilter.value !== input.value) {
                row.style.display = 'none';
                return;
            }
            row.style.display = '';
            if (c !== null && c !== undefined) {
                if (countEl) {
                    countEl.textContent = `[${c}]`;
                } else {
                    row.insertAdjacentHTML('beforeend', `<span class="fd-count">[${c}]</span>`);
                }
            }
        });
    }

    function selectedBrands() {
        return brandFilter.value ? brandFilter.value.split(',').filter(Boolean) : [];
    }

    function renderBrand() {
        if (brandList.length === 0) {
            brandBody.innerHTML = `<p style="font-size:13px;color:#999;">No brands available.</p>`;
            return;
        }
        const selected = selectedBrands();
        const rows = brandList.map((b, i) =>
            optionRow('fdBrandOpt', b.brand, b.brand, b.count, selected.includes(b.brand), i >= BRAND_VISIBLE ? 'hidden-extra' : '')
        ).join('');
        const showMoreHtml = brandList.length > BRAND_VISIBLE
            ? `<button type="button" class="fd-show-more" id="fdBrandShowMore">+ Show more</button>`
            : '';
        brandBody.innerHTML = rows + showMoreHtml;

        bindMultiGroup(brandBody, 'fdBrandOpt', (values) => {
            brandFilter.value = values.join(',');
            genderCounts = null;
            renderGender();
            if (window.__syncBrandCircles) window.__syncBrandCircles(values);
            renderMeta();
            resetAndReload();
        });

        const showMoreBtn = document.getElementById('fdBrandShowMore');
        if (showMoreBtn) {
            showMoreBtn.addEventListener('click', () => {
                const hidden = brandBody.querySelectorAll('.fd-option.hidden-extra');
                const isShown = hidden[0] && hidden[0].classList.contains('shown');
                hidden.forEach(el => el.classList.toggle('shown', !isShown));
                showMoreBtn.textContent = isShown ? '+ Show more' : '- Show less';
            });
        }
    }

    /* Desktop shows the sidebar all the time, so load the metafield values right
       away. On phones the drawer is closed - wait until the Filter button is tapped. */
    const wideMq = window.matchMedia('(min-width: 900px)');
    function metaLoadAllowed() {
        return wideMq.matches || drawer.classList.contains('open') || hasMetaSelection();
    }

    /* ---------- METAFIELD SECTIONS (selected category only) ---------- */
    function renderMeta() {
        if (!metaWrap) return;
        const md = metaData;
        if (!md || !md.fields.length || md.ck !== sameNameKey(selectedCategory)) {
            metaWrap.innerHTML = '';
            return;
        }

        /* remember what the visitor had folded / expanded across re-renders */
        const folded = new Set(Array.from(metaWrap.querySelectorAll('.fd-section-head.collapsed')).map(h => h.dataset.key));
        const opened = new Set(Array.from(metaWrap.querySelectorAll('.fd-show-more.is-open')).map(b => b.dataset.key));

        const brands = selectedBrands().map(sameNameKey);
        const gender = genderFilter.value;
        const sections = [];

        md.fields.forEach((f, i) => {
            const bodyId = 'fdMeta_' + i;
            const sel = metaFilter[f.key] || [];
            let inner;

            if (!md.ready) {
                inner = '<p class="fd-meta-loading">Loading' + (md.total ? ` (${md.done}/${md.total})` : '') + '...</p>';
            } else {
                /* faceted counts: respect brand, gender and the OTHER metafields */
                const counts = {};
                md.products.forEach(p => {
                    if (brands.length && !brands.includes(sameNameKey(p.brand))) return;
                    if (gender && p.gender !== gender) return;
                    if (!metaMatches(p, f.key)) return;
                    const v = p.vals[f.key];
                    if (v) counts[v] = (counts[v] || 0) + 1;
                });
                const disp = md.display[f.key] || {};
                const keys = Object.keys(disp)
                    .filter(k => counts[k] || sel.includes(k))
                    .sort((a, b) => disp[a].localeCompare(disp[b], undefined, { sensitivity: 'base', numeric: true }));
                if (!keys.length) return;   /* nothing to filter by here -> no section */

                const isOpen = opened.has(f.key);
                inner = keys.map((k, j) =>
                    optionRow('fdMetaOpt_' + i, k, disp[k], counts[k] || 0, sel.includes(k),
                        j >= META_VISIBLE ? 'hidden-extra' + (isOpen ? ' shown' : '') : '')
                ).join('');
                if (keys.length > META_VISIBLE) {
                    inner += `<button type="button" class="fd-show-more${isOpen ? ' is-open' : ''}" data-key="${escapeHtml(f.key)}" data-body="${bodyId}">${isOpen ? '- Show less' : '+ Show more'}</button>`;
                }
            }

            const isFolded = folded.has(f.key);
            sections.push(`
            <div class="fd-section" data-meta-key="${escapeHtml(f.key)}">
                <button type="button" class="fd-section-head${isFolded ? ' collapsed' : ''}" data-target="${bodyId}" data-key="${escapeHtml(f.key)}">
                    ${escapeHtml(f.label)}
                    <svg class="fd-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <div class="fd-section-body fd-meta-body${isFolded ? ' collapsed' : ''}" id="${bodyId}">${inner}</div>
            </div>`);
        });

        metaWrap.innerHTML = sections.join('');

        md.fields.forEach((f, i) => {
            const body = document.getElementById('fdMeta_' + i);
            if (!body) return;
            bindMultiGroup(body, 'fdMetaOpt_' + i, (values) => {
                if (values.length) metaFilter[f.key] = values; else delete metaFilter[f.key];
                renderMeta();
                resetAndReload();
            });
        });

        metaWrap.querySelectorAll('.fd-show-more').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = document.getElementById(btn.dataset.body);
                if (!body) return;
                const open = !btn.classList.contains('is-open');
                btn.classList.toggle('is-open', open);
                body.querySelectorAll('.fd-option.hidden-extra').forEach(el => el.classList.toggle('shown', open));
                btn.textContent = open ? '- Show less' : '+ Show more';
            });
        });
    }
    window.__renderMeta = renderMeta;

    function bindExclusiveGroup(container, name, onChange) {
        container.querySelectorAll(`input[name="${name}"]`).forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked) {
                    container.querySelectorAll(`input[name="${name}"]`).forEach(other => {
                        if (other !== input) other.checked = false;
                    });
                    onChange(input.value);
                } else {
                    onChange('');
                }
            });
        });
    }

    function bindMultiGroup(container, name, onChange) {
        container.querySelectorAll(`input[name="${name}"]`).forEach(input => {
            input.addEventListener('change', () => {
                const checked = Array.from(container.querySelectorAll(`input[name="${name}"]:checked`)).map(i => i.value);
                onChange(checked);
            });
        });
    }

    clearBtn.addEventListener('click', () => {
        genderFilter.value = '';
        brandFilter.value = '';
        metaFilter = {};
        renderGender();
        renderBrand();
        renderMeta();
        if (window.__syncBrandCircles) window.__syncBrandCircles([]);
        resetAndReload();
    });

    async function refreshForCategory(category) {
        genderCounts = null;
        /* metafields load in the background (many small requests, cached) so
           the product grid never waits for them - unless a saved/URL metafield
           filter has to be applied to the first load. */
        const metaP = metaLoadAllowed() ? loadMetaForCategory(category) : Promise.resolve();
        await fetchBrandList(category);
        if (window.__rebuildBrandCircles) window.__rebuildBrandCircles(brandList);
        pruneInvalidBrandSelection();
        renderGender();
        renderBrand();
        renderMeta();
        if (hasMetaSelection()) {
            await loadMetaForCategory(category);   /* a saved/URL metafield filter must be applied to the first load */
            renderMeta();
        } else {
            await metaP;
        }
    }

    window.__applyBrandSelection = function (csv) {
        brandFilter.value = csv || '';
        genderCounts = null;
        renderGender();
        renderBrand();
        renderMeta();
    };

    refreshFilterDrawerForCategory = refreshForCategory;
})();