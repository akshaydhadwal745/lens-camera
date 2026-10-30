// Guides, the Google Photos comparison and "Why you can trust Lens", English + Hindi.
// Problem-first pages for search: every claim about Lens must match the app
// (../../docs/README.md); claims about other products stay general, dated and
// checkable (no competitor prices). Storage model: owner decision 2026-10-21.
import type { Lang } from '../i18n/ui';
import type { PageCopy } from './pages';

export type GuidePage = {
  /** Language-neutral path, e.g. "guides/phone-storage-full-android". */
  path: string;
  kind: 'guide' | 'compare' | 'trust';
  /** Short name for cards, menus and breadcrumbs. */
  name: Record<Lang, string>;
  copy: Record<Lang, PageCopy>;
  /** Next steps under the page: [label, path]. */
  links: Record<Lang, [string, string][]>;
};

export const guidePages: GuidePage[] = [
  // ---------- Lens vs Google Photos ----------
  {
    path: 'compare/google-photos',
    kind: 'compare',
    name: { en: 'Lens vs Google Photos', hi: 'Lens बनाम Google Photos' },
    copy: {
      en: {
        title: 'Lens vs Google Photos: storage, quality and sharing compared',
        description:
          'An honest comparison as of October 2026: free storage, original quality vs Storage saver, your own storage, the camera, event albums, and where Google Photos is still better.',
        h1: 'Lens vs Google Photos',
        lead: 'An honest look, as of October 2026. Google Photos is a great library. Lens is built for people who want every original kept, a better camera, and more free space for photos.',
        sections: [
          {
            h2: 'At a glance',
            body: ['Facts as of October 2026. Google can change its plans at any time; check its current terms.'],
            table: {
              caption: 'Lens and Google Photos compared',
              head: ['', 'Lens', 'Google Photos'],
              rows: [
                ['Free storage', '40 GB for your first 3 months, then 10 GB free forever, only for photos and videos', '15 GB free, shared across Gmail, Google Drive and Google Photos'],
                ['Quality', 'Always the original file, never re-compressed', 'Original quality, or "Storage saver", which compresses photos and videos to save space'],
                ['Your own storage', 'Back up to your own Google Drive, Dropbox, OneDrive, Box, S3 or WebDAV, with no Lens limit', 'Google storage only'],
                ['Camera', 'Built in: Night, Portrait with blur you can change later, PRO manual controls, RAW, 4K', 'A library app; the camera is a separate app'],
                ['Collecting event photos', 'Event albums with a QR code: guests add photos from the browser, no app needed', 'Shared albums'],
                ['Search and iPhone', 'Basic; the iPhone app is coming later', 'Excellent search; mature iPhone app'],
              ],
            },
          },
          {
            h2: 'Where Lens is better',
            body: [],
            bullets: [
              'Originals only: Lens never offers a lower-quality mode, so nothing you back up is ever compressed',
              'More free space for photos: 40 GB to start and 10 GB forever, not shared with your email',
              'No limit from Lens when you use your own Google Drive, Dropbox, OneDrive, Box, S3 or WebDAV',
              'A pro camera and a non-destructive editor in the same app as your backup',
              'Event albums: one QR code collects everyone’s wedding or party photos, no app needed',
              'Share links that send the original, expire after 1, 7 or 30 days, and can be limited to one person',
              'No ads, no selling your data, no training AI on your photos',
            ],
          },
          {
            h2: 'Where Google Photos is better',
            body: ['We would rather you choose with the full picture.'],
            bullets: [
              'Search: finding a photo by what is in it works very well in Google Photos',
              'iPhone: Google Photos has a mature iPhone app; Lens for iPhone is built but not released yet',
              'History: Google Photos has years of polish, and your old library may already be there',
              'One account: it works with the Google services you already use',
            ],
          },
          {
            h2: 'Use both',
            body: ['Many people keep Google Photos for search and use Lens as the camera and the full-quality backup for new photos. Lens doesn’t lock you in: you can download everything, or keep your originals in your own storage from day one.'],
          },
        ],
        faq: [
          { q: 'Does Google Photos compress my photos?', a: 'Only if you choose "Storage saver". With "Original quality", Google keeps the original but it counts against your 15 GB, which is shared with Gmail and Drive.' },
          { q: 'Can I move my photos from Google Photos to Lens?', a: 'Yes. Download them with Google Takeout, then upload them at full quality from the Lens web app on your computer, or import them in the Lens app (up to 100 at a time).' },
          { q: 'Is Lens storage really free?', a: 'Yes. 40 GB for your first 3 months after you sign in, then 10 GB free forever, plus +10 GB for every friend who joins and backs up (up to 10 friends). Paid plans with more Lens storage are coming; the free plan stays free.' },
          { q: 'If I back up to my own Google Drive, does it use my Google storage?', a: 'Yes. Lens adds no limit of its own, but the space in your own storage is whatever your provider gives you. Dropbox, OneDrive, Box, S3 or a NAS work the same way.' },
        ],
      },
      hi: {
        title: 'Lens बनाम Google Photos: स्टोरेज, क्वालिटी और शेयरिंग की तुलना',
        description:
          'अक्टूबर 2026 तक की ईमानदार तुलना: मुफ़्त स्टोरेज, ओरिजिनल क्वालिटी बनाम स्टोरेज सेवर, अपना स्टोरेज, कैमरा, इवेंट एल्बम, और कहाँ Google Photos अब भी बेहतर है।',
        h1: 'Lens बनाम Google Photos',
        lead: 'एक ईमानदार नज़र, अक्टूबर 2026 तक। Google Photos एक बेहतरीन लाइब्रेरी है। Lens उन लोगों के लिए है जो हर ओरिजिनल संभालना, बेहतर कैमरा और फ़ोटो के लिए ज़्यादा मुफ़्त जगह चाहते हैं।',
        sections: [
          {
            h2: 'एक नज़र में',
            body: ['अक्टूबर 2026 तक की जानकारी। Google अपने प्लान कभी भी बदल सकता है; उसकी मौजूदा शर्तें देखें।'],
            table: {
              caption: 'Lens और Google Photos की तुलना',
              head: ['', 'Lens', 'Google Photos'],
              rows: [
                ['मुफ़्त स्टोरेज', 'पहले 3 महीने 40 GB, फिर हमेशा 10 GB मुफ़्त, सिर्फ़ फ़ोटो और वीडियो के लिए', '15 GB मुफ़्त, Gmail, Google Drive और Google Photos में साझा'],
                ['क्वालिटी', 'हमेशा ओरिजिनल फ़ाइल, कभी दोबारा कंप्रेस नहीं', 'ओरिजिनल क्वालिटी, या "स्टोरेज सेवर", जो जगह बचाने के लिए फ़ोटो और वीडियो कंप्रेस करता है'],
                ['अपना स्टोरेज', 'अपने Google Drive, Dropbox, OneDrive, Box, S3 या WebDAV में बैकअप, Lens की कोई सीमा नहीं', 'सिर्फ़ Google स्टोरेज'],
                ['कैमरा', 'साथ में: नाइट, बाद में बदलने लायक ब्लर वाला पोर्ट्रेट, PRO मैनुअल कंट्रोल, RAW, 4K', 'लाइब्रेरी ऐप; कैमरा अलग ऐप है'],
                ['इवेंट की फ़ोटो इकट्ठा करना', 'QR कोड वाले इवेंट एल्बम: मेहमान ब्राउज़र से फ़ोटो जोड़ते हैं, ऐप की ज़रूरत नहीं', 'शेयर्ड एल्बम'],
                ['सर्च और iPhone', 'बेसिक; iPhone ऐप बाद में आएगा', 'बेहतरीन सर्च; पुराना, भरोसेमंद iPhone ऐप'],
              ],
            },
          },
          {
            h2: 'जहाँ Lens बेहतर है',
            body: [],
            bullets: [
              'सिर्फ़ ओरिजिनल: Lens में कम क्वालिटी वाला मोड है ही नहीं, इसलिए आपका कोई बैकअप कभी कंप्रेस नहीं होता',
              'फ़ोटो के लिए ज़्यादा मुफ़्त जगह: शुरुआत में 40 GB और हमेशा 10 GB, ईमेल के साथ साझा नहीं',
              'अपना Google Drive, Dropbox, OneDrive, Box, S3 या WebDAV इस्तेमाल करने पर Lens की कोई सीमा नहीं',
              'बैकअप वाले उसी ऐप में प्रो कैमरा और ओरिजिनल को न छूने वाला एडिटर',
              'इवेंट एल्बम: एक QR कोड से शादी या पार्टी की सबकी फ़ोटो, ऐप की ज़रूरत नहीं',
              'शेयर लिंक जो ओरिजिनल भेजते हैं, 1, 7 या 30 दिन में ख़त्म होते हैं, और सिर्फ़ एक व्यक्ति तक सीमित हो सकते हैं',
              'कोई विज्ञापन नहीं, आपका डेटा बेचना नहीं, आपकी फ़ोटो पर AI ट्रेनिंग नहीं',
            ],
          },
          {
            h2: 'जहाँ Google Photos बेहतर है',
            body: ['हम चाहते हैं कि आप पूरी तस्वीर देखकर चुनें।'],
            bullets: [
              'सर्च: फ़ोटो में क्या है, उससे फ़ोटो ढूँढना Google Photos में बहुत अच्छा चलता है',
              'iPhone: Google Photos का iPhone ऐप पुराना और भरोसेमंद है; Lens का iPhone ऐप बना हुआ है पर अभी रिलीज़ नहीं हुआ',
              'इतिहास: Google Photos में सालों की बारीकी है, और आपकी पुरानी लाइब्रेरी शायद पहले से वहाँ है',
              'एक अकाउंट: यह उन Google सेवाओं के साथ चलता है जो आप पहले से इस्तेमाल करते हैं',
            ],
          },
          {
            h2: 'दोनों इस्तेमाल करें',
            body: ['कई लोग सर्च के लिए Google Photos रखते हैं और नई फ़ोटो के लिए कैमरा और फ़ुल क्वालिटी बैकअप के तौर पर Lens इस्तेमाल करते हैं। Lens आपको बाँधता नहीं: आप सब कुछ डाउनलोड कर सकते हैं, या पहले दिन से अपने ओरिजिनल अपने स्टोरेज में रख सकते हैं।'],
          },
        ],
        faq: [
          { q: 'क्या Google Photos मेरी फ़ोटो कंप्रेस करता है?', a: 'सिर्फ़ तब जब आप "स्टोरेज सेवर" चुनें। "ओरिजिनल क्वालिटी" में Google ओरिजिनल रखता है, पर वह आपके 15 GB में गिना जाता है, जो Gmail और Drive के साथ साझा है।' },
          { q: 'क्या मैं Google Photos से अपनी फ़ोटो Lens में ला सकता हूँ?', a: 'हाँ। Google Takeout से डाउनलोड करें, फिर कंप्यूटर पर Lens वेब ऐप से पूरी क्वालिटी में अपलोड करें, या Lens ऐप में इम्पोर्ट करें (एक बार में 100 तक)।' },
          { q: 'क्या Lens स्टोरेज सच में मुफ़्त है?', a: 'हाँ। साइन इन के बाद पहले 3 महीने 40 GB, फिर हमेशा 10 GB मुफ़्त, साथ में जुड़कर बैकअप करने वाले हर दोस्त पर +10 GB (10 दोस्तों तक)। ज़्यादा Lens स्टोरेज वाले पेड प्लान आ रहे हैं; फ़्री प्लान मुफ़्त ही रहेगा।' },
          { q: 'अपने Google Drive में बैकअप करूँ तो क्या मेरा Google स्टोरेज इस्तेमाल होगा?', a: 'हाँ। Lens अपनी कोई सीमा नहीं लगाता, पर आपके स्टोरेज में उतनी ही जगह है जितनी आपका प्रोवाइडर देता है। Dropbox, OneDrive, Box, S3 या NAS भी ऐसे ही चलते हैं।' },
        ],
      },
    },
    links: {
      en: [['Pricing', 'pricing'], ['Free cloud backup', 'features/free-cloud-backup'], ['Use your own storage', 'features/your-own-storage'], ['Google storage full?', 'guides/google-photos-storage-full']],
      hi: [['कीमत', 'pricing'], ['मुफ़्त क्लाउड बैकअप', 'features/free-cloud-backup'], ['अपना स्टोरेज जोड़ें', 'features/your-own-storage'], ['Google स्टोरेज फ़ुल?', 'guides/google-photos-storage-full']],
    },
  },

  // ---------- Google storage full ----------
  {
    path: 'guides/google-photos-storage-full',
    kind: 'guide',
    name: { en: 'Google storage full?', hi: 'Google स्टोरेज फ़ुल?' },
    copy: {
      en: {
        title: 'Google Photos storage full? What to do, step by step',
        description:
          'Your Google storage is full and photos stopped backing up. What is using the space, what you can safely clean up, and how to keep backing up photos at full quality.',
        h1: 'Google storage full? Here’s what to do',
        lead: 'When your Google storage is full, new photos stop backing up and email can stop arriving. Here is how to get space back, and how to keep every new photo safe.',
        sections: [
          {
            h2: 'Why it fills up',
            body: ['Google gives 15 GB free per account, shared across Gmail, Google Drive and Google Photos. Photos and videos at original quality are usually the biggest part, and one phone full of 4K video can use it all.'],
          },
          {
            h2: '1. See what is using the space',
            body: ['Open Google’s storage management page from Google One or from the storage line in Google Photos. It lists large files, large emails and items you have deleted but are still in the trash.'],
          },
          {
            h2: '2. Clean up what you don’t need',
            body: [],
            bullets: [
              'Empty the trash in Gmail, Drive and Google Photos: deleted items still count until the trash is emptied',
              'Delete emails with large attachments you have saved elsewhere',
              'Remove blurry photos, screenshots and duplicate videos',
              'Careful: with backup on, deleting a photo in Google Photos can remove it from your phone too',
            ],
          },
          {
            h2: '3. Choose where new photos go',
            body: ['You can buy more Google storage, or switch to Storage saver, which compresses photos and videos. If you want to keep originals without paying, use a second backup for photos:'],
            bullets: [
              'Lens: 40 GB free for your first 3 months, then 10 GB free forever, always at original quality',
              '+10 GB for every friend who joins Lens and backs up (up to 10 friends)',
              'Already have Dropbox, OneDrive, Box, S3 or a NAS? Lens backs up there with no Lens limit',
            ],
          },
          {
            h2: '4. Move old photos, if you want',
            body: ['Download your library with Google Takeout, then upload it at full quality from the Lens web app on your computer. Check everything arrived before you delete anything from Google.'],
          },
        ],
        faq: [
          { q: 'Will my photos be deleted when Google storage is full?', a: 'Google stops backing up new photos when you are over the limit. Check Google’s current policy for accounts that stay over the limit for a long time.' },
          { q: 'Does Lens use my Google storage?', a: 'Not unless you choose to connect your Google Drive. By default, Lens stores your photos in its own storage, separate from Google.' },
          { q: 'What happens when the Lens 40 GB welcome ends?', a: 'Nothing is deleted. Everything stays viewable and downloadable. Only new backups to Lens storage pause above the free 10 GB, until you invite friends, free space, or switch to your own storage. You get reminders 14, 3 and 1 days before. If you stay above the limit for 5 months, what is above it is deleted (most recent first), with reminders 90, 30, 7 and 1 days before.' },
        ],
      },
      hi: {
        title: 'Google Photos स्टोरेज फ़ुल? क्या करें, क़दम-दर-क़दम',
        description:
          'आपका Google स्टोरेज भर गया और फ़ोटो का बैकअप रुक गया। जगह किसने ली, क्या सुरक्षित तरीके से हटा सकते हैं, और फ़ोटो का फ़ुल क्वालिटी बैकअप कैसे जारी रखें।',
        h1: 'Google स्टोरेज फ़ुल? ये करें',
        lead: 'Google स्टोरेज भर जाने पर नई फ़ोटो का बैकअप रुक जाता है और ईमेल आना भी बंद हो सकता है। जगह वापस पाने और हर नई फ़ोटो सुरक्षित रखने का तरीका यह है।',
        sections: [
          {
            h2: 'यह क्यों भरता है',
            body: ['Google हर अकाउंट को 15 GB मुफ़्त देता है, जो Gmail, Google Drive और Google Photos में साझा है। ओरिजिनल क्वालिटी वाली फ़ोटो और वीडियो आमतौर पर सबसे बड़ा हिस्सा होते हैं, और 4K वीडियो से भरा एक फ़ोन पूरा कोटा ले सकता है।'],
          },
          {
            h2: '1. देखें कि जगह किसने ली',
            body: ['Google One से या Google Photos की स्टोरेज लाइन से Google का स्टोरेज मैनेजमेंट पेज खोलें। उसमें बड़ी फ़ाइलें, बड़े ईमेल और वे चीज़ें दिखती हैं जो डिलीट करने के बाद भी ट्रैश में हैं।'],
          },
          {
            h2: '2. जिसकी ज़रूरत नहीं, उसे हटाएँ',
            body: [],
            bullets: [
              'Gmail, Drive और Google Photos का ट्रैश ख़ाली करें: ट्रैश ख़ाली होने तक डिलीट की गई चीज़ें भी गिनी जाती हैं',
              'बड़े अटैचमेंट वाले ईमेल डिलीट करें जिन्हें आपने कहीं और सेव कर लिया है',
              'धुँधली फ़ोटो, स्क्रीनशॉट और दोहरे वीडियो हटाएँ',
              'ध्यान दें: बैकअप चालू हो तो Google Photos में फ़ोटो डिलीट करने से वह आपके फ़ोन से भी हट सकती है',
            ],
          },
          {
            h2: '3. तय करें कि नई फ़ोटो कहाँ जाएँ',
            body: ['आप और Google स्टोरेज ख़रीद सकते हैं, या स्टोरेज सेवर पर जा सकते हैं, जो फ़ोटो और वीडियो कंप्रेस करता है। अगर बिना भुगतान के ओरिजिनल रखने हैं, तो फ़ोटो के लिए दूसरा बैकअप इस्तेमाल करें:'],
            bullets: [
              'Lens: पहले 3 महीने 40 GB मुफ़्त, फिर हमेशा 10 GB मुफ़्त, हमेशा ओरिजिनल क्वालिटी में',
              'Lens से जुड़कर बैकअप करने वाले हर दोस्त पर +10 GB (10 दोस्तों तक)',
              'पहले से Dropbox, OneDrive, Box, S3 या NAS है? Lens वहाँ बैकअप करता है, Lens की कोई सीमा नहीं',
            ],
          },
          {
            h2: '4. चाहें तो पुरानी फ़ोटो ले आएँ',
            body: ['Google Takeout से अपनी लाइब्रेरी डाउनलोड करें, फिर कंप्यूटर पर Lens वेब ऐप से पूरी क्वालिटी में अपलोड करें। Google से कुछ भी डिलीट करने से पहले जाँच लें कि सब पहुँच गया।'],
          },
        ],
        faq: [
          { q: 'Google स्टोरेज फ़ुल होने पर क्या मेरी फ़ोटो डिलीट हो जाएँगी?', a: 'सीमा से ऊपर होने पर Google नई फ़ोटो का बैकअप रोक देता है। लंबे समय तक सीमा से ऊपर रहने वाले अकाउंट के लिए Google की मौजूदा पॉलिसी देखें।' },
          { q: 'क्या Lens मेरा Google स्टोरेज इस्तेमाल करता है?', a: 'नहीं, जब तक आप अपना Google Drive न जोड़ें। डिफ़ॉल्ट रूप से Lens आपकी फ़ोटो अपने स्टोरेज में रखता है, Google से अलग।' },
          { q: 'Lens का 40 GB वेलकम ख़त्म होने पर क्या होगा?', a: 'कुछ भी डिलीट नहीं होता। सब कुछ देख और डाउनलोड कर सकते हैं। मुफ़्त 10 GB से ऊपर सिर्फ़ Lens स्टोरेज में नए बैकअप रुकते हैं, जब तक आप दोस्तों को इनवाइट न करें, जगह ख़ाली न करें या अपने स्टोरेज पर न जाएँ। 14, 3 और 1 दिन पहले याद दिलाया जाता है। अगर आप 5 महीने तक सीमा से ऊपर रहते हैं, तो सीमा से ऊपर का कंटेंट डिलीट होता है (सबसे हाल का पहले), 90, 30, 7 और 1 दिन पहले याद दिलाकर।' },
        ],
      },
    },
    links: {
      en: [['Lens vs Google Photos', 'compare/google-photos'], ['Free cloud backup', 'features/free-cloud-backup'], ['Pricing', 'pricing'], ['Web app', 'features/web-app']],
      hi: [['Lens बनाम Google Photos', 'compare/google-photos'], ['मुफ़्त क्लाउड बैकअप', 'features/free-cloud-backup'], ['कीमत', 'pricing'], ['वेब ऐप', 'features/web-app']],
    },
  },

  // ---------- WhatsApp full quality ----------
  {
    path: 'guides/send-full-quality-photos-whatsapp',
    kind: 'guide',
    name: { en: 'Full-quality photos on WhatsApp', hi: 'WhatsApp पर फ़ुल क्वालिटी फ़ोटो' },
    copy: {
      en: {
        title: 'How to send full-quality photos and videos on WhatsApp',
        description:
          'WhatsApp compresses photos and videos, even in HD. Sending as a document keeps the file but is clumsy. How to send the originals with a Lens share link instead.',
        h1: 'Send full-quality photos on WhatsApp',
        lead: 'WhatsApp makes your photos smaller so they send fast. Here is why they look worse, and how to send the original instead.',
        sections: [
          {
            h2: 'Why your photos look worse on WhatsApp',
            body: ['To save data, WhatsApp compresses photos and videos before sending them. Detail, colour and sharpness are lost, and long videos are shortened in quality the most.'],
            bullets: [
              'Standard quality: the most compression',
              'HD: sharper, but still a compressed copy, not your original',
              'As a document: keeps the original file, but it arrives as a file, not a photo, and is clumsy for many photos or long videos',
            ],
          },
          {
            h2: 'Send the originals with a Lens link',
            body: ['A Lens share link sends the exact files your camera made. You paste the link into WhatsApp; your friends open it and see the photos, even without Lens.'],
            bullets: [
              'In Lens, select up to 20 photos or videos and tap Share → Share by link',
              'Choose who can open it: anyone with the link, or only one person',
              'Choose how long it works: 1, 7 or 30 days',
              'Tap Create link → Send… → WhatsApp',
            ],
          },
          {
            h2: 'What your friends see',
            body: ['The link opens in any browser. They see the photos and videos and can save each original file. If they have Lens, the items go straight to their Shared tab at full quality.'],
          },
          {
            h2: 'Private by default',
            body: ['Where a photo was taken is removed unless you choose to include it. In Settings → Sharing → Share links you see how often each link was viewed and who opened it in Lens, and you can turn a link off at any time.'],
          },
        ],
        faq: [
          { q: 'Does WhatsApp HD send the original photo?', a: 'No. HD sends a larger, sharper version than standard, but WhatsApp still compresses it.' },
          { q: 'Do my friends need Lens to open the link?', a: 'No. The link opens in any browser on any phone or computer.' },
          { q: 'How many photos can I send in one link?', a: 'Up to 20 photos and videos per link. For a big group or an event, use an event album with a QR code instead.' },
        ],
      },
      hi: {
        title: 'WhatsApp पर फ़ुल क्वालिटी फ़ोटो और वीडियो कैसे भेजें',
        description:
          'WhatsApp फ़ोटो और वीडियो कंप्रेस करता है, HD में भी। डॉक्यूमेंट की तरह भेजने से फ़ाइल बचती है पर यह झंझट है। इसके बजाय Lens शेयर लिंक से ओरिजिनल कैसे भेजें।',
        h1: 'WhatsApp पर फ़ुल क्वालिटी फ़ोटो भेजें',
        lead: 'WhatsApp आपकी फ़ोटो छोटी कर देता है ताकि वे जल्दी जाएँ। वे ख़राब क्यों दिखती हैं, और इसके बजाय ओरिजिनल कैसे भेजें, यह रहा।',
        sections: [
          {
            h2: 'WhatsApp पर फ़ोटो ख़राब क्यों दिखती हैं',
            body: ['डेटा बचाने के लिए WhatsApp भेजने से पहले फ़ोटो और वीडियो कंप्रेस करता है। डिटेल, रंग और शार्पनेस कम हो जाती है, और लंबे वीडियो की क्वालिटी सबसे ज़्यादा घटती है।'],
            bullets: [
              'स्टैंडर्ड क्वालिटी: सबसे ज़्यादा कंप्रेशन',
              'HD: ज़्यादा साफ़, पर फिर भी कंप्रेस की हुई कॉपी, आपका ओरिजिनल नहीं',
              'डॉक्यूमेंट की तरह: ओरिजिनल फ़ाइल बचती है, पर फ़ोटो नहीं, फ़ाइल बनकर पहुँचती है, और कई फ़ोटो या लंबे वीडियो के लिए झंझट है',
            ],
          },
          {
            h2: 'Lens लिंक से ओरिजिनल भेजें',
            body: ['Lens शेयर लिंक वही फ़ाइलें भेजता है जो आपके कैमरे ने बनाईं। आप लिंक WhatsApp में भेजते हैं; दोस्त उसे खोलकर फ़ोटो देखते हैं, बिना Lens के भी।'],
            bullets: [
              'Lens में 20 तक फ़ोटो या वीडियो चुनें और Share → Share by link दबाएँ',
              'चुनें कि कौन खोल सकता है: लिंक वाला कोई भी, या सिर्फ़ एक व्यक्ति',
              'चुनें कि लिंक कितने दिन चले: 1, 7 या 30 दिन',
              'Create link → Send… → WhatsApp दबाएँ',
            ],
          },
          {
            h2: 'आपके दोस्तों को क्या दिखता है',
            body: ['लिंक किसी भी ब्राउज़र में खुलता है। वे फ़ोटो और वीडियो देखते हैं और हर ओरिजिनल फ़ाइल सेव कर सकते हैं। उनके पास Lens हो तो चीज़ें सीधे उनके Shared टैब में फ़ुल क्वालिटी में आती हैं।'],
          },
          {
            h2: 'डिफ़ॉल्ट रूप से प्राइवेट',
            body: ['फ़ोटो कहाँ ली गई, यह हटा दिया जाता है, जब तक आप उसे शामिल न करें। Settings → Sharing → Share links में दिखता है कि हर लिंक कितनी बार देखा गया और Lens में किसने खोला, और आप कभी भी लिंक बंद कर सकते हैं।'],
          },
        ],
        faq: [
          { q: 'क्या WhatsApp HD ओरिजिनल फ़ोटो भेजता है?', a: 'नहीं। HD स्टैंडर्ड से बड़ा, साफ़ वर्शन भेजता है, पर WhatsApp उसे फिर भी कंप्रेस करता है।' },
          { q: 'क्या लिंक खोलने के लिए दोस्तों को Lens चाहिए?', a: 'नहीं। लिंक किसी भी फ़ोन या कंप्यूटर के ब्राउज़र में खुलता है।' },
          { q: 'एक लिंक में कितनी फ़ोटो भेज सकते हैं?', a: 'हर लिंक में 20 तक फ़ोटो और वीडियो। बड़े ग्रुप या इवेंट के लिए इसके बजाय QR कोड वाला इवेंट एल्बम इस्तेमाल करें।' },
        ],
      },
    },
    links: {
      en: [['Sharing', 'features/sharing'], ['Collect wedding photos with a QR code', 'guides/collect-wedding-photos-qr-code']],
      hi: [['शेयरिंग', 'features/sharing'], ['QR कोड से शादी की फ़ोटो इकट्ठा करें', 'guides/collect-wedding-photos-qr-code']],
    },
  },

  // ---------- Wedding photos QR ----------
  {
    path: 'guides/collect-wedding-photos-qr-code',
    kind: 'guide',
    name: { en: 'Collect wedding photos with a QR code', hi: 'QR कोड से शादी की फ़ोटो' },
    copy: {
      en: {
        title: 'How to collect wedding and event photos from guests with a QR code',
        description:
          'Make a Lens event album, show its QR code, and guests add their photos from any phone, in the browser, no app needed. Step by step, with tips for the day.',
        h1: 'Collect every guest’s photos with one QR code',
        lead: 'Your guests take hundreds of great photos. Without a plan, they stay on their phones or get compressed in group chats. A Lens event album brings them all together, at full quality.',
        sections: [
          {
            h2: 'Before the event',
            body: [],
            bullets: [
              'In Lens, make an album and give it the event’s name',
              'Open the album and tap Invite with QR; Lens explains that anyone with the code can see the album and add photos',
              'Save or print the QR code: table cards, the welcome sign, the back of the menu',
              'Or share the link in your family or guest group',
            ],
          },
          {
            h2: 'On the day',
            body: ['Guests point their phone camera at the code. A page opens with the album; they tap Add your photos and pick them from their gallery. No app, no account, no password.'],
            bullets: [
              'Works on Android and iPhone, in the browser',
              'Up to 50 photos at a time from the browser; guests with Lens can add videos too',
              'Everyone in the album sees new photos as they arrive',
            ],
          },
          {
            h2: 'After the event',
            body: ['Turn the link off when you are done: the code stops working at once, and people already in keep the album. Whoever added a photo can remove it, and so can you.'],
          },
          {
            h2: 'Why it beats a group chat',
            body: [],
            bullets: [
              'Original files, not chat-compressed copies',
              'One album instead of photos scattered over many chats',
              'Photos count against each guest’s own storage, not yours',
              'Up to 500 people and 2,000 photos per album',
            ],
          },
        ],
        faq: [
          { q: 'Is it free?', a: 'Yes. Event albums are part of the free plan.' },
          { q: 'Can people who are not invited see the album?', a: 'Anyone who has the link or the QR code can see it and add photos, so only share it with your guests. Turn the link off when the event is over.' },
          { q: 'Where do I see all the photos?', a: 'Everyone who joined sees every photo in the album in Lens, on their phone or in the web app on a computer. Guests who added photos from the browser can get Lens or sign in to keep them.' },
        ],
      },
      hi: {
        title: 'QR कोड से मेहमानों की शादी और इवेंट की फ़ोटो कैसे इकट्ठा करें',
        description:
          'Lens इवेंट एल्बम बनाएँ, उसका QR कोड दिखाएँ, और मेहमान किसी भी फ़ोन से, ब्राउज़र में, बिना ऐप के फ़ोटो जोड़ें। क़दम-दर-क़दम, उस दिन के लिए सुझावों के साथ।',
        h1: 'एक QR कोड से हर मेहमान की फ़ोटो',
        lead: 'आपके मेहमान सैकड़ों शानदार फ़ोटो लेते हैं। बिना तैयारी के वे उनके फ़ोन में रह जाती हैं या ग्रुप चैट में कंप्रेस हो जाती हैं। Lens इवेंट एल्बम उन्हें एक जगह लाता है, पूरी क्वालिटी में।',
        sections: [
          {
            h2: 'इवेंट से पहले',
            body: [],
            bullets: [
              'Lens में एल्बम बनाएँ और उसे इवेंट का नाम दें',
              'एल्बम खोलें और Invite with QR दबाएँ; Lens बताता है कि कोड वाला कोई भी एल्बम देख और फ़ोटो जोड़ सकता है',
              'QR कोड सेव या प्रिंट करें: टेबल कार्ड, वेलकम बोर्ड, मेन्यू के पीछे',
              'या लिंक अपने परिवार या मेहमानों के ग्रुप में भेजें',
            ],
          },
          {
            h2: 'उस दिन',
            body: ['मेहमान फ़ोन कैमरा कोड की तरफ़ करते हैं। एल्बम वाला पेज खुलता है; वे Add your photos दबाकर गैलरी से फ़ोटो चुनते हैं। न ऐप, न अकाउंट, न पासवर्ड।'],
            bullets: [
              'Android और iPhone पर, ब्राउज़र में चलता है',
              'ब्राउज़र से एक बार में 50 तक फ़ोटो; Lens वाले मेहमान वीडियो भी जोड़ सकते हैं',
              'एल्बम में सबको नई फ़ोटो आते ही दिखती हैं',
            ],
          },
          {
            h2: 'इवेंट के बाद',
            body: ['काम पूरा होने पर लिंक बंद करें: कोड तुरंत काम करना बंद कर देता है, और जो पहले से जुड़े हैं उनके पास एल्बम रहता है। जिसने फ़ोटो जोड़ी वह उसे हटा सकता है, और आप भी।'],
          },
          {
            h2: 'ग्रुप चैट से बेहतर क्यों',
            body: [],
            bullets: [
              'ओरिजिनल फ़ाइलें, चैट में कंप्रेस हुई कॉपी नहीं',
              'कई चैट में बिखरी फ़ोटो के बजाय एक एल्बम',
              'फ़ोटो हर मेहमान के अपने स्टोरेज में गिनी जाती हैं, आपके में नहीं',
              'हर एल्बम में 500 लोग और 2,000 फ़ोटो तक',
            ],
          },
        ],
        faq: [
          { q: 'क्या यह मुफ़्त है?', a: 'हाँ। इवेंट एल्बम फ़्री प्लान का हिस्सा हैं।' },
          { q: 'क्या बिना बुलाए लोग एल्बम देख सकते हैं?', a: 'जिसके पास लिंक या QR कोड है वह इसे देख और फ़ोटो जोड़ सकता है, इसलिए इसे सिर्फ़ अपने मेहमानों के साथ शेयर करें। इवेंट ख़त्म होने पर लिंक बंद करें।' },
          { q: 'सारी फ़ोटो कहाँ दिखेंगी?', a: 'जुड़ने वाले सभी लोग एल्बम की हर फ़ोटो Lens में देखते हैं, फ़ोन पर या कंप्यूटर पर वेब ऐप में। ब्राउज़र से फ़ोटो जोड़ने वाले मेहमान उन्हें संभालने के लिए Lens ले सकते हैं या साइन इन कर सकते हैं।' },
        ],
      },
    },
    links: {
      en: [['Weddings & events', 'use-cases/wedding-and-event-photos'], ['Sharing', 'features/sharing'], ['Get the app', 'download']],
      hi: [['शादी और इवेंट', 'use-cases/wedding-and-event-photos'], ['शेयरिंग', 'features/sharing'], ['ऐप पाएँ', 'download']],
    },
  },

  // ---------- Phone storage full (Android) ----------
  {
    path: 'guides/phone-storage-full-android',
    kind: 'guide',
    name: { en: 'Android storage full?', hi: 'Android स्टोरेज फ़ुल?' },
    copy: {
      en: {
        title: 'Android phone storage full? 6 safe ways to free up space',
        description:
          '"Storage full" on Android? Find what is using space, clear chat media and apps, and free gigabytes of photos and videos safely, only after they are backed up.',
        h1: 'Android storage full? Free up space safely',
        lead: 'A full phone stops taking photos, updates and messages. Here are six steps that work on any Android phone, from the quickest to the biggest win.',
        sections: [
          {
            h2: '1. See what is using space',
            body: ['Open Settings → Storage (on some phones it is under Battery and device care, or Device care). You will see how much goes to photos and videos, apps, and other files. Photos and videos are usually the biggest.'],
          },
          {
            h2: '2. Clear chat media',
            body: ['Chat apps save every photo, video and voice note you receive. In WhatsApp, open Settings → Storage and data → Manage storage to find and delete large files and forwarded media.'],
          },
          {
            h2: '3. Remove apps you don’t use',
            body: ['Uninstall apps you haven’t opened in months, and clear the cache of big apps in Settings → Apps.'],
          },
          {
            h2: '4. Empty Downloads and the gallery trash',
            body: ['Old downloads (PDFs, installers, forwarded videos) add up. Many galleries also keep deleted photos in a trash or "recently deleted" folder for weeks: empty it.'],
          },
          {
            h2: '5. Back up photos and videos first',
            body: ['Before you delete any photo, make sure a full-quality copy is safe somewhere else. Lens backs up every photo and video at original quality and checks each upload against the file on your phone.'],
            bullets: ['40 GB free for your first 3 months, then 10 GB free forever', 'No Lens limit with your own Google Drive, Dropbox, OneDrive, Box, S3 or WebDAV (your provider’s space applies)'],
          },
          {
            h2: '6. Let Lens free the space',
            body: ['In Lens, open Settings → On this device and tap "Free up space now". Every original that is already safe in the cloud leaves your phone; a sharp preview stays, so your gallery still works offline.'],
            bullets: ['Nothing is removed until its cloud copy is verified', 'Keep originals on the phone for the number of days you choose (7 by default)', 'Lens always keeps the space you choose free (2 GB by default)'],
          },
        ],
        faq: [
          { q: 'Is it safe to delete photos after backup?', a: 'Only once the backup is verified. Lens removes a file from your phone only after the cloud copy has been checked against it, and never touches anything still waiting to upload.' },
          { q: 'Can I still open the full photo after Lens frees space?', a: 'Yes. The original loads from the cloud when you open, share or save it. Previews work offline.' },
          { q: 'What if I don’t want my photos in the cloud?', a: 'Then copy them to a computer or an SD card before deleting. Lens can also back up to your own NAS over WebDAV.' },
        ],
      },
      hi: {
        title: 'Android फ़ोन स्टोरेज फ़ुल? जगह ख़ाली करने के 6 सुरक्षित तरीके',
        description:
          'Android पर "स्टोरेज फ़ुल"? देखें जगह किसने ली, चैट मीडिया और ऐप साफ़ करें, और फ़ोटो-वीडियो की गीगाबाइट जगह सुरक्षित तरीके से ख़ाली करें, बैकअप के बाद ही।',
        h1: 'Android स्टोरेज फ़ुल? सुरक्षित तरीके से जगह ख़ाली करें',
        lead: 'भरा हुआ फ़ोन फ़ोटो, अपडेट और मैसेज लेना बंद कर देता है। ये छह क़दम हर Android फ़ोन पर चलते हैं, सबसे जल्दी वाले से सबसे बड़े फ़ायदे तक।',
        sections: [
          {
            h2: '1. देखें कि जगह किसने ली',
            body: ['Settings → Storage खोलें (कुछ फ़ोन में यह Battery and device care या Device care के अंदर है)। दिखेगा कि फ़ोटो और वीडियो, ऐप और दूसरी फ़ाइलें कितनी जगह लेती हैं। आमतौर पर फ़ोटो और वीडियो सबसे ज़्यादा होते हैं।'],
          },
          {
            h2: '2. चैट मीडिया साफ़ करें',
            body: ['चैट ऐप आपको मिली हर फ़ोटो, वीडियो और वॉइस नोट सेव करते हैं। WhatsApp में Settings → Storage and data → Manage storage खोलकर बड़ी फ़ाइलें और फ़ॉरवर्ड किया मीडिया ढूँढें और डिलीट करें।'],
          },
          {
            h2: '3. बेकार ऐप हटाएँ',
            body: ['जो ऐप महीनों से नहीं खोले, उन्हें अनइंस्टॉल करें, और Settings → Apps में बड़े ऐप का कैश साफ़ करें।'],
          },
          {
            h2: '4. Downloads और गैलरी का ट्रैश ख़ाली करें',
            body: ['पुराने डाउनलोड (PDF, इंस्टॉलर, फ़ॉरवर्ड किए वीडियो) जगह घेरते हैं। कई गैलरी डिलीट की गई फ़ोटो को हफ़्तों तक ट्रैश या "हाल ही में डिलीट" फ़ोल्डर में रखती हैं: उसे ख़ाली करें।'],
          },
          {
            h2: '5. पहले फ़ोटो और वीडियो का बैकअप लें',
            body: ['कोई भी फ़ोटो डिलीट करने से पहले पक्का करें कि उसकी फ़ुल क्वालिटी कॉपी कहीं और सुरक्षित है। Lens हर फ़ोटो और वीडियो का ओरिजिनल क्वालिटी में बैकअप लेता है और हर अपलोड को फ़ोन की फ़ाइल से मिलाकर जाँचता है।'],
            bullets: ['पहले 3 महीने 40 GB मुफ़्त, फिर हमेशा 10 GB मुफ़्त', 'अपने Google Drive, Dropbox, OneDrive, Box, S3 या WebDAV के साथ Lens की कोई सीमा नहीं (जगह आपके प्रोवाइडर की)'],
          },
          {
            h2: '6. Lens को जगह ख़ाली करने दें',
            body: ['Lens में Settings → On this device खोलें और "Free up space now" दबाएँ। जो ओरिजिनल क्लाउड में सुरक्षित हैं, वे फ़ोन से हट जाते हैं; साफ़ प्रीव्यू रहता है, इसलिए गैलरी ऑफ़लाइन भी चलती है।'],
            bullets: ['क्लाउड कॉपी जाँचे जाने तक कुछ नहीं हटता', 'ओरिजिनल फ़ोन पर कितने दिन रहें, आप तय करें (डिफ़ॉल्ट 7)', 'Lens हमेशा आपकी चुनी जगह ख़ाली रखता है (डिफ़ॉल्ट 2 GB)'],
          },
        ],
        faq: [
          { q: 'क्या बैकअप के बाद फ़ोटो डिलीट करना सुरक्षित है?', a: 'सिर्फ़ तब जब बैकअप जाँच लिया गया हो। Lens फ़ाइल फ़ोन से तभी हटाता है जब क्लाउड कॉपी उससे मिलाकर जाँच ली गई हो, और अपलोड का इंतज़ार कर रही किसी चीज़ को कभी नहीं छूता।' },
          { q: 'Lens के जगह ख़ाली करने के बाद क्या पूरी फ़ोटो खुलेगी?', a: 'हाँ। खोलने, शेयर या सेव करने पर ओरिजिनल क्लाउड से आता है। प्रीव्यू ऑफ़लाइन चलते हैं।' },
          { q: 'अगर मुझे फ़ोटो क्लाउड में नहीं रखनी तो?', a: 'तो डिलीट करने से पहले उन्हें कंप्यूटर या SD कार्ड पर कॉपी करें। Lens WebDAV से आपके अपने NAS पर भी बैकअप कर सकता है।' },
        ],
      },
    },
    links: {
      en: [['Phone storage full?', 'use-cases/phone-storage-full'], ['Free cloud backup', 'features/free-cloud-backup'], ['Help: phone space', 'help']],
      hi: [['फ़ोन स्टोरेज फ़ुल?', 'use-cases/phone-storage-full'], ['मुफ़्त क्लाउड बैकअप', 'features/free-cloud-backup'], ['मदद: फ़ोन की जगह', 'help']],
    },
  },

  // ---------- Trust ----------
  {
    path: 'trust',
    kind: 'trust',
    name: { en: 'Why you can trust Lens', hi: 'Lens पर भरोसा क्यों' },
    copy: {
      en: {
        title: 'Why you can trust Lens with your photos',
        description:
          'Who makes Lens, where your photos are stored, how originals are protected, how to download everything or leave at any time, and what we will never do with your photos.',
        h1: 'Why you can trust Lens',
        lead: 'Your photos are your memories. Here is plainly who we are, where they live, and how you stay in control.',
        sections: [
          { h2: 'Who makes Lens', body: ['Lens is made by InstaGrow, an independent team. We build the app, the website and the cloud ourselves, and messages from the contact form go straight to the team.'] },
          { h2: 'Where your photos are stored', body: ['In Amazon Web Services, Mumbai region (India), encrypted at rest and sent only over HTTPS. Or, if you connect one, in your own Google Drive, Dropbox, OneDrive, Box, S3 or WebDAV storage.'] },
          { h2: 'Originals, untouched', body: ['Lens stores the exact file your camera made, checked with a checksum when it arrives. It is never re-compressed. Edits are saved separately, so the original is always there.'] },
          {
            h2: 'You can always leave',
            body: [],
            bullets: [
              'Download any original, on your phone or from the web app on a computer',
              'Keep your originals in your own storage, so you’re never locked in',
              'Delete your account and everything in it at any time, from the app or the website',
              'Deleted something by mistake? In Lens storage it can be recovered for a year (Trash, then Archive)',
              'If the welcome storage ends or you go over the free limit, nothing is deleted; only after 5 months above the limit, with four reminders, is what’s above it removed',
            ],
          },
          {
            h2: 'What we will never do',
            body: [],
            bullets: ['Show ads', 'Sell or rent your data', 'Train AI on your photos', 'Look at your photos, beyond the automated processing you ask for (previews, streaming copies)'],
          },
          {
            h2: 'The privacy policy, in short',
            body: ['We collect only what Lens needs to work: your account, your photos and videos, and what is needed to keep the service safe. Face grouping (People) happens on your phone and is never uploaded. You can see, download and delete your data. The full policy says exactly what, why and for how long.'],
          },
          { h2: 'Talk to us', body: ['Questions, a problem or a privacy request: use the contact form. It goes to the people who build Lens.'] },
        ],
        faq: [
          { q: 'Is Lens a big company?', a: 'No. Lens is made by InstaGrow, a small independent team. That is why we keep the rules simple: no ads, no selling data, and you can leave with everything at any time.' },
          { q: 'What happens to my photos if Lens ever shuts down?', a: 'Our terms promise at least 60 days’ notice, so you can download your whole library. If you use your own storage, your originals are already there.' },
          { q: 'Can Lens staff see my photos?', a: 'We don’t look at your photos. They are processed automatically only for what you ask for, like previews and streaming copies, and every link to a file is signed and expires.' },
        ],
      },
      hi: {
        title: 'आप अपनी फ़ोटो के लिए Lens पर भरोसा क्यों कर सकते हैं',
        description:
          'Lens कौन बनाता है, आपकी फ़ोटो कहाँ रहती हैं, ओरिजिनल कैसे सुरक्षित रहते हैं, कभी भी सब कुछ डाउनलोड करके कैसे छोड़ें, और हम आपकी फ़ोटो के साथ क्या कभी नहीं करेंगे।',
        h1: 'Lens पर भरोसा क्यों करें',
        lead: 'आपकी फ़ोटो आपकी यादें हैं। साफ़-साफ़ बताते हैं कि हम कौन हैं, वे कहाँ रहती हैं, और कंट्रोल आपके हाथ में कैसे रहता है।',
        sections: [
          { h2: 'Lens कौन बनाता है', body: ['Lens को InstaGrow बनाता है, एक स्वतंत्र टीम। ऐप, वेबसाइट और क्लाउड हम ख़ुद बनाते हैं, और संपर्क फ़ॉर्म के मैसेज सीधे टीम तक पहुँचते हैं।'] },
          { h2: 'आपकी फ़ोटो कहाँ रहती हैं', body: ['Amazon Web Services के मुंबई रीजन (भारत) में, एन्क्रिप्टेड, और सिर्फ़ HTTPS पर भेजी जाती हैं। या, अगर आप जोड़ें, तो आपके अपने Google Drive, Dropbox, OneDrive, Box, S3 या WebDAV स्टोरेज में।'] },
          { h2: 'ओरिजिनल, जैसे थे वैसे', body: ['Lens वही फ़ाइल रखता है जो आपके कैमरे ने बनाई, पहुँचते ही चेकसम से जाँची हुई। उसे कभी दोबारा कंप्रेस नहीं किया जाता। एडिट अलग से सेव होते हैं, इसलिए ओरिजिनल हमेशा रहता है।'] },
          {
            h2: 'आप कभी भी जा सकते हैं',
            body: [],
            bullets: [
              'कोई भी ओरिजिनल डाउनलोड करें, फ़ोन पर या कंप्यूटर पर वेब ऐप से',
              'अपने ओरिजिनल अपने स्टोरेज में रखें, ताकि आप कभी बँधे न रहें',
              'कभी भी अपना अकाउंट और उसकी हर चीज़ डिलीट करें, ऐप या वेबसाइट से',
              'ग़लती से कुछ डिलीट हो गया? Lens स्टोरेज में एक साल तक वापस ला सकते हैं (ट्रैश, फिर आर्काइव)',
              'वेलकम स्टोरेज ख़त्म हो या आप मुफ़्त सीमा से ऊपर जाएँ, कुछ भी डिलीट नहीं होता; सिर्फ़ 5 महीने सीमा से ऊपर रहने पर, चार बार याद दिलाकर, सीमा से ऊपर का हिस्सा हटाया जाता है',
            ],
          },
          {
            h2: 'हम क्या कभी नहीं करेंगे',
            body: [],
            bullets: ['विज्ञापन दिखाना', 'आपका डेटा बेचना या किराए पर देना', 'आपकी फ़ोटो पर AI ट्रेन करना', 'आपकी फ़ोटो देखना, सिवाय उस ऑटोमेटेड प्रोसेसिंग के जो आप माँगते हैं (प्रीव्यू, स्ट्रीमिंग कॉपी)'],
          },
          {
            h2: 'प्राइवेसी पॉलिसी, संक्षेप में',
            body: ['हम सिर्फ़ वही इकट्ठा करते हैं जो Lens चलाने के लिए ज़रूरी है: आपका अकाउंट, आपकी फ़ोटो और वीडियो, और सेवा सुरक्षित रखने के लिए ज़रूरी जानकारी। चेहरों की ग्रुपिंग (People) आपके फ़ोन पर होती है और कभी अपलोड नहीं होती। आप अपना डेटा देख, डाउनलोड और डिलीट कर सकते हैं। पूरी पॉलिसी में ठीक-ठीक लिखा है क्या, क्यों और कितने समय के लिए।'],
          },
          { h2: 'हमसे बात करें', body: ['सवाल, कोई समस्या या प्राइवेसी रिक्वेस्ट: संपर्क फ़ॉर्म इस्तेमाल करें। वह सीधे Lens बनाने वाले लोगों तक पहुँचता है।'] },
        ],
        faq: [
          { q: 'क्या Lens बड़ी कंपनी है?', a: 'नहीं। Lens को InstaGrow बनाता है, एक छोटी स्वतंत्र टीम। इसीलिए हम नियम आसान रखते हैं: कोई विज्ञापन नहीं, डेटा बेचना नहीं, और आप कभी भी सब कुछ लेकर जा सकते हैं।' },
          { q: 'अगर Lens कभी बंद हो जाए तो मेरी फ़ोटो का क्या होगा?', a: 'हमारी शर्तों में कम से कम 60 दिन पहले सूचना का वादा है, ताकि आप पूरी लाइब्रेरी डाउनलोड कर सकें। अपना स्टोरेज इस्तेमाल करते हैं तो आपके ओरिजिनल पहले से वहीं हैं।' },
          { q: 'क्या Lens के लोग मेरी फ़ोटो देख सकते हैं?', a: 'हम आपकी फ़ोटो नहीं देखते। उन्हें सिर्फ़ उसी काम के लिए अपने-आप प्रोसेस किया जाता है जो आप माँगते हैं, जैसे प्रीव्यू और स्ट्रीमिंग कॉपी, और किसी फ़ाइल का हर लिंक साइन किया हुआ है और एक्सपायर होता है।' },
        ],
      },
    },
    links: {
      en: [['Privacy & security', 'security'], ['Privacy policy', 'privacy'], ['Terms of service', 'terms'], ['Delete your account', 'delete-account'], ['Contact us', 'contact']],
      hi: [['प्राइवेसी और सुरक्षा', 'security'], ['प्राइवेसी पॉलिसी', 'privacy'], ['सेवा की शर्तें', 'terms'], ['अकाउंट डिलीट करें', 'delete-account'], ['संपर्क करें', 'contact']],
    },
  },
];

/** The /guides/ hub lists the guides and the comparison (not the trust page). */
export const guideHubPages = guidePages.filter((g) => g.kind !== 'trust');
