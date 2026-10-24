class AppSettings {
  int maxTokensCount;
  String? openAiApiKey;
  String? aiForumUsername;
  String? githubToken;
  String? cloudflareToken;

  AppSettings({
    required this.maxTokensCount,
    required this.openAiApiKey,
    required this.aiForumUsername,
    this.githubToken,
    this.cloudflareToken,
  });
}
