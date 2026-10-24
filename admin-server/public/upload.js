// Every file-upload form in the dashboard goes through here instead of a
// plain form submit, so that:
//  - big phone photos are shrunk in the browser first (much faster uploads,
//    and lighter pages for visitors),
//  - a progress bar shows what's happening instead of an endless spinner,
//  - "upload a file or pick one from the library" is checked before sending.
(() => {
  const MAX_EDGE = 2560; // px on the long side — plenty for a full-screen view
  const RESIZABLE = ['image/jpeg', 'image/webp'];
  const CLOUDFLARE_LIMIT = 90 * 1024 * 1024; // Cloudflare rejects requests over 100MB
  const MAX_FILE = 300 * 1024 * 1024; // matches MAX_FILE_MB in lib/upload.mjs
  const PIECE = 32 * 1024 * 1024; // files bigger than this go ahead of the form, in pieces this size

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

  function post(url, body, type, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', type);
      xhr.upload.addEventListener('progress', (ev) => onProgress?.(ev.loaded));
      xhr.addEventListener('load', () => {
        let reply = null;
        try {
          reply = JSON.parse(xhr.responseText);
        } catch {
          // not from the dashboard itself
        }
        if (xhr.status === 200 && reply && !reply.error) resolve(reply);
        else reject(new Error(reply?.error || `Something went wrong (error ${xhr.status}). Please try again.`));
      });
      xhr.addEventListener('error', () => reject(new Error('The connection dropped. Check your internet and try again.')));
      xhr.send(body);
    });
  }

  /** Sends one big file in pieces; returns the id the form then refers to. */
  async function sendInPieces(field, file, onProgress) {
    const count = Math.ceil(file.size / PIECE);
    const { id } = await post(
      '/admin/pieces',
      JSON.stringify({ field, name: file.name, type: file.type, size: file.size, count }),
      'application/json',
    );
    for (let i = 0; i < count; i++) {
      const start = i * PIECE;
      await post(`/admin/pieces/${id}/${i}`, file.slice(start, start + PIECE), 'application/octet-stream', (n) => onProgress(start + n));
    }
    return id;
  }

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

    // a file input with any big file sends all of its files in pieces, so
    // they stay in the order they were chosen (e.g. flipbook pages)
    const pieced = [];
    for (const input of fileInputs) {
      const files = data.getAll(input.name).filter((v) => v instanceof File);
      const tooBig = files.find((f) => f.size > MAX_FILE);
      if (tooBig) {
        ui.fail(`${tooBig.name} is ${mb(tooBig.size)} — the limit is ${mb(MAX_FILE).replace('.0', '')} per file.`);
        return;
      }
      if (files.some((f) => f.size > PIECE)) {
        data.delete(input.name);
        pieced.push(...files.map((file) => ({ field: input.name, file })));
      }
    }

    let size = 0;
    for (const [, v] of data) if (v instanceof File) size += v.size;
    if (size > CLOUDFLARE_LIMIT) {
      ui.fail(`That's ${mb(size)} in one go — the limit is 90 MB unless a single file is big. Upload fewer files at a time.`);
      return;
    }

    // overall progress across the pieces and the form itself
    const grand = size + pieced.reduce((n, p) => n + p.file.size, 0);
    let sent = 0;
    const progress = (n) => ui.set('Uploading…', (sent + n) / grand, `${mb(sent + n)} of ${mb(grand)}`);
    try {
      for (const { field, file } of pieced) {
        data.append('_chunked', await sendInPieces(field, file, progress));
        sent += file.size;
      }
    } catch (err) {
      ui.fail(err.message);
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', form.action || location.href);
    xhr.setRequestHeader('X-Requested-With', 'upload');
    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) progress((ev.loaded / ev.total) * size);
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
