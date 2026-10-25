// Create a singleton instance
import {DownloadManager} from './DownloadManager';

export * from './types';
export * from './DownloadManager';
export * from './externalModelScanner';

export const downloadManager = new DownloadManager();
