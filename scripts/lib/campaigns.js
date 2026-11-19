/** Playlist settings for an ad campaign. No network. */

import { toAzuraDay } from "../../site/js/pure.js";
import { endOfJerusalemDay } from "../../site/js/pure.js";

export const PROTECTED_PLAYLIST_IDS = new Set([1, 2, 3, 5]);

export function campaignEnded(campaign, now) {
  if (!campaign?.endDate) return false;
  return now > endOfJerusalemDay(`${campaign.endDate}T12:00:00Z`);
}

export function campaignOnAir(campaign, now) {
  return !campaign?.paused && !campaign?.draft && !campaignEnded(campaign, now);
}

function dayRange(campaign) {
  return {
    start_date: campaign.startDate,
    end_date: campaign.endDate,
    days: (campaign.days || []).map(toAzuraDay),
  };
}

export function frequencyPatch(campaign, now) {
  if (!campaign?.frequencyEvery) return null;
  const minutes = campaign.frequencyMode === "minutes";
  const range = dayRange(campaign);
  return {
    type: minutes ? "once_per_x_minutes" : "once_per_x_songs",
    play_per_songs: minutes ? 0 : Number(campaign.frequencyEvery),
    play_per_minutes: minutes ? Number(campaign.frequencyEvery) : 0,
    is_enabled: campaignOnAir(campaign, now),
    schedule_items: [{ start_time: 0, end_time: 2359, ...range }],
  };
}

export function fixedPatch(campaign, now) {
  if (!(campaign?.fixedTimes || []).length) return null;
  const range = dayRange(campaign);
  return {
    type: "default",
    is_enabled: campaignOnAir(campaign, now),
    backend_options: ["interrupt", "single_track"],
    schedule_items: campaign.fixedTimes.map((time) => {
      const [h, m] = String(time).split(":").map(Number);
      const start = h * 100 + m;
      const endMinutes = h * 60 + m + 8;
      const end = Math.min(2359, Math.floor(endMinutes / 60) * 100 + (endMinutes % 60));
      return { start_time: start, end_time: end, ...range };
    }),
  };
}
