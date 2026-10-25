export type ConnectorMode =
  | 'github'
  | 'cloudflared'
  | 'r2'
  | 'huggingface'
  | 'local'
  | 'direct';

export type RemoteModel = {
  name: string;
  url: string;
  size: number;
  sha256?: string;
  source: ConnectorMode;
};
