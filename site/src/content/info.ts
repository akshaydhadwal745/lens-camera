// Pricing, security, help and download pages, English + Hindi.
import type { Lang } from '../i18n/ui';
import type { Faq, PageCopy } from './pages';

export type InfoPage = { slug: string; name: Record<Lang, string>; copy: Record<Lang, PageCopy> };

export const helpFaq: Record<Lang, Faq[]> = {
  en: [
    { q: 'How do I sign in on a computer?', a: 'Open lens.instagrowapp.com and click Sign in. Scan the QR code with your phone and tap Approve, or sign in with the same email or Google account you use in the app.' },
    { q: 'How do I sign in on a new phone?', a: 'Install Lens and sign in with the same email or Google account. All your photos and videos are there; previews download first, originals when you open them.' },
    { q: 'Why is a photo still "uploading"?', a: 'Backup follows your mobile-data setting (everything, small files only, or Wi-Fi only) and pauses when your phone is very hot. It continues automatically.' },
    { q: 'How do I free up space on my phone?', a: 'Settings → On this device: choose how many days originals stay on the phone and how much space to keep free, or tap "Free up space now". Only files already verified in the cloud are removed.' },
    { q: 'I deleted something by mistake', a: 'Deleted items stay in Trash for 30 days and can be restored instantly. After that they move to Archive for one year, where they can still be recovered.' },
    { q: 'How do I connect Google Drive, OneDrive or Dropbox?', a: 'Tap the storage button in the gallery (or Settings → Storage), pick your provider and sign in. New photos go there from then on.' },
    { q: 'How do I sign a browser out?', a: 'On the website: Account → Log out. From your phone: Settings → Account → signed-in browsers → Log out.' },
    { q: 'How do I delete my account?', a: 'See the Delete your account page: it explains how, and exactly what is deleted.' },
    { q: 'How do I get more free storage?', a: 'Invite friends: Settings → Invite friends. You get +10 GB for every friend who installs Lens and signs in on their phone. There is no limit; each person and phone counts once.' },
    { q: 'How do I contact you?', a: 'Use the contact form at lens.instagrowapp.com/contact/. We reply by email, usually within two working days.' },
  ],
  hi: [
    { q: 'कंप्यूटर पर साइन इन कैसे करें?', a: 'lens.instagrowapp.com खोलें और साइन इन पर क्लिक करें। फ़ोन से QR कोड स्कैन करके मंज़ूरी दें, या उसी ईमेल या Google अकाउंट से साइन इन करें जो ऐप में है।' },
    { q: 'नए फ़ोन पर साइन इन कैसे करें?', a: 'Lens इंस्टॉल करें और उसी ईमेल या Google अकाउंट से साइन इन करें। आपकी सारी फ़ोटो और वीडियो वहाँ हैं; पहले प्रीव्यू आते हैं, ओरिजिनल खोलने पर।' },
    { q: 'फ़ोटो अभी भी "अपलोड हो रही" क्यों है?', a: 'बैकअप आपकी मोबाइल डेटा सेटिंग (सब कुछ, सिर्फ़ छोटी फ़ाइलें, या सिर्फ़ Wi-Fi) के हिसाब से चलता है और फ़ोन बहुत गर्म होने पर रुकता है। यह अपने-आप फिर शुरू हो जाता है।' },
    { q: 'फ़ोन में जगह कैसे ख़ाली करें?', a: 'Settings → On this device: चुनें कि ओरिजिनल कितने दिन फ़ोन पर रहें और कितनी जगह ख़ाली रखनी है, या "Free up space now" दबाएँ। सिर्फ़ वही फ़ाइलें हटती हैं जो क्लाउड में जाँची जा चुकी हैं।' },
    { q: 'ग़लती से कुछ डिलीट हो गया', a: 'डिलीट की गई चीज़ें 30 दिन ट्रैश में रहती हैं और तुरंत वापस लाई जा सकती हैं। उसके बाद वे एक साल के लिए आर्काइव में जाती हैं, जहाँ से अब भी वापस मिल सकती हैं।' },
    { q: 'Google Drive, OneDrive या Dropbox कैसे जोड़ें?', a: 'गैलरी में स्टोरेज बटन (या Settings → Storage) दबाएँ, अपना प्रोवाइडर चुनें और साइन इन करें। उसके बाद नई फ़ोटो वहीं जाती हैं।' },
    { q: 'ब्राउज़र से साइन आउट कैसे करें?', a: 'वेबसाइट पर: Account → Log out। फ़ोन से: Settings → Account → signed-in browsers → Log out।' },
    { q: 'अपना अकाउंट कैसे डिलीट करें?', a: '"अकाउंट डिलीट करें" पेज देखें: वहाँ तरीका और ठीक-ठीक क्या डिलीट होता है, बताया गया है।' },
    { q: 'और मुफ़्त स्टोरेज कैसे पाएँ?', a: 'दोस्तों को इनवाइट करें: Settings → Invite friends। हर दोस्त जो Lens इंस्टॉल करके अपने फ़ोन पर साइन इन करे, उस पर आपको +10 GB मिलता है। कोई सीमा नहीं; हर व्यक्ति और फ़ोन एक बार गिना जाता है।' },
    { q: 'आपसे संपर्क कैसे करें?', a: 'lens.instagrowapp.com/contact/ पर संपर्क फ़ॉर्म भरें। हम ईमेल से जवाब देते हैं, आमतौर पर दो कामकाजी दिनों में।' },
  ],
};

export const infoPages: InfoPage[] = [
  {
    slug: 'pricing',
    name: { en: 'Pricing', hi: 'कीमत' },
    copy: {
      en: {
        title: 'Pricing: 100 GB free photo and video backup',
        description: 'Lens is free: 100 GB of original-quality backup when you sign in, the full pro camera and editor, and the web app. Paid plans with more storage are coming.',
        h1: 'Simple pricing. Start free.',
        lead: 'Everything in Lens is free today, including 100 GB of original-quality backup.',
        sections: [
          {
            h2: 'Free',
            body: ['₹0, no card needed.'],
            bullets: [
              '100 GB Lens storage at original quality (5 GB before you sign in)',
              'Pro camera, Night, Portrait, 13 looks and the full editor',
              'Connect your own Google Drive, OneDrive, Dropbox, Box, S3 or NAS',
              '4K adaptive video streaming',
              'Sharing with friends',
              'Web app with QR sign-in and upload from your computer',
              'Trash for 30 days, Archive for 1 year',
              '+10 GB more for every friend you invite, no limit',
            ],
          },
          {
            h2: 'Coming later',
            body: ['Paid plans will add more Lens storage and extra features such as choosing where photos and videos go, and sharing originals from your own storage. The free plan stays.'],
          },
        ],
      },
      hi: {
        title: 'कीमत: 100 GB मुफ़्त फ़ोटो और वीडियो बैकअप',
        description: 'Lens मुफ़्त है: साइन इन करने पर ओरिजिनल क्वालिटी में 100 GB बैकअप, पूरा प्रो कैमरा और एडिटर, और वेब ऐप। ज़्यादा स्टोरेज वाले पेड प्लान आ रहे हैं।',
        h1: 'आसान कीमत। मुफ़्त में शुरू करें।',
        lead: 'आज Lens में सब कुछ मुफ़्त है, ओरिजिनल क्वालिटी में 100 GB बैकअप भी।',
        sections: [
          {
            h2: 'फ़्री',
            body: ['₹0, कार्ड की ज़रूरत नहीं।'],
            bullets: [
              'ओरिजिनल क्वालिटी में 100 GB Lens स्टोरेज (साइन इन से पहले 5 GB)',
              'प्रो कैमरा, नाइट, पोर्ट्रेट, 13 लुक्स और पूरा एडिटर',
              'अपना Google Drive, OneDrive, Dropbox, Box, S3 या NAS जोड़ें',
              '4K एडैप्टिव वीडियो स्ट्रीमिंग',
              'दोस्तों के साथ शेयरिंग',
              'QR साइन इन और कंप्यूटर से अपलोड वाला वेब ऐप',
              '30 दिन ट्रैश, 1 साल आर्काइव',
              'हर इनवाइट किए दोस्त पर +10 GB और, कोई सीमा नहीं',
            ],
          },
          {
            h2: 'बाद में आएगा',
            body: ['पेड प्लान में ज़्यादा Lens स्टोरेज और अतिरिक्त फ़ीचर होंगे, जैसे फ़ोटो और वीडियो कहाँ जाएँ यह चुनना, और अपने स्टोरेज से ओरिजिनल शेयर करना। फ़्री प्लान रहेगा।'],
          },
        ],
      },
    },
  },
  {
    slug: 'security',
    name: { en: 'Privacy & security', hi: 'प्राइवेसी और सुरक्षा' },
    copy: {
      en: {
        title: 'Privacy and security: how Lens protects your photos',
        description: 'Your photos are stored in India, encrypted, never sold, never used for ads or AI training. How Lens protects your account and library.',
        h1: 'Your photos are yours',
        lead: 'No ads, no selling your data, no training AI on your photos. Here is how we protect your library.',
        sections: [
          {
            h2: 'Where your photos live',
            body: ['In Amazon Web Services, Mumbai region (India), encrypted at rest, or in your own storage if you connect one. Our content delivery network caches thumbnails close to you for speed; every link to your files is signed and expires.'],
          },
          {
            h2: 'How we protect your account',
            bullets: [
              'Sign in with a one-time email code or Google; we never ask for a password',
              'Session secrets are stored only as one-way hashes on our servers',
              'The website keeps your session in a secure, HttpOnly cookie that page scripts can’t read',
              'QR sign-in shows which browser and city is asking before you approve',
              'See and sign out every phone and browser from the app',
              'All traffic uses HTTPS; uploads are verified with checksums',
            ],
            body: [],
          },
          {
            h2: 'What we don’t do',
            bullets: ['We don’t sell or rent your data', 'We don’t show ads', 'We don’t use your photos to train AI models', 'We don’t look at your photos, except automated processing you ask for (previews, streaming copies)'],
            body: [],
          },
          { h2: 'Full details', body: ['Read the privacy policy for exactly what we collect, why, and for how long.'] },
        ],
      },
      hi: {
        title: 'प्राइवेसी और सुरक्षा: Lens आपकी फ़ोटो कैसे सुरक्षित रखता है',
        description: 'आपकी फ़ोटो भारत में, एन्क्रिप्टेड रखी जाती हैं, कभी बेची नहीं जातीं, विज्ञापन या AI ट्रेनिंग के लिए इस्तेमाल नहीं होतीं। Lens आपका अकाउंट और लाइब्रेरी कैसे सुरक्षित रखता है।',
        h1: 'आपकी फ़ोटो आपकी हैं',
        lead: 'कोई विज्ञापन नहीं, आपका डेटा बेचना नहीं, आपकी फ़ोटो पर AI ट्रेनिंग नहीं। हम आपकी लाइब्रेरी ऐसे सुरक्षित रखते हैं।',
        sections: [
          {
            h2: 'आपकी फ़ोटो कहाँ रहती हैं',
            body: ['Amazon Web Services के मुंबई रीजन (भारत) में, एन्क्रिप्टेड, या आपके अपने स्टोरेज में अगर आप जोड़ते हैं। तेज़ी के लिए हमारा कंटेंट डिलीवरी नेटवर्क थंबनेल आपके पास कैश करता है; आपकी फ़ाइलों का हर लिंक साइन किया हुआ है और एक्सपायर होता है।'],
          },
          {
            h2: 'हम आपका अकाउंट कैसे सुरक्षित रखते हैं',
            bullets: [
              'एक बार के ईमेल कोड या Google से साइन इन; हम कभी पासवर्ड नहीं माँगते',
              'सेशन सीक्रेट हमारे सर्वर पर सिर्फ़ वन-वे हैश के रूप में रखे जाते हैं',
              'वेबसाइट आपका सेशन सुरक्षित, HttpOnly कुकी में रखती है जिसे पेज स्क्रिप्ट नहीं पढ़ सकतीं',
              'QR साइन इन में मंज़ूरी से पहले दिखता है कि कौन-सा ब्राउज़र और शहर माँग रहा है',
              'ऐप से हर फ़ोन और ब्राउज़र देखें और साइन आउट करें',
              'सारा ट्रैफ़िक HTTPS पर; अपलोड चेकसम से जाँचे जाते हैं',
            ],
            body: [],
          },
          {
            h2: 'हम क्या नहीं करते',
            bullets: ['हम आपका डेटा बेचते या किराए पर नहीं देते', 'हम विज्ञापन नहीं दिखाते', 'हम आपकी फ़ोटो से AI मॉडल ट्रेन नहीं करते', 'हम आपकी फ़ोटो नहीं देखते, सिवाय उस ऑटोमेटेड प्रोसेसिंग के जो आप माँगते हैं (प्रीव्यू, स्ट्रीमिंग कॉपी)'],
            body: [],
          },
          { h2: 'पूरी जानकारी', body: ['हम क्या, क्यों और कितने समय के लिए इकट्ठा करते हैं, यह प्राइवेसी पॉलिसी में पढ़ें।'] },
        ],
      },
    },
  },
  {
    slug: 'affiliates',
    name: { en: 'Affiliate program', hi: 'एफ़िलिएट प्रोग्राम' },
    copy: {
      en: {
        title: 'Affiliate program: earn 50% recurring commission',
        description: 'Creators, photographers and bloggers: share Lens and earn 50% of our net revenue from every user you bring, for as long as they pay. Monthly UPI payouts.',
        h1: 'Earn 50% for as long as they pay',
        lead: 'Share Lens with your audience. When people you bring buy a Lens plan, you earn half of what we receive, every month, for life.',
        sections: [
          {
            h2: 'How it works',
            body: ['Apply in the Lens app (Settings → Affiliate program). We review applications within a few days. Once approved, you get tracking links for each platform or campaign and a dashboard with clicks, sign-ups, paying users and earnings.'],
            bullets: [
              '50% of net revenue: what we receive after GST and Google Play’s fee',
              'Recurring for the lifetime of each user you bring',
              'Commissions are approved 30 days after each payment (the refund window)',
              'Paid monthly by UPI or bank transfer once you have ₹1,000 or more',
              'Links work through Google Play, so installs are credited exactly',
            ],
          },
          {
            h2: 'Example',
            body: ['A user you bring pays ₹99 a month. After 18% GST (₹15.10) and the Play fee (₹12.59) we receive ₹71.31; you earn ₹35.65 every month they stay. 100 such users: about ₹3,565 a month.'],
          },
          {
            h2: 'Who it is for',
            body: ['YouTubers, Instagram creators, photographers, photography teachers, tech bloggers and communities whose audience takes photos and videos.'],
          },
          {
            h2: 'Paid plans are coming',
            body: ['Lens is free today. You can join now, get your links and start building referrals; commissions start when paid plans launch.'],
          },
          {
            h2: 'Fair-play rules',
            body: ['No fake or incentivised installs, no buying through your own link, no spam, no bidding on our brand in ads, and always disclose the partnership (#ad). Full details in the affiliate terms.'],
          },
        ],
        faq: [
          { q: 'Do I need to pay anything?', a: 'No. Joining is free.' },
          { q: 'How is tax handled?', a: 'Under Indian law we deduct TDS (2% once your commission in a financial year passes ₹20,000; 20% if you have not given a PAN) and issue Form 16A. Add your PAN and UPI in the app before your first payout.' },
          { q: 'What if a user asks for a refund?', a: 'The commission for that payment is cancelled. If it was already paid, it is deducted from your next payout.' },
          { q: 'Is this the same as inviting friends?', a: 'No. Every Lens user can invite friends and earn +10 GB of storage per friend. The affiliate program is a separate, approved program that pays money.' },
        ],
      },
      hi: {
        title: 'एफ़िलिएट प्रोग्राम: 50% रिकरिंग कमीशन कमाएँ',
        description: 'क्रिएटर, फ़ोटोग्राफ़र और ब्लॉगर: Lens शेयर करें और अपने लाए हर यूज़र से हमारी नेट कमाई का 50% कमाएँ, जब तक वे भुगतान करते रहें। हर महीने UPI से भुगतान।',
        h1: 'जब तक वे भुगतान करें, आप 50% कमाएँ',
        lead: 'अपनी ऑडियंस के साथ Lens शेयर करें। आपके लाए लोग जब Lens प्लान ख़रीदते हैं, तो हमें मिलने वाली रक़म का आधा आपको मिलता है, हर महीने, हमेशा।',
        sections: [
          {
            h2: 'कैसे काम करता है',
            body: ['Lens ऐप में आवेदन करें (Settings → Affiliate program)। हम कुछ दिनों में आवेदन देखते हैं। मंज़ूरी के बाद आपको हर प्लेटफ़ॉर्म या कैंपेन के लिए ट्रैकिंग लिंक और क्लिक, साइन-अप, पेड यूज़र और कमाई वाला डैशबोर्ड मिलता है।'],
            bullets: [
              'नेट कमाई का 50%: GST और Google Play फ़ीस के बाद जो हमें मिलता है',
              'आपके लाए हर यूज़र के पूरे समय तक रिकरिंग',
              'हर भुगतान के 30 दिन बाद कमीशन मंज़ूर होता है (रिफ़ंड की अवधि)',
              '₹1,000 या ज़्यादा होने पर हर महीने UPI या बैंक ट्रांसफ़र',
              'लिंक Google Play से काम करते हैं, इसलिए इंस्टॉल ठीक-ठीक आपके नाम दर्ज होते हैं',
            ],
          },
          {
            h2: 'उदाहरण',
            body: ['आपका लाया यूज़र हर महीने ₹99 देता है। 18% GST (₹15.10) और Play फ़ीस (₹12.59) के बाद हमें ₹71.31 मिलते हैं; जब तक वह रहे, आपको हर महीने ₹35.65 मिलते हैं। ऐसे 100 यूज़र: लगभग ₹3,565 महीना।'],
          },
          { h2: 'किसके लिए', body: ['YouTuber, Instagram क्रिएटर, फ़ोटोग्राफ़र, फ़ोटोग्राफ़ी टीचर, टेक ब्लॉगर और ऐसी कम्युनिटी जिनकी ऑडियंस फ़ोटो और वीडियो लेती है।'] },
          { h2: 'पेड प्लान आ रहे हैं', body: ['आज Lens मुफ़्त है। आप अभी जुड़कर लिंक ले सकते हैं और रेफ़रल बनाना शुरू कर सकते हैं; पेड प्लान आने पर कमीशन शुरू होगा।'] },
          { h2: 'सही खेल के नियम', body: ['नकली या लालच देकर करवाए गए इंस्टॉल नहीं, अपने ही लिंक से ख़रीदारी नहीं, स्पैम नहीं, विज्ञापनों में हमारे ब्रांड पर बोली नहीं, और साझेदारी हमेशा बताएँ (#ad)। पूरी जानकारी एफ़िलिएट शर्तों में।'] },
        ],
        faq: [
          { q: 'क्या कुछ भुगतान करना होगा?', a: 'नहीं। जुड़ना मुफ़्त है।' },
          { q: 'टैक्स कैसे संभाला जाता है?', a: 'भारतीय क़ानून के अनुसार हम TDS काटते हैं (वित्त वर्ष में कमीशन ₹20,000 से ज़्यादा होने पर 2%; PAN न देने पर 20%) और Form 16A देते हैं। पहले भुगतान से पहले ऐप में PAN और UPI जोड़ें।' },
          { q: 'अगर यूज़र रिफ़ंड माँगे तो?', a: 'उस भुगतान का कमीशन रद्द हो जाता है। अगर पहले ही भुगतान हो चुका हो, तो अगले भुगतान से काटा जाता है।' },
          { q: 'क्या यह दोस्तों को इनवाइट करने जैसा है?', a: 'नहीं। हर Lens यूज़र दोस्तों को इनवाइट करके हर दोस्त पर +10 GB स्टोरेज पा सकता है। एफ़िलिएट प्रोग्राम अलग, मंज़ूरी वाला प्रोग्राम है जिसमें पैसे मिलते हैं।' },
        ],
      },
    },
  },
  {
    slug: 'download',
    name: { en: 'Get the app', hi: 'ऐप पाएँ' },
    copy: {
      en: {
        title: 'Get the Lens app for Android',
        description: 'Lens by InstaGrow is coming to Google Play for Android 7 and newer. Meanwhile, use Lens on the web.',
        h1: 'Lens is coming to Google Play',
        lead: 'Lens launches first on Android (7.0 and newer). The Google Play listing is on its way.',
        sections: [
          { h2: 'In the meantime', body: ['Already have a Lens account? Use the web app on any computer: sign in with your email or Google account.'] },
          { h2: 'iPhone', body: ['An iPhone version is built and will follow the Android launch.'] },
        ],
      },
      hi: {
        title: 'Android के लिए Lens ऐप पाएँ',
        description: 'Lens by InstaGrow Android 7 और नए वर्शन के लिए जल्द Google Play पर आ रहा है। तब तक वेब पर Lens इस्तेमाल करें।',
        h1: 'Lens जल्द Google Play पर',
        lead: 'Lens सबसे पहले Android (7.0 और नए) पर लॉन्च हो रहा है। Google Play लिस्टिंग आने वाली है।',
        sections: [
          { h2: 'तब तक', body: ['पहले से Lens अकाउंट है? किसी भी कंप्यूटर पर वेब ऐप इस्तेमाल करें: अपने ईमेल या Google अकाउंट से साइन इन करें।'] },
          { h2: 'iPhone', body: ['iPhone वर्शन बना हुआ है और Android लॉन्च के बाद आएगा।'] },
        ],
      },
    },
  },
];
