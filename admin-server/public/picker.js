// Ordered media-library pickers (flipbook pages): remembers the order pages
// are clicked in, shows it as a number on each, and sends it along in the
// hidden "<name>Order" field — the server puts the pages in that order.
document.querySelectorAll('.library-picker[data-ordered]').forEach((picker) => {
  const order = [];
  const hidden = picker.querySelector('input[type=hidden][name$="Order"]');
  const boxes = [...picker.querySelectorAll('input[type=checkbox]')];
  const render = () => {
    for (const box of boxes) {
      const n = order.indexOf(box.value);
      if (n === -1) delete box.parentElement.dataset.order;
      else box.parentElement.dataset.order = String(n + 1);
    }
    hidden.value = JSON.stringify(order);
  };
  for (const box of boxes) {
    box.addEventListener('change', () => {
      const at = order.indexOf(box.value);
      if (box.checked && at === -1) order.push(box.value);
      if (!box.checked && at !== -1) order.splice(at, 1);
      render();
    });
  }
});
