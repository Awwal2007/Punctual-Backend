const admin = require('firebase-admin');

// Initialize Firebase Admin (requires service account JSON)
// The service account should be provided via environment variable
// or a file. For now, we assume it's initialized if the config exists.
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized');
  } catch (err) {
    console.error('Error initializing Firebase Admin:', err.message);
  }
}

const QRSession = require('../models/QRSession');
const Attendance = require('../models/Attendance');
const Class = require('../models/Class');
const User = require('../models/User');

const sendNotification = async (tokens, payload) => {
  if (!tokens || tokens.length === 0) return;
  if (!admin.apps.length) return;

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    webpush: {
      headers: {
        Urgency: 'high'
      },
      notification: {
        body: payload.body,
        icon: '/icon.png',
        badge: '/icon.png',
        vibrate: [200, 100, 200],
        requireInteraction: true,
        tag: 'punctual-attendance'
      }
    },
    android: {
      priority: 'high',
      notification: {
        channel_id: 'default',
        priority: 'high',
        vibrate_timings: ['0.2s', '0.1s', '0.2s'],
        notification_priority: 'PRIORITY_MAX'
      }
    },
    tokens: tokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`Successfully sent ${response.successCount} notifications`);

    // Clean up failed tokens (e.g. invalid or expired)
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
        }
      });
      console.log('Failed tokens:', failedTokens);
      return failedTokens; // Backend can use this to remove dead tokens
    }
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

const checkMissedClasses = async () => {
  try {
    const now = new Date();
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Find sessions that expired in the last 5 minutes
    const expiredSessions = await QRSession.find({
      expiresAt: { $gte: fiveMinsAgo, $lt: now },
      active: true
    });

    for (const session of expiredSessions) {
      const targetClass = await Class.findById(session.class).populate('students');
      if (!targetClass) continue;

      const attendances = await Attendance.find({ session: session._id });
      const markedStudentIds = attendances.map(a => a.student.toString());

      for (const student of targetClass.students) {
        if (!markedStudentIds.includes(student._id.toString())) {
          // Student missed class
          if (student.fcmTokens && student.fcmTokens.length > 0) {
            await sendNotification(student.fcmTokens, {
              title: 'Missed Class! ⚠️',
              body: `You didn't mark attendance for ${targetClass.name}. Please contact your teacher.`
            });
          }
        }
      }

      // Mark session as fully processed if needed or just leave it
    }
  } catch (err) {
    console.error('Check missed classes failed:', err.message);
  }
};

module.exports = { sendNotification, checkMissedClasses };
