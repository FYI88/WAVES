import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Native export bridge.
 *
 * On Android a WebView ignores `<a download>`, so generated files are written
 * to the app cache and handed to the system share sheet. On the web the
 * helpers return false and the caller keeps the anchor-download path.
 */

const isNative = () => Capacitor.isNativePlatform();

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "-");

async function writeAndShare(filename: string, data: string, encoding?: Encoding): Promise<void> {
  const path = `exports/${safeName(filename)}`;
  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
    recursive: true,
    ...(encoding ? { encoding } : {}),
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  await Share.share({ title: filename, files: [uri], dialogTitle: filename });
}

/** Share a PNG data URL through the native share sheet. Returns false on web. */
export async function shareDataUrl(dataUrl: string, filename: string): Promise<boolean> {
  if (!isNative()) return false;
  const comma = dataUrl.indexOf(",");
  await writeAndShare(filename, comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  return true;
}

/** Share a UTF-8 text file (CSV) through the native share sheet. Returns false on web. */
export async function shareText(text: string, filename: string): Promise<boolean> {
  if (!isNative()) return false;
  await writeAndShare(filename, text, Encoding.UTF8);
  return true;
}
