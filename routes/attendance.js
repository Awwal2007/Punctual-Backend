const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const QRSession = require('../models/QRSession');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');
const { sendNotification } = require('../utils/notifications');

// @route   POST api/attendance/generate-qr
// @desc    Generate a QR code session for a Session (Manager only)
router.post('/generate-qr', auth, authorize('manager'), async (req, res) => {
  const { sessionId, durationMinutes } = req.body;
  try {
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const session = new QRSession({
      class: sessionId,
      manager: req.user.id,
      expiresAt
    });
    await session.save();

    // Data to be encoded in QR code
    const qrData = JSON.stringify({
      sessionId: session._id,
      classId: sessionId,
      expiresAt: expiresAt
    });

    const qrUrl = await QRCode.toDataURL(qrData);
    res.json({ qrUrl, sessionId: session._id, expiresAt });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/attendance/mark
// @desc    Mark attendance by scanning QR (Worker only)
router.post('/mark', auth, authorize('worker'), async (req, res) => {
  const { sessionId } = req.body; // This is the QRSession ID
  try {
    const qrSession = await QRSession.findById(sessionId);
    if (!qrSession || !qrSession.active || qrSession.expiresAt < new Date()) {
      return res.status(400).json({ message: 'QR session expired or invalid' });
    }

    // Check if worker is enrolled in the session
    const Session = require('../models/Session');
    const targetSession = await Session.findById(qrSession.class);
    if (!targetSession.workers.includes(req.user.id)) {
      return res.status(403).json({ 
        message: 'You are not enrolled in this work session',
        notEnrolled: true,
        sessionId: qrSession.class,
        sessionName: targetSession.name
      });
    }

    // Check for existing attendance for this session today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingDailyAttendance = await Attendance.findOne({
      worker: req.user.id,
      session: qrSession.class,
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existingDailyAttendance) {
      return res.status(400).json({ message: 'Check-in already recorded for this session today' });
    }

    const attendance = new Attendance({
      worker: req.user.id,
      session: qrSession.class,
      qrSession: sessionId
    });
    await attendance.save();

    // Notify Manager
    try {
      const manager = await User.findById(qrSession.manager);
      if (manager && manager.fcmTokens && manager.fcmTokens.length > 0) {
        const worker = await User.findById(req.user.id);
        await sendNotification(manager.fcmTokens, {
          title: 'Worker Checked In! ✅',
          body: `${worker.name} just checked in for your session.`
        });
      }
    } catch (notifyErr) {
      console.error('Notification failed:', notifyErr.message);
    }

    res.json({ message: 'Check-in successful' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Check-in already recorded for this QR code.' });
    }
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/attendance/history
// @desc    Get attendance history for worker or report for manager
router.get('/history', auth, async (req, res) => {
  try {
    let history;
    if (req.user.role === 'worker') {
      history = await Attendance.find({ worker: req.user.id })
        .populate('worker', 'name email workerId')
        .populate('session', 'name section')
        .sort({ timestamp: -1 });
    } else {
      // Manager get attendance for their sessions
      const Session = require('../models/Session');
      const sessions = await Session.find({ manager: req.user.id });
      const sessionIds = sessions.map(s => s._id);
      history = await Attendance.find({ session: { $in: sessionIds } })
        .populate('worker', 'name email workerId')
        .populate('session', 'name section')
        .sort({ timestamp: -1 });
    }
    res.json(history);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

const { Parser } = require('json2csv');

// @route   GET api/attendance/export/:sessionId
// @desc    Export attendance as CSV
router.get('/export/:sessionId', auth, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const attendanceRecords = await Attendance.find({ session: sessionId })
      .populate('worker', 'name email')
      .populate('session', 'name section')
      .sort({ timestamp: -1 });

    if (attendanceRecords.length === 0) {
      return res.status(404).json({ message: 'No records found for this session' });
    }

    const data = attendanceRecords.map(record => ({
      Worker: record.worker.name,
      Email: record.worker.email,
      Session: record.session.name,
      Category: record.session.section || 'General',
      Date: new Date(record.timestamp).toLocaleDateString(),
      Time: new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    const fields = ['Worker', 'Email', 'Session', 'Category', 'Date', 'Time'];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment(`attendance_${sessionId}.csv`);
    return res.send(csv);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
