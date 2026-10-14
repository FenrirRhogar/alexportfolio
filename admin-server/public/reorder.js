// Plain HTML5 drag-and-drop reordering — no external library, so this
// keeps working even if the admin server has no internet access.
(() => {
  const list = document.getElementById('entry-list');
  if (!list) return;
  const collection = list.dataset.collection;
  let dragEl = null;

  list.addEventListener('dragstart', (e) => {
    dragEl = e.target.closest('.entry-row');
    dragEl.classList.add('dragging');
  });

  list.addEventListener('dragend', () => {
    dragEl?.classList.remove('dragging');
    dragEl = null;
    saveOrder();
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const after = getRowAfter(list, e.clientY);
    if (!dragEl) return;
    if (after == null) {
      list.appendChild(dragEl);
    } else {
      list.insertBefore(dragEl, after);
    }
  });

  function getRowAfter(container, y) {
    const rows = [...container.querySelectorAll('.entry-row:not(.dragging)')];
    return rows.reduce(
      (closest, row) => {
        const box = row.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: row };
        }
        return closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null },
    ).element;
  }

  async function saveOrder() {
    const slugs = [...list.querySelectorAll('.entry-row')].map((row) => row.dataset.slug);
    await fetch(`/admin/${collection}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    });
  }
})();
