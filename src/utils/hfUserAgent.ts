import DeviceInfo from 'react-native-device-info';

/**
 * User-Agent for outbound Hugging Face requests (API + model downloads).
 * The `(com.v1byte.boxai)` token is a fixed attribution key on both platforms.
 */
export const hfUserAgent = (): string =>
  `Box AI/${DeviceInfo.getVersion()} (com.v1byte.boxai)`;
