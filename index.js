const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json());

// 📦 In-memory rate limit tracker
const rateLimitData = {};

// 🛡️ Rate Limiting Logic
function isRateLimited(email, orderNumber) {
  const key = `${email}_${orderNumber}`;
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

  if (!rateLimitData[key]) {
    rateLimitData[key] = { timestamps: [] };
  }

  const recent = rateLimitData[key].timestamps;
  rateLimitData[key].timestamps = recent.filter(ts => now - ts <= ONE_WEEK);

  if (recent.length > 0 && now - recent[recent.length - 1] < FIVE_MINUTES) {
    const wait = Math.ceil((FIVE_MINUTES - (now - recent[recent.length - 1])) / 1000);
    return { limited: true, message: `⏳ Wait ${wait}s before requesting again.` };
  }

  if (rateLimitData[key].timestamps.length >= 5) {
    return { limited: true, message: `🚫 Weekly limit reached (5 codes).` };
  }

  rateLimitData[key].timestamps.push(now);
  return { limited: false };
}

// ✅ Root status page
app.get('/', (req, res) => {
  res.send(`
    <h2>✅ FunPay Code Bot is Running</h2>
    <p>Use <code>POST /api/get-code</code> to retrieve a code.</p>
    <ul>
      <li>⏱️ Max 1 code every 5 minutes</li>
      <li>📅 Max 5 codes per week per email + order number</li>
    </ul>
  `);
});

// 🚀 Main Code Retrieval Endpoint
app.post('/api/get-code', async (req, res) => {
  const { email, orderNumber } = req.body;

  if (!email || !orderNumber) {
    return res.status(400).json({ error: '❗Missing email or order number' });
  }

  const rateCheck = isRateLimited(email, orderNumber);
  if (rateCheck.limited) {
    return res.status(429).json({ error: rateCheck.message });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto('https://funpay.com/en/users/816450/', { waitUntil: 'domcontentloaded' });

    // 🧠 Send the "/code" command
    await page.waitForSelector('textarea');
    await page.type('textarea', '/code');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000); // Wait for response

    // 🧠 Grab the last chat message
    const code = await page.evaluate(() => {
      const messages = document.querySelectorAll('.chat-message');
      if (!messages.length) return null;
      return messages[messages.length - 1].innerText.trim();
    });

    await browser.close();
    return res.json({ code: code || '⚠️ No code received from FunPay' });

  } catch (err) {
    if (browser) await browser.close();
    console.error('[Bot Error]', err.message);
    return res.status(500).json({ error: '🤖 Bot error: ' + err.message });
  }
});

// 🔊 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ FunPay Code Bot running on port ${PORT}`);
});
