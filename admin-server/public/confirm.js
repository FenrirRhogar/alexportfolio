// Shows a confirm() dialog before any form submission whose element has a
// data-confirm attribute, instead of inline onsubmit="" handlers — so the
// admin pages don't need 'unsafe-inline' in their script-src CSP.
document.addEventListener('submit', (e) => {
  const message = e.target instanceof HTMLFormElement ? e.target.dataset.confirm : null;
  if (message && !window.confirm(message)) e.preventDefault();
});
