// Shared types for Multi-Platform Simultaneous Social Posting & Scheduling
// Supports standard social networks + unlimited custom API key providers & webhooks

export type SocialPlatformKey = string;

export type PlatformApiGuide = {
  portalName: string;
  portalUrl: string;
  steps: string[];
  requiredScopes?: string[];
  tip?: string;
};

export type PlatformConfigItem = {
  key: string;
  label: string;
  charLimit: number;
  color: string;
  icon: string;
  docsHint: string;
  guide?: PlatformApiGuide;
};

export const POPULAR_PRESETS: Record<string, PlatformConfigItem> = {
  x: {
    key: "x",
    label: "X (Twitter)",
    charLimit: 280,
    color: "bg-neutral-900 text-white dark:bg-white dark:text-black",
    icon: "𝕏",
    docsHint: "Max 280 chars. Media supported.",
    guide: {
      portalName: "X Developer Portal",
      portalUrl: "https://developer.x.com/en/portal/dashboard",
      steps: [
        "Open the X Developer Portal (developer.x.com) and create or select a Project & App.",
        "Under App Settings → 'User authentication settings', set App permissions to 'Read and Write'.",
        "Under 'Keys and tokens', generate your Consumer Keys (API Key & Secret) and OAuth 1.0a User Tokens (Access Token & Secret).",
        "Enter these credentials into the dedicated X (Twitter) section below or connect via OAuth 2.0 User Token.",
      ],
      requiredScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
      tip: "Set permissions to 'Read and Write' BEFORE generating Access Tokens.",
    },
  },
  linkedin: {
    key: "linkedin",
    label: "LinkedIn",
    charLimit: 3000,
    color: "bg-[#0A66C2] text-white",
    icon: "💼",
    docsHint: "Max 3,000 chars. Rich links and documents supported.",
    guide: {
      portalName: "LinkedIn Developer Portal",
      portalUrl: "https://www.linkedin.com/developers/apps",
      steps: [
        "Go to the LinkedIn Developer Portal (linkedin.com/developers) and click 'Create App'.",
        "Enter your app name and link your official LinkedIn Company Page or profile.",
        "Under 'Products', request access to 'Share on LinkedIn' and 'Sign In with LinkedIn using OpenID Connect'.",
        "Under 'Auth' → 'OAuth 2.0 tools', generate a User Access Token with the required scopes.",
        "Copy your generated Access Token and paste it into Pippzo.",
      ],
      requiredScopes: ["w_member_social", "openid", "profile"],
      tip: "Or connect via Buffer below with zero developer setup.",
    },
  },
  facebook: {
    key: "facebook",
    label: "Facebook",
    charLimit: 63206,
    color: "bg-[#1877F2] text-white",
    icon: "📘",
    docsHint: "Max 63,206 chars. Text and media supported.",
    guide: {
      portalName: "Meta for Developers (Graph API Explorer)",
      portalUrl: "https://developers.facebook.com/tools/explorer",
      steps: [
        "Open Meta for Developers (developers.facebook.com) and create an App (Business type).",
        "Open Graph API Explorer, select your App, then in 'User or Page' dropdown select your Page.",
        "Add permissions 'pages_manage_posts' and 'pages_read_engagement', then click 'Generate Access Token'.",
        "Copy the generated Page Access Token and paste it into Pippzo.",
      ],
      requiredScopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
      tip: "Always use a Page Access Token so posts publish as your Page.",
    },
  },
  instagram: {
    key: "instagram",
    label: "Instagram",
    charLimit: 2200,
    color: "bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 text-white",
    icon: "📸",
    docsHint: "Max 2,200 chars. Media (image or video) required.",
    guide: {
      portalName: "Meta Instagram Graph API",
      portalUrl: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api",
      steps: [
        "Switch your Instagram account to a Professional / Business account.",
        "Link your Instagram Professional account to a Facebook Page in Instagram Settings.",
        "In Meta Graph API Explorer, request 'instagram_basic', 'instagram_content_publish', and 'pages_show_list'.",
        "Select the connected account token and paste it into Pippzo.",
      ],
      requiredScopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
      tip: "Instagram publishing requires an attached image or video.",
    },
  },
  threads: {
    key: "threads",
    label: "Threads",
    charLimit: 500,
    color: "bg-black text-white",
    icon: "🧵",
    docsHint: "Max 500 chars. Text, links, and media supported.",
    guide: {
      portalName: "Meta Threads API",
      portalUrl: "https://developers.facebook.com/docs/threads",
      steps: [
        "Create an App in Meta for Developers with Threads Use Case.",
        "Add the Threads API product to your App.",
        "Generate a User Access Token with 'threads_basic' and 'threads_content_publish' permissions.",
        "Paste your Threads User Token here.",
      ],
      requiredScopes: ["threads_basic", "threads_content_publish"],
    },
  },
  bluesky: {
    key: "bluesky",
    label: "Bluesky",
    charLimit: 300,
    color: "bg-[#0085FF] text-white",
    icon: "🦋",
    docsHint: "Max 300 chars. Native AT Protocol posts.",
    guide: {
      portalName: "Bluesky App Passwords",
      portalUrl: "https://bsky.app/settings/app-passwords",
      steps: [
        "Sign in to your Bluesky account at bsky.app.",
        "Go to Settings → Privacy & Security → App Passwords.",
        "Click 'Add App Password', name it 'Pippzo Publisher', and click Create.",
        "Enter your handle (e.g. handle.bsky.social) in Label and paste the App Password into API Key.",
      ],
      tip: "Use an App Password instead of your main account password.",
    },
  },
  tiktok: {
    key: "tiktok",
    label: "TikTok",
    charLimit: 2200,
    color: "bg-neutral-900 text-white",
    icon: "🎵",
    docsHint: "Max 2,200 chars. Video required.",
    guide: {
      portalName: "TikTok for Developers",
      portalUrl: "https://developers.tiktok.com",
      steps: [
        "Register a developer account on developers.tiktok.com.",
        "Create an App and apply for Content Posting API permissions ('video.publish', 'video.upload').",
        "Generate an Access Token through your app's OAuth authorization flow.",
        "Paste the Access Token into Pippzo.",
      ],
      requiredScopes: ["video.publish", "video.upload"],
    },
  },
  telegram: {
    key: "telegram",
    label: "Telegram Channel / Bot",
    charLimit: 4096,
    color: "bg-[#229ED9] text-white",
    icon: "✈️",
    docsHint: "Max 4,096 chars. Instant message broadcast.",
    guide: {
      portalName: "Telegram BotFather",
      portalUrl: "https://t.me/BotFather",
      steps: [
        "Open Telegram and search for @BotFather (or open t.me/BotFather).",
        "Send /newbot and follow instructions to get your HTTP API Bot Token.",
        "Add your bot as an Administrator with 'Post Messages' rights to your Telegram Channel.",
        "Paste the Bot Token in API Key and your channel username (e.g. @mychannel) in the Base URL / Channel field.",
      ],
      tip: "Format: Bot Token in Key, Channel @handle or Chat ID in Endpoint/URL.",
    },
  },
  discord: {
    key: "discord",
    label: "Discord Webhook",
    charLimit: 2000,
    color: "bg-[#5865F2] text-white",
    icon: "💬",
    docsHint: "Max 2,000 chars. Posts to your server channel.",
    guide: {
      portalName: "Discord Server Channel Settings",
      portalUrl: "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
      steps: [
        "In your Discord server, right click your target channel → Edit Channel.",
        "Click Integrations → Webhooks → New Webhook.",
        "Name the webhook (e.g. Pippzo Publisher) and click 'Copy Webhook URL'.",
        "Paste the full Discord Webhook URL into the API Key / URL field.",
      ],
      tip: "Discord webhooks execute instantly with rich embeds and images.",
    },
  },
  custom_webhook: {
    key: "custom_webhook",
    label: "Custom API / Webhook",
    charLimit: 10000,
    color: "bg-neutral-700 text-white",
    icon: "🌐",
    docsHint: "Custom HTTP POST endpoint with your payload.",
    guide: {
      portalName: "Your Custom Endpoint",
      portalUrl: "#",
      steps: [
        "Set the Base URL to your HTTP/HTTPS endpoint or webhook receiver.",
        "Enter any required Authorization token or API Key.",
        "When publishing, Pippzo will send an HTTP POST request with JSON payload: { text, imageUrl, videoUrl, platform }.",
      ],
      tip: "Works with Zapier, Make.com, n8n, internal microservices, and custom APIs.",
    },
  },
};

export const SOCIAL_PLATFORM_CONFIG = POPULAR_PRESETS;

export type CustomProviderInput = {
  workspaceId: string;
  key: string;
  label: string;
  apiKey: string;
  baseUrl?: string;
  charLimit?: number;
  icon?: string;
};

export type SocialAccountInfo = {
  platform: string;
  label: string;
  connected: boolean;
  username?: string;
  name?: string;
  profileImageUrl?: string;
  source: "direct" | "buffer" | "custom" | "none";
  channelId?: string;
  charLimit: number;
  baseUrl?: string;
  icon?: string;
  isCustom?: boolean;
  error?: string;
};

export type SocialStatusMap = Record<string, SocialAccountInfo>;

export type PublishPlatformResult = {
  platform: string;
  ok: boolean;
  postId?: string;
  url?: string;
  error?: string;
};

export type MultiPlatformPublishResult = {
  overallOk: boolean;
  publishedCount: number;
  failedCount: number;
  results: PublishPlatformResult[];
};
