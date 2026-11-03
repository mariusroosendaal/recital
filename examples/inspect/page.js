// What's on the page: its height, headings, links and buttons in view order, with their boxes,
// and screenshots down the page into output/probe/
import fs from "node:fs";

export default async function (page) {
  await page.waitForTimeout(3000);
  fs.mkdirSync("output/probe", { recursive: true });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0, i = 0; y < height && i < 14; y += 900, i++) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `output/probe/${String(i).padStart(2, "0")}-${y}.png` });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const items = await page.evaluate(() =>
    [...document.querySelectorAll("h1, h2, h3, a, button, input, [role=button], [role=tab]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 70);
        return r.width && r.height ? `${el.tagName.toLowerCase()} [${Math.round(r.x)},${Math.round(r.y + scrollY)} ${Math.round(r.width)}×${Math.round(r.height)}] ${text}${el.href ? " → " + el.href : ""}` : null;
      })
      .filter(Boolean),
  );
  return { title: await page.title(), height, items };
}
