import type {DeepLinkParams} from '../../services/DeepLinkService';
import {ROUTES} from '../../utils/navigationConstants';
import {dispatchAutomationDeepLink} from '../deepLink';
import {PLUS_FEATURE_URL, isPlusFeatureUrl} from '../plusFeatureRoute';

const params = (url: string): DeepLinkParams => ({
  url,
  scheme: 'boxai',
  host: 'e2e',
});

describe('plus feature route', () => {
  it.each([PLUS_FEATURE_URL, `${PLUS_FEATURE_URL}?x=1`])('matches %s', url => {
    expect(isPlusFeatureUrl(url)).toBe(true);
  });

  it.each([
    null,
    undefined,
    'boxai://e2e/plus-featureX',
    'boxai://e2e/benchmark',
    'boxai://plus-feature',
  ])('rejects %p', url => {
    expect(isPlusFeatureUrl(url)).toBe(false);
  });

  it('navigates to the test feature from the iOS deep-link dispatcher', async () => {
    const navigate = jest.fn();

    const handled = await dispatchAutomationDeepLink(params(PLUS_FEATURE_URL), {
      navigate,
    });

    expect(handled).toBe(true);
    expect(navigate).toHaveBeenCalledWith(ROUTES.PLUS_TEST_FEATURE);
  });

  it('leaves other e2e URLs to their own handlers', async () => {
    const navigate = jest.fn();

    const handled = await dispatchAutomationDeepLink(
      params('boxai://e2e/unknown'),
      {navigate},
    );

    expect(handled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
