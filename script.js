const API_BASE = 'https://fourpirates.tmfragrance.com/visitor/product-api';

const grid = document.getElementById('productGrid');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const genderFilter = document.getElementById('genderFilter');
const brandFilter = document.getElementById('brandFilter');
const clearBtn = document.getElementById('clearBtn');
const resultsCount = document.getElementById('resultsCount');
const loadMoreBtn = document.getElementById('loadMoreBtn');

let currentPage = 1;
let currentProducts = [];
let debounceTimer;
let filtersPopulated = false;

function buildParams(page) {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (categoryFilter.value) params.set('category', categoryFilter.value);
    if (genderFilter.value) params.set('gender', genderFilter.value);
    if (brandFilter.value) params.set('brand', brandFilter.value);
    params.set('page', page);
    return params;
}

async function loadProducts(page = 1, append = false) {
    if (!append) {
        grid.innerHTML = '<div class="loading">Loading products...</div>';
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
        if (!filtersPopulated) {
            populateFilterOptions(currentProducts);
        }

        resultsCount.textContent = `${currentProducts.length} of ${data.total} product${data.total === 1 ? '' : 's'}`;
        loadMoreBtn.style.display = data.hasMore ? 'inline-block' : 'none';
    } catch (err) {
        grid.innerHTML = `<div class="empty">Error loading products: ${err.message}</div>`;
    } finally {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load More';
    }
}

function renderProducts(products) {
    if (products.length === 0) {
        grid.innerHTML = '<div class="empty">No products found.</div>';
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
                    <span class="tag">${escapeHtml(p.category)}</span>
                    <span class="tag">${escapeHtml(p.gender)}</span>
                </div>
            </div>
        </a>
    `).join('');
}

function populateFilterOptions(products) {
    if (products.length === 0) return;
    filtersPopulated = true;

    const categories = [...new Set(products.map(p => p.category))].sort();
    const brands = [...new Set(products.map(p => p.brand))].sort();

    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        categoryFilter.appendChild(opt);
    });

    brands.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        brandFilter.appendChild(opt);
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function resetAndReload() {
    filtersPopulated = filtersPopulated; // keep filter dropdown options as-is once loaded
    loadProducts(1, false);
}

searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(resetAndReload, 350);
});
categoryFilter.addEventListener('change', resetAndReload);
genderFilter.addEventListener('change', resetAndReload);
brandFilter.addEventListener('change', resetAndReload);

clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    categoryFilter.value = '';
    genderFilter.value = '';
    brandFilter.value = '';
    resetAndReload();
});

loadMoreBtn.addEventListener('click', () => {
    loadProducts(currentPage + 1, true);
});

loadProducts(1, false);