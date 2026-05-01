import { Platform, Alert, Share } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';

function getMimeType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function getFilename(url: string): string {
  try {
    const path = url.split('?')[0];
    const last = path.split('/').pop();
    if (last) return decodeURIComponent(last);
  } catch {}
  return `attachment_${Date.now()}`;
}

export async function downloadAttachment(url: string): Promise<void> {
  const filename = getFilename(url);
  const mime = getMimeType(url);

  if (Platform.OS === 'android') {
    try {
      await RNBlobUtil.config({
        addAndroidDownloads: {
          useDownloadManager: true,
          notification: true,
          title: filename,
          description: 'Downloading attachment',
          mime,
          mediaScannable: true,
          path: `${RNBlobUtil.fs.dirs.DownloadDir}/${filename}`,
        },
      }).fetch('GET', url);
      Alert.alert('Download started', `Saving "${filename}" to your Downloads folder.`);
    } catch {
      Alert.alert('Download failed', 'Could not download the file.');
    }
    return;
  }

  // iOS: download to a cached path then present the share sheet so the user
  // can save to Photos / Files in one tap.
  try {
    const path = `${RNBlobUtil.fs.dirs.DocumentDir}/${filename}`;
    const res = await RNBlobUtil.config({ path, fileCache: true }).fetch('GET', url);
    await Share.share({ url: res.path() });
  } catch {
    Alert.alert('Download failed', 'Could not download the file.');
  }
}
