// Reordering flipbook pages: drag a page (SortableJS — on touch screens a
// short press-and-hold first, so swiping still scrolls the page), or tap
// ‹ › to move it one place. Every change saves by itself. A project can have
// several flipbooks, so each ".reorder-pages" list is wired up on its own.
(() => {
  document.querySelectorAll('.reorder-pages').forEach((list) => {
    const status = list.previousElementSibling; // .reorder-status
    let saved = order();
    let timer = null;

    function order() {
      return [...list.querySelectorAll('.page-thumb')].map((el) => el.dataset.src);
    }

    // labels match the book on the site: cover, spreads 2–3, 4–5…, back cover
    function renumber() {
      const thumbs = [...list.querySelectorAll('.page-thumb')];
      thumbs.forEach((el, i) => {
        // the last page only stands alone when the count is even (as in FlipBook.astro)
        const last = i === thumbs.length - 1 && thumbs.length > 1 && thumbs.length % 2 === 0;
        el.querySelector('.page-num').textContent = i === 0 ? 'Cover' : last ? 'Back' : String(i + 1);
        el.classList.toggle('is-cover', i === 0 || last);
        el.querySelector('[data-step="-1"]').disabled = i === 0;
        el.querySelector('[data-step="1"]').disabled = i === thumbs.length - 1;
      });
    }

    function show(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('error', isError);
    }

    function changed() {
      renumber();
      clearTimeout(timer);
      if (order().join('\n') === saved.join('\n')) return show('');
      show('Saving the new order…');
      // a short wait, so several quick moves are saved (and rebuilt) once
      timer = setTimeout(save, 700);
    }

    async function save() {
      const pages = order();
      try {
        const res = await fetch(list.dataset.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages }),
        });
        if (!res.ok) throw new Error();
        saved = pages;
        if (order().join('\n') === pages.join('\n')) show('Order saved ✓ — live on the site in a few seconds.');
      } catch {
        show("Couldn't save the new order. Reload the page and try again.", true);
      }
    }

    Sortable.create(list, {
      animation: 150,
      forceFallback: true, // same drag (and edge auto-scroll) for mouse and touch
      fallbackOnBody: true,
      draggable: '.page-thumb',
      filter: 'button, form', // the × and ‹ › buttons stay clickable
      preventOnFilter: false,
      delay: 250, // touch only (below): press and hold to pick a page up
      delayOnTouchOnly: true,
      onEnd: changed,
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.page-step');
      if (!btn) return;
      const thumb = btn.closest('.page-thumb');
      if (btn.dataset.step === '-1' && thumb.previousElementSibling) {
        list.insertBefore(thumb, thumb.previousElementSibling);
      } else if (btn.dataset.step === '1' && thumb.nextElementSibling) {
        list.insertBefore(thumb.nextElementSibling, thumb);
      } else return;
      // keep the same button under the finger/keyboard for repeated taps
      thumb.querySelector(`[data-step="${btn.dataset.step}"]`).focus();
      changed();
    });

    renumber();
  });
})();
