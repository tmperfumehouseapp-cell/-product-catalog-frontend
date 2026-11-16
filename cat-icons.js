/* Category icons (red line icons) shared by the home, shop and product pages.
   catIcon('Perfume') -> inline <svg> that takes its colour from the text colour. */
(function () {
  var P = {
    perfume: '<rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M10.5 6v2M13.5 6v2"/><rect x="5.5" y="8" width="13" height="13" rx="3.5"/><path d="M9 14h6"/>',
    watch: '<path d="M9 7l.8-4h4.4L15 7M9 17l.8 4h4.4L15 17"/><circle cx="12" cy="12" r="5"/><path d="M12 9.5V12l1.8 1.2"/>',
    shoe: '<path d="M3 17v-4.2c0-.6.4-1.1 1-1.2l3.2-.7 2.1-3.3 2 1.3c1 .7 2.1 1.2 3.3 1.5l3.6.9c1.5.4 2.8 1.7 2.8 3.2V17z"/><path d="M3 17h18"/><path d="M10.2 11.2l1.1 1.6"/>',
    sun: '<path d="M3 9.5h18"/><path d="M4.5 9.5l.8 5c.2 1.2 1.2 2 2.4 2h1.1c1.3 0 2.4-1 2.5-2.3l.2-2.7"/><path d="M19.5 9.5l-.8 5c-.2 1.2-1.2 2-2.4 2h-1.1c-1.3 0-2.4-1-2.5-2.3l-.2-2.7"/><path d="M10.6 11.6c.9-.5 1.9-.5 2.8 0"/>',
    bag: '<path d="M5 8h14l1 12H4L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>'
  };
  function kind(n) {
    n = String(n || '').toLowerCase();
    if (/perfume|fragrance|attar|scent|cologne|deo/.test(n)) return 'perfume';
    if (/watch/.test(n)) return 'watch';
    if (/shoe|sneaker|footwear|slipper|sandal|loafer/.test(n)) return 'shoe';
    if (/sun|shade|glass|eyewear|frame/.test(n)) return 'sun';
    if (/bag|wallet|belt|purse|clutch/.test(n)) return 'bag';
    if (/^new|latest|arrival/.test(n)) return 'spark';
    return 'tag';
  }
  window.catIcon = function (name) {
    return '<svg class="cat-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[kind(name)] + '</svg>';
  };
})();
