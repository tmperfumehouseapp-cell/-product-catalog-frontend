/* =========================================================
   PRODUCTS.JS
   Categories, brands, product grid, filter drawer, search-filtering.
   Only used on products.html. Requires common.js loaded first
   (uses its API_BASE, escapeHtml, searchInput, searchBox, titleRow,
   drawerNav, updateHeroForSearch from that shared scope).
   ========================================================= */

const grid = document.getElementById('productGrid');
const categoryRow = document.getElementById('categoryRow');
const brandFilter = document.getElementById('brandFilter');
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

        const circles = data.categories.map(c => `
            <div class="story-item" data-category="${escapeHtml(c.category)}">
                <div class="story-circle">
                    ${c.thumb ? `<img src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.category)}">` : ''}
                </div>
                <div class="story-label">${escapeHtml(c.category)}</div>
            </div>
        `).join('');

        categoryRow.innerHTML = circles;

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
            categoryRow.querySelectorAll('.story-circle').forEach(c => {
                c.classList.remove('active');
                const check = c.querySelector('.story-check');
                if (check) check.remove();
            });
            categoryRow.querySelectorAll('.story-label').forEach(l => l.classList.remove('active'));
            drawerNav.querySelectorAll('.drawer-link').forEach(l => l.classList.remove('active'));

            const rowMatch = categoryRow.querySelector(`.story-item[data-category="${CSS.escape(category)}"]`);
            if (rowMatch) {
                const circle = rowMatch.querySelector('.story-circle');
                circle.classList.add('active');
                circle.insertAdjacentHTML('beforeend', '<div class="story-check"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>');
                rowMatch.querySelector('.story-label').classList.add('active');
            }

            const drawerMatch = drawerNav.querySelector(`.drawer-link[data-category="${CSS.escape(category)}"]`);
            if (drawerMatch) drawerMatch.classList.add('active');
        }

        async function selectCategory(category) {
            selectedCategory = category;
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

        categoryRow.querySelectorAll('.story-item').forEach(item => {
            item.addEventListener('click', () => selectCategory(item.dataset.category));
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
        const params = buildParams(page);
        const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to load');
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
async function init() {
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

    if (refreshFilterDrawerForCategory) {
        await refreshFilterDrawerForCategory(selectedCategory);
    }

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

    openBtn.addEventListener('click', openDrawerPanel);
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
        await Promise.all(GENDER_OPTIONS.map(async (g) => {
            try {
                const params = new URLSearchParams();
                params.set('gender', g.value);
                if (selectedCategory) params.set('category', selectedCategory);
                if (brandFilter.value) params.set('brand', brandFilter.value);
                params.set('page', '1');
                const res = await fetch(`${API_BASE}/get_products.php?${params.toString()}`);
                const data = await res.json();
                genderCounts[g.value] = data.success ? data.total : null;
            } catch (e) {
                genderCounts[g.value] = null;
            }
        }));
        return genderCounts;
    }

    async function fetchBrandList(category) {
        const gender = genderFilter.value;

        if (!category && !gender) {
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
        genderBody.querySelectorAll('input[name="fdGenderOpt"]').forEach(input => {
            const countEl = input.closest('.fd-option').querySelector('.fd-count');
            const c = counts[input.value];
            if (c !== null && c !== undefined) {
                if (countEl) {
                    countEl.textContent = `[${c}]`;
                } else {
                    input.closest('.fd-option').insertAdjacentHTML('beforeend', `<span class="fd-count">[${c}]</span>`);
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
        resetAndReload();
    });

    async function refreshForCategory(category) {
        genderCounts = null;
        await fetchBrandList(category);
        pruneInvalidBrandSelection();
        renderGender();
        renderBrand();
    }

    refreshFilterDrawerForCategory = refreshForCategory;
})();