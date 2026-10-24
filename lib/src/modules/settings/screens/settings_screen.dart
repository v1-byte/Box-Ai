import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:box_ai/src/globals.dart';
import 'package:box_ai/src/modules/faqs/screens/faqs_screen.dart';
import 'package:box_ai/src/modules/settings/models/app_settings.dart';
import 'package:box_ai/src/utils/analytics.dart';
import 'package:box_ai/src/utils/common.dart';
import 'package:box_ai/src/widgets/custom_colors.dart';
import 'package:box_ai/src/widgets/custom_elevated_button.dart';
import 'package:box_ai/src/widgets/custom_text.dart';
import 'package:box_ai/src/widgets/custom_text_form_field.dart';
import 'package:box_ai/src/widgets/heading.dart';
import 'package:box_ai/src/widgets/link_text.dart';
import 'package:box_ai/src/widgets/scroll_view_with_height.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({Key? key}) : super(key: key);

  static const routeName = '/settings';

  @override
  State<StatefulWidget> createState() => _SettingsScreen();
}

class _SettingsScreen extends State<SettingsScreen> {
  TextEditingController apiKeyController = TextEditingController();
  TextEditingController maxTokensController = TextEditingController();
  TextEditingController aiForumUsernameController = TextEditingController();
  String appVersion = '';
  String buildNumber = '';
  bool isConnected = false;

  @override
  void initState() {
    super.initState();
    // check for free api key
    if (Globals.freeOpenAiApiKey != Globals.appSettings.openAiApiKey) {
      apiKeyController.text = Globals.appSettings.openAiApiKey ?? '';
    }
    maxTokensController.text = Globals.appSettings.maxTokensCount.toString();
    aiForumUsernameController.text = Globals.appSettings.aiForumUsername ?? '';
    isConnected = (Globals.appSettings.openAiApiKey != null &&
        Globals.appSettings.openAiApiKey!.isNotEmpty);
    PackageInfo.fromPlatform().then((PackageInfo packageInfo) {
      setState(() {
        appVersion = packageInfo.version;
        buildNumber = packageInfo.buildNumber;
      });
    });
    logEvent(EventNames.settingsScreenViewed, {});
  }

  void onConnectPressed() async {
    String openAiApiKey = apiKeyController.text.trim();
    if (openAiApiKey.isEmpty) {
      showSnackBar(context, message: 'Please paste your API key first');
      return;
    }
    logEvent(EventNames.updateSettingsClicked, {});
    int maxTokensCount = int.tryParse(maxTokensController.text) ?? 1500;
    String aiForumUsername = aiForumUsernameController.text;
    AppSettings updatedAppSettings = AppSettings(
        maxTokensCount: maxTokensCount,
        openAiApiKey: openAiApiKey,
        aiForumUsername: aiForumUsername);
    Globals.appSettings = updatedAppSettings;

    saveAppSettingsToSharedPres(updatedAppSettings);
    setState(() {
      isConnected = true;
    });
    showSnackBar(context, message: '✅ Connected successfully!');
  }

  void onDisconnectPressed() async {
    AppSettings updatedAppSettings = AppSettings(
        maxTokensCount: Globals.appSettings.maxTokensCount,
        openAiApiKey: null,
        aiForumUsername: Globals.appSettings.aiForumUsername);
    Globals.appSettings = updatedAppSettings;
    saveAppSettingsToSharedPres(updatedAppSettings);
    apiKeyController.clear();
    setState(() {
      isConnected = false;
    });
    showSnackBar(context, message: 'Disconnected');
  }

  void onKnowledgeCenterPress() {
    logEvent(EventNames.faqsClicked, {});
    navigateToScreen(context, FaqsScreen.routeName);
  }

  void onRateThisAppPress() async {
    logEvent(EventNames.rateAppClicked, {});
    onRatePocketAiPressed();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Heading(
          'Settings & Connectors',
          type: HeadingType.h4,
        ),
        backgroundColor: CustomColors.darkBackground,
      ),
      body: ScrollViewWithHeight(
          child: Container(
              padding: const EdgeInsets.all(16),
              color: CustomColors.darkBackground,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ===== CONNECTOR SECTION =====
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: isConnected
                              ? Colors.green.withOpacity(0.6)
                              : Colors.white24),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              isConnected
                                  ? Icons.check_circle
                                  : Icons.link_off,
                              color: isConnected ? Colors.green : Colors.grey,
                              size: 22,
                            ),
                            const SizedBox(width: 8),
                            CustomText(
                              isConnected
                                  ? 'OpenAI Connector — Connected'
                                  : 'OpenAI Connector — Not Connected',
                              style: TextStyle(
                                  color: isConnected
                                      ? Colors.green
                                      : Colors.white,
                                  fontWeight: FontWeight.w600),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        const CustomText(
                          'Paste your OpenAI API Key below then press Connect',
                          style: TextStyle(
                              color: CustomColors.lightText, fontSize: 12),
                        ),
                        const SizedBox(height: 12),
                        CustomTextFormField(
                            controller: apiKeyController,
                            onChanged: (value) => {},
                            hintText: 'sk-... (paste token here)',
                            obscureText: true,
                            ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: SizedBox(
                                height: 44,
                                child: CustomElevatedButton(
                                    onPressed: onConnectPressed,
                                    text: isConnected
                                        ? 'Update Connection'
                                        : 'Connect'),
                              ),
                            ),
                            if (isConnected) ...[
                              const SizedBox(width: 12),
                              SizedBox(
                                height: 44,
                                child: OutlinedButton(
                                  onPressed: onDisconnectPressed,
                                  style: OutlinedButton.styleFrom(
                                    side: const BorderSide(color: Colors.red),
                                    foregroundColor: Colors.red,
                                  ),
                                  child: const Text('Disconnect'),
                                ),
                              ),
                            ]
                          ],
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 28),

                  // ===== OTHER SETTINGS =====
                  const CustomText(
                    'Max Tokens',
                    style: TextStyle(color: Colors.white),
                  ),
                  Container(
                      margin: const EdgeInsets.only(top: 4),
                      child: const CustomText(
                        'Higher value = longer responses (uses more credits)',
                        style: TextStyle(
                            color: CustomColors.lightText, fontSize: 11),
                      )),
                  Container(
                    margin: const EdgeInsets.only(top: 12, bottom: 24),
                    child: CustomTextFormField(
                        controller: maxTokensController,
                        onChanged: (value) => {},
                        hintText: '1500',
                        textInputType: TextInputType.number),
                  ),
                  const CustomText(
                    'AI forum username',
                    style: TextStyle(color: Colors.white),
                  ),
                  Container(
                      margin: const EdgeInsets.only(top: 4),
                      child: const CustomText(
                        'This name will be visible in your messages sent to Forum',
                        style: TextStyle(
                            color: CustomColors.lightText, fontSize: 11),
                      )),
                  Container(
                    margin: const EdgeInsets.only(top: 12, bottom: 24),
                    child: CustomTextFormField(
                        controller: aiForumUsernameController,
                        onChanged: (value) => {},
                        hintText: '- Box AI'),
                  ),
                  Container(
                      margin: const EdgeInsets.only(top: 12),
                      child: LinkText(
                          text: 'Knowledge Center & FAQs',
                          onPress: onKnowledgeCenterPress)),
                  Container(
                      margin: const EdgeInsets.only(top: 12),
                      child: LinkText(
                          text: 'Rate this app', onPress: onRateThisAppPress)),
                  Container(
                      margin: const EdgeInsets.only(top: 24),
                      child: Center(
                          child: CustomText(
                        'Build v$appVersion - $buildNumber',
                        size: CustomTextSize.small,
                        style: const TextStyle(color: CustomColors.lightText),
                      ))),
                  Container(
                      margin: const EdgeInsets.only(top: 8),
                      child: const Center(
                          child: CustomText(
                        'Box AI • Made with ❤️',
                        size: CustomTextSize.small,
                        style: TextStyle(color: CustomColors.lightText),
                      )))
                ],
              ))),
    );
  }
}
