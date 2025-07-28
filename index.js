const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
app.use(express.json());

const rateLimitData = {};

function isRateLimited(email, orderNumber) {
  const key = `${email}_${orderNumber}`;
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  if (!rateLimitData[key]) {
    rateLimitData[key] = { timestamps: [] };
  }

  const recent = rateLimitData[key].timestamps;
  rateLimitData[key].timestamps = recent.filter(ts => now - ts <= oneWeek);

  if (recent.length > 0 && now - recent[recent.length - 1] < fiveMinutes) {
    const waitTime = Math.ceil((fiveMinutes - (now - recent[recent.length - 1])) / 1000);
    return { limited: true, message: `Wait ${waitTime} seconds before requesting again.` };
  }

  if (rateLimitData[key].timestamps.length >= 5) {
    return { limited: true, message: `You’ve reached your limit of 5 codes per week.` };
  }

  rateLimitData[key].timestamps.push(now);
  return { limited: false };
}

app.post('/api/get-code', async (req, res) => {
  const { email, orderNumber } = req.body;
  if (!email || !orderNumber) return res.status(400).json({ error: 'Missing data' });

  const rateCheck = isRateLimited(email, orderNumber);
  if (rateCheck.limited) return res.status(429).json({ error: rateCheck.message });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto('https://funpay.com/en/users/816450/', { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('textarea');
    await page.type('textarea', '/code');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    const code = await page.evaluate(() => {
      const msgs = document.querySelectorAll('.chat-message');
      if (!msgs.length) return null;
      return msgs[msgs.length - 1].innerText.trim();
    });

    await browser.close();
    res.json({ code: code || 'No code returned from FunPay' });
  } catch (err) {
    await browser.close();
    console.error(err);
    res.status(500).json({ error: 'Bot error: ' + err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bot listening on port ${port}`));
