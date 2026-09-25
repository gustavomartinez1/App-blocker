import type { CategoryId, Platform } from './schema.js';

/**
 * Catálogo de servicios conocidos. Bloquear un "servicio" cubre su app móvil,
 * su app de escritorio y su sitio web a la vez: el admin elige "TikTok" y no
 * tiene que saber que el paquete de Android es com.zhiliaoapp.musically.
 *
 * Nota iOS: los bundle ids se incluyen como referencia, pero la API de Screen
 * Time de Apple sólo permite bloquear apps mediante la selección opaca que el
 * usuario hace en FamilyActivityPicker (ver apps/ios/README.md). Los dominios sí
 * se aplican directamente en iOS.
 */
export interface Service {
  id: string;
  name: string;
  category: CategoryId;
  apps: Partial<Record<Platform, string[]>>;
  domains: string[];
}

export interface Category {
  id: CategoryId;
  name: string;
  description: string;
  /** Dominios extra de la categoría que no pertenecen a un servicio concreto. */
  domains?: string[];
  keywords?: string[];
}

export const CATEGORIES: Record<CategoryId, Category> = {
  social: { id: 'social', name: 'Redes sociales', description: 'Instagram, TikTok, Facebook, X, Snapchat…' },
  messaging: { id: 'messaging', name: 'Mensajería', description: 'WhatsApp, Telegram, Messenger, Discord…' },
  video: { id: 'video', name: 'Video', description: 'YouTube, Twitch y similares' },
  streaming: { id: 'streaming', name: 'Series y música', description: 'Netflix, Disney+, Spotify…' },
  games: { id: 'games', name: 'Juegos', description: 'Roblox, Minecraft, Fortnite, Free Fire, Steam…' },
  adult: {
    id: 'adult',
    name: 'Contenido para adultos',
    description: 'Pornografía y contenido explícito. Se complementa con DNS familiar.',
    keywords: ['porn', 'xxx', 'hentai', 'nsfw'],
  },
  gambling: { id: 'gambling', name: 'Apuestas', description: 'Casinos y apuestas deportivas' },
  shopping: { id: 'shopping', name: 'Compras', description: 'Amazon, Mercado Libre, Shein, Temu…' },
  news: { id: 'news', name: 'Noticias', description: 'Portales de noticias' },
  dating: { id: 'dating', name: 'Citas', description: 'Tinder, Bumble, Grindr…' },
  ai: { id: 'ai', name: 'Chatbots de IA', description: 'ChatGPT, Gemini, Claude, Character.AI…' },
  browsers: { id: 'browsers', name: 'Navegadores alternativos', description: 'Útil para obligar a usar sólo el navegador supervisado' },
  bypass: {
    id: 'bypass',
    name: 'VPN, proxys y evasión',
    description: 'Herramientas que sirven para saltarse los bloqueos',
    // DNS sobre HTTPS: si el navegador usa DoH puede saltarse el filtro DNS.
    domains: ['dns.google', 'cloudflare-dns.com', 'mozilla.cloudflare-dns.com', 'dns.quad9.net', 'doh.opendns.com', 'dns.nextdns.io', 'doh.cleanbrowsing.org'],
    keywords: ['proxy', 'unblock'],
  },
  app_stores: { id: 'app_stores', name: 'Tiendas de apps', description: 'Play Store, App Store, Microsoft Store' },
};

export const SERVICES: Service[] = [
  // Redes sociales
  { id: 'instagram', name: 'Instagram', category: 'social', apps: { android: ['com.instagram.android', 'com.instagram.lite'], ios: ['com.burbn.instagram'] }, domains: ['instagram.com', 'cdninstagram.com', 'ig.me'] },
  { id: 'facebook', name: 'Facebook', category: 'social', apps: { android: ['com.facebook.katana', 'com.facebook.lite'], ios: ['com.facebook.Facebook'] }, domains: ['facebook.com', 'fb.com', 'fbcdn.net', 'fb.watch'] },
  { id: 'tiktok', name: 'TikTok', category: 'social', apps: { android: ['com.zhiliaoapp.musically', 'com.ss.android.ugc.trill', 'com.zhiliaoapp.musically.go'], ios: ['com.zhiliaoapp.musically'] }, domains: ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'musical.ly'] },
  { id: 'snapchat', name: 'Snapchat', category: 'social', apps: { android: ['com.snapchat.android'], ios: ['com.toyopagroup.picaboo'] }, domains: ['snapchat.com', 'sc-cdn.net'] },
  { id: 'x', name: 'X (Twitter)', category: 'social', apps: { android: ['com.twitter.android'], ios: ['com.atebits.Tweetie2'] }, domains: ['x.com', 'twitter.com', 't.co', 'twimg.com'] },
  { id: 'threads', name: 'Threads', category: 'social', apps: { android: ['com.instagram.barcelona'], ios: ['com.burbn.barcelona'] }, domains: ['threads.net', 'threads.com'] },
  { id: 'reddit', name: 'Reddit', category: 'social', apps: { android: ['com.reddit.frontpage'], ios: ['com.reddit.Reddit'] }, domains: ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com'] },
  { id: 'pinterest', name: 'Pinterest', category: 'social', apps: { android: ['com.pinterest'], ios: ['pinterest'] }, domains: ['pinterest.com', 'pinimg.com'] },
  { id: 'bereal', name: 'BeReal', category: 'social', apps: { android: ['com.bereal.ft'], ios: ['AlexisBarreyat.BeReal'] }, domains: ['bereal.com'] },
  { id: 'tumblr', name: 'Tumblr', category: 'social', apps: { android: ['com.tumblr'], ios: ['com.tumblr.tumblr'] }, domains: ['tumblr.com'] },

  // Mensajería
  { id: 'whatsapp', name: 'WhatsApp', category: 'messaging', apps: { android: ['com.whatsapp', 'com.whatsapp.w4b'], ios: ['net.whatsapp.WhatsApp'], windows: ['WhatsApp.exe'], macos: ['net.whatsapp.WhatsApp'] }, domains: ['whatsapp.com', 'whatsapp.net', 'wa.me'] },
  { id: 'telegram', name: 'Telegram', category: 'messaging', apps: { android: ['org.telegram.messenger', 'org.telegram.messenger.web', 'org.thunderdog.challegram'], ios: ['ph.telegra.Telegraph'], windows: ['Telegram.exe'], macos: ['ru.keepcoder.Telegram'], linux: ['telegram-desktop'] }, domains: ['telegram.org', 't.me', 'telegram.me'] },
  { id: 'messenger', name: 'Messenger', category: 'messaging', apps: { android: ['com.facebook.orca'], ios: ['com.facebook.Messenger'], windows: ['Messenger.exe'] }, domains: ['messenger.com'] },
  { id: 'discord', name: 'Discord', category: 'messaging', apps: { android: ['com.discord'], ios: ['com.hammerandchisel.discord'], windows: ['Discord.exe'], macos: ['com.hnc.Discord'], linux: ['discord', 'Discord'] }, domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net'] },

  // Video
  { id: 'youtube', name: 'YouTube', category: 'video', apps: { android: ['com.google.android.youtube', 'com.google.android.apps.youtube.kids'], ios: ['com.google.ios.youtube'] }, domains: ['youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'youtube-nocookie.com'] },
  { id: 'twitch', name: 'Twitch', category: 'video', apps: { android: ['tv.twitch.android.app'], ios: ['tv.twitch'] }, domains: ['twitch.tv', 'ttvnw.net', 'jtvnw.net'] },
  { id: 'kick', name: 'Kick', category: 'video', apps: { android: ['com.kick.mobile'] }, domains: ['kick.com'] },

  // Series y música
  { id: 'netflix', name: 'Netflix', category: 'streaming', apps: { android: ['com.netflix.mediaclient'], ios: ['com.netflix.Netflix'], windows: ['Netflix.exe'] }, domains: ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com'] },
  { id: 'disneyplus', name: 'Disney+', category: 'streaming', apps: { android: ['com.disney.disneyplus'], ios: ['com.disney.disneyplus'] }, domains: ['disneyplus.com', 'bamgrid.com'] },
  { id: 'primevideo', name: 'Prime Video', category: 'streaming', apps: { android: ['com.amazon.avod.thirdpartyclient'], ios: ['com.amazon.aiv.AIVApp'] }, domains: ['primevideo.com'] },
  { id: 'max', name: 'Max', category: 'streaming', apps: { android: ['com.wbd.stream', 'com.hbo.hbonow'], ios: ['com.wbd.stream'] }, domains: ['max.com', 'hbomax.com'] },
  { id: 'spotify', name: 'Spotify', category: 'streaming', apps: { android: ['com.spotify.music'], ios: ['com.spotify.client'], windows: ['Spotify.exe'], macos: ['com.spotify.client'], linux: ['spotify'] }, domains: ['spotify.com', 'scdn.co'] },

  // Juegos
  { id: 'roblox', name: 'Roblox', category: 'games', apps: { android: ['com.roblox.client'], ios: ['com.roblox.robloxmobile'], windows: ['RobloxPlayerBeta.exe', 'RobloxPlayerLauncher.exe'], macos: ['com.roblox.RobloxPlayer'] }, domains: ['roblox.com', 'rbxcdn.com'] },
  { id: 'minecraft', name: 'Minecraft', category: 'games', apps: { android: ['com.mojang.minecraftpe'], ios: ['com.mojang.minecraftpe'], windows: ['Minecraft.Windows.exe', 'MinecraftLauncher.exe', 'Minecraft.exe'], macos: ['com.mojang.minecraftlauncher'] }, domains: ['minecraft.net'] },
  { id: 'fortnite', name: 'Fortnite', category: 'games', apps: { android: ['com.epicgames.fortnite'], ios: ['com.epicgames.FortniteGame'], windows: ['FortniteClient-Win64-Shipping.exe', 'FortniteLauncher.exe'] }, domains: ['fortnite.com'] },
  { id: 'freefire', name: 'Free Fire', category: 'games', apps: { android: ['com.dts.freefireth', 'com.dts.freefiremax'], ios: ['com.dts.freefireth', 'com.dts.freefiremax'] }, domains: ['ff.garena.com'] },
  { id: 'pubg', name: 'PUBG Mobile', category: 'games', apps: { android: ['com.tencent.ig'], ios: ['com.tencent.ig'] }, domains: ['pubgmobile.com'] },
  { id: 'codmobile', name: 'Call of Duty Mobile', category: 'games', apps: { android: ['com.activision.callofduty.shooter'], ios: ['com.activision.callofduty.shooter'] }, domains: [] },
  { id: 'clashroyale', name: 'Clash Royale', category: 'games', apps: { android: ['com.supercell.clashroyale'], ios: ['com.supercell.scroll'] }, domains: [] },
  { id: 'brawlstars', name: 'Brawl Stars', category: 'games', apps: { android: ['com.supercell.brawlstars'], ios: ['com.supercell.laser'] }, domains: [] },
  { id: 'candycrush', name: 'Candy Crush', category: 'games', apps: { android: ['com.king.candycrushsaga'], ios: ['com.midasplayer.apps.candycrushsaga'] }, domains: [] },
  { id: 'genshin', name: 'Genshin Impact', category: 'games', apps: { android: ['com.miHoYo.GenshinImpact'], ios: ['com.miHoYo.GenshinImpact'], windows: ['GenshinImpact.exe'] }, domains: [] },
  { id: 'steam', name: 'Steam', category: 'games', apps: { android: ['com.valvesoftware.android.steam.community'], windows: ['steam.exe'], macos: ['com.valvesoftware.steam'], linux: ['steam'] }, domains: ['steampowered.com', 'steamcommunity.com'] },
  { id: 'epicgames', name: 'Epic Games', category: 'games', apps: { windows: ['EpicGamesLauncher.exe'], macos: ['com.epicgames.EpicGamesLauncher'] }, domains: ['epicgames.com'] },
  { id: 'leagueoflegends', name: 'League of Legends / Valorant', category: 'games', apps: { windows: ['LeagueClient.exe', 'League of Legends.exe', 'RiotClientServices.exe', 'VALORANT.exe', 'VALORANT-Win64-Shipping.exe'], macos: ['com.riotgames.LeagueofLegends.LeagueClient'] }, domains: ['leagueoflegends.com', 'playvalorant.com'] },
  { id: 'webgames', name: 'Juegos en línea (web)', category: 'games', apps: {}, domains: ['poki.com', 'crazygames.com', 'friv.com', 'miniclip.com', 'y8.com', 'coolmathgames.com'] },

  // Apuestas
  { id: 'betting', name: 'Casas de apuestas', category: 'gambling', apps: { android: ['com.bet365.Bet365App', 'mx.caliente.app', 'com.codere.mx'] }, domains: ['bet365.com', 'caliente.mx', 'codere.mx', 'pokerstars.com', 'stake.com', 'betway.com', '1xbet.com', 'williamhill.com', 'draftkings.com', 'fanduel.com', 'bwin.com', 'betano.com', 'strendus.com.mx'] },

  // Adultos (lista base; el grueso lo cubre el DNS familiar)
  { id: 'adultsites', name: 'Sitios para adultos', category: 'adult', apps: {}, domains: ['pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'onlyfans.com', 'redtube.com', 'youporn.com', 'chaturbate.com', 'stripchat.com', 'spankbang.com', 'fansly.com', 'rule34.xxx'] },

  // Compras
  { id: 'amazon', name: 'Amazon', category: 'shopping', apps: { android: ['com.amazon.mShop.android.shopping'], ios: ['com.amazon.Amazon'] }, domains: ['amazon.com', 'amazon.com.mx', 'amazon.es'] },
  { id: 'mercadolibre', name: 'Mercado Libre', category: 'shopping', apps: { android: ['com.mercadolibre'], ios: ['com.mercadolibre'] }, domains: ['mercadolibre.com', 'mercadolibre.com.mx', 'mercadolivre.com.br'] },
  { id: 'shein', name: 'Shein', category: 'shopping', apps: { android: ['com.zzkko'], ios: ['zzkko.com.ZZKKO'] }, domains: ['shein.com', 'shein.com.mx'] },
  { id: 'temu', name: 'Temu', category: 'shopping', apps: { android: ['com.einnovation.temu'], ios: ['com.einnovation.temu'] }, domains: ['temu.com'] },
  { id: 'aliexpress', name: 'AliExpress', category: 'shopping', apps: { android: ['com.alibaba.aliexpresshd'], ios: ['com.alibaba.iAliexpress'] }, domains: ['aliexpress.com', 'aliexpress.us'] },

  // Noticias
  { id: 'googlenews', name: 'Google Noticias', category: 'news', apps: { android: ['com.google.android.apps.magazines'] }, domains: ['news.google.com'] },

  // Citas
  { id: 'tinder', name: 'Tinder', category: 'dating', apps: { android: ['com.tinder'], ios: ['com.cardify.tinder'] }, domains: ['tinder.com', 'gotinder.com'] },
  { id: 'bumble', name: 'Bumble', category: 'dating', apps: { android: ['com.bumble.app'], ios: ['com.moxco.bumble'] }, domains: ['bumble.com'] },
  { id: 'grindr', name: 'Grindr', category: 'dating', apps: { android: ['com.grindrapp.android'], ios: ['com.grindrguy.grindrx'] }, domains: ['grindr.com'] },
  { id: 'hinge', name: 'Hinge', category: 'dating', apps: { android: ['co.hinge.app'], ios: ['co.hinge.mobile'] }, domains: ['hinge.co'] },

  // IA
  { id: 'chatgpt', name: 'ChatGPT', category: 'ai', apps: { android: ['com.openai.chatgpt'], ios: ['com.openai.chat'], windows: ['ChatGPT.exe'], macos: ['com.openai.chat'] }, domains: ['chatgpt.com', 'chat.openai.com'] },
  { id: 'gemini', name: 'Gemini', category: 'ai', apps: { android: ['com.google.android.apps.bard'] }, domains: ['gemini.google.com'] },
  { id: 'claude', name: 'Claude', category: 'ai', apps: { android: ['com.anthropic.claude'], ios: ['com.anthropic.claude'], windows: ['claude.exe'], macos: ['com.anthropic.claudefordesktop'] }, domains: ['claude.ai'] },
  { id: 'characterai', name: 'Character.AI', category: 'ai', apps: { android: ['ai.character.app'], ios: ['ai.character.app'] }, domains: ['character.ai'] },
  { id: 'perplexity', name: 'Perplexity', category: 'ai', apps: { android: ['ai.perplexity.app.android'], ios: ['ai.perplexity.app'] }, domains: ['perplexity.ai'] },

  // Navegadores alternativos
  { id: 'chrome', name: 'Google Chrome', category: 'browsers', apps: { android: ['com.android.chrome'], ios: ['com.google.chrome.ios'], windows: ['chrome.exe'], macos: ['com.google.Chrome'], linux: ['chrome', 'google-chrome'] }, domains: [] },
  { id: 'firefox', name: 'Firefox', category: 'browsers', apps: { android: ['org.mozilla.firefox', 'org.mozilla.focus'], ios: ['org.mozilla.ios.Firefox'], windows: ['firefox.exe'], macos: ['org.mozilla.firefox'], linux: ['firefox'] }, domains: [] },
  { id: 'opera', name: 'Opera', category: 'browsers', apps: { android: ['com.opera.browser', 'com.opera.mini.native', 'com.opera.gx'], windows: ['opera.exe'], macos: ['com.operasoftware.Opera'] }, domains: [] },
  { id: 'brave', name: 'Brave', category: 'browsers', apps: { android: ['com.brave.browser'], ios: ['com.brave.ios.browser'], windows: ['brave.exe'], macos: ['com.brave.Browser'], linux: ['brave', 'brave-browser'] }, domains: [] },
  { id: 'edge', name: 'Microsoft Edge', category: 'browsers', apps: { android: ['com.microsoft.emmx'], windows: ['msedge.exe'], macos: ['com.microsoft.edgemac'] }, domains: [] },
  { id: 'samsunginternet', name: 'Samsung Internet', category: 'browsers', apps: { android: ['com.sec.android.app.sbrowser'] }, domains: [] },
  { id: 'duckduckgo', name: 'DuckDuckGo', category: 'browsers', apps: { android: ['com.duckduckgo.mobile.android'], ios: ['com.duckduckgo.mobile.ios'] }, domains: [] },

  // Evasión
  { id: 'tor', name: 'Tor', category: 'bypass', apps: { android: ['org.torproject.torbrowser', 'org.torproject.android'], windows: ['tor.exe'], macos: ['org.torproject.torbrowser'] }, domains: ['torproject.org'] },
  { id: 'vpnapps', name: 'Apps de VPN', category: 'bypass', apps: { android: ['com.nordvpn.android', 'com.expressvpn.vpn', 'free.vpn.unblock.proxy.turbovpn', 'com.psiphon3', 'com.psiphon3.subscription', 'hotspotshield.android.vpn', 'ch.protonvpn.android', 'com.cloudflare.onedotonedotonedotone', 'com.windscribe.vpn', 'com.opera.vpn', 'free.vpn.unblock.proxy.vpnmaster'], windows: ['NordVPN.exe', 'ExpressVPN.exe', 'ProtonVPN.exe', 'psiphon3.exe', 'Windscribe.exe'] }, domains: ['nordvpn.com', 'expressvpn.com', 'protonvpn.com', 'psiphon.ca', 'hide.me', 'windscribe.com', 'hotspotshield.com', 'croxyproxy.com', 'hidester.com', 'proxysite.com'] },

  // Tiendas
  { id: 'appstores', name: 'Tiendas de aplicaciones', category: 'app_stores', apps: { android: ['com.android.vending', 'com.sec.android.app.samsungapps', 'com.huawei.appmarket', 'com.xiaomi.mipicks'], ios: ['com.apple.AppStore'], windows: ['WinStore.App.exe'], macos: ['com.apple.AppStore'] }, domains: [] },
];

const serviceById = new Map(SERVICES.map((s) => [s.id, s]));

export function getService(id: string): Service | undefined {
  return serviceById.get(id);
}

export function servicesInCategory(category: CategoryId): Service[] {
  return SERVICES.filter((s) => s.category === category);
}

/**
 * Apps que nunca se bloquean: llamadas, SMS, emergencias, la interfaz del
 * sistema y el propio agente. Así un bloqueo total nunca impide pedir ayuda.
 */
export const ESSENTIAL_APPS: Partial<Record<Platform, string[]>> = {
  android: [
    'android',
    'com.android.systemui',
    'com.android.phone',
    'com.android.server.telecom',
    'com.android.dialer',
    'com.google.android.dialer',
    'com.samsung.android.dialer',
    'com.samsung.android.incallui',
    'com.android.incallui',
    'com.android.mms',
    'com.google.android.apps.messaging',
    'com.samsung.android.messaging',
    'com.android.emergency',
    'com.google.android.apps.safetyhub',
    'com.android.cellbroadcastreceiver',
    'com.google.android.cellbroadcastreceiver',
    'com.android.contacts',
    'com.google.android.contacts',
    'com.android.packageinstaller',
    'com.google.android.packageinstaller',
    'com.google.android.inputmethod.latin',
    'com.samsung.android.honeyboard',
    'com.guardian.blocker',
  ],
  ios: ['com.apple.mobilephone', 'com.apple.MobileSMS'],
  windows: ['explorer.exe', 'dwm.exe', 'csrss.exe', 'winlogon.exe', 'LogonUI.exe', 'svchost.exe', 'GuardianAgent.exe', 'Guardian.exe'],
  macos: ['com.apple.finder', 'com.apple.loginwindow', 'com.apple.dock', 'com.guardian.agent'],
  linux: ['Xorg', 'gnome-shell', 'plasmashell', 'guardian'],
};

/** Motores de búsqueda para SafeSearch forzado. */
export const SAFE_SEARCH = {
  /** Registros DNS que fuerzan SafeSearch (CNAME / A equivalentes). */
  dns: {
    'www.google.com': 'forcesafesearch.google.com',
    'www.bing.com': 'strict.bing.com',
    'duckduckgo.com': 'safe.duckduckgo.com',
    'www.youtube.com': 'restrict.youtube.com',
    'm.youtube.com': 'restrict.youtube.com',
    'youtubei.googleapis.com': 'restrict.youtube.com',
    'youtube.googleapis.com': 'restrict.youtube.com',
    'www.youtube-nocookie.com': 'restrict.youtube.com',
  } as Record<string, string>,
};

/** Resolutores DNS familiares (bloquean adultos y malware a nivel red). */
export const FAMILY_DNS = {
  cleanbrowsingFamily: { ipv4: ['185.228.168.168', '185.228.169.168'], doh: 'https://doh.cleanbrowsing.org/doh/family-filter/' },
  cloudflareFamily: { ipv4: ['1.1.1.3', '1.0.0.3'], doh: 'https://family.cloudflare-dns.com/dns-query' },
};

/** Catálogo reducido para una plataforma: lo recibe cada agente junto con la política. */
export interface PlatformCatalog {
  services: { id: string; name: string; category: CategoryId; apps: string[]; domains: string[] }[];
  categories: Record<string, { domains: string[]; keywords: string[] }>;
  essentialApps: string[];
}

export function catalogFor(platform: Platform): PlatformCatalog {
  const categories: PlatformCatalog['categories'] = {};
  for (const c of Object.values(CATEGORIES)) categories[c.id] = { domains: c.domains ?? [], keywords: c.keywords ?? [] };
  return {
    services: SERVICES.map((s) => ({ id: s.id, name: s.name, category: s.category, apps: s.apps[platform] ?? [], domains: s.domains })),
    categories,
    essentialApps: ESSENTIAL_APPS[platform] ?? [],
  };
}
