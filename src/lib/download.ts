/**
 * Save a generated image to the user's disk.
 *
 * `<a download>` alone is not enough: the attribute is ignored cross-origin, and the image
 * arrives from /api/images/:id with no filename of its own, so the bytes are fetched into
 * a blob and handed to a temporary object URL instead. Same-origin in both dev and prod
 * (the frontend rewrites /api/* to the API project), so the fetch needs no CORS handling.
 */

export async function downloadImage(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch the image (${response.status}).`);
  const blob = await response.blob();

  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${filename}.${extensionFor(blob.type)}`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Revoked on the next tick rather than immediately: Safari cancels a download whose
    // object URL disappears in the same task as the click.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function extensionFor(mimeType: string): string {
  const subtype = mimeType.split(";")[0]?.split("/")[1] ?? "png";
  return subtype === "jpeg" ? "jpg" : subtype;
}
