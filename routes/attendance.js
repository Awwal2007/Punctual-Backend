const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const QRSession = require('../models/QRSession');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');
const { sendNotification } = require('../utils/notifications');

// @route   POST api/attendance/generate-qr
// @desc    Generate a QR code session for a class (Teacher only)
router.post('/generate-qr', auth, authorize('teacher'), async (req, res) => {
  const { classId, durationMinutes } = req.body;
  try {
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const session = new QRSession({
      class: classId,
      teacher: req.user.id,
      expiresAt
    });
    await session.save();

    // Data to be encoded in QR code
    const qrData = JSON.stringify({
      sessionId: session._id,
      classId: classId,
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
// @desc    Mark attendance by scanning QR (Student only)
router.post('/mark', auth, authorize('student'), async (req, res) => {
  const { sessionId } = req.body;
  try {
    const session = await QRSession.findById(sessionId);
    if (!session || !session.active || session.expiresAt < new Date()) {
      return res.status(400).json({ message: 'QR session expired or invalid' });
    }

    // Check if student is enrolled in the class
    const Class = require('../models/Class');
    const targetClass = await Class.findById(session.class);
    if (!targetClass.students.includes(req.user.id)) {
      return res.status(403).json({ 
        message: 'You are not enrolled in this class',
        notEnrolled: true,
        classId: session.class,
        className: targetClass.name
      });
    }

    // Check for existing attendance for this class today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingDailyAttendance = await Attendance.findOne({
      student: req.user.id,
      class: session.class,
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existingDailyAttendance) {
      return res.status(400).json({ message: 'Attendance already marked for this class today' });
    }

    const attendance = new Attendance({
      student: req.user.id,
      class: session.class,
      session: sessionId
    });
    await attendance.save();

    // Notify teacher
    try {
      const teacher = await User.findById(session.teacher);
      if (teacher && teacher.fcmTokens && teacher.fcmTokens.length > 0) {
        const student = await User.findById(req.user.id);
        await sendNotification(teacher.fcmTokens, {
          title: 'Student Checked In! ✅',
          body: `${student.name} just marked attendance for your class.`
        });
      }
    } catch (notifyErr) {
      console.error('Notification failed:', notifyErr.message);
    }

    res.json({ message: 'Attendance marked successfully' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Attendance already marked for this session' });
    }
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/attendance/history
// @desc    Get attendance history for student or report for teacher
router.get('/history', auth, async (req, res) => {
  try {
    let history;
    if (req.user.role === 'student') {
      history = await Attendance.find({ student: req.user.id })
        .populate('class', 'name section')
        .sort({ timestamp: -1 });
    } else {
      // Teacher get attendance for their classes
      const Class = require('../models/Class');
      const classes = await Class.find({ teacher: req.user.id });
      const classIds = classes.map(c => c._id);
      history = await Attendance.find({ class: { $in: classIds } })
        .populate('student', 'name email')
        .populate('class', 'name section')
        .sort({ timestamp: -1 });
    }
    res.json(history);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

const { Parser } = require('json2csv');

// @route   GET api/attendance/export/:classId
// @desc    Export attendance as CSV
router.get('/export/:classId', auth, async (req, res) => {
  try {
    const classId = req.params.classId;
    const attendanceRecords = await Attendance.find({ class: classId })
      .populate('student', 'name email')
      .populate('class', 'name section')
      .sort({ timestamp: -1 });

    if (attendanceRecords.length === 0) {
      return res.status(404).json({ message: 'No attendance records found for this class' });
    }

    const data = attendanceRecords.map(record => ({
      Student: record.student.name,
      Email: record.student.email,
      Class: record.class.name,
      Section: record.class.section || 'General',
      Date: new Date(record.timestamp).toLocaleDateString(),
      Time: new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    const fields = ['Student', 'Email', 'Class', 'Section', 'Date', 'Time'];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment(`attendance_${classId}.csv`);
    return res.send(csv);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
