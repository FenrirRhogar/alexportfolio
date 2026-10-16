// "Copy path" buttons in the media library — copies e.g. /media/design/x.jpg
// so it can be pasted into a raw file or anywhere else a path is needed.
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      const label = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => (btn.textContent = label), 1500);
    } catch {
      prompt('Copy this path:', btn.dataset.copy);
    }
  });
});
