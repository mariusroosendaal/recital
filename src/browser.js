import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";
import { PROFILE_DIR, SCALE, VIEWPORT, headless } from "./config.js";
import { cursorAssets, cursorScript } from "./cursor.js";

// Playwright's Chromium, else Google Chrome: Playwright downloads Chromium in a Node process
// of its own, which Claude Desktop's built-in Node can't start (see mcp.js)
const CHROME = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/opt/google/chrome/chrome",
  win32: `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
}[process.platform];
export const chromiumInstalled = () => fs.existsSync(chromium.executablePath());
export const chromeInstalled = () => Boolean(CHROME && fs.existsSync(CHROME));
export const useChrome = () => !chromiumInstalled() && chromeInstalled();

export async function launch({ viewport = VIEWPORT, scale = SCALE, cursors } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    // Headless, the full browser (the "chromium" channel) rather than the headless shell, so
    // pages render as they do headed
    ...(headless() ? { headless: true, channel: "chromium" } : { headless: false }),
    ...(useChrome() && { channel: "chrome" }),
    viewport,
    deviceScaleFactor: scale,
    // Apps that follow the system theme start light; scenarios can switch it (see cli.js)
    colorScheme: "light",
    // The cursor's <style> and data: images are inline: a page's CSP (a nonce in style-src
    // turns off 'unsafe-inline') would show every shape at once
    bypassCSP: true,
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      // Render at the take's pixel ratio whatever the display's: on a 1× display (an external
      // monitor, CI) the screencast otherwise comes at half the size
      `--force-device-scale-factor=${scale}`,
      // Keep rendering at full rate when the window is covered or unfocused
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });
  await context.addInitScript(cursorScript, cursorAssets(cursors));
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

/** Playwright's CLI, which `install chromium` downloads the browser with */
export const PLAYWRIGHT_CLI = path.join(path.dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
