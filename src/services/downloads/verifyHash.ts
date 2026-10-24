/**
 * SHA256 verify helper for model downloads (corrupt detection).
 * Uses react-native-fs hash API when available.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';

export async function sha256File(path: string): Promise<string | null> {
  try {
    // hash API varies by RNFS fork; try common signatures
    const anyFs = RNFS as any;
    if (typeof anyFs.hash === 'function') {
      return await anyFs.hash(path, 'sha256');
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifySha256(
  path: string,
  expectedHex: string,
): Promise<{ok: boolean; actual: string | null}> {
  const actual = await sha256File(path);
  if (!actual) return {ok: false, actual: null};
  return {
    ok: actual.toLowerCase() === expectedHex.toLowerCase(),
    actual,
  };
}
