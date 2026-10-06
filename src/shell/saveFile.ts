/** The part of the File System Access API that a save needs; the DOM typings do not carry it. */
interface SaveHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveHandle>;

/**
 * Saves bytes as a file the person names. Where there is a save dialog
 * (`showSaveFilePicker`) it is used, so the person chooses the place; elsewhere
 * the browser downloads it. Cancelling the dialog is not an error: "cancelled".
 */
export async function saveFile(
  bytes: Uint8Array,
  filename: string,
  extension = ".hymnal",
): Promise<"saved" | "cancelled"> {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const pick = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof pick === "function") {
    let handle: SaveHandle;
    try {
      handle = await pick.call(window, {
        suggestedName: filename,
        types: [
          { description: "Hymnal backup", accept: { "application/octet-stream": [extension] } },
        ],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // The browser has the file once the click is handled; the URL is let go after.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
