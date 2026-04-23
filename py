import random
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from subprocess import CREATE_NO_WINDOW  # thêm dòng này

# ===== CẤU HÌNH =====
URL = "https://cliphot.hoahuit.workers.dev/"
COUNT = 10000
WORKERS = 2

CHROME_PATH = "D://chrome-win//chrome.exe"
DRIVER_PATH = "C://Users//admin//Downloads//chrom149//chromedriver-win64//chromedriver.exe"

MOBILE_PROFILES = [
    # Mobile Safari iPhone
    {"ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1", "width": 390, "height": 844, "dpr": 3.0, "platform": "iPhone Safari"},
    {"ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1", "width": 393, "height": 852, "dpr": 3.0, "platform": "iPhone Safari"},
    {"ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1", "width": 375, "height": 812, "dpr": 3.0, "platform": "iPhone Safari"},
    {"ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Mobile/15E148 Safari/604.1", "width": 375, "height": 667, "dpr": 2.0, "platform": "iPhone Safari"},
    # iPad Safari
    {"ua": "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "width": 820, "height": 1180, "dpr": 2.0, "platform": "iPad Safari"},
    # Twitter in-app
    {"ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Twitter for iPhone/10.29", "width": 390, "height": 844, "dpr": 3.0, "platform": "Twitter iOS"},
    {"ua": "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 TwitterAndroid/10.29", "width": 360, "height": 800, "dpr": 3.0, "platform": "Twitter Android"},
]

PROXIES = []

CHROME_FINGERPRINT = """
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const p = [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client', filename: 'internal-nacl-plugin' },
            ];
            p.refresh = () => {}; p.item = (i) => p[i];
            p.namedItem = (n) => p.find(x => x.name === n);
            Object.setPrototypeOf(p, PluginArray.prototype);
            return p;
        }
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
    window.chrome = {
        runtime: { connect: () => {}, sendMessage: () => {}, onMessage: { addListener: () => {} } },
        loadTimes: () => ({}), csi: () => ({}),
    };
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
        const ctx = this.getContext('2d');
        if (ctx) {
            const d = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < d.data.length; i += 400) d.data[i] ^= Math.floor(Math.random() * 3);
            ctx.putImageData(d, 0, 0);
        }
        return origToDataURL.apply(this, arguments);
    };
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Google Inc. (NVIDIA)';
        if (p === 37446) return 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)';
        return getParam.apply(this, arguments);
    };
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
        window.navigator.permissions.query = (parameters) =>
            parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : origQuery(parameters);
    }
"""

SAFARI_FINGERPRINT = """
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [] });
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
    try { delete window.chrome; } catch(e) {}
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
        const ctx = this.getContext('2d');
        if (ctx) {
            const d = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < d.data.length; i += 400) d.data[i] ^= Math.floor(Math.random() * 3);
            ctx.putImageData(d, 0, 0);
        }
        return origToDataURL.apply(this, arguments);
    };
"""

AD_DOMAINS = [
    "googlesyndication", "doubleclick", "adservice", "googleadservices",
    "adnxs", "adsystem", "adclick", "exoclick", "trafficjunky",
    "adsterra", "propellerads", "mgid", "taboola", "outbrain",
    "revcontent", "valueclick", "adform", "rubiconproject", "openx",
    "pubmatic", "criteo", "advertising", "adskeeper", "hilltopads",
    "adcash", "popads", "popcash", "clickadu", "evadav",
]

AD_SELECTORS = [
    "ins.adsbygoogle",
    "[id*='google_ads']", "[id*='aswift']", "[id*='ad-']", "[id*='-ad']",
    "[id*='banner']", "[id*='sponsor']", "[id*='promo']",
    "[class*='ad-']", "[class*='-ad']", "[class*='adsbygoogle']",
    "[class*='banner']", "[class*='sponsor']", "[class*='advertisement']",
    "[class*='promoted']", "[class*='dfp']", "[class*='adsense']",
    "[data-ad]", "[data-adunit]", "[data-ad-slot]",
    "a[href*='track']", "a[href*='aclick']", "a[href*='adclick']",
    "a[href*='redirect']", "a[href*='aff']", "a[href*='ref=']",
]


def create_driver(profile):
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--blink-settings=imagesEnabled=false")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-infobars")
    options.add_argument("--lang=vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7")
    options.add_argument(f"--user-agent={profile['ua']}")
    options.add_argument(f"--window-size={profile['width']},{profile['height']}")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    if PROXIES:
        options.add_argument(f"--proxy-server={random.choice(PROXIES)}")

    options.binary_location = CHROME_PATH

    # ✅ chỉ tạo 1 driver duy nhất
    service = Service(
        executable_path=DRIVER_PATH,
        creationflags=CREATE_NO_WINDOW
    )

    driver = webdriver.Chrome(service=service, options=options)

    # ✅ apply config SAU khi tạo driver
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": profile["width"],
        "height": profile["height"],
        "deviceScaleFactor": profile["dpr"],
        "mobile": True,
        "hasTouch": True,
    })

    driver.execute_cdp_cmd("Emulation.setLocaleOverride", {"locale": "vi-VN"})

    # fingerprint
    is_safari = "Safari" in profile["platform"] or "iPad" in profile["platform"]
    script = SAFARI_FINGERPRINT if is_safari else CHROME_FINGERPRINT

    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": script}
    )

    return driver
# ===== SCROLL =====
def human_touch_scroll(driver):
    for _ in range(random.randint(5, 10)):
        driver.execute_script(f"window.scrollBy({{top:{random.randint(150,400)}, behavior:'smooth'}});")
        time.sleep(random.uniform(0.6, 2.0))
    if random.random() < 0.5:
        driver.execute_script(f"window.scrollBy({{top:-{random.randint(200,500)}, behavior:'smooth'}});")
        time.sleep(random.uniform(1.0, 2.5))
    driver.execute_script("window.scrollTo({top: document.body.scrollHeight, behavior:'smooth'});")
    time.sleep(random.uniform(1.5, 3.0))


# ===== MOUSE =====
def human_mouse_move(driver, profile):
    try:
        action = ActionChains(driver)
        for _ in range(random.randint(4, 8)):
            x = random.randint(30, profile["width"] - 30)
            y = random.randint(100, profile["height"] - 100)
            action.move_by_offset(x, y)
            time.sleep(random.uniform(0.1, 0.4))
        action.perform()
    except Exception:
        pass


# ===== ĐÓNG TAB MỚI =====
def close_new_tabs(driver):
    try:
        if len(driver.window_handles) > 1:
            for handle in driver.window_handles[1:]:
                driver.switch_to.window(handle)
                time.sleep(random.uniform(3, 6))
                driver.close()
            driver.switch_to.window(driver.window_handles[0])
    except Exception:
        pass


# ===== CLICK AN TOÀN =====
def safe_click(driver, element):
    try:
        driver.execute_script("arguments[0].scrollIntoView({block:'center', behavior:'smooth'});", element)
        time.sleep(random.uniform(0.8, 1.5))
        ActionChains(driver).move_to_element(element).pause(random.uniform(0.3, 0.8)).click().perform()
        return True
    except Exception:
        try:
            driver.execute_script("arguments[0].click();", element)
            return True
        except Exception:
            return False


# ===== SCAN IFRAME =====
def scan_ad_iframes(driver):
    found = []
    try:
        for i, iframe in enumerate(driver.find_elements(By.TAG_NAME, "iframe")):
            try:
                src  = (iframe.get_attribute("src")   or "").lower()
                id_  = (iframe.get_attribute("id")    or "").lower()
                name = (iframe.get_attribute("name")  or "").lower()
                cls  = (iframe.get_attribute("class") or "").lower()
                w    = iframe.size.get("width", 0)
                h    = iframe.size.get("height", 0)
                is_ad = (
                    any(d in src for d in AD_DOMAINS) or
                    any(k in id_ + name + cls for k in ["ad", "banner", "sponsor", "promo", "dfp"])
                )
                if is_ad and w > 30 and h > 20 and iframe.is_displayed():
                    found.append(iframe)
            except Exception:
                continue
    except Exception:
        pass
    return found


# ===== CLICK IFRAME =====
def click_inside_iframe(driver, iframe):
    try:
        driver.switch_to.frame(iframe)
        time.sleep(random.uniform(0.5, 1.0))
        links = [l for l in driver.find_elements(By.TAG_NAME, "a") if l.is_displayed()]
        if links:
            ActionChains(driver).move_to_element(random.choice(links)).pause(0.5).click().perform()
        else:
            w = int(driver.execute_script("return window.innerWidth"))
            h = int(driver.execute_script("return window.innerHeight"))
            driver.execute_script(f"document.elementFromPoint({w//2},{h//2})?.click()")
        driver.switch_to.default_content()
        time.sleep(random.uniform(1, 2))
        close_new_tabs(driver)
        return True
    except Exception:
        try: driver.switch_to.default_content()
        except Exception: pass
        return False


# ===== SCAN & CLICK ADS =====
def scan_and_click_ads(driver, idx):
    clicked = False

    # Tầng 1: iframe
    iframes = scan_ad_iframes(driver)
    if iframes:
        iframe = random.choice(iframes)
        driver.execute_script("arguments[0].scrollIntoView({block:'center', behavior:'smooth'});", iframe)
        time.sleep(random.uniform(1, 2))
        clicked = click_inside_iframe(driver, iframe)
        if clicked: print(f"  [{idx}] ️  T1 iframe")

    # Tầng 2: ad elements
    if not clicked:
        for selector in AD_SELECTORS:
            try:
                els = [e for e in driver.find_elements(By.CSS_SELECTOR, selector)
                       if e.is_displayed() and e.size.get("width", 0) > 30]
                if els:
                    if safe_click(driver, random.choice(els[:5])):
                        print(f"  [{idx}] ️  T2 element: {selector}")
                        time.sleep(random.uniform(1, 2))
                        close_new_tabs(driver)
                        clicked = True
                        break
            except Exception:
                continue

    # Tầng 3: ad links
    if not clicked:
        try:
            ad_links = [
                l for l in driver.find_elements(By.TAG_NAME, "a")
                if l.is_displayed() and (
                    any(d in (l.get_attribute("href") or "").lower() for d in AD_DOMAINS) or
                    any(k in (l.get_attribute("href") or "").lower() for k in ["track","click","aff","redirect","promo"])
                )
            ]
            if ad_links:
                if safe_click(driver, random.choice(ad_links)):
                    print(f"  [{idx}] ️  T3 ad link")
                    time.sleep(random.uniform(1, 2))
                    close_new_tabs(driver)
                    clicked = True
        except Exception:
            pass

    # Tầng 4: fallback
    if not clicked:
        try:
            links = [
                l for l in driver.find_elements(By.TAG_NAME, "a")
                if l.is_displayed()
                and l.size.get("width", 0) > 20
                and (l.get_attribute("href") or "")
                and "javascript" not in (l.get_attribute("href") or "")
                and (l.get_attribute("href") or "").strip() != "#"
            ]
            if links:
                if safe_click(driver, random.choice(links[:10])):
                    print(f"  [{idx}] ️  T4 fallback")
                    time.sleep(random.uniform(1, 2))
                    close_new_tabs(driver)
                    clicked = True
        except Exception:
            pass

    if not clicked:
        print(f"  [{idx}] ❌ Không click được")
    return clicked


# ===== CHẠY 1 LẦN =====
def run_once(idx):
    profile = random.choice(MOBILE_PROFILES)
    driver = create_driver(profile)
    try:
        time.sleep(random.uniform(1, 3))
        start = time.time()
        driver.get(URL)

        time.sleep(random.uniform(4, 7))
        final_url = driver.current_url
        print(f"[{idx}]  [{profile['platform']}] {final_url[:70]}")

        human_mouse_move(driver, profile)
        time.sleep(random.uniform(1, 3))

        human_touch_scroll(driver)
        time.sleep(random.uniform(2, 4))

        driver.execute_script("window.scrollTo({top:0, behavior:'smooth'});")
        time.sleep(random.uniform(1, 2))

        scan_and_click_ads(driver, idx)

        time.sleep(random.uniform(6, 12))
        load_time = round(time.time() - start, 2)
        print(f"[{idx}] ✅ Done | {load_time}s | {profile['platform']}")

    except Exception as e:
        print(f"[{idx}] ❌ ERROR: {e}")
    finally:
        driver.quit()


# ===== KIỂM TRA PROXY =====
def check_proxy(proxy_url):
    try:
        r = requests.get("https://api.ipify.org?format=json",
                         proxies={"http": proxy_url, "https": proxy_url}, timeout=8)
        return r.json().get("ip", "unknown")
    except Exception:
        return None


# ===== MAIN =====
def main():
    print(f" Chạy {COUNT} lượt | {WORKERS} workers song song")
    print("-" * 50)

    if PROXIES:
        print(" Kiểm tra proxy...")
        for p in PROXIES:
            ip = check_proxy(p)
            print(f"  {p[:40]} → {'✅ ' + ip if ip else '❌ Lỗi'}")
        print("-" * 50)

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(run_once, i): i for i in range(1, COUNT + 1)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                future.result()
            except Exception as e:
                print(f"[{idx}]  Worker crash: {e}")

    print("-" * 50)
    print("✅ Done")


if __name__ == "__main__":
    main()
