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
  TextEditingController githubTokenController = TextEditingController();
  TextEditingController cloudflareTokenController = TextEditingController();
  TextEditingController maxTokensController = TextEditingController();
  TextEditingController aiForumUsernameController = TextEditingController();
  String appVersion = '';
  String buildNumber = '';

  bool isOpenAiConnected = false;
  bool isGithubConnected = false;
  bool isCloudflareConnected = false;

  @override
  void initState() {
    super.initState();
    if (Globals.freeOpenAiApiKey != Globals.appSettings.openAiApiKey) {
      apiKeyController.text = Globals.appSettings.openAiApiKey ?? '';
    }
    githubTokenController.text = Globals.appSettings.githubToken ?? '';
    cloudflareTokenController.text = Globals.appSettings.cloudflareToken ?? '';
    maxTokensController.text = Globals.appSettings.maxTokensCount.toString();
    aiForumUsernameController.text = Globals.appSettings.aiForumUsername ?? '';

    isOpenAiConnected = (Globals.appSettings.openAiApiKey != null &&
        Globals.appSettings.openAiApiKey!.isNotEmpty);
    isGithubConnected = (Globals.appSettings.githubToken != null &&
        Globals.appSettings.githubToken!.isNotEmpty);
    isCloudflareConnected = (Globals.appSettings.cloudflareToken != null &&
        Globals.appSettings.cloudflareToken!.isNotEmpty);

    PackageInfo.fromPlatform().then((PackageInfo packageInfo) {
      setState(() {
        appVersion = packageInfo.version;
        buildNumber = packageInfo.buildNumber;
      });
    });
    logEvent(EventNames.settingsScreenViewed, {});
  }

  void _saveAll() {
    int maxTokensCount = int.tryParse(maxTokensController.text) ?? 1500;
    AppSettings updated = AppSettings(
      maxTokensCount: maxTokensCount,
      openAiApiKey: apiKeyController.text.trim().isEmpty
          ? null
          : apiKeyController.text.trim(),
      aiForumUsername: aiForumUsernameController.text,
      githubToken: githubTokenController.text.trim().isEmpty
          ? null
          : githubTokenController.text.trim(),
      cloudflareToken: cloudflareTokenController.text.trim().isEmpty
          ? null
          : cloudflareTokenController.text.trim(),
    );
    Globals.appSettings = updated;
    saveAppSettingsToSharedPres(updated);

    setState(() {
      isOpenAiConnected = updated.openAiApiKey != null && updated.openAiApiKey!.isNotEmpty;
      isGithubConnected = updated.githubToken != null && updated.githubToken!.isNotEmpty;
      isCloudflareConnected =
          updated.cloudflareToken != null && updated.cloudflareToken!.isNotEmpty;
    });
  }

  void onConnectOpenAi() {
    if (apiKeyController.text.trim().isEmpty) {
      showSnackBar(context, message: 'Paste OpenAI API Key dulu');
      return;
    }
    logEvent(EventNames.updateSettingsClicked, {});
    _saveAll();
    showSnackBar(context, message: '✅ OpenAI Connected!');
  }

  void onDisconnectOpenAi() {
    apiKeyController.clear();
    _saveAll();
    showSnackBar(context, message: 'OpenAI Disconnected');
  }

  void onConnectGithub() {
    if (githubTokenController.text.trim().isEmpty) {
      showSnackBar(context, message: 'Paste GitHub Token dulu');
      return;
    }
    _saveAll();
    showSnackBar(context, message: '✅ GitHub Connected!');
  }

  void onDisconnectGithub() {
    githubTokenController.clear();
    _saveAll();
    showSnackBar(context, message: 'GitHub Disconnected');
  }

  void onConnectCloudflare() {
    if (cloudflareTokenController.text.trim().isEmpty) {
      showSnackBar(context, message: 'Paste Cloudflare Token dulu');
      return;
    }
    _saveAll();
    showSnackBar(context, message: '✅ Cloudflare Connected!');
  }

  void onDisconnectCloudflare() {
    cloudflareTokenController.clear();
    _saveAll();
    showSnackBar(context, message: 'Cloudflare Disconnected');
  }

  void onKnowledgeCenterPress() {
    logEvent(EventNames.faqsClicked, {});
    navigateToScreen(context, FaqsScreen.routeName);
  }

  void onRateThisAppPress() async {
    logEvent(EventNames.rateAppClicked, {});
    onRatePocketAiPressed();
  }

  Widget _buildConnectorCard({
    required String title,
    required String description,
    required TextEditingController controller,
    required String hint,
    required bool isConnected,
    required VoidCallback onConnect,
    required VoidCallback onDisconnect,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
            color: isConnected ? Colors.green.withOpacity(0.6) : Colors.white24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isConnected ? Icons.check_circle : Icons.link_off,
                color: isConnected ? Colors.green : Colors.grey,
                size: 22,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: CustomText(
                  isConnected ? '$title — Connected' : '$title — Not Connected',
                  style: TextStyle(
                      color: isConnected ? Colors.green : Colors.white,
                      fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          CustomText(
            description,
            style: const TextStyle(color: CustomColors.lightText, fontSize: 12),
          ),
          const SizedBox(height: 12),
          CustomTextFormField(
            controller: controller,
            onChanged: (value) => {},
            hintText: hint,
            obscureText: true,
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 42,
                  child: CustomElevatedButton(
                    onPressed: onConnect,
                    text: isConnected ? 'Update' : 'Connect',
                  ),
                ),
              ),
              if (isConnected) ...[
                const SizedBox(width: 10),
                SizedBox(
                  height: 42,
                  child: OutlinedButton(
                    onPressed: onDisconnect,
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
    );
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
              const CustomText(
                'System Connectors',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              const CustomText(
                'Paste token → tekan Connect',
                style: TextStyle(color: CustomColors.lightText, fontSize: 12),
              ),
              const SizedBox(height: 16),

              // OpenAI
              _buildConnectorCard(
                title: 'OpenAI',
                description: 'API Key untuk chat & generate content (wajib)',
                controller: apiKeyController,
                hint: 'sk-... (paste OpenAI API Key)',
                isConnected: isOpenAiConnected,
                onConnect: onConnectOpenAi,
                onDisconnect: onDisconnectOpenAi,
              ),

              // GitHub
              _buildConnectorCard(
                title: 'GitHub',
                description: 'Personal Access Token untuk repo & automation',
                controller: githubTokenController,
                hint: 'ghp_... atau github_pat_... (paste token)',
                isConnected: isGithubConnected,
                onConnect: onConnectGithub,
                onDisconnect: onDisconnectGithub,
              ),

              // Cloudflare
              _buildConnectorCard(
                title: 'Cloudflare',
                description: 'API Token untuk tunnel / cloudflared',
                controller: cloudflareTokenController,
                hint: 'Paste Cloudflare API Token',
                isConnected: isCloudflareConnected,
                onConnect: onConnectCloudflare,
                onDisconnect: onDisconnectCloudflare,
              ),

              const SizedBox(height: 20),
              const Divider(color: Colors.white24),
              const SizedBox(height: 12),

              // Other settings
              const CustomText(
                'Max Tokens',
                style: TextStyle(color: Colors.white),
              ),
              Container(
                margin: const EdgeInsets.only(top: 4),
                child: const CustomText(
                  'Higher value = longer responses (uses more credits)',
                  style: TextStyle(color: CustomColors.lightText, fontSize: 11),
                ),
              ),
              Container(
                margin: const EdgeInsets.only(top: 12, bottom: 24),
                child: CustomTextFormField(
                  controller: maxTokensController,
                  onChanged: (value) => {},
                  hintText: '1500',
                  textInputType: TextInputType.number,
                ),
              ),
              const CustomText(
                'AI forum username',
                style: TextStyle(color: Colors.white),
              ),
              Container(
                margin: const EdgeInsets.only(top: 4),
                child: const CustomText(
                  'This name will be visible in your messages sent to Forum',
                  style: TextStyle(color: CustomColors.lightText, fontSize: 11),
                ),
              ),
              Container(
                margin: const EdgeInsets.only(top: 12, bottom: 24),
                child: CustomTextFormField(
                  controller: aiForumUsernameController,
                  onChanged: (value) => {},
                  hintText: '- Box AI',
                ),
              ),

              // Save other settings too when changing max tokens / username
              SizedBox(
                width: double.infinity,
                height: 42,
                child: CustomElevatedButton(
                  onPressed: () {
                    _saveAll();
                    showSnackBar(context, message: 'Settings saved');
                  },
                  text: 'Save Other Settings',
                ),
              ),

              const SizedBox(height: 28),
              LinkText(text: 'Knowledge Center & FAQs', onPress: onKnowledgeCenterPress),
              Container(
                margin: const EdgeInsets.only(top: 12),
                child: LinkText(text: 'Rate this app', onPress: onRateThisAppPress),
              ),
              Container(
                margin: const EdgeInsets.only(top: 24),
                child: Center(
                  child: CustomText(
                    'Build v$appVersion - $buildNumber',
                    size: CustomTextSize.small,
                    style: const TextStyle(color: CustomColors.lightText),
                  ),
                ),
              ),
              Container(
                margin: const EdgeInsets.only(top: 8),
                child: const Center(
                  child: CustomText(
                    'Box AI • System Connector',
                    size: CustomTextSize.small,
                    style: TextStyle(color: CustomColors.lightText),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
