// Privacy policy, terms and account deletion, English + Hindi.
// Facts here must match the product (checked against the code 2026-10-09):
// AWS ap-south-1, S3 versioning (deleted versions kept 30 days), DynamoDB
// point-in-time recovery (35 days), API logs 7 days, no CloudFront/S3 access
// logs, Google scope openid+email+profile (only sub + email stored).
//
// TODO before launch (owner to confirm): legal entity name, postal address,
// contact and grievance-officer email. Placeholders are in LEGAL below.
import type { Lang } from '../i18n/ui';

export const LEGAL = {
  operator: 'InstaGrow',
  contact: 'support@instagrowapp.com',
  grievance: 'grievance@instagrowapp.com',
  updated: { en: '9 October 2026', hi: '9 अक्टूबर 2026' },
};

export type LegalBlock = { h2: string; p?: string[]; ul?: string[]; table?: { head: string[]; rows: string[][] } };
export type LegalDoc = { title: string; description: string; h1: string; intro: string; blocks: LegalBlock[] };

const C = LEGAL.contact;
const G = LEGAL.grievance;

export const privacy: Record<Lang, LegalDoc> = {
  en: {
    title: 'Privacy policy',
    description: 'Exactly what Lens by InstaGrow collects, why, where it is stored, how long it is kept, who processes it, and your rights.',
    h1: 'Privacy policy',
    intro: `This policy explains how ${LEGAL.operator} ("we") handles personal data in the Lens app (Android and iPhone) and on lens.instagrowapp.com. It is written to comply with India's Digital Personal Data Protection Act, 2023 and the rules made under it. We collect only what we need to run Lens.`,
    blocks: [
      {
        h2: '1. What we collect and why',
        table: {
          head: ['Data', 'Why we need it', 'How long we keep it'],
          rows: [
            ['A random Lens name (like "quiet-tiger-8703")', 'To identify your account and let friends find you when you share', 'Until you delete your account'],
            ['Your email address (if you sign in with email or Google)', 'To sign you in with one-time codes and to recognise your account on new devices', 'Until you delete your account'],
            ['Your Google account ID (if you sign in with Google)', 'To sign you in with Google. Google also sends your name and profile photo; we do not store them', 'Until you delete your account'],
            ['Photos and videos you back up, and their metadata (for example date, camera model and, if your camera recorded it, location)', 'To store, show, share and stream your library, the core of Lens', 'Until you delete them (see Trash and Archive below) or your account'],
            ['Thumbnails, previews, edit settings, portrait outlines and streaming copies', 'To make browsing fast and show your edits on every device', 'Previews/edits: as long as the photo. Streaming copies: 90 days after last made'],
            ['Who you share items with', 'To show shared items to them', 'Until you or they remove the share'],
            ['Device and browser names (for example "Samsung SM-A546E", "Chrome on Windows") and sign-in times', 'To list your signed-in devices so you can sign them out', 'Until you sign that device out, or 90 days without use'],
            ['A one-way hash of your phone’s app ID', 'To give a reinstalled phone its free guest storage back instead of creating new free storage (abuse prevention)', 'Until you delete your account'],
            ['IP address', 'To limit abuse (counting requests per network for one hour)', 'About 2 hours'],
            ['Approximate city (from your IP) when you request QR sign-in on the website', 'To show "who is asking" on your phone before you approve', 'At most 2 minutes'],
            ['Sign-in codes we email you', 'To verify you own the email address', '10 minutes; stored only as a hash'],
            ['Requests you send us (for example "add a storage provider")', 'To reply and improve Lens', 'Up to 2 years'],
          ],
        },
        p: ['We do not collect your contacts, call logs, SMS, or advertising identifiers, and we do not use third-party analytics or crash-reporting in the app today. If we add analytics, we will update this policy first.'],
      },
      {
        h2: '2. Your own storage (Google Drive, OneDrive, Dropbox, Box, S3, WebDAV)',
        p: [
          'If you connect your own storage, your photos and videos are uploaded directly from your phone to that provider. You sign in to the provider on its own page. On the free plan, the access keys stay on your phone; our servers help exchange the sign-in code but do not keep the keys. We keep only small previews in Lens so your gallery is fast. Your provider’s own privacy policy applies to the files stored there.',
        ],
      },
      {
        h2: '3. Where your data is stored and who processes it',
        ul: [
          'Amazon Web Services (AWS), Mumbai region, India: storage of your photos, videos and account data, our servers, and sending sign-in emails. Data is encrypted at rest and in transit.',
          'Amazon CloudFront (part of AWS): delivers previews and files quickly. It may cache copies at locations outside India for a short time. Every link is signed and expires.',
          'Google: only if you choose "Sign in with Google" or connect Google Drive.',
          'Microsoft, Dropbox, Box or your S3/WebDAV provider: only if you connect them.',
        ],
        p: ['We do not sell, rent or trade your personal data. We do not show ads. We do not use your photos or videos to train AI models. Processors act only on our instructions.'],
      },
      {
        h2: '4. Processing on your phone',
        p: ['Thumbnails, previews, looks, edits, Night mode and Portrait outlines are made on your phone. The Portrait person outline is made by an on-device model built into the app; your photo is not sent anywhere for it. Long videos may be converted to streaming copies on our servers when someone plays them on another device.'],
      },
      {
        h2: '5. Deleting things',
        ul: [
          'Trash: deleted items stay 30 days and can be restored.',
          'Archive: after Trash, items are kept for 1 year (recoverable), then permanently deleted.',
          '"Delete forever" removes the item and all its copies immediately.',
          'Deleting your account removes your library, account and sign-ins (see the Delete your account page). Deleted data can remain in encrypted backups for up to 35 days before it is overwritten.',
          'Server logs (errors and timings) are kept for 7 days.',
        ],
      },
      {
        h2: '6. Cookies on the website',
        p: ['The website uses one strictly necessary cookie, "__Host-lens", to keep you signed in. It is secure, HttpOnly (scripts cannot read it) and sent only to lens.instagrowapp.com. It lasts up to 30 days or until you log out. We use no advertising or tracking cookies.'],
      },
      {
        h2: '7. Your rights',
        p: ['Under the DPDP Act you can:'],
        ul: [
          'Get a summary of the personal data we hold about you and how we process it',
          'Correct or update your data',
          'Erase your data (delete items, or your whole account)',
          'Withdraw consent at any time (this stops the related processing; for example, deleting your account stops backup)',
          'Nominate a person to exercise your rights if you die or become incapacitated',
          'Raise a grievance with us, and then with the Data Protection Board of India',
        ],
      },
      {
        h2: '8. Children',
        p: ['Lens is for people aged 18 and over. Under-18s may use Lens only with the verifiable consent of a parent or lawful guardian. If you believe a child has used Lens without consent, contact us and we will delete the data.'],
      },
      {
        h2: '9. Security',
        p: ['We use HTTPS everywhere, encryption at rest, checksums on every upload, signed expiring links, one-way hashed session secrets, and sign-in without passwords. No system is perfectly secure; if a breach affects your data, we will inform you and the Data Protection Board as the law requires.'],
      },
      {
        h2: '10. Contact and grievance officer',
        p: [`Questions or requests: ${C}. Grievance officer: ${G}. We respond within 30 days, usually much sooner.`],
      },
      {
        h2: '11. Changes',
        p: ['We will post changes here and update the date below. For significant changes we will notify you in the app before they take effect.'],
      },
    ],
  },
  hi: {
    title: 'प्राइवेसी पॉलिसी',
    description: 'Lens by InstaGrow ठीक-ठीक क्या इकट्ठा करता है, क्यों, कहाँ स्टोर होता है, कितने समय रखा जाता है, कौन प्रोसेस करता है, और आपके अधिकार।',
    h1: 'प्राइवेसी पॉलिसी',
    intro: `यह पॉलिसी बताती है कि ${LEGAL.operator} ("हम") Lens ऐप (Android और iPhone) और lens.instagrowapp.com पर निजी डेटा कैसे संभालता है। यह भारत के डिजिटल पर्सनल डेटा प्रोटेक्शन एक्ट, 2023 और उसके नियमों के अनुसार लिखी गई है। हम सिर्फ़ वही इकट्ठा करते हैं जो Lens चलाने के लिए ज़रूरी है। (यह अनुवाद है; अंग्रेज़ी और हिंदी में अंतर होने पर अंग्रेज़ी संस्करण मान्य होगा।)`,
    blocks: [
      {
        h2: '1. हम क्या इकट्ठा करते हैं और क्यों',
        table: {
          head: ['डेटा', 'क्यों ज़रूरी है', 'कितने समय रखते हैं'],
          rows: [
            ['एक रैंडम Lens नाम (जैसे "quiet-tiger-8703")', 'आपका अकाउंट पहचानने और शेयर करते समय दोस्तों को आपको ढूँढने देने के लिए', 'अकाउंट डिलीट करने तक'],
            ['आपका ईमेल (ईमेल या Google से साइन इन करने पर)', 'एक बार के कोड से साइन इन और नए डिवाइस पर आपका अकाउंट पहचानने के लिए', 'अकाउंट डिलीट करने तक'],
            ['आपकी Google अकाउंट ID (Google से साइन इन करने पर)', 'Google से साइन इन के लिए। Google आपका नाम और प्रोफ़ाइल फ़ोटो भी भेजता है; हम उन्हें स्टोर नहीं करते', 'अकाउंट डिलीट करने तक'],
            ['आपकी बैकअप की गई फ़ोटो और वीडियो, और उनका मेटाडेटा (जैसे तारीख़, कैमरा मॉडल और, अगर कैमरे ने रिकॉर्ड की हो, लोकेशन)', 'आपकी लाइब्रेरी स्टोर करने, दिखाने, शेयर और स्ट्रीम करने के लिए, यही Lens का मूल काम है', 'जब तक आप उन्हें डिलीट न करें (नीचे ट्रैश और आर्काइव देखें) या अकाउंट'],
            ['थंबनेल, प्रीव्यू, एडिट सेटिंग, पोर्ट्रेट आउटलाइन और स्ट्रीमिंग कॉपी', 'ब्राउज़िंग तेज़ करने और हर डिवाइस पर आपके एडिट दिखाने के लिए', 'प्रीव्यू/एडिट: फ़ोटो जितने समय। स्ट्रीमिंग कॉपी: आख़िरी बार बनने के 90 दिन बाद तक'],
            ['आप किसके साथ शेयर करते हैं', 'शेयर की गई चीज़ें उन्हें दिखाने के लिए', 'जब तक आप या वे शेयर न हटाएँ'],
            ['डिवाइस और ब्राउज़र के नाम (जैसे "Samsung SM-A546E", "Chrome on Windows") और साइन-इन समय', 'आपके साइन-इन डिवाइस की सूची दिखाने के लिए ताकि आप उन्हें साइन आउट कर सकें', 'उस डिवाइस को साइन आउट करने तक, या 90 दिन इस्तेमाल न होने तक'],
            ['आपके फ़ोन की ऐप ID का वन-वे हैश', 'दोबारा इंस्टॉल करने पर नया मुफ़्त स्टोरेज बनाने के बजाय वही गेस्ट स्टोरेज लौटाने के लिए (दुरुपयोग रोकना)', 'अकाउंट डिलीट करने तक'],
            ['IP एड्रेस', 'दुरुपयोग सीमित करने के लिए (एक घंटे तक नेटवर्क के हिसाब से रिक्वेस्ट गिनना)', 'लगभग 2 घंटे'],
            ['वेबसाइट पर QR साइन इन माँगने पर अनुमानित शहर (आपके IP से)', 'मंज़ूरी से पहले आपके फ़ोन पर "कौन माँग रहा है" दिखाने के लिए', 'ज़्यादा से ज़्यादा 2 मिनट'],
            ['हम जो साइन-इन कोड ईमेल करते हैं', 'यह जाँचने के लिए कि ईमेल आपका है', '10 मिनट; सिर्फ़ हैश के रूप में'],
            ['आपकी भेजी रिक्वेस्ट (जैसे "स्टोरेज प्रोवाइडर जोड़ें")', 'जवाब देने और Lens बेहतर करने के लिए', '2 साल तक'],
          ],
        },
        p: ['हम आपके कॉन्टैक्ट, कॉल लॉग, SMS या विज्ञापन ID इकट्ठा नहीं करते, और आज ऐप में किसी थर्ड-पार्टी एनालिटिक्स या क्रैश रिपोर्टिंग का इस्तेमाल नहीं करते। एनालिटिक्स जोड़ने से पहले हम यह पॉलिसी अपडेट करेंगे।'],
      },
      {
        h2: '2. आपका अपना स्टोरेज (Google Drive, OneDrive, Dropbox, Box, S3, WebDAV)',
        p: ['अगर आप अपना स्टोरेज जोड़ते हैं, तो फ़ोटो और वीडियो सीधे आपके फ़ोन से उस प्रोवाइडर पर अपलोड होते हैं। आप प्रोवाइडर के अपने पेज पर साइन इन करते हैं। फ़्री प्लान में एक्सेस कीज़ आपके फ़ोन पर रहती हैं; हमारे सर्वर साइन-इन कोड बदलने में मदद करते हैं पर कीज़ नहीं रखते। गैलरी तेज़ रखने के लिए हम Lens में सिर्फ़ छोटे प्रीव्यू रखते हैं। वहाँ रखी फ़ाइलों पर प्रोवाइडर की अपनी प्राइवेसी पॉलिसी लागू होती है।'],
      },
      {
        h2: '3. आपका डेटा कहाँ स्टोर होता है और कौन प्रोसेस करता है',
        ul: [
          'Amazon Web Services (AWS), मुंबई रीजन, भारत: आपकी फ़ोटो, वीडियो और अकाउंट डेटा का स्टोरेज, हमारे सर्वर, और साइन-इन ईमेल भेजना। डेटा स्टोरेज और ट्रांसफ़र दोनों में एन्क्रिप्टेड रहता है।',
          'Amazon CloudFront (AWS का हिस्सा): प्रीव्यू और फ़ाइलें तेज़ी से पहुँचाता है। यह थोड़े समय के लिए भारत के बाहर की जगहों पर कॉपी कैश कर सकता है। हर लिंक साइन किया हुआ है और एक्सपायर होता है।',
          'Google: सिर्फ़ अगर आप "Google से साइन इन" चुनते हैं या Google Drive जोड़ते हैं।',
          'Microsoft, Dropbox, Box या आपका S3/WebDAV प्रोवाइडर: सिर्फ़ अगर आप उन्हें जोड़ते हैं।',
        ],
        p: ['हम आपका निजी डेटा बेचते, किराए पर या बदले में नहीं देते। हम विज्ञापन नहीं दिखाते। हम आपकी फ़ोटो या वीडियो से AI मॉडल ट्रेन नहीं करते। प्रोसेसर सिर्फ़ हमारे निर्देश पर काम करते हैं।'],
      },
      {
        h2: '4. आपके फ़ोन पर प्रोसेसिंग',
        p: ['थंबनेल, प्रीव्यू, लुक्स, एडिट, नाइट मोड और पोर्ट्रेट आउटलाइन आपके फ़ोन पर बनते हैं। पोर्ट्रेट में व्यक्ति की आउटलाइन ऐप में मौजूद ऑन-डिवाइस मॉडल बनाता है; इसके लिए आपकी फ़ोटो कहीं नहीं भेजी जाती। लंबे वीडियो किसी दूसरे डिवाइस पर चलाए जाने पर हमारे सर्वर पर स्ट्रीमिंग कॉपी में बदले जा सकते हैं।'],
      },
      {
        h2: '5. चीज़ें डिलीट करना',
        ul: [
          'ट्रैश: डिलीट की गई चीज़ें 30 दिन रहती हैं और वापस लाई जा सकती हैं।',
          'आर्काइव: ट्रैश के बाद 1 साल रखी जाती हैं (वापस मिल सकती हैं), फिर हमेशा के लिए डिलीट।',
          '"हमेशा के लिए डिलीट" चीज़ और उसकी सभी कॉपी तुरंत हटा देता है।',
          'अकाउंट डिलीट करने पर आपकी लाइब्रेरी, अकाउंट और साइन-इन हट जाते हैं ("अकाउंट डिलीट करें" पेज देखें)। डिलीट किया गया डेटा ओवरराइट होने से पहले 35 दिन तक एन्क्रिप्टेड बैकअप में रह सकता है।',
          'सर्वर लॉग (एरर और समय) 7 दिन रखे जाते हैं।',
        ],
      },
      {
        h2: '6. वेबसाइट पर कुकी',
        p: ['वेबसाइट सिर्फ़ एक ज़रूरी कुकी "__Host-lens" इस्तेमाल करती है, आपको साइन इन रखने के लिए। यह सुरक्षित, HttpOnly (स्क्रिप्ट नहीं पढ़ सकतीं) है और सिर्फ़ lens.instagrowapp.com को भेजी जाती है। यह 30 दिन तक या लॉग आउट करने तक रहती है। हम कोई विज्ञापन या ट्रैकिंग कुकी इस्तेमाल नहीं करते।'],
      },
      {
        h2: '7. आपके अधिकार',
        p: ['DPDP एक्ट के तहत आप:'],
        ul: [
          'हमारे पास आपके निजी डेटा और उसकी प्रोसेसिंग का सारांश पा सकते हैं',
          'अपना डेटा सुधार या अपडेट कर सकते हैं',
          'अपना डेटा मिटा सकते हैं (चीज़ें डिलीट करें, या पूरा अकाउंट)',
          'कभी भी सहमति वापस ले सकते हैं (इससे जुड़ी प्रोसेसिंग रुक जाती है; जैसे अकाउंट डिलीट करने से बैकअप रुकता है)',
          'आपकी मृत्यु या असमर्थता की स्थिति में अधिकारों के लिए किसी को नॉमिनेट कर सकते हैं',
          'हमसे शिकायत कर सकते हैं, और फिर डेटा प्रोटेक्शन बोर्ड ऑफ़ इंडिया से',
        ],
      },
      {
        h2: '8. बच्चे',
        p: ['Lens 18 साल और उससे ज़्यादा उम्र के लोगों के लिए है। 18 से कम उम्र के लोग माता-पिता या क़ानूनी अभिभावक की प्रमाणित सहमति से ही Lens इस्तेमाल कर सकते हैं। अगर आपको लगता है कि किसी बच्चे ने बिना सहमति Lens इस्तेमाल किया है, तो हमसे संपर्क करें और हम डेटा डिलीट कर देंगे।'],
      },
      {
        h2: '9. सुरक्षा',
        p: ['हम हर जगह HTTPS, स्टोरेज में एन्क्रिप्शन, हर अपलोड पर चेकसम, साइन किए हुए एक्सपायर होने वाले लिंक, वन-वे हैश किए सेशन सीक्रेट और बिना पासवर्ड साइन इन इस्तेमाल करते हैं। कोई सिस्टम पूरी तरह सुरक्षित नहीं होता; अगर किसी सेंधमारी से आपका डेटा प्रभावित होता है, तो हम क़ानून के अनुसार आपको और डेटा प्रोटेक्शन बोर्ड को बताएँगे।'],
      },
      {
        h2: '10. संपर्क और शिकायत अधिकारी',
        p: [`सवाल या रिक्वेस्ट: ${C}। शिकायत अधिकारी: ${G}। हम 30 दिनों के अंदर जवाब देते हैं, आमतौर पर बहुत जल्दी।`],
      },
      {
        h2: '11. बदलाव',
        p: ['हम बदलाव यहाँ पोस्ट करेंगे और नीचे की तारीख़ अपडेट करेंगे। बड़े बदलावों के लिए लागू होने से पहले ऐप में बताएँगे।'],
      },
    ],
  },
};

export const terms: Record<Lang, LegalDoc> = {
  en: {
    title: 'Terms of service',
    description: 'The terms for using the Lens app and website: your content, acceptable use, storage limits, and our responsibilities.',
    h1: 'Terms of service',
    intro: `These terms are an agreement between you and ${LEGAL.operator} for using the Lens app and lens.instagrowapp.com ("Lens"). By using Lens you agree to them.`,
    blocks: [
      { h2: '1. Your content stays yours', p: ['You keep all rights to the photos and videos you store in Lens. You give us only the permission needed to run Lens for you: to store, copy (for backups, previews and streaming), and show or share your content where you ask us to.'] },
      { h2: '2. Your account', p: ['Keep access to your email and phone secure; anyone with access to them could sign in. You are responsible for activity on your account. You must be 18 or older, or have a parent or guardian’s consent.'] },
      {
        h2: '3. Acceptable use',
        p: ['Don’t use Lens to store or share content that is illegal, including child sexual abuse material, content that infringes others’ rights, or malware. Don’t try to break, overload or get around the limits and security of Lens. We may remove such content, report it to authorities where required by law, and suspend accounts.'],
      },
      { h2: '4. Storage limits', p: ['The free plan includes 100 GB of Lens storage after you sign in (5 GB before). When you reach the limit, new uploads pause. Storage in your own connected services is governed by those services.'] },
      { h2: '5. Availability and backups', p: ['We work hard to keep Lens available and your files safe, with verified uploads and redundant storage. But no service can promise zero downtime or zero data loss; keep important originals in more than one place.'] },
      { h2: '6. Changes and ending the service', p: ['We may change features. If we ever end a service that stores your files, we will give at least 60 days’ notice so you can download your library. You can stop using Lens and delete your account at any time.'] },
      { h2: '7. Liability', p: ['To the extent the law allows, Lens is provided "as is" and our total liability for any claim is limited to the amount you paid us in the 12 months before it (₹0 on the free plan). Nothing here limits rights you have that cannot be limited by law.'] },
      { h2: '8. Law and disputes', p: ['These terms are governed by the laws of India. Contact us first so we can try to resolve any problem.'] },
      { h2: '9. Contact', p: [`${C}`] },
    ],
  },
  hi: {
    title: 'सेवा की शर्तें',
    description: 'Lens ऐप और वेबसाइट इस्तेमाल करने की शर्तें: आपका कंटेंट, सही इस्तेमाल, स्टोरेज सीमा और हमारी ज़िम्मेदारियाँ।',
    h1: 'सेवा की शर्तें',
    intro: `ये शर्तें Lens ऐप और lens.instagrowapp.com ("Lens") इस्तेमाल करने के लिए आपके और ${LEGAL.operator} के बीच एक समझौता हैं। Lens इस्तेमाल करके आप इन्हें मानते हैं। (यह अनुवाद है; अंतर होने पर अंग्रेज़ी संस्करण मान्य होगा।)`,
    blocks: [
      { h2: '1. आपका कंटेंट आपका ही रहता है', p: ['Lens में रखी फ़ोटो और वीडियो के सारे अधिकार आपके पास रहते हैं। आप हमें सिर्फ़ वही अनुमति देते हैं जो आपके लिए Lens चलाने के लिए ज़रूरी है: स्टोर करना, कॉपी करना (बैकअप, प्रीव्यू और स्ट्रीमिंग के लिए), और जहाँ आप कहें वहाँ दिखाना या शेयर करना।'] },
      { h2: '2. आपका अकाउंट', p: ['अपने ईमेल और फ़ोन की पहुँच सुरक्षित रखें; जिसके पास इनकी पहुँच है वह साइन इन कर सकता है। आपके अकाउंट पर होने वाली गतिविधि की ज़िम्मेदारी आपकी है। आपकी उम्र 18 साल या ज़्यादा होनी चाहिए, या माता-पिता/अभिभावक की सहमति।'] },
      { h2: '3. सही इस्तेमाल', p: ['Lens का इस्तेमाल ग़ैरक़ानूनी कंटेंट रखने या शेयर करने के लिए न करें, जिसमें बाल यौन शोषण सामग्री, दूसरों के अधिकारों का उल्लंघन करने वाला कंटेंट या मैलवेयर शामिल है। Lens की सीमाओं और सुरक्षा को तोड़ने, ओवरलोड करने या बायपास करने की कोशिश न करें। हम ऐसा कंटेंट हटा सकते हैं, क़ानून के अनुसार अधिकारियों को रिपोर्ट कर सकते हैं और अकाउंट निलंबित कर सकते हैं।'] },
      { h2: '4. स्टोरेज सीमा', p: ['फ़्री प्लान में साइन इन के बाद 100 GB Lens स्टोरेज (पहले 5 GB) शामिल है। सीमा पूरी होने पर नए अपलोड रुक जाते हैं। आपकी जोड़ी गई अपनी सेवाओं का स्टोरेज उन्हीं सेवाओं के नियमों से चलता है।'] },
      { h2: '5. उपलब्धता और बैकअप', p: ['हम Lens को उपलब्ध और आपकी फ़ाइलें सुरक्षित रखने के लिए पूरी मेहनत करते हैं, जाँचे हुए अपलोड और कई जगह स्टोरेज के साथ। फिर भी कोई सेवा शून्य डाउनटाइम या शून्य डेटा हानि का वादा नहीं कर सकती; ज़रूरी ओरिजिनल एक से ज़्यादा जगह रखें।'] },
      { h2: '6. बदलाव और सेवा बंद होना', p: ['हम फ़ीचर बदल सकते हैं। अगर हम कभी फ़ाइलें स्टोर करने वाली सेवा बंद करते हैं, तो कम से कम 60 दिन पहले बताएँगे ताकि आप अपनी लाइब्रेरी डाउनलोड कर सकें। आप कभी भी Lens इस्तेमाल करना बंद करके अकाउंट डिलीट कर सकते हैं।'] },
      { h2: '7. ज़िम्मेदारी', p: ['क़ानून जितनी अनुमति देता है, Lens "जैसा है" वैसा दिया जाता है और किसी भी दावे के लिए हमारी कुल ज़िम्मेदारी उससे पहले के 12 महीनों में आपके दिए भुगतान तक सीमित है (फ़्री प्लान पर ₹0)। यहाँ कुछ भी आपके उन अधिकारों को सीमित नहीं करता जिन्हें क़ानून सीमित नहीं करने देता।'] },
      { h2: '8. क़ानून और विवाद', p: ['ये शर्तें भारत के क़ानूनों के अधीन हैं। किसी भी समस्या को सुलझाने के लिए पहले हमसे संपर्क करें।'] },
      { h2: '9. संपर्क', p: [`${C}`] },
    ],
  },
};

export const deletion: Record<Lang, LegalDoc> = {
  en: {
    title: 'Delete your Lens account',
    description: 'How to delete your Lens by InstaGrow account and exactly what is deleted, from the app, the website or by email.',
    h1: 'Delete your account',
    intro: 'You can delete your Lens by InstaGrow account and all its data at any time. Deleting is permanent: download anything you want to keep first.',
    blocks: [
      {
        h2: 'How to delete',
        ul: [
          'In the app: Settings → Account → Delete account, then confirm.',
          'On the website: sign in, open Account, choose Delete account, then confirm.',
          `By email: write to ${C} from the email address on your account, with the subject "Delete my account". We confirm and delete within 7 days.`,
        ],
      },
      {
        h2: 'What is deleted',
        ul: [
          'All photos and videos stored in Lens, with their previews, edits and streaming copies',
          'Items in Trash and Archive',
          'Your shares (friends lose access to what you shared) and your Lens name',
          'Your email and Google sign-ins, devices and browser sessions',
          'Your storage connections (files already in your own Google Drive, OneDrive, Dropbox, Box, S3 or NAS stay there; they are yours)',
        ],
      },
      {
        h2: 'What is kept, and for how long',
        ul: [
          'Encrypted backups may hold deleted data for up to 35 days before being overwritten. It is not used or restored.',
          'Items friends shared with you belong to them and are not deleted with your account.',
          'Where the law requires us to keep a record (for example, a legal request), we keep only that record, for as long as required.',
        ],
      },
    ],
  },
  hi: {
    title: 'अपना Lens अकाउंट डिलीट करें',
    description: 'Lens by InstaGrow अकाउंट कैसे डिलीट करें और ठीक-ठीक क्या डिलीट होता है, ऐप, वेबसाइट या ईमेल से।',
    h1: 'अकाउंट डिलीट करें',
    intro: 'आप कभी भी अपना Lens by InstaGrow अकाउंट और उसका सारा डेटा डिलीट कर सकते हैं। डिलीट करना स्थायी है: जो रखना है वह पहले डाउनलोड कर लें।',
    blocks: [
      {
        h2: 'कैसे डिलीट करें',
        ul: [
          'ऐप में: Settings → Account → Delete account, फिर पुष्टि करें।',
          'वेबसाइट पर: साइन इन करें, Account खोलें, Delete account चुनें, फिर पुष्टि करें।',
          `ईमेल से: अपने अकाउंट वाले ईमेल से ${C} पर "Delete my account" विषय के साथ लिखें। हम 7 दिनों में पुष्टि करके डिलीट कर देंगे।`,
        ],
      },
      {
        h2: 'क्या डिलीट होता है',
        ul: [
          'Lens में रखी सारी फ़ोटो और वीडियो, उनके प्रीव्यू, एडिट और स्ट्रीमिंग कॉपी समेत',
          'ट्रैश और आर्काइव की चीज़ें',
          'आपके शेयर (दोस्तों को आपकी शेयर की गई चीज़ों तक पहुँच नहीं रहती) और आपका Lens नाम',
          'आपके ईमेल और Google साइन-इन, डिवाइस और ब्राउज़र सेशन',
          'आपके स्टोरेज कनेक्शन (आपके अपने Google Drive, OneDrive, Dropbox, Box, S3 या NAS में पहले से रखी फ़ाइलें वहीं रहती हैं; वे आपकी हैं)',
        ],
      },
      {
        h2: 'क्या रखा जाता है, और कितने समय',
        ul: [
          'एन्क्रिप्टेड बैकअप में डिलीट किया गया डेटा ओवरराइट होने से पहले 35 दिन तक रह सकता है। इसका इस्तेमाल या रिस्टोर नहीं होता।',
          'दोस्तों ने जो चीज़ें आपके साथ शेयर कीं वे उनकी हैं और आपके अकाउंट के साथ डिलीट नहीं होतीं।',
          'जहाँ क़ानून कोई रिकॉर्ड रखना ज़रूरी बनाता है (जैसे कोई क़ानूनी रिक्वेस्ट), हम सिर्फ़ वह रिकॉर्ड, ज़रूरत भर समय तक रखते हैं।',
        ],
      },
    ],
  },
};
