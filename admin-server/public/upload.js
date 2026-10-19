// Every file-upload form in the dashboard goes through here instead of a
// plain form submit, so that:
//  - big phone photos are shrunk in the browser first (much faster uploads,
//    and lighter pages for visitors),
//  - a progress bar shows what's happening instead of an endless spinner,
//  - "upload a file or pick one from the library" is checked before sending.
(() => {
  const MAX_EDGE = 2560; // px on the long side — plenty for a full-screen view
  const RESIZABLE = ['image/jpeg', 'image/webp'];
  const CLOUDFLARE_LIMIT = 95 * 1024 * 1024; // Cloudflare rejects requests over 100MB

  async function shrink(file) {
    if (!RESIZABLE.includes(file.type)) return file;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode(); // browsers apply the photo's EXIF rotation here
      const scale = MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight);
      if (scale >= 1) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch {
      return file; // anything unexpected: just send the original
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function overlay() {
    let el = document.getElementById('upload-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'upload-overlay';
      el.innerHTML =
        '<div class="upload-box"><p class="upload-label"></p><div class="upload-bar"><span></span></div>' +
        '<p class="upload-detail muted"></p><button type="button" class="button small upload-close" hidden>Close</button></div>';
      document.body.appendChild(el);
      el.querySelector('.upload-close').addEventListener('click', () => (el.hidden = true));
    }
    el.hidden = false;
    el.querySelector('.upload-close').hidden = true;
    return {
      set(label, fraction, detail = '') {
        el.querySelector('.upload-label').textContent = label;
        el.querySelector('.upload-bar span').style.width = `${Math.round((fraction ?? 0) * 100)}%`;
        el.querySelector('.upload-bar').classList.toggle('indeterminate', fraction == null);
        el.querySelector('.upload-detail').textContent = detail;
      },
      fail(message) {
        this.set('Upload failed', 0, message);
        el.querySelector('.upload-close').hidden = false;
      },
    };
  }

  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || form.enctype !== 'multipart/form-data' || e.defaultPrevented) return;

    // a required media slot is satisfied by either a new file or a library pick
    for (const input of form.querySelectorAll('input[type=file][data-required-unless-picked]')) {
      const picked = form.querySelector(`input[name="pick_${input.name}"]:checked`);
      if (!input.files.length && !(picked && picked.value)) {
        e.preventDefault();
        input.setCustomValidity('Upload a file here, or choose one from the media library below.');
        input.reportValidity();
        input.addEventListener('change', () => input.setCustomValidity(''), { once: true });
        return;
      }
    }

    const fileInputs = [...form.querySelectorAll('input[type=file]')].filter((i) => i.files.length);
    if (!fileInputs.length) return; // nothing to upload — a normal submit is fine

    e.preventDefault();
    const ui = overlay();
    const data = new FormData(form, e.submitter);

    const total = fileInputs.reduce((n, i) => n + i.files.length, 0);
    let done = 0;
    for (const input of fileInputs) {
      data.delete(input.name);
      for (const file of input.files) {
        ui.set('Preparing photos…', done / total, file.name);
        data.append(input.name, await shrink(file));
        done += 1;
      }
    }

    let size = 0;
    for (const [, v] of data) if (v instanceof File) size += v.size;
    if (size > CLOUDFLARE_LIMIT) {
      ui.fail(`That's ${mb(size)} in one go — the limit is 100 MB. Upload fewer files at a time.`);
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', form.action || location.href);
    xhr.setRequestHeader('X-Requested-With', 'upload');
    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) ui.set('Uploading…', ev.loaded / ev.total, `${mb(ev.loaded)} of ${mb(ev.total)}`);
    });
    xhr.upload.addEventListener('load', () => ui.set('Saving…', null, 'Almost done'));
    xhr.addEventListener('load', () => {
      let reply = null;
      try {
        reply = JSON.parse(xhr.responseText);
      } catch {
        // not from the dashboard itself — e.g. Cloudflare refusing the request
      }
      if (reply?.redirect) {
        ui.set('Saved ✓', 1, 'Opening…');
        location.assign(reply.redirect);
      } else if (reply?.error) {
        ui.fail(reply.error);
      } else if (xhr.status === 413) {
        ui.fail('Those files are too large to upload in one go. Try fewer at a time.');
      } else {
        ui.fail(`Something went wrong (error ${xhr.status}). Reload the page and check whether it saved.`);
      }
    });
    xhr.addEventListener('error', () => ui.fail('The connection dropped. Check your internet and try again.'));
    xhr.send(data);
  });
})();
