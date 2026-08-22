const API_BASE = 'https://fourpirates.tmfragrance.com/visitor/product-api';

const grid = document.getElementById('productGrid');
const searchInput = document.getElementById('searchInput');
const categoryRow = document.getElementById('categoryRow');
const brandFilter = document.getElementById('brandFilter');
const genderFilter = document.getElementById('genderFilter');
const resultsCount = document.getElementById('resultsCount');
const loadMoreBtn = document.getElementById('loadMoreBtn');

const viewToggleBtn = document.getElementById('viewToggleBtn');
if (viewToggleBtn) {
    viewToggleBtn.addEventListener('click', () => {
        const isList = grid.classList.toggle('list-view');
        viewToggleBtn.classList.toggle('active', isList);
    });
}

const hamburgerBtn = document.getElementById('hamburgerBtn');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawerOverlay');
const drawerClose = document.getElementById('drawerClose');
const drawerNav = document.getElementById('drawerNav');

const searchBox = document.getElementById('searchBox');
const searchToggle = document.getElementById('searchToggle');

function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
}
function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
}
hamburgerBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

const titleRow = document.querySelector('.title-row');
searchToggle.addEventListener('click', () => {
    const expanding = !searchBox.classList.contains('expanded');
    searchBox.classList.toggle('expanded');
    titleRow.classList.toggle('search-open', expanding);
    if (expanding) {
        searchInput.focus();
    } else if (!searchInput.value) {
        searchInput.blur();
    }
});
document.addEventListener('click', (e) => {
    if (!searchBox.contains(e.target) && !searchInput.value) {
        searchBox.classList.remove('expanded');
        titleRow.classList.remove('search-open');
    }
});

let currentPage = 1;
let currentProducts = [];
let selectedCategory = '';
let debounceTimer;

// ---- Persist filter state across page navigation (product.html and back) ----
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---- Price formatting: "Rs. 1,199" style (Indian comma grouping, no decimals) ----
function formatPrice(price) {
    return 'Rs. ' + Math.round(price).toLocaleString('en-IN');
}

function skeletonHtml(count) {
    return Array.from({ length: count }).map(() => `
        <div class="skeleton-card">
            <div class="skeleton-img"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
        </div>
    `).join('');
}

// ---- Category buttons (independent of pagination, always complete) ----
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

        const allIconHtml = data.all_icon
            ? `<img src="${escapeHtml(data.all_icon)}" alt="All Category">`
            : `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;

        categoryRow.innerHTML = `
            <div class="story-item" data-category="">
                <div class="story-circle ${data.all_icon ? '' : 'all-circle'} active">
                    ${allIconHtml}
                    <div class="story-check"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
                </div>
                <div class="story-label active">All Category</div>
            </div>
        ` + circles;

        const drawerLinks = data.categories.map(c => `
            <a class="drawer-link" data-category="${escapeHtml(c.category)}">
                <span class="drawer-icon">${c.thumb ? `<img src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.category)}">` : ''}</span>
                ${escapeHtml(c.category)}
            </a>
        `).join('');

        drawerNav.innerHTML = `
            <a class="drawer-link active" data-category="">
                <span class="drawer-icon">${data.all_icon ? `<img src="${escapeHtml(data.all_icon)}" alt="All Category">` : ''}</span>
                All Category
            </a>
        ` + drawerLinks;

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

        function selectCategory(category) {
            selectedCategory = category;
            searchInput.value = '';
            searchBox.classList.remove('expanded');
            titleRow.classList.remove('search-open');
            applyActiveState(category);
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

        // Restore previously selected category (if any) now that circles exist
        const saved = loadFilterState();
        if (saved && saved.category) {
            selectedCategory = saved.category;
            applyActiveState(saved.category);
        }
    } catch (err) {
        // Circles failing silently is fine — filters via product data still work
    }
}

// ---- Brands (independent of pagination, always complete) ----
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
        // Fine — brand filter just stays empty
    }
}

// ---- Products ----
function buildParams(page) {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    if (genderFilter.value) params.set('gender', genderFilter.value);
    if (brandFilter.value) params.set('brand', brandFilter.value);
    params.set('page', page);
    return params;
}

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

        if (!data.success) throw new Error(data.error || 'Failed to load');

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
                    <div class="meta">
                        <span class="tag">${escapeHtml(p.gender)}</span>
                    </div>
                </div>
            </div>
        </a>
    `).join('');
}

function resetAndReload() {
    saveFilterState();
    loadProducts(1, false);
}

searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(resetAndReload, 350);
});
genderFilter.addEventListener('change', resetAndReload);
brandFilter.addEventListener('change', resetAndReload);

loadMoreBtn.addEventListener('click', () => {
    loadProducts(currentPage + 1, true);
});

// ---- Restore search/brand/gender before first load (category restored inside loadCategories) ----
const urlParams = new URLSearchParams(window.location.search);
const urlCategory = urlParams.get('category');
if (urlCategory) {
    const existing = loadFilterState() || {};
    existing.category = urlCategory;
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(existing));
}

const savedFilters = loadFilterState();
if (savedFilters) {
    searchInput.value = savedFilters.search || '';
    // brand/gender <select> options aren't populated yet — set once loadBrands() finishes
}

async function init() {
    await loadCategories();
    await loadBrands();

    if (savedFilters) {
        if (savedFilters.brand) brandFilter.value = savedFilters.brand;
        if (savedFilters.gender) genderFilter.value = savedFilters.gender;
    }

    loadProducts(1, false);
}

init();

// ---- Filter drawer (opened by the Filter button on mobile; a permanent
// left sidebar on desktop via the >=900px media query in style.css) ----
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
                const res = await fetch(`${API_BASE}/get_products.php?gender=${encodeURIComponent(g.value)}&page=1`);
                const data = await res.json();
                genderCounts[g.value] = data.success ? data.total : null;
            } catch (e) {
                genderCounts[g.value] = null;
            }
        }));
        return genderCounts;
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

        // Brand is multi-select: checking a box adds it to the list, unchecking
        // removes it — unlike gender, other brand checkboxes stay as they are.
        bindMultiGroup(brandBody, 'fdBrandOpt', (values) => {
            brandFilter.value = values.join(',');
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

    // Gender stays single-select: checking one unchecks the others in the group.
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

    // Brand is multi-select: every checked box in the group is collected and
    // passed back together, nothing else gets unchecked automatically.
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

    // Fetch the same brand list used to populate the hidden <select>, so the
    // drawer's checkboxes show the identical names and counts. Render
    // immediately on load too — the desktop sidebar is always visible,
    // it doesn't wait for a Filter button click like mobile does.
    (async () => {
        try {
            const res = await fetch(`${API_BASE}/get_brands.php`);
            const data = await res.json();
            if (data.success) brandList = data.brands;
        } catch (e) {
            brandList = [];
        }
        renderGender();
        renderBrand();
    })();
})();