import {pick, types, keepLocalCopy} from '@react-native-documents/picker';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {ingestText} from '../rag';

export type PickedDoc = {
  name: string;
  path: string;
  ingested: boolean;
  preview: string;
};

/**
 * Pick a document and ingest text into local RAG when possible.
 */
export async function pickAndIngestDocument(): Promise<PickedDoc | null> {
  const results = await pick({
    type: [types.plainText, types.csv, types.json, types.pdf],
    allowMultiSelection: false,
  });
  const file = results?.[0];
  if (!file) return null;

  const name = file.name || 'document';
  let path = file.uri;
  try {
    const copies = await keepLocalCopy({
      files: [{uri: file.uri, fileName: name}],
      destination: 'documentDirectory',
    });
    const local = copies?.[0];
    if (local && 'sourceUri' in local === false && (local as any).localUri) {
      path = (local as any).localUri;
    } else if (local && (local as any).status === 'success') {
      path = (local as any).localUri || path;
    }
  } catch {
    // keep original uri
  }

  const lower = name.toLowerCase();
  let text = '';
  let ingested = false;
  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.log')
  ) {
    try {
      text = await RNFS.readFile(path.replace(/^file:\/\//, ''), 'utf8');
      ingestText(path, name, text);
      ingested = true;
    } catch {
      /* ignore */
    }
  }

  return {
    name,
    path,
    ingested,
    preview: text.slice(0, 400),
  };
}
