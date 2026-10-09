// Feature and use-case pages, English + Hindi. Every claim here must match
// what the app really does (see ../../docs/README.md feature table).
import type { Lang } from '../i18n/ui';

export type Section = { h2: string; body: string[]; bullets?: string[] };
export type Faq = { q: string; a: string };
export type PageCopy = {
  /** <title> (brand is appended) and the search snippet. */
  title: string;
  description: string;
  h1: string;
  lead: string;
  sections: Section[];
  faq?: Faq[];
};
export type ContentPage = {
  slug: string;
  group: 'features' | 'use-cases';
  icon: string;
  /** Short name for cards and menus. */
  name: Record<Lang, string>;
  copy: Record<Lang, PageCopy>;
};

export const pages: ContentPage[] = [
  {
    slug: 'free-cloud-backup',
    group: 'features',
    icon: '☁️',
    name: { en: '100 GB free backup', hi: '100 GB मुफ़्त बैकअप' },
    copy: {
      en: {
        title: '100 GB free photo & video backup at original quality',
        description:
          'Back up every photo and video at full original quality with 100 GB free. Verified uploads, upload while recording, and automatic space saving on your phone.',
        h1: '100 GB free backup, at the quality you shot it',
        lead: 'Every photo and video goes to the cloud the moment you take it, byte for byte. No compression, no "storage saver" quality, no surprises.',
        sections: [
          {
            h2: 'Original quality, verified',
            body: [
              'Lens uploads the exact file your camera made. Every piece of every upload is checked with a checksum when it arrives, so a corrupted upload is refused and sent again automatically.',
              'Big files are fine: uploads resume after a lost connection, and a single video can be up to 1 TB.',
            ],
          },
          {
            h2: 'Your phone never fills up',
            body: ['Once a photo or video is safely in the cloud, Lens can remove the full-size file from your phone and keep a sharp preview, so your gallery still works offline.'],
            bullets: [
              'Keep originals on the phone for the number of days you choose',
              'Always keep a few GB free: Lens frees the oldest first',
              'Nothing is removed until it is verified in the cloud',
            ],
          },
          {
            h2: 'Fast, even for long videos',
            body: [
              'On Android, a video starts uploading while you are still recording, so most of it is already backed up when you press stop.',
              'Previews upload first, so friends and your other devices see new photos within seconds.',
            ],
          },
          {
            h2: 'How much is free?',
            body: [
              'Sign in with your email or Google account and you get 100 GB of Lens storage free. Without signing in you can try Lens with 5 GB.',
            ],
          },
        ],
        faq: [
          { q: 'Does Lens compress my photos?', a: 'No. The original file is stored exactly as your camera saved it. Lens only makes small previews for fast browsing, in addition to the original.' },
          { q: 'What happens when I go over 100 GB?', a: 'New uploads pause and Lens tells you. You can free up space, connect your own storage (Google Drive, OneDrive, Dropbox, Box…), or wait for paid plans.' },
          { q: 'Does backup use my mobile data?', a: 'You choose: everything, small files only, or Wi-Fi only. Upload while recording is Wi-Fi only by default.' },
        ],
      },
      hi: {
        title: 'ओरिजिनल क्वालिटी में 100 GB मुफ़्त फ़ोटो और वीडियो बैकअप',
        description:
          'हर फ़ोटो और वीडियो का पूरी ओरिजिनल क्वालिटी में बैकअप, 100 GB मुफ़्त। जाँचे हुए अपलोड, रिकॉर्डिंग के दौरान अपलोड और फ़ोन में अपने-आप जगह बचत।',
        h1: '100 GB मुफ़्त बैकअप, उसी क्वालिटी में जिसमें आपने लिया',
        lead: 'हर फ़ोटो और वीडियो लेते ही क्लाउड में चला जाता है, हूबहू वैसा ही। न कंप्रेशन, न "स्टोरेज सेवर" क्वालिटी, न कोई सरप्राइज़।',
        sections: [
          {
            h2: 'ओरिजिनल क्वालिटी, जाँची हुई',
            body: [
              'Lens वही फ़ाइल अपलोड करता है जो आपके कैमरे ने बनाई। हर अपलोड का हर हिस्सा पहुँचते ही चेकसम से जाँचा जाता है, ख़राब अपलोड मना हो जाता है और अपने-आप दोबारा भेजा जाता है।',
              'बड़ी फ़ाइलें भी ठीक हैं: कनेक्शन टूटने पर अपलोड वहीं से शुरू होता है, और एक वीडियो 1 TB तक का हो सकता है।',
            ],
          },
          {
            h2: 'आपका फ़ोन कभी फ़ुल नहीं होगा',
            body: ['जैसे ही फ़ोटो या वीडियो क्लाउड में सुरक्षित हो जाता है, Lens फ़ोन से बड़ी फ़ाइल हटा सकता है और एक साफ़ प्रीव्यू रखता है, ताकि गैलरी ऑफ़लाइन भी चले।'],
            bullets: [
              'ओरिजिनल फ़ोन पर कितने दिन रहें, आप तय करें',
              'हमेशा कुछ GB ख़ाली रखें: Lens सबसे पुरानी फ़ाइलें पहले हटाता है',
              'क्लाउड में जाँच होने से पहले कुछ नहीं हटता',
            ],
          },
          {
            h2: 'लंबे वीडियो भी तेज़',
            body: [
              'Android पर वीडियो रिकॉर्ड होते-होते ही अपलोड होना शुरू हो जाता है, इसलिए स्टॉप दबाने तक ज़्यादातर बैकअप हो चुका होता है।',
              'प्रीव्यू पहले अपलोड होते हैं, ताकि दोस्त और आपके दूसरे डिवाइस नई फ़ोटो कुछ सेकंड में देख सकें।',
            ],
          },
          {
            h2: 'कितना मुफ़्त है?',
            body: ['ईमेल या Google अकाउंट से साइन इन करें और 100 GB Lens स्टोरेज मुफ़्त पाएँ। बिना साइन इन के आप 5 GB के साथ Lens आज़मा सकते हैं।'],
          },
        ],
        faq: [
          { q: 'क्या Lens मेरी फ़ोटो कंप्रेस करता है?', a: 'नहीं। ओरिजिनल फ़ाइल ठीक वैसी ही रखी जाती है जैसी कैमरे ने सेव की। Lens सिर्फ़ तेज़ ब्राउज़िंग के लिए छोटे प्रीव्यू अलग से बनाता है।' },
          { q: '100 GB से ज़्यादा होने पर क्या होगा?', a: 'नए अपलोड रुक जाते हैं और Lens आपको बताता है। आप जगह ख़ाली कर सकते हैं, अपना स्टोरेज (Google Drive, OneDrive, Dropbox, Box…) जोड़ सकते हैं, या पेड प्लान का इंतज़ार कर सकते हैं।' },
          { q: 'क्या बैकअप मेरा मोबाइल डेटा इस्तेमाल करता है?', a: 'आप चुनें: सब कुछ, सिर्फ़ छोटी फ़ाइलें, या सिर्फ़ Wi-Fi। रिकॉर्डिंग के दौरान अपलोड डिफ़ॉल्ट रूप से सिर्फ़ Wi-Fi पर होता है।' },
        ],
      },
    },
  },
  {
    slug: 'pro-camera',
    group: 'features',
    icon: '🎛️',
    name: { en: 'Pro camera', hi: 'प्रो कैमरा' },
    copy: {
      en: {
        title: 'Pro camera app with manual controls, RAW and 4K',
        description:
          'Manual ISO, shutter speed, white balance and focus, histogram, zebra stripes, focus peaking, RAW (DNG) and 4K HDR video. Only the controls your phone really supports.',
        h1: 'A pro camera that adapts to your phone',
        lead: 'Lens reads exactly what your camera hardware can do and gives you those controls, from a budget phone to the latest flagship.',
        sections: [
          {
            h2: 'Manual controls',
            body: ['Turn a dial to set ISO, shutter speed, white balance in Kelvin, focus distance and exposure. Long-press to go back to auto. On phones that only allow automatic exposure, Lens shows exposure compensation, which works on every phone.'],
          },
          {
            h2: 'See your exposure like a professional',
            bullets: ['Live histogram with clipping warnings', 'Zebra stripes over bright areas', 'Focus peaking that highlights sharp edges', 'False colour for exposure zones', 'Level, grids and crop guides'],
            body: [],
          },
          {
            h2: 'Formats',
            bullets: ['RAW (DNG) on cameras that support it', 'Ultra HDR photos on Android 14+', '4K video, 60 fps and 10-bit HDR where supported', 'Lens buttons: ultra-wide, main and telephoto'],
            body: ['Save your favourite settings as presets and switch in one tap.'],
          },
        ],
        faq: [
          { q: 'Why don’t I see manual ISO on my phone?', a: 'Some phones don’t let apps control the sensor directly. Lens checks this and shows only controls that work. Settings → Camera info shows what your phone supports.' },
        ],
      },
      hi: {
        title: 'मैनुअल कंट्रोल, RAW और 4K वाला प्रो कैमरा ऐप',
        description:
          'मैनुअल ISO, शटर स्पीड, व्हाइट बैलेंस और फ़ोकस, हिस्टोग्राम, ज़ेबरा, फ़ोकस पीकिंग, RAW (DNG) और 4K HDR वीडियो। सिर्फ़ वही कंट्रोल जो आपका फ़ोन सच में सपोर्ट करता है।',
        h1: 'प्रो कैमरा जो आपके फ़ोन के हिसाब से ढलता है',
        lead: 'Lens देखता है कि आपके कैमरे का हार्डवेयर क्या कर सकता है और आपको वही कंट्रोल देता है, बजट फ़ोन से लेकर नए फ़्लैगशिप तक।',
        sections: [
          {
            h2: 'मैनुअल कंट्रोल',
            body: ['डायल घुमाकर ISO, शटर स्पीड, केल्विन में व्हाइट बैलेंस, फ़ोकस दूरी और एक्सपोज़र सेट करें। ऑटो पर लौटने के लिए देर तक दबाएँ। जिन फ़ोन में सिर्फ़ ऑटो एक्सपोज़र है, वहाँ Lens एक्सपोज़र कंपेंसेशन दिखाता है, जो हर फ़ोन पर चलता है।'],
          },
          {
            h2: 'प्रोफ़ेशनल की तरह एक्सपोज़र देखें',
            bullets: ['लाइव हिस्टोग्राम और क्लिपिंग चेतावनी', 'चमकीले हिस्सों पर ज़ेबरा धारियाँ', 'तेज़ किनारों को दिखाने वाला फ़ोकस पीकिंग', 'एक्सपोज़र ज़ोन के लिए फ़ॉल्स कलर', 'लेवल, ग्रिड और क्रॉप गाइड'],
            body: [],
          },
          {
            h2: 'फ़ॉर्मेट',
            bullets: ['सपोर्ट करने वाले कैमरों पर RAW (DNG)', 'Android 14+ पर Ultra HDR फ़ोटो', 'जहाँ सपोर्ट हो वहाँ 4K, 60 fps और 10-bit HDR वीडियो', 'लेंस बटन: अल्ट्रा-वाइड, मेन और टेलीफ़ोटो'],
            body: ['अपनी पसंदीदा सेटिंग प्रीसेट के रूप में सेव करें और एक टैप में बदलें।'],
          },
        ],
        faq: [
          { q: 'मेरे फ़ोन पर मैनुअल ISO क्यों नहीं दिखता?', a: 'कुछ फ़ोन ऐप्स को सेंसर सीधे कंट्रोल नहीं करने देते। Lens यह जाँचता है और सिर्फ़ चलने वाले कंट्रोल दिखाता है। Settings → Camera info में देखें कि आपका फ़ोन क्या सपोर्ट करता है।' },
        ],
      },
    },
  },
  {
    slug: 'night-mode',
    group: 'features',
    icon: '🌙',
    name: { en: 'Night mode', hi: 'नाइट मोड' },
    copy: {
      en: {
        title: 'Night mode camera for clear low-light photos',
        description: 'Clear, low-noise photos in the dark. Lens uses your phone maker’s Night mode when available, or merges several shots itself, at full resolution.',
        h1: 'Night mode for clear photos in the dark',
        lead: 'Hold still for a moment and Lens turns a dim scene into a clean, detailed photo.',
        sections: [
          {
            h2: 'Two ways, one button',
            body: [
              'If your phone maker offers a Night mode to apps (many Samsung, Xiaomi, OPPO, vivo and Honor phones do), Lens uses it.',
              'Otherwise Lens takes 4 to 8 quick shots, picks the sharpest as the reference, lines the others up and averages them. That cuts noise by around 3 times while keeping detail.',
            ],
          },
          {
            h2: 'No ghosts, full resolution',
            body: ['Anything that moved between shots, like a person walking past, is left out of the merge so it doesn’t turn into a see-through ghost. The result is saved at your camera’s full resolution.'],
          },
        ],
      },
      hi: {
        title: 'कम रोशनी में साफ़ फ़ोटो के लिए नाइट मोड कैमरा',
        description: 'अँधेरे में साफ़, कम नॉइज़ वाली फ़ोटो। Lens उपलब्ध होने पर फ़ोन कंपनी का नाइट मोड इस्तेमाल करता है, वरना कई शॉट ख़ुद मिलाता है, पूरे रेज़ोल्यूशन में।',
        h1: 'अँधेरे में साफ़ फ़ोटो के लिए नाइट मोड',
        lead: 'एक पल के लिए फ़ोन स्थिर रखें और Lens धुँधले सीन को साफ़, डिटेल वाली फ़ोटो में बदल देता है।',
        sections: [
          {
            h2: 'दो तरीके, एक बटन',
            body: [
              'अगर आपकी फ़ोन कंपनी ऐप्स को नाइट मोड देती है (कई Samsung, Xiaomi, OPPO, vivo और Honor फ़ोन देते हैं), तो Lens उसी का इस्तेमाल करता है।',
              'वरना Lens 4 से 8 तेज़ शॉट लेता है, सबसे शार्प को आधार बनाता है, बाकी को उससे मिलाता है और औसत निकालता है। इससे नॉइज़ लगभग 3 गुना कम होता है और डिटेल बनी रहती है।',
            ],
          },
          {
            h2: 'कोई परछाईं नहीं, पूरा रेज़ोल्यूशन',
            body: ['शॉट्स के बीच जो चीज़ हिली, जैसे पास से गुज़रता कोई व्यक्ति, उसे मिलाने से बाहर रखा जाता है ताकि वह आर-पार दिखने वाली परछाईं न बने। नतीजा कैमरे के पूरे रेज़ोल्यूशन में सेव होता है।'],
          },
        ],
      },
    },
  },
  {
    slug: 'portrait-mode',
    group: 'features',
    icon: '👤',
    name: { en: 'Portrait mode', hi: 'पोर्ट्रेट मोड' },
    copy: {
      en: {
        title: 'Portrait mode with background blur you can change later',
        description: 'Blur the background behind people, then change or remove the blur any time in the editor. The original photo is never altered.',
        h1: 'Portrait mode, with blur you can change later',
        lead: 'Lens finds the person in your photo and blurs the background, and because the blur is an edit, you can make it stronger, softer or turn it off later.',
        sections: [
          { h2: 'Works on more phones', body: ['On iPhone, Lens uses the depth camera. On Android, the person is found by an on-device AI model that is built into the app, so it works on front and back cameras, offline, without sending your photo anywhere.'] },
          { h2: 'Your original stays untouched', body: ['The subject outline is stored inside the photo file. The blur is applied when you view, share or save, from f/1.4 (strong) to f/16 (almost none).'] },
        ],
      },
      hi: {
        title: 'पोर्ट्रेट मोड, बैकग्राउंड ब्लर जिसे बाद में बदल सकें',
        description: 'लोगों के पीछे बैकग्राउंड ब्लर करें, फिर एडिटर में कभी भी ब्लर बदलें या हटाएँ। ओरिजिनल फ़ोटो कभी नहीं बदलती।',
        h1: 'पोर्ट्रेट मोड, ब्लर जिसे बाद में बदल सकें',
        lead: 'Lens फ़ोटो में व्यक्ति को पहचानकर बैकग्राउंड ब्लर करता है, और क्योंकि ब्लर एक एडिट है, आप उसे बाद में तेज़, हल्का या बंद कर सकते हैं।',
        sections: [
          { h2: 'ज़्यादा फ़ोन पर चलता है', body: ['iPhone पर Lens डेप्थ कैमरा इस्तेमाल करता है। Android पर व्यक्ति को ऐप में ही मौजूद ऑन-डिवाइस AI मॉडल पहचानता है, इसलिए यह आगे और पीछे दोनों कैमरों पर, ऑफ़लाइन, आपकी फ़ोटो कहीं भेजे बिना चलता है।'] },
          { h2: 'ओरिजिनल वैसा ही रहता है', body: ['व्यक्ति की आउटलाइन फ़ोटो फ़ाइल के अंदर रखी जाती है। ब्लर देखने, शेयर या सेव करते समय लगता है, f/1.4 (तेज़) से f/16 (लगभग नहीं) तक।'] },
        ],
      },
    },
  },
  {
    slug: 'looks-and-editor',
    group: 'features',
    icon: '🎨',
    name: { en: 'Looks & editor', hi: 'लुक्स और एडिटर' },
    copy: {
      en: {
        title: 'Photo editor and 13 film looks, non-destructive',
        description: '13 looks, live in the viewfinder, plus exposure, highlights, shadows, colour, crop, straighten and more. Every edit can be changed or undone; originals stay untouched.',
        h1: 'Looks and an editor that never touch your original',
        lead: 'Pick a look before you shoot and see it live, or edit later. Every change is saved as a recipe, so you can adjust or remove it any time.',
        sections: [
          { h2: '13 looks', body: ['Natural+, Vivid, Warm, Cool, Golden hour, Cinematic, Film, Moody, Fade, B&W, Noir, Vintage and Chrome, each with an intensity slider. They look the same on Android, iPhone and the web.'] },
          {
            h2: 'A full editor',
            bullets: ['Auto enhance', 'Exposure, contrast, highlights, shadows', 'Warmth, tint, saturation, vibrance', 'Sharpness, vignette, film grain', 'Crop, rotate, flip and straighten', 'Copy an edit and paste it onto many photos'],
            body: [],
          },
          { h2: 'Big photos, small phones', body: ['Edits are rendered on your phone’s graphics chip in tiles, so even 50 to 200 megapixel photos export at full size on phones with little memory.'] },
        ],
      },
      hi: {
        title: 'फ़ोटो एडिटर और 13 फ़िल्म लुक्स, ओरिजिनल सुरक्षित',
        description: '13 लुक्स, व्यूफ़ाइंडर में लाइव, साथ में एक्सपोज़र, हाइलाइट, शैडो, रंग, क्रॉप, सीधा करना और भी बहुत कुछ। हर एडिट बदला या हटाया जा सकता है; ओरिजिनल वैसे ही रहते हैं।',
        h1: 'लुक्स और एडिटर जो आपके ओरिजिनल को कभी नहीं छूते',
        lead: 'शूट से पहले लुक चुनें और लाइव देखें, या बाद में एडिट करें। हर बदलाव एक रेसिपी की तरह सेव होता है, इसलिए आप उसे कभी भी बदल या हटा सकते हैं।',
        sections: [
          { h2: '13 लुक्स', body: ['Natural+, Vivid, Warm, Cool, Golden hour, Cinematic, Film, Moody, Fade, B&W, Noir, Vintage और Chrome, हर एक के साथ इंटेंसिटी स्लाइडर। ये Android, iPhone और वेब पर एक जैसे दिखते हैं।'] },
          {
            h2: 'पूरा एडिटर',
            bullets: ['ऑटो एन्हांस', 'एक्सपोज़र, कंट्रास्ट, हाइलाइट, शैडो', 'वॉर्मथ, टिंट, सैचुरेशन, वाइब्रेंस', 'शार्पनेस, विनेट, फ़िल्म ग्रेन', 'क्रॉप, घुमाना, पलटना और सीधा करना', 'एक एडिट कॉपी करके कई फ़ोटो पर लगाएँ'],
            body: [],
          },
          { h2: 'बड़ी फ़ोटो, छोटे फ़ोन', body: ['एडिट आपके फ़ोन के ग्राफ़िक्स चिप पर टुकड़ों में बनते हैं, इसलिए 50 से 200 मेगापिक्सल की फ़ोटो भी कम मेमोरी वाले फ़ोन पर पूरे साइज़ में एक्सपोर्ट होती हैं।'] },
        ],
      },
    },
  },
  {
    slug: 'your-own-storage',
    group: 'features',
    icon: '🔗',
    name: { en: 'Use your own storage', hi: 'अपना स्टोरेज जोड़ें' },
    copy: {
      en: {
        title: 'Back up photos to Google Drive, OneDrive, Dropbox, Box or your NAS',
        description: 'Already pay for cloud storage? Send your originals to Google Drive, OneDrive, Dropbox, Box, any S3-compatible storage or your own NAS (WebDAV), with the Lens camera and gallery on top.',
        h1: 'Keep your photos in the storage you already have',
        lead: 'Connect Google Drive, OneDrive, Dropbox, Box, S3-compatible storage or a NAS, and Lens saves your originals there. The camera, gallery and sharing work the same.',
        sections: [
          { h2: 'Supported storage', bullets: ['Google Drive', 'Microsoft OneDrive', 'Dropbox', 'Box', 'S3-compatible storage (AWS, Cloudflare R2, Backblaze B2, MinIO…)', 'WebDAV: Synology, Nextcloud and most NAS boxes'], body: [] },
          { h2: 'Your accounts stay yours', body: ['Sign-in to your storage happens with the provider directly. On the free plan, the access keys stay on your phone; Lens’s servers don’t keep them. Lens stores only small previews so your gallery stays fast.'] },
        ],
      },
      hi: {
        title: 'Google Drive, OneDrive, Dropbox, Box या अपने NAS पर फ़ोटो बैकअप',
        description: 'पहले से क्लाउड स्टोरेज है? अपने ओरिजिनल Google Drive, OneDrive, Dropbox, Box, किसी भी S3-कम्पैटिबल स्टोरेज या अपने NAS (WebDAV) पर भेजें, ऊपर से Lens कैमरा और गैलरी।',
        h1: 'फ़ोटो उसी स्टोरेज में रखें जो आपके पास पहले से है',
        lead: 'Google Drive, OneDrive, Dropbox, Box, S3-कम्पैटिबल स्टोरेज या NAS जोड़ें, और Lens आपके ओरिजिनल वहीं सेव करेगा। कैमरा, गैलरी और शेयरिंग वैसे ही चलते हैं।',
        sections: [
          { h2: 'सपोर्टेड स्टोरेज', bullets: ['Google Drive', 'Microsoft OneDrive', 'Dropbox', 'Box', 'S3-कम्पैटिबल स्टोरेज (AWS, Cloudflare R2, Backblaze B2, MinIO…)', 'WebDAV: Synology, Nextcloud और ज़्यादातर NAS'], body: [] },
          { h2: 'आपके अकाउंट आपके ही रहते हैं', body: ['स्टोरेज में साइन इन सीधे प्रोवाइडर के साथ होता है। फ़्री प्लान में एक्सेस कीज़ आपके फ़ोन पर ही रहती हैं; Lens के सर्वर उन्हें नहीं रखते। गैलरी तेज़ रखने के लिए Lens सिर्फ़ छोटे प्रीव्यू रखता है।'] },
        ],
      },
    },
  },
  {
    slug: '4k-video-streaming',
    group: 'features',
    icon: '🎬',
    name: { en: '4K video streaming', hi: '4K वीडियो स्ट्रीमिंग' },
    copy: {
      en: {
        title: 'Watch long videos smoothly, up to 4K, on any connection',
        description: 'Long and 4K videos play instantly on any device. Lens makes smooth streaming versions up to the original resolution and picks the best one your connection can carry.',
        h1: 'Long videos play smoothly, up to 4K',
        lead: 'Open a 20-minute 4K video on another phone or the web and it starts right away, at the best quality your connection allows.',
        sections: [
          { h2: 'Adaptive quality', body: ['The first time someone plays a long video, Lens makes streaming versions from 540p up to the original resolution, including 4K and 60 fps. Players switch between them as the connection changes, instead of stalling.'] },
          { h2: 'The original stays the original', body: ['Streaming copies are extra. Your original video is kept as recorded, including HDR, and you can always download it.'] },
        ],
      },
      hi: {
        title: 'किसी भी कनेक्शन पर लंबे वीडियो आराम से देखें, 4K तक',
        description: 'लंबे और 4K वीडियो किसी भी डिवाइस पर तुरंत चलते हैं। Lens ओरिजिनल रेज़ोल्यूशन तक स्मूद स्ट्रीमिंग वर्शन बनाता है और आपके कनेक्शन के हिसाब से सबसे अच्छा चुनता है।',
        h1: 'लंबे वीडियो आराम से चलते हैं, 4K तक',
        lead: 'दूसरे फ़ोन या वेब पर 20 मिनट का 4K वीडियो खोलें और वह तुरंत शुरू होता है, आपके कनेक्शन के हिसाब से सबसे अच्छी क्वालिटी में।',
        sections: [
          { h2: 'अपने-आप बदलती क्वालिटी', body: ['जब कोई पहली बार लंबा वीडियो चलाता है, Lens 540p से लेकर ओरिजिनल रेज़ोल्यूशन तक, 4K और 60 fps समेत, स्ट्रीमिंग वर्शन बनाता है। कनेक्शन बदलने पर प्लेयर रुकने के बजाय इनके बीच बदलता रहता है।'] },
          { h2: 'ओरिजिनल, ओरिजिनल ही रहता है', body: ['स्ट्रीमिंग कॉपी अलग से होती हैं। आपका ओरिजिनल वीडियो वैसा ही रहता है जैसा रिकॉर्ड हुआ, HDR समेत, और आप उसे हमेशा डाउनलोड कर सकते हैं।'] },
        ],
      },
    },
  },
  {
    slug: 'sharing',
    group: 'features',
    icon: '🤝',
    name: { en: 'Sharing', hi: 'शेयरिंग' },
    copy: {
      en: {
        title: 'Share full-quality photos and videos with friends',
        description: 'Send photos and videos to friends at full quality. They appear in their Shared tab; delete for everyone or only for yourself.',
        h1: 'Share at full quality, without WhatsApp compression',
        lead: 'Send photos and videos to friends on Lens. They see them in their Shared tab, at the quality you shot them.',
        sections: [
          { h2: 'Simple and private', body: ['Find friends by their Lens name. Only the people you send to can open what you share.'] },
          { h2: 'You stay in control', body: ['When you delete a shared photo you choose: remove it for everyone, or only for yourself so friends keep their copy.'] },
        ],
      },
      hi: {
        title: 'दोस्तों के साथ फ़ुल क्वालिटी फ़ोटो और वीडियो शेयर करें',
        description: 'दोस्तों को पूरी क्वालिटी में फ़ोटो और वीडियो भेजें। वे उनके Shared टैब में दिखते हैं; सबके लिए डिलीट करें या सिर्फ़ अपने लिए।',
        h1: 'WhatsApp कंप्रेशन के बिना, फ़ुल क्वालिटी में शेयर करें',
        lead: 'Lens पर दोस्तों को फ़ोटो और वीडियो भेजें। वे उन्हें अपने Shared टैब में, उसी क्वालिटी में देखते हैं जिसमें आपने लिया।',
        sections: [
          { h2: 'आसान और प्राइवेट', body: ['दोस्तों को उनके Lens नाम से ढूँढें। जो आप शेयर करते हैं, उसे सिर्फ़ वही लोग खोल सकते हैं जिन्हें आपने भेजा।'] },
          { h2: 'कंट्रोल आपके हाथ में', body: ['शेयर की हुई फ़ोटो डिलीट करते समय आप चुनते हैं: सबके लिए हटाएँ, या सिर्फ़ अपने लिए ताकि दोस्तों के पास उनकी कॉपी रहे।'] },
        ],
      },
    },
  },
  {
    slug: 'web-app',
    group: 'features',
    icon: '💻',
    name: { en: 'Web app', hi: 'वेब ऐप' },
    copy: {
      en: {
        title: 'Your photos on any computer: sign in with a QR code',
        description: 'Open lens.instagrowapp.com, scan the QR code with your phone, and see, upload, download and share your photos from any browser. Everything stays in sync.',
        h1: 'Your whole library on any computer',
        lead: 'Scan a QR code with your phone and your photos are on the big screen, in sync with your phone, at full quality.',
        sections: [
          { h2: 'Sign in in seconds', body: ['Scan the QR code on the website with your phone and approve. You can also sign in with your email or Google account, the same account as the app.'] },
          { h2: 'Everything you need on a computer', bullets: ['Browse and zoom at full quality', 'Upload photos and videos from your computer', 'Download originals', 'Share with friends', 'Trash and Archive', 'Changes from your phone appear automatically'], body: [] },
          { h2: 'Safe by design', body: ['The website keeps your session in a secure cookie that page scripts can’t read. See and sign out every browser from your phone.'] },
        ],
      },
      hi: {
        title: 'किसी भी कंप्यूटर पर आपकी फ़ोटो: QR कोड से साइन इन',
        description: 'lens.instagrowapp.com खोलें, फ़ोन से QR कोड स्कैन करें, और किसी भी ब्राउज़र से अपनी फ़ोटो देखें, अपलोड, डाउनलोड और शेयर करें। सब कुछ सिंक रहता है।',
        h1: 'किसी भी कंप्यूटर पर आपकी पूरी लाइब्रेरी',
        lead: 'फ़ोन से QR कोड स्कैन करें और आपकी फ़ोटो बड़ी स्क्रीन पर, फ़ोन के साथ सिंक, पूरी क्वालिटी में।',
        sections: [
          { h2: 'कुछ सेकंड में साइन इन', body: ['वेबसाइट पर QR कोड फ़ोन से स्कैन करें और मंज़ूरी दें। आप ईमेल या Google अकाउंट से भी साइन इन कर सकते हैं, वही अकाउंट जो ऐप में है।'] },
          { h2: 'कंप्यूटर पर ज़रूरत की हर चीज़', bullets: ['पूरी क्वालिटी में देखें और ज़ूम करें', 'कंप्यूटर से फ़ोटो और वीडियो अपलोड करें', 'ओरिजिनल डाउनलोड करें', 'दोस्तों के साथ शेयर करें', 'ट्रैश और आर्काइव', 'फ़ोन के बदलाव अपने-आप दिखते हैं'], body: [] },
          { h2: 'सुरक्षा पहले से', body: ['वेबसाइट आपका सेशन एक सुरक्षित कुकी में रखती है जिसे पेज की स्क्रिप्ट नहीं पढ़ सकतीं। हर ब्राउज़र को फ़ोन से देखें और साइन आउट करें।'] },
        ],
      },
    },
  },
  // ---------- Use cases ----------
  {
    slug: 'phone-storage-full',
    group: 'use-cases',
    icon: '📱',
    name: { en: 'Phone storage full?', hi: 'फ़ोन स्टोरेज फ़ुल?' },
    copy: {
      en: {
        title: 'Phone storage full? Free up space without losing photos',
        description: '"Storage full" again? Back up every photo and video at original quality, then let Lens free up your phone automatically, keeping previews so your gallery still works.',
        h1: 'Phone storage full? Free up space without losing a single photo',
        lead: 'Photos and videos are the biggest reason phones fill up. Lens keeps every one of them safe in the cloud at full quality and frees your phone for you.',
        sections: [
          { h2: 'Why your phone keeps filling up', body: ['A minute of 4K video is around 400 MB. A few trips and weddings and a 64 GB or 128 GB phone is full, and deleting means choosing which memories to lose.'] },
          {
            h2: 'How Lens fixes it',
            bullets: ['Every shot is backed up as you take it, at original quality', 'Once verified in the cloud, the full-size file can leave your phone', 'A sharp preview stays, so your gallery works offline', 'Lens keeps the space you choose free, oldest files first'],
            body: [],
          },
          { h2: 'Free to start', body: ['100 GB free when you sign in. Already have Google Drive, OneDrive or Dropbox space? Connect it.'] },
        ],
        faq: [
          { q: 'Will I lose quality if Lens removes photos from my phone?', a: 'No. The original is kept in full quality in the cloud and comes back when you open it, share it or save it.' },
          { q: 'Can I still see my photos without internet?', a: 'Yes. Previews stay on your phone, so you can browse your whole gallery offline.' },
        ],
      },
      hi: {
        title: 'फ़ोन स्टोरेज फ़ुल? फ़ोटो खोए बिना जगह ख़ाली करें',
        description: 'फिर से "स्टोरेज फ़ुल"? हर फ़ोटो और वीडियो का ओरिजिनल क्वालिटी में बैकअप लें, फिर Lens अपने-आप फ़ोन ख़ाली करे, प्रीव्यू रखते हुए ताकि गैलरी चलती रहे।',
        h1: 'फ़ोन स्टोरेज फ़ुल? एक भी फ़ोटो खोए बिना जगह ख़ाली करें',
        lead: 'फ़ोन भरने की सबसे बड़ी वजह फ़ोटो और वीडियो हैं। Lens उनमें से हर एक को पूरी क्वालिटी में क्लाउड में सुरक्षित रखता है और आपके लिए फ़ोन ख़ाली करता है।',
        sections: [
          { h2: 'आपका फ़ोन बार-बार क्यों भर जाता है', body: ['4K वीडियो का एक मिनट लगभग 400 MB होता है। कुछ ट्रिप और शादियाँ, और 64 GB या 128 GB फ़ोन फ़ुल, और डिलीट करने का मतलब है चुनना कि कौन-सी यादें खोनी हैं।'] },
          {
            h2: 'Lens इसे कैसे ठीक करता है',
            bullets: ['हर शॉट लेते ही ओरिजिनल क्वालिटी में बैकअप होता है', 'क्लाउड में जाँच के बाद बड़ी फ़ाइल फ़ोन से हट सकती है', 'साफ़ प्रीव्यू रहता है, गैलरी ऑफ़लाइन चलती है', 'Lens आपकी चुनी हुई जगह ख़ाली रखता है, सबसे पुरानी फ़ाइलें पहले'],
            body: [],
          },
          { h2: 'शुरुआत मुफ़्त', body: ['साइन इन करने पर 100 GB मुफ़्त। Google Drive, OneDrive या Dropbox में पहले से जगह है? उसे जोड़ें।'] },
        ],
        faq: [
          { q: 'Lens फ़ोन से फ़ोटो हटाए तो क्या क्वालिटी कम होगी?', a: 'नहीं। ओरिजिनल पूरी क्वालिटी में क्लाउड में रहता है और खोलने, शेयर या सेव करने पर वापस आता है।' },
          { q: 'क्या बिना इंटरनेट के फ़ोटो देख सकते हैं?', a: 'हाँ। प्रीव्यू फ़ोन पर रहते हैं, इसलिए आप पूरी गैलरी ऑफ़लाइन देख सकते हैं।' },
        ],
      },
    },
  },
  {
    slug: 'travel-photos',
    group: 'use-cases',
    icon: '✈️',
    name: { en: 'Travel', hi: 'ट्रैवल' },
    copy: {
      en: {
        title: 'The travel camera app that backs up as you go',
        description: 'Shoot as much as you want on your trip. Lens backs up on any Wi-Fi along the way, frees your phone, and keeps the night shots clear.',
        h1: 'Shoot your whole trip without "storage full"',
        lead: 'Hotel Wi-Fi, café Wi-Fi, any Wi-Fi: Lens backs up as you go and frees your phone, so you never stop to delete photos on a trip again.',
        sections: [
          { h2: 'Made for trips', bullets: ['Backup on Wi-Fi only, or mobile data if you allow it', 'Night mode for city lights and campfires', '4K video that uploads while you record (Android)', 'Share the best shots with your group at full quality'], body: [] },
          { h2: 'Safe if your phone isn’t', body: ['If your phone is lost or broken on the trip, everything already backed up is waiting in your account. Sign in on a new phone and it’s all there.'] },
        ],
      },
      hi: {
        title: 'ट्रैवल कैमरा ऐप जो साथ-साथ बैकअप करता है',
        description: 'ट्रिप पर जितनी चाहें फ़ोटो लें। Lens रास्ते के किसी भी Wi-Fi पर बैकअप करता है, फ़ोन ख़ाली करता है और नाइट शॉट साफ़ रखता है।',
        h1: 'पूरी ट्रिप शूट करें, "स्टोरेज फ़ुल" के बिना',
        lead: 'होटल Wi-Fi, कैफ़े Wi-Fi, कोई भी Wi-Fi: Lens साथ-साथ बैकअप करता है और फ़ोन ख़ाली करता है, ताकि ट्रिप पर फ़ोटो डिलीट करने के लिए फिर कभी न रुकें।',
        sections: [
          { h2: 'ट्रिप के लिए बना', bullets: ['सिर्फ़ Wi-Fi पर बैकअप, या आप चाहें तो मोबाइल डेटा पर', 'शहर की रोशनी और कैंपफ़ायर के लिए नाइट मोड', 'रिकॉर्ड होते-होते अपलोड होने वाला 4K वीडियो (Android)', 'बेहतरीन शॉट ग्रुप के साथ फ़ुल क्वालिटी में शेयर करें'], body: [] },
          { h2: 'फ़ोन गया, फ़ोटो नहीं', body: ['ट्रिप पर फ़ोन खो जाए या टूट जाए, तो जो बैकअप हो चुका है वह आपके अकाउंट में इंतज़ार कर रहा है। नए फ़ोन पर साइन इन करें और सब वहाँ है।'] },
        ],
      },
    },
  },
  {
    slug: 'wedding-and-event-photos',
    group: 'use-cases',
    icon: '💍',
    name: { en: 'Weddings & events', hi: 'शादी और इवेंट' },
    copy: {
      en: {
        title: 'Wedding and event photos: shoot all day, keep every moment',
        description: 'Hours of video and thousands of photos at a wedding or event? Lens backs them up at original quality and keeps your phone free so you never miss a moment.',
        h1: 'Weddings and events: never miss a moment to "storage full"',
        lead: 'Long ceremonies, dim halls and thousands of shots. Lens is built for exactly that.',
        sections: [
          { h2: 'Built for long days', bullets: ['Long 4K videos upload while recording (Android)', 'Night mode for evening functions', 'Space is freed automatically as backup completes', 'Share the full-quality album with family'], body: [] },
          { h2: 'For photographers too', body: ['Manual controls, RAW, presets and exposure tools, plus your own storage (Google Drive, Dropbox, NAS) for client work.'] },
        ],
      },
      hi: {
        title: 'शादी और इवेंट की फ़ोटो: दिन भर शूट करें, हर पल संभालें',
        description: 'शादी या इवेंट में घंटों का वीडियो और हज़ारों फ़ोटो? Lens इन्हें ओरिजिनल क्वालिटी में बैकअप करता है और फ़ोन ख़ाली रखता है ताकि कोई पल न छूटे।',
        h1: 'शादी और इवेंट: "स्टोरेज फ़ुल" की वजह से कोई पल न छूटे',
        lead: 'लंबी रस्में, कम रोशनी वाले हॉल और हज़ारों शॉट। Lens ठीक इसी के लिए बना है।',
        sections: [
          { h2: 'लंबे दिन के लिए बना', bullets: ['लंबे 4K वीडियो रिकॉर्ड होते-होते अपलोड (Android)', 'शाम के फ़ंक्शन के लिए नाइट मोड', 'बैकअप पूरा होते ही जगह अपने-आप ख़ाली', 'परिवार के साथ फ़ुल क्वालिटी एल्बम शेयर करें'], body: [] },
          { h2: 'फ़ोटोग्राफ़र्स के लिए भी', body: ['मैनुअल कंट्रोल, RAW, प्रीसेट और एक्सपोज़र टूल, साथ में क्लाइंट के काम के लिए अपना स्टोरेज (Google Drive, Dropbox, NAS)।'] },
        ],
      },
    },
  },
];

export const featurePages = pages.filter((p) => p.group === 'features');
export const useCasePages = pages.filter((p) => p.group === 'use-cases');
