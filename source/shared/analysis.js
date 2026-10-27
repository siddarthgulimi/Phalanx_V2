/* Phalanx Analyst — local, rule-based threat analysis.
 * Turns a recorded threat event into a plain-language report:
 * what it is, where it came from, how bad it is, and what to do.
 * Shared by the extension (fallback page) and the desktop app.
 * Nothing leaves the machine: this is a knowledge base, not a cloud call.
 */
(function (root) {
  "use strict";

  const KB = {
    credential_form_foreign: {
      name: "Credential harvesting form",
      what: "A login form appeared on this page after it loaded, and it is set to send whatever you type to a different website.",
      how: "Attackers inject a fake sign-in box (via a compromised ad, plugin or script). It looks like part of the real site, but the password goes straight to the attacker's server.",
      impact: "Stolen password, account takeover, and the attacker re-using that password on your other accounts.",
      steps: ["Do not type anything into the form.", "Close the tab and open the site by typing its address yourself.", "If you already typed a password, change it now and turn on 2-step verification."],
    },
    form_hijack: {
      name: "Form hijacking",
      what: "An existing login form on this page was silently re-pointed so that it submits to a foreign server.",
      how: "A malicious script changes the form's destination (its 'action') after the page loads. The page looks normal but your credentials are redirected.",
      impact: "Passwords and payment details captured by a third party.",
      steps: ["Stop using this page.", "Run a malware scan — this often comes from a malicious browser extension.", "Change any password you entered here."],
    },
    credential_overlay: {
      name: "Fake login overlay",
      what: "A full-screen layer containing a password field was placed on top of the real page.",
      how: "The overlay imitates a 'session expired, please sign in again' prompt to trick you into re-entering your password.",
      impact: "Credential theft.",
      steps: ["Do not sign in through pop-up layers you did not ask for.", "Reload the page; real sites rarely ask you to sign in mid-session through an overlay."],
    },
    credential_form_local: {
      name: "Late-loaded login form",
      what: "A login form was added after the page finished loading. Many modern sites do this legitimately.",
      how: "Shown only at High sensitivity because it is usually harmless; it becomes suspicious only together with other signals.",
      impact: "Usually none.",
      steps: ["Check the address bar shows the site you expect before typing a password."],
    },
    script_known_bad: {
      name: "Known-malicious script",
      what: "The page tried to load JavaScript from a domain with a documented history of serving malware or crypto-miners.",
      how: "Compromised websites or ad networks pull code from such hosts; the code can mine cryptocurrency, redirect you, or steal data.",
      impact: "Slow PC, redirects to scam pages, data theft.",
      steps: ["Leave the site.", "If the PC feels slow afterwards, run a full antivirus scan."],
    },
    script_suspicious_host: {
      name: "Suspicious script injection",
      what: "A script was added to the page from a host that looks risky (raw IP address, look-alike domain, or high-abuse domain ending).",
      how: "Legitimate sites load scripts from their own domain or well-known CDNs. Code from throw-away domains is a classic sign of a compromised page.",
      impact: "Code running in the page can read what you type and what you see.",
      steps: ["Avoid entering personal data on this page.", "Report the site to its owner if you trust it otherwise."],
    },
    script_blob: {
      name: "In-memory script",
      what: "A script was created from memory (blob:/data: URL) rather than downloaded from a server.",
      how: "Used by some legitimate frameworks, but also by malware to hide its code from network filters.",
      impact: "Low on its own.",
      steps: ["Treat as informational unless other alerts appear on the same site."],
    },
    script_third_party: {
      name: "New third-party script",
      what: "A script from another company's domain was inserted after the page loaded.",
      how: "Very common (ads, chat widgets, analytics). Reported only at High sensitivity so you can see who is running code on the page.",
      impact: "Usually privacy/tracking rather than direct harm.",
      steps: ["If you trust the site, mark this Resolved.", "Use the Site Scanner to check the script host."],
    },
    clickjack_iframe: {
      name: "Clickjacking",
      what: "An invisible frame was laid over the page. Your clicks land on the hidden frame instead of what you see.",
      how: "The attacker loads another site (for example a 'Like', 'Allow' or payment button) transparently on top, so you click it without knowing.",
      impact: "Unwanted permissions, purchases, follows, or downloads.",
      steps: ["Do not click anything on this page.", "Close the tab."],
    },
    overlay_iframe: {
      name: "Full-screen foreign frame",
      what: "Another website was loaded in a frame covering most of the screen.",
      how: "Used for scareware ('Your PC is infected!') and fake prompts.",
      impact: "Social-engineering: fake warnings, fake support numbers.",
      steps: ["Never call phone numbers shown in pop-ups.", "Close the tab; use Task Manager if the browser is locked."],
    },
    hidden_iframe: {
      name: "Hidden frame",
      what: "A zero-size or invisible frame was added that loads another website in the background.",
      how: "A classic 'drive-by' technique to run exploit kits, ad fraud or tracking without you noticing.",
      impact: "Background exploit attempts and tracking.",
      steps: ["Keep your browser updated.", "Leave the site if it is not one you trust."],
    },
    overlay_div: {
      name: "Full-screen overlay",
      what: "A large layer was placed on top of the page (often a pop-up, cookie wall or modal).",
      how: "Mostly legitimate. Shown at High sensitivity so you can spot UI tricks.",
      impact: "Usually none.",
      steps: ["Resolve it if it is a normal pop-up."],
    },
    handler_dangerous: {
      name: "Malicious inline code",
      what: "An event handler (code that runs on click, load or error) was injected with content that reads cookies, decodes hidden code or contacts other servers.",
      how: "Typical of cross-site scripting (XSS): the attacker sneaks code into page elements so it runs inside the trusted site.",
      impact: "Session theft (you stay 'logged in' as the attacker), data leaks.",
      steps: ["Log out of the site and log back in to reset your session.", "Report the page to the site owner."],
    },
    handler_generic: {
      name: "Dynamic inline handler",
      what: "A page element received new inline JavaScript after load.",
      how: "Common in older websites; reported only at High sensitivity.",
      impact: "Usually none.",
      steps: ["Resolve if the site works as expected."],
    },
    js_url_dangerous: {
      name: "Malicious javascript: link",
      what: "A link was injected that runs code instead of navigating.",
      how: "Clicking runs the attacker's script inside the page.",
      impact: "Session or data theft.",
      steps: ["Do not click unfamiliar links on this page."],
    },
    site_risk: {
      name: "Risky website",
      what: "The address you visited shows warning signs that are common on phishing, scam or malware sites.",
      how: "Phalanx checks the address itself (encryption, domain age signals, brand look-alikes, risky domain endings, piracy lists) before the page loads.",
      impact: "Depends on the category below.",
      steps: ["Only continue if you know and trust this site.", "Never enter passwords or card details on a flagged site."],
    },
    download_risk: {
      name: "Risky download",
      what: "A file you downloaded has characteristics of malware or comes from a risky source.",
      how: "Phalanx combines Google Safe Browsing's verdict (built into Chrome) with its own checks: file type, disguised extensions, cracked-software names and the reputation of the site.",
      impact: "Executable files can install ransomware, spyware or remote-access tools.",
      steps: ["Do not open the file.", "Quarantine (delete) it.", "Download software only from the vendor's official website."],
    },
  };

  const BRIEFS = {
    piracy: {
      title: "Why piracy & torrent sites are risky",
      points: [
        "They are funded by aggressive ad networks that regularly push fake 'Download' buttons, scareware and malicious redirects.",
        "Cracked software, 'keygens' and 'activators' are one of the most common ways ransomware and info-stealers reach home PCs — the crack itself often IS the malware.",
        "Files have no publisher signature, so there is no way to prove they were not modified.",
        "Torrent clients expose your IP address to everyone sharing the same file; in many countries (including India under the Copyright Act, 1957) downloading pirated content is illegal.",
        "Safer alternatives: official stores, free & open-source software (e.g. LibreOffice, GIMP, VLC), legal streaming services, or student/educational licences.",
      ],
    },
    phishing: {
      title: "How to recognise phishing",
      points: [
        "Check the real domain — the part just before the first single '/'. 'paypal.secure-login.tk' belongs to 'secure-login.tk', not PayPal.",
        "Urgency words (verify, suspended, claim, reward) in the address are a classic pressure tactic.",
        "Banks, government portals and big services never ask you to log in from a link in an SMS, WhatsApp or e-mail.",
        "Use a password manager: it refuses to auto-fill on look-alike domains, which is an instant warning sign.",
        "Turn on 2-step verification so a stolen password alone is not enough.",
      ],
    },
    malware: {
      title: "Malware: what to do next",
      points: [
        "Do not open the file or the site again.",
        "Run a full scan with Windows Security (Defender) or your antivirus.",
        "If you already opened an executable: disconnect from the internet, scan, and change important passwords from a different device.",
        "Keep Windows, your browser and extensions up to date — most attacks exploit already-fixed bugs.",
      ],
    },
    "suspicious-host": {
      title: "Why raw IP addresses are suspicious",
      points: [
        "Legitimate public websites almost always use a domain name with a valid HTTPS certificate.",
        "Raw IP links are popular in phishing SMS and malware command servers because they avoid domain take-downs.",
        "Exception: your own router, printer or office intranet (e.g. 192.168.x.x) — mark those Resolved and Phalanx will trust them.",
      ],
    },
    redirect: {
      title: "Hidden links",
      points: ["Link shorteners hide the real destination. Preview them by adding '+' (bit.ly) or using an un-shortening service before clicking."],
    },
    dom: {
      title: "How to keep pages from being tampered with",
      points: [
        "Remove browser extensions you do not use — malicious extensions are the #1 source of injected forms and scripts.",
        "Keep the browser updated; enable 'Enhanced protection' in Chrome's Privacy & security settings.",
        "Use an ad-blocker on untrusted sites; malvertising is the usual delivery route.",
        "When in doubt, close the tab and type the site address yourself.",
      ],
    },
  };

  const AFTER = {
    dom: ["Quarantine removes the injected element from the page immediately; the rest of the page keeps working.",
      "The event is kept in History so you can review it later or export it in a report.",
      "Reload the page: if the element comes back, the site itself (or an extension) is compromised — avoid it."],
    site: ["Quarantine blocks the site: future visits show a Phalanx block page instead of loading it.",
      "You can un-block it anytime from Settings → Trusted & blocked sites.",
      "Resolved adds the site to your trusted list so it is not flagged again."],
    download: ["Quarantine cancels the download, or deletes the file if it already finished.",
      "Resolved lets the download continue / keeps the file.",
      "If you already opened the file, run a full antivirus scan."],
  };

  const SCALE = [
    { from: 0, to: 19, label: "Info", text: "Nothing to worry about — logged only." },
    { from: 20, to: 44, label: "Low", text: "Unusual but usually harmless. Shown at High sensitivity." },
    { from: 45, to: 69, label: "Medium", text: "Suspicious. Review before trusting." },
    { from: 70, to: 89, label: "High", text: "Likely malicious. Auto-quarantine acts on these." },
    { from: 90, to: 100, label: "Critical", text: "Known-bad or clear attack pattern." },
  ];

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }

  function analyze(ev) {
    if (!ev) return null;
    const kb = KB[ev.type] || KB[ev.kind === "download" ? "download_risk" : ev.kind === "site" ? "site_risk" : "handler_generic"];
    const score = ev.score || 0;
    const sev = ev.severity || (root.PhalanxIntel ? root.PhalanxIntel.severityOf(score) : "medium");
    const band = SCALE.find((b) => score >= b.from && score <= b.to) || SCALE[0];
    const cat = ev.category && BRIEFS[ev.category] ? ev.category : ev.kind === "dom" ? "dom" : null;

    const source = [];
    source.push({ label: "Detected", value: fmtTime(ev.ts) });
    if (ev.url) source.push({ label: "Page", value: ev.url });
    if (ev.host) source.push({ label: "Origin host", value: ev.host });
    if (ev.source && ev.source !== ev.url) source.push({ label: ev.kind === "download" ? "File URL" : "Points to", value: ev.source });
    if (ev.target) source.push({ label: ev.kind === "download" ? "File" : "Element", value: ev.target });
    source.push({ label: "Detected by", value: ev.kind === "dom" ? "DOM observer (in-page)" : ev.kind === "site" ? "Site scanner (before page load)" : "Download inspector" });

    let verdict;
    if (score >= 90) verdict = "This is a clear attack pattern. Quarantine is strongly recommended.";
    else if (score >= 70) verdict = "This is most likely malicious. Quarantine unless you are certain it is legitimate.";
    else if (score >= 45) verdict = "This is suspicious. Review the evidence below before you decide.";
    else verdict = "This is probably harmless, but it is unusual enough to show you.";

    const recs = kb.steps.slice();
    if (ev.kind === "site" && ev.category === "piracy") recs.push("Avoid downloading anything from this site; use official sources instead.");
    if (ev.kind === "download") recs.push("If you need this software, get it from the publisher's official site and compare the file's SHA-256 hash.");

    return {
      title: ev.title || kb.name,
      name: kb.name,
      score, severity: sev, band, scale: SCALE,
      verdict,
      what: kb.what, how: kb.how, impact: kb.impact,
      source,
      signals: (ev.signals || []).slice().sort((a, b) => b.weight - a.weight),
      recommendations: recs,
      afterQuarantine: AFTER[ev.kind] || AFTER.dom,
      brief: cat ? BRIEFS[cat] : null,
      category: ev.category || ev.kind,
    };
  }

  root.PhalanxAnalyst = { analyze, KB, BRIEFS, SCALE, AFTER };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
