export async function loadImages(container, references, documentPath, readImage, isCurrent, onChange) {
  // Load in document order to keep memory use bounded and layout changes predictable.
  for (const reference of references) {
    if (!isCurrent()) return;
    const slot = container.querySelector(`[data-image-id="${reference.id}"]`);
    if (!slot) continue;
    try {
      const result = await readImage(documentPath, reference);
      if (!isCurrent()) return;
      if (result.error) throw new Error(result.error);
      if (!/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/.test(result.dataUrl)) throw new Error('Invalid image data.');
      const image = new Image();
      image.alt = reference.label.replace(/^.*\//, '');
      image.title = reference.label;
      image.decoding = 'async';
      image.src = result.dataUrl;
      await image.decode();
      if (!isCurrent()) return;
      slot.replaceChildren(image);
      slot.dataset.loaded = 'true';
    } catch (error) {
      if (!isCurrent()) return;
      slot.firstElementChild.textContent = `${reference.label}: ${error.message || 'Image could not be displayed.'}`;
      slot.dataset.loaded = 'false';
    }
    onChange();
  }
}
