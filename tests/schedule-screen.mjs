import { chromium } from "playwright";

const base = process.env.SITE_URL || "http://127.0.0.1:4188";
const out = "/opt/cursor/artifacts";

async function shot(page, file) {
  await page.screenshot({ path: `${out}/${file}`, fullPage: true });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function open(page) {
  await page.goto(`${base}/?demo=1#/schedule`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "לוח שידורים" }).waitFor();
  await page.getByText("הפגישה המוזרה").first().waitFor();
  await page.locator(".play-row.repeat").first().waitFor();
  const color = await page.locator(".play-row.repeat .ttl").first().evaluate((el) => getComputedStyle(el).color);
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  const red = match ? Number(match[1]) : 0;
  const green = match ? Number(match[2]) : 255;
  if (red < 120 || red < green + 40) throw new Error(`repeat title is not red: ${color}`);
  await page.getByText("כיכר FM").waitFor();
  await page.getByText("זה תכנון ל־24 השעות הבאות").waitFor();
  await page.getByText("כל 4 שירים").waitFor();
  await page.getByText("מבזק שעתי").first().waitFor();
  await page.getByRole("heading", { name: "עכשיו" }).waitFor();
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await open(desktop);
const desktopButton = await desktop.locator("#hide-sweepers").boundingBox();
if (!desktopButton || desktopButton.width < 40) throw new Error("desktop sweeper toggle is not visible");
await shot(desktop, "schedule-desktop.png");
await desktop.locator("#hide-sweepers").evaluate((node) => node.click());
await desktop.getByText("כיכר FM").waitFor({ state: "hidden" });
if (await desktop.locator(".play-row.repeat").count() < 1) throw new Error("repeat highlight disappeared with the sweeper");
await shot(desktop, "schedule-desktop-filtered.png");

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await open(mobile);
const mobileButton = await mobile.locator("#hide-sweepers").boundingBox();
if (!mobileButton || mobileButton.y < 0 || mobileButton.y > 700 || mobileButton.width < 40) {
  throw new Error(`mobile sweeper toggle is off screen: ${JSON.stringify(mobileButton)}`);
}
await mobile.screenshot({ path: `${out}/schedule-mobile.png` });
await mobile.getByRole("heading", { name: "מתוכנן" }).scrollIntoViewIfNeeded();
await mobile.screenshot({ path: `${out}/schedule-mobile-plan.png` });
await mobile.locator("#hide-sweepers").evaluate((node) => node.click());
await mobile.getByText("כיכר FM").waitFor({ state: "hidden" });
await mobile.screenshot({ path: `${out}/schedule-mobile-filtered.png` });

await browser.close();
console.log("schedule-screen ok");
