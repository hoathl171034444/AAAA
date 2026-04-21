# Automation Comment X (Node.js)

Tool nay tu dong:
- Dang nhap nhieu tai khoan X.
- Tim bai viet theo hashtag/topic.
- Reply theo noi dung da cau hinh.

## 1 Cai dat

```bash
npm install
```

Mac dinh tool se mo bang Coc Coc (khong can cai browser Chromium cua Playwright).

## 2 Chuan bi input

- Tao file `input/accounts.json` tu mau `input/accounts.example.json`.
- Tao file `input/config.json` tu mau `input/config.example.json`.

## 3 Chay dry-run truoc (khong dang comment)

```bash
node src/index.js --accounts ./input/accounts.json --config ./input/config.json
```

`dryRun: true` trong config se chi mo tweet va in log, khong bam nut gui comment.

## 4 Chay that

- Dat `dryRun` thanh `false` trong `input/config.json`.
- Chay lai lenh.

## Ghi chu quan trong

- Ban nen su dung cho muc dich hop phap, tuan thu Terms cua X.
- Neu tai khoan bat xac minh bo sung (2FA/challenge), tool se dung va bao loi.
- Tool co 2 lop delay:
	- `stepMinDelayMs` / `stepMaxDelayMs`: delay giua cac thao tac nho (mo trang, bam nut, nhap lieu).
	- `minDelayMs` / `maxDelayMs`: delay giua cac lan reply.
- Neu login fail, tool se chup anh debug vao thu muc `reports/debug` (khi `saveDebugScreenshotOnError=true`).

## Cac key quan trong trong config

- `browser`: `coccoc` (mac dinh) hoac `chromium`.
- `chromiumExecutablePath`: duong dan file `chrome.exe` cua Chromium (de trong neu muon dung Chromium bundled cua Playwright).
- `cocCocExecutablePath`: duong dan file `browser.exe` cua Coc Coc.
- `browserArgs`: danh sach tham so khi mo browser.
- `createCocCocProfilePerUsername`: `true` de moi username co 1 ho so Coc Coc rieng.
- `cocCocProfilesDir`: thu muc chua cac ho so Coc Coc theo username.
- `createFreshProfile`: `true` de moi lan chay tao profile login moi (xoa session cu cua tai khoan).
- `saveSessionState`: `false` de khong luu lai session sau khi chay. Bat `true` neu muon tai su dung session.
- `manualLogin`: `true` de tool mo login va cho ban dang nhap thu cong, sau do moi tiep tuc.
- `manualLoginWaitTimeoutMs`: thoi gian cho dang nhap thu cong (ms), vi du `600000` = 10 phut.
- `loginInputTimeoutMs`: tang timeout de cho giao dien login tai cham.
- `navigationTimeoutMs`: timeout cho moi lan di chuyen trang.
- `typingMinDelayMs` / `typingMaxDelayMs`: toc do go phim khi nhap username/password/comment.

## Tham so CLI

- `--accounts`: duong dan file JSON danh sach tai khoan.
- `--config`: duong dan file JSON cau hinh hashtag/topic/noi dung.

Vi du:

```bash
node src/index.js --accounts ./input/accounts.json --config ./input/config.json
```
