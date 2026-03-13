const admin = require('firebase-admin');
let serviceAccount;

// 1. Try environment variable (Standard for Production/CI)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const rawVal = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    // Try parsing as JSON first, if it fails, try Base64 decoding
    if (rawVal.startsWith('{')) {
      serviceAccount = JSON.parse(rawVal);
    } else {
      serviceAccount = JSON.parse(Buffer.from(rawVal, 'base64').toString('utf8'));
    }
  } catch (err) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT env:', err.message);
  }
}

// 2. Fallback to local file (Standard for Development)
if (!serviceAccount) {
  try {
    const saPath = require('path').join(__dirname, '../firebase-service-account.json');
    const fs = require('fs');
    if (fs.existsSync(saPath)) {
      serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading firebase-service-account.json:', err.message);
  }
}

// 3. Initialize Firebase Admin
if (serviceAccount) {
  try {
    // Fix private key formatting (essential for PEM keys in environment variables)
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
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
    data: {
      url: payload.url || '/login',
      click_action: payload.url || '/login'
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
        tag: 'punctual-attendance',
        data: {
          url: payload.url || '/login'
        }
      },
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
