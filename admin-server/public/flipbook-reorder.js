// Drag-and-drop reordering for flipbook page grids. A page can have more
// than one flipbook, so this wires up every ".reorder-pages" list on the
// page independently rather than assuming just one.
(() => {
  document.querySelectorAll('.reorder-pages').forEach((list) => {
    let dragEl = null;

    list.querySelectorAll('.page-thumb').forEach((thumb) => {
      thumb.addEventListener('dragstart', () => {
        dragEl = thumb;
        thumb.classList.add('dragging');
      });
      thumb.addEventListener('dragend', () => {
        thumb.classList.remove('dragging');
        dragEl = null;
        saveOrder(list);
      });
      thumb.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === thumb) return;
        const box = thumb.getBoundingClientRect();
        const before = e.clientX < box.left + box.width / 2;
        list.insertBefore(dragEl, before ? thumb : thumb.nextSibling);
      });
    });
  });

  async function saveOrder(list) {
    const pages = [...list.querySelectorAll('.page-thumb')].map((el) => el.dataset.src);
    await fetch(list.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages }),
    });
  }
})();
