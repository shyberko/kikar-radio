import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.SITE_URL || "http://127.0.0.1:4188";
const out = "/opt/cursor/artifacts";
mkdirSync(out, { recursive: true });

const puts = [];
const playlistPosts = [];
let playlistSeq = 90;

function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function install(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "kikar-settings-v1",
      JSON.stringify({
        setupDone: true,
        stationUrl: "https://radiocast.kikar.co.il",
        azuraKey: "test-key",
        githubToken: "test-token",
      }),
    );
  });
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes("api.github.com")) {
      if (method === "PUT" && url.includes("/contents/")) {
        puts.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, 201, { content: { sha: "abc" } });
      }
      if (method === "GET") return json(route, 404, { message: "Not Found" });
      return json(route, 200, {});
    }
    if (url.includes("radiocast.kikar.co.il")) {
      if (url.includes("/nowplaying/")) {
        return json(route, 200, {
          is_online: true,
          listeners: { current: 3 },
          now_playing: { elapsed: 12, duration: 180, song: { text: "שיר בדיקה", title: "שיר בדיקה" } },
        });
      }
      if (method === "POST" && url.endsWith("/playlists")) {
        const body = JSON.parse(route.request().postData() || "{}");
        playlistPosts.push(body);
        playlistSeq += 1;
        return json(route, 200, { id: playlistSeq, name: body.name, description: body.description });
      }
      if (method === "POST" && url.includes("/files")) {
        return json(route, 200, { id: 501, path: "ads/test/spot.mp3" });
      }
      if (method === "PUT" && /\/playlist\/([1235])\b/.test(url)) {
        return json(route, 500, { message: "refused protected playlist" });
      }
      if (method === "PUT" || method === "DELETE") return json(route, 200, {});
      if (method === "GET" && url.includes("/playlists")) return json(route, 200, []);
      return json(route, 200, {});
    }
    return route.continue();
  });
}

async function addCampaign(page, name) {
  await page.goto(`${base}/#/ads`, { waitUntil: "networkidle" });
  await page.locator("#new-campaign").waitFor({ timeout: 15000 });
  await page.locator("#new-campaign").click();
  await page.locator("#ad-name").waitFor();
  await page.locator("#ad-file").setInputFiles({
    name: "spot.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3fake"),
  });
  await page.getByText("spot.mp3").waitFor({ timeout: 10000 });
  await page.locator("#ad-name").fill(name);
  await page.locator("#ad-enabled").check();
  await page.getByRole("button", { name: "המשך" }).click();
  await page.locator("#ad-end").waitFor();
  await page.locator("#ad-start").fill("2026-11-19");
  await page.locator("#ad-end").fill("2026-11-26");
  await page.getByRole("button", { name: "המשך" }).click();
  await page.locator("#freq-on").waitFor();
  await page.getByRole("button", { name: "המשך" }).click();
  const create = page.getByRole("button", { name: /צור קמפיין|תזמן קמפיין/ });
  await create.waitFor({ timeout: 8000 }).catch(async () => {
    console.log(await page.locator("#view").innerText());
    throw new Error("create button missing");
  });
  await create.click();
  await page.getByRole("heading", { name }).waitFor({ timeout: 10000 });
}

async function shot(page, file) {
  await page.screenshot({ path: `${out}/${file}`, fullPage: true });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await install(desktop);
await desktop.goto(`${base}/#/ads`, { waitUntil: "networkidle" });
await desktop.locator("#new-campaign").waitFor();
await shot(desktop, "campaign-desktop-button.png");
await addCampaign(desktop, "קמפיין בדיקה");
await shot(desktop, "campaign-desktop-saved.png");
await desktop.getByRole("button", { name: "ערוך" }).click();
await desktop.locator("#ad-name").waitFor();
await desktop.locator("#ad-name").fill("קמפיין בדיקה ערוך");
  await desktop.getByRole("button", { name: "המשך" }).click();
  await desktop.getByRole("button", { name: "המשך" }).click();
  await desktop.getByRole("button", { name: "המשך" }).click();
  await desktop.getByRole("button", { name: /צור קמפיין|תזמן קמפיין/ }).click();
await desktop.getByRole("heading", { name: "קמפיין בדיקה ערוך" }).waitFor();
await desktop.getByRole("button", { name: "מחק" }).click();
await desktop.getByText("עדיין אין קמפיינים").waitFor();
await shot(desktop, "campaign-desktop-deleted.png");

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await install(mobile);
await mobile.goto(`${base}/#/ads`, { waitUntil: "networkidle" });
await mobile.locator("#new-campaign").waitFor();
const box = await mobile.locator("#new-campaign").boundingBox();
if (!box || box.width < 40 || box.y < 0 || box.y > 800) throw new Error("mobile add button is not visible");
await shot(mobile, "campaign-mobile-button.png");
await addCampaign(mobile, "קמפיין נייד");
await shot(mobile, "campaign-mobile-saved.png");
await mobile.getByRole("button", { name: "מחק" }).click();
await mobile.getByText("עדיין אין קמפיינים").waitFor();

const bad = playlistPosts.filter((body) => /^(Shows|Jingles|Hourly News|election)$/i.test(body.name || ""));
if (bad.length) throw new Error("created a protected playlist");
if (!playlistPosts.every((body) => String(body.name || "").startsWith("כיכר אוטו"))) {
  throw new Error("playlist was created outside the managed prefix");
}
if (!playlistPosts.every((body) => String(body.description || "").includes("managed-by:kikar-radio"))) {
  throw new Error("playlist missing the managed marker");
}
const saved = puts.map((body) => JSON.parse(Buffer.from(body.content, "base64").toString("utf8")));
const adsPuts = saved.filter((doc) => Array.isArray(doc.campaigns));
if (!adsPuts.length) throw new Error("ads.json was not saved");
const last = adsPuts[adsPuts.length - 1];
if (last.campaigns.length !== 0) throw new Error("test campaign was not deleted");
console.log("campaign-flow ok", { playlists: playlistPosts.length, saves: adsPuts.length });
await browser.close();
