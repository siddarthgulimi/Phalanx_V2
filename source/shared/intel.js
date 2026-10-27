/* Phalanx threat-intelligence core.
 *
 * One file, shared by:  the extension service worker (importScripts),
 * the content script, the extension pages, and the desktop app UI.
 * No imports/exports so it loads in every context.
 *
 * Everything scores on ONE 0-100 scale:
 *     0-19 info (never reported) | 20-44 low | 45-69 medium | 70-89 high | 90+ critical
 * Detection sensitivity is just a reporting threshold on that scale:
 *     Low  -> report high & critical only   (score >= 70)
 *     Medium -> report medium and above      (score >= 45)   [default]
 *     High -> report low and above           (score >= 20)
 */
(function (root) {
  "use strict";

  const THRESHOLDS = { low: 70, medium: 45, high: 20 };
  const AUTO_QUARANTINE_MIN = 70; // auto-quarantine only acts on high/critical

  function severityOf(score) {
    if (score >= 90) return "critical";
    if (score >= 70) return "high";
    if (score >= 45) return "medium";
    if (score >= 20) return "low";
    return "info";
  }
  function thresholdFor(sensitivity) {
    return THRESHOLDS[sensitivity] != null ? THRESHOLDS[sensitivity] : THRESHOLDS.medium;
  }

  /* ---------- reference lists ---------- */

  // Popular, legitimate services. Matched on registrable domain (eTLD+1).
  const TRUSTED = new Set(`google.com google.co.in gmail.com youtube.com youtu.be googleusercontent.com gstatic.com
    googleapis.com googlevideo.com ggpht.com withgoogle.com blogger.com android.com chrome.com
    discord.com discord.gg discordapp.com discordapp.net discord.media
    netflix.com nflxext.com nflxvideo.net nflximg.net nflxso.net
    microsoft.com live.com office.com office.net outlook.com microsoftonline.com msauth.net bing.com msn.com
    windows.net azure.com skype.com xbox.com sharepoint.com onedrive.com teams.microsoft.com
    github.com githubusercontent.com githubassets.com github.io gitlab.com
    apple.com icloud.com mzstatic.com amazon.com amazon.in amazonaws.com media-amazon.com primevideo.com
    wikipedia.org wikimedia.org whatsapp.com whatsapp.net facebook.com fbcdn.net instagram.com cdninstagram.com messenger.com
    x.com twitter.com twimg.com t.co linkedin.com licdn.com reddit.com redd.it redditstatic.com redditmedia.com
    stackoverflow.com stackexchange.com zoom.us slack.com slack-edge.com spotify.com scdn.co spotifycdn.com
    cloudflare.com openai.com chatgpt.com oaistatic.com claude.ai anthropic.com notion.so notion.site figma.com
    dropbox.com yahoo.com paypal.com paypalobjects.com flipkart.com hotstar.com jiocinema.com irctc.co.in
    sbi.co.in onlinesbi.sbi hdfcbank.com icicibank.com axisbank.com kotak.com paytm.com phonepe.com npci.org.in
    stpi.in canva.com adobe.com mozilla.org firefox.com duckduckgo.com twitch.tv ttvnw.net jtvnw.net
    steampowered.com steamcommunity.com epicgames.com zomato.com swiggy.com uber.com airbnb.com booking.com
    medium.com quora.com coursera.org udemy.com khanacademy.org w3schools.com mdn.dev npmjs.com pypi.org
    vercel.com netlify.com heroku.com digitalocean.com atlassian.com atlassian.net jira.com trello.com
    salesforce.com hubspot.com zoho.com zoho.in razorpay.com stripe.com shopify.com myntra.com ajio.com
    nykaa.com bigbasket.com meesho.com indiatimes.com ndtv.com thehindu.com hindustantimes.com bbc.com bbc.co.uk
    cnn.com nytimes.com reuters.com bloomberg.com theguardian.com espn.com cricbuzz.com espncricinfo.com
    telegram.org web.telegram.org signal.org protonmail.com proton.me
    visualstudio.com python.org nodejs.org videolan.org 7-zip.org oracle.com java.com nvidia.com amd.com intel.com
    asus.com dell.com hp.com lenovo.com jetbrains.com docker.com postman.com git-scm.com obsproject.com mozilla.net`.split(/\s+/).filter(Boolean));

  // Suffixes that are trusted in full (government / academic).
  const TRUSTED_SUFFIXES = ["gov.in", "nic.in", "ac.in", "edu", "gov", "mil", "gov.uk", "europa.eu"];

  // Benign third-party script hosts (CDNs, analytics, captcha, payments).
  const KNOWN_CDNS = new Set(`gstatic.com googleapis.com googletagmanager.com google-analytics.com googlesyndication.com
    doubleclick.net googleadservices.com recaptcha.net hcaptcha.com cloudflare.com cloudflareinsights.com
    jsdelivr.net unpkg.com jquery.com bootstrapcdn.com akamaihd.net akamaized.net akamai.net fastly.net
    fastly.com cloudfront.net azureedge.net msecnd.net aspnetcdn.com stripe.com stripe.network paypalobjects.com
    facebook.net fbcdn.net twimg.com ytimg.com hotjar.com segment.com segment.io sentry.io sentry-cdn.com
    newrelic.com nr-data.net intercom.io intercomcdn.com zdassets.com zendesk.com hubspot.com hs-scripts.com
    hs-analytics.net clarity.ms bing.com licdn.com razorpay.com cookielaw.org onetrust.com optimizely.com
    adobedtm.com typekit.net fontawesome.com wp.com wordpress.com shopify.com shopifycdn.com`.split(/\s+/).filter(Boolean));

  // Hosts with a documented history of serving malicious or cryptojacking JS.
  const KNOWN_BAD = new Set(`polyfill.io bootcss.com bootcdn.net staticfile.org polyfillcache.com coinhive.com
    coin-hive.com cryptoloot.pro jsecoin.com webminepool.com authedmine.com crypto-loot.com minero.cc`.split(/\s+/).filter(Boolean));

  const PIRACY_RE = /(pirate|torrent|1337x|yts|rarbg|kickass|katcr|limetorrent|crack|keygen|warez|fmovies|123movie|putlocker|soap2day|movierulz|tamilrocker|filmyzilla|filmywap|getintopc|igg-games|oceanofgames|fitgirl|nyaa|skidrow|gogoanime|9anime|mkvcinemas|vegamovies|bolly4u|extratorrent|zooqle|thepiratebay)/;

  const SHORTENERS = new Set(`bit.ly tinyurl.com goo.gl is.gd cutt.ly rb.gy shorturl.at ow.ly buff.ly tiny.cc
    rebrand.ly t.ly shorte.st adf.ly bl.ink v.gd`.split(/\s+/).filter(Boolean));

  const FREE_HOSTING = ["000webhostapp.com", "weebly.com", "wixsite.com", "glitch.me", "repl.co", "firebaseapp.com",
    "web.app", "pages.dev", "netlify.app", "vercel.app", "herokuapp.com", "blogspot.com", "github.io", "ngrok.io",
    "ngrok-free.app", "trycloudflare.com", "duckdns.org", "no-ip.org", "serveo.net"];

  const RISKY_TLDS = new Set(`zip mov top xyz gq tk ml ga cf work click country kim icu cam buzz monster rest bar loan
    win bid date racing stream download review accountant cricket science party gdn men mom lol quest sbs cyou cfd
    su pw cc`.split(/\s+/).filter(Boolean));

  const BRANDS = {
    paypal: ["paypal.com"], apple: ["apple.com", "icloud.com"], icloud: ["icloud.com", "apple.com"],
    microsoft: ["microsoft.com", "live.com", "office.com", "microsoftonline.com"], office365: ["office.com", "microsoft.com"],
    outlook: ["outlook.com", "live.com", "office.com"], google: ["google.com", "google.co.in"], gmail: ["gmail.com", "google.com"],
    amazon: ["amazon.com", "amazon.in"], netflix: ["netflix.com"], facebook: ["facebook.com"], instagram: ["instagram.com"],
    whatsapp: ["whatsapp.com"], sbi: ["sbi.co.in", "onlinesbi.sbi"], onlinesbi: ["onlinesbi.sbi"], hdfc: ["hdfcbank.com"],
    icici: ["icicibank.com"], axisbank: ["axisbank.com"], paytm: ["paytm.com"], phonepe: ["phonepe.com"],
    binance: ["binance.com"], coinbase: ["coinbase.com"], metamask: ["metamask.io"], steam: ["steampowered.com", "steamcommunity.com"],
    discord: ["discord.com", "discord.gg"], linkedin: ["linkedin.com"], dropbox: ["dropbox.com"], docusign: ["docusign.com", "docusign.net"],
    irctc: ["irctc.co.in"], aadhaar: ["uidai.gov.in"], uidai: ["uidai.gov.in"], incometax: ["incometax.gov.in"],
  };
  const BRAND_KEYS = Object.keys(BRANDS);

  const PHISH_WORDS = ["login", "signin", "logon", "verify", "verification", "secure", "account", "update", "confirm",
    "banking", "wallet", "recover", "unlock", "suspended", "billing", "password", "auth", "kyc", "reward", "gift",
    "bonus", "claim", "prize", "refund", "support", "helpdesk", "alert"];

  const MULTI_SUFFIXES = new Set(`co.uk org.uk ac.uk gov.uk co.in org.in net.in gov.in nic.in ac.in edu.in res.in firm.in
    gen.in ind.in com.au net.au org.au co.jp co.nz com.br com.cn com.sg com.my co.za com.mx com.tr com.pk co.id
    com.ar com.sa com.eg`.split(/\s+/).filter(Boolean));
  const PRIVATE_SUFFIXES = FREE_HOSTING.concat(["blogspot.com"]);

  /* ---------- host helpers ---------- */

  function isIp(host) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /^\[?[0-9a-f:]+\]?$/i.test(host) && host.includes(":");
  }
  function isLocal(host) {
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  }
  function hostOf(url, base) {
    try { return new URL(url, base).hostname.toLowerCase(); } catch (e) { return ""; }
  }
  /** Registrable domain, e.g. mail.google.com -> google.com, a.b.co.in -> b.co.in */
  function siteOf(host) {
    if (!host) return "";
    host = host.toLowerCase().replace(/\.$/, "");
    if (isIp(host)) return host;
    for (const p of PRIVATE_SUFFIXES) {
      if (host === p) return host;
      if (host.endsWith("." + p)) {
        const rest = host.slice(0, -(p.length + 1)).split(".");
        return rest[rest.length - 1] + "." + p;
      }
    }
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const last2 = parts.slice(-2).join(".");
    if (MULTI_SUFFIXES.has(last2)) return parts.slice(-3).join(".");
    return last2;
  }
  function suffixTrusted(host) {
    return TRUSTED_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
  }
  function isTrusted(host, lists) {
    if (!host) return false;
    const site = siteOf(host);
    if (lists && lists.allow && (lists.allow.includes(site) || lists.allow.includes(host))) return true;
    if (lists && lists.block && (lists.block.includes(site) || lists.block.includes(host))) return false;
    return TRUSTED.has(site) || TRUSTED.has(host) || suffixTrusted(host);
  }
  function isBlocked(host, lists) {
    if (!host || !lists || !lists.block) return false;
    return lists.block.includes(host) || lists.block.includes(siteOf(host));
  }
  function isBenignThirdParty(host) {
    const site = siteOf(host);
    return KNOWN_CDNS.has(site) || TRUSTED.has(site);
  }
  function isKnownBad(host) {
    const site = siteOf(host);
    return KNOWN_BAD.has(site) || KNOWN_BAD.has(host);
  }
  function brandImpersonation(host) {
    const site = siteOf(host);
    const tokens = host.split(/[.\-_]/).filter(Boolean);
    for (const b of BRAND_KEYS) {
      const re = new RegExp("^(secure|login|my|account|verify|update|support|online|web)?" + b +
        "(login|secure|verify|support|online|account|help|id|pay|bank|net|web|\\d+)?$");
      if (tokens.some((t) => re.test(t))) {
        const official = BRANDS[b];
        if (!official.some((o) => site === o || host.endsWith("." + o) || host === o)) return b;
      }
    }
    return null;
  }

  function add(list, id, label, weight) {
    list.push({ id, label, weight });
  }
  function finish(signals, extra) {
    let score = signals.reduce((a, s) => a + s.weight, 0);
    score = Math.max(0, Math.min(100, Math.round(score)));
    return Object.assign({ score, severity: severityOf(score), signals }, extra || {});
  }

  /* ---------- 1. Site (URL) safety ---------- */
  function scoreUrl(urlStr, lists) {
    let url;
    try { url = new URL(urlStr); } catch (e) { return finish([], { host: "", site: "", category: "none", skipped: true }); }
    if (!/^https?:$/.test(url.protocol)) return finish([], { host: "", site: "", category: "none", skipped: true });
    const host = url.hostname.toLowerCase();
    const site = siteOf(host);
    const base = { host, site, url: url.href, category: "general" };
    const s = [];

    if (isLocal(host)) return finish([], Object.assign(base, { trusted: true, local: true, category: "local" }));
    if (isBlocked(host, lists)) {
      add(s, "blocklist", "You previously quarantined (blocked) this site", 100);
      return finish(s, Object.assign(base, { category: "blocked" }));
    }
    if (isKnownBad(host)) {
      add(s, "known_bad", "Domain is on the known-malicious list (malware / cryptojacking)", 95);
      return finish(s, Object.assign(base, { category: "malware" }));
    }
    if (isTrusted(host, lists)) {
      return finish([], Object.assign(base, { trusted: true, category: "trusted" }));
    }

    let category = "general";
    if (PIRACY_RE.test(host)) {
      add(s, "piracy", "Piracy / torrent / cracked-software site", 55);
      category = "piracy";
    }
    const brand = brandImpersonation(host);
    if (brand) {
      add(s, "brand", `Uses the brand name "${brand}" but is not ${brand}'s official domain`, 40);
      category = "phishing";
    }
    const words = PHISH_WORDS.filter((w) => host.includes(w));
    if (words.length) {
      add(s, "phish_words", `Account/urgency words in the address: ${words.slice(0, 3).join(", ")}`, Math.min(24, words.length * 12));
      if (category === "general") category = "phishing";
    }
    if (url.protocol === "http:") add(s, "http", "Connection is not encrypted (HTTP, no padlock)", 15);
    if (isIp(host)) { add(s, "ip", "Address is a raw IP number instead of a domain name", 30); if (category === "general") category = "suspicious-host"; }
    if (host.split(".").some((l) => l.startsWith("xn--"))) { add(s, "punycode", "Punycode domain — may imitate another site with look-alike letters", 45); if (category === "general") category = "phishing"; }
    if (url.username || url.password) add(s, "userinfo", "URL hides a username/password before the real host (@ trick)", 25);
    if (url.port && !["80", "443"].includes(url.port)) add(s, "port", `Unusual port :${url.port}`, 8);
    const tld = host.split(".").pop();
    if (RISKY_TLDS.has(tld)) add(s, "tld", `High-abuse top-level domain (.${tld})`, 18);
    const subDepth = host.split(".").length - site.split(".").length;
    if (subDepth >= 3) add(s, "depth", `Deep sub-domain chain (${subDepth} levels)`, 10);
    if (host.length > 45) add(s, "long", "Very long host name", 6);
    if ((host.match(/-/g) || []).length >= 3) add(s, "hyphens", "Many hyphens in host name", 8);
    if (/\d{4,}/.test(host) && !isIp(host)) add(s, "digits", "Long number sequence in domain", 6);
    if (SHORTENERS.has(site)) { add(s, "shortener", "Link shortener — the real destination is hidden", 15); if (category === "general") category = "redirect"; }
    if (FREE_HOSTING.some((f) => host.endsWith("." + f))) add(s, "freehost", "Free hosting platform (often abused for throw-away phishing pages)", 8);

    return finish(s, Object.assign(base, { category }));
  }

  /* ---------- 2. Downloads ---------- */
  const EXEC_EXT = new Set("exe msi scr com pif bat cmd ps1 psm1 vbs vbe js jse wsf wsh hta jar apk dmg pkg app msix appx appxbundle lnk reg dll cpl iso img vhd vhdx xll sys".split(" "));
  const ARCHIVE_EXT = new Set("zip rar 7z tar gz tgz bz2 xz cab".split(" "));
  const DOC_EXT = new Set("pdf doc docx xls xlsx ppt pptx txt jpg jpeg png gif mp3 mp4 mkv avi rtf csv".split(" "));
  const MACRO_EXT = new Set("docm xlsm pptm xlam dotm".split(" "));
  const CHROME_DANGER = {
    file: ["Chrome warns this file type can harm your computer", 25],
    url: ["Google Safe Browsing: download URL is known to be malicious", 95],
    content: ["Google Safe Browsing: file content is known malware", 95],
    host: ["Google Safe Browsing: host is known to distribute malware", 95],
    uncommon: ["Google Safe Browsing: file is uncommon and not trusted yet", 60],
    unwanted: ["Google Safe Browsing: potentially unwanted program", 80],
    accountCompromise: ["Google Safe Browsing: file steals account credentials", 95],
    deepScannedFailed: ["Deep scan failed", 40],
    promptForScanning: ["Chrome asked for a deep scan of this file", 35],
    blockedTooLarge: ["Blocked: too large to scan", 30],
    sensitiveContentBlock: ["Blocked by enterprise data rules", 60],
  };

  function scoreDownload(d, lists) {
    // d: {filename, url, referrer, mime, danger, fileSize}
    const name = (d.filename || "").split(/[\\/]/).pop() || (d.url || "").split("?")[0].split("/").pop() || "download";
    const lower = name.toLowerCase();
    const parts = lower.split(".");
    const ext = parts.length > 1 ? parts.pop() : "";
    const prevExt = parts.length > 1 ? parts[parts.length - 1] : "";
    const srcHost = hostOf(d.url) || "";
    const refHost = hostOf(d.referrer) || "";
    const s = [];
    let category = "download";

    if (d.danger && CHROME_DANGER[d.danger]) {
      const [label, w] = CHROME_DANGER[d.danger];
      add(s, "chrome_" + d.danger, label, w);
      if (w >= 80) category = "malware";
    }
    if (EXEC_EXT.has(ext)) add(s, "exec", `Executable / script file type (.${ext}) — it can run code on your PC`, 30);
    if (MACRO_EXT.has(ext)) add(s, "macro", `Office file with macros enabled (.${ext})`, 30);
    if (EXEC_EXT.has(ext) && (DOC_EXT.has(prevExt) || ARCHIVE_EXT.has(prevExt))) {
      add(s, "double_ext", `Double extension ".${prevExt}.${ext}" — disguised as a harmless ${prevExt.toUpperCase()}`, 50);
      category = "malware";
    }
    if (/(crack|keygen|patch|activator|kms|loader|serial|warez|nulled|repack|cheat|hack)/.test(lower)) {
      add(s, "crackname", "File name suggests cracked / pirated software (common malware carrier)", 40);
      category = "piracy";
    }
    const src = srcHost && !isLocal(srcHost) ? scoreUrl(d.url, lists) : null;
    const ref = refHost && refHost !== srcHost && !isLocal(refHost) ? scoreUrl(d.referrer, lists) : null;
    const worst = [src, ref].filter(Boolean).sort((a, b) => b.score - a.score)[0];
    if (worst && worst.score >= 20) {
      add(s, "source_site", `Downloaded from a risky site (${worst.host}, score ${worst.score})`, Math.round(worst.score * 0.5));
      if (worst.category === "piracy") category = "piracy";
    }
    if (srcHost && isIp(srcHost) && !isLocal(srcHost)) add(s, "ip_src", "Served from a raw IP address", 20);
    if (/^http:/i.test(d.url || "") && !isLocal(srcHost)) add(s, "http_src", "Downloaded over unencrypted HTTP", 10);

    const trustedSource = srcHost && (isTrusted(srcHost, lists) || isBenignThirdParty(srcHost)) && (!refHost || isTrusted(refHost, lists) || isLocal(refHost));
    let r = finish(s, { host: srcHost || refHost, site: siteOf(srcHost || refHost), filename: name, ext, category });
    if (trustedSource && !(d.danger && CHROME_DANGER[d.danger] && CHROME_DANGER[d.danger][1] >= 60)) {
      // Executables from Microsoft, GitHub, Google etc. are normal - keep visible but low.
      r.score = Math.min(r.score, 15);
      r.severity = severityOf(r.score);
      r.signals.push({ id: "trusted_src", label: `Source ${srcHost} is a recognised service`, weight: 0 });
      r.trusted = true;
    }
    return r;
  }

  /* ---------- 3. DOM findings (content script) ---------- */
  // Weights for each DOM pattern. The content script picks the matching id.
  const DOM_RULES = {
    credential_form_foreign: { score: 92, title: "Injected login form sends passwords to another site" },
    form_hijack:             { score: 90, title: "Login form re-pointed to a foreign server (form hijack)" },
    credential_overlay:      { score: 80, title: "Fake login overlay placed over the page" },
    credential_form_local:   { score: 30, title: "Login form added after page load" },
    script_known_bad:        { score: 95, title: "Script loaded from a known-malicious host" },
    script_suspicious_host:  { score: 75, title: "Script injected from a suspicious host" },
    script_blob:             { score: 40, title: "Script injected from an in-memory (blob/data) URL" },
    script_third_party:      { score: 30, title: "New third-party script inserted" },
    clickjack_iframe:        { score: 85, title: "Invisible frame laid over the page (clickjacking)" },
    overlay_iframe:          { score: 60, title: "Full-screen foreign frame overlay" },
    hidden_iframe:           { score: 55, title: "Hidden frame loading a foreign site" },
    overlay_div:             { score: 25, title: "Full-screen overlay added to the page" },
    handler_dangerous:       { score: 75, title: "Malicious-looking inline event handler injected" },
    handler_generic:         { score: 22, title: "Inline event handler added dynamically" },
    js_url_dangerous:        { score: 70, title: "javascript: link with an executable payload injected" },
  };
  const DANGEROUS_JS = /(eval\s*\(|atob\s*\(|fromCharCode|document\.cookie|localStorage|\.src\s*=|fetch\s*\(|XMLHttpRequest|sendBeacon|window\.location|location\.href\s*=|import\s*\(|unescape\s*\(|<script|Function\s*\(|\.innerHTML\s*=|navigator\.clipboard|keydown|keypress)/i;

  function hostRisk(host) {
    // quick host-level risk for script/iframe sources
    if (!host) return 0;
    if (isKnownBad(host)) return 95;
    if (isIp(host) && !isLocal(host)) return 75;
    if (host.split(".").some((l) => l.startsWith("xn--"))) return 75;
    if (RISKY_TLDS.has(host.split(".").pop())) return 75;
    if (brandImpersonation(host)) return 75;
    return 0;
  }

  root.PhalanxIntel = {
    VERSION: "2.0.0",
    THRESHOLDS, AUTO_QUARANTINE_MIN, DOM_RULES, DANGEROUS_JS,
    severityOf, thresholdFor, scoreUrl, scoreDownload, hostRisk,
    siteOf, hostOf, isIp, isLocal, isTrusted, isBlocked, isBenignThirdParty, isKnownBad, brandImpersonation,
    lists: { TRUSTED, KNOWN_CDNS, KNOWN_BAD, SHORTENERS, RISKY_TLDS, BRANDS },
  };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
