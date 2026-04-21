"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULTS = {
  browser: "coccoc",
  chromiumExecutablePath: "",
  cocCocExecutablePath: "",
  browserArgs: ["--disable-blink-features=AutomationControlled"],
  createCocCocProfilePerUsername: true,
  cocCocProfilesDir: "./coccoc-profiles",
  createFreshProfile: true,
  saveSessionState: false,
  manualLogin: false,
  manualLoginWaitTimeoutMs: 600000,
  searchTab: "live",
  maxRepliesPerAccount: 1,
  maxCandidateTweets: 10,
  headless: false,
  dryRun: true,
  minDelayMs: 4000,
  maxDelayMs: 8000,
  stepMinDelayMs: 1500,
  stepMaxDelayMs: 3000,
  typingMinDelayMs: 65,
  typingMaxDelayMs: 145,
  loginInputTimeoutMs: 15000,
  navigationTimeoutMs: 60000,
  preferLinkCardFromAnchor: false,
  stripUrlsFromReply: true,
  allowReplyWithoutImageOnUploadFail: true,
  replyInlineOnly: true,
  saveDebugScreenshotOnError: true,
  sessionDir: "./sessions",
  reportDir: "./reports",
};

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value =
        argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

function log(message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${message}`);
}

function sanitizeFileName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitRandom(config) {
  const min = Number(config.minDelayMs) || DEFAULTS.minDelayMs;
  const max = Number(config.maxDelayMs) || DEFAULTS.maxDelayMs;
  const duration = randomInt(Math.min(min, max), Math.max(min, max));
  await sleep(duration);
}

async function waitStep(config, minOverride, maxOverride) {
  const min =
    Number(minOverride) ||
    Number(config.stepMinDelayMs) ||
    DEFAULTS.stepMinDelayMs;
  const max =
    Number(maxOverride) ||
    Number(config.stepMaxDelayMs) ||
    DEFAULTS.stepMaxDelayMs;
  const duration = randomInt(Math.min(min, max), Math.max(min, max));
  await sleep(duration);
}

async function typeLikeHuman(locator, value, config) {
  const text = String(value || "");
  const min = Number(config.typingMinDelayMs) || DEFAULTS.typingMinDelayMs;
  const max = Number(config.typingMaxDelayMs) || DEFAULTS.typingMaxDelayMs;

  await locator.click({ delay: randomInt(20, 90) });
  const existingValue = await locator.inputValue().catch(() => "");
  if (existingValue) {
    for (let i = 0; i < existingValue.length + 2; i += 1) {
      await locator.press("Backspace").catch(() => null);
      await sleep(randomInt(15, 40));
    }
  }

  if (!text) {
    return;
  }

  for (const ch of text) {
    await locator.type(ch, {
      delay: randomInt(Math.min(min, max), Math.max(min, max)),
    });
  }
}

function normalizeLoginIdentifier(username) {
  const raw = String(username || "").trim();
  if (/^@[A-Za-z0-9_]{1,15}$/.test(raw)) {
    return raw.slice(1);
  }
  return raw;
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function removeFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  await fs.promises.unlink(filePath);
  return true;
}

async function removeDirIfExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  await fs.promises.rm(dirPath, { recursive: true, force: true });
  return true;
}

async function readJson(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizeConfig(userConfig) {
  const merged = { ...DEFAULTS, ...userConfig };
  const browserName = String(merged.browser || "").toLowerCase();

  if (!["coccoc", "chromium"].includes(browserName)) {
    throw new Error('Config "browser" chi ho tro "coccoc" hoac "chromium".');
  }

  merged.browser = browserName;

  if (!Array.isArray(merged.browserArgs)) {
    merged.browserArgs = DEFAULTS.browserArgs;
  }

  merged.createCocCocProfilePerUsername =
    merged.browser === "coccoc"
      ? Boolean(merged.createCocCocProfilePerUsername)
      : false;

  merged.manualLogin = Boolean(merged.manualLogin);
  merged.preferLinkCardFromAnchor = Boolean(merged.preferLinkCardFromAnchor);
  merged.stripUrlsFromReply = Boolean(merged.stripUrlsFromReply);
  merged.allowReplyWithoutImageOnUploadFail = Boolean(
    merged.allowReplyWithoutImageOnUploadFail,
  );
  merged.replyInlineOnly = Boolean(merged.replyInlineOnly);
  if (
    !Number.isFinite(Number(merged.manualLoginWaitTimeoutMs)) ||
    Number(merged.manualLoginWaitTimeoutMs) <= 0
  ) {
    merged.manualLoginWaitTimeoutMs = DEFAULTS.manualLoginWaitTimeoutMs;
  }

  if (!merged.hashtag && !merged.topicQuery) {
    throw new Error('Config phai co "hashtag" hoac "topicQuery".');
  }
  if (
    !Array.isArray(merged.replyTemplates) ||
    merged.replyTemplates.length === 0
  ) {
    throw new Error(
      'Config "replyTemplates" phai la mang va co it nhat 1 noi dung.',
    );
  }

  return merged;
}

function resolveCocCocExecutablePath(config) {
  if (
    config.cocCocExecutablePath &&
    String(config.cocCocExecutablePath).trim()
  ) {
    const customPath = String(config.cocCocExecutablePath).trim();
    if (path.isAbsolute(customPath)) {
      return customPath;
    }
    return path.resolve(process.cwd(), customPath);
  }

  const candidates = [
    "C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe",
    "C:\\Program Files (x86)\\CocCoc\\Browser\\Application\\browser.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "CocCoc",
      "Browser",
      "Application",
      "browser.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "CocCoc",
      "Browser",
      "Application",
      "browser.exe",
    ),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveChromiumExecutablePath(config) {
  if (
    config.chromiumExecutablePath &&
    String(config.chromiumExecutablePath).trim()
  ) {
    const customPath = String(config.chromiumExecutablePath).trim();
    if (path.isAbsolute(customPath)) {
      return customPath;
    }
    return path.resolve(process.cwd(), customPath);
  }

  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || "",
      "Chromium",
      "Application",
      "chrome.exe",
    ),
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function launchConfiguredBrowser(config) {
  const launchOptions = {
    headless: Boolean(config.headless),
    args: Array.isArray(config.browserArgs) ? config.browserArgs : [],
  };

  if (config.browser === "chromium") {
    const hasCustomChromiumPath =
      config.chromiumExecutablePath &&
      String(config.chromiumExecutablePath).trim();
    const chromiumPath = resolveChromiumExecutablePath(config);

    if (
      hasCustomChromiumPath &&
      (!chromiumPath || !fs.existsSync(chromiumPath))
    ) {
      throw new Error(
        'Khong tim thay Chromium. Hay set "chromiumExecutablePath" trong config (vi du: C:\\Users\\kingg\\AppData\\Local\\Chromium\\Application\\chrome.exe).',
      );
    }

    if (chromiumPath && fs.existsSync(chromiumPath)) {
      log(`Mo trinh duyet: Chromium (${chromiumPath})`);
      return chromium.launch({
        ...launchOptions,
        executablePath: chromiumPath,
      });
    }

    log("Mo trinh duyet: Chromium (Playwright bundled)");
    return chromium.launch(launchOptions);
  }

  const cocCocPath = resolveCocCocExecutablePath(config);
  if (!cocCocPath || !fs.existsSync(cocCocPath)) {
    throw new Error(
      'Khong tim thay Coc Coc. Hay set "cocCocExecutablePath" trong config (vi du: C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe).',
    );
  }

  log(`Mo trinh duyet: Coc Coc (${cocCocPath})`);
  return chromium.launch({
    ...launchOptions,
    executablePath: cocCocPath,
  });
}

function pickReply(replyTemplates, hashtag) {
  const template = replyTemplates[randomInt(0, replyTemplates.length - 1)];
  return template.replace(/\{\{hashtag\}\}/g, hashtag || "").trim();
}

async function hasVisible(locator, timeout = 2000) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function isTopMostElement(locator) {
  return locator
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return top === el || Boolean(top && el.contains(top));
    })
    .catch(() => false);
}

async function clickOne(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      const enabled = await candidate.isEnabled().catch(() => true);
      if (!enabled) {
        continue;
      }

      const topMost = await isTopMostElement(candidate);

      try {
        await candidate.scrollIntoViewIfNeeded().catch(() => null);
        if (topMost) {
          await candidate.click({ delay: randomInt(20, 120) });
        } else {
          // Fallback JS click when Playwright click is intercepted by overlay.
          await candidate.evaluate((el) => el.click());
        }
        return true;
      } catch {
        const forceClicked = await candidate
          .evaluate((el) => {
            if (!el || typeof el.click !== "function") {
              return false;
            }
            el.click();
            return true;
          })
          .catch(() => false);
        if (forceClicked) {
          return true;
        }
        continue;
      }
    }
  }
  return false;
}

async function clickOneNoScroll(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      const enabled = await candidate.isEnabled().catch(() => true);
      if (!enabled) {
        continue;
      }

      const topMost = await isTopMostElement(candidate);

      try {
        if (topMost) {
          await candidate.click({ delay: randomInt(20, 120) });
        } else {
          await candidate.evaluate((el) => el.click());
        }
        return true;
      } catch {
        const forceClicked = await candidate
          .evaluate((el) => {
            if (!el || typeof el.click !== "function") {
              return false;
            }
            el.click();
            return true;
          })
          .catch(() => false);
        if (forceClicked) {
          return true;
        }
        continue;
      }
    }
  }
  return false;
}

async function findVisibleLocator(page, selectors, timeoutMs) {
  const timeout = Number(timeoutMs) || 8000;
  const started = Date.now();

  while (Date.now() - started < timeout) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        if (!(await candidate.isVisible().catch(() => false))) {
          continue;
        }

        const editable = await candidate.isEditable().catch(() => false);

        if (editable) {
          const topMost = await isTopMostElement(candidate);
          if (!topMost) {
            continue;
          }
          return candidate;
        }
      }
    }
    await page.waitForTimeout(180);
  }

  return null;
}

async function typeOne(page, selectors, value, config, timeoutMs) {
  const timeout =
    Number(timeoutMs) ||
    Number(config.loginInputTimeoutMs) ||
    DEFAULTS.loginInputTimeoutMs;
  const target = await findVisibleLocator(page, selectors, timeout);
  if (!target) {
    return false;
  }

  const text = String(value || "");
  if (!text) {
    return false;
  }

  await typeLikeHuman(target, text, config);

  const inputValue = await target.inputValue().catch(() => "");
  if (!inputValue || inputValue.length === 0) {
    return false;
  }

  return true;
}

async function waitForAnySelector(page, selectors, timeoutMs) {
  const timeout = Number(timeoutMs) || 8000;
  const started = Date.now();

  while (Date.now() - started < timeout) {
    for (const selector of selectors) {
      if (await hasVisible(page.locator(selector), 450)) {
        return selector;
      }
    }
    await page.waitForTimeout(180);
  }

  return null;
}

async function getFirstVisibleText(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      const text = (await candidate.innerText().catch(() => "")).trim();
      if (text) {
        return text.replace(/\s+/g, " ").slice(0, 240);
      }
    }
  }

  return "";
}

async function dismissConsentIfPresent(page) {
  await clickOne(page, [
    'button:has-text("Accept all cookies")',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button[data-testid="confirmationSheetConfirm"]',
  ]);
}

async function submitStep(page, selectors, config, stepName = "step") {
  await waitStep(config, 250, 700);
  const clicked = await clickOne(page, selectors);
  if (!clicked) {
    log(`Khong thay nut ${stepName}, fallback Enter`);
    await page.keyboard.press("Enter");
  } else {
    log(`Da bam nut ${stepName}`);
  }
  await waitStep(config, 800, 1600);
}

async function getPageDebugInfo(page) {
  const url = page.url();
  const title = await page.title().catch(() => "unknown-title");
  return `URL=${url}; TITLE=${title}`;
}

async function openLoginFlow(page, config, usernameSelectors) {
  const loginUrls = [
    "https://x.com/i/flow/login",
    "https://x.com/login",
    "https://twitter.com/i/flow/login",
  ];

  for (const url of loginUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitStep(config, 900, 1800);
    await dismissConsentIfPresent(page);

    const found = await waitForAnySelector(
      page,
      usernameSelectors,
      Number(config.loginInputTimeoutMs) || DEFAULTS.loginInputTimeoutMs,
    );

    if (found) {
      return true;
    }

    await clickOne(page, [
      'a[href="/i/flow/login"]',
      'a:has-text("Sign in")',
      'a:has-text("Log in")',
    ]);

    const foundAfterClick = await waitForAnySelector(
      page,
      usernameSelectors,
      6000,
    );
    if (foundAfterClick) {
      return true;
    }
  }

  return false;
}

async function isLoggedIn(page) {
  const indicators = [
    '[data-testid="SideNav_NewTweet_Button"]',
    'a[aria-label="Profile"]',
    'a[href="/home"][aria-label]',
  ];

  for (const selector of indicators) {
    if (await hasVisible(page.locator(selector), 1000)) {
      return true;
    }
  }
  return false;
}

async function getAlivePage(context, preferredPage) {
  if (preferredPage && !preferredPage.isClosed()) {
    return preferredPage;
  }

  const pages = context.pages().filter((p) => !p.isClosed());
  if (pages.length > 0) {
    return pages[0];
  }

  return null;
}

async function ensureAlivePage(context, preferredPage, accountName, config) {
  const alivePage = await getAlivePage(context, preferredPage);
  if (alivePage) {
    return alivePage;
  }

  try {
    const recoveredPage = await context.newPage();
    const timeoutMs = Number(
      config ? config.navigationTimeoutMs : DEFAULTS.navigationTimeoutMs,
    );
    recoveredPage.setDefaultNavigationTimeout(timeoutMs);
    recoveredPage.setDefaultTimeout(timeoutMs);
    await recoveredPage
      .goto("https://x.com/home", { waitUntil: "domcontentloaded" })
      .catch(() => null);
    log(`Khong con page dang mo, da tao page moi cho ${accountName}.`);
    return recoveredPage;
  } catch {
    // Fall through to explicit error below when browser/context is already gone.
  }

  throw new Error(
    `Khong tim thay page dang hoat dong cho tai khoan ${accountName}. Co the browser da bi dong.`,
  );
}

async function recoverManualLoginPage(context, preferredPage, accountName) {
  const alivePage = await getAlivePage(context, preferredPage);
  if (alivePage) {
    return alivePage;
  }

  try {
    const newPage = await context.newPage();
    await newPage
      .goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded" })
      .catch(() => null);
    await dismissConsentIfPresent(newPage);
    log(`Khong con tab dang mo, da tao tab moi cho ${accountName}.`);
    return newPage;
  } catch {
    return null;
  }
}

async function waitForManualLogin(page, context, account, config) {
  const timeoutMs =
    Number(config.manualLoginWaitTimeoutMs) ||
    DEFAULTS.manualLoginWaitTimeoutMs;
  const started = Date.now();
  let activePage = await recoverManualLoginPage(
    context,
    page,
    account.username,
  );

  if (!activePage) {
    throw new Error(
      `Khong tim thay tab browser dang mo cho manual login tai khoan ${account.username}.`,
    );
  }

  log(
    `Che do manual login cho ${account.username}: vui long dang nhap thu cong tren cua so browser vua mo.`,
  );
  await activePage
    .goto("https://x.com/i/flow/login", {
      waitUntil: "domcontentloaded",
    })
    .catch(() => null);
  await dismissConsentIfPresent(activePage);

  while (Date.now() - started < timeoutMs) {
    activePage = await recoverManualLoginPage(
      context,
      activePage,
      account.username,
    );
    if (!activePage) {
      throw new Error(
        `Browser da bi dong trong luc cho manual login tai khoan ${account.username}.`,
      );
    }

    if (await isLoggedIn(activePage)) {
      log(`Da xac nhan dang nhap thu cong thanh cong cho ${account.username}.`);
      return activePage;
    }

    await activePage.waitForTimeout(1200).catch(() => null);
  }

  return null;
}

async function ensureLoggedIn(page, context, account, config) {
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await waitStep(config, 700, 1300);
  if (await isLoggedIn(page)) {
    return page;
  }

  if (Boolean(config.manualLogin)) {
    const manualPage = await waitForManualLogin(page, context, account, config);
    if (!manualPage) {
      const debugPage = await getAlivePage(context, page);
      const debugInfo = debugPage
        ? await getPageDebugInfo(debugPage).catch(
            () => "URL=unknown; TITLE=unknown-title",
          )
        : "URL=browser-closed; TITLE=unknown-title";
      throw new Error(
        `Qua thoi gian cho manual login (${Number(config.manualLoginWaitTimeoutMs) || DEFAULTS.manualLoginWaitTimeoutMs}ms) cho tai khoan ${account.username}. ${debugInfo}`,
      );
    }
    return manualPage;
  }

  const modalUsernameSelectors = [
    'div[data-testid="sheetDialog"] input[placeholder*="Phone, email, or username"]',
    'div[data-testid="sheetDialog"] input[name="text"]',
    'div[data-testid="sheetDialog"] input[autocomplete="username"]',
    'div[role="dialog"] input[placeholder*="Phone, email, or username"]',
    'div[role="dialog"] input[name="text"]',
    'div[role="dialog"] input[autocomplete="username"]',
  ];
  const pageUsernameSelectors = [
    'main input[placeholder*="Phone, email, or username"]',
    'main input[name="text"]',
    'main input[autocomplete="username"]',
    'input[placeholder*="Phone, email, or username"]',
    'input[name="text"]',
    'input[autocomplete="username"]',
    'input[name="session[username_or_email]"]',
  ];
  const loginProbeUsernameSelectors = [
    ...modalUsernameSelectors,
    ...pageUsernameSelectors,
  ];
  const modalChallengeSelectors = [
    'div[data-testid="sheetDialog"] input[data-testid="ocfEnterTextTextInput"]',
    'div[role="dialog"] input[data-testid="ocfEnterTextTextInput"]',
  ];
  const pageChallengeSelectors = ['input[data-testid="ocfEnterTextTextInput"]'];
  const modalPasswordSelectors = [
    'div[data-testid="sheetDialog"] input[name="password"]',
    'div[data-testid="sheetDialog"] input[autocomplete="current-password"]',
    'div[role="dialog"] input[name="password"]',
    'div[role="dialog"] input[autocomplete="current-password"]',
  ];
  const pagePasswordSelectors = [
    'input[name="password"]',
    'input[autocomplete="current-password"]',
  ];
  const modalNextButtonSelectors = [
    'div[role="dialog"] button[data-testid="ocfEnterTextNextButton"]',
    'div[data-testid="sheetDialog"] button[data-testid="ocfEnterTextNextButton"]',
    'div[role="dialog"] button:has-text("Next")',
    'div[data-testid="sheetDialog"] button:has-text("Next")',
  ];
  const commonNextButtonSelectors = [
    'button[data-testid="ocfEnterTextNextButton"]',
    'button:has-text("Next")',
    'div[role="button"]:has-text("Next")',
  ];
  const modalLoginButtonSelectors = [
    'div[role="dialog"] button[data-testid="LoginForm_Login_Button"]',
    'div[data-testid="sheetDialog"] button[data-testid="LoginForm_Login_Button"]',
    'div[role="dialog"] button:has-text("Log in")',
    'div[data-testid="sheetDialog"] button:has-text("Log in")',
  ];
  const commonLoginButtonSelectors = [
    'button[data-testid="LoginForm_Login_Button"]',
    'button:has-text("Log in")',
    'div[role="button"]:has-text("Log in")',
  ];
  const identityErrorSelectors = [
    "text=/Enter a valid phone number, email address, or username/i",
    "text=/Sorry, we could not find your account/i",
    "text=/could not find your account/i",
    "text=/Enter your phone number or username/i",
    "text=/The username and password you entered did not match our records/i",
    "text=/Something went wrong/i",
    "text=/Try again/i",
    "text=/unusual login activity/i",
  ];
  const otpSelector = 'input[inputmode="numeric"]';

  log(`Dang dang nhap tai khoan: ${account.username}`);
  const openedLoginFlow = await openLoginFlow(
    page,
    config,
    loginProbeUsernameSelectors,
  );

  if (!openedLoginFlow) {
    const debugInfo = await getPageDebugInfo(page);
    throw new Error(
      `Khong mo duoc man hinh login de nhap username cho ${account.username}. ${debugInfo}`,
    );
  }

  const isDialogLogin = await hasVisible(
    page.locator('div[role="dialog"], div[data-testid="sheetDialog"]'),
    1200,
  );
  if (isDialogLogin) {
    log("Dang o login popup dialog, uu tien selector trong dialog.");
  }

  const usernameSelectors = isDialogLogin
    ? modalUsernameSelectors
    : loginProbeUsernameSelectors;
  const challengeSelectors = isDialogLogin
    ? modalChallengeSelectors
    : [...modalChallengeSelectors, ...pageChallengeSelectors];
  const passwordSelectors = isDialogLogin
    ? modalPasswordSelectors
    : [...modalPasswordSelectors, ...pagePasswordSelectors];
  const nextButtonSelectors = isDialogLogin
    ? modalNextButtonSelectors
    : [...modalNextButtonSelectors, ...commonNextButtonSelectors];
  const loginButtonSelectors = isDialogLogin
    ? modalLoginButtonSelectors
    : [...modalLoginButtonSelectors, ...commonLoginButtonSelectors];

  const normalizedUsername = normalizeLoginIdentifier(account.username);
  const normalizedEmail = String(account.email || "").trim();
  const identityCandidates = [];

  if (normalizedEmail) {
    identityCandidates.push(normalizedEmail);
  }

  if (
    normalizedUsername &&
    !identityCandidates.some(
      (candidate) =>
        candidate.toLowerCase() === normalizedUsername.toLowerCase(),
    )
  ) {
    identityCandidates.push(normalizedUsername);
  }

  let stageSelector = null;
  let lastIdentityAttempt = "";
  for (let i = 0; i < identityCandidates.length; i += 1) {
    const identity = identityCandidates[i];
    lastIdentityAttempt = identity;
    log(
      `Thu buoc username/email lan ${i + 1}/${identityCandidates.length} bang: ${identity}`,
    );

    const enteredUser = await typeOne(
      page,
      usernameSelectors,
      identity,
      config,
      Number(config.loginInputTimeoutMs) || DEFAULTS.loginInputTimeoutMs,
    );

    if (!enteredUser) {
      continue;
    }

    await submitStep(page, nextButtonSelectors, config, "Next");

    stageSelector = await waitForAnySelector(
      page,
      [
        ...challengeSelectors,
        ...passwordSelectors,
        otpSelector,
        ...identityErrorSelectors,
        ...usernameSelectors,
      ],
      Number(config.loginInputTimeoutMs) || DEFAULTS.loginInputTimeoutMs,
    );

    if (
      stageSelector &&
      (challengeSelectors.includes(stageSelector) ||
        passwordSelectors.includes(stageSelector) ||
        stageSelector === otpSelector)
    ) {
      break;
    }

    if (stageSelector && identityErrorSelectors.includes(stageSelector)) {
      const loginHint = await getFirstVisibleText(page, [
        'div[role="dialog"] [role="alert"]',
        'div[data-testid="sheetDialog"] [role="alert"]',
        'div[role="dialog"] [data-testid*="error"]',
        'div[data-testid="sheetDialog"] [data-testid*="error"]',
      ]);
      if (loginHint) {
        log(`Login hint sau Next: ${loginHint}`);
      }
    }

    if (stageSelector && usernameSelectors.includes(stageSelector)) {
      log(
        "Da bam Next nhung van o buoc username/email. X co the tu choi identity hoac dang can challenge them.",
      );
    }
  }

  if (
    !stageSelector ||
    (!challengeSelectors.includes(stageSelector) &&
      !passwordSelectors.includes(stageSelector) &&
      stageSelector !== otpSelector)
  ) {
    const loginHint = await getFirstVisibleText(page, [
      'div[role="dialog"] [role="alert"]',
      'div[data-testid="sheetDialog"] [role="alert"]',
      'div[role="dialog"] [data-testid*="error"]',
      'div[data-testid="sheetDialog"] [data-testid*="error"]',
      'div[role="dialog"] span',
    ]);
    const debugInfo = await getPageDebugInfo(page);
    throw new Error(
      `Khong vuot qua duoc buoc nhap username/email cho tai khoan ${account.username}. lastIdentity=${lastIdentityAttempt || "unknown"}. loginHint=${loginHint || "none"}. ${debugInfo}`,
    );
  }

  if (stageSelector && challengeSelectors.includes(stageSelector)) {
    if (!account.email) {
      throw new Error(
        `Tai khoan ${account.username} can challenge email, hay bo sung truong email.`,
      );
    }

    await typeOne(page, challengeSelectors, account.email, config, 10000);
    await submitStep(page, nextButtonSelectors, config, "Next");
  }

  if (await hasVisible(page.locator(otpSelector), 1200)) {
    throw new Error(
      `Tai khoan ${account.username} dang bat 2FA/challenge, can dang nhap thu cong truoc.`,
    );
  }

  const enteredPassword = await typeOne(
    page,
    passwordSelectors,
    account.password,
    config,
    Number(config.loginInputTimeoutMs) || DEFAULTS.loginInputTimeoutMs,
  );

  if (!enteredPassword) {
    const debugInfo = await getPageDebugInfo(page);
    throw new Error(
      `Khong tim thay o nhap password cho tai khoan ${account.username}. ${debugInfo}`,
    );
  }

  await submitStep(page, loginButtonSelectors, config, "Log in");
  await waitStep(config, 1400, 2600);

  if (await hasVisible(page.locator(otpSelector), 1200)) {
    throw new Error(
      `Tai khoan ${account.username} dang bat 2FA/challenge, can dang nhap thu cong truoc.`,
    );
  }

  const loginError = page.locator(
    "text=/wrong password|incorrect|cannot find your account|enter a valid/i",
  );
  if (await hasVisible(loginError, 1400)) {
    throw new Error(
      `Tai khoan ${account.username} co the sai thong tin dang nhap hoac dang bi challenge.`,
    );
  }

  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await waitStep(config, 900, 1800);
  if (!(await isLoggedIn(page))) {
    const debugInfo = await getPageDebugInfo(page);
    throw new Error(
      `Dang nhap that bai voi tai khoan ${account.username}. ${debugInfo}`,
    );
  }

  return page;
}

function buildSearchQuery(config) {
  if (config.topicQuery && String(config.topicQuery).trim()) {
    return String(config.topicQuery).trim();
  }
  const cleanTag = String(config.hashtag || "")
    .replace(/^#/, "")
    .trim();
  return `#${cleanTag}`;
}

function buildSearchUrl(config) {
  const query = encodeURIComponent(buildSearchQuery(config));
  const tab =
    String(config.searchTab || "live").toLowerCase() === "top" ? "top" : "live";
  return `https://x.com/search?q=${query}&src=typed_query&f=${tab}`;
}

function normalizeTweetUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl, "https://x.com");
    const host = parsed.hostname.toLowerCase();
    if (
      !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host)
    ) {
      return null;
    }

    const pathMatch = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/);
    if (!pathMatch) {
      return null;
    }

    return `https://x.com/${pathMatch[1]}/status/${pathMatch[2]}`;
  } catch {
    return null;
  }
}

async function collectTweetUrls(page, maxCandidateTweets, config) {
  const limit = Math.max(
    1,
    Number(maxCandidateTweets) || DEFAULTS.maxCandidateTweets,
  );
  const maxScrollRounds = Math.max(12, Math.min(220, limit * 4));
  const seen = new Set();
  let stagnantRounds = 0;

  await waitStep(config, 1800, 3200);

  for (
    let round = 0;
    round < maxScrollRounds && seen.size < limit;
    round += 1
  ) {
    const beforeSize = seen.size;
    const urls = await page
      .$$eval('article a[href*="/status/"]', (anchors) => {
        const out = [];
        for (const a of anchors) {
          const href = a.getAttribute("href");
          if (!href) continue;
          out.push(href);
        }
        return Array.from(new Set(out));
      })
      .catch(() => []);

    for (const url of urls) {
      const normalizedUrl = normalizeTweetUrl(url);
      if (!normalizedUrl) {
        continue;
      }

      seen.add(normalizedUrl);
      if (seen.size >= limit) {
        break;
      }
    }

    if (seen.size >= limit) {
      break;
    }

    if (seen.size === beforeSize) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }

    if (stagnantRounds >= 12) {
      break;
    }

    const forwardDelta = randomInt(260, 980);
    if (randomInt(1, 100) <= 22) {
      const firstMove = Math.max(120, Math.floor(forwardDelta * 0.55));
      const secondMove = Math.max(100, forwardDelta - firstMove);

      await page.mouse.wheel(0, firstMove).catch(() => null);
      await page
        .evaluate((distance) => {
          window.scrollBy(0, distance);
        }, firstMove)
        .catch(() => null);
      await waitStep(config, 700, 1400);

      await page.mouse.wheel(0, secondMove).catch(() => null);
      await page
        .evaluate((distance) => {
          window.scrollBy(0, distance);
        }, secondMove)
        .catch(() => null);
    } else {
      await page.mouse.wheel(0, forwardDelta).catch(() => null);
      await page
        .evaluate((distance) => {
          window.scrollBy(0, distance);
        }, forwardDelta)
        .catch(() => null);
    }

    await waitStep(config, 900, 2400);

    if (randomInt(1, 100) <= 25) {
      const backwardDelta = -randomInt(70, 320);
      await page.mouse.wheel(0, backwardDelta).catch(() => null);
      await page
        .evaluate((distance) => {
          window.scrollBy(0, distance);
        }, backwardDelta)
        .catch(() => null);
      await waitStep(config, 700, 1600);
    }

    if (randomInt(1, 100) <= 12) {
      await waitStep(config, 2500, 5200);
    }
  }

  return Array.from(seen).slice(0, limit);
}

async function gotoSearch(page, config) {
  const url = buildSearchUrl(config);
  log(`Tim bai viet theo query: ${buildSearchQuery(config)}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitStep(config, 1200, 2200);

  const emptyState = page.locator("text=Try searching for something else");
  if (await hasVisible(emptyState, 2000)) {
    return [];
  }

  const requestedCandidates =
    Number(config.maxCandidateTweets) || DEFAULTS.maxCandidateTweets;
  const requestedReplies =
    Number(config.maxRepliesPerAccount) || DEFAULTS.maxRepliesPerAccount;
  const targetCandidateCount = Math.max(
    requestedCandidates,
    Math.min(600, requestedReplies * 3),
  );
  log(`Quet toi da ${targetCandidateCount} tweet URL tu ket qua tim kiem.`);

  const collected = await collectTweetUrls(page, targetCandidateCount, config);
  log(`Da thu thap ${collected.length} tweet URL hop le de comment.`);
  return collected;
}

async function getInlineReplyEditor(page) {
  const editorSelectors = [
    'main div[data-testid="tweetTextarea_0"][role="textbox"]',
    'main div[role="textbox"][data-testid="tweetTextarea_0"]',
    'main div[data-testid="tweetTextarea_0"]',
  ];

  for (const selector of editorSelectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      const topMost = await isTopMostElement(candidate);
      if (!topMost) {
        continue;
      }

      return candidate;
    }
  }

  return null;
}

async function getReplyEditor(page) {
  const editorSelectors = [
    'div[data-testid="inline_reply_offscreen"] div[data-testid="tweetTextarea_0"][role="textbox"]',
    'div[data-testid="inline_reply_offscreen"] div[role="textbox"][data-testid="tweetTextarea_0"]',
    'div[data-testid="inline_reply_offscreen"] div[data-testid="tweetTextarea_0"]',
    'main div[data-testid="tweetTextarea_0"][role="textbox"]',
    'main div[role="textbox"][data-testid="tweetTextarea_0"]',
    'main div[data-testid="tweetTextarea_0"]',
    'div[role="dialog"] div[data-testid="tweetTextarea_0"][role="textbox"]',
    'div[role="dialog"] div[role="textbox"][data-testid="tweetTextarea_0"]',
    'div[role="dialog"] div[data-testid="tweetTextarea_0"]',
    'div[data-testid="tweetTextarea_0"][role="textbox"]',
    'div[role="textbox"][data-testid="tweetTextarea_0"]',
    'div[data-testid="tweetTextarea_0"]',
  ];

  for (const selector of editorSelectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      const topMost = await isTopMostElement(candidate);
      if (!topMost) {
        continue;
      }

      return candidate;
    }
  }

  return null;
}

async function openReplyComposer(page, config) {
  const replyButtonSelectors = [
    'main button[data-testid="reply"]',
    'main div[role="button"][data-testid="reply"]',
    'button[data-testid="reply"]',
    'div[role="button"][data-testid="reply"]',
    'main button:has-text("Reply")',
    'main div[role="button"]:has-text("Reply")',
    'button:has-text("Reply")',
    'div[role="button"]:has-text("Reply")',
  ];

  const clicked = await clickOneNoScroll(page, replyButtonSelectors);
  if (!clicked) {
    return false;
  }

  const timeoutMs = Math.max(
    1500,
    Number(config && config.loginInputTimeoutMs) ||
      DEFAULTS.loginInputTimeoutMs,
  );
  const started = Date.now();
  while (Date.now() - started < Math.min(timeoutMs, 6000)) {
    if (await getReplyEditor(page).catch(() => null)) {
      break;
    }
    await waitStep(config, 250, 500);
  }

  return true;
}

async function waitForReplySubmitted(page, editor, wasDialogComposer, config) {
  const timeoutMs = Math.max(
    4000,
    Number(config && config.navigationTimeoutMs) ||
      DEFAULTS.navigationTimeoutMs,
  );
  const started = Date.now();
  const dialogLocator = page.locator('div[role="dialog"][aria-modal="true"]');

  while (Date.now() - started < timeoutMs) {
    if (wasDialogComposer) {
      const dialogVisible = await dialogLocator
        .first()
        .isVisible()
        .catch(() => false);
      if (!dialogVisible) {
        return true;
      }
    } else {
      const editorText = await editor
        .evaluate((el) => {
          const text = (el.innerText || el.textContent || "").replace(
            /\u200b/g,
            "",
          );
          return text.trim();
        })
        .catch(() => null);

      if (editorText === "") {
        return true;
      }
    }

    await page.waitForTimeout(250).catch(() => null);
  }

  return false;
}

function extractReplyPayload(replyText, config) {
  const raw = String(replyText || "");
  const imageUrls = [];
  const preferLinkCardFromAnchor = Boolean(
    config && config.preferLinkCardFromAnchor,
  );
  const stripUrlsFromReply =
    !config || typeof config.stripUrlsFromReply === "undefined"
      ? true
      : Boolean(config.stripUrlsFromReply);

  let text = raw.replace(
    /<\s*(?:img|image)\b[^>]*?(?:href|src)\s*=\s*["']([^"']+)["'][^>]*?>/gi,
    (_, href) => {
      const cleanHref = String(href || "").trim();
      if (cleanHref) {
        imageUrls.push(cleanHref);
      }
      return " ";
    },
  );

  text = text.replace(
    /<\s*a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi,
    (_, href, label) => {
      const link = String(href || "").trim();

      if (preferLinkCardFromAnchor && link) {
        return link;
      }

      const visibleText = String(label || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (visibleText && link) {
        return visibleText;
      }
      if (visibleText) {
        return visibleText;
      }
      return "";
    },
  );

  if (stripUrlsFromReply) {
    text = text.replace(/\bhttps?:\/\/[^\s<>"')]+/gi, " ");
    text = text.replace(/\bwww\.[^\s<>"')]+/gi, " ");
  }

  text = text
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text,
    imageUrls,
  };
}

function getImageExtFromUrl(imageUrl) {
  try {
    const parsed = new URL(String(imageUrl || ""));
    const ext = path.extname(parsed.pathname || "").toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
      return ext;
    }
  } catch {
    // ignore and fallback
  }
  return null;
}

function getImageExtFromContentType(contentType) {
  const value = String(contentType || "").toLowerCase();
  if (value.includes("image/jpeg") || value.includes("image/jpg")) {
    return ".jpg";
  }
  if (value.includes("image/png")) {
    return ".png";
  }
  if (value.includes("image/gif")) {
    return ".gif";
  }
  if (value.includes("image/webp")) {
    return ".webp";
  }
  return null;
}

function downloadImageBuffer(imageUrl, maxRedirects = 4) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(String(imageUrl || "").trim());
    } catch {
      reject(new Error(`Image URL khong hop le: ${imageUrl}`));
      return;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      reject(new Error(`Image URL chi ho tro http/https: ${imageUrl}`));
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(parsed, (res) => {
      const status = Number(res.statusCode) || 0;

      if (
        [301, 302, 303, 307, 308].includes(status) &&
        res.headers.location &&
        maxRedirects > 0
      ) {
        const nextUrl = new URL(res.headers.location, parsed).toString();
        res.resume();
        resolve(downloadImageBuffer(nextUrl, maxRedirects - 1));
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Khong tai duoc anh, HTTP ${status}: ${imageUrl}`));
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: String(res.headers["content-type"] || ""),
          finalUrl: parsed.toString(),
        });
      });
      res.on("error", reject);
    });

    req.setTimeout(20000, () => {
      req.destroy(new Error(`Timeout khi tai anh: ${imageUrl}`));
    });
    req.on("error", reject);
  });
}

async function downloadImageToTempFile(imageUrl) {
  const downloaded = await downloadImageBuffer(imageUrl);
  const ext =
    getImageExtFromUrl(downloaded.finalUrl || imageUrl) ||
    getImageExtFromContentType(downloaded.contentType);

  if (!ext) {
    throw new Error(`File khong phai dinh dang anh hop le: ${imageUrl}`);
  }

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "automation-comment-x-image-"),
  );
  const tempFile = path.join(tempDir, `upload${ext}`);
  await fs.promises.writeFile(tempFile, downloaded.buffer);

  return { tempDir, tempFile };
}

async function uploadImageUrlToTweet(page, editor, imageUrl, config) {
  let tempDir = null;

  try {
    const downloaded = await downloadImageToTempFile(imageUrl);
    tempDir = downloaded.tempDir;
    const uploaded = await uploadImageToTweet(
      page,
      editor,
      downloaded.tempFile,
      config,
    );
    return uploaded;
  } catch (error) {
    log(`Loi khi tai/upload anh tu URL: ${error.message || error}`);
    return false;
  } finally {
    if (tempDir) {
      await fs.promises
        .rm(tempDir, { recursive: true, force: true })
        .catch(() => null);
    }
  }
}

async function getRandomImagePath(imageDir) {
  try {
    const resolvedDir = path.resolve(imageDir || "./Image");
    if (!fs.existsSync(resolvedDir)) {
      return null;
    }

    const files = await fs.promises.readdir(resolvedDir);
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const imageFiles = files.filter((file) =>
      imageExtensions.includes(path.extname(file).toLowerCase()),
    );

    if (imageFiles.length === 0) {
      return null;
    }

    const randomFile = imageFiles[randomInt(0, imageFiles.length - 1)];
    return path.join(resolvedDir, randomFile);
  } catch {
    return null;
  }
}

async function uploadImageToTweet(page, editor, imagePath, config) {
  try {
    const resolvedImagePath = path.resolve(imagePath);
    if (!fs.existsSync(resolvedImagePath)) {
      log(`File anh khong ton tai: ${resolvedImagePath}`);
      return false;
    }

    const inputCandidates = [
      editor.locator(
        'xpath=ancestor::div[@data-testid="tweetTextarea_0"]/following::input[@data-testid="fileInput"][1]',
      ),
      page.locator(
        'main div[data-testid="toolBar"] input[data-testid="fileInput"]',
      ),
      page.locator('main input[data-testid="fileInput"]'),
      page.locator('input[data-testid="fileInput"]'),
    ];

    let targetInput = null;
    for (const candidate of inputCandidates) {
      const count = await candidate.count().catch(() => 0);
      if (count > 0) {
        targetInput = candidate.first();
        break;
      }
    }

    if (!targetInput) {
      log(`Khong tim thay input file de upload anh: ${resolvedImagePath}`);
      return false;
    }

    await targetInput.setInputFiles(resolvedImagePath);
    await waitStep(config, 900, 1800);

    const attachedToInput = await targetInput
      .evaluate((el) => Boolean(el.files && el.files.length > 0))
      .catch(() => false);

    if (!attachedToInput) {
      log(`Set input file that bai: ${resolvedImagePath}`);
      return false;
    }

    await hasVisible(
      page.locator(
        'main [data-testid="attachments"], main button[aria-label*="Remove media"]',
      ),
      2500,
    );

    log(`Da upload anh: ${resolvedImagePath}`);
    return true;
  } catch (error) {
    log(`Loi khi upload anh: ${error.message || error}`);
    return false;
  }
}
async function replyToTweet(page, tweetUrl, replyText, dryRun, config) {
  const parsedReply = extractReplyPayload(replyText, config);
  const textToSend = parsedReply.text;
  const templateImageUrls = parsedReply.imageUrls;
  const inlineOnly =
    typeof config.replyInlineOnly === "undefined"
      ? true
      : Boolean(config.replyInlineOnly);

  log(`Dang mo tweet de comment: ${tweetUrl}`);
  await page.goto(tweetUrl, { waitUntil: "domcontentloaded" });
  await waitStep(config, 1200, 2600);

  if (dryRun) {
    log(`[DRY-RUN] Se reply vao: ${tweetUrl}`);
    log(`[DRY-RUN] Noi dung: ${textToSend}`);
    if (templateImageUrls.length > 0) {
      log(`[DRY-RUN] Anh tu template: ${templateImageUrls.join(", ")}`);
    }
    return { sent: false, reason: "dry-run" };
  }

  const modalComposer = page.locator(
    'div[role="dialog"] div[data-testid="tweetTextarea_0"]',
  );
  if (await hasVisible(modalComposer, 400)) {
    await page.keyboard.press("Escape").catch(() => null);
    await waitStep(config, 250, 650);
  }

  let editor = await getInlineReplyEditor(page);
  if (!editor && !inlineOnly) {
    const opened = await openReplyComposer(page, config);
    if (opened) {
      editor = await getReplyEditor(page);
    }
  }

  if (!editor) {
    log(`Khong tim thay o comment inline tren trang tweet: ${tweetUrl}`);
    if (inlineOnly) {
      return { sent: false, reason: "inline-reply-composer-not-found" };
    }
    return { sent: false, reason: "reply-composer-not-found" };
  }

  log(`Da vao thang tweet, bat dau nhap comment inline: ${tweetUrl}`);

  await editor.click();
  let hasUploadedMedia = false;

  if (textToSend) {
    await page.keyboard.type(textToSend, {
      delay: randomInt(
        Number(config.typingMinDelayMs) || DEFAULTS.typingMinDelayMs,
        Number(config.typingMaxDelayMs) || DEFAULTS.typingMaxDelayMs,
      ),
    });
  } else {
    log(`Template khong co text, se thu gui bang media neu co: ${tweetUrl}`);
  }

  if (templateImageUrls.length > 0) {
    for (const imageUrl of templateImageUrls.slice(0, 4)) {
      const uploadedFromUrl = await uploadImageUrlToTweet(
        page,
        editor,
        imageUrl,
        config,
      );
      if (!uploadedFromUrl) {
        log(`Khong the upload anh tu template URL: ${imageUrl}`);
        if (
          !textToSend &&
          !Boolean(config.allowReplyWithoutImageOnUploadFail)
        ) {
          return { sent: false, reason: "image-upload-failed" };
        }
        log("Bo qua anh loi, tiep tuc gui reply bang text con lai.");
        continue;
      }
      hasUploadedMedia = true;
      await waitStep(config, 600, 1200);
    }
  }

  // Upload image if attachRandomImage is enabled
  if (templateImageUrls.length === 0 && Boolean(config.attachRandomImage)) {
    const imagePath = await getRandomImagePath(config.imageDir);
    if (imagePath) {
      const uploaded = await uploadImageToTweet(
        page,
        editor,
        imagePath,
        config,
      );
      if (!uploaded) {
        log(`Khong the upload anh cho tweet: ${tweetUrl}`);
        if (!textToSend) {
          return { sent: false, reason: "image-upload-failed" };
        }
        log("Bo qua anh random bi loi, tiep tuc gui reply bang text.");
      } else {
        hasUploadedMedia = true;
      }
    } else {
      log(`Khong tim thay anh de attach trong: ${config.imageDir}`);
      if (!textToSend) {
        return { sent: false, reason: "image-not-found" };
      }
      log("Khong tim thay anh random, tiep tuc gui reply bang text.");
    }
  }

  if (!textToSend && !hasUploadedMedia) {
    log(`Khong con noi dung hop le de gui sau khi xu ly template: ${tweetUrl}`);
    return { sent: false, reason: "empty-reply-content" };
  }

  const sendSelectors = inlineOnly
    ? [
        'main button[data-testid="tweetButtonInline"]',
        'main div[role="button"][data-testid="tweetButtonInline"]',
        'main div[data-testid="inline_reply_offscreen"] button[data-testid="tweetButton"]',
      ]
    : [
        'main button[data-testid="tweetButtonInline"]',
        'main button[data-testid="tweetButton"]',
        'main div[role="button"][data-testid="tweetButton"]',
        'main button:has-text("Reply")',
      ];

  const clickedSend = await clickOneNoScroll(page, sendSelectors);
  if (!clickedSend) {
    log(`Khong tim thay nut gui reply cho tweet: ${tweetUrl}`);
    return { sent: false, reason: "send-button-not-found" };
  }

  log(`Da bam gui comment cho tweet: ${tweetUrl}`);

  const submitted = await waitForReplySubmitted(page, editor, false, config);
  if (!submitted) {
    log(`Da bam Reply nhung khong xac nhan duoc submit: ${tweetUrl}`);
    return { sent: false, reason: "reply-not-submitted" };
  }

  await waitStep(config, 800, 1600);
  const rateLimit = page.locator("text=/rate limit|try again later/i");
  if (await hasVisible(rateLimit, 1200)) {
    log(`Bi rate-limit khi comment tweet: ${tweetUrl}`);
    return { sent: false, reason: "rate-limit" };
  }

  log(`Comment thanh cong: ${tweetUrl}`);
  return { sent: true, reason: "ok" };
}

async function saveDebugScreenshot(page, config, accountName) {
  if (!Boolean(config.saveDebugScreenshotOnError)) {
    return null;
  }

  const reportDir = path.resolve(config.reportDir || DEFAULTS.reportDir);
  const debugDir = path.join(reportDir, "debug");
  await ensureDir(debugDir);

  const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const filePath = path.join(
    debugDir,
    `${sanitizeFileName(accountName)}-${stamp}.png`,
  );

  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function processAccount(browser, account, config) {
  const manualLogin = Boolean(config.manualLogin);
  if (!account.username || (!manualLogin && !account.password)) {
    throw new Error(
      "Moi account phai co username. Neu manualLogin=false thi bat buoc co password.",
    );
  }

  const createFreshProfile = Boolean(config.createFreshProfile);
  const saveSessionState = Boolean(config.saveSessionState);
  const usePerUsernameCocCocProfile =
    config.browser === "coccoc" &&
    Boolean(config.createCocCocProfilePerUsername);

  const sessionDir = path.resolve(config.sessionDir || DEFAULTS.sessionDir);
  await ensureDir(sessionDir);

  const statePath = path.join(
    sessionDir,
    `${sanitizeFileName(account.username)}.json`,
  );

  const contextOptions = {
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  };

  let context;
  let page;

  if (usePerUsernameCocCocProfile) {
    const cocCocPath = resolveCocCocExecutablePath(config);
    if (!cocCocPath || !fs.existsSync(cocCocPath)) {
      throw new Error(
        'Khong tim thay Coc Coc. Hay set "cocCocExecutablePath" trong config (vi du: C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe).',
      );
    }

    const profileRoot = path.resolve(
      config.cocCocProfilesDir || DEFAULTS.cocCocProfilesDir,
    );
    await ensureDir(profileRoot);
    const profileDir = path.join(
      profileRoot,
      sanitizeFileName(account.username),
    );

    if (createFreshProfile) {
      const removed = await removeDirIfExists(profileDir).catch(() => false);
      if (removed) {
        log(`Da xoa profile Coc Coc cu cho ${account.username}`);
      }
    }

    await ensureDir(profileDir);
    log(`Su dung profile Coc Coc rieng cho ${account.username}: ${profileDir}`);

    context = await chromium.launchPersistentContext(profileDir, {
      ...contextOptions,
      headless: Boolean(config.headless),
      executablePath: cocCocPath,
      args: Array.isArray(config.browserArgs) ? config.browserArgs : [],
    });
    page = context.pages().length
      ? context.pages()[0]
      : await context.newPage();
  } else {
    if (createFreshProfile) {
      const removed = await removeFileIfExists(statePath).catch(() => false);
      if (removed) {
        log(`Da xoa session cu va mo tab an danh cho ${account.username}`);
      } else {
        log(
          `Mo tab an danh cho ${account.username} (khong dung cache/session cu)`,
        );
      }
    }

    if (!createFreshProfile && fs.existsSync(statePath)) {
      contextOptions.storageState = statePath;
    }

    if (!browser) {
      throw new Error("Browser chua duoc khoi tao.");
    }

    context = await browser.newContext(contextOptions);
    page = await context.newPage();
  }

  const timeoutMs =
    Number(config.navigationTimeoutMs) || DEFAULTS.navigationTimeoutMs;
  page.setDefaultNavigationTimeout(timeoutMs);
  page.setDefaultTimeout(timeoutMs);

  const accountReport = {
    account: account.username,
    searchedQuery: buildSearchQuery(config),
    success: false,
    replied: 0,
    attemptedTweets: 0,
    skipped: [],
    errors: [],
  };

  try {
    page = await ensureLoggedIn(page, context, account, config);
    page = await ensureAlivePage(context, page, account.username, config);

    if (saveSessionState && !usePerUsernameCocCocProfile) {
      await context.storageState({ path: statePath });
    }

    const tweetUrls = await gotoSearch(page, config);
    if (!tweetUrls.length) {
      accountReport.success = true;
      accountReport.errors.push("Khong tim thay tweet phu hop voi query.");
      return accountReport;
    }

    let replied = 0;
    let fatalStopReason = "";
    const maxReplies =
      Number(config.maxRepliesPerAccount) || DEFAULTS.maxRepliesPerAccount;

    for (const tweetUrl of tweetUrls) {
      if (replied >= maxReplies) break;

      page = await ensureAlivePage(context, page, account.username, config);

      const replyText = pickReply(config.replyTemplates, config.hashtag);
      accountReport.attemptedTweets += 1;

      try {
        const result = await replyToTweet(
          page,
          tweetUrl,
          replyText,
          Boolean(config.dryRun),
          config,
        );
        if (result.sent || result.reason === "dry-run") {
          replied += 1;
          log(
            `Tweet OK (${replied}/${maxReplies}) - ${tweetUrl} - reason=${result.reason}`,
          );
        } else {
          accountReport.skipped.push({ tweetUrl, reason: result.reason });
          log(`Tweet SKIP - ${tweetUrl} - reason=${result.reason}`);
        }
      } catch (tweetError) {
        const recoveredPage = await ensureAlivePage(
          context,
          page,
          account.username,
          config,
        ).catch(() => null);
        if (!recoveredPage) {
          fatalStopReason = `Khong the khoi phuc page de tiep tuc auto comment. lastError=${String(
            tweetError.message || tweetError,
          )
            .replace(/\s+/g, " ")
            .slice(0, 220)}`;
          break;
        }
        page = recoveredPage;

        const reason = String(tweetError.message || tweetError)
          .replace(/\s+/g, " ")
          .slice(0, 220);
        accountReport.skipped.push({
          tweetUrl,
          reason: `tweet-error: ${reason}`,
        });
        log(`Tweet ERROR - ${tweetUrl} - ${reason}`);
      }

      await waitRandom(config);
    }

    accountReport.replied = replied;
    if (fatalStopReason) {
      accountReport.success = false;
      accountReport.errors.push(fatalStopReason);
      return accountReport;
    }

    accountReport.success = true;
    return accountReport;
  } catch (error) {
    accountReport.errors.push(error.message || String(error));
    const screenshotPath = await saveDebugScreenshot(
      page,
      config,
      account.username,
    ).catch(() => null);
    if (screenshotPath) {
      accountReport.errors.push(`Debug screenshot: ${screenshotPath}`);
    }
    return accountReport;
  } finally {
    await context.close();
  }
}

async function writeReport(config, report) {
  const reportDir = path.resolve(config.reportDir || DEFAULTS.reportDir);
  await ensureDir(reportDir);

  const now = new Date();
  const stamp = now.toISOString().replace(/:/g, "-").replace(/\..+/, "");

  const filePath = path.join(reportDir, `run-${stamp}.json`);
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(report, null, 2),
    "utf8",
  );
  return filePath;
}

async function main() {
  const args = parseArgs(process.argv);
  const accountsPath = path.resolve(
    process.cwd(),
    args.accounts || "./input/accounts.json",
  );
  const configPath = path.resolve(
    process.cwd(),
    args.config || "./input/config.json",
  );

  if (!fs.existsSync(accountsPath)) {
    throw new Error(`Khong tim thay file accounts: ${accountsPath}`);
  }
  if (!fs.existsSync(configPath)) {
    throw new Error(`Khong tim thay file config: ${configPath}`);
  }

  const accounts = await readJson(accountsPath);
  const config = normalizeConfig(await readJson(configPath));

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("File accounts phai la array va khong duoc rong.");
  }

  log(
    `Bat dau chay voi ${accounts.length} tai khoan. dryRun=${Boolean(config.dryRun)}, manualLogin=${Boolean(config.manualLogin)}`,
  );
  const usePerUsernameCocCocProfile =
    config.browser === "coccoc" &&
    Boolean(config.createCocCocProfilePerUsername);

  let browser = null;
  if (usePerUsernameCocCocProfile) {
    const cocCocPath = resolveCocCocExecutablePath(config);
    if (!cocCocPath || !fs.existsSync(cocCocPath)) {
      throw new Error(
        'Khong tim thay Coc Coc. Hay set "cocCocExecutablePath" trong config (vi du: C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe).',
      );
    }
    log("Che do profile Coc Coc rieng theo username: BAT");
    log(`Duong dan Coc Coc: ${cocCocPath}`);
  } else {
    log("Che do tab an danh: BAT");
    browser = await launchConfiguredBrowser(config);
  }

  const report = {
    startedAt: new Date().toISOString(),
    dryRun: Boolean(config.dryRun),
    searchQuery: buildSearchQuery(config),
    resultByAccount: [],
  };

  try {
    for (const account of accounts) {
      const oneResult = await processAccount(browser, account, config);
      report.resultByAccount.push(oneResult);
      log(
        `Tai khoan ${oneResult.account}: success=${oneResult.success}, replied=${oneResult.replied}, attempted=${oneResult.attemptedTweets}`,
      );
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = await writeReport(config, report);
  log(`Hoan tat. Report: ${reportPath}`);
}

main().catch((error) => {
  console.error("[FATAL]", error.message || error);
  process.exitCode = 1;
});
