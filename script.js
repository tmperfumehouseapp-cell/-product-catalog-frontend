const API_BASE = 'https://fourpirates.tmfragrance.com/visitor/product-api';

const grid = document.getElementById('productGrid');
const searchInput = document.getElementById('searchInput');
const categoryRow = document.getElementById('categoryRow');
const brandFilter = document.getElementById('brandFilter');
const genderFilter = document.getElementById('genderFilter');
const resultsCount = document.getElementById('resultsCount');
const loadMoreBtn = document.getElementById('loadMoreBtn');

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

        const buttons = data.categories.map(c => `
            <span class="cat-btn" data-category="${escapeHtml(c.category)}">${escapeHtml(c.category)}</span>
        `).join('');

        categoryRow.innerHTML = `<span class="cat-btn active" data-category="">All Category</span>` + buttons;

        categoryRow.querySelectorAll('.cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedCategory = btn.dataset.category;
                categoryRow.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                saveFilterState();
                resetAndReload();
            });
        });

        // Restore previously selected category (if any) now that buttons exist
        const saved = loadFilterState();
        if (saved && saved.category) {
            selectedCategory = saved.category;
            categoryRow.querySelectorAll('.cat-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.category === saved.category);
            });
        }
    } catch (err) {
        // Buttons failing silently is fine — filters via product data still work
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
            <img src="${p.image ? escapeHtml(p.image) : ''}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0">
            <div class="card-body">
                <h3>${escapeHtml(p.name)}</h3>
                <div class="price">₹${p.price.toFixed(2)}</div>
                <div class="meta">
                    <span class="tag">${escapeHtml(p.brand)}</span>
                    <span class="tag">${escapeHtml(p.gender)}</span>
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
