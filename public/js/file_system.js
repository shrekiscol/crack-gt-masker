// I/O helpers: talk to the Flask backend (app.py).

const enc = encodeURIComponent;

async function json(res) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

export const imageUrl = (dataset, name) => `/datasets/${enc(dataset)}/images/${enc(name)}`;
export const labelUrl = (dataset, name) => `/datasets/${enc(dataset)}/labels/${enc(name)}`;

/** @returns {Promise<{name: string, labeled: boolean}[]>} */
export async function listImages(dataset) {
  return json(await fetch(`/datasets/${enc(dataset)}/images`));
}

export async function uploadImages(dataset, files) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  return json(await fetch(`/datasets/${enc(dataset)}/images`, { method: 'POST', body: form }));
}

export async function saveLabel(dataset, imageName, maskDataUrl) {
  return json(await fetch(labelUrl(dataset, imageName), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: maskDataUrl }),
  }));
}

/** Load an image element from a URL; resolves null on 404. */
export function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();   // bypass cache after saves
  });
}
