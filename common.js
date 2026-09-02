/* =========================================================
   COMMON.JS
   Shared by index.html AND products.html:
   hero slider, hamburger drawer, search-box UI.
   Load this BEFORE products.js on any page that has it.
   ========================================================= */

const API_BASE = 'https://fourpirates.tmfragrance.com/visitor/product-api';

const searchInput = document.getElementById('searchInput');

/* =========================================================
   HTML ESCAPE (also used by products.js)
   ========================================================= */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* =========================================================
   HERO SLIDER
   ========================================================= */
const heroSlider = document.getElementById('heroSlider');
const heroSlides = document.getElementById('heroSlides');
const heroDots = document.getElementById('heroDots');
const heroPrev = document.getElementById('heroPrev');
const heroNext = document.getElementById('heroNext');

let heroIndex = 0;
let heroTimer = null;
let heroItems = [];

/*
 * Hide slider whenever user searches.
 * When search box becomes empty, slider comes back.
 */
function updateHeroForSearch() {
    if (!heroSlider) return;
    const hasSearch = searchInput.value.trim().length > 0;
    heroSlider.classList.toggle('search-active', hasSearch);
}

/*
 * Render hero slides from manually-entered slide data
 * (added/edited via the admin panel's Hero Slider section).
 */
function renderHeroSlides(slides) {
    if (!heroSlider || !heroSlides) return;

    heroItems = slides;
    if (!heroItems.length) return;

    heroSlides.innerHTML = heroItems.map((s, i) => {
        const image = s.image ? escapeHtml(s.image) : '';
        const kicker = escapeHtml(s.kicker || '');
        const headline = escapeHtml(s.headline || '');
        const accent = s.headline_accent ? `<em> ${escapeHtml(s.headline_accent)}</em>` : '';
        const description = escapeHtml(s.description || '');
        const btn1Text = escapeHtml(s.button1_text || 'Explore more');
        const btn1Link = s.button1_link ? escapeHtml(s.button1_link) : '#';
        const btn2Html = s.button2_link ? `<a href="${escapeHtml(s.button2_link)}" class="hero-btn-outline" target="_blank" rel="noopener">${escapeHtml(s.button2_text || 'Inquiry')}</a>` : '';

        return `
            <article class="hero-slide ${i === 0 ? 'is-active' : ''}">
                <div class="hero-text-col">
                    ${kicker ? `<span class="hero-kicker">${kicker}</span>` : ''}
                    <h1>${headline}${accent}</h1>
                    ${description ? `<p>${description}</p>` : ''}
                    <div class="hero-buttons">
                        <a href="${btn1Link}" class="hero-btn-filled">${btn1Text}</a>
                        ${btn2Html}
                    </div>
                </div>
                <div class="hero-image-col">
                    <img src="${image}" alt="${headline}" loading="lazy" onerror="this.style.opacity=0">
                </div>
            </article>
        `;
    }).join('');

    if (heroDots) {
        heroDots.innerHTML = heroItems.map((_, i) => `
            <button type="button" class="hero-dot ${i === 0 ? 'active' : ''}" data-hero-index="${i}" aria-label="Go to slide ${i + 1}"></button>
        `).join('');

        heroDots.querySelectorAll('.hero-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                showHeroSlide(Number(dot.dataset.heroIndex));
                startHeroTimer();
            });
        });
    }

    heroIndex = 0;
    startHeroTimer();
}

function showHeroSlide(index) {
    if (!heroSlides || !heroItems.length) return;
    heroIndex = (index + heroItems.length) % heroItems.length;

    heroSlides.querySelectorAll('.hero-slide').forEach((slide, i) => {
        slide.classList.toggle('is-active', i === heroIndex);
    });

    if (heroDots) {
        heroDots.querySelectorAll('.hero-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === heroIndex);
        });
    }
}

function startHeroTimer() {
    clearInterval(heroTimer);
    if (heroItems.length > 1) {
        heroTimer = setInterval(() => {
            showHeroSlide(heroIndex + 1);
        }, 5000);
    }
}

if (heroPrev) {
    heroPrev.addEventListener('click', () => {
        showHeroSlide(heroIndex - 1);
        startHeroTimer();
    });
}

if (heroNext) {
    heroNext.addEventListener('click', () => {
        showHeroSlide(heroIndex + 1);
        startHeroTimer();
    });
}

/*
 * Fetch manually-managed hero slides (added via the admin panel)
 * and populate the hero with them.
 * Decorative — if it fails, the rest of the page still works.
 */
async function loadHeroSlider() {
    if (!heroSlider) return;

    try {
        const res = await fetch(`${API_BASE}/get_hero_slides.php`);
        const data = await res.json();

        if (data.success && Array.isArray(data.slides)) {
            renderHeroSlides(data.slides);
        }
    } catch (e) {
        console.log('Hero slider failed:', e);
    }
}

/* =========================================================
   MAIN DRAWER (hamburger menu)
   ========================================================= */
const hamburgerBtn = document.getElementById('hamburgerBtn');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawerOverlay');
const drawerClose = document.getElementById('drawerClose');
const drawerNav = document.getElementById('drawerNav');

function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
}

function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
}

if (hamburgerBtn) hamburgerBtn.addEventListener('click', openDrawer);
if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

/* =========================================================
   SEARCH BOX OPEN / CLOSE ANIMATION
   ========================================================= */
const searchBox = document.getElementById('searchBox');
const searchToggle = document.getElementById('searchToggle');
const titleRow = document.querySelector('.title-row');
const hasProductGrid = !!document.getElementById('productGrid');

function runHeaderSearch() {
    const term = searchInput.value.trim();
    if (term) {
        window.location.href = 'products.html?search=' + encodeURIComponent(term);
    }
}

if (searchToggle) {
    searchToggle.addEventListener('click', (e) => {
        const isExpanded = searchBox.classList.contains('expanded');
        const hasValue = !!searchInput.value.trim();

        if (isExpanded && hasValue) {
            if (!hasProductGrid) {
                // index.html / product.html — tapping the icon while text
                // is typed means "search": let the form submit handler run.
                return;
            }
            // products.html — already filtering live as you type; tapping
            // the icon just dismisses the keyboard, keeps the box open.
            e.preventDefault();
            searchInput.blur();
            return;
        }

        e.preventDefault();
        const expanding = !isExpanded;
        searchBox.classList.toggle('expanded');
        titleRow.classList.toggle('search-open', expanding);

        if (expanding) {
            searchInput.focus();
        } else {
            searchInput.blur();
        }
    });
}

if (searchBox && searchBox.tagName === 'FORM') {
    searchBox.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!hasProductGrid) {
            runHeaderSearch();
        }
    });
}

/*
 * Close search when clicking outside.
 */
document.addEventListener('click', (e) => {
    if (searchBox && !searchBox.contains(e.target) && !searchInput.value) {
        searchBox.classList.remove('expanded');
        titleRow.classList.remove('search-open');
    }
});

/*
 * Only relevant on pages WITHOUT a product grid (i.e. index.html,
 * product.html): pressing Enter in the header search box jumps to
 * the shop page with that search term pre-filled. On products.html
 * this does nothing extra — that page already filters live as you type.
 */
if (!hasProductGrid) {
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runHeaderSearch();
        }
    });
}

/*
 * On pages with a hero slider (index.html), load real product
 * images into it right away. On products.html there's no hero
 * element, so this safely does nothing (see the guard above).
 */
loadHeroSlider();