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
const Session = require('../models/Session');
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
    // clean up failed tokens...
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
        }
      });
      return failedTokens;
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

    for (const qrSession of expiredSessions) {
      const targetSession = await Session.findById(qrSession.class).populate('workers');
      if (!targetSession) continue;

      const attendances = await Attendance.find({ qrSession: qrSession._id });
      const markedWorkerIds = attendances.map(a => a.worker.toString());

      for (const worker of targetSession.workers) {
        if (!markedWorkerIds.includes(worker._id.toString())) {
          // Worker missed check-in
          if (worker.fcmTokens && worker.fcmTokens.length > 0) {
            await sendNotification(worker.fcmTokens, {
              title: 'Check-in Missed! ⚠️',
              body: `You didn't check in for ${targetSession.name}. Please contact your manager.`
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Check missed sessions failed:', err.message);
  }
};

module.exports = { sendNotification, checkMissedClasses };
