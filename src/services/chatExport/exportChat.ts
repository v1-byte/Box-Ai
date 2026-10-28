import * as RNFS from '@dr.pogodin/react-native-fs';

export type ExportMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
};

export async function exportChatToTxt(
  title: string,
  messages: ExportMessage[],
): Promise<string> {
  const safe = title.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'chat';
  const path = `${RNFS.DocumentDirectoryPath}/boxai-${safe}-${Date.now()}.txt`;
  const body = messages
    .map(m => {
      const ts = m.createdAt ? `[${m.createdAt}] ` : '';
      return `${ts}${m.role.toUpperCase()}:\n${m.content}\n`;
    })
    .join('\n');
  const header = `Box AI Chat Export\n${title}\n${'='.repeat(40)}\n\n`;
  await RNFS.writeFile(path, header + body, 'utf8');
  return path;
}
