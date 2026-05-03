import { Platform, Alert, Share } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import { API_URL } from '../services/api';
import { useAuthStore } from '../store/authStore';

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

// Download an auth-protected PDF (path is relative to API_URL, e.g.
// `/accounting/payments/<id>/receipt.pdf`) and hand it off to the system
// viewer / share sheet so the parent can save it.
export async function downloadAuthPdf(apiPath: string, filename: string): Promise<void> {
  const token = useAuthStore.getState().token;
  if (!token) { Alert.alert('Download failed', 'Please sign in again.'); return; }
  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  const url = `${API_URL}${apiPath}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/pdf' };

  try {
    const target = `${RNBlobUtil.fs.dirs.DocumentDir}/${safeName}`;
    const res = await RNBlobUtil.config({ path: target, fileCache: true })
      .fetch('GET', url, headers);
    const status = res.info().status;
    if (status >= 400) { Alert.alert('Download failed', 'The server rejected the request.'); return; }
    if (Platform.OS === 'android') {
      try {
        await RNBlobUtil.android.actionViewIntent(res.path(), 'application/pdf');
      } catch {
        await Share.share({ url: 'file://' + res.path() });
      }
    } else {
      await Share.share({ url: res.path() });
    }
  } catch {
    Alert.alert('Download failed', 'Could not download the file.');
  }
}
