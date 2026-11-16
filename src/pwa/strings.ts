// All user-facing UI text (Q-01: Hebrew, RTL). Draft copy for review (Q-05).
// The product name appears only in `appName`; it is the notification title (D-003), never part of a body.

export const PRODUCT_NAME = 'נקודה טובה'

export const strings = {
  appName: PRODUCT_NAME,
  subtitle: 'מחשבה קטנה וטובה, פעם ביום.',

  timeLabel: 'שעת ההתראה',

  notificationsLabel: 'התראות',
  notificationsOn: 'פעילות',
  notificationsOff: 'כבויות',
  notificationsOffHint: 'כל עוד ההתראות כבויות, לא יגיעו אליך הודעות.',

  saved: 'נשמר',
  saveFailed: 'לא הצלחנו לשמור כרגע. ננסה שוב.',
  saveRejected: 'לא הצלחנו לשמור את השינוי הזה.',
  capacityReached: 'אי אפשר להצטרף כרגע. אפשר לנסות שוב מאוחר יותר.',
  enableFailed: 'לא הצלחנו להפעיל התראות כרגע. אפשר לנסות שוב.',
  enableOffline: 'אין חיבור כרגע. אפשר לנסות שוב כשיהיה.',
  permissionDenied: 'ההתראות כבויות בהגדרות המכשיר. אפשר להפעיל אותן שם בכל זמן.',
  unsupported: 'הדפדפן הזה לא יכול לשלוח התראות. אולי דפדפן אחר יוכל.',

  // iOS install sheet (Safari tab only): one heading, one sentence of steps, one muted line.
  installHeading: 'באייפון, ההתראות מגיעות מהאפליקציה שבמסך הבית.',
  installStepsBefore: 'מקישים על',
  installShare: 'שיתוף',
  installStepsAfter: ', אחר כך על ״הוספה למסך הבית״, ופותחים משם.',
  installVersion: 'נדרשת גרסת iOS 16.4 ומעלה.',
  installDismiss: 'לא עכשיו',

  howItWorksTitle: 'איך זה עובד',
  howItWorks: [
    'פעם ביום, בשעה שבחרת, מגיעה מחשבה קטנה אחת. משהו שכבר ידעת, ואולי קצת שכחת.',
    'אולי להתקשר למישהו שאוהבים. אולי לעצור לנשימה, ללכת לים, או פשוט לשים לב לרגע.',
    'אין כאן מטרה, ניקוד או הישגים. אין צורך לפתוח את האפליקציה, ואין שום רגשות אשם כשיום עובר בלי התראה.',
    'אין חשבון ואין שם. נשמרים רק מזהה אנונימי, השעה שבחרת, אזור הזמן, כתובת ההתראות של המכשיר, ורישום טכני של מועדי השליחה (בלי תוכן ההודעות). כיבוי ההתראות מוחק את כתובת ההתראות.',
  ],

  privacyLink: 'פרטיות',
} as const

export type StringKey = keyof typeof strings

/** Everything that can appear in the toast (Calm-space principle: one short, warm sentence each). */
export const TOAST_KEYS = [
  'saved',
  'saveFailed',
  'saveRejected',
  'capacityReached',
  'enableFailed',
  'enableOffline',
  'permissionDenied',
  'unsupported',
] as const satisfies readonly StringKey[]
