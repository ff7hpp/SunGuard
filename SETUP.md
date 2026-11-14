# تشغيل SunGuard محلياً

## المتطلبات

- Git
- Node.js 26 أو أحدث
- اتصال إنترنت أول مرة فقط لتنزيل الحزم

لا تحتاج إلى Neon أو Vercel أو أي ملف أسرار. قاعدة البيانات SQLite محلية لكل جهاز، وملف البيانات التاريخية المضغوط موجود داخل المستودع.

## macOS

افتح **Terminal** ثم الصق الأوامر التالية:

```bash
git clone https://github.com/ff7hpp/SunGuard.git
cd SunGuard
node --version
npm ci
npm run setup
npm run simulate
```

بعد ظهور رسالة أن الخادم يعمل، افتح:

```
http://127.0.0.1:4173/
```

`npm run setup` ينشئ `data/sunguard.db` ويستورد الأيام السبعة المسجلة من الملف المضمّن `dataset/SunGuard7days.csv.gz`. لا تُرفع قاعدة البيانات المحلية إلى Git، ولا حاجة لنسخها من جهاز آخر.

## Windows

في PowerShell داخل مجلد المشروع:

```powershell
npm ci
npm run setup
npm run simulate
```

ثم افتح `http://127.0.0.1:4173/`.

## فحص سريع

قبل التشغيل أو بعد أي سحب جديد:

```bash
npm test
```

لإيقاف الخادم: اضغط `Ctrl + C` في نافذة Terminal.

## تحديث المشروع لاحقاً

من داخل مجلد `SunGuard`:

```bash
git pull origin main
npm ci
npm run setup
npm run simulate
```

تشغيل `setup` بعد التحديث آمن؛ يعيد إعداد SQLite المحلية من البيانات المضمّنة.
