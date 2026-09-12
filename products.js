/* =========================================================
   PRODUCTS.JS
   Categories, brands, product grid, filter drawer, search-filtering.
   Only used on products.html. Requires common.js loaded first
   (uses its API_BASE, escapeHtml, searchInput, searchBox, titleRow,
   drawerNav, updateHeroForSearch from that shared scope).
   ========================================================= */

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
        gender: genderFilter.value
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
            btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
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

        data.brands.forEach(b => {
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
        /* Active story: fetch every page of the current scope once and
           keep only the story's products (stories are small sets). */
        if (storyFilterIds && storyFilterIds.length) {
            const wanted = new Set(storyFilterIds.map(String));
            let all = [];
            let p = 1;
            let more = true;
            while (more && p <= 15) {
                const params = buildParams(p);
                const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
                const d = await res.json();
                if (!d.success) throw new Error(d.error || 'Failed to load');
                all = all.concat(d.products || []);
                more = !!d.hasMore;
                p++;
            }
            currentProducts = all.filter(pr => wanted.has(String(pr.id)));
            currentPage = 1;
            renderProducts(currentProducts);
            resultsCount.textContent = `${currentProducts.length} product${currentProducts.length === 1 ? '' : 's'} in this story`;
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
    const had = !!storyFilterId || brandFilter.value || genderFilter.value || searchInput.value.trim();
    storyFilterIds = null;
    storyFilterId = null;
    /* "All <Category>" = clean slate for that category */
    brandFilter.value = '';
    genderFilter.value = '';
    searchInput.value = '';
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
   ========================================================= */
async function loadShopBanner() {
    const wrap = document.getElementById('shopBanner');
    const track = document.getElementById('shopBannerTrack');
    const dotsEl = document.getElementById('shopBannerDots');
    if (!wrap || !track) return;

    let banners = [];
    try {
        const res = await fetch(`${API_BASE}/get_shop_banners.php`);
        const data = await res.json();
        if (data.success && Array.isArray(data.banners)) banners = data.banners;
    } catch (e) {
        console.log('Shop banner failed:', e);
        return;
    }
    if (!banners.length) return;

    /* Manual heights from admin (stored on every row, same values) */
    const hMobile = parseInt(banners[0].height_mobile, 10) || 0;
    const hDesktop = parseInt(banners[0].height_desktop, 10) || 0;
    if (hMobile > 0) {
        wrap.style.setProperty('--sb-h-m', hMobile + 'px');
        wrap.classList.add('sb-fixed-m');
    }
    if (hDesktop > 0) {
        wrap.style.setProperty('--sb-h-d', hDesktop + 'px');
        wrap.classList.add('sb-fixed-d');
    }

    track.innerHTML = banners.map(b => {
        const img = `<img src="${escapeHtml(b.image)}" alt="Banner" loading="lazy">`;
        return b.link
            ? `<a class="shop-banner-slide" href="${escapeHtml(b.link)}">${img}</a>`
            : `<div class="shop-banner-slide">${img}</div>`;
    }).join('');

    wrap.style.display = 'block';

    if (banners.length < 2) {
        if (dotsEl) dotsEl.style.display = 'none';
        return;
    }

    let idx = 0;
    let timer = null;

    dotsEl.innerHTML = banners.map((_, i) =>
        `<button type="button" class="shop-banner-dot ${i === 0 ? 'active' : ''}" data-sb-dot="${i}" aria-label="Go to banner ${i + 1}"></button>`
    ).join('');

    function show(i) {
        idx = (i + banners.length) % banners.length;
        track.style.transform = `translateX(-${idx * 100}%)`;
        dotsEl.querySelectorAll('.shop-banner-dot').forEach((d, di) => {
            d.classList.toggle('active', di === idx);
        });
    }

    function start() {
        clearInterval(timer);
        timer = setInterval(() => show(idx + 1), 4000);
    }

    dotsEl.querySelectorAll('.shop-banner-dot').forEach(d => {
        d.addEventListener('click', () => {
            show(Number(d.dataset.sbDot));
            start();
        });
    });

    let touchX = null;
    wrap.addEventListener('touchstart', (e) => {
        touchX = e.touches[0].clientX;
        clearInterval(timer);
    }, { passive: true });
    wrap.addEventListener('touchend', (e) => {
        if (touchX !== null) {
            const dx = e.changedTouches[0].clientX - touchX;
            if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
        }
        touchX = null;
        start();
    }, { passive: true });

    start();
}

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

    if (!openBtn || !drawer) return;

    let brandList = [];
    let genderCounts = null;

    const GENDER_OPTIONS = [
        { value: 'men', label: 'Men' },
        { value: 'women', label: 'Women' },
        { value: 'unisex', label: 'Unisex' }
    ];

    const BRAND_VISIBLE = 8;

    function openDrawerPanel() {
        drawer.classList.add('open');
        overlay.classList.add('open');
        renderGender();
        renderBrand();
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
    });
    closeBtn.addEventListener('click', closeDrawerPanel);
    overlay.addEventListener('click', closeDrawerPanel);

    document.querySelectorAll('.fd-section-head').forEach(head => {
        head.addEventListener('click', () => {
            const body = document.getElementById(head.dataset.target);
            head.classList.toggle('collapsed');
            if (body) body.classList.toggle('collapsed');
        });
    });

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
                brandList = data.success ? data.brands : [];
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
            brandList = Object.keys(counts)
                .sort((a, b) => a.localeCompare(b))
                .map(brand => ({ brand, count: counts[brand] }));
        } catch (e) {
            brandList = [];
        }
    }

    function pruneInvalidBrandSelection() {
        const valid = new Set(brandList.map(b => b.brand));
        const kept = selectedBrands().filter(b => valid.has(b));
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
        renderGender();
        renderBrand();
        if (window.__syncBrandCircles) window.__syncBrandCircles([]);
        resetAndReload();
    });

    async function refreshForCategory(category) {
        genderCounts = null;
        await fetchBrandList(category);
        if (window.__rebuildBrandCircles) window.__rebuildBrandCircles(brandList);
        pruneInvalidBrandSelection();
        renderGender();
        renderBrand();
    }

    window.__applyBrandSelection = function (csv) {
        brandFilter.value = csv || '';
        genderCounts = null;
        renderGender();
        renderBrand();
    };

    refreshFilterDrawerForCategory = refreshForCategory;
})();