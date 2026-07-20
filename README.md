# All-in-One Video Downloader

YouTube, Instagram, Twitch, Facebook, TikTok — link paste karo, full video ya
specific clip (start/end time se) download karo.

## Kaise kaam karta hai

- Backend: Node.js + Express
- Video extraction: `yt-dlp` (system binary, Dockerfile mein install hota hai)
- Clip trimming: `ffmpeg`

**Clip download strategy (important):**
- YouTube / Facebook / TikTok / Instagram → pehle `yt-dlp --download-sections`
  try hota hai (sirf zaroori hissa fetch hota hai, fast + kam bandwidth).
- **Twitch** → seedha section download HLS (.m3u8) streams pe reliable nahi
  hota, is liye Twitch ke liye code automatically **poori VOD download karke
  ffmpeg se precise trim** karta hai. Thoda slow hoga lekin reliable.
- Agar kisi bhi platform pe section download fail ho jaye, code automatically
  full-download+trim pe fallback kar leta hai.

## Twitch-specific masail jo handle kiye gaye hain

1. **HLS sections unreliable** → full download + ffmpeg trim fallback (upar).
2. **Ads in VOD** → `--extractor-args twitch:disable-ads` use hota hai.
3. **Subscriber-only VODs** → yeh tool sirf publicly accessible VODs/clips
   ke liye kaam karega. Agar VOD private/sub-only hai to yt-dlp fail hoga —
   is case mein error message clearly bata dega.
4. **Expired VODs** → Twitch VODs kuch dinon baad expire ho jate hain; agar
   link expire ho chuka hai to koi bhi downloader kaam nahi karega.

## Local test karna (agar Node + Python installed hai)

```bash
pip install yt-dlp
# ffmpeg bhi install hona chahiye (brew install ffmpeg / apt install ffmpeg)
npm install
npm start
# http://localhost:3000 par khулega
```

## Deploy kaise karein (mobile se bhi manage ho sakta hai)

**Netlify is project ke liye kaam NAHI karega** — kyunki yeh ek asal server
hai jo binary (`yt-dlp`, `ffmpeg`) chalata hai, static hosting nahi.

Recommended: **Railway** ya **Render** (dono free tier + Docker support dete
hain, dashboard mobile browser se bhi use ho jata hai):

### Railway
1. Is folder ko GitHub repo bana kar push karein.
2. railway.app par jayein → "New Project" → "Deploy from GitHub repo".
3. Railway apne aap `Dockerfile` detect kar lega.
4. Deploy hone ke baad jo public URL milega, wahi aapki app hai.

### Render
1. GitHub repo banayein aur push karein.
2. render.com → "New" → "Web Service" → apna repo select karein.
3. Environment: **Docker** select karein (Dockerfile already provided hai).
4. Deploy karein — public URL mil jayega.

## Zaroori note

Yeh tool sirf un videos ke liye use karein jinko download karne ka aapko
haq/permission hai — apni khud ki content, ya jinhe platform/owner ne
download karne ki ijazat di ho. YouTube/Instagram/TikTok/Facebook ki Terms
of Service downloading ko restrict karti hain, is liye third-party content
ke liye is tool ka istemaal ehtiyat se karein.
