export default function handler(req, res) {
  const target = req.query.to;

  // whitelist để tránh bị abuse
  const ALLOW = ["https://offer1.com", "https://offer2.com"];

  const target = ALLOW[Math.floor(Math.random() * ALLOW.length)];

  if (!target || !ALLOW.includes(target)) {
    return res.status(400).send("Invalid target");
  }

  res.setHeader("Content-Type", "text/html");

  res.send(`
    <html>
      <head>
        <title>Redirecting...</title>
        <meta name="robots" content="noindex">
      </head>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Đang chuyển hướng...</h2>
        <p>Click bên dưới để tiếp tục</p>

        <a href="${target}" rel="nofollow noopener"
           style="display:inline-block;margin-top:20px;padding:12px 20px;background:black;color:white;text-decoration:none">
           Continue
        </a>
      </body>
    </html>
  `);
}
