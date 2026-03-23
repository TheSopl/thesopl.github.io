// Mint — class reminder push notification
// Runs at 11 PM Turkey time (20:00 UTC) via pg_cron
// Also callable directly from the app for test sends

import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(
  "mailto:tsaalaaaldeen@gmail.com",
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Schedule (same as client-side) ──
const SCHEDULE: Record<number, { name: string; start: string }[]> = {
  2: [
    { name: "English",                start: "08:30" },
    { name: "Programming 2",          start: "09:30" },
    { name: "Calculus 2",             start: "13:30" },
  ],
  4: [{ name: "Intro to Optimization", start: "15:30" }],
  5: [
    { name: "Trends in Literature",    start: "09:30" },
    { name: "Programming 2",           start: "14:30" },
    { name: "Differential Equations",  start: "15:30" },
  ],
};

function sleepPlan(firstStart: string) {
  const [h, m] = firstStart.split(":").map(Number);
  const wakeMins = h * 60 + m - 45; // 45-min buffer (20-min commute + 25 prep)
  const bedMins  = wakeMins - 8 * 60;
  const fmt = (total: number) => {
    const hh = (((Math.floor(total / 60)) % 24) + 24) % 24;
    const mm = ((total % 60) + 60) % 60;
    return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
  };
  return { bed: fmt(bedMins), wake: fmt(wakeMins) };
}

function buildNotif(tomorrowDow: number): { title: string; body: string } | null {
  const classes = SCHEDULE[tomorrowDow];
  if (!classes?.length) return null;
  const names = [...new Set(classes.map(c => c.name))].join(", ");
  const sp = sleepPlan(classes[0].start);
  return {
    title: "Classes tomorrow 🎒",
    body:  `${names}\nSleep by ${sp.bed} → wake ${sp.wake}`,
  };
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── Determine target day ──
  // When called by cron at 20:00 UTC, tomorrow in Turkey (UTC+3) = today UTC + 1 day
  // When called manually (test), body may include { test: true }
  const body = await req.json().catch(() => ({}));

  const now = new Date();
  // Add 3 hours for Turkey time to find "tomorrow" from the user's perspective
  const turkeyNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const tomorrow  = new Date(turkeyNow.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDow = tomorrow.getUTCDay();

  const notif = body.test
    ? { title: "✅ Push works!", body: "Your class reminder push notification is set up and working." }
    : buildNotif(tomorrowDow);

  if (!notif) {
    return new Response(
      JSON.stringify({ status: "no_classes_tomorrow", dow: tomorrowDow }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  // ── Fetch all push subscriptions ──
  const { data: users, error } = await sb
    .from("user_data")
    .select("user_id, cash");

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  const results: { user_id: string; status: string; error?: string }[] = [];

  for (const user of users ?? []) {
    const pushSub = user.cash?.pushSub;
    if (!pushSub?.endpoint) continue;

    try {
      await webpush.sendNotification(
        pushSub,
        JSON.stringify({ title: notif.title, body: notif.body })
      );
      results.push({ user_id: user.user_id, status: "sent" });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message?: string };
      // Expired / invalid subscription — clean it up
      if (err.statusCode === 410 || err.statusCode === 404) {
        await sb
          .from("user_data")
          .update({ cash: { ...user.cash, pushSub: null } })
          .eq("user_id", user.user_id);
      }
      results.push({ user_id: user.user_id, status: "failed", error: err.message });
    }
  }

  return new Response(
    JSON.stringify({ notif, results }),
    { headers: { ...CORS, "Content-Type": "application/json" } }
  );
});
