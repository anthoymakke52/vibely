# Vibely

A React + Vite chat starter connected to Supabase.

## Requirements
- Node.js 20+ (LTS)
- A Supabase project

## Setup
1. Extract this ZIP.
2. Open a terminal in the extracted `Vibely` folder.
3. Install packages: `npm install`
4. Copy `.env.example` to `.env`.
5. In Supabase Project Settings → API Keys, copy the **Project URL** (from Data API / API URL, without `/rest/v1/`) and the **Publishable key**.
6. Add them to `.env`:
   - `VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=sb_publishable_...`
7. In Supabase SQL Editor, run `supabase/schema.sql`.
8. In Supabase Authentication → Providers, ensure Email is enabled.
9. Run `npm run dev` and open the local URL printed in the terminal.

## Deploy
Build with `npm run build`. Deploy the `dist` folder to Vercel or Netlify. Add the same two `VITE_` environment variables in the hosting provider's project settings, then redeploy.

## Security
- Never put a Supabase Secret key or service_role key in browser code or `.env`.
- The publishable key is designed for browser use; database access is governed by Row Level Security.
- Review and strengthen RLS policies before production use.

## Current starter scope
Included: email/password sign-up and sign-in, public lounge text chat, realtime incoming messages and presence, image/audio file upload to Supabase Storage, responsive chat UI, local camera preview.

Not yet implemented: private conversations and group membership flows in the UI, voice recording controls, real peer-to-peer video calls (WebRTC), profile editor/avatar management, and admin moderation dashboard. The camera control is a local preview only, not a call.
